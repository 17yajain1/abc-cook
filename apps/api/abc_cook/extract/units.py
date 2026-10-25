"""Canonical ingredient units: a closed alias table, nothing guessed.

`Ingredient.unit` is shown as the source wrote it ("gms", "lts", "Nos") and is never
rewritten. `canonical_unit` maps it to one spelling so later code (nutrition) can reason
about it. A unit that is not in the table maps to None: "tap", "medium" and every size word
stay unknown rather than being forced into a class.
"""

from __future__ import annotations

import re

_ALIASES: dict[str, tuple[str, ...]] = {
    "g": ("g", "gm", "gms", "gram", "grams", "gr", "grs"),
    "kg": ("kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"),
    "ml": ("ml", "mls", "millilitre", "millilitres", "milliliter", "milliliters"),
    "l": ("l", "ltr", "ltrs", "lt", "lts", "litre", "litres", "liter", "liters"),
    "tsp": ("tsp", "tsps", "teaspoon", "teaspoons"),
    "tbsp": ("tbsp", "tbsps", "tbs", "tbl", "tbls", "tablespoon", "tablespoons"),
    "cup": ("cup", "cups"),
    "katori": ("katori", "katoris"),
    "glass": ("glass", "glasses"),
    "oz": ("oz", "ounce", "ounces"),
    "lb": ("lb", "lbs", "pound", "pounds"),
    "pinch": ("pinch", "pinches"),
    "count": ("no", "nos", "pc", "pcs", "piece", "pieces"),
}

CANONICAL_UNITS: dict[str, str] = {
    alias: canonical for canonical, aliases in _ALIASES.items() for alias in aliases
}
"""Case-folded alias -> canonical unit."""

_WORD_RE = re.compile(r"[^\W\d_]+", re.UNICODE)


def _first_word(text: str | None) -> str | None:
    """The first run of letters in `text`, case-folded, or None."""
    if not text:
        return None
    match = _WORD_RE.search(text)
    return match.group().casefold() if match else None


def canonical_unit(unit: str | None, rest: str | None = None) -> str | None:
    """Map a unit to its canonical spelling, or None when it is not a known unit.

    The `unit` field wins when it has a word in it; otherwise the first word of `rest` (the
    text after the number, e.g. " lts" in "4½ lts") is used, the same rule the web's
    `unitClass` applies.

    Args:
        unit: The ingredient's unit field as written, or None.
        rest: The text after the number from `QtyAmount.rest`, or None.

    Returns:
        One of `g kg ml l tsp tbsp cup katori glass oz lb pinch count`, or None.
    """
    word = _first_word(unit) or _first_word(rest)
    if word is None:
        return None
    return CANONICAL_UNITS.get(word)
