"""Provider adapters under a hung provider: bounded time, one retry, never a raise.

Offline: an `httpx.MockTransport` stands in for the network and times out every
request, so these run in the default suite without credentials.
"""

from __future__ import annotations

import types
from typing import Any

import anthropic
import httpx
import httpx2
import openai
import pydantic
import pytest
from stream_fakes import NsStream, ns_chunks

from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.adapters.anthropic import AnthropicAdapter
from abc_cook.extract.adapters.base import MAX_RETRIES, STREAM_READ_TIMEOUT_S, request_timeout_s
from abc_cook.extract.adapters.openai import OpenAIAdapter
from abc_cook.extract.adapters.prompting import parse_failure_reason
from abc_cook.extract.normalize import ESCALATED_MAX_TOKENS, MAX_TOKENS, normalize


class _Out(pydantic.BaseModel):
    x: int


def _timing_out_transport(seen: list[Any], lib: Any = httpx) -> Any:
    """`lib` is `httpx` for the OpenAI SDK, `httpx2` for the Anthropic SDK."""

    def handler(request: Any) -> Any:
        seen.append(request)
        raise lib.ReadTimeout("simulated hang", request=request)

    return lib.MockTransport(handler)


def _assert_bounded(seen: list[Any], max_tokens: int, *, streaming: bool = False) -> None:
    assert len(seen) == 1 + MAX_RETRIES
    # A streaming call is bounded by the httpx backstop plus the watchdog; the blocking
    # call (anthropic, or openai with the kill switch) by `request_timeout_s`.
    expected = STREAM_READ_TIMEOUT_S if streaming else request_timeout_s(max_tokens)
    for request in seen:
        assert request.extensions["timeout"]["read"] == expected


def test_openai_adapter_times_out_into_an_error_result() -> None:
    seen: list[Any] = []
    adapter = OpenAIAdapter(api_key="test")
    adapter._client = adapter._client.with_options(
        http_client=httpx.Client(transport=_timing_out_transport(seen))
    )

    result = adapter.extract(
        prompt="p", source_text="s", model="gpt-5-mini", max_tokens=16_000, output_type=_Out
    )

    assert result.recipe is None
    assert result.error is not None
    assert "Timeout" in result.error
    _assert_bounded(seen, 16_000, streaming=True)


def test_anthropic_adapter_times_out_into_an_error_result() -> None:
    seen: list[Any] = []
    adapter = AnthropicAdapter(api_key="test")
    adapter._client = adapter._client.with_options(
        http_client=httpx2.Client(transport=_timing_out_transport(seen, httpx2))
    )

    result = adapter.extract(
        prompt="p", source_text="s", model="claude-sonnet-5", max_tokens=8_000, output_type=_Out
    )

    assert result.recipe is None
    assert result.error is not None
    assert "Timeout" in result.error
    _assert_bounded(seen, 8_000)


# --- PR-S1 A2: classify provider errors where the call is made (FGC-2, FGC-13) ----------

_SECRET = "sk-test-SECRET"
_REQ = httpx2.Request("POST", "https://provider.invalid/v1")


def _status_exc(lib: Any, cls_name: str, status: int) -> Exception:
    response = httpx2.Response(status, request=_REQ)
    cls = getattr(lib, cls_name)
    # The message deliberately echoes a key, as OpenAI's 401 does.
    exc: Exception = cls(f"Incorrect API key provided: {_SECRET}", response=response, body=None)
    return exc


def _timeout_exc(lib: Any) -> Exception:
    exc: Exception = lib.APITimeoutError(request=_REQ)
    return exc


def _connection_exc(lib: Any) -> Exception:
    exc: Exception = lib.APIConnectionError(request=_REQ)
    return exc


def _openai_raising(exc: Exception) -> OpenAIAdapter:
    adapter = OpenAIAdapter(api_key=_SECRET)

    def create(**_: Any) -> Any:
        raise exc

    adapter._client = types.SimpleNamespace(  # type: ignore[assignment]
        chat=types.SimpleNamespace(completions=types.SimpleNamespace(create=create))
    )
    return adapter


def _anthropic_raising(exc: Exception) -> AnthropicAdapter:
    adapter = AnthropicAdapter(api_key=_SECRET)

    def create(**_: Any) -> Any:
        raise exc

    class _Stream:
        def __enter__(self) -> Any:
            raise exc

        def __exit__(self, *_: Any) -> None:
            return None

    adapter._client = types.SimpleNamespace(  # type: ignore[assignment]
        messages=types.SimpleNamespace(create=create, stream=lambda **_: _Stream())
    )
    return adapter


def _raising(lib: Any, exc: Exception) -> OpenAIAdapter | AnthropicAdapter:
    return _openai_raising(exc) if lib is openai else _anthropic_raising(exc)


