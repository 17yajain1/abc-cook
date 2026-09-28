"""extract/title.py -- clean recipe titles (P1 #5 Commit 3).

Two independent things are tested here:

- `clean_title()`, the deterministic fallback, against all 9 real raw fixture titles
  (design doc §R4's own table) plus a few synthetic edge cases the 9 fixtures don't
  individually exercise (hashtags, an all-bracket aside, the never-empty guarantee).
- `_is_grounded()`/`resolve_title()`, the model-title acceptance check, with an
  explicit accept/reject table covering plural, case-fold, "-ed" and blog-name-only
  grounding, and rejection of an invented word.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from abc_cook.extract.title import _is_grounded, _stem, clean_title, resolve_title

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "import"


# ---------------------------------------------------------------------------
# clean_title() -- all 9 real raw fixture titles (§R4's own table).
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("slug", "expected"),
    [
        ("pizza-dough", "Best Homemade Pizza Dough"),
        ("blog-link-only", "Sponge Rasgulla"),
        ("captions-auto-hi", "Sabudana Khichdi"),
        ("captions-manual-en", "Shahi Tukda"),
        ("full-method", "Pakoda Kadhi"),
        ("no-captions", "Rasmalai"),
        ("useless", "Cholle Bhature"),
    ],
)
def test_clean_title_matches_the_design_doc_table(slug: str, expected: str) -> None:
    """7 of the 9 raw fixtures have an exact expected value in §R4's table; all 7
    match the literal five-step algorithm with no adjustment needed."""
    raw = json.loads((FIXTURES_DIR / f"{slug}.raw.json").read_text(encoding="utf-8"))
    assert clean_title(raw["title"]) == expected


def test_clean_title_ramen_strips_the_bracketed_aside_cleanly() -> None:
    """Checkpoint fix: bracketed-aside stripping now runs BEFORE the "Recipe" cut
    (clean_title's step 3, ahead of step 4), so "(Pro Recipe)" is removed as one
    complete pair rather than being cut in half -- no more dangling "(Pro" fragment.
    Regression for the exact fixture title; the 7-title table above is unaffected
    (none of those 9 raw titles contain a bracket at all)."""
    raw = json.loads((FIXTURES_DIR / "captions-auto-en-long.raw.json").read_text(encoding="utf-8"))
    assert raw["title"] == "Keizo Shimamoto Teaches me How to Make a Shoyu Ramen (Pro Recipe)"
    assert clean_title(raw["title"]) == "Keizo Shimamoto Teaches me How to Make a Shoyu Ramen"


def test_clean_title_drops_a_genuinely_dangling_unclosed_bracket() -> None:
    """Belt-and-suspenders case the ramen fixture no longer exercises (its bracket
    pair is now complete by the time it's stripped): a source title with a bracket
    that was NEVER closed anywhere must not leave the stray "(" or its trailing
    fragment in the result."""
    assert clean_title("Dal Makhni (Instant Pot version") == "Dal Makhni"
    assert clean_title("Spicy Chicken [draft title") == "Spicy Chicken"


def test_clean_title_soya_biryani_gives_its_first_hindi_segment() -> None:
    """§R4's other predicted weak case: no segment contains the word "Recipe" at
    all, so step 2 falls through to "the first segment" -- which is the Hindi
    portion here, matching §R4's own description exactly (no flag needed)."""
    raw = json.loads(
        (FIXTURES_DIR / "partial-ingredients-only.raw.json").read_text(encoding="utf-8")
    )
    segments = raw["title"].split("|")
    assert clean_title(raw["title"]) == segments[0].strip()


def test_clean_title_never_empty() -> None:
    assert clean_title("Recipe") == "Recipe"  # no word precedes "Recipe" -- no cut
    assert clean_title("#OnlyATag") == "#OnlyATag"  # would be empty after stripping
    assert clean_title("") == ""


def test_clean_title_strips_hashtags_and_bracketed_asides_when_no_recipe_cut_fires() -> None:
    assert clean_title("Dal Makhni #comfortfood #winter") == "Dal Makhni"
    assert clean_title("Dal Makhni (Instant Pot version)") == "Dal Makhni"


def test_clean_title_collapses_whitespace() -> None:
    assert clean_title("  Dal   Makhni  ") == "Dal Makhni"


# ---------------------------------------------------------------------------
# _stem() -- light suffix stemming (§R4 hardening).
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("word", "stem"),
    [
        ("Pancakes", "pancake"),
        ("pancake", "pancake"),
        ("Dishes", "dish"),
        ("Boxes", "box"),
        ("Roasted", "roast"),
        ("Roasting", "roast"),
        ("DAL", "dal"),
    ],
)
def test_stem(word: str, stem: str) -> None:
    assert _stem(word) == stem


def test_stem_known_limitation_silent_e_verbs_do_not_converge() -> None:
    """Documented, not fixed: "light" stemming strips the literal suffix, so a verb
    that doubles as its own past tense minus a silent "e" ("bake" -> "baked", "fry"
    -> "fried") does not stem to the same root as its base form. A real Porter-style
    stemmer would handle this; this one deliberately doesn't (title.py's `_stem`
    docstring)."""
    assert _stem("baked") != _stem("bake")
    assert _stem("fried") != _stem("fry")


# ---------------------------------------------------------------------------
# _is_grounded() / resolve_title() -- accept/reject table.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("claimed", "raw_title", "blog_name", "expect_grounded"),
    [
        # Accept: plural claim, singular-ish source word and vice versa.
        ("Buttermilk Pancakes", "Buttermilk Pancakes Recipe | How To Make Pancakes", None, True),
        ("Buttermilk Pancake", "Buttermilk Pancakes Recipe", None, True),
        # Accept: case-fold.
        ("Dal Makhni", "Restaurant Style DAL MAKHNI Recipe", None, True),
        # Accept: "-ed" vs the base verb (consonant-ending, not the silent-e case).
        ("Roasted Chicken", "How to Roast a Chicken at Home", None, True),
        ("Boiled Eggs", "How to Boil Eggs Perfectly Every Time", None, True),
        # Accept: grounded via the linked blog's own name, not the raw title at all.
        ("Sponge Rasgulla", "Rasgulla Recipe", "Sponge Rasgulla Recipe", True),
        # Reject: a genuinely invented descriptive word, not present anywhere.
        ("Fluffy Pancakes", "Buttermilk Pancakes Recipe", None, False),
        ("Spicy Dal Makhni", "Restaurant Style Dal Makhni Recipe", None, False),
        # Reject: empty claim -- nothing to accept.
        ("", "Whatever Recipe", None, False),
    ],
)
def test_is_grounded(
    claimed: str, raw_title: str, blog_name: str | None, expect_grounded: bool
) -> None:
    assert _is_grounded(claimed, raw_title, blog_name) is expect_grounded


