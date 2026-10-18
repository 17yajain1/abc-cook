"""The OpenAI adapter's streamed call and its stall watchdog (PR-S2a). Offline.

These run the real SDK (`openai.Stream`) over an `httpx.MockTransport` that serves
server-sent events, so the wire request, the chunk parsing and `Stream.close()` from the
watchdog thread are the real code paths. No key, no network, no spend.
"""

from __future__ import annotations

import json
import logging
import threading
from typing import Any

import httpx
import pydantic
import pytest
from stream_fakes import (
    content_chunk,
    events,
    finish_chunk,
    scripted_adapter,
    sse,
    usage_chunk,
)

from abc_cook.extract.adapters.base import (
    MAX_RETRIES,
    STREAM_EXTRACTION_ENV,
    STREAM_IDLE_TIMEOUT_S,
    STRICT_EXTRACTION_ENV,
    request_timeout_s,
    stream_extraction_enabled,
)
from abc_cook.extract.adapters.openai import OpenAIAdapter
from abc_cook.extract.adapters.prompting import system_prompt
from abc_cook.extract.normalize import ESCALATED_MAX_TOKENS, MAX_TOKENS


class _Out(pydantic.BaseModel):
    x: int


def _extract(adapter: OpenAIAdapter, **kwargs: Any) -> Any:
    params: dict[str, Any] = {
        "prompt": "p",
        "source_text": "s",
        "model": "gpt-test",
        "max_tokens": 1_000,
        "output_type": _Out,
    }
    params.update(kwargs)
    return adapter.extract(**params)


def _watchdogs() -> list[threading.Thread]:
    return [t for t in threading.enumerate() if t.name == "stream-watchdog"]


def test_request_is_the_pre_s2_request_plus_stream_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(STRICT_EXTRACTION_ENV, "0")  # PR-S3's response_format is tested elsewhere
    adapter, recorded = scripted_adapter(
        events(content_chunk('{"x":1}'), finish_chunk(), usage_chunk())
    )
    _extract(adapter, effort="low")
    body = recorded.body
    assert body.pop("stream") is True
    assert body.pop("stream_options") == {"include_usage": True}
    # Everything else is exactly what the blocking call sent: same model, same messages
    # (compared in full, not by hash), same budget, same effort.
    assert body == {
        "model": "gpt-test",
        "messages": [
            {"role": "system", "content": system_prompt("p", _Out)},
            {"role": "user", "content": "s"},
        ],
        "max_completion_tokens": 1_000,
        "reasoning_effort": "low",
    }


def test_effort_omitted_when_not_requested() -> None:
    adapter, recorded = scripted_adapter(
        events(content_chunk('{"x":1}'), finish_chunk(), usage_chunk())
    )
    _extract(adapter)
    assert "reasoning_effort" not in recorded.body


def test_joined_deltas_are_the_text_and_on_text_sees_each_delta() -> None:
    pieces = ['{"', 'x":', "12", "}"]
    adapter, _ = scripted_adapter(
        events(*[content_chunk(p) for p in pieces], finish_chunk(), usage_chunk())
    )
    seen: list[str] = []
    result = _extract(adapter, on_text=seen.append)
    assert result.recipe == _Out(x=12)
    assert seen == pieces


def test_empty_and_role_only_deltas_are_not_forwarded() -> None:
    role_only = {
        "id": "c",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": "m",
        "choices": [{"index": 0, "delta": {"role": "assistant", "content": ""}}],
    }
    adapter, _ = scripted_adapter(
        events(role_only, content_chunk('{"x":3}'), finish_chunk(), usage_chunk())
    )
    seen: list[str] = []
    assert _extract(adapter, on_text=seen.append).recipe == _Out(x=3)
    assert seen == ['{"x":3}']


def test_usage_comes_from_the_final_chunk_cached_and_reasoning_aware() -> None:
    adapter, _ = scripted_adapter(
        events(
            content_chunk('{"x":1}'),
            finish_chunk("stop"),
            usage_chunk(prompt=1_000, completion=300, reasoning=120, cached=400),
        )
    )
    usage = _extract(adapter).usage
    assert usage is not None
    assert usage.input_tokens == 600  # cached tokens are a subset of prompt_tokens
    assert usage.cache_read_input_tokens == 400
    assert usage.output_tokens == 300
    assert usage.reasoning_tokens == 120
    assert usage.stop_reason == "stop"
    assert usage.max_tokens_requested == 1_000
    assert usage.first_content_ms is not None
    assert 0 <= usage.first_content_ms <= usage.latency_ms