def _extract(adapter: OpenAIAdapter | AnthropicAdapter, max_tokens: int = 1_000) -> Any:
    return adapter.extract(
        prompt="p", source_text="s", model="m", max_tokens=max_tokens, output_type=_Out
    )


_LIBS = pytest.mark.parametrize("lib", [openai, anthropic], ids=["openai", "anthropic"])


@_LIBS
@pytest.mark.parametrize(
    ("cls_name", "status"),
    [
        ("AuthenticationError", 401),
        ("PermissionDeniedError", 403),
        ("RateLimitError", 429),
        ("InternalServerError", 500),
        ("InternalServerError", 503),
    ],
)
def test_infra_status_errors_are_classified(lib: Any, cls_name: str, status: int) -> None:
    result = _extract(_raising(lib, _status_exc(lib, cls_name, status)))
    assert result.recipe is None
    assert result.error_kind == "infra"
    assert result.error == f"{cls_name} (HTTP {status})"


@_LIBS
def test_other_5xx_status_is_infra(lib: Any) -> None:
    result = _extract(_raising(lib, _status_exc(lib, "APIStatusError", 529)))
    assert result.error_kind == "infra"
    assert result.error == "APIStatusError (HTTP 529)"


@_LIBS
@pytest.mark.parametrize("make", [_timeout_exc, _connection_exc], ids=["timeout", "connection"])
def test_timeout_and_connection_errors_are_infra(lib: Any, make: Any) -> None:
    exc = make(lib)
    result = _extract(_raising(lib, exc))
    assert result.error_kind == "infra"
    assert result.error == type(exc).__name__


@_LIBS
@pytest.mark.parametrize("status", [400, 404, 422])
def test_other_4xx_is_a_request_error(lib: Any, status: int) -> None:
    result = _extract(_raising(lib, _status_exc(lib, "APIStatusError", status)))
    assert result.recipe is None
    assert result.error_kind == "request"
    assert result.error == f"APIStatusError (HTTP {status})"


@_LIBS
def test_error_string_carries_no_exception_message_or_key(lib: Any) -> None:
    result = _extract(_raising(lib, _status_exc(lib, "AuthenticationError", 401)))
    assert result.error is not None
    assert _SECRET not in result.error
    assert "Incorrect API key" not in result.error


def test_anthropic_streaming_path_classifies_too() -> None:
    exc = _status_exc(anthropic, "AuthenticationError", 401)
    result = _extract(_anthropic_raising(exc), max_tokens=ESCALATED_MAX_TOKENS)
    assert result.error_kind == "infra"
    assert result.error == "AuthenticationError (HTTP 401)"


def _openai_returning(text: str, finish_reason: str = "stop") -> OpenAIAdapter:
    adapter = OpenAIAdapter(api_key=_SECRET)
    chunks = ns_chunks(text, finish_reason)
    adapter._client = types.SimpleNamespace(  # type: ignore[assignment]
        chat=types.SimpleNamespace(
            completions=types.SimpleNamespace(create=lambda **_: NsStream(chunks))
        )
    )
    return adapter


def _anthropic_returning(text: str, stop_reason: str = "end_turn") -> AnthropicAdapter:
    adapter = AnthropicAdapter(api_key=_SECRET)
    message = types.SimpleNamespace(
        content=[types.SimpleNamespace(type="text", text=text)],
        stop_reason=stop_reason,
        usage=types.SimpleNamespace(
            input_tokens=10,
            output_tokens=20,
            cache_read_input_tokens=0,
            cache_creation_input_tokens=0,
        ),
    )
    adapter._client = types.SimpleNamespace(  # type: ignore[assignment]
        messages=types.SimpleNamespace(create=lambda **_: message)
    )
    return adapter


_RETURNING = pytest.mark.parametrize(
    "make", [_openai_returning, _anthropic_returning], ids=["openai", "anthropic"]
)


@_RETURNING
def test_unparseable_response_keeps_raw_text_and_is_classified(make: Any) -> None:
    result = _extract(make('{"x": "not an int"'))
    assert result.recipe is None
    assert result.truncated is False
    assert result.error_kind == "unparseable"
    assert result.raw_text == '{"x": "not an int"'
    assert result.usage is not None


@pytest.mark.parametrize(
    ("make", "reason"),
    [(_openai_returning, "length"), (_anthropic_returning, "max_tokens")],
    ids=["openai", "anthropic"],
)
def test_truncated_response_is_classified_and_keeps_raw_text(make: Any, reason: str) -> None:
    result = _extract(make("partial", reason))
    assert result.truncated is True
    assert result.error_kind == "truncated"
    assert result.raw_text == "partial"


@_RETURNING
def test_parsed_response_has_no_error_kind(make: Any) -> None:
    result = _extract(make('{"x": 1}'))
    assert result.recipe == _Out(x=1)
    assert result.error_kind is None


