"""`DraftingAdapter` and the `StreamedDraft` contract (PR-S2a). Offline."""

from __future__ import annotations

import itertools
import logging
import re
from typing import Any

import pytest
from stream_fakes import StreamingFake, recipe_text

from abc_cook.extract.adapters.base import ExtractResult
from abc_cook.extract.adapters.drafting import DraftingAdapter
from abc_cook.extract.draft import DraftScanner
from abc_cook.schema.api import StreamedDraft
from abc_cook.schema.normalized import NormalizedRecipe, RepairProposal


def _run(adapter: DraftingAdapter, output_type: type = NormalizedRecipe) -> Any:
    return adapter.extract(
        prompt="p",
        source_text="s",
        model="m",
        max_tokens=1_000,
        output_type=output_type,
    )


def _draft_adapter(fake: Any) -> tuple[DraftingAdapter, list[StreamedDraft]]:
    drafts: list[StreamedDraft] = []
    return DraftingAdapter(fake, drafts.append, graph_id="g1"), drafts


def _names(draft: StreamedDraft) -> list[str]:
    return [i.name for i in draft.ingredients or []]


def test_streams_ingredients_before_steps_then_completes() -> None:
    text = recipe_text("a", steps=3)
    adapter, drafts = _draft_adapter(StreamingFake([(text, "ok")]))
    result = _run(adapter)

    assert result.recipe is not None
    assert drafts, "no draft was published"
    first_with_ingredients = next(i for i, d in enumerate(drafts) if d.ingredients)
    complete_ingredients = next(i for i, d in enumerate(drafts) if d.ingredients_complete)
    first_with_steps = next(i for i, d in enumerate(drafts) if d.steps)
    assert first_with_ingredients <= complete_ingredients < first_with_steps
    assert drafts[first_with_ingredients].steps == []
    assert len(drafts[first_with_ingredients].ingredients) == 1  # per item, not all at once
    assert drafts[first_with_ingredients].ingredients_complete is False
    for before, after in itertools.pairwise(drafts):
        assert _names(after)[: len(_names(before))] == _names(before)
    # Append-only: each draft's steps are a prefix of the next one's.
    for before, after in itertools.pairwise(drafts):
        assert [s.text for s in after.steps][: len(before.steps)] == [s.text for s in before.steps]
    last = drafts[-1]
    assert last.steps_complete is True
    assert [s.text for s in last.steps] == [s.text for s in result.recipe.steps]
    assert last.ingredients == result.recipe.ingredients
    assert last.calls == 1


def test_fill_never_replace_when_call_one_was_complete() -> None:
    first, second = recipe_text("a"), recipe_text("b")
    fake = StreamingFake([(first, "invalid_json"), (second, "ok")])
    adapter, drafts = _draft_adapter(fake)
    _run(adapter)
    shown = drafts[-1]
    count_after_first = len(drafts)

    _run(adapter)
    # The retry starts: the draft is re-announced with calls=2, and nothing else changes.
    assert len(drafts) == count_after_first + 1
    final = drafts[-1]
    assert final.calls == 2
    assert _names(final) == _names(shown)
    assert _names(final)[0].startswith("a ")
    assert [s.text for s in final.steps] == [s.text for s in shown.steps]
    assert all(s.text.startswith("a ") for s in final.steps)


def test_call_two_fills_sections_call_one_never_reached() -> None:
    # Call 1 got as far as the ingredients; call 2 provides the steps.
    cut = recipe_text("a").index('"steps"')
    first = recipe_text("a")[:cut]
    second = recipe_text("b")
    adapter, drafts = _draft_adapter(StreamingFake([(first, "truncated"), (second, "ok")]))
    _run(adapter)
    assert drafts[-1].ingredients_complete is True
    assert drafts[-1].steps == []

    _run(adapter)
    final = drafts[-1]
    assert final.calls == 2
    assert _names(final)[0].startswith("a ")  # call 1's ingredients stay
    assert final.steps
    assert all(s.text.startswith("b ") for s in final.steps)  # call 2 filled the steps
    assert final.steps_complete is True


def test_a_partial_ingredient_list_stays_and_is_not_extended_by_call_two() -> None:
    first = recipe_text("a", ingredients=2)
    first = first[: first.index('"name":"a oil"') + 8]  # item 1 closed, item 2 half-written
    adapter, drafts = _draft_adapter(
        StreamingFake([(first, "truncated"), (recipe_text("b", ingredients=4), "ok")])
    )
    _run(adapter)
    assert _names(drafts[-1]) == ["a onion"]
    assert drafts[-1].ingredients_complete is False
    _run(adapter)
    assert drafts[-1].calls == 2
    assert _names(drafts[-1]) == ["a onion"]  # call 1 owns the list; its partial stays
    assert drafts[-1].ingredients_complete is False
    assert drafts[-1].steps  # but call 2 fills the steps call 1 never reached


def test_call_one_with_nothing_leaves_no_draft_until_call_two() -> None:
    adapter, drafts = _draft_adapter(
        StreamingFake([('{"title":"x","method', "invalid_json"), (recipe_text("b"), "ok")])
    )
    _run(adapter)
    assert drafts == []
    _run(adapter)
    assert drafts[-1].calls == 2
    assert _names(drafts[-1])[0].startswith("b ")


def test_an_empty_ingredient_list_is_replaced_by_a_later_non_empty_one() -> None:
    first = '{"ingredients":[],"steps":[{"text":"a one"}'
    adapter, drafts = _draft_adapter(
        StreamingFake([(first, "invalid_json"), (recipe_text("b"), "ok")])
    )
    _run(adapter)
    assert drafts[-1].ingredients == []
    assert drafts[-1].ingredients_complete is True
    assert [s.text for s in drafts[-1].steps] == ["a one"]
    _run(adapter)
    assert _names(drafts[-1])[0].startswith("b ")
    assert drafts[-1].ingredients_complete is True
    assert [s.text for s in drafts[-1].steps] == ["a one"]  # steps stay call 1's


