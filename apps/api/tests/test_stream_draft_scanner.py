"""`DraftScanner`: the incremental partial-JSON reader behind the streamed draft (PR-S2a).

Offline and deterministic. The replay texts are the compact JSON the extraction prompt asks
for (`ImportOriginal.recipe.model_dump_json()`), plus one long Hindi-source recipe.
"""

from __future__ import annotations

import json
import random
from pathlib import Path

import pytest

from abc_cook.extract.adapters.prompting import parse
from abc_cook.extract.draft import (
    MAX_DRAFT_INGREDIENTS,
    MAX_DRAFT_STEPS,
    MAX_STEP_TEXT_CHARS,
    DraftScanner,
)
from abc_cook.schema.normalized import ImportOriginal, NormalizedRecipe

FIXTURES = Path(__file__).parent / "fixtures"
ORIGINALS = (
    "import/kadhi-pakora",
    "import/croissant",
    "import/pumpkin-pancakes",
    "import/known-wrong/vanilla-cupcakes",
)


def _replay_texts() -> dict[str, str]:
    texts: dict[str, str] = {}
    for name in ORIGINALS:
        original = ImportOriginal.model_validate_json(
            (FIXTURES / f"{name}.original.json").read_text(encoding="utf-8")
        )
        texts[name] = original.recipe.model_dump_json()
    chole = NormalizedRecipe.model_validate_json(
        (FIXTURES / "stream" / "chole-bhature.low.normalized.json").read_text(encoding="utf-8")
    )
    texts["stream/chole-bhature"] = chole.model_dump_json()
    return texts


TEXTS = _replay_texts()


def _final(text: str) -> NormalizedRecipe:
    recipe = parse(text, NormalizedRecipe)
    assert recipe is not None
    return recipe


def _feed_all(text: str, sizes: list[int] | None = None) -> DraftScanner:
    scanner = DraftScanner()
    if sizes is None:
        scanner.feed(text)
        return scanner
    i = 0
    for size in sizes:
        scanner.feed(text[i : i + size])
        i += size
    scanner.feed(text[i:])
    return scanner


@pytest.mark.parametrize("name", TEXTS)
def test_every_truncation_boundary_is_a_prefix_of_the_final(name: str) -> None:
    text = TEXTS[name]
    final = _final(text)
    final_steps = [s.text for s in final.steps]
    scanner = DraftScanner()
    seen_ingredients = False
    for ch in text:
        scanner.feed(ch)
        assert not scanner.broken
        if scanner.ingredients is None:
            assert not seen_ingredients
        else:
            seen_ingredients = True
            assert scanner.ingredients == final.ingredients
        assert scanner.steps == final_steps[: len(scanner.steps)]
    assert scanner.ingredients == final.ingredients
    assert scanner.steps == final_steps
    assert scanner.steps_complete


