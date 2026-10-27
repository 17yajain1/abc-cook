"""`compute_nutrition`: per-serving nutrition from matched ingredient lines (part-a-plan §6-§7).

Pure: the same ingredients, servings and resolutions give the same result, and `computed_at` is
passed in rather than read from a clock. The official label (v3) follows the B2 report's
proposed thresholds, then a guard: a recipe is never `calculated` when one of its top-5 lines by
kcal got its food from an unreviewed pick. The v2 label (§6 placeholder thresholds, no guard) is
kept as `confidence_v2`. Fat lines get their amount from how the fat is used (`fat.py`), not
from one flat default (b3-plan 2A). Servings come from the graph, else from the yield text.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

from abc_cook.extract.graph import SERVINGS_DEFAULTED_WARNING
from abc_cook.nutrition import NUTRITION_VERSION
from abc_cook.nutrition.diet import derive_diet
from abc_cook.nutrition.fat import (
    FatLinks,
    classify_fat,
    fat_line_text,
    fried_ingredient_ids,
    has_fry_line_cue,
    link_nodes,
    step_text,
)
from abc_cook.nutrition.foods import Food, FoodTable, load_foods
from abc_cook.nutrition.grams import (
    ML_PER_UNIT,
    GramsResult,
    density,
    line_grams,
)
from abc_cook.nutrition.resolution import LineResolution
from abc_cook.schema.ingredient import Ingredient
from abc_cook.schema.node import Node
from abc_cook.schema.nutrition import (
    Confidence,
    Driver,
    FatMethod,
    FatRule,
    FoodRef,
    FoodSourceName,
    GramsBasis,
    IngredientNutrition,
    LineFlag,
    NutrientAmounts,
    RecipeNutrition,
)

DEFAULT_FAT_TBSP_PER_SERVING = 0.5
"""A shallow or plain fat line with no amount: half a tablespoon per serving."""
BESIDE_STATED_FAT_TSP_PER_SERVING = 1.0
"""The same, when another counted fat line in the recipe has its own amount."""
DEEP_FRY_ABSORBED_SHARE = 0.10
"""A deep-fry line is the oil the food absorbs: 10% of the raw weight of the fried food."""
DEEP_FRY_FALLBACK_TBSP_PER_SERVING = 1.0
UNCERTAIN_DEEP_MAX_TBSP = 3.0
"""A deep-fry cue found only in a linked step, beside a stated amount this small, is flagged."""
SOURCE_LABEL = "USDA FoodData Central (SR Legacy + Foundation)"

# Placeholder thresholds (part-a-plan §6), calibrated by the B2 report, not by this code.
ESTIMATED_KCAL_ROUGH_SHARE = 0.25
UNMATCHED_LINES_ROUGH_SHARE = 0.20
STATED_TABLE_KCAL_CALCULATED_SHARE = 0.90
TOP_LINES_CHECKED = 5
DRIVER_COUNT = 3

# The B2 report's proposals: the official thresholds from v3 (b3-plan 2E, b35-plan 2F).
PROPOSED_ESTIMATED_KCAL_ROUGH_SHARE = 0.35
PROPOSED_UNMATCHED_GRAMS_ROUGH_SHARE = 0.20

_SERVINGS_WORDS = {
    "serves", "serve", "serving", "servings", "people", "persons", "person", "portions",
    "portion", "pax", "makes", "make",
}  # fmt: skip
_YIELD_FILLER = {
    "about", "approx", "approximately", "around", "roughly", "for", "to", "or", "and", "a", "an",
    "the", "of", "upto", "up",
}  # fmt: skip
_YIELD_MEASURES = {
    "g", "gm", "gms", "kg", "ml", "l", "litre", "litres", "liter", "liters", "cup", "cups",
}  # fmt: skip
_DASHES = chr(0x2013) + chr(0x2014)  # ASCII-safe in source (RUF001)
_YIELD_NUMBER_RE = re.compile(rf"(\d+)\s*(?:(?:-|[{_DASHES}]|to|or)\s*(\d+))?")
_TO_TASTE_RE = re.compile(r"\bto taste\b|\bas needed\b|\bas required\b", re.IGNORECASE)
_OPTIONAL_RE = re.compile(r"\boptional\b", re.IGNORECASE)
_SALT_PEPPER_RE = re.compile(r"\b(?:salt|pepper)\b", re.IGNORECASE)
_NOT_PEPPER_RE = re.compile(r"\b(?:bell|chil\w*|capsicum|cayenne|green|red|sweet)\b", re.IGNORECASE)
_FRYING_RE = re.compile(r"\bfry(?:ing)?\b", re.IGNORECASE)
_PARENS_RE = re.compile(r"\([^)]*\)")

_FAT_NAME_PREFIXES = ("oil,", "butter", "lard", "fat,", "shortening", "margarine")
_KEYWORDS: dict[str, re.Pattern[str]] = {
    "fat": re.compile(r"\b(?:oil|ghee|butter|lard)\b", re.IGNORECASE),
    "meat": re.compile(
        r"\b(?:chicken|mutton|lamb|beef|pork|fish|shrimp|prawns?|meat|mince|bacon|sausage|"
        r"salmon|tuna|turkey)\b",
        re.IGNORECASE,
    ),
    "sugar": re.compile(r"\b(?:sugar|jaggery|honey|syrup|molasses)\b", re.IGNORECASE),
    "nuts": re.compile(
        r"\b(?:nuts?|cashews?|almonds?|pistachios?|walnuts?|peanuts?|chironji)\b", re.IGNORECASE
    ),
    "cream": re.compile(r"\bcream\b", re.IGNORECASE),
}


@dataclass
class _Row:
    index: int
    ing: Ingredient
    food: Food | None
    source: FoodSourceName | None = None
    reviewed: bool = False
    grams: float | None = None
    basis: GramsBasis = "missing"
    flags: list[LineFlag] = field(default_factory=list)
    result: GramsResult | None = None
    excluded: Literal["optional", "to_taste"] | None = None
    kcal: float = 0.0
    """Counted kcal: 0 on an excluded row."""
    potential_kcal: float | None = None
    """What the line would add if counted: None when no food or no grams."""
    impact: str | None = None
    had_amount: bool = False
    """The line gave grams before any fat default or deep-fry estimate."""
    fat_method: FatMethod | None = None
    fat_rule: FatRule | None = None
    fried_grams: float | None = None

    def add_flag(self, flag: LineFlag) -> None:
        if flag not in self.flags:
            self.flags.append(flag)


def servings_basis_source(
    servings_stated: bool, warnings: list[str]
) -> Literal["stated", "assumed"]:
    """`stated` or `assumed`; the legacy warning counts as assumed (part-a-plan §7)."""
    if not servings_stated or SERVINGS_DEFAULTED_WARNING in warnings:
        return "assumed"
    return "stated"


def servings_from_yield(text: str | None) -> tuple[int | None, int | None]:
    """(servings, pieces) read from a yield text; at most one is set.

    Takes the first number, or the lower bound of the first range. If the words left over are
    only servings words ("serves", "people", "makes"...) and filler, the number is servings.
    Any other noun ("12 chillas", "makes 12-13 cookies") makes it a piece count instead, which
    is reported but never used in the maths. A text with no number, or a measure ("250 g"),
    gives neither.
    """
    if not text:
        return None, None
    body = re.sub(r"\([^)]*\)", " ", text.lower())
    match = _YIELD_NUMBER_RE.search(body)
    if match is None:
        return None, None
    value = int(match.group(1))
    if value < 1:
        return None, None
    words = re.findall(r"[a-z]+", body[: match.start()] + " " + body[match.end() :])
    rest = [w for w in words if w not in _SERVINGS_WORDS and w not in _YIELD_FILLER]
    if not rest:
        return value, None
    if any(w in _YIELD_MEASURES for w in rest):
        return None, None
    return None, value


def line_text(ing: Ingredient) -> str:
    """The line as a cook reads it: amount, unit (unless the amount already has it), name."""
    qty = (ing.qty_text or "").strip()
    unit = (ing.unit or "").strip()
    parts = [qty]
    if unit and unit.casefold() not in qty.casefold():
        parts.append(unit)
    parts.append(ing.name.strip())
    return " ".join(p for p in parts if p)


def is_fat(food: Food | None) -> bool:
    """Oil, ghee, butter, lard and the like."""
    if food is None:
        return False
    name = food.name.casefold()
    return name.startswith(_FAT_NAME_PREFIXES) or "clarified butter" in name


def impact_class(food: Food | None, text: str) -> str | None:
    """The high-impact class (fat, meat, sugar, nuts, cream) of a matched food or a bare line."""
    if food is not None:
        name = food.name.casefold()
        if is_fat(food):
            return "fat"
        if food.veg == "non_veg" and food.food_group != "Fats and Oils":
            return "meat"
        if name.startswith(("sugars", "honey", "syrups", "molasses")):
            return "sugar"
        if food.food_group == "Nut and Seed Products" and name.startswith(("nuts,", "peanuts")):
            return "nuts"
        if name.startswith(("cream,", "cream ")) and "cheese" not in name:
            return "cream"
        return None
    for label, pattern in _KEYWORDS.items():
        if pattern.search(text):
            return label
    return None


def is_optional(ing: Ingredient) -> bool:
    """Whether the line or its note says "optional"; such lines are left out of the totals."""
    return ing.optional or bool(_OPTIONAL_RE.search(f"{ing.name} {ing.prep_note or ''}"))


def is_salt_or_pepper_to_taste(ing: Ingredient) -> bool:
    """Whether this is a salt or pepper line written "to taste" (0 kcal, not in confidence)."""
    text = f"{ing.qty_text or ''} {ing.unit or ''} {ing.name} {ing.prep_note or ''}"
    if not _TO_TASTE_RE.search(text):
        return False
    head = _PARENS_RE.sub(" ", ing.name)
    has_salt = re.search(r"\bsalt\b", head, re.IGNORECASE) is not None
    has_pepper = (
        re.search(r"\bpepper\b", head, re.IGNORECASE) is not None
        and _NOT_PEPPER_RE.search(head) is None
    )
    return has_salt or has_pepper


def _spoon_grams(food: Food, unit: str) -> float:
    """Grams in one `tbsp` or `tsp` of this food: its own FDC portion, else ml times density."""
    for portion in food.portions:
        if portion.unit == unit:
            return portion.grams
    return ML_PER_UNIT[unit] * density(food)


def _resolve_row(index: int, ing: Ingredient, resolution: LineResolution, table: FoodTable) -> _Row:
    food = table.get(resolution.food_id) if resolution.food_id else None
    row = _Row(index, ing, food, resolution.food_source if food else None, resolution.reviewed)
    row.impact = impact_class(food, line_text(ing))
    result = line_grams(ing, food)
    row.result = result
    row.flags = list(result.flags)

    if is_optional(ing):
        row.excluded = "optional"
    elif is_salt_or_pepper_to_taste(ing):
        row.excluded = "to_taste"
        row.flags.append("to_taste")

    grams, basis = result.grams, result.basis
    if grams is None and result.needs_llm and resolution.llm_grams is not None:
        grams, basis = resolution.llm_grams, "estimated"
    row.grams = grams
    row.basis = "unmatched" if food is None else basis
    row.had_amount = grams is not None
    return row


# --- fat lines (b3-plan 2A) -------------------------------------------------------------------


def _apply_fat_rules(rows: list[_Row], servings: int, nodes: Sequence[Node] | None) -> None:
    """Classify every fat line and set its grams: stated, a default, or the deep-fry estimate."""
    fat_rows = [r for r in rows if is_fat(r.food)]
    if not fat_rows:
        return
    fat_ids = {r.ing.id for r in fat_rows}
    by_ing = {r.ing.id: r for r in rows}
    links: dict[int, FatLinks] = {}

    for r in fat_rows:
        links[r.index] = link_nodes(r.ing.id, fat_ids, nodes) if nodes else FatLinks((), ())
        line = fat_line_text(r.ing)
        cls = classify_fat(line, [step_text(n) for n in links[r.index].linked])
        r.fat_method = cls.method
        if cls.uncertain:
            r.add_flag("fry_method_uncertain")
        if cls.method == "deep_fry":
            food = r.food
            small_stated = (
                cls.deep_cue_from_steps_only
                and r.had_amount
                and food is not None
                and r.grams is not None
                and r.grams <= UNCERTAIN_DEEP_MAX_TBSP * _spoon_grams(food, "tbsp")
            )
            if small_stated:
                r.add_flag("fry_method_uncertain")

    for r in fat_rows:
        if r.fat_method != "deep_fry":
            continue
        food = r.food
        assert food is not None
        r.add_flag("frying")
        r.basis = "estimated"
        fried_ids = fried_ingredient_ids(links[r.index].fry_nodes, nodes or (), fat_ids)
        mass = sum(
            (by_ing[i].grams or 0.0)
            for i in fried_ids
            if i in by_ing and by_ing[i].excluded is None
        )
        if mass > 0:
            r.grams = DEEP_FRY_ABSORBED_SHARE * mass
            r.fried_grams = mass
            r.fat_rule = "deep_fry_10pct"
            r.add_flag("absorbed_estimate")
        else:
            r.grams = _spoon_grams(food, "tbsp") * DEEP_FRY_FALLBACK_TBSP_PER_SERVING * servings
            r.fat_rule = "deep_fry_fallback"
            r.add_flag("deep_fry_fallback")

    for r in fat_rows:
        if r.fat_method != "shallow_or_plain":
            continue
        food = r.food
        assert food is not None
        line = fat_line_text(r.ing)
        if has_fry_line_cue(line) or _FRYING_RE.search(line):
            r.add_flag("frying")
        if r.had_amount:
            r.fat_rule = "stated"
            continue
        if r.result is not None and r.result.needs_llm:
            continue  # a count the resolver cannot convert: left missing, as before
        beside_stated = any(
            o is not r
            and o.fat_method == "shallow_or_plain"
            and o.had_amount
            and o.excluded is None
            for o in fat_rows
        )
        if beside_stated:
            r.grams = _spoon_grams(food, "tsp") * BESIDE_STATED_FAT_TSP_PER_SERVING * servings
            r.fat_rule = "default_1tsp_beside_stated"
            r.add_flag("fat_default_beside_stated_fat")
        else:
            r.grams = _spoon_grams(food, "tbsp") * DEFAULT_FAT_TBSP_PER_SERVING * servings
            r.fat_rule = "default_half_tbsp"
        r.basis = "estimated"
        r.add_flag("default_fat")


def _finalize_kcal(rows: list[_Row]) -> None:
    for r in rows:
        if r.food is not None and r.grams is not None:
            r.potential_kcal = r.grams * r.food.kcal / 100.0
        r.kcal = (r.potential_kcal or 0.0) if r.excluded is None else 0.0


def _nutrients(food: Food, grams: float) -> NutrientAmounts:
    scale = grams / 100.0
    return NutrientAmounts(
        kcal=food.kcal * scale,
        protein_g=food.protein_g * scale,
        carbs_g=food.carbs_g * scale,
        fat_g=food.fat_g * scale,
        fibre_g=food.fibre_g * scale,
    )


# --- labels -----------------------------------------------------------------------------------


def _calculated_or_estimated(counted: list[_Row], total_kcal: float, assumed: bool) -> Confidence:
    solid_kcal = sum(r.kcal for r in counted if r.basis in ("stated", "table"))
    top = sorted(counted, key=lambda r: r.kcal, reverse=True)[:TOP_LINES_CHECKED]
    calculated = (
        total_kcal > 0
        and solid_kcal / total_kcal >= STATED_TABLE_KCAL_CALCULATED_SHARE
        and not any(r.basis in ("missing", "unmatched", "estimated") for r in top)
        and not any(r.basis == "estimated" and r.impact is not None for r in counted)
    )
    if calculated and not assumed:
        return "calculated"
    return "estimated"


def _high_impact_problem(counted: list[_Row]) -> bool:
    big_missing = any(
        r.basis == "missing" and r.impact in ("meat", "sugar", "nuts", "cream") for r in counted
    )
    big_unmatched = any(r.impact is not None for r in counted if r.food is None)
    return big_missing or big_unmatched


def _label(rows: list[_Row], assumed: bool) -> Confidence:
    """The official label: part-a-plan §6 rules, in order, first match wins."""
    counted = [r for r in rows if r.excluded is None]
    total_kcal = sum(r.kcal for r in counted)
    estimated_kcal = sum(r.kcal for r in counted if r.basis == "estimated")
    unmatched = [r for r in counted if r.food is None]
    rough = (
        _high_impact_problem(counted)
        or (total_kcal > 0 and estimated_kcal / total_kcal > ESTIMATED_KCAL_ROUGH_SHARE)
        or (counted and len(unmatched) / len(counted) > UNMATCHED_LINES_ROUGH_SHARE)
    )
    if rough:
        return "rough"
    return _calculated_or_estimated(counted, total_kcal, assumed)


def _is_unreviewed_pick(row: _Row) -> bool:
    """Whether the line's food is a pick nobody has reviewed.

    A pick is a food from the food-map cache, a fresh model answer, or a curated alias; an exact
    name match is not a pick. It is unreviewed unless the cache row or alias row is reviewed.
    """
    return row.food is not None and row.source in ("cache", "llm", "alias") and not row.reviewed


def _label_official(rows: list[_Row], assumed: bool) -> tuple[Confidence, bool]:
    """The official v3 label and whether the guard demoted it.

    The B2-proposal rules, then: `calculated` becomes `estimated` when any of the top-5 counted
    lines by kcal is an unreviewed pick.
    """
    label = _label_proposed(rows, assumed)
    if label != "calculated":
        return label, False
    counted = [r for r in rows if r.excluded is None]
    top = sorted(counted, key=lambda r: r.kcal, reverse=True)[:TOP_LINES_CHECKED]
    if any(_is_unreviewed_pick(r) for r in top):
        return "estimated", True
    return label, False


def _label_proposed(rows: list[_Row], assumed: bool) -> Confidence:
    """The label under the B2 report's proposals (b3-plan 2E), before the guard.

    A range midpoint no longer counts as estimated for the kcal-share rule, whose limit is 35%;
    the unmatched rule is measured in grams, not lines. The "calculated" rule and the
    assumed-servings cap are unchanged.
    """
    counted = [r for r in rows if r.excluded is None]
    total_kcal = sum(r.kcal for r in counted)
    estimated_kcal = sum(
        r.kcal for r in counted if r.basis == "estimated" and "range_midpoint" not in r.flags
    )
    all_grams = sum(r.grams or 0.0 for r in counted)
    unmatched_grams = sum(r.grams or 0.0 for r in counted if r.food is None)
    rough = (
        _high_impact_problem(counted)
        or (total_kcal > 0 and estimated_kcal / total_kcal > PROPOSED_ESTIMATED_KCAL_ROUGH_SHARE)
        or (all_grams > 0 and unmatched_grams / all_grams > PROPOSED_UNMATCHED_GRAMS_ROUGH_SHARE)
    )
    if rough:
        return "rough"
    return _calculated_or_estimated(counted, total_kcal, assumed)


def compute_nutrition(
    ingredients: list[Ingredient],
    servings: int,
    servings_stated: bool,
    warnings: list[str],
    resolutions: list[LineResolution],
    *,
    computed_at: datetime,
    table: FoodTable | None = None,
    nodes: Sequence[Node] | None = None,
    yield_text: str | None = None,
) -> RecipeNutrition:
    """Per-serving nutrition for `ingredients`, one `LineResolution` per line.

    Args:
        ingredients: `CookingGraph.ingredients`.
        servings: `CookingGraph.servings` (at least 1).
        servings_stated: `CookingGraph.servings_stated`; False caps the label at `estimated`,
            unless the yield text gives the servings.
        warnings: The import warnings; the legacy defaulted-servings warning counts as assumed.
        resolutions: What the matcher decided, in the same order as `ingredients`.
        computed_at: Stamped on the result (passed in so the function stays pure).
        table: The food table; defaults to the bundled one.
        nodes: `CookingGraph.nodes`. Without them a fat line is classified from its own text only,
            and a deep-fry line falls back to a flat amount (nothing says what is being fried).
        yield_text: `CookingGraph.yield_text`. Read only when the servings would be assumed: a
            bare number or a servings phrase gives the servings (source `yield_text`); a piece
            noun gives `yield_pieces` and the servings stay assumed.

    Returns:
        The per-serving numbers, a confidence label (official and v2), the top drivers and
        every line's working.
    """
    table = table or load_foods()
    servings = max(1, servings)
    source: Literal["stated", "assumed", "yield_text"] = servings_basis_source(
        servings_stated, warnings
    )
    yield_pieces: int | None = None
    if source == "assumed":
        from_yield, yield_pieces = servings_from_yield(yield_text)
        if from_yield is not None:
            servings, source = from_yield, "yield_text"
    rows = [
        _resolve_row(i, ing, res, table)
        for i, (ing, res) in enumerate(zip(ingredients, resolutions, strict=True))
    ]
    _apply_fat_rules(rows, servings, nodes)
    _finalize_kcal(rows)

    total = NutrientAmounts()
    out: list[IngredientNutrition] = []
    for r in rows:
        nutrients = _nutrients(r.food, r.grams) if r.food and r.grams is not None else None
        counted = nutrients if r.excluded is None else None
        if counted is not None:
            total = NutrientAmounts(
                kcal=total.kcal + counted.kcal,
                protein_g=total.protein_g + counted.protein_g,
                carbs_g=total.carbs_g + counted.carbs_g,
                fat_g=total.fat_g + counted.fat_g,
                fibre_g=total.fibre_g + counted.fibre_g,
            )
        result = r.result
        out.append(
            IngredientNutrition(
                ingredient_id=r.ing.id,
                ingredient_index=r.index,
                line_text=line_text(r.ing),
                food=FoodRef(food_id=r.food.id, name=r.food.name, foods_version=table.foods_version)
                if r.food
                else None,
                food_source=r.source if r.food else None,
                food_reviewed=r.reviewed if r.food else False,
                grams=r.grams,
                grams_basis=r.basis,
                nutrients=counted,
                est_kcal=r.kcal,
                excluded_reason=r.excluded,
                flags=r.flags,
                hint_reading=result.hint_reading if result else None,
                portion=result.portion if result else None,
                fat_method=r.fat_method,
                fat_rule=r.fat_rule,
                fried_grams=r.fried_grams,
            )
        )

    assumed = source == "assumed"
    per = NutrientAmounts(
        kcal=total.kcal / servings,
        protein_g=total.protein_g / servings,
        carbs_g=total.carbs_g / servings,
        fat_g=total.fat_g / servings,
        fibre_g=total.fibre_g / servings,
    )
    top = sorted((r for r in rows if r.kcal > 0), key=lambda r: r.kcal, reverse=True)
    drivers = [
        Driver(
            ingredient_id=r.ing.id,
            text=f"{line_text(r.ing)} ≈ {round(r.kcal, -1):.0f} kcal",
            basis=r.basis,
            kcal=r.kcal,
        )
        for r in top[:DRIVER_COUNT]
    ]
    optional_rows = [r for r in rows if r.excluded == "optional"]
    computable = [r for r in optional_rows if r.potential_kcal is not None]
    extras_kcal = (
        sum(r.potential_kcal or 0.0 for r in computable) / servings if computable else None
    )
    confidence, guard_demoted = _label_official(rows, assumed)
    return RecipeNutrition(
        nutrition_version=NUTRITION_VERSION,
        computed_at=computed_at,
        servings_basis=servings,
        servings_basis_source=source,
        yield_pieces=yield_pieces,
        per_serving=per,
        total=total,
        confidence=confidence,
        confidence_v2=_label(rows, assumed),
        guard_demoted=guard_demoted,
        optional_extras_kcal_per_serving=extras_kcal,
        optional_extras_unmatched=[
            line_text(r.ing) for r in optional_rows if r.potential_kcal is None
        ],
        drivers=drivers,
        rows=out,
        sources=[SOURCE_LABEL] if any(r.food for r in rows) else [],
        diet=derive_diet(out, table),
        diet_foods_version=table.foods_version,
    )
