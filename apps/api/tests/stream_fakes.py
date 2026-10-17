"""Fakes for a streamed OpenAI Chat Completions call (PR-S2a). Offline.

Two flavours:
- `scripted_adapter` drives the real SDK (`openai.Stream`) over an `httpx.MockTransport`
  that serves server-sent events on a timed script, so the wire request, the SDK's chunk
  parsing and the watchdog's `close()` are all the real thing.
- `NsStream` / `ns_chunks` are plain-object chunks for the older fake-client tests.
"""

from __future__ import annotations

import json
import threading
import types
from collections.abc import Iterator
from typing import Any

import httpx

from abc_cook.extract.adapters.openai import OpenAIAdapter

_KEY = "sk-test-SECRET"


def _chunk(delta: dict[str, Any], finish: str | None = None) -> dict[str, Any]:
    return {
        "id": "chatcmpl-test",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": "gpt-test",
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }


def content_chunk(text: str) -> dict[str, Any]:
    """One content delta."""
    return _chunk({"content": text})


def finish_chunk(reason: str = "stop") -> dict[str, Any]:
    """The chunk that carries `finish_reason` (empty delta)."""
    return _chunk({}, reason)


def usage_chunk(
    prompt: int = 100, completion: int = 50, reasoning: int | None = 10, cached: int = 0
) -> dict[str, Any]:
    """The final `include_usage` chunk: no choices, a usage object."""
    usage: dict[str, Any] = {
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": prompt + completion,
        "prompt_tokens_details": {"cached_tokens": cached},
    }
    if reasoning is not None:
        usage["completion_tokens_details"] = {"reasoning_tokens": reasoning}
    return {
        "id": "chatcmpl-test",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": "gpt-test",
        "choices": [],
        "usage": usage,
    }


def sse(payload: dict[str, Any] | str) -> bytes:
    """One server-sent event."""
    body = payload if isinstance(payload, str) else json.dumps(payload)
    return f"data: {body}\n\n".encode()


class ScriptedSSE(httpx.SyncByteStream):
    """Serves `(delay_s, bytes | Exception)` steps; `close()` wakes a blocked wait.

    A closed stream raises `httpx.ReadError`, which is what a socket closed from another
    thread looks like to the reader.
    """

    def __init__(self, script: list[tuple[float, bytes | Exception]]) -> None:
        self._script = script
        self.closed = threading.Event()

    def __iter__(self) -> Iterator[bytes]:
        for delay, item in self._script:
            if self.closed.wait(delay):
                raise httpx.ReadError("stream closed")
            if isinstance(item, Exception):
                raise item
            yield item

    def close(self) -> None:
        self.closed.set()


def events(*payloads: dict[str, Any] | str) -> list[tuple[float, bytes | Exception]]:
    """A script that serves each payload at once, then `[DONE]`."""
    return [(0.0, sse(p)) for p in payloads] + [(0.0, sse("[DONE]"))]


class Recorded:
    """What a scripted adapter saw on the wire."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.streams: list[ScriptedSSE] = []

    @property
    def body(self) -> dict[str, Any]:
        loaded: dict[str, Any] = json.loads(self.requests[-1].content)
        return loaded


def scripted_adapter(
    script: list[tuple[float, bytes | Exception]] | None = None,
    *,
    json_response: dict[str, Any] | None = None,
    **adapter_kwargs: Any,
) -> tuple[OpenAIAdapter, Recorded]:
    """An `OpenAIAdapter` whose HTTP layer serves `script` as SSE (or `json_response`)."""
    recorded = Recorded()

    def handler(request: httpx.Request) -> httpx.Response:
        recorded.requests.append(request)
        if json_response is not None:
            return httpx.Response(200, json=json_response)
        stream = ScriptedSSE(script or [])
        recorded.streams.append(stream)
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=stream)

    adapter = OpenAIAdapter(api_key=_KEY, **adapter_kwargs)
    adapter._client = adapter._client.with_options(
        http_client=httpx.Client(transport=httpx.MockTransport(handler))
    )
    return adapter, recorded


# --- plain-object chunks, for fake clients that bypass the SDK ---------------------------


def ns_chunks(
    text: str | None,
    finish_reason: str = "stop",
    *,
    prompt_tokens: int = 10,
    completion_tokens: int = 20,
    reasoning_tokens: int | None = 5,
) -> list[Any]:
    """Content chunk(s), a finish chunk and a usage chunk, as plain objects."""
    chunks: list[Any] = []
    if text:
        chunks.append(
            types.SimpleNamespace(
                choices=[
                    types.SimpleNamespace(
                        delta=types.SimpleNamespace(content=text), finish_reason=None
                    )
                ],
                usage=None,
            )
        )
    chunks.append(
        types.SimpleNamespace(
            choices=[
                types.SimpleNamespace(
                    delta=types.SimpleNamespace(content=None), finish_reason=finish_reason
                )
            ],
            usage=None,
        )
    )
    chunks.append(
        types.SimpleNamespace(
            choices=[],
            usage=types.SimpleNamespace(
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                prompt_tokens_details=None,
                completion_tokens_details=types.SimpleNamespace(reasoning_tokens=reasoning_tokens),
            ),
        )
    )
    return chunks


class NsStream:
    """An iterable of plain chunks with the one method the adapter needs, `close()`."""

    def __init__(self, chunks: list[Any]) -> None:
        self._chunks = chunks

    def __iter__(self) -> Iterator[Any]:
        return iter(self._chunks)

    def close(self) -> None:
        return None
