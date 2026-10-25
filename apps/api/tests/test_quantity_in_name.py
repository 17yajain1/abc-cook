"""extract/quantity.py `split_amount_from_name`: amounts the model left inside the name (v16).

The cases are real ingredient lines from the 3a eval set (rajma, pav bhaji, chicken 65,
chana chaat), plus the guards that keep a name like "5-spice powder" or "2% milk" alone.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from abc_cook.extract.graph import build_graph
from abc_cook.extract.quantity import is_garbled_amount, split_amount_from_name
from abc_cook.schema.graph import SourceRef
from abc_cook.schema.normalized import NormalizedIngredient, NormalizedRecipe, NormalizedStep


@pytest.mark.parametrize(
    ("name", "qty_text", "low", "rest", "remaining"),
    [
        ("½ cup peas", "½ cup", 0.5, " cup", "peas"),
        ("¼ cup peas / matar", "¼ cup", 0.25, " cup", "peas / matar"),
        ("2  potato (boiled & mashed)", "2", 2.0, "", "potato (boiled & mashed)"),
        (
            "1 cup rajma ((200 grams dry kidney beans))",
            "1 cup",
            1.0,
            " cup",
            "rajma ((200 grams dry kidney beans))",
        ),
        (
            "1½ cups (2 large, 300 grams) tomatoes",
            "1½ cups",
            1.5,
            " cups",
            "(2 large, 300 grams) tomatoes",
        ),
        ("1½ teaspoon ginger garlic paste", "1½ teaspoon", 1.5, " teaspoon", "ginger garlic paste"),
        ("Chicken boneless (thigh) 750 gm", "750 gm", 750.0, " gm", "Chicken boneless (thigh)"),
    ],
)
def test_amount_moves_out_of_the_name(
    name: str, qty_text: str, low: float, rest: str, remaining: str
) -> None:
    got = split_amount_from_name(name, None, None)
    assert got.changed
    assert got.qty_text == qty_text
    assert got.name == remaining
    assert got.amount is not None
    assert (got.amount.low, got.amount.rest) == (low, rest)


def test_range_in_the_name() -> None:
    got = split_amount_from_name("2 to 3 tablespoons ghee", None, None)
    assert (got.qty_text, got.name) == ("2 to 3 tablespoons", "ghee")
    assert got.amount is not None
    assert (got.amount.low, got.amount.high) == (2.0, 3.0)


@pytest.mark.parametrize(
    ("name", "text", "total", "rest", "remaining"),
    [
        ("1 tbsp + 1 tbsp butter", "1 tbsp + 1 tbsp", 2.0, " tbsp", "butter"),
        (
            "1 tsp + ¼ tsp kashmiri red chilli powder",
            "1 tsp + ¼ tsp",
            1.25,
            " tsp",
            "kashmiri red chilli powder",
        ),
        (
            "2 tbsp + 1 tbsp coriander leaves (finely chopped)",
            "2 tbsp + 1 tbsp",
            3.0,
            " tbsp",
            "coriander leaves (finely chopped)",
        ),
    ],
)
def test_a_plus_b_same_unit_is_summed_and_verbatim(
    name: str, text: str, total: float, rest: str, remaining: str
) -> None:
    got = split_amount_from_name(name, None, None)
    assert got.qty_text == text
    assert got.name == remaining
    assert got.amount is not None
    assert (got.amount.low, got.amount.rest) == (total, rest)


def test_a_plus_b_with_mixed_units_is_left_alone() -> None:
    got = split_amount_from_name("1 tbsp + 1 cup stock", None, None)
    assert not got.changed
    assert (got.name, got.qty_text, got.amount) == ("1 tbsp + 1 cup stock", None, None)


@pytest.mark.parametrize(
    ("name", "qty_text", "unit", "remaining"),
    [
        ("½ cup dried chickpeas (or canned)", "½ cup", None, "dried chickpeas (or canned)"),
        ("1 onion (small, chopped finely)", "1", None, "onion (small, chopped finely)"),
        ("1 to 2 green chili (chopped)", "1 to 2", None, "green chili (chopped)"),
        ("1 small potato (diced)", "1", "small", "potato (diced)"),
        ("2 tablespoons curd (/ dahi)", "2", "tablespoons", "curd (/ dahi)"),
        ("Ginger garlic paste 2 tbsp", "2 tbsp", None, "Ginger garlic paste"),
        ("Curry leaves 2 tbsp (chopped)", "2 tbsp", None, "Curry leaves (chopped)"),
        ("Curd 1/4th cup", "1/4th cup", None, "Curd"),
        ("Curry leaves 20-25 nos.", "20-25 nos.", None, "Curry leaves"),
        ("salt and pepper (to taste)", "to taste", None, "salt and pepper"),
    ],
)
def test_repeated_amount_is_stripped_from_the_name_only(
    name: str, qty_text: str, unit: str | None, remaining: str
) -> None:
    got = split_amount_from_name(name, qty_text, unit)
    assert got.changed
    assert got.name == remaining
    assert got.qty_text == qty_text
    assert got.amount is None  # the caller parses the unchanged qty_text as before


def test_bare_number_before_a_unit_word_is_not_stripped() -> None:
    got = split_amount_from_name("1 cup onions", "1", None)
    assert not got.changed


@pytest.mark.parametrize(
    "name",
    ["3 to  mato (finely chopped)", "3 to mato"],
)
def test_garbled_text_is_left_alone_and_counted(name: str) -> None:
    got = split_amount_from_name(name, None, None)
    assert not got.changed
    assert got.name == name
    assert is_garbled_amount(name)


@pytest.mark.parametrize(
    "name",
    [
        "Salt to taste",
        "Few Ginger juliennes",
        "No 5 spaghetti",
        "5-spice powder",
        "2% milk",
        "water to adjust consistency",
        "tomatoes",
        "1 tomato to garnish",
    ],
)
def test_no_certain_amount_is_unchanged(name: str) -> None:
    got = split_amount_from_name(name, None, None)
    if name.startswith("1 tomato"):
        assert got.qty_text == "1"  # a plain leading count is still certain
        return
    assert not got.changed
    assert (got.name, got.qty_text, got.amount) == (name, None, None)
    assert not is_garbled_amount(name)


def test_ids_stay_stable_and_amount_is_structured() -> None:
    def build(name: str) -> object:
        recipe = NormalizedRecipe(
            title="Test",
            method_grounded=True,
            ingredients=[NormalizedIngredient(name=name, qty=None, unit=None, prep_note=None)],
            steps=[
                NormalizedStep(
                    text="Add the butter to the pan.",
                    attention="hands_on",
                    duration_stated=False,
                    station="counter",
                    interruptible=True,
                    freshness="none",
                )
            ],
        )
        source = SourceRef(
            kind="url", value="https://example.test/r", imported_at=datetime.now(UTC)
        )
        return build_graph(recipe, "Add the butter to the pan.", graph_id="g_t", source=source)

    result = build("1 tbsp + 1 tbsp butter")
    plain = build("butter")
    ing = result.graph.ingredients[0]  # type: ignore[attr-defined]
    assert ing.name == "butter"
    assert ing.qty_text == "1 tbsp + 1 tbsp"
    assert ing.qty == 2.0
    assert ing.qty_amount is not None
    assert ing.qty_amount.low == 2.0
    assert ing.unit_canonical == "tbsp"
    # the id comes from the original name, so it is the id the model's own name produced
    assert ing.id == "ing_1_tbsp_1"
    assert plain.graph.ingredients[0].id == "ing_butter"  # type: ignore[attr-defined]