def test_missing_reasoning_detail_stays_none() -> None:
    adapter, _ = scripted_adapter(
        events(content_chunk('{"x":1}'), finish_chunk(), usage_chunk(reasoning=None))
    )
    usage = _extract(adapter).usage
    assert usage is not None
    assert usage.reasoning_tokens is None


def test_length_is_a_truncation_with_raw_text_and_usage() -> None:
    adapter, _ = scripted_adapter(
        events(content_chunk('{"x":'), finish_chunk("length"), usage_chunk())
    )
    result = _extract(adapter)
    assert result.truncated is True
    assert result.error_kind == "truncated"
    assert result.error == "max_tokens"
    assert result.raw_text == '{"x":'
    assert result.usage is not None


def test_reasoning_exhausted_stream_is_a_truncation_with_empty_raw_text() -> None:
    adapter, _ = scripted_adapter(events(finish_chunk("length"), usage_chunk(reasoning=1_000)))
    result = _extract(adapter)
    assert result.truncated is True
    assert result.raw_text == ""


def test_unparseable_keeps_raw_text() -> None:
    adapter, _ = scripted_adapter(
        events(content_chunk('{"x": "no"}'), finish_chunk(), usage_chunk())
    )
    result = _extract(adapter)
    assert result.recipe is None
    assert result.error_kind == "unparseable"
    assert result.raw_text == '{"x": "no"}'
    assert result.usage is not None


def test_no_usage_chunk_means_usage_none_with_a_warning(
    caplog: pytest.LogCaptureFixture,
) -> None:
    adapter, _ = scripted_adapter(events(content_chunk('{"x":1}'), finish_chunk()))
    with caplog.at_level(logging.WARNING, logger="abc_cook"):
        result = _extract(adapter)
    assert result.recipe == _Out(x=1)
    assert result.usage is None  # never estimated
    assert any("usage" in r.getMessage() for r in caplog.records)


def test_idle_stream_is_closed_by_the_watchdog_as_infra() -> None:
    script: list[tuple[float, bytes | Exception]] = [
        (0.0, sse(content_chunk('{"x":'))),
        (30.0, sse(content_chunk("1}"))),  # never arrives: the watchdog closes first
    ]
    adapter, recorded = scripted_adapter(script, stream_idle_s=0.3)
    result = _extract(adapter)
    assert result.recipe is None
    assert result.error_kind == "infra"
    assert result.error == "StreamIdleTimeout"
    assert recorded.streams[0].closed.is_set()
    assert len(recorded.requests) == 1  # a mid-stream stall is never re-sent by the SDK
    assert _watchdogs() == []


def test_a_stall_before_any_content_is_also_idle() -> None:
    adapter, _ = scripted_adapter([(30.0, sse(content_chunk("x")))], stream_idle_s=0.3)
    assert _extract(adapter).error == "StreamIdleTimeout"


def test_deadline_closes_a_stream_that_keeps_dripping() -> None:
    script: list[tuple[float, bytes | Exception]] = [
        (0.05, sse(content_chunk("a"))) for _ in range(200)
    ]
    adapter, _ = scripted_adapter(script, stream_idle_s=5.0, stream_deadline_s=0.4)
    result = _extract(adapter)
    assert result.error_kind == "infra"
    assert result.error == "StreamDeadline"
    assert _watchdogs() == []


def test_mid_stream_read_error_is_infra_without_usage() -> None:
    script: list[tuple[float, bytes | Exception]] = [
        (0.0, sse(content_chunk('{"x":'))),
        (0.0, httpx.ReadError("connection reset")),
    ]
    adapter, _ = scripted_adapter(script)
    result = _extract(adapter)
    assert result.recipe is None
    assert result.error_kind == "infra"
    # The SDK wraps a transport error raised while iterating as APIConnectionError.
    assert result.error == "APIConnectionError"
    assert result.usage is None  # FGC-19: a mid-stream failure's spend is unreported
    assert _watchdogs() == []


def test_on_text_that_raises_is_dropped_and_the_call_completes(
    caplog: pytest.LogCaptureFixture,
) -> None:
    adapter, _ = scripted_adapter(
        events(content_chunk('{"x":'), content_chunk("5}"), finish_chunk(), usage_chunk())
    )
    calls: list[str] = []

    def bad(delta: str) -> None:
        calls.append(delta)
        raise RuntimeError("boom")

    with caplog.at_level(logging.WARNING, logger="abc_cook"):
        result = _extract(adapter, on_text=bad)
    assert result.recipe == _Out(x=5)
    assert calls == ['{"x":']  # stopped after the first failure
    assert sum("on_text" in r.getMessage() for r in caplog.records) == 1


