"""extract/graph.py -- servings and yield (P1 #5 Commit 4).

`servings` is a people count; `yield_text` is whatever the source actually says it
makes. Three independent checks: `servings` is grounded on its own
(`_verify_servings` -- checkpoint fix), `yield_text` is grounded (kept only if a
number in it also appears in the source text), and the PC5 guard discards a "stated"
servings claim that's really just an echoed yield count with no people word attached.
"""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from abc_cook.extract.graph import (
    SERVINGS_DEFAULTED_WARNING,
    _non_transcript_corpus,
    _resolve_servings,
    _verify_servings,
    _verify_yield,
    _yield_names_people,
    build_graph,
)
from abc_cook.schema.graph import SourceRef
from abc_cook.schema.normalized import NormalizedIngredient, NormalizedRecipe, NormalizedStep

SOURCE = SourceRef(kind="url", value="https://youtu.be/test", imported_at=datetime.now(UTC))


def _step(**overrides: object) -> NormalizedStep:
    defaults: dict[str, object] = {
        "text": "Do something.",
        "attention": "hands_on",
        "duration_stated": False,
        "station": "counter",
        "interruptible": True,
        "freshness": "none",
    }
    defaults.update(overrides)
    return NormalizedStep(**defaults)  # type: ignore[arg-type]


def _recipe(**overrides: object) -> NormalizedRecipe:
    defaults: dict[str, object] = {
        "title": "Test",
        "method_grounded": True,
        "ingredients": [NormalizedIngredient(name="Onion", qty="1", unit=None, prep_note=None)],
        "steps": [_step(text="Cook it.")],
    }
    defaults.update(overrides)
    return NormalizedRecipe(**defaults)  # type: ignore[arg-type]


def _build(recipe: NormalizedRecipe, source_text: str):
    return build_graph(recipe, source_text, graph_id="g_test", source=SOURCE)


# ---------------------------------------------------------------------------
# §R4's own worked examples: pizza (people word grounds it) and rasgulla (PC5 fires).
# ---------------------------------------------------------------------------


def test_pizza_yield_kept_and_servings_stays_stated() -> None:
    """recipeYield ["8", "8 people (makes 2, 10-12 inch crusts)"]: the "8" is
    grounded (it's the servings claim too), and "people" is named, so the PC5 guard
    does not fire -- servings stays stated."""
    source_text = (
        "Best Homemade Pizza Dough. This recipe serves 8 people and makes 2 "
        "10-12 inch pizza crusts. Cook it."
    )
    recipe = _recipe(servings=8, yield_text="8 people (makes 2, 10-12 inch crusts)")
    result = _build(recipe, source_text)
    assert result.graph is not None
    assert result.graph.servings == 8
    assert result.graph.servings_stated is True
    assert result.graph.yield_text == "8 people (makes 2, 10-12 inch crusts)"
    assert not any("defaulted" in w.lower() for w in result.warnings)


def test_rasgulla_pc5_guard_fires_yield_kept_servings_not_stated() -> None:
    """recipeYield ["14", "14 rasgulla"]: no people word, and the model's "servings"
    claim is exactly the yield's own number -- PC5 treats servings as not stated,
    even though `NormalizedRecipe.servings_source` would say "stated". `yield_text`
    is still kept -- it's grounded, and the guard is about `servings`, not it."""
    source_text = "Sponge Rasgulla. This recipe makes 14 rasgulla, a Bengali dessert. Cook it."
    recipe = _recipe(servings=14, yield_text="14 rasgulla", servings_source="stated")
    result = _build(recipe, source_text)
    assert result.graph is not None
    assert result.graph.servings == 4  # defaulted, same fallback as "not stated at all"
    assert result.graph.servings_stated is False
    assert result.graph.yield_text == "14 rasgulla"
    assert any(w == SERVINGS_DEFAULTED_WARNING for w in result.warnings)


# ---------------------------------------------------------------------------
# Defaulted, and the documented "Makes a dozen" limitation.
# ---------------------------------------------------------------------------


def test_defaulted_when_nothing_stated_at_all() -> None:
    recipe = _recipe(servings=None, yield_text=None)
    result = _build(recipe, "No servings or yield mentioned anywhere. Cook it.")
    assert result.graph is not None
    assert result.graph.servings == 4
    assert result.graph.servings_stated is False
    assert result.graph.yield_text is None
    assert any(w == SERVINGS_DEFAULTED_WARNING for w in result.warnings)


def test_makes_a_dozen_has_no_digit_and_is_dropped() -> None:
    """Documented limitation (§R4 hardening): number-based yield grounding
    intentionally drops a yield with no digit at all. The result is no yield line,
    never an invented number ("a dozen" -> 12)."""
    recipe = _recipe(servings=None, yield_text="a dozen")
    result = _build(recipe, "This recipe makes a dozen cookies. Cook it.")
    assert result.graph is not None
    assert result.graph.yield_text is None
    assert result.graph.servings_stated is False


