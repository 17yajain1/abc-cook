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
from typing import NamedTuple

from abc_cook.extract.units import CANONICAL_UNITS, canonical_unit
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


# -- Amounts written inside the ingredient name ----------------------------------------------

# A number token the name-splitters look for: mixed, vulgar, plain fraction, decimal or integer.
_NAME_NUMBER = (
    r"(?:\d+\s*[-&\s]\s*\d+\s*/\s*\d+|\d*\s?[" + _VULGAR + r"]|\d+\s*/\s*\d+|\d+(?:\.\d+)?)"
)
_NAME_RANGE = rf"(?:{_NAME_NUMBER}(?:\s*(?:-|[{_RANGE_DASHES}]|to)\s*{_NAME_NUMBER})?)"
_UNIT_WORDS = "|".join(sorted(map(re.escape, CANONICAL_UNITS), key=len, reverse=True))
_UNIT_AHEAD_RE = re.compile(rf"\s*(?:{_UNIT_WORDS})\b", re.IGNORECASE)
_LEADING_RE = re.compile(
    rf"\s*(?P<num>{_NAME_RANGE})(?:\s*(?P<unit>(?:{_UNIT_WORDS})\b\.?))?", re.IGNORECASE
)
_PLUS_RE = re.compile(r"\s*\+\s*")
_TRAILING_RE = re.compile(
    rf"(?<![\w/.])(?P<amt>{_NAME_RANGE}\s*(?:{_UNIT_WORDS})\b\.?)\s*$", re.IGNORECASE
)
_DANGLING_RANGE_RE = re.compile(r"\s*to\b\s*", re.IGNORECASE)


class NameSplit(NamedTuple):
    """What `split_amount_from_name` decided about one ingredient line.

    `amount` is set only when this function parsed the amount itself (a leading or trailing
    amount, the "A + B" sum included); otherwise it is None and the caller parses `qty_text`.
    """

    name: str
    qty_text: str | None
    amount: QtyAmount | None
    changed: bool


def is_garbled_amount(name: str) -> bool:
    """True when a name opens with a number and a dangling range word ("3 to  mato")."""
    text = name.lstrip()
    first = _take_number(text, 0)
    if first is None:
        return False
    word = _DANGLING_RANGE_RE.match(text, first[1])
    return word is not None and _take_number(text, word.end()) is None


def _unit_of(amount: QtyAmount) -> str | None:
    return canonical_unit(None, amount.rest)


def _leading(name: str) -> tuple[str, str, QtyAmount] | None:
    """(qty_text, remaining name, amount) for a leading amount, or None."""
    if is_garbled_amount(name):
        return None
    m = _LEADING_RE.match(name)
    if m is None:
        return None
    end = m.end()
    # "2%", "5-spice", "2x": the number belongs to the name, not to a quantity.
    if end < len(name) and not (name[end].isspace() or name[end] == "("):
        return None
    candidate = name[:end].strip()
    amount = parse_amount(candidate, None)
    remainder = name[end:].strip()
    if amount is None or not remainder:
        return None
    # "A + B": sum when both sides carry the same unit; any other "+" is left alone.
    if plus := _PLUS_RE.match(remainder):
        tail = remainder[plus.end() :]
        second = _LEADING_RE.match(tail)
        if second is None or not m.group("unit") or not second.group("unit"):
            return None
        second_text = tail[: second.end()].strip()
        second_amount = parse_amount(second_text, None)
        unit = _unit_of(amount)
        if second_amount is None or unit is None or _unit_of(second_amount) != unit:
            return None
        if amount.high is not None or second_amount.high is not None:
            return None
        rest_name = tail[second.end() :].strip()
        if not rest_name:
            return None
        total = QtyAmount(low=amount.low + second_amount.low, rest=amount.rest)
        return f"{candidate} + {second_text}", rest_name, total
    return candidate, remainder, amount


def _trailing(name: str) -> tuple[str, str, QtyAmount] | None:
    """(qty_text, remaining name, amount) for a trailing "<number> <unit>", or None."""
    m = _TRAILING_RE.search(name)
    if m is None:
        return None
    candidate = m.group("amt").strip()
    remainder = name[: m.start()].strip()
    amount = parse_amount(candidate, None)
    if amount is None or not remainder:
        return None
    return candidate, remainder, amount


def _strip_repeat(name: str, qty_text: str, unit: str | None) -> str | None:
    """`name` with one word-bounded copy of the amount removed, or None when it has none."""
    has_unit = bool(unit and unit.strip())
    forms = [f"{qty_text} {unit.strip()}"] if unit and has_unit else []
    forms.append(qty_text)
    for form in forms:
        pattern = re.compile(rf"(?<![\w/.]){re.escape(form)}(?![\w/%])", re.IGNORECASE)
        found = pattern.search(name)
        if found is None:
            continue
        # A bare number followed by a unit word ("1" + "cup onions") is a split the model
        # left half-done; removing the number alone would strand the unit in the name.
        if form == qty_text and not has_unit and _UNIT_AHEAD_RE.match(name, found.end()):
            continue
        stripped = name[: found.start()] + name[found.end() :]
        stripped = re.sub(r"\(\s*\)", "", stripped)  # "salt (to taste)" must not leave "salt ()"
        stripped = re.sub(r"\s{2,}", " ", stripped).strip()
        if stripped:
            return stripped
    return None


def split_amount_from_name(name: str, qty_text: str | None, unit: str | None) -> NameSplit:
    """Move an amount the model left inside the ingredient name out of it.

    With no `qty_text`, a leading amount ("½ cup peas", "2  potato") or a trailing
    "<number> <unit>" ("Chicken boneless (thigh) 750 gm") becomes the quantity and is stripped
    from the name. "A + B" with the same unit on both sides ("1 tbsp + 1 tbsp") keeps the text
    verbatim and carries the sum in the returned amount. With a `qty_text` already set, a copy
    of that amount in the name is stripped from the name only. Garbled text ("3 to  mato"),
    mixed-unit sums and anything not certain are returned untouched.

    Args:
        name: The ingredient name as extracted.
        qty_text: The quantity text as extracted, or None.
        unit: The unit as extracted, or None.

    Returns:
        The (possibly unchanged) name and quantity text, a parsed amount when this function
        made one, and whether anything changed.
    """
    if qty_text is not None and qty_text.strip():
        stripped = _strip_repeat(name, qty_text.strip(), unit)
        if stripped is None:
            return NameSplit(name, qty_text, None, False)
        return NameSplit(stripped, qty_text, None, True)
    for found in (_leading(name), _trailing(name)):
        if found is not None:
            text, remainder, amount = found
            return NameSplit(remainder, text, amount, True)
    return NameSplit(name, qty_text, None, False)