def test_watchdog_thread_is_gone_after_a_normal_return() -> None:
    adapter, _ = scripted_adapter(events(content_chunk('{"x":1}'), finish_chunk(), usage_chunk()))
    _extract(adapter)
    assert _watchdogs() == []


def test_http_error_before_the_stream_starts_is_still_classified() -> None:
    adapter, recorded = scripted_adapter(json_response=None)
    adapter._client = adapter._client.with_options(
        http_client=httpx.Client(
            transport=httpx.MockTransport(lambda request: httpx.Response(401, json={}))
        )
    )
    result = _extract(adapter)
    assert result.error_kind == "infra"
    assert result.error == "AuthenticationError (HTTP 401)"
    assert recorded.requests == []


# --- the sizing guards ---------------------------------------------------------------------


def test_idle_bound_clears_the_worst_measured_reasoning_silence() -> None:
    """T2 `low` calls spent 192-1,984 reasoning tokens (pizza's retry) before the first
    visible token: 1,984 / 121 tok/s = 16.4 s. T6 (kadhi) waited 7.7 s. PR-S3's 24 live calls
    (`notes/pr-s3-strict-output/`) saw first-content silences up to 19.3 s (a strict-off croissant
    call; strict-on at most 13.8 s) and inter-delta gaps up to 0.3 s. A healthy call must never
    look idle, so the bound keeps at least 3x headroom over the worst observed. The margin is
    thin: 3 x 19.3 = 57.9 s against 60 s. If a silence over 20 s is ever observed, revisit
    STREAM_IDLE_TIMEOUT_S."""
    assert STREAM_IDLE_TIMEOUT_S >= 3 * 19.3


def test_per_call_deadline_still_has_s1_margin_over_a_legitimate_call() -> None:
    for budget in (MAX_TOKENS, ESCALATED_MAX_TOKENS):
        legitimate_s = budget * 8.3 / 1000 + 8
        assert request_timeout_s(budget) >= 2 * legitimate_s


def test_max_retries_is_unchanged() -> None:
    assert MAX_RETRIES == 1


# --- the kill switch (A1) ------------------------------------------------------------------


def test_default_is_streaming_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(STREAM_EXTRACTION_ENV, raising=False)
    assert stream_extraction_enabled() is True
    assert OpenAIAdapter(api_key="k").streams_text is True


@pytest.mark.parametrize("value", ["0", "false", "off", "OFF", "False", " 0 "])
def test_switch_off_values(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setenv(STREAM_EXTRACTION_ENV, value)
    assert stream_extraction_enabled() is False


@pytest.mark.parametrize("value", ["1", "true", "on", "yes", ""])
def test_anything_else_is_on(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    monkeypatch.setenv(STREAM_EXTRACTION_ENV, value)
    assert stream_extraction_enabled() is True


def test_off_sends_exactly_the_pre_s2_request(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(STREAM_EXTRACTION_ENV, "0")
    monkeypatch.setenv(STRICT_EXTRACTION_ENV, "0")  # PR-S3's response_format is tested elsewhere
    completion = {
        "id": "c",
        "object": "chat.completion",
        "created": 0,
        "model": "gpt-test",
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": '{"x":7}'},
            }
        ],
        "usage": {
            "prompt_tokens": 10,
            "completion_tokens": 20,
            "total_tokens": 30,
            "completion_tokens_details": {"reasoning_tokens": 5},
        },
    }
    adapter, recorded = scripted_adapter(json_response=completion)
    assert adapter.streams_text is False
    seen: list[str] = []
    result = _extract(adapter, effort="low", on_text=seen.append)

    assert result.recipe == _Out(x=7)
    assert seen == []  # on_text is ignored when streaming is off
    body = json.loads(recorded.requests[0].content)
    assert body == {
        "model": "gpt-test",
        "messages": [
            {"role": "system", "content": system_prompt("p", _Out)},
            {"role": "user", "content": "s"},
        ],
        "max_completion_tokens": 1_000,
        "reasoning_effort": "low",
    }
    assert "stream" not in body
    assert "stream_options" not in body
    assert recorded.requests[0].extensions["timeout"]["read"] == request_timeout_s(1_000)
    assert result.usage is not None
    assert result.usage.first_content_ms is None
    assert _watchdogs() == []


def test_off_reads_the_variable_once_at_construction(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(STREAM_EXTRACTION_ENV, "off")
    adapter = OpenAIAdapter(api_key="k")
    monkeypatch.delenv(STREAM_EXTRACTION_ENV)
    assert adapter.streams_text is False
