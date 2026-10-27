"""The seed gate: which recipes are too thin to seed a public nutrition number (b35-plan Step 1).

Pure. It reads what the calculator already produced plus the import warnings, and returns the
reasons a recipe is blocked (empty = it passes). Defaulted servings do not block: they cap the
label at `estimated` instead.
"""

from __future__ import annotations

from abc_cook.schema.ingredient import Ingredient
from abc_cook.schema.nutrition import RecipeNutrition

MIN_INGREDIENT_LINES = 5
MIN_AMOUNT_SHARE = 0.80
REPAIRED_WARNING = "Graph repaired after one LLM repair pass."


def seed_gate_rejects(
    nutrition: RecipeNutrition, warnings: list[str], ingredients: list[Ingredient]
) -> list[str]:
    """Reasons this recipe may not seed, or an empty list when it passes."""
    reasons: list[str] = []
    if REPAIRED_WARNING in warnings:
        reasons.append("graph repaired")
    if len(ingredients) < MIN_INGREDIENT_LINES:
        reasons.append(f"fewer than {MIN_INGREDIENT_LINES} ingredient lines ({len(ingredients)})")
    with_amount = sum(1 for i in ingredients if i.qty is not None or (i.qty_text or "").strip())
    if ingredients and with_amount / len(ingredients) < MIN_AMOUNT_SHARE:
        reasons.append(f"only {with_amount} of {len(ingredients)} lines have an amount")
    if nutrition.confidence == "rough":
        reasons.append("confidence rough")
    return reasons
