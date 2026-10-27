"""Diet derivation from the matched foods (part-a-plan §7, b3-plan 2B).

Its own pure function, independent of `NUTRITION_VERSION`: a `foods.json` update can re-derive
the diet on its own, because the result records the `foods_version` it came from.
"""

from __future__ import annotations

import re

from abc_cook.nutrition.foods import FoodTable
from abc_cook.schema.nutrition import Diet, IngredientNutrition

# Unmatched lines that are vegetarian by what they are (b3-plan 2B). "veg" means vegetarian
# (dairy allowed), not vegan. Whole-word, case-insensitive. Fixed before the holdout render.
VEG_SAFE_PHRASES = (
    "curry leaves",
    "garam masala",
    "pav bhaji masala",
    "chaat masala",
    "biryani masala",
    "sambar masala",
    "achar masala",
    "ginger garlic paste",
    "hing",
    "asafoetida",
    "jaggery",
    "tamarind",
    "imli chutney",
    "chironji",
    "eno",
    "fruit salt",
    "citric acid",
    "food colour",
    "food color",
    "kasuri methi",
    "sev",
    "green chutney",
    "italian seasoning",
    "charcoal",  # dhungar smoking: a lump of coal, no food and no meat
)
_VEG_SAFE_RE = re.compile(r"\b(?:" + "|".join(re.escape(p) for p in VEG_SAFE_PHRASES) + r")\b")
_MEAT_FISH_EGG_RE = re.compile(
    r"\b(?:meat|chicken|mutton|lamb|beef|pork|fish|anchov(?:y|ies)|lard|tallow|gelatin|bacon|ham|"
    r"shrimps?|prawns?|mince|sausages?|salmon|tuna|turkey|eggs?)\b"
)
_PARENS_RE = re.compile(r"\([^)]*\)")


def is_veg_safe_unmatched(line_text: str) -> bool:
    """Whether an unmatched line is a known vegetarian item and names no meat, fish or egg.

    The parenthetical is ignored ("garam masala (for the chicken)" is still garam masala), and
    any other unmatched line stays unclassifiable.
    """
    name = _PARENS_RE.sub(" ", line_text.lower())
    return _VEG_SAFE_RE.search(name) is not None and _MEAT_FISH_EGG_RE.search(name) is None


def derive_diet(rows: list[IngredientNutrition], table: FoodTable) -> Diet | None:
    """`non_veg` beats `egg`, which beats `veg`; None when any line cannot be classified.

    An unmatched line gives None unless it is a known vegetarian item (`is_veg_safe_unmatched`).
    A food whose veg flag is `unknown` also gives None: the diet is never guessed, and never
    reported veg on partial data.
    """
    seen: set[str] = set()
    for row in rows:
        if row.food is None:
            if is_veg_safe_unmatched(row.line_text):
                continue
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
