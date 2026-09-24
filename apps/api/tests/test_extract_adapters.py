"""Provider adapters under a hung provider: bounded time, one retry, never a raise.

Offline: an `httpx.MockTransport` stands in for the network and times out every
request, so these run in the default suite without credentials.
"""

from __future__ import annotations

from typing import Any

import httpx
import httpx2
import pydantic

from abc_cook.extract.adapters.anthropic import AnthropicAdapter
from abc_cook.extract.adapters.base import MAX_RETRIES, request_timeout_s
from abc_cook.extract.adapters.openai import OpenAIAdapter


class _Out(pydantic.BaseModel):
    x: int


def _timing_out_transport(seen: list[Any], lib: Any = httpx) -> Any:
    """`lib` is `httpx` for the OpenAI SDK, `httpx2` for the Anthropic SDK."""

    def handler(request: Any) -> Any:
        seen.append(request)
        raise lib.ReadTimeout("simulated hang", request=request)

    return lib.MockTransport(handler)


def _assert_bounded(seen: list[Any], max_tokens: int) -> None:
    assert len(seen) == 1 + MAX_RETRIES
    for request in seen:
        assert request.extensions["timeout"]["read"] == request_timeout_s(max_tokens)


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
    _assert_bounded(seen, 16_000)


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
