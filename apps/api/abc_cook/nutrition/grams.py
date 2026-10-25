"""Grams for one ingredient line, in a fixed order (b2-plan Step 3).

1. Metric arithmetic: g, kg, oz, lb directly; ml and l through the food's density.
2. A gram hint written in the line ("Tablespoon (10gm)", "1½ (700g)"), always the TOTAL for the
   line unless it says "each" / "per piece" (Amendment 2).
3. The fixed spoon / cup / katori / glass / pinch table, converted through the food's own FDC cup,
   tablespoon or teaspoon portion when it has one, else millilitres times density.
4. FDC portion weights for counts and size words ("2 medium onions", "3 cloves").
5. Otherwise `needs_llm`: the caller may ask the model for an estimate (basis `estimated`).

Pure: no I/O, no LLM. Ranges resolve to their midpoint and the basis drops to `estimated`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from abc_cook.extract.quantity import VULGAR_FRACTIONS
from abc_cook.extract.units import CANONICAL_UNITS
from abc_cook.nutrition.foods import Food, FoodPortion
from abc_cook.schema.ingredient import Ingredient
from abc_cook.schema.nutrition import GramsBasis, HintReading, LineFlag, PortionRef

ML_PER_UNIT: dict[str, float] = {
    "tsp": 5.0,
    "tbsp": 15.0,
    "cup": 240.0,  # an Indian metric cup is 250 ml, about 4% more
    "katori": 150.0,
    "glass": 250.0,
}
"""The fixed volume table. Stated, not looked up, so every figure is reviewable."""

PINCH_GRAMS = 0.36
METRIC_GRAMS: dict[str, float] = {"g": 1.0, "kg": 1000.0, "oz": 28.3495, "lb": 453.592}
METRIC_ML: dict[str, float] = {"ml": 1.0, "l": 1000.0}
HINT_CONFLICT_RATIO = 3.0

_VULGAR = "".join(VULGAR_FRACTIONS)
_NUM = rf"(?:\d+\s+\d+\s*/\s*\d+|\d*\s?[{_VULGAR}]|\d+\s*/\s*\d+|\d+(?:\.\d+)?)"
_DASHES = chr(0x2013) + chr(0x2014)
_AMOUNT_RE = re.compile(
    rf"\s*(?:(?:about|approx\.?|approximately|around|roughly|~)\s*)?(?P<n1>{_NUM})(?:st|nd|rd|th)?"
    rf"(?:\s*(?:-|[{_DASHES}]|to)\s*(?P<n2>{_NUM})(?:st|nd|rd|th)?)?",
    re.IGNORECASE,
)
_PLUS_RE = re.compile(rf"\s*(?:(?P<u>[a-z]+)\.?\s*)?\+\s*(?P<n>{_NUM})", re.IGNORECASE)
_NEXT_WORD_RE = re.compile(r"\s*([a-z]+)", re.IGNORECASE)
_ARTICLE_RE = re.compile(r"\s*(?:a|an|one)\s+(?=\w)", re.IGNORECASE)
_HINT_RE = re.compile(
    rf"(?<![\w.])(?P<a>\d+(?:\.\d+)?)(?:\s*(?:-|[{_DASHES}]|to)\s*(?P<b>\d+(?:\.\d+)?))?\s*"
    r"(?P<unit>kg|g|gm|gms|gram|grams|ml|l|lt|lts|ltr|litre|litres|liter|liters)\b",
    re.IGNORECASE,
)
_LITRE_WORDS = {"l", "lt", "lts", "ltr", "litre", "litres", "liter", "liters"}
_PER_UNIT_RE = re.compile(r"\b(?:each|per|a piece)\b|/\s*(?:piece|pc|pcs)\b", re.IGNORECASE)
_WORD_RE = re.compile(r"[a-z]+")
_SIZES = ("small", "medium", "large")
_FILLER = {"us", "uk", "level", "heaped", "heaping", "rounded", "packed", "big", "of", "a", "an"}
_COUNT_NOUNS = {
    "clove": "clove",
    "cloves": "clove",
    "sprig": "sprig",
    "sprigs": "sprig",
    "slice": "slice",
    "slices": "slice",
    "leaf": "leaf",
    "leaves": "leaf",
    "stalk": "stalk",
    "stalks": "stalk",
    "piece": "piece",
    "pieces": "piece",
    "pod": "pod",
    "pods": "pod",
    "whole": "whole",
}


@dataclass(frozen=True)
class Amount:
    """A parsed quantity: the value used (a range's midpoint) and the text after it."""

    value: float
    high: float | None
    rest: str

    @property
    def is_range(self) -> bool:
        """Whether the source gave a range ("2 to 3")."""
        return self.high is not None


@dataclass(frozen=True)
class GramsResult:
    """Grams for a line and how they were reached."""

    grams: float | None
    basis: GramsBasis
    flags: tuple[LineFlag, ...] = ()
    hint_reading: HintReading | None = None
    portion: PortionRef | None = None
    needs_llm: bool = False


def _to_float(token: str) -> float:
    token = token.strip()
    if m := re.fullmatch(r"(\d+)\s+(\d+)\s*/\s*(\d+)", token):
        whole, num, den = (int(g) for g in m.groups())
        return whole + num / den
    if m := re.fullmatch(rf"(\d*)\s?([{_VULGAR}])", token):
        return (int(m.group(1)) if m.group(1) else 0) + VULGAR_FRACTIONS[m.group(2)]
    if m := re.fullmatch(r"(\d+)\s*/\s*(\d+)", token):
        return int(m.group(1)) / int(m.group(2))
    return float(token)


def parse_amount(qty_text: str | None, qty: float | None) -> tuple[Amount | None, bool]:
    """The leading amount of a quantity text, and whether the text was garbled.

    "1 + ½ cup (300 ml)" sums to 1.5; "2 to 3 tbsp" is a range (midpoint 2.5). A number
    followed by a digit or a tab (a butter line that read "30 TAB 39 40g") is garbled: no
    amount, flagged.
    """
    text = (qty_text or "").strip()
    if not text:
        return (Amount(qty, None, ""), False) if qty is not None and qty > 0 else (None, False)
    if m := _ARTICLE_RE.match(text):
        rest = text[m.end() :]
        if rest and _first_unit_word(rest):
            return Amount(1.0, None, rest), False
    m = _AMOUNT_RE.match(text)
    if m is None:
        return None, False
    low = _to_float(m.group("n1"))
    high = _to_float(m.group("n2")) if m.group("n2") else None
    if high is not None and high <= low:
        high = None
    pos = m.end()
    while plus := _PLUS_RE.match(text, pos):
        # "1 tbsp + 1 tbsp" sums; "1 tbsp + 1 cup" (or a unit we do not know) is ambiguous.
        first_unit = CANONICAL_UNITS.get((plus.group("u") or "").lower())
        if plus.group("u"):
            second = _NEXT_WORD_RE.match(text, plus.end())
            second_unit = CANONICAL_UNITS.get(second.group(1).lower()) if second else None
            if first_unit is None or second_unit != first_unit:
                return None, True
        extra = _to_float(plus.group("n"))
        low += extra
        high = high + extra if high is not None else None
        pos = plus.end()
    rest = text[pos:]
    if re.match(r"\s*[\d\t]", rest) or low <= 0:
        return None, True
    value = low if high is None else (low + high) / 2
    return Amount(value, high, rest), False


def _first_unit_word(text: str) -> str | None:
    """The first canonical unit word in `text` before any "(" or "/" (skipping fillers)."""
    for word in _unit_words(text):
        if word in CANONICAL_UNITS:
            return CANONICAL_UNITS[word]
        if word not in _SIZES and word not in _FILLER:
            return None
    return None


def _unit_words(text: str) -> list[str]:
    head = re.split(r"[(/]", text.lower(), maxsplit=1)[0]
    return _WORD_RE.findall(head)


@dataclass(frozen=True)
class _UnitInfo:
    canonical: str | None
    noun: str | None
    sizes: tuple[str, ...]


def _unit_info(ing: Ingredient, rest: str) -> _UnitInfo:
    """The unit, a count noun ("cloves"), and size words from the unit field, amount text, name."""
    canonical: str | None = None
    noun: str | None = None
    for text in (ing.unit or "", rest):
        for word in _unit_words(text):
            if word in CANONICAL_UNITS:
                canonical = CANONICAL_UNITS[word]
                break
            if word in _COUNT_NOUNS:
                noun = _COUNT_NOUNS[word]
                break
            if word not in _SIZES and word not in _FILLER:
                break
        if canonical or noun:
            break
    name_head = re.sub(r"\([^)]*\)", " ", ing.name.lower())
    name_words = _WORD_RE.findall(name_head)
    if noun is None and canonical in (None, "count") and name_words:
        noun = _COUNT_NOUNS.get(name_words[-1])
    haystack = " ".join([(ing.unit or "").lower(), rest.lower(), *name_words[:2]])
    sizes = tuple(s for s in _SIZES if re.search(rf"\b{s}\b", haystack))
    return _UnitInfo(canonical, noun, sizes)


def density(food: Food | None) -> float:
    """Grams per millilitre from the food's own cup, tablespoon or teaspoon portion, else 1.0."""
    if food is not None:
        for unit in ("cup", "tbsp", "tsp"):
            for portion in food.portions:
                if portion.unit == unit and portion.grams > 0:
                    return portion.grams / ML_PER_UNIT[unit]
    return 1.0


def _tiebreak(candidates: list[FoodPortion], prep_words: set[str]) -> FoodPortion:
    """Several rows of one unit: the prep match, else the most generic, else the first."""
    best = max(candidates, key=lambda p: len(prep_words & set(re.findall(r"[a-z]+", p.prep))))
    if prep_words & set(re.findall(r"[a-z]+", best.prep)):
        return best
    generic = [p for p in candidates if p.prep in ("", "whole")]
    return generic[0] if generic else candidates[0]


def _pick_portion(food: Food, units: list[str], prep_words: set[str]) -> FoodPortion | None:
    for unit in units:
        candidates = [p for p in food.portions if p.unit == unit]
        if candidates:
            return _tiebreak(candidates, prep_words)
    return None


def _prep_words(ing: Ingredient) -> set[str]:
    """Every word of the name and note; a portion's prep ("chopped") matches against these."""
    return set(_WORD_RE.findall(f"{ing.name} {ing.prep_note or ''}".lower()))


def _convert(
    amount: Amount, info: _UnitInfo, food: Food | None, ing: Ingredient
) -> tuple[float | None, GramsBasis, PortionRef | None]:
    """Metric arithmetic, then the table, then FDC portions. (None, ...) when none applies."""
    unit = info.canonical
    if unit in METRIC_GRAMS:
        return amount.value * METRIC_GRAMS[unit], "stated", None
    if unit in METRIC_ML:
        return amount.value * METRIC_ML[unit] * density(food), "stated", None
    if unit == "pinch":
        return amount.value * PINCH_GRAMS, "table", None
    prep_words = _prep_words(ing)
    if unit in ML_PER_UNIT:
        if food is not None and unit in ("tsp", "tbsp", "cup"):
            portion = _pick_portion(food, [unit], prep_words)
            if portion is not None:
                return amount.value * portion.grams, "table", _ref(portion)
        return amount.value * ML_PER_UNIT[unit] * density(food), "table", None
    if food is None:
        return None, "missing", None
    size = info.sizes[0] if info.sizes else None
    wanted: list[str] = []
    if info.noun:
        wanted.append(info.noun)
    if size:
        wanted.append(size)
    # A named noun ("sprigs") that the food has no portion for is not turned into a medium one;
    # "whole" and "piece" name no particular part, so they keep the size fallback.
    if unit in (None, "count") and info.noun in (None, "whole", "piece"):
        wanted += ["medium", "piece", "whole", "fruit"]
    if not wanted:
        return None, "missing", None
    portion = _pick_portion(food, wanted, prep_words)
    if portion is None:
        return None, "missing", None
    return amount.value * portion.grams, "table", _ref(portion)


def _ref(portion: FoodPortion) -> PortionRef:
    return PortionRef(
        unit=portion.unit, prep=portion.prep, grams=portion.grams, raw_modifier=portion.raw_modifier
    )


@dataclass(frozen=True)
class _Hint:
    grams: float
    per_unit: bool
    is_range: bool


def _find_hint(ing: Ingredient, rest: str, food: Food | None) -> _Hint | None:
    """The one gram or millilitre figure written in the line, or None (none, or more than one)."""
    found: list[tuple[re.Match[str], str]] = []
    for text in (ing.unit or "", rest, ing.name, ing.prep_note or ""):
        found += [(m, text) for m in _HINT_RE.finditer(text)]
    if len(found) != 1:
        return None
    match, text = found[0]
    low = float(match.group("a"))
    high = float(match.group("b")) if match.group("b") else None
    value = low if high is None else (low + high) / 2
    unit = match.group("unit").lower()
    if unit == "ml":
        factor = density(food)
    elif unit == "kg":
        factor = 1000.0
    elif unit in _LITRE_WORDS:
        factor = 1000.0 * density(food)
    else:
        factor = 1.0
    per_unit = bool(_PER_UNIT_RE.search(text[match.end() : match.end() + 24]))
    return _Hint(value * factor, per_unit, high is not None)


def line_grams(ing: Ingredient, food: Food | None) -> GramsResult:
    """Grams for `ing` matched to `food` (None when unmatched; metric lines still resolve)."""
    amount, garbled = parse_amount(ing.qty_text, ing.qty)
    if garbled:
        return GramsResult(None, "missing", ("unparseable_amount",), needs_llm=True)
    rest = amount.rest if amount else (ing.qty_text or "")
    hint = _find_hint(ing, rest, food)
    if amount is None:
        if hint is not None:  # "water (750 ml)" with no leading number: the hint is the amount
            flags: tuple[LineFlag, ...] = ("range_midpoint",) if hint.is_range else ()
            return GramsResult(hint.grams, "estimated" if hint.is_range else "stated", flags)
        return GramsResult(None, "missing")
    info = _unit_info(ing, rest)
    flags_list: list[LineFlag] = ["range_midpoint"] if amount.is_range else []
    grams: float | None
    basis: GramsBasis
    portion: PortionRef | None = None
    reading: HintReading | None = None
    metric = info.canonical in METRIC_GRAMS or info.canonical in METRIC_ML
    if metric or hint is None:
        grams, basis, portion = _convert(amount, info, food, ing)
    else:
        reading = "per_unit" if hint.per_unit else "total"
        grams = hint.grams * (amount.value if hint.per_unit else 1.0)
        basis = "stated"
        if hint.is_range and "range_midpoint" not in flags_list:
            flags_list.append("range_midpoint")
        alt, _alt_basis, _alt_portion = _convert(amount, info, food, ing)
        if alt and grams and max(grams / alt, alt / grams) > HINT_CONFLICT_RATIO:
            flags_list.append("hint_conflict")
    if grams is None:
        return GramsResult(None, "missing", tuple(flags_list), needs_llm=True)
    if "range_midpoint" in flags_list:
        basis = "estimated"
    return GramsResult(grams, basis, tuple(flags_list), reading, portion)