def test_parse_failure_reason_json_error_has_position() -> None:
    reason = parse_failure_reason('{"x": 1,', _Out)
    assert "line" in reason
    assert "column" in reason


def test_parse_failure_reason_lists_first_three_validation_locations() -> None:
    class _Many(pydantic.BaseModel):
        aa: int
        bb: int
        cc: int
        dd: int

    reason = parse_failure_reason("{}", _Many)
    assert "aa" in reason
    assert "bb" in reason
    assert "cc" in reason
    assert "dd" not in reason


def test_parse_failure_reason_never_echoes_values() -> None:
    reason = parse_failure_reason('{"x": "' + _SECRET + '"}', _Out)
    assert _SECRET not in reason


def test_timeout_margin_over_a_legitimate_call() -> None:
    """Pins the A2 timeout rule: a timeout means throughput fell under 50 tok/s.

    A legitimate call generates at ~121 tok/s (about 8.3 s per 1K output tokens, plus
    about 8 s to first token; REPORT time model). A timeout is therefore treated as
    `infra` ("unavailable"), never as a recipe too long for its budget. If someone lowers
    `request_timeout_s` or raises the escalation cap so a legitimate call could time out
    (< 2x headroom), this fails and the rule must be revisited -- the alternative being
    that an escalation timeout maps to `incomplete`.
    """
    for budget in (MAX_TOKENS, ESCALATED_MAX_TOKENS):
        legitimate_s = budget * 8.3 / 1000 + 8
        assert request_timeout_s(budget) >= 2 * legitimate_s, (budget, legitimate_s)


# --- Reasoning-exhausted chain: provider response -> adapter -> normalize -> incomplete ----


def _openai_exhausted(content: str | None, counter: list[int]) -> OpenAIAdapter:
    """finish_reason "length", all completion tokens spent on reasoning, no visible text."""
    adapter = OpenAIAdapter(api_key=_SECRET)
    chunks = ns_chunks(
        content, "length", completion_tokens=16_000, reasoning_tokens=16_000
    )

    def create(**_: Any) -> Any:
        counter.append(1)
        return NsStream(chunks)

    adapter._client = types.SimpleNamespace(  # type: ignore[assignment]
        chat=types.SimpleNamespace(completions=types.SimpleNamespace(create=create))
    )
    return adapter


def _anthropic_exhausted(blocks: list[Any], counter: list[int]) -> AnthropicAdapter:
    adapter = AnthropicAdapter(api_key=_SECRET)
    message = types.SimpleNamespace(
        content=blocks,
        stop_reason="max_tokens",
        usage=types.SimpleNamespace(
            input_tokens=10,
            output_tokens=16_000,
            cache_read_input_tokens=0,
            cache_creation_input_tokens=0,
        ),
    )

    def create(**_: Any) -> Any:
        counter.append(1)
        return message

    adapter._client = types.SimpleNamespace(  # type: ignore[assignment]
        messages=types.SimpleNamespace(create=create)
    )
    return adapter


_RAW = RawAcquisition(
    source_url="https://youtu.be/chain", title="Chole", description="1 cup chickpeas. Boil."
)


@pytest.mark.parametrize("content", ["", "   \n", None], ids=["empty", "whitespace", "none"])
def test_openai_reasoning_exhausted_chain_ends_incomplete_after_one_call(
    content: str | None,
) -> None:
    counter: list[int] = []
    adapter = _openai_exhausted(content, counter)

    result = _extract(adapter, max_tokens=MAX_TOKENS)
    assert result.truncated is True
    assert result.error_kind == "truncated"
    assert result.raw_text is not None  # never None: None would mean "unknown", not "empty"
    assert result.raw_text.strip() == ""
    assert result.usage is not None
    assert result.usage.reasoning_tokens == result.usage.output_tokens

    counter.clear()
    outcome = normalize(_RAW, adapter)
    assert len(counter) == 1  # no escalation
    assert outcome.tier0_result is not None
    assert outcome.tier0_result.status == "failed"
    assert outcome.tier0_result.failure == "incomplete"
    assert "runaway" not in " ".join(outcome.tier0_result.warnings)


@pytest.mark.parametrize(
    "blocks",
    [[], [types.SimpleNamespace(type="thinking", thinking="hmm")]],
    ids=["no-blocks", "thinking-only"],
)
def test_anthropic_reasoning_exhausted_chain_ends_incomplete_after_one_call(
    blocks: list[Any],
) -> None:
    counter: list[int] = []
    adapter = _anthropic_exhausted(blocks, counter)

    result = _extract(adapter, max_tokens=MAX_TOKENS)
    assert result.truncated is True
    assert result.error_kind == "truncated"
    assert result.raw_text == ""

    counter.clear()
    outcome = normalize(_RAW, adapter)
    assert len(counter) == 1
    assert outcome.tier0_result is not None
    assert outcome.tier0_result.failure == "incomplete"
