"""extract/normalize.py -- the Tier 0 gate and the retry-once-then-degrade logic.

Offline: a fake `LLMAdapter` stands in for the provider, per
docs/M2.9-youtube-import-design.md §8.1 ("normalize.py without the LLM: the Tier 0
gate and chapter parsing are pure functions... tested as such"). The LLM-dependent
structuring itself is exercised at tier 3 (`@pytest.mark.llm`), not here.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import pytest

from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.adapters.base import CallUsage, EffortLevel, ExtractResult
from abc_cook.extract.normalize import (
    EXTRACTION_EFFORT,
    EXTRACTION_EFFORT_CEILING,
    normalize,
    render_source_text,
)
from abc_cook.schema.normalized import NormalizedIngredient, NormalizedRecipe, NormalizedStep


def _raw(**overrides: object) -> RawAcquisition:
    defaults: dict[str, object] = {
        "source_url": "https://youtu.be/test",
        "title": "Test Recipe",
        "description": "1 onion, chopped. Heat oil, add onion, cook until golden. Serve hot.",
    }
    defaults.update(overrides)
    return RawAcquisition(**defaults)  # type: ignore[arg-type]


def _ingredients_only_recipe(*, method_grounded_claim: bool = True) -> NormalizedRecipe:
    """A recipe the model mis-self-reports as grounded despite an empty step list --
    the exact §10.C finding 1 shape this gate exists to catch."""
    return NormalizedRecipe(
        title="Test Recipe",
        method_grounded=method_grounded_claim,
        ingredients=[
            NormalizedIngredient(name="Onion", qty="1", unit="medium", prep_note="chopped")
        ],
        steps=[],
    )


def _grounded_recipe() -> NormalizedRecipe:
    return NormalizedRecipe(
        title="Test Recipe",
        method_grounded=True,
        ingredients=[
            NormalizedIngredient(name="Onion", qty="1", unit="medium", prep_note="chopped")
        ],
        steps=[
            NormalizedStep(
                text="Heat oil, add onion, cook until golden.",
                attention="hands_on",
                duration_stated=False,
                station="burner",
                interruptible=False,
                freshness="none",
            )
        ],
    )


@dataclass
class _FakeAdapter:
    """Returns queued `ExtractResult`s in order, one per `.extract()` call."""

    results: list[ExtractResult]
    calls: int = 0

    def extract(
        self,
        *,
        prompt: str,
        source_text: str,
        model: str,
        max_tokens: int,
        output_type: type,
        effort: str | None = None,
    ) -> ExtractResult:
        result = self.results[self.calls]
        self.calls += 1
        return result


def test_render_source_text_includes_title_and_description() -> None:
    text = render_source_text(_raw())
    assert "Test Recipe" in text
    assert "onion" in text.lower()


def test_render_source_text_includes_blog_recipe_when_present() -> None:
    raw = _raw(blog_recipe={"@type": "Recipe", "recipeIngredient": ["1 onion"]})
    text = render_source_text(raw)
    assert "recipeIngredient" in text


def test_render_source_text_labels_auto_generated_transcript() -> None:
    raw = _raw(
        transcript="cover and cook for five minutes", transcript_kind="auto", transcript_lang="hi"
    )
    text = render_source_text(raw)
    assert "Transcript (auto-generated captions, hi):" in text
    assert "cover and cook for five minutes" in text


def test_render_source_text_labels_manual_transcript() -> None:
    raw = _raw(
        transcript="cover and cook for five minutes", transcript_kind="manual", transcript_lang="en"
    )
    text = render_source_text(raw)
    assert "Transcript (creator subtitles, en):" in text


def test_render_source_text_omits_transcript_block_when_absent() -> None:
    text = render_source_text(_raw())
    assert "Transcript" not in text


def test_tier0_gate_ignores_models_own_method_grounded_claim() -> None:
    """§10.C finding 1: the model's structured method_grounded field is untrustworthy
    even when it claims True -- normalize.py must recompute from bool(steps)."""
    adapter = _FakeAdapter(
        results=[ExtractResult(recipe=_ingredients_only_recipe(method_grounded_claim=True))]
    )
    outcome = normalize(_raw(), adapter)
    assert outcome.method_grounded is False
    assert outcome.tier0_result is not None
    assert outcome.tier0_result.status == "method_not_grounded"
    assert outcome.tier0_result.ingredients[0].name == "Onion"
    assert outcome.tier0_result.graph is None
    assert outcome.recipe is None
    assert adapter.calls == 1  # exactly one LLM call for a grounded structural response


def test_grounded_recipe_passes_through() -> None:
    adapter = _FakeAdapter(results=[ExtractResult(recipe=_grounded_recipe())])
    outcome = normalize(_raw(), adapter)
    assert outcome.method_grounded is True
    assert outcome.recipe is not None
    assert outcome.tier0_result is None
    assert adapter.calls == 1


def test_truncated_first_attempt_retries_once() -> None:
    adapter = _FakeAdapter(
        results=[
            ExtractResult(recipe=None, truncated=True, error="max_tokens"),
            ExtractResult(recipe=_grounded_recipe()),
        ]
    )
    outcome = normalize(_raw(), adapter)
    assert adapter.calls == 2
    assert outcome.method_grounded is True


def test_two_failed_attempts_degrade_to_tier0() -> None:
    adapter = _FakeAdapter(
        results=[
            ExtractResult(recipe=None, error="boom"),
            ExtractResult(recipe=None, error="boom again"),
        ]
    )
    outcome = normalize(_raw(), adapter)
    assert adapter.calls == 2  # never a third attempt
    assert outcome.recipe is None
    assert outcome.tier0_result is not None
    assert outcome.tier0_result.status == "method_not_grounded"
    assert outcome.tier0_result.ingredients == []
    assert outcome.tier0_result.warnings  # explains why, for logs/debugging


# --- PR-S1 A3/A4: truthful failed results, WARNING logs, effort ceiling -------------------

_SECRET = "sk-test-SECRET"


def _usage(
    *, output: int = 16_000, reasoning: int | None = None, stop: str = "length"
) -> CallUsage:
    return CallUsage(
        model="gpt-5-mini",
        input_tokens=100,
        output_tokens=output,
        cache_read_input_tokens=0,
        cache_creation_input_tokens=None,
        stop_reason=stop,
        latency_ms=1.0,
        max_tokens_requested=16_000,
        reasoning_tokens=reasoning,
    )


def _empty_truncation() -> ExtractResult:
    """The chole shape: the whole budget went on reasoning, nothing visible came back."""
    return ExtractResult(
        recipe=None,
        truncated=True,
        error="max_tokens",
        error_kind="truncated",
        usage=_usage(reasoning=16_000),
        raw_text="",
    )


def _infra() -> ExtractResult:
    return ExtractResult(recipe=None, error="AuthenticationError (HTTP 401)", error_kind="infra")


def _unparseable(text: str = '{"title": "x", "steps": [') -> ExtractResult:
    return ExtractResult(
        recipe=None,
        error="response was not valid NormalizedRecipe JSON",
        error_kind="unparseable",
        usage=_usage(output=1_234, reasoning=900, stop="stop"),
        raw_text=text,
    )


def test_reasoning_exhausted_truncation_is_incomplete_with_one_call() -> None:
    adapter = _FakeAdapter(results=[_empty_truncation()])
    outcome = normalize(_raw(), adapter)
    assert adapter.calls == 1  # no escalation: reasoning would eat the larger budget too
    assert outcome.recipe is None
    result = outcome.tier0_result
    assert result is not None
    assert result.status == "failed"
    assert result.failure == "incomplete"
    joined = " ".join(result.warnings)
    assert "reasoning" in joined
    assert "reasoning_tokens=16000" in joined
    assert "runaway" not in joined


def test_truncation_with_none_raw_text_still_escalates() -> None:
    adapter = _FakeAdapter(
        results=[
            ExtractResult(recipe=None, truncated=True, error="max_tokens"),
            ExtractResult(recipe=_grounded_recipe()),
        ]
    )
    assert normalize(_raw(), adapter).method_grounded is True
    assert adapter.calls == 2


def test_real_repeat_loop_truncation_is_still_runaway() -> None:
    loop = '{"steps":[' + ",".join(['{"text":"Stir the pot."}'] * 4)
    adapter = _FakeAdapter(
        results=[ExtractResult(recipe=None, truncated=True, error="max_tokens", raw_text=loop)]
    )
    outcome = normalize(_raw(), adapter)
    assert adapter.calls == 1
    result = outcome.tier0_result
    assert result is not None
    assert result.status == "method_not_grounded"
    assert result.failure is None
    assert "runaway" in " ".join(result.warnings)


def test_infra_on_the_first_call_is_unavailable_with_no_further_calls() -> None:
    adapter = _FakeAdapter(results=[_infra()])
    outcome = normalize(_raw(), adapter)
    assert adapter.calls == 1
    result = outcome.tier0_result
    assert result is not None
    assert result.status == "failed"
    assert result.failure == "unavailable"
    assert "AuthenticationError (HTTP 401)" in " ".join(result.warnings)


def test_infra_on_the_unparseable_retry_is_unavailable() -> None:
    adapter = _FakeAdapter(results=[_unparseable(), _infra()])
    outcome = normalize(_raw(), adapter)
    assert adapter.calls == 2
    assert outcome.tier0_result is not None
    assert outcome.tier0_result.failure == "unavailable"


def test_infra_on_the_escalation_is_unavailable() -> None:
    plain_truncation = ExtractResult(
        recipe=None, truncated=True, error="max_tokens", raw_text='{"steps":[{"text":"a"}'
    )
    adapter = _FakeAdapter(results=[plain_truncation, _infra()])
    outcome = normalize(_raw(), adapter)
    assert adapter.calls == 2
    assert outcome.escalated is True
    assert outcome.tier0_result is not None
    assert outcome.tier0_result.failure == "unavailable"


def test_unparseable_calls_log_a_warning_with_diagnostics(
    caplog: pytest.LogCaptureFixture,
) -> None:
    head = "H" * 2_100
    tail = "T" * 600
    text = head + tail
    adapter = _FakeAdapter(results=[_unparseable(text), _unparseable(text)])
    with caplog.at_level(logging.WARNING, logger="abc_cook.extract.normalize"):
        normalize(_raw(), adapter)
    records = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(records) == 2  # one per unparseable call
    message = records[0].getMessage()
    assert "gpt-5-mini" in message
    assert "stop_reason=stop" in message
    assert "output_tokens=1234" in message
    assert "reasoning_tokens=900" in message
    assert f"text_len={len(text)}" in message
    assert "invalid JSON" in message  # parse_failure_reason
    assert "H" * 2_000 in message
    assert "H" * 2_001 not in message  # head is capped at 2,000 characters
    assert "T" * 500 in message
    assert "T" * 501 not in message  # tail is capped at 500 characters
    assert _SECRET not in message


def test_infra_failures_are_not_logged_as_unparseable(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.WARNING, logger="abc_cook.extract.normalize"):
        normalize(_raw(), _FakeAdapter(results=[_infra()]))
    assert not [r for r in caplog.records if "unparseable" in r.getMessage().lower()]


def test_effort_ceiling_is_low() -> None:
    assert EXTRACTION_EFFORT_CEILING == "low"
    assert EXTRACTION_EFFORT == EXTRACTION_EFFORT_CEILING


@pytest.mark.parametrize("effort", ["medium", "high", "xhigh", "max", None])
def test_effort_above_the_ceiling_raises_before_any_call(effort: EffortLevel | None) -> None:
    adapter = _FakeAdapter(results=[ExtractResult(recipe=_grounded_recipe())])
    with pytest.raises(ValueError, match="ceiling"):
        normalize(_raw(), adapter, effort=effort)
    assert adapter.calls == 0


@pytest.mark.parametrize("effort", ["minimal", "low"])
def test_effort_at_or_below_the_ceiling_passes(effort: EffortLevel) -> None:
    adapter = _FakeAdapter(results=[ExtractResult(recipe=_grounded_recipe())])
    assert normalize(_raw(), adapter, effort=effort).method_grounded is True


@pytest.mark.parametrize("effort", ["medium", "max", None])
def test_bench_flag_allows_an_effort_above_the_ceiling(effort: EffortLevel | None) -> None:
    adapter = _FakeAdapter(results=[ExtractResult(recipe=_grounded_recipe())])
    outcome = normalize(_raw(), adapter, effort=effort, allow_effort_above_ceiling=True)
    assert outcome.method_grounded is True


# --- PR-S3: refusals and request errors ---------------------------------------------------------


def _refused() -> ExtractResult:
    return ExtractResult(
        recipe=None,
        error="the model declined to answer",
        error_kind="refused",
        usage=_usage(output=20, reasoning=5, stop="stop"),
    )


def _request_error() -> ExtractResult:
    return ExtractResult(recipe=None, error="BadRequestError (HTTP 400)", error_kind="request")


def test_a_refusal_is_failed_refused_with_one_call_and_never_tier0() -> None:
    adapter = _FakeAdapter(results=[_refused()])
    outcome = normalize(_raw(), adapter)
    assert adapter.calls == 1  # no retry
    assert outcome.recipe is None
    result = outcome.tier0_result
    assert result is not None
    assert result.status == "failed"
    assert result.failure == "refused"
    assert len(outcome.calls) == 1  # its usage is kept, so the cost is reported


def test_a_refusal_on_the_escalation_is_refused() -> None:
    plain_truncation = ExtractResult(
        recipe=None, truncated=True, error="max_tokens", raw_text='{"steps":[{"text":"a"}'
    )
    adapter = _FakeAdapter(results=[plain_truncation, _refused()])
    outcome = normalize(_raw(), adapter)
    assert adapter.calls == 2
    assert outcome.tier0_result is not None
    assert outcome.tier0_result.failure == "refused"


def test_a_request_error_is_unavailable_with_one_call(caplog: pytest.LogCaptureFixture) -> None:
    adapter = _FakeAdapter(results=[_request_error()])
    with caplog.at_level(logging.WARNING, logger="abc_cook.extract.normalize"):
        outcome = normalize(_raw(), adapter)
    assert adapter.calls == 1  # no unparseable-style retry of a rejected request
    result = outcome.tier0_result
    assert result is not None
    assert result.status == "failed"
    assert result.failure == "unavailable"
    assert any("HTTP 400" in r.getMessage() for r in caplog.records if r.levelno == logging.WARNING)


def test_a_request_error_on_the_retry_is_unavailable() -> None:
    adapter = _FakeAdapter(results=[_unparseable(), _request_error()])
    outcome = normalize(_raw(), adapter)
    assert adapter.calls == 2
    assert outcome.tier0_result is not None
    assert outcome.tier0_result.failure == "unavailable"


def test_unparseable_still_gets_exactly_one_retry() -> None:
    adapter = _FakeAdapter(results=[_unparseable(), ExtractResult(recipe=_grounded_recipe())])
    outcome = normalize(_raw(), adapter)
    assert adapter.calls == 2
    assert outcome.method_grounded is True
