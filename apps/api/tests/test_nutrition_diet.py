"""`derive_diet`: non_veg beats egg beats veg; anything unclassifiable gives None."""

from __future__ import annotations

import pytest
from nutrition_helpers import food, table

from abc_cook.nutrition.diet import derive_diet
from abc_cook.schema.nutrition import FoodRef, IngredientNutrition

TABLE = table(
    food("1", "Onions, raw", veg="veg"),
    food("2", "Egg, whole, raw, fresh", veg="egg"),
    food("3", "Chicken, raw", veg="non_veg"),
    food("4", "Sugars, granulated", veg="unknown"),
)


def _row(food_id: str | None, index: int = 0) -> IngredientNutrition:
    ref = FoodRef(food_id=food_id, name="x", foods_version="test-1") if food_id else None
    return IngredientNutrition(
        ingredient_id=f"ing_{index}",
        ingredient_index=index,
        line_text="x",
        food=ref,
        grams_basis="stated" if food_id else "unmatched",
    )


def test_all_veg() -> None:
    assert derive_diet([_row("fdc:1")], TABLE) == "veg"


def test_egg_beats_veg() -> None:
    assert derive_diet([_row("fdc:1"), _row("fdc:2", 1)], TABLE) == "egg"


def test_non_veg_beats_egg() -> None:
    assert derive_diet([_row("fdc:2"), _row("fdc:3", 1), _row("fdc:1", 2)], TABLE) == "non_veg"


def test_any_unmatched_line_gives_none() -> None:
    assert derive_diet([_row("fdc:1"), _row(None, 1)], TABLE) is None
    assert derive_diet([_row("fdc:3"), _row(None, 1)], TABLE) is None


def test_a_food_with_no_veg_flag_gives_none() -> None:
    assert derive_diet([_row("fdc:1"), _row("fdc:4", 1)], TABLE) is None


def test_no_rows_gives_none() -> None:
    assert derive_diet([], TABLE) is None


def _unmatched(text: str, index: int = 1) -> IngredientNutrition:
    row = _row(None, index)
    return row.model_copy(update={"line_text": text})


@pytest.mark.parametrize(
    "text",
    [
        "10 curry leaves",
        "1 tsp Garam Masala",
        "1 tbsp pav bhaji masala",
        "2 tbsp ginger garlic paste",
        "a pinch of hing",
        "1/4 tsp asafoetida",
        "1 tbsp jaggery",
        "2 tbsp tamarind chutney",
        "2 tbsp imli chutney",
        "1 tsp chironji",
        "1 sachet Eno",
        "1/2 tsp fruit salt",
        "a pinch citric acid",
        "2 drops food colour",
        "1 tsp kasuri methi",
        "1/4 cup sev",
        "2 tbsp green chutney",
        "1 tsp italian seasoning",
        "1 small piece natural charcoal",  # dhungar smoking: no_food and veg-safe (v3)
        "1 piece charcoal",
        "1 tsp garam masala (for the chicken)",  # the parenthetical is ignored
    ],
)
def test_a_veg_safe_unmatched_line_does_not_force_none(text: str) -> None:
    assert derive_diet([_row("fdc:1"), _unmatched(text)], TABLE) == "veg"


def test_veg_safe_unmatched_lines_do_not_hide_a_non_veg_or_egg_food() -> None:
    assert derive_diet([_row("fdc:3"), _unmatched("1 tsp garam masala", 1)], TABLE) == "non_veg"
    assert derive_diet([_row("fdc:2"), _unmatched("10 curry leaves", 1)], TABLE) == "egg"


@pytest.mark.parametrize(
    "text",
    [
        "1 tbsp chicken masala paste",  # not on the list, and names a meat
        "1 tsp garam masala chicken seasoning",  # on the list, but names a meat
        "1 tbsp egg sev",  # on the list, but names an egg
        "1 tbsp oyster sauce",  # unknown unmatched
        "1 tsp mystery powder",
        "1 sevai",  # whole words only: "sev" is not "sevai"
    ],
)
def test_any_other_unmatched_line_still_gives_none(text: str) -> None:
    assert derive_diet([_row("fdc:1"), _unmatched(text)], TABLE) is None


def test_a_dal_tadka_shape_with_charcoal_and_blends_is_veg_not_none() -> None:
    # 31-shape: matched veg foods, an unmatched garam masala and the dhungar charcoal
    rows = [
        _row("fdc:1"),
        _unmatched("1 tsp garam masala", 1),
        _unmatched("1 small piece natural charcoal", 2),
    ]
    assert derive_diet(rows, TABLE) == "veg"


def test_only_veg_safe_lines_are_not_enough_to_call_a_diet() -> None:
    assert derive_diet([_unmatched("10 curry leaves", 0)], TABLE) is None
