"""Pasted recipe text -> `RawAcquisition`. No network, no LLM (A8).

The recovery path for a page with no usable Recipe JSON-LD, a login-walled reel, or
anything else `acquire()` can't read: the user pastes the recipe, and it goes through
the same `normalize` path as every other source -- as `description`, the field every
leg-1 import already uses for its primary text -- with `source_kind="text"` so the graph
records where it really came from (`SourceRef(kind="text")`).
"""

from __future__ import annotations

import re

from abc_cook.extract.acquire import RawAcquisition

MIN_CHARS = 20
"""Below this there is no recipe to read; rejected before any LLM call."""

MAX_CHARS = 20_000
"""A generous recipe is a few thousand characters. The cap bounds prompt cost for a
pasted wall of text; the route turns an over-long paste into a clear 422."""

_TITLE_MAX = 80
_BLANK_RUNS = re.compile(r"\n{3,}")


class PastedTextError(ValueError):
    """The pasted text can't be used. `str(exc)` is safe to show the user."""


def clean_text(text: str) -> str:
    """Normalise line endings and trim; collapse runs of blank lines to one."""
    unified = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    return _BLANK_RUNS.sub("\n\n", unified)


def derive_title(text: str) -> str:
    """The first non-blank line, cut at a word boundary, else a plain default.

    Only ever a substring of what the user pasted -- never invented. The LLM's own
    clean dish-name claim is accepted over it when grounded in the pasted text
    (`title.resolve_title`'s `source_text`).
    """
    first = next((line.strip() for line in text.splitlines() if line.strip()), "")
    if not first:
        return "Pasted recipe"
    if len(first) <= _TITLE_MAX:
        return first
    cut = first[:_TITLE_MAX].rsplit(" ", 1)[0]
    return cut or first[:_TITLE_MAX]


def from_pasted_text(text: str, title: str | None = None) -> RawAcquisition:
    """Build the `RawAcquisition` for a pasted recipe.

    Args:
        text: What the user pasted.
        title: An optional title the user supplied; defaults to `derive_title(text)`.

    Raises:
        PastedTextError: too short or too long after cleaning.
    """
    cleaned = clean_text(text)
    if len(cleaned) < MIN_CHARS:
        raise PastedTextError("That is too short to be a recipe. Paste the ingredients and steps.")
    if len(cleaned) > MAX_CHARS:
        raise PastedTextError(
            f"That is too long ({len(cleaned):,} characters; the limit is {MAX_CHARS:,}). "
            "Paste just the recipe."
        )
    given = (title or "").strip()
    return RawAcquisition(
        source_url="",
        title=given or derive_title(cleaned),
        description=cleaned,
        source_kind="text",
    )