@pytest.mark.parametrize("name", TEXTS)
def test_chunking_does_not_change_the_milestones(name: str) -> None:
    text = TEXTS[name]
    rng = random.Random(7)
    reference = _feed_all(text)
    for _ in range(5):
        sizes = [rng.randint(1, 40) for _ in range(len(text) // 3)]
        chunked = _feed_all(text, sizes)
        assert chunked.ingredients == reference.ingredients
        assert chunked.steps == reference.steps
        assert chunked.steps_complete == reference.steps_complete


def test_escapes_split_across_chunks_decode_the_same() -> None:
    text = json.dumps(
        {
            "ingredients": [],
            "steps": [{"text": "Fry कढ़ी \U0001f600 and \"stir\" \\ done\n"}],
        }
    )  # ensure_ascii=True: \uXXXX escapes and a surrogate pair
    assert "\\ud83d\\ude00" in text
    expected = ["Fry कढ़ी \U0001f600 and \"stir\" \\ done\n"]
    for size in range(1, 9):
        scanner = DraftScanner()
        for i in range(0, len(text), size):
            scanner.feed(text[i : i + size])
        assert scanner.steps == expected
        assert not scanner.broken


def test_raw_devanagari_and_emoji_survive() -> None:
    text = (
        '{"ingredients":[{"name":"लाल मिर्च \U0001f336",'
        '"qty":"1","unit":null,"prep_note":null}],"steps":[{"text":"तेल गरम '
        'करें"}]}'
    )
    scanner = _feed_all(text)
    assert scanner.ingredients is not None
    assert scanner.ingredients[0].name == "लाल मिर्च \U0001f336"
    assert scanner.steps == ["तेल गरम करें"]


def test_names_with_quotes_and_backslashes() -> None:
    payload = {
        "ingredients": [
            {"name": 'Chef\'s "special" \\ salt', "qty": "1", "unit": None, "prep_note": None}
        ],
        "steps": [{"text": 'Say "hi" \\ and ] } { go'}],
    }
    scanner = _feed_all(json.dumps(payload, ensure_ascii=False))
    assert scanner.ingredients is not None
    assert scanner.ingredients[0].name == 'Chef\'s "special" \\ salt'
    assert scanner.steps == ['Say "hi" \\ and ] } { go']
    assert not scanner.broken


def test_brackets_inside_strings_do_not_confuse_the_scanner() -> None:
    text = '{"title":"a ] } [ {","ingredients":[],"steps":[{"text":"x [ y"},{"text":"z"}]}'
    scanner = _feed_all(text)
    assert scanner.ingredients == []
    assert scanner.steps == ["x [ y", "z"]
    assert scanner.steps_complete


def test_code_fence_prefix_is_skipped() -> None:
    text = '```json\n{"ingredients":[],"steps":[{"text":"a"}]}\n```'
    scanner = _feed_all(text)
    assert scanner.ingredients == []
    assert scanner.steps == ["a"]
    assert not scanner.broken


@pytest.mark.parametrize(
    "text",
    [
        "Sure! Here is the recipe: " + '{"ingredients":[]}',
        '{"ingredients":[]]',
        '{"steps":[{"text":"a"}}',
    ],
)
def test_structural_garbage_sets_broken(text: str) -> None:
    scanner = _feed_all(text)
    assert scanner.broken


def test_milestones_before_a_break_are_kept() -> None:
    text = '{"ingredients":[],"steps":[{"text":"first"},{"text":"second"}}'
    scanner = _feed_all(text)
    assert scanner.broken
    assert scanner.ingredients == []
    assert scanner.steps == ["first", "second"]
    assert not scanner.steps_complete
    # A broken scanner stops advancing: nothing later can change the draft.
    assert scanner.feed(',{"text":"third"}]}') is False
    assert scanner.steps == ["first", "second"]


def test_invalid_unicode_escape_breaks_without_raising() -> None:
    scanner = _feed_all('{"ingredients":[],"steps":[{"text":"a"},{"text":"bad \\u12zz"},{"text":"c"}]}')
    assert scanner.broken
    assert scanner.steps == ["a"]


def test_feed_reports_milestones() -> None:
    scanner = DraftScanner()
    assert scanner.feed('{"title":"t","ingredients":[') is False
    assert scanner.feed('{"name":"a","qty":null,"unit":null,"prep_note":null}') is False
    assert scanner.feed("]") is True  # ingredients closed
    assert scanner.feed(',"steps":[{"text":"one"') is False  # text closed? not yet: object open
    assert scanner.feed(',"label":"x"}') is False
    assert scanner.feed(',{"text":"two"}') is True
    assert scanner.feed("]") is True  # steps_complete
    assert scanner.steps == ["one", "two"]


def test_text_closes_the_step_milestone_even_if_the_object_stays_open() -> None:
    scanner = DraftScanner()
    assert scanner.feed('{"steps":[{"text":"one"') is True
    assert scanner.steps == ["one"]


def test_empty_and_missing_ingredients() -> None:
    assert _feed_all('{"ingredients":[],"steps":[]}').ingredients == []
    assert _feed_all('{"steps":[{"text":"a"}]}').ingredients is None
    assert _feed_all('{"ingredients":[{"name":"a"').ingredients is None


def test_invalid_ingredient_items_are_skipped() -> None:
    text = (
        '{"ingredients":[{"name":"salt","qty":"1","unit":"tsp","prep_note":null},'
        '{"qty":"2"},"junk",{"name":"oil","qty":null,"unit":null,"prep_note":null}],"steps":[]}'
    )
    scanner = _feed_all(text)
    assert scanner.ingredients is not None
    assert [i.name for i in scanner.ingredients] == ["salt", "oil"]


def test_step_without_text_is_skipped_and_text_need_not_come_first() -> None:
    text = (
        '{"steps":[{"label":"a","attention":"hands_on"},'
        '{"label":"b","text":"has text","duration_min":3},{"text":"second"}]}'
    )
    scanner = _feed_all(text)
    assert scanner.steps == ["has text", "second"]
    assert scanner.steps_complete


def test_text_in_a_nested_object_is_not_a_step() -> None:
    text = '{"steps":[{"meta":{"text":"nested"},"text":"real"}]}'
    assert _feed_all(text).steps == ["real"]


def test_first_duplicate_top_level_key_wins() -> None:
    text = (
        '{"ingredients":[{"name":"a","qty":null,"unit":null,"prep_note":null}],'
        '"steps":[{"text":"one"}],'
        '"ingredients":[{"name":"b","qty":null,"unit":null,"prep_note":null}],'
        '"steps":[{"text":"two"}]}'
    )
    scanner = _feed_all(text)
    assert scanner.ingredients is not None
    assert [i.name for i in scanner.ingredients] == ["a"]
    assert scanner.steps == ["one"]


def test_caps() -> None:
    ingredients = [
        {"name": f"i{n}", "qty": None, "unit": None, "prep_note": None}
        for n in range(MAX_DRAFT_INGREDIENTS + 5)
    ]
    steps = [{"text": f"s{n}"} for n in range(MAX_DRAFT_STEPS + 5)]
    scanner = _feed_all(json.dumps({"ingredients": ingredients, "steps": steps}))
    assert scanner.ingredients is not None
    assert len(scanner.ingredients) == MAX_DRAFT_INGREDIENTS
    assert len(scanner.steps) == MAX_DRAFT_STEPS
    long_text = "x" * (MAX_STEP_TEXT_CHARS + 500)
    clipped = _feed_all(json.dumps({"steps": [{"text": long_text}]}))
    assert clipped.steps == ["x" * MAX_STEP_TEXT_CHARS]


def test_a_lone_surrogate_cannot_poison_the_payload() -> None:
    scanner = _feed_all('{"steps":[{"text":"a \\ud83d b"}]}')
    assert len(scanner.steps) == 1
    scanner.steps[0].encode("utf-8")  # must not raise
