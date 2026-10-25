"""Diet derivation from the matched foods (part-a-plan §7).

Its own pure function, independent of `NUTRITION_VERSION`: a `foods.json` update can re-derive
the diet on its own, because the result records the `foods_version` it came from.
"""

from __future__ import annotations

from abc_cook.nutrition.foods import FoodTable
from abc_cook.schema.nutrition import Diet, IngredientNutrition


def derive_diet(rows: list[IngredientNutrition], table: FoodTable) -> Diet | None:
    """`non_veg` beats `egg`, which beats `veg`; None when any line cannot be classified.

    Any unmatched line (including an optional or to-taste one), or any food whose veg flag is
    `unknown`, gives None: the diet is never guessed, and never reported veg on partial data.
    """
    seen: set[str] = set()
    for row in rows:
        if row.food is None:
            return None
        food = table.get(row.food.food_id)
        if food is None or food.veg == "unknown":
            return None
        seen.add(food.veg)
    if not seen:
        return None
    if "non_veg" in seen:
        return "non_veg"
    if "egg" in seen:
        return "egg"
    return "veg"
