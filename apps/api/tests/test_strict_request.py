"""The OpenAI adapter's strict structured-output switch, stream and blocking (PR-S3).

Offline: the real SDK over an `httpx.MockTransport`. With strict OFF the request must equal the
frozen pre-S3 body byte for byte (parsed and compared in full); with strict ON the only difference
is the added `response_format`. The prompt and the pasted schema never change.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
from typing import Any

import pydantic
import pytest
from stream_fakes import (
    _chunk,
    content_chunk,
    events,
    finish_chunk,
    scripted_adapter,
    usage_chunk,
)

from abc_cook.extract.adapters.base import (
    STREAM_EXTRACTION_ENV,
    STRICT_EXTRACTION_ENV,
    strict_extraction_enabled,
)
from abc_cook.extract.adapters.openai import OpenAIAdapter
from abc_cook.extract.adapters.prompting import strict_json_schema
from abc_cook.schema.normalized import NormalizedRecipe

_API = Path(__file__).resolve().parents[1]
_BEFORE = Path(__file__).parent / "fixtures" / "request"


@pytest.fixture(autouse=True)
def _added_steps_off(monkeypatch: pytest.MonkeyPatch) -> None:
    """These tests pin the strict switch against the pre-FGC-3 body; `ABC_COOK_ADDED_STEPS` has its
    own tests in `test_added_steps.py`."""
    monkeypatch.setenv("ABC_COOK_ADDED_STEPS", "0")


def _load_dump_script() -> Any:
    spec = importlib.util.spec_from_file_location(
        "dump_extraction_request_under_test", _API / "scripts" / "dump_extraction_request.py"
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


dump = _load_dump_script()


class _Out(pydantic.BaseModel):
    x: int


def _before(stream: bool) -> dict[str, Any]:
    name = f"before-stream-{'on' if stream else 'off'}.json"
    body: dict[str, Any] = json.loads((_BEFORE / name).read_text(encoding="utf-8"))
    return body


def _response_format(output_type: type[pydantic.BaseModel]) -> dict[str, Any]:
    return {
        "type": "json_schema",
        "json_schema": {
            "name": output_type.__name__,
            "strict": True,
            "schema": strict_json_schema(output_type),
        },
    }


@pytest.mark.parametrize("stream", [True, False])
def test_strict_off_is_byte_identical_to_the_frozen_before_body(stream: bool) -> None:
    assert dump.capture(stream=stream, strict=False) == _before(stream)


@pytest.mark.parametrize("stream", [True, False])
def test_strict_on_adds_exactly_response_format(stream: bool) -> None:
    body = dump.capture(stream=stream, strict=True)
    expected = _before(stream)
    expected["response_format"] = _response_format(NormalizedRecipe)
    assert body == expected
    # The prompt, including the pasted schema, is untouched (option A).
    assert body["messages"] == _before(stream)["messages"]


@pytest.mark.parametrize("stream", [True, False])
def test_unset_switch_means_strict_on(stream: bool) -> None:
    assert dump.capture(stream=stream, strict=None) == dump.capture(stream=stream, strict=True)


def test_strict_switch_parsing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(STRICT_EXTRACTION_ENV, raising=False)
    assert strict_extraction_enabled() is True
    for off in ("0", "false", "FALSE", "off", " Off "):
        monkeypatch.setenv(STRICT_EXTRACTION_ENV, off)
        assert strict_extraction_enabled() is False
    for on in ("1", "true", "on", ""):
        monkeypatch.setenv(STRICT_EXTRACTION_ENV, on)
        assert strict_extraction_enabled() is True


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


def test_switch_is_read_once_at_construction(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(STRICT_EXTRACTION_ENV, "0")
    adapter, recorded = scripted_adapter(
        events(content_chunk('{"x":1}'), finish_chunk(), usage_chunk())
    )
    monkeypatch.setenv(STRICT_EXTRACTION_ENV, "1")
    _extract(adapter)
    assert "response_format" not in recorded.body


def test_strict_on_names_the_output_type(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(STRICT_EXTRACTION_ENV, "1")
    adapter, recorded = scripted_adapter(
        events(content_chunk('{"x":1}'), finish_chunk(), usage_chunk())
    )
    result = _extract(adapter)
    assert result.recipe == _Out(x=1)
    assert recorded.body["response_format"] == _response_format(_Out)


# --- streaming: length, refusal, content filter -----------------------------------------------


def _refusal_chunk(text: str) -> dict[str, Any]:
    return _chunk({"refusal": text})


def test_stream_length_is_truncated_under_strict(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(STRICT_EXTRACTION_ENV, "1")
    adapter, _ = scripted_adapter(
        events(content_chunk('{"x":'), finish_chunk("length"), usage_chunk())
    )
    result = _extract(adapter)
    assert result.truncated is True
    assert result.error_kind == "truncated"


def test_stream_refusal_is_refused_with_usage_and_no_retryable_kind(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(STRICT_EXTRACTION_ENV, "1")
    adapter, _ = scripted_adapter(
        events(
            _refusal_chunk("I can't "),
            _refusal_chunk("help with that."),
            finish_chunk("stop"),
            usage_chunk(prompt=500, completion=20, reasoning=5),
        )
    )
    result = _extract(adapter)
    assert result.recipe is None
    assert result.error_kind == "refused"
    assert result.usage is not None
    assert result.usage.output_tokens == 20
    # The refusal text is the model's words about the source: kept out of `error`.
    assert result.error is not None
    assert "help with that" not in result.error


def test_stream_content_filter_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(STRICT_EXTRACTION_ENV, "1")
    adapter, _ = scripted_adapter(events(finish_chunk("content_filter"), usage_chunk()))
    result = _extract(adapter)
    assert result.error_kind == "refused"
    assert result.usage is not None


def test_stream_refusal_after_partial_content_is_still_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(STRICT_EXTRACTION_ENV, "1")
    adapter, _ = scripted_adapter(
        events(content_chunk('{"x":'), _refusal_chunk("no"), finish_chunk(), usage_chunk())
    )
    assert _extract(adapter).error_kind == "refused"


def test_strict_off_does_not_look_for_refusals(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(STRICT_EXTRACTION_ENV, "0")
    adapter, _ = scripted_adapter(events(finish_chunk("content_filter"), usage_chunk()))
    result = _extract(adapter)
    assert result.error_kind == "unparseable"  # today's behaviour, unchanged


# --- blocking ---------------------------------------------------------------------------------


def _blocking(message: dict[str, Any], finish: str = "stop") -> dict[str, Any]:
    return {
        "id": "c",
        "object": "chat.completion",
        "created": 0,
        "model": "m",
        "choices": [
            {"index": 0, "finish_reason": finish, "message": {"role": "assistant", **message}}
        ],
        "usage": {
            "prompt_tokens": 100,
            "completion_tokens": 7,
            "total_tokens": 107,
            "prompt_tokens_details": {"cached_tokens": 0},
            "completion_tokens_details": {"reasoning_tokens": 1},
        },
    }


def test_blocking_parse_ok_and_length(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(STREAM_EXTRACTION_ENV, "0")
    monkeypatch.setenv(STRICT_EXTRACTION_ENV, "1")
    adapter, recorded = scripted_adapter(json_response=_blocking({"content": '{"x":4}'}))
    assert _extract(adapter).recipe == _Out(x=4)
    assert "stream" not in recorded.body
    assert recorded.body["response_format"] == _response_format(_Out)
    cut, _ = scripted_adapter(json_response=_blocking({"content": '{"x":'}, "length"))
    assert _extract(cut).error_kind == "truncated"


def test_blocking_message_refusal_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(STREAM_EXTRACTION_ENV, "0")
    monkeypatch.setenv(STRICT_EXTRACTION_ENV, "1")
    adapter, _ = scripted_adapter(json_response=_blocking({"content": None, "refusal": "nope"}))
    result = _extract(adapter)
    assert result.error_kind == "refused"
    assert result.usage is not None


def test_blocking_content_filter_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(STREAM_EXTRACTION_ENV, "0")
    monkeypatch.setenv(STRICT_EXTRACTION_ENV, "1")
    adapter, _ = scripted_adapter(json_response=_blocking({"content": None}, "content_filter"))
    assert _extract(adapter).error_kind == "refused"


# --- request errors (Q6): 429 and 5xx stay infra; any other 4xx is a request error --------------


@pytest.mark.parametrize(
    ("status", "kind"),
    [
        (400, "request"),
        (404, "request"),
        (422, "request"),
        (429, "infra"),
        (500, "infra"),
        (503, "infra"),
    ],
)
def test_error_classification(status: int, kind: str, monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    monkeypatch.setenv(STRICT_EXTRACTION_ENV, "1")
    adapter, _ = scripted_adapter(events())
    adapter._client = adapter._client.with_options(
        http_client=httpx.Client(
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    status, json={"error": {"message": "x", "type": "t", "code": "c"}}
                )
            )
        ),
        max_retries=0,
    )
    result = _extract(adapter)
    assert result.error_kind == kind
    assert result.recipe is None
    assert result.usage is None


def test_context_length_400_is_a_request_error(monkeypatch: pytest.MonkeyPatch) -> None:
    import httpx

    monkeypatch.setenv(STRICT_EXTRACTION_ENV, "1")
    adapter, _ = scripted_adapter(events())
    body = {
        "error": {
            "message": "context_length_exceeded",
            "type": "invalid_request_error",
            "code": "context_length_exceeded",
        }
    }
    adapter._client = adapter._client.with_options(
        http_client=httpx.Client(
            transport=httpx.MockTransport(lambda request: httpx.Response(400, json=body))
        ),
        max_retries=0,
    )
    assert _extract(adapter).error_kind == "request"


def test_unparseable_under_strict_logs_a_contract_violation(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    import logging

    monkeypatch.setenv(STRICT_EXTRACTION_ENV, "1")
    adapter, _ = scripted_adapter(
        events(content_chunk("not json at all"), finish_chunk(), usage_chunk())
    )
    with caplog.at_level(logging.WARNING, logger="abc_cook.extract.adapters.openai"):
        result = _extract(adapter)
    assert result.error_kind == "unparseable"  # still retryable once by normalize()
    assert any("strict contract violation" in r.getMessage() for r in caplog.records)


def test_unparseable_without_strict_does_not_log_a_contract_violation(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    import logging

    monkeypatch.setenv(STRICT_EXTRACTION_ENV, "0")
    adapter, _ = scripted_adapter(
        events(content_chunk("not json at all"), finish_chunk(), usage_chunk())
    )
    with caplog.at_level(logging.WARNING, logger="abc_cook.extract.adapters.openai"):
        _extract(adapter)
    assert not any("strict contract violation" in r.getMessage() for r in caplog.records)