# ---------------------------------------------------------------------------
# Checkpoint fix -- `servings` now has its own independent grounding
# (`_verify_servings`), the one field in this file that previously had none at all.
# ---------------------------------------------------------------------------


def test_model_says_serves_4_source_silent_is_rejected() -> None:
    """The checkpoint finding this fix closes: a bare `servings` claim with
    nothing backing it anywhere in an English-looking source -- no digit, no
    number word -- is an invented number, not a stated one. Now rejected and
    defaulted, same as if the model had claimed nothing at all."""
    recipe = _recipe(servings=4, yield_text=None)
    result = _build(recipe, "Cook it. Serve immediately.")  # no "4" anywhere in the source
    assert result.graph is not None
    assert result.graph.servings == 4  # defaulted, same fallback value
    assert result.graph.servings_stated is False
    assert any(w == SERVINGS_DEFAULTED_WARNING for w in result.warnings)


def test_serves_four_as_an_english_number_word_is_accepted() -> None:
    """A transcript/description saying "serves four" rather than "serves 4" must
    still ground the claim -- transcripts render spoken numbers as words at least
    as often as digits (the same premise duration parsing already relies on,
    `_NUMBER_WORDS`)."""
    recipe = _recipe(servings=4, yield_text=None)
    result = _build(recipe, "This recipe serves four people. Cook it.")
    assert result.graph is not None
    assert result.graph.servings == 4
    assert result.graph.servings_stated is True
    assert not any("defaulted" in w.lower() for w in result.warnings)


def test_hindi_transcript_stating_the_claimed_number_is_accepted() -> None:
    """A Hindi transcript stating "चार लोगों के लिए" (for four people) grounds a
    `servings=4` claim via `_HINDI_NUMBER_WORDS`, not a blanket non-English pass --
    checkpoint fix, replacing the earlier leniency bypass this test used to name."""
    recipe = _recipe(servings=4, yield_text=None)
    source_text = (
        "Title: Chaar Logon Ke Liye Dal\n\n"
        "Transcript (auto-generated captions, hi):\n\n"
        "यह रेसिपी चार "
        "लोगों के लिए है। "
        "दाल को अच्छे से "
        "पकाएं।"
    )
    result = _build(recipe, source_text)
    assert result.graph is not None
    assert result.graph.servings == 4
    assert result.graph.servings_stated is True
    assert not any("defaulted" in w.lower() for w in result.warnings)


def test_hindi_transcript_with_no_serving_info_is_rejected() -> None:
    """Checkpoint finding: the removed leniency bypass accepted this too, purely
    because the source looked non-English -- it never actually said anything about
    servings at all. Must be rejected like any other silent source."""
    recipe = _recipe(servings=4, yield_text=None)
    source_text = (
        "Title: Dal Recipe\n\n"
        "Transcript (auto-generated captions, hi):\n\n"
        "दाल को अच्छे से धो लें। "
        "प्याज़ काट लें और तेल में भूनें। "
        "मसाले डालें और पकाएं।"
    )
    result = _build(recipe, source_text)
    assert result.graph is not None
    assert result.graph.servings == 4  # defaulted, same fallback value
    assert result.graph.servings_stated is False
    assert any(w == SERVINGS_DEFAULTED_WARNING for w in result.warnings)


def test_hindi_transcript_stating_a_different_number_is_rejected() -> None:
    """Checkpoint finding: the removed leniency bypass accepted this too, even
    though the source explicitly says eight (aath), not four -- a real
    contradiction the old bypass couldn't see. `_verify_servings` doesn't detect
    the contradiction as such either (documented limitation: it only ever checks
    for positive evidence of the CLAIMED number, never compares against a second,
    different one) -- but the practical result is the same here, since the source
    contains no evidence for "4" specifically, only for "8"."""
    recipe = _recipe(servings=4, yield_text=None)
    source_text = (
        "Title: Dal Recipe\n\n"
        "Transcript (auto-generated captions, hi):\n\n"
        "यह रेसिपी आठ लोगों के लिए है। "
        "दाल को अच्छे से पकाएं।"
    )
    result = _build(recipe, source_text)
    assert result.graph is not None
    assert result.graph.servings == 4  # defaulted, same fallback value
    assert result.graph.servings_stated is False
    assert any(w == SERVINGS_DEFAULTED_WARNING for w in result.warnings)


def test_romanized_hindi_number_word_is_accepted() -> None:
    """"Chaar log ke liye" (for four people, spelled in Latin script) grounds the
    claim via `_HINDI_NUMBER_WORDS`'s romanized forms -- covers a caption/transcript
    source that never uses Devanagari at all. Known limitation (documented on
    `_HINDI_NUMBER_WORDS`): this is a plain substring match, so a short romanized
    form could in principle collide with an unrelated English word; not solved here."""
    recipe = _recipe(servings=4, yield_text=None)
    result = _build(recipe, "This recipe is chaar log ke liye. Cook the dal well.")
    assert result.graph is not None
    assert result.graph.servings == 4
    assert result.graph.servings_stated is True
    assert not any("defaulted" in w.lower() for w in result.warnings)


