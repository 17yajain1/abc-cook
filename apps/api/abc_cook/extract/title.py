"""P1 #5 Commit 3 — clean recipe titles. Pure module: no I/O, no LLM, no network.

`graph.title` is a *display* title, decoupled from `ImportResult.source_title` (the
raw source title, always `raw.title` verbatim — see `import_pipeline.py`). This module
decides what `graph.title` should be:

- `resolve_title()` accepts the model's own claimed title (`NormalizedRecipe.title`,
  requested by the prompt as a clean dish name) only when BOTH: it's grounded in the
  raw title or the linked blog's `name` (no invented word), AND it's a fixed point of
  `clean_title()` -- `clean_title(claimed) == claimed`. The second check is what
  catches a claim that's honest but unclean: a model that just echoes the raw title
  verbatim is trivially grounded (every word of an identical string is present in
  it), but the echo is by definition not a fixed point whenever `clean_title` would
  have changed it -- no separate "does this look like a raw title" keyword list
  needed, `clean_title` itself is the test.
- Otherwise it falls back to `clean_title()`, a deterministic cleanup of the raw
  title. Never invents a title; a source with no usable structure (no "Recipe"
  marker, no separator) is returned closer to verbatim, not guessed at.
- Known limitation, left for the live check to judge: a claim can be noise-free (a
  fixed point, nothing to strip) and still be a bad title -- verbose, or a full
  sentence rather than a dish name. Fixed-point-ness only catches structural mess
  (separators, "Recipe", brackets, tags), never wordiness.
"""

from __future__ import annotations

import re

_FULLWIDTH_VERTICAL_LINE = chr(0xFF5C)  # fullwidth pipe -- ASCII-safe in source (RUF001)
_DEVANAGARI_DANDA = chr(0x0964)  # Devanagari danda -- ASCII-safe in source (RUF001)

_TITLE_SEPARATOR_RE = re.compile(f"[|{_FULLWIDTH_VERTICAL_LINE}{_DEVANAGARI_DANDA}]")
"""The plain pipe, the fullwidth pipe (U+FF5C) and the Devanagari danda (U+0964) --
the three separators observed across the raw fixture titles (design doc §R4)."""

_RECIPE_WORD_RE = re.compile(r"\bRecipe\b", re.IGNORECASE)
_HASHTAG_RE = re.compile(r"#\S+")
_BRACKETED_ASIDE_RE = re.compile(r"[(\[][^)\]]*[)\]]")
_DANGLING_OPEN_BRACKET_RE = re.compile(r"[(\[][^()\[\]]*$")
"""An unmatched opening bracket with no close anywhere after it, through to the end
of the string. Belt-and-suspenders: `_BRACKETED_ASIDE_RE` only strips COMPLETE pairs,
so a source title with a genuinely unmatched bracket (not just one split in half by
the "Recipe" cut below -- reordered specifically so that no longer happens) would
otherwise leave a dangling fragment in the result."""
_WHITESPACE_RE = re.compile(r"\s+")


def clean_title(raw_title: str) -> str:
    """Deterministic cleanup of a raw source title (§R4).

    Five steps:

    1. Split on the pipe, fullwidth pipe and Devanagari danda (see
       `_TITLE_SEPARATOR_RE`).
    2. Take the first segment containing the word "Recipe", or else the first
       segment.
    3. Strip bracketed asides (complete pairs) and any dangling unclosed bracket.
       Runs BEFORE the "Recipe" cut below -- checkpoint finding: doing it after can
       cut a bracket pair in half when "Recipe" itself sits inside the aside (the
       ramen fixture title's "(Pro Recipe)"), leaving a dangling "(Pro" fragment.
    4. Cut at "Recipe" (drop it and everything after) when at least one word
       precedes it in what's left, then strip `#tags` and collapse whitespace.
    5. Never return an empty string — fall back to the raw title, stripped.

    Args:
        raw_title: The source's own title, verbatim (`RawAcquisition.title`).

    Returns:
        The cleaned title. Never invents words; only ever removes them.
    """
    segments = [s.strip() for s in _TITLE_SEPARATOR_RE.split(raw_title)]
    if not segments:
        return raw_title.strip()

    chosen = next((s for s in segments if _RECIPE_WORD_RE.search(s)), segments[0])

    chosen = _BRACKETED_ASIDE_RE.sub("", chosen)
    chosen = _DANGLING_OPEN_BRACKET_RE.sub("", chosen)

    match = _RECIPE_WORD_RE.search(chosen)
    if match and chosen[: match.start()].strip():
        chosen = chosen[: match.start()]

    chosen = _HASHTAG_RE.sub("", chosen)
    chosen = _WHITESPACE_RE.sub(" ", chosen).strip()

    return chosen if chosen else raw_title.strip()