def test_steps_complete_is_only_set_by_the_call_that_owns_the_steps() -> None:
    # Call 1 streamed two steps and was cut; call 2 completes a different list.
    partial = recipe_text("a", steps=3)
    partial = partial[: partial.rindex('{"text"')]
    adapter, drafts = _draft_adapter(
        StreamingFake([(partial, "truncated"), (recipe_text("b"), "ok")])
    )
    _run(adapter)
    assert len(drafts[-1].steps) == 2
    assert drafts[-1].steps_complete is False
    _run(adapter)
    assert len(drafts[-1].steps) == 2
    assert drafts[-1].steps_complete is False  # call 1 never finished its list


def test_on_draft_exception_does_not_change_the_result(caplog: pytest.LogCaptureFixture) -> None:
    text = recipe_text("a")
    calls: list[StreamedDraft] = []

    def bad(draft: StreamedDraft) -> None:
        calls.append(draft)
        raise RuntimeError("boom")

    plain = _run(DraftingAdapter(StreamingFake([(text, "ok")]), lambda d: None))
    with caplog.at_level(logging.WARNING, logger="abc_cook"):
        result = _run(DraftingAdapter(StreamingFake([(text, "ok")]), bad))
    assert result.recipe == plain.recipe
    assert len(calls) == 1  # updates stopped at the first failure
    assert sum("on_draft raised" in r.getMessage() for r in caplog.records) == 1


def test_repair_output_type_passes_through_with_no_on_text() -> None:
    fake = StreamingFake([('{"steps":[]}', "invalid_json")])
    adapter, drafts = _draft_adapter(fake)
    _run(adapter, output_type=RepairProposal)
    assert fake.kwargs == [{"output_type": RepairProposal, "on_text": False}]
    assert drafts == []


def test_an_inner_adapter_that_does_not_stream_gets_the_plain_call() -> None:
    class Plain:
        def __init__(self) -> None:
            self.calls = 0

        def extract(  # no on_text parameter: passing it would raise TypeError
            self,
            *,
            prompt: str,
            source_text: str,
            model: str,
            max_tokens: int,
            output_type: type,
            effort: str | None = None,
        ) -> ExtractResult[Any]:
            self.calls += 1
            return ExtractResult(recipe=None, error="x")

    plain = Plain()
    adapter, drafts = _draft_adapter(plain)
    assert adapter.streams_text is False
    assert _run(adapter).error == "x"
    assert plain.calls == 1
    assert drafts == []


def test_a_scanner_failure_is_swallowed(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def explode(self: DraftScanner, delta: str) -> bool:
        raise RuntimeError("scanner bug")

    monkeypatch.setattr(DraftScanner, "feed", explode)
    adapter, drafts = _draft_adapter(StreamingFake([(recipe_text("a"), "ok")]))
    with caplog.at_level(logging.WARNING, logger="abc_cook"):
        result = _run(adapter)
    assert result.recipe is not None
    assert drafts == []
    assert sum("scanner or callback raised" in r.getMessage() for r in caplog.records) == 1


def test_one_info_line_per_extraction_call(caplog: pytest.LogCaptureFixture) -> None:
    fake = StreamingFake([(recipe_text("a"), "invalid_json"), (recipe_text("b"), "ok")])
    adapter, _ = _draft_adapter(fake)
    with caplog.at_level(logging.INFO, logger="abc_cook"):
        _run(adapter)
        _run(adapter)
    lines = [r.getMessage() for r in caplog.records if r.getMessage().startswith("draft: ")]
    assert len(lines) == 2
    assert re.match(
        r"draft: graph_id=g1 call=1 first_content_s=\d+\.\d first_ingredient_s=\d+\.\d "
        r"ingredients_s=\d+\.\d first_step_s=\d+\.\d ingredients=2 steps=3 complete=True "
        r"broken=False",
        lines[0],
    )
    assert "call=2" in lines[1]


# --- the contract --------------------------------------------------------------------------


def test_draft_schema_carries_no_time_fields() -> None:
    forbidden = re.compile(r"min|duration|time|offset|lead|serv|total|timer|start", re.IGNORECASE)
    schema = StreamedDraft.model_json_schema()

    def property_names(node: object) -> list[str]:
        found: list[str] = []
        if isinstance(node, dict):
            props = node.get("properties")
            if isinstance(props, dict):
                found.extend(props)
            for value in node.values():
                found.extend(property_names(value))
        elif isinstance(node, list):
            for value in node:
                found.extend(property_names(value))
        return found

    # `NormalizedIngredient` is reused as-is, so this walks its properties too.
    names = property_names(schema)
    assert {
        "ingredients",
        "ingredients_complete",
        "steps",
        "steps_complete",
        "calls",
        "text",
        "name",
    } <= set(names)
    assert [n for n in names if forbidden.search(n)] == []


def test_duration_fields_in_the_text_never_reach_the_draft() -> None:
    text = (
        '{"ingredients":[],"stated_total_min":45,"servings":4,"steps":[{"text":"Fry",'
        '"duration_min":5,"duration_max":7,"lead_time_min":30,"attention":"passive"}]}'
    )
    adapter, drafts = _draft_adapter(StreamingFake([(text, "invalid_json")]))
    _run(adapter)
    dumped = drafts[-1].model_dump_json()
    for key in ("duration", "lead_time", "stated_total", "attention", "servings", "45"):
        assert key not in dumped