# ---------------------------------------------------------------------------
# _verify_yield / _yield_names_people / _resolve_servings -- direct unit coverage.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("yield_text", "corpus", "expected"),
    [
        ("14 rasgulla", "this recipe makes 14 rasgulla", "14 rasgulla"),
        ("8 people", "not mentioned anywhere", None),  # number not grounded
        ("a dozen", "makes a dozen cookies", None),  # no digit at all
        (None, "anything", None),
        ("", "anything", None),
        ("  ", "anything", None),
    ],
)
def test_verify_yield(yield_text: str | None, corpus: str, expected: str | None) -> None:
    assert _verify_yield(yield_text, corpus) == expected


@pytest.mark.parametrize(
    ("yield_text", "expected"),
    [
        ("8 people", True),
        ("Serves 4", True),
        ("4 servings", True),
        ("14 rasgulla", False),
        ("2 loaves", False),
        ("makes 6 portions", True),
    ],
)
def test_yield_names_people(yield_text: str, expected: bool) -> None:
    assert _yield_names_people(yield_text) is expected


@pytest.mark.parametrize(
    ("claimed_servings", "verified_yield_text", "corpus", "expected"),
    [
        # people word -> not guarded (also grounded: "8" is in the corpus)
        (8, "8 people (makes 2, 10-12 inch crusts)", "serves 8 people", (8, True)),
        (14, "14 rasgulla", "makes 14 rasgulla", (4, False)),  # PC5 fires
        (4, "4 loaves", "makes 4 loaves", (4, False)),  # same number, no people word -> PC5 fires
        (4, "8 loaves", "serves 4", (4, True)),  # different yield number -> not guarded
        (None, "14 rasgulla", "makes 14 rasgulla", (4, False)),  # no claim at all
        (None, None, "anything", (4, False)),
        (6, None, "serves 6", (6, True)),  # claim with no yield_text to cross-check, but grounded
        (6, None, "nothing about servings here", (4, False)),  # ungrounded -> rejected
    ],
)
def test_resolve_servings(
    claimed_servings: int | None,
    verified_yield_text: str | None,
    corpus: str,
    expected: tuple[int, bool],
) -> None:
    assert _resolve_servings(claimed_servings, verified_yield_text, corpus) == expected


def test_servings_defaulted_warning_is_pinned() -> None:
    """§R4 hardening: this exact string is asserted verbatim by a Vitest on
    `lib/servings.ts`'s own copy (drift protection) -- a change here without the
    matching web-side change fails that test, not silently."""
    assert SERVINGS_DEFAULTED_WARNING == "Servings not stated in the source; defaulted to 4."


# ---------------------------------------------------------------------------
# _verify_servings / _non_transcript_corpus -- direct unit coverage for the
# checkpoint fix. No language-detection heuristic any more: evidence is either an
# ASCII digit, an English number word, or a Hindi number word (Devanagari or
# romanized) -- nothing else, and no digit/word evidence means not grounded,
# regardless of what script the rest of the source is in.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("claimed_servings", "corpus", "expected"),
    [
        (4, "serves 4 people", True),  # digit, grounded
        (4, "serves four people", True),  # English number word
        (4, "no mention of servings anywhere", False),  # silent, English -- rejected
        (4, "यह रेसिपी चार लोगों के लिए है", True),  # Hindi number word (Devanagari)
        (4, "ye recipe chaar logon ke liye hai", True),  # Hindi number word (romanized)
        (4, "यह रेसिपी आठ लोगों के लिए है", False),  # Hindi source, but states 8 (aath), not 4
        (4, "दाल को अच्छे से धो लें और पकाएं", False),  # Hindi source, no serving info at all
        # the digit appears ONLY inside the transcript section -- not structured
        # metadata, so it does not ground the claim on its own (still rejected,
        # since this corpus is otherwise plain English with no number word either)
        (4, "Title: Test\n\nTranscript (auto, en):\n\nthis recipe serves 4", False),
        # same shape, but the digit is in the non-transcript part -- grounded
        (4, "Title: Serves 4\n\nTranscript (auto, en):\n\nwelcome back to my kitchen", True),
        # a Hindi number word IS honored inside the transcript (unlike a bare
        # digit) -- that's the whole point of the word-list checks running against
        # the full corpus, not the non-transcript-only one
        (4, "Title: Test\n\nTranscript (auto, hi):\n\nचार लोगों के लिए", True),
    ],
)
def test_verify_servings(claimed_servings: int, corpus: str, expected: bool) -> None:
    assert _verify_servings(claimed_servings, corpus) is expected


def test_non_transcript_corpus_strips_everything_from_the_transcript_label_onward() -> None:
    corpus = "Title: Test\n\nDescription: serves 4\n\nTranscript (auto, en):\n\nfour people"
    assert _non_transcript_corpus(corpus) == "Title: Test\n\nDescription: serves 4\n\n"


def test_non_transcript_corpus_is_unchanged_when_there_is_no_transcript() -> None:
    corpus = "Title: Test\n\nDescription: serves 4"
    assert _non_transcript_corpus(corpus) == corpus
