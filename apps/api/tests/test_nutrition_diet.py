"""`derive_diet`: non_veg beats egg beats veg; anything unclassifiable gives None."""

from __future__ import annotations

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
