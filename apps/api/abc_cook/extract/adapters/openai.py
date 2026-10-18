"""The only file that imports the `openai` SDK (CLAUDE.md's adapter-boundary rule).

Added M2.11 (production extraction model change: Haiku -> GPT-5-mini, per the M2.10
repair/extraction bake-offs). Same mechanism as `anthropic.py` -- schema-in-prompt +
manual `json.loads`/`model_validate` via the shared `prompting` module -- so the extraction
task is provably identical across providers, not just similar. (PR-S3 adds this provider's
strict structured output on top of that, as a `response_format` request field only: the
prompt and the pasted schema are unchanged, and the response is still parsed by `parse`.)

Provider differences from the Anthropic adapter, all confirmed live during the M2.10
bake-off (see the bake-off report for detail, not repeated here):
- Chat Completions, not the Assistants/Responses API.
- `max_completion_tokens`, not `max_tokens` (GPT-5-series requirement).
- `finish_reason == "length"` is this provider's truncation signal, where Anthropic
  uses `stop_reason == "max_tokens"` -- mapped to the same `ExtractResult.truncated`
  contract so `normalize.py`'s retry/escalation policy needs no provider awareness.
- `reasoning_effort` accepts "minimal"/"low"/"medium"/"high" only -- `EffortLevel`'s
  "xhigh"/"max" are capped to "high" rather than sent unsupported.
- `usage.prompt_tokens` INCLUDES cached tokens as a subset (`prompt_tokens_details.
  cached_tokens`), unlike Anthropic where `input_tokens` already excludes them. This
  adapter subtracts cached tokens from `input_tokens` before building `CallUsage`, so
  `pricing.py`'s cost formula (written against Anthropic's accounting) stays correct
  unchanged -- the normalization happens once, here, at the provider boundary, not in
  the shared pricing formula.
- No SDK-side non-streaming timeout ceiling analogous to Anthropic's, so the blocking
  call was safe at the 8K-32K max_tokens this project uses.

PR-S2: the call now streams (`stream=True`, `include_usage`), so a caller can read the
ingredients and steps while the rest is still being written. Everything the model sees is
byte-identical (same `messages`, `model`, `max_completion_tokens`, `reasoning_effort`);
the deltas are joined into the same `text` that `parse` has always received. A watchdog
thread closes a stream that goes quiet (idle) or runs past the per-call deadline, because
a stalled stream would otherwise hold the job at its last status until httpx gave up.
`ABC_COOK_STREAM_EXTRACTION=0` restores the blocking call exactly (`_extract_blocking`).

PR-S3: with `ABC_COOK_STRICT_EXTRACTION` on (the default) the request also carries
`response_format` = strict `json_schema` for the output type, so the response always has every
key and valid enums, and a refusal arrives as `delta.refusal` / `message.refusal` instead of
text (reported as `error_kind="refused"`). Off sends today's request byte for byte, in both the
streaming and the blocking path. Both switches are read once, at construction.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from typing import Any, Literal

import httpx
import openai
import pydantic

from abc_cook.extract.adapters.base import (
    MAX_RETRIES,
    STREAM_CONNECT_TIMEOUT_S,
    STREAM_IDLE_TIMEOUT_S,
    STREAM_POOL_TIMEOUT_S,
    STREAM_READ_TIMEOUT_S,
    STREAM_WRITE_TIMEOUT_S,
    CallUsage,
    EffortLevel,
    ErrorKind,
    ExtractResult,
    TextDeltaCallback,
    exception_summary,
    request_timeout_s,
    stream_extraction_enabled,
    strict_extraction_enabled,
)
from abc_cook.extract.adapters.prompting import parse, response_format, system_prompt

_logger = logging.getLogger(__name__)

_STREAM_TIMEOUT = httpx.Timeout(
    connect=STREAM_CONNECT_TIMEOUT_S,
    read=STREAM_READ_TIMEOUT_S,
    write=STREAM_WRITE_TIMEOUT_S,
    pool=STREAM_POOL_TIMEOUT_S,
)

_EFFORT_MAP: dict[EffortLevel, Literal["minimal", "low", "medium", "high"]] = {
    "minimal": "minimal",
    "low": "low",
    "medium": "medium",
    "high": "high",
    "xhigh": "high",  # GPT-5-series has no "xhigh" -- capped, not dropped silently.
    "max": "high",
}


def _error_kind(exc: openai.APIError) -> ErrorKind:
    """`infra` for anything about the provider or the link, `request` for other 4xx.

    A timeout is `infra` on purpose: `request_timeout_s` assumes a 50 tok/s floor, so a
    timed-out call means the provider was degraded, not that the recipe was too long for
    its budget (that ends as a `length` truncation).
    """
    if isinstance(
        exc,
        (
            openai.AuthenticationError,
            openai.PermissionDeniedError,
            openai.APIConnectionError,  # includes APITimeoutError
            openai.RateLimitError,
            openai.InternalServerError,
        ),
    ):
        return "infra"
    if isinstance(exc, openai.APIStatusError):
        return "infra" if exc.status_code >= 500 else "request"
    return "request"


class _StreamWatchdog:
    """Closes a stream that is idle too long or past its deadline, from a daemon thread.

    "Idle" is measured in SDK-yielded chunks, not bytes: SSE keep-alive comments are
    filtered by the SDK, so httpx would never see a read timeout while the model is silent.
    The iterating thread sees the closed stream as an exception (or a clean end); either
    way `reason` says why, and the caller reports that instead.
    """

    def __init__(
        self, stream: Any, *, idle_s: float, deadline_at: float, poll_s: float | None = None
    ) -> None:
        self._stream = stream
        self._idle_s = idle_s
        self._deadline_at = deadline_at
        self._poll_s = poll_s if poll_s is not None else min(1.0, idle_s / 4)
        self._last_chunk_at = time.monotonic()
        self._stop = threading.Event()
        self.reason: str | None = None
        self._thread = threading.Thread(target=self._run, name="stream-watchdog", daemon=True)

    def start(self) -> None:
        """Start watching."""
        self._thread.start()

    def touch(self) -> None:
        """A chunk arrived."""
        self._last_chunk_at = time.monotonic()

    def stop(self) -> None:
        """Stop watching and wait for the thread."""
        self._stop.set()
        self._thread.join(timeout=5)

    def _run(self) -> None:
        while not self._stop.wait(self._poll_s):
            now = time.monotonic()
            if now > self._deadline_at:
                self.reason = "StreamDeadline"
            elif now - self._last_chunk_at > self._idle_s:
                self.reason = "StreamIdleTimeout"
            else:
                continue
            try:
                self._stream.close()
            except Exception:  # the stream is being abandoned either way
                _logger.debug("closing a stalled stream raised", exc_info=True)
            return


class OpenAIAdapter:
    """Adapter for OpenAI's Chat Completions API.

    Reads `OPENAI_API_KEY` from the environment by default (see `.env.example`); like
    `AnthropicAdapter`, the app does not load `.env` automatically at import time --
    callers that need it (tests, one-off scripts) load it themselves first.
    """

    def __init__(
        self,
        api_key: str | None = None,
        *,
        stream_idle_s: float = STREAM_IDLE_TIMEOUT_S,
        stream_deadline_s: float | None = None,
    ) -> None:
        """Construct the adapter, defaulting the API key to `OPENAI_API_KEY`.

        Args:
            api_key: Overrides `OPENAI_API_KEY`.
            stream_idle_s: Watchdog idle bound; a test override.
            stream_deadline_s: Per-call total deadline, defaulting to `request_timeout_s`.
                A test override.
        """
        self._client = openai.OpenAI(
            api_key=api_key or os.environ.get("OPENAI_API_KEY"), max_retries=MAX_RETRIES
        )
        self._stream = stream_extraction_enabled()  # read once, at construction (A1)
        self._strict = strict_extraction_enabled()  # read once, at construction (PR-S3)
        self._stream_idle_s = stream_idle_s
        self._stream_deadline_s = stream_deadline_s

    @property
    def streams_text(self) -> bool:
        """Whether `extract` streams, and so accepts `on_text` (the kill switch is off)."""
        return self._stream

    def extract[T: pydantic.BaseModel](
        self,
        *,
        prompt: str,
        source_text: str,
        model: str,
        max_tokens: int,
        output_type: type[T],
        effort: EffortLevel | None = None,
        on_text: TextDeltaCallback | None = None,
    ) -> ExtractResult[T]:
        """Run one plain-text extraction call. Never raises — see `LLMAdapter.extract`.

        `on_text` receives each non-empty piece of response text as it streams. If it
        raises, the adapter logs once, stops calling it and keeps streaming: a draft can
        never fail an import. It is ignored when streaming is off.
        """
        if not self._stream:
            return self._extract_blocking(
                prompt=prompt,
                source_text=source_text,
                model=model,
                max_tokens=max_tokens,
                output_type=output_type,
                effort=effort,
            )
        return self._extract_streaming(
            prompt=prompt,
            source_text=source_text,
            model=model,
            max_tokens=max_tokens,
            output_type=output_type,
            effort=effort,
            on_text=on_text,
        )

    def _format_kwargs(self, output_type: type[pydantic.BaseModel]) -> dict[str, Any]:
        """`response_format` when strict is on; nothing at all when off (today's request)."""
        return {"response_format": response_format(output_type)} if self._strict else {}

    def _log_contract_violation(self, output_type: type[pydantic.BaseModel], finish: Any) -> None:
        """WARNING when strict output still failed to parse: it should not be possible."""
        if self._strict:
            _logger.warning(
                "strict contract violation: response was not valid %s JSON despite strict "
                "structured output (finish_reason=%s)",
                output_type.__name__,
                finish,
            )

    def _extract_blocking[T: pydantic.BaseModel](
        self,
        *,
        prompt: str,
        source_text: str,
        model: str,
        max_tokens: int,
        output_type: type[T],
        effort: EffortLevel | None,
    ) -> ExtractResult[T]:
        """The pre-S2 call, unchanged: one blocking request, the whole response at once."""
        system = system_prompt(prompt, output_type)
        messages: list[openai.types.chat.ChatCompletionMessageParam] = [
            {"role": "system", "content": system},
            {"role": "user", "content": source_text},
        ]
        reasoning_effort = _EFFORT_MAP[effort] if effort is not None else openai.omit

        start = time.monotonic()
        try:
            response = self._client.chat.completions.create(
                model=model,
                messages=messages,
                max_completion_tokens=max_tokens,
                reasoning_effort=reasoning_effort,
                timeout=request_timeout_s(max_tokens),
                **self._format_kwargs(output_type),
            )
        except openai.APIError as exc:
            return ExtractResult(
                recipe=None, error=exception_summary(exc), error_kind=_error_kind(exc)
            )
        latency_ms = (time.monotonic() - start) * 1000

        choice = response.choices[0]
        text = choice.message.content or ""
        usage_obj = response.usage
        cached = 0
        if usage_obj is not None and usage_obj.prompt_tokens_details is not None:
            cached = usage_obj.prompt_tokens_details.cached_tokens or 0
        reasoning: int | None = None
        if usage_obj is not None and usage_obj.completion_tokens_details is not None:
            reasoning = usage_obj.completion_tokens_details.reasoning_tokens
        usage = CallUsage(
            model=model,
            input_tokens=(usage_obj.prompt_tokens - cached) if usage_obj else 0,
            output_tokens=usage_obj.completion_tokens if usage_obj else 0,
            cache_read_input_tokens=cached,
            cache_creation_input_tokens=None,  # no explicit cache-write field in this API
            stop_reason=choice.finish_reason,
            latency_ms=latency_ms,
            max_tokens_requested=max_tokens,
            reasoning_tokens=reasoning,
        )

        if self._strict and (
            getattr(choice.message, "refusal", None) or choice.finish_reason == "content_filter"
        ):
            return ExtractResult(
                recipe=None,
                error="content_filter" if choice.finish_reason == "content_filter" else "refusal",
                error_kind="refused",
                usage=usage,
            )

        if choice.finish_reason == "length":
            # Same truncation contract as anthropic.py's `stop_reason == "max_tokens"`
            # branch -- retry-eligible, never at the same cap (M2.10 s18 F2).
            return ExtractResult(
                recipe=None,
                truncated=True,
                error="max_tokens",
                error_kind="truncated",
                usage=usage,
                raw_text=text,
            )

        parsed = parse(text, output_type)
        if parsed is None:
            self._log_contract_violation(output_type, choice.finish_reason)
            return ExtractResult(
                recipe=None,
                error=f"response was not valid {output_type.__name__} JSON",
                error_kind="unparseable",
                usage=usage,
                raw_text=text,
            )
        return ExtractResult(recipe=parsed, usage=usage)

    def _extract_streaming[T: pydantic.BaseModel](
        self,
        *,
        prompt: str,
        source_text: str,
        model: str,
        max_tokens: int,
        output_type: type[T],
        effort: EffortLevel | None,
        on_text: TextDeltaCallback | None,
    ) -> ExtractResult[T]:
        """The same request as `_extract_blocking`, streamed, with a stall watchdog."""
        system = system_prompt(prompt, output_type)
        messages: list[openai.types.chat.ChatCompletionMessageParam] = [
            {"role": "system", "content": system},
            {"role": "user", "content": source_text},
        ]
        reasoning_effort = _EFFORT_MAP[effort] if effort is not None else openai.omit

        start = time.monotonic()
        deadline_s = (
            self._stream_deadline_s
            if self._stream_deadline_s is not None
            else request_timeout_s(max_tokens)
        )
        try:
            stream = self._client.chat.completions.create(
                model=model,
                messages=messages,
                max_completion_tokens=max_tokens,
                reasoning_effort=reasoning_effort,
                stream=True,
                stream_options={"include_usage": True},
                timeout=_STREAM_TIMEOUT,
                **self._format_kwargs(output_type),
            )
        except openai.APIError as exc:
            return ExtractResult(
                recipe=None, error=exception_summary(exc), error_kind=_error_kind(exc)
            )

        watchdog = _StreamWatchdog(
            stream, idle_s=self._stream_idle_s, deadline_at=start + deadline_s
        )
        watchdog.start()
        deltas: list[str] = []
        refused = False
        finish_reason: str | None = None
        usage_obj: Any = None
        first_content_ms: float | None = None
        callback = on_text
        try:
            for chunk in stream:
                watchdog.touch()
                if chunk.usage is not None:
                    usage_obj = chunk.usage
                if not chunk.choices:
                    continue
                choice = chunk.choices[0]
                if choice.finish_reason is not None:
                    finish_reason = choice.finish_reason
                if self._strict and getattr(choice.delta, "refusal", None):
                    refused = True
                delta = choice.delta.content if choice.delta is not None else None
                if not delta:
                    continue
                if first_content_ms is None:
                    first_content_ms = (time.monotonic() - start) * 1000
                deltas.append(delta)
                if callback is not None:
                    try:
                        callback(delta)
                    except Exception:
                        _logger.warning("on_text raised; draft updates stop for this call")
                        callback = None
        except (openai.APIError, httpx.HTTPError, httpx.StreamError) as exc:
            # A stall closed by the watchdog surfaces here as a read error: report why it
            # was closed, not the transport's wording. Mid-stream failures carry no usage
            # chunk, so their spend is unreported (FGC-19).
            error = watchdog.reason or exception_summary(exc)
            return ExtractResult(recipe=None, error=error, error_kind="infra")
        finally:
            watchdog.stop()
            try:
                stream.close()
            except Exception:  # already closed or never opened: nothing to release
                _logger.debug("closing the stream raised", exc_info=True)
        if watchdog.reason is not None and finish_reason is None:
            # The close ended iteration cleanly instead of raising. (A reason that fired after
            # `finish_reason` arrived is a finished answer, not a stall.)
            return ExtractResult(recipe=None, error=watchdog.reason, error_kind="infra")
        latency_ms = (time.monotonic() - start) * 1000

        text = "".join(deltas)
        usage: CallUsage | None = None
        if usage_obj is None:
            _logger.warning("stream ended without a usage chunk; cost is unreported")
        else:
            cached = 0
            if usage_obj.prompt_tokens_details is not None:
                cached = usage_obj.prompt_tokens_details.cached_tokens or 0
            reasoning: int | None = None
            if usage_obj.completion_tokens_details is not None:
                reasoning = usage_obj.completion_tokens_details.reasoning_tokens
            usage = CallUsage(
                model=model,
                input_tokens=usage_obj.prompt_tokens - cached,
                output_tokens=usage_obj.completion_tokens,
                cache_read_input_tokens=cached,
                cache_creation_input_tokens=None,  # no explicit cache-write field in this API
                stop_reason=finish_reason,
                latency_ms=latency_ms,
                max_tokens_requested=max_tokens,
                reasoning_tokens=reasoning,
                first_content_ms=first_content_ms,
            )

        if self._strict and (refused or finish_reason == "content_filter"):
            return ExtractResult(
                recipe=None,
                error="content_filter" if finish_reason == "content_filter" else "refusal",
                error_kind="refused",
                usage=usage,
            )

        if finish_reason == "length":
            return ExtractResult(
                recipe=None,
                truncated=True,
                error="max_tokens",
                error_kind="truncated",
                usage=usage,
                raw_text=text,
            )

        parsed = parse(text, output_type)
        if parsed is None:
            self._log_contract_violation(output_type, finish_reason)
            return ExtractResult(
                recipe=None,
                error=f"response was not valid {output_type.__name__} JSON",
                error_kind="unparseable",
                usage=usage,
                raw_text=text,
            )
        return ExtractResult(recipe=parsed, usage=usage)