def test_resolve_title_accepts_a_grounded_claim_verbatim() -> None:
    """"Buttermilk Pancakes" is grounded AND a fixed point of `clean_title` (no
    separators/"Recipe"/brackets to strip) -- passes through untouched."""
    assert resolve_title("Buttermilk Pancakes", "Buttermilk Pancakes Recipe", None) == (
        "Buttermilk Pancakes"
    )


def test_resolve_title_falls_back_to_clean_title_when_ungrounded() -> None:
    assert resolve_title("Fluffy Pancakes", "Buttermilk Pancakes Recipe", None) == (
        clean_title("Buttermilk Pancakes Recipe")
    )
    assert resolve_title("Fluffy Pancakes", "Buttermilk Pancakes Recipe", None) == (
        "Buttermilk Pancakes"
    )


# ---------------------------------------------------------------------------
# Checkpoint fix -- resolve_title also requires the claim to be a fixed point of
# clean_title(), not just grounded. A grounded-but-unclean claim (the "echo" case: a
# model that just repeats the raw title back) must NOT be accepted, even though every
# word in it is trivially present in itself. No separate keyword list -- clean_title
# itself is the purity test.
# ---------------------------------------------------------------------------


def test_resolve_title_rejects_a_grounded_but_unclean_echo_of_the_raw_title() -> None:
    """An exact echo of the raw title is always grounded (every word of an identical
    string is present in it) but is a fixed point of `clean_title` only when the raw
    title was already clean -- this one isn't (pipe separator, "Recipe", a second
    clause), so it's rejected and replaced by the deterministic cleanup."""
    raw = "Best Homemade Pizza Dough Recipe | How To Make Pizza Crust"
    assert _is_grounded(raw, raw, None) is True  # trivially grounded
    assert clean_title(raw) != raw  # ...but NOT a fixed point
    assert resolve_title(raw, raw, None) == "Best Homemade Pizza Dough"


def test_resolve_title_legacy_pizza_and_dal_echoes_now_resolve_to_the_clean_title() -> None:
    """The two real captured replay fixtures predate v6's "clean dish name"
    guidance and their `recipe.title` is a verbatim echo of the raw title -- both
    are now correctly rejected by the fixed-point check and cleaned, where before
    this fix they passed grounding and stayed as messy as the raw title."""
    pizza_raw = "Best Homemade Pizza Dough Recipe | How To Make Pizza Crust"
    assert resolve_title(pizza_raw, pizza_raw, None) == "Best Homemade Pizza Dough"

    dal_raw = "Restaurant Style Dal Makhni Recipe in Hindi | Winter Special दाल मखनी रेस्टौरंट जैसी"
    assert resolve_title(dal_raw, dal_raw, None) == "Restaurant Style Dal Makhni"


def test_resolve_title_known_limitation_a_noise_free_but_verbose_echo_still_passes() -> None:
    """Documented, not fixed: the fixed-point check only catches STRUCTURAL mess
    (separators, "Recipe", brackets, tags) -- a claim that's already free of all of
    that, but is a full sentence rather than a short dish name, is still a fixed
    point and is accepted. Judging wordiness is left to the live check."""
    verbose = "Keizo Shimamoto Teaches me How to Make a Shoyu Ramen"
    assert clean_title(verbose) == verbose  # nothing structural left to strip
    assert resolve_title(verbose, verbose, None) == verbose  # accepted, despite being verbose
