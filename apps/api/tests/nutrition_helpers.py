"""Small builders shared by the nutrition tests: a synthetic food table and ingredient lines."""

from __future__ import annotations

from typing import Any

from abc_cook.nutrition.foods import FoodTable
from abc_cook.schema.ingredient import Ingredient


def food(
    food_id: str,
    name: str,
    *,
    group: str = "Vegetables and Vegetable Products",
    veg: str = "veg",
    kcal: float = 100.0,
    protein: float = 0.0,
    carbs: float = 0.0,
    fat: float = 0.0,
    fibre: float = 0.0,
    aliases: list[str] | None = None,
    portions: list[tuple[str, str, float]] | None = None,
    reviewed: bool = False,
) -> dict[str, Any]:
    """A `foods.json` food entry; `reviewed` marks all its aliases as owner-reviewed."""
    return {
        "id": food_id if ":" in food_id else f"fdc:{food_id}",
        "name": name,
        "aliases": [{"alias": a, "source": "test", "reviewed": reviewed} for a in aliases or []],
        "food_group": group,
        "veg": veg,
        "divisible": True,
        "kcal": kcal,
        "protein_g": protein,
        "carbs_g": carbs,
        "fat_g": fat,
        "fibre_g": fibre,
        "portions": [
            {"unit": unit, "prep": prep, "grams": grams, "raw_modifier": f"{unit}, {prep}"}
            for unit, prep, grams in portions or []
        ],
    }


def table(*foods: dict[str, Any], **extra: Any) -> FoodTable:
    """A `FoodTable` of the given foods; `extra` adds document keys (`no_food`, ...)."""
    return FoodTable.from_document({"foods_version": "test-1", "foods": list(foods), **extra})


def line(
    name: str,
    qty_text: str | None = None,
    unit: str | None = None,
    *,
    prep_note: str | None = None,
    ing_id: str | None = None,
) -> Ingredient:
    """An ingredient line as the graph builder would produce it."""
    return Ingredient(
        id=ing_id or "ing_" + name.lower().replace(" ", "_")[:20],
        name=name,
        qty=None,
        qty_text=qty_text,
        unit=unit,
        prep_note=prep_note,
        group=None,
    )