_STEM_SIBILANT_ES_RE = re.compile(r"(?:[sxz]|ch|sh)es$", re.IGNORECASE)
_WORD_RE = re.compile(r"[A-Za-z]+")


def _stem(word: str) -> str:
    """Light suffix stemming (§R4 hardening) — `-ing`/`-ed`/plural, nothing more.

    No dictionary, no exceptions list: this is intentionally shallow, matched to
    what a recipe title actually varies by (a verb's tense, a noun's number), not a
    general-purpose stemmer. "es" is only stripped after a sibilant ("dishes" ->
    "dish", "boxes" -> "box"); everywhere else a plural is "+s" only ("pancakes" ->
    "pancake", not "pancak"), which is what a silent-e noun actually needs.
    """
    lowered = word.lower()
    if lowered.endswith("ing") and len(lowered) > 5:
        return lowered[:-3]
    if lowered.endswith("ed") and len(lowered) > 4:
        return lowered[:-2]
    if _STEM_SIBILANT_ES_RE.search(lowered):
        return lowered[:-2]
    if lowered.endswith("s") and len(lowered) > 3:
        return lowered[:-1]
    return lowered


def _content_words(text: str) -> set[str]:
    """Stemmed, case-folded alphabetic tokens of length >= 2.

    Single letters are noise, never load-bearing for a title match.
    """
    return {_stem(w) for w in _WORD_RE.findall(text) if len(w) >= 2}


def _is_grounded(
    claimed_title: str,
    raw_title: str,
    blog_name: str | None,
    source_text: str | None = None,
) -> bool:
    """Whether `claimed_title` is grounded in `raw_title` or `blog_name` (§R4).

    Every content word of `claimed_title` must appear, after stemming, in
    `raw_title`, `blog_name` or `source_text`. An empty claim is never grounded
    (nothing to accept).
    """
    claimed_words = _content_words(claimed_title)
    if not claimed_words:
        return False
    source_words = _content_words(raw_title)
    if blog_name:
        source_words |= _content_words(blog_name)
    if source_text:
        source_words |= _content_words(source_text)
    return claimed_words <= source_words


def resolve_title(
    claimed_title: str,
    raw_title: str,
    blog_name: str | None = None,
    source_text: str | None = None,
) -> str:
    """`graph.title` for an import: the model's claim if it earns trust, else a fallback.

    Accepted only when the claim is BOTH grounded (`_is_grounded`) and a fixed point
    of `clean_title` -- see the module docstring for why the second check exists.

    Args:
        claimed_title: `NormalizedRecipe.title`, the model's proposed clean dish name.
        raw_title: `RawAcquisition.title`, verbatim.
        blog_name: The linked blog's own `name` (schema.org `Recipe.name`), if any —
            a second, independent source the model's claim may be grounded in.
        source_text: The user's own pasted recipe (A8), a third such source. Only
            passed for pasted-text imports, where the raw title is just the first
            line of that same text.

    Returns:
        The title to use as `graph.title`.
    """
    grounded = _is_grounded(claimed_title, raw_title, blog_name, source_text)
    fixed_point = clean_title(claimed_title) == claimed_title
    if grounded and fixed_point:
        return claimed_title
    return clean_title(raw_title)
