"""R3: `parse_amount` -- a structured, scalable quantity parsed from an ingredient line.

One parametrised row per row of the plan's Step 2B table (`docs/plans/r3-quantities.md`), plus
the owner's package-size rule (A1). The contract is "never guess": anything the parser is not
sure of is `None`, and the line then renders exactly as the source wrote it.

Every recipe here is synthetic or read from the frozen fixtures; no recipe name is in logic.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path

import pytest

from abc_cook.extract.graph import build_graph
from abc_cook.extract.postprocess import reprocess
from abc_cook.extract.quantity import parse_amount
from abc_cook.schema import QtyAmount
from abc_cook.schema.graph import SourceRef
from abc_cook.schema.normalized import (
    ImportOriginal,
    NormalizedIngredient,
    NormalizedRecipe,
    NormalizedStep,
)

FIXTURES = Path(__file__).parent / "fixtures"
VULGAR = "¼½¾⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞"


def amount(low: float, high: float | None = None, prefix: str = "", rest: str = "") -> QtyAmount:
    return QtyAmount(low=low, high=high, prefix=prefix, rest=rest)


# (qty_text, unit, expected)
SCALABLE = [
    # exact numbers
    ("2", "medium", amount(2)),
    ("12", None, amount(12)),
    ("1.5", None, amount(1.5)),
    ("3/4", "tsp", amount(0.75)),
    ("3 / 4", "tsp", amount(0.75)),
    ("1 1/2", "cups", amount(1.5)),
    ("1 ½", "cups", amount(1.5)),
    ("1½", None, amount(1.5)),
    ("½", "tsp", amount(0.5)),
    ("⅔", "cup", amount(2 / 3)),
    ("2 ¼", None, amount(2.25)),
    # "1-1/2" is mixed (today's _parse_qty), not a range: a range would run backwards (Q1)
    ("1-1/2", "cups", amount(1.5)),
    ("1&1/2", "cups", amount(1.5)),
    ("1& 1/2", "cups", amount(1.5)),
    # ranges
    ("2-3", None, amount(2, 3)),
    (f"2{chr(0x2013)}3", None, amount(2, 3)),  # en dash, ASCII-safe in source (RUF001)
    ("2 to 3", None, amount(2, 3)),
    ("2-3 medium", None, amount(2, 3, rest=" medium")),
    ("1 1/2 to 2 cups", None, amount(1.5, 2, rest=" cups")),
    ("8-10 pieces", None, amount(8, 10, rest=" pieces")),
    ("4-5", "cups", amount(4, 5)),
    ("½-1", "tsp", amount(0.5, 1)),
    # the unit inside the quantity text
    ("250g", None, amount(250, rest="g")),
    ("1 cup", "cup", amount(1, rest=" cup")),
    ("1 tbsp", None, amount(1, rest=" tbsp")),
    # approximate words kept verbatim
    ("about 2", None, amount(2, prefix="about ")),
    ("~2", None, amount(2, prefix="~")),
    ("approx. 2", "cups", amount(2, prefix="approx. ")),
    ("लगभग 2", None, amount(2, prefix="लगभग ")),
    # whole packets are a count, not a package size (A1)
    ("2 packets", None, amount(2, rest=" packets")),
    ("2", "packet", amount(2)),
    ("1 can", None, amount(1, rest=" can")),
]

UNSCALABLE = [
    # vague or no number
    ("to taste", None),
    ("to taste", "to taste"),
    ("a pinch", None),
    ("a handful", None),
    ("taste hisab se", None),
    ("(washing aur soaking ke lie)", None),
    ("", None),
    (None, None),
    ("   ", None),
    # a second amount (Q2): the whole line stays as written
    ("2 (2 tsp minced)", None),
    ("1 tbsp + 1 tsp", None),
    ("¼ cup or 45", "ml"),
    ("5 tbsp (50g) for dough and 15 tbsp (150g) for filling", None),
    ("1", "Cup (200g)"),
    ("1", "gms / ½ cup"),
    ("2 or 3", None),
    ("2 or three", None),
    # nonsense
    ("0", "cup"),
    ("0.0", None),
    ("3-2", None),
    ("3-3", None),
    ("1,5", None),
    ("1/0", None),
    ("two", None),
    ("half", None),
    ("1 and 1/2", None),
    # Hindi/Hinglish words are out of R3 (left to FGC-6)
    ("आधा", "कप"),
    ("डेढ़", None),
    ("ढाई", None),
    ("सवा", None),
    ("paav", None),
    # package sizes (A1): a measure unit followed by a container word
    ("15 oz can", None),
    ("15", "oz can"),
    ("1 can (400 g)", None),
    ("400 g tin", None),
    ("2", "ml bottles"),
    ("1 lb pack", None),
]


@pytest.mark.parametrize(("qty_text", "unit", "expected"), SCALABLE)
def test_parse_amount_scalable(qty_text: str, unit: str | None, expected: QtyAmount) -> None:
    got = parse_amount(qty_text, unit)
    assert got is not None
    assert got.model_dump() == pytest.approx(expected.model_dump())


@pytest.mark.parametrize(("qty_text", "unit"), UNSCALABLE)
def test_parse_amount_unscalable(qty_text: str | None, unit: str | None) -> None:
    assert parse_amount(qty_text, unit) is None


def test_prefix_and_rest_round_trip_the_source_text() -> None:
    got = parse_amount("approx. 2 medium", None)
    assert got is not None
    assert got.prefix == "approx. "
    assert got.rest == " medium"


def test_range_has_high_above_low() -> None:
    got = parse_amount("2-3", None)
    assert got is not None
    assert got.high is not None
    assert got.high > got.low


# --- corpus property test -----------------------------------------------------------------------


def corpus_lines() -> list[tuple[str, str | None, str | None]]:
    """(fixture, qty_text, unit) for every ingredient line in a frozen import fixture."""
    lines: list[tuple[str, str | None, str | None]] = []
    for path in sorted((FIXTURES / "import").rglob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            continue
        recipe = data.get("recipe", data)
        if not isinstance(recipe, dict) or not isinstance(recipe.get("ingredients"), list):
            continue
        for ing in recipe["ingredients"]:
            if isinstance(ing, dict) and "name" in ing:
                lines.append((path.name, ing.get("qty"), ing.get("unit")))
    for path in sorted((FIXTURES / "stream").rglob("*.normalized.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        for ing in data.get("ingredients", []):
            lines.append((path.name, ing.get("qty"), ing.get("unit")))
    # Hand-authored graphs hold built `Ingredient`s: their text is `qty_text` (absent on goldens
    # that predate it, which then have no text to parse).
    for path in sorted(FIXTURES.glob("*.graph.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        for ing in data.get("ingredients", []):
            lines.append((path.name, ing.get("qty_text"), ing.get("unit")))
    return lines


def test_corpus_is_not_empty() -> None:
    assert len(corpus_lines()) >= 200


@pytest.mark.parametrize(
    ("fixture", "qty_text", "unit"),
    corpus_lines(),
)
def test_corpus_property(fixture: str, qty_text: str | None, unit: str | None) -> None:
    got = parse_amount(qty_text, unit)
    if qty_text is None or not qty_text.strip():
        assert got is None
        return
    if unit is not None and re.search(rf"[\d{VULGAR}]", unit):
        assert got is None
    if got is None:
        return
    assert got.low > 0
    if got.high is not None:
        assert got.high > got.low
    assert not re.search(rf"[\d{VULGAR}]", got.rest)
    # the pieces put back together are the source text (prefix, number(s), rest)
    assert qty_text.strip().startswith(got.prefix)
    assert qty_text.strip().endswith(got.rest)


# --- wiring: build_graph and reprocess ----------------------------------------------------------


def _recipe(ingredients: list[NormalizedIngredient]) -> NormalizedRecipe:
    return NormalizedRecipe(
        title="Synthetic",
        method_grounded=True,
        servings=2,
        ingredients=ingredients,
        steps=[
            NormalizedStep(
                text="Cook everything.",
                attention="hands_on",
                duration_stated=False,
                consumes_ingredients=[i.name for i in ingredients],
                station="burner",
                interruptible=False,
                freshness="none",
            )
        ],
    )


def test_build_graph_sets_qty_amount_and_keeps_the_old_fields() -> None:
    recipe = _recipe(
        [
            NormalizedIngredient(name="Alpha", qty="2", unit="medium", prep_note=None),
            NormalizedIngredient(name="Beta", qty="1 1/2", unit="cups", prep_note=None),
            NormalizedIngredient(name="Gamma", qty="to taste", unit=None, prep_note=None),
            NormalizedIngredient(name="Delta", qty=None, unit=None, prep_note=None),
        ]
    )
    text = "Synthetic. Cook everything."
    source = SourceRef(kind="text", value=text, imported_at=datetime(2026, 1, 1, tzinfo=UTC))
    result = build_graph(recipe, text, graph_id="g_synthetic_qty", source=source)
    assert result.graph is not None
    by_name = {i.name: i for i in result.graph.ingredients}
    assert by_name["Alpha"].qty_amount == amount(2)
    assert by_name["Alpha"].qty == 2.0
    assert by_name["Alpha"].qty_text == "2"
    assert by_name["Beta"].qty_amount == amount(1.5)
    assert by_name["Gamma"].qty_amount is None
    assert by_name["Delta"].qty_amount is None


def test_reprocess_fills_qty_amount_for_a_saved_original() -> None:
    path = next((FIXTURES / "import").glob("*.original.json"))
    original = ImportOriginal.model_validate_json(path.read_text(encoding="utf-8"))
    graph = reprocess(original).result.graph
    assert graph is not None
    plain = [i for i in graph.ingredients if i.qty_text and re.fullmatch(r"\d+", i.qty_text)]
    assert plain, "the fixture should have a plain-integer line"
    assert all(i.qty_amount is not None for i in plain)
    assert all(i.qty_amount.low == float(i.qty_text or 0) for i in plain if i.qty_amount)


def test_old_ingredient_json_without_the_field_still_validates() -> None:
    from abc_cook.schema import Ingredient

    ing = Ingredient.model_validate(
        {"id": "ing_x", "name": "X", "qty": 1.0, "unit": "cup", "prep_note": None, "group": None}
    )
    assert ing.qty_amount is None


def test_measure_units_all_have_a_class_in_the_web_vocabulary() -> None:
    """`quantity.py` and `scaleQuantity.ts` each hold a unit list; they must not drift apart."""
    from abc_cook.extract.quantity import MEASURE_UNITS

    source = (FIXTURES.parents[2] / "web" / "src" / "lib" / "scaleQuantity.ts").read_text(
        encoding="utf-8"
    )
    block = source.split("const UNIT_CLASSES", 1)[1].split("\n}\n", 1)[0]
    web_units = set(re.findall(r"^\s+(\w+): '(?:metricSmall|metricLarge|spoonCup)'", block, re.M))
    assert web_units, "could not read UNIT_CLASSES from scaleQuantity.ts"
    assert MEASURE_UNITS - web_units == set()
    assert web_units - MEASURE_UNITS == set()
