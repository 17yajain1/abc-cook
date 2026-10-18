"""Structured quantities: `parse_amount` turns an ingredient line into a scalable `QtyAmount`.

Pure and conservative. The grammar is ``[prefix] N [sep N] rest`` where N is an integer, a
decimal, ``a/b``, a mixed number (``1 1/2``, ``1-1/2``, ``1&1/2``) or a vulgar fraction
(``½``, ``1½``). A line is scalable only when every check passes; anything else returns
``None`` and the line is shown as the source wrote it. Never guesses: a wrong amount in a
kitchen is worse than an amount that does not scale.

See docs/plans/r3-quantities.md, Step 2B and the owner amendments (A1, A2).
"""

from __future__ import annotations

import re
from itertools import pairwise

from abc_cook.schema.ingredient import QtyAmount

VULGAR_FRACTIONS = {
    "¼": 0.25, "½": 0.5, "¾": 0.75,
    "⅓": 1 / 3, "⅔": 2 / 3,
    "⅕": 0.2, "⅖": 0.4, "⅗": 0.6, "⅘": 0.8,
    "⅙": 1 / 6, "⅚": 5 / 6,
    "⅛": 0.125, "⅜": 0.375, "⅝": 0.625, "⅞": 0.875,
}  # fmt: skip

# Units that measure an amount (the web's non-count classes). Used for the package-size rule.
# Case-folded; plurals listed, not stripped, so "glass" and "pass" never fold by accident.
MEASURE_UNITS = frozenset(
    {
        "g", "gm", "gms", "gram", "grams",
        "ml", "millilitre", "millilitres", "milliliter", "milliliters",
        "kg", "kgs", "kilogram", "kilograms",
        "l", "litre", "litres", "liter", "liters",
        "tsp", "tsps", "teaspoon", "teaspoons",
        "tbsp", "tbsps", "tablespoon", "tablespoons",
        "cup", "cups", "katori", "katoris", "glass", "glasses",
        "oz", "ounce", "ounces", "lb", "lbs", "pound", "pounds",
        "pint", "pints", "quart", "quarts",
    }
)  # fmt: skip

# What a package is sold in. "15 oz can" is a package size, not an amount to multiply.
CONTAINER_WORDS = frozenset(
    {
        "can", "cans", "tin", "tins", "jar", "jars", "packet", "packets", "pack", "packs",
        "bottle", "bottles", "box", "boxes", "sachet", "sachets", "carton", "cartons",
    }
)  # fmt: skip

_VULGAR = "".join(VULGAR_FRACTIONS)
_DIGIT_OR_VULGAR_RE = re.compile(rf"[\d{_VULGAR}]")
_PREFIX_RE = re.compile(
    r"(?:~\s*|(?:about|approx\.?|approximately|around|roughly|लगभग)\s+)", re.IGNORECASE
)
_NUMBER_RES = (
    re.compile(r"(\d+)\s*[-&\s]\s*(\d+)\s*/\s*(\d+)"),  # mixed: 1 1/2, 1-1/2, 1&1/2
    re.compile(rf"(\d+)?\s*([{_VULGAR}])"),  # vulgar: ½, 1½, 1 ½
    re.compile(r"(\d+)\s*/\s*(\d+)"),  # plain fraction: 3/4
    re.compile(r"\d+(?:\.\d+)?"),  # integer or decimal
)
_RANGE_DASHES = chr(0x2013) + chr(0x2014)  # en dash, em dash -- ASCII-safe in source (RUF001)
_RANGE_SEP_RE = re.compile(rf"\s*(?:-|[{_RANGE_DASHES}]|to)\s*")
_WORD_RE = re.compile(r"[^\W\d_]+")
_ALTERNATIVE_RE = re.compile(r"(?:\+|\bor\b)", re.IGNORECASE)


def _take_number(text: str, pos: int) -> tuple[float, int] | None:
    """The number starting at `pos` and where it ends, or None."""
    mixed, vulgar, fraction, plain = _NUMBER_RES
    if m := mixed.match(text, pos):
        whole, num, den = (int(g) for g in m.groups())
        return (whole + num / den, m.end()) if den else None
    if m := vulgar.match(text, pos):
        whole_text, glyph = m.groups()
        return (int(whole_text) if whole_text else 0) + VULGAR_FRACTIONS[glyph], m.end()
    if m := fraction.match(text, pos):
        num, den = (int(g) for g in m.groups())
        return (num / den, m.end()) if den else None
    if m := plain.match(text, pos):
        return float(m.group()), m.end()
    return None


def _is_package_size(rest: str, unit: str | None) -> bool:
    """A measure unit directly followed by a container word ("oz can", "ml bottles")."""
    words = _WORD_RE.findall(f"{rest} {unit or ''}".lower())
    return any(a in MEASURE_UNITS and b in CONTAINER_WORDS for a, b in pairwise(words))


def parse_amount(qty_text: str | None, unit: str | None) -> QtyAmount | None:
    """Parse an ingredient's quantity text into a scalable amount, or None.

    Returns None whenever the line is not certainly one number or one range: no leading number
    (``"to taste"``, ``"a pinch"``), a second amount anywhere (a digit or vulgar fraction in
    the text after the number or in `unit`, ``"+"``, ``"or"``), a range that does not rise, a
    zero, a decimal comma, number words in any language, or a package size (``"15 oz can"``).

    Args:
        qty_text: The quantity as the source wrote it, e.g. ``"1 1/2"``, ``"2-3 medium"``.
        unit: The unit field alongside it, e.g. ``"cups"``, or None.

    Returns:
        The structured amount, or None when the line must be shown exactly as written.
    """
    if qty_text is None:
        return None
    text = qty_text.strip()
    if not text:
        return None

    prefix_match = _PREFIX_RE.match(text)
    prefix = prefix_match.group() if prefix_match else ""
    pos = prefix_match.end() if prefix_match else 0

    first = _take_number(text, pos)
    if first is None:
        return None
    low, pos = first
    high: float | None = None
    if sep := _RANGE_SEP_RE.match(text, pos):
        second = _take_number(text, sep.end())
        if second is not None:
            high, pos = second
            if high <= low:
                return None

    rest = text[pos:]
    if low <= 0:
        return None
    if _DIGIT_OR_VULGAR_RE.search(rest) or (unit is not None and _DIGIT_OR_VULGAR_RE.search(unit)):
        return None
    if rest[:1] in ("/", ",", "."):
        return None
    if _ALTERNATIVE_RE.search(rest):
        return None
    if _is_package_size(rest, unit):
        return None
    return QtyAmount(low=low, high=high, prefix=prefix, rest=rest)
