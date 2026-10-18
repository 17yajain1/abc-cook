"""Provider-agnostic contract for a single structured extraction call.

See docs/M2.9-youtube-import-design.md §4.1/§7/§10.C. LOCKED DECISION 2: any model
returned through this boundary is a proposal, never authoritative scheduler input —
`normalize.py` and `graph.py` independently verify every scheduling-relevant field. An
adapter's only job is turning a prompt + source text into a candidate structured
value, or reporting that it could not.

Generic over the output type (`normalize.py` asks for a full `NormalizedRecipe`;
`repair.py` asks for a much smaller `RepairProposal`, since a repair response only
ever needs three fields per step, not the whole recipe echoed back — see repair.py's
module docstring for why that distinction is load-bearing, not cosmetic).
"""

from __future__ import annotations

import os
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, Protocol

import pydantic

EffortLevel = Literal["minimal", "low", "medium", "high", "xhigh", "max"]
"""Reasoning-effort hint (design doc §6.2: "adaptive thinking at effort: low" for the
repair pass). Optional and provider-dependent — an adapter that has no such concept
simply ignores it."""


ErrorKind = Literal["infra", "request", "unparseable", "truncated", "refused"]
"""See `ExtractResult.error_kind`."""


MAX_RETRIES = 1
"""SDK-level retries per call. The SDK defaults (OpenAI/Anthropic: 2) multiply a
timed-out call's wait; one retry still covers a transient 429/5xx."""


def request_timeout_s(max_tokens: int) -> float:
    """Per-call timeout, scaled to the output budget so the 32K rung isn't cut short.

    Assumes a 50 tok/s floor (GPT-5-mini measured ~100 tok/s: 11,261 output tokens in
    112s on 2026-09-24) plus 60s for the request and time-to-first-token. It exists so a
    stuck call ends the import job as `failed` instead of leaving it mid-status.
    """
    return 60.0 + max_tokens / 50


STREAM_IDLE_TIMEOUT_S = 60.0
"""Longest a streaming extraction may go without a chunk before the watchdog closes it.

Sized from more than one measurement (PR-S2 plan §3.1.4). The longest healthy silence is
the reasoning wait before the first visible token: 7.7 s with 960 reasoning tokens for
kadhi at `low` (REPORT T6), and across the T2 `low` calls reasoning ranged from 192 to
1,984 tokens (pizza's retry), which is about 1.6-16.4 s at 121 tok/s. After the first
token chunks arrive about every 10 ms. 60 s is 3.6x the worst estimate, so it also covers
a provider 2-3x slower than measured. The per-call total deadline stays
`request_timeout_s(max_tokens)`; this is the stall bound inside it.
"""

STREAM_CONNECT_TIMEOUT_S = 10.0
STREAM_READ_TIMEOUT_S = 75.0
STREAM_WRITE_TIMEOUT_S = 30.0
STREAM_POOL_TIMEOUT_S = 10.0
"""httpx backstop for a streaming call, before the first byte of the response. The watchdog
owns stalls once the stream has started; with `MAX_RETRIES = 1` the worst case before it
starts is about 2 x 75 s (PR-S2 plan §3.1.4)."""

TextDeltaCallback = Callable[[str], None]
"""Called with each non-empty piece of response text as a streaming adapter receives it."""

STREAM_EXTRACTION_ENV = "ABC_COOK_STREAM_EXTRACTION"
"""Kill switch (PR-S2 amendment A1). Unset means on; `0`, `false` or `off` (any case) turns
streaming off, and the OpenAI adapter then sends today's non-streaming request."""


def stream_extraction_enabled() -> bool:
    """Whether the extraction call may stream: `ABC_COOK_STREAM_EXTRACTION`, default on."""
    value = os.environ.get(STREAM_EXTRACTION_ENV, "").strip().lower()
    return value not in {"0", "false", "off"}


STRICT_EXTRACTION_ENV = "ABC_COOK_STRICT_EXTRACTION"
"""Kill switch (PR-S3). Unset means on; `0`, `false` or `off` (any case) turns strict structured
output off, and the OpenAI adapter then sends exactly the request it sent before PR-S3."""


def strict_extraction_enabled() -> bool:
    """Whether the extraction call asks for strict structured output: default on."""
    value = os.environ.get(STRICT_EXTRACTION_ENV, "").strip().lower()
    return value not in {"0", "false", "off"}


ADDED_STEPS_ENV = "ABC_COOK_ADDED_STEPS"
"""Switch (FGC-3). Default OFF: unset, `0`, `false` or `off` send exactly the request sent
before FGC-3 (prompt v7, no `origin` in the pasted or the strict schema). `1`, `true` or `on`
(any case) turn on "steps the source skips": prompt v8, an `origin` field on every step, labelled
added steps. Off by default because the first measurement (v8, low, strict) elicited no added step
in 15 runs."""


def added_steps_enabled() -> bool:
    """Whether the extraction may add labelled steps the source skips: default off."""
    value = os.environ.get(ADDED_STEPS_ENV, "").strip().lower()
    return value in {"1", "true", "on"}


def exception_summary(exc: BaseException) -> str:
    """`"<ClassName> (HTTP <status>)"`, or just the class name when there is no status.

    Deliberately omits the exception message: OpenAI's 401 message echoes a masked key,
    and this string ends up in `ImportResult.warnings`, which the client receives.
    """
    status = getattr(exc, "status_code", None)
    name = type(exc).__name__
    return f"{name} (HTTP {status})" if isinstance(status, int) else name


@dataclass(frozen=True)
class CallUsage:
    """Measured facts about one real LLM call (M2.10 s18 F5).

    Never estimated: a field the provider's response didn't carry stays `None`
    rather than being guessed, so a reader can tell a measured 0 apart from "not
    reported".
    """

    model: str
    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: int | None
    cache_creation_input_tokens: int | None
    stop_reason: str | None
    latency_ms: float
    max_tokens_requested: int
    reasoning_tokens: int | None = None
    """Hidden reasoning tokens, already included in `output_tokens` (OpenAI reports
    them as a subset of `completion_tokens`). `None` = the provider doesn't report
    them (Anthropic here) -- not "zero". A0 instrumentation only; never priced twice."""
    first_content_ms: float | None = None
    """Milliseconds from the request to the first visible text chunk of a streamed call.
    `None` for a non-streaming call. Measurement only; nothing reads it for a decision."""


@dataclass(frozen=True)
class ExtractResult[T: pydantic.BaseModel]:
    """One extraction attempt's outcome.

    `recipe` is None whenever no usable structure came back. `truncated=True` means
    the provider cut the response off before it finished (output-token budget too
    small — §10.C finding 5); callers treat this as retry-eligible the same way they
    treat any other unparseable response, except that a truncation must never be
    retried with an identical cap (M2.10 s18 F2) — only escalated or stopped. `error`
    carries a short diagnostic for logs; never shown to the end user. `usage` is the
    measured per-call cost/latency data (F5), when a message actually came back.
    `raw_text` carries the response text when `truncated=True` (the caller's
    runaway-generation check) and when the response was unparseable (so the caller can
    log why; FGC-13). It is never parsed again.

    `error_kind` says what sort of failure `error` describes, so the caller can tell a
    provider outage from a bad answer: `infra` (auth, permission, rate limit, 5xx,
    connection or timeout: nothing to do with the input, so same-input retries are
    pointless), `request` (any other 4xx, e.g. a rejected schema: also not worth a retry),
    `unparseable`, `truncated`, or `refused` (the model declined or the output was filtered:
    a retry would be refused again). `None` on success.
    """

    recipe: T | None
    truncated: bool = False
    error: str | None = None
    usage: CallUsage | None = None
    raw_text: str | None = None
    error_kind: ErrorKind | None = None


class LLMAdapter(Protocol):
    """The provider boundary. Callers never import a provider SDK directly."""

    def extract[T: pydantic.BaseModel](
        self,
        *,
        prompt: str,
        source_text: str,
        model: str,
        max_tokens: int,
        output_type: type[T],
        effort: EffortLevel | None = None,
    ) -> ExtractResult[T]:
        """Run one structured-extraction call.

        Args:
            prompt: The system/instruction prompt.
            source_text: The rendered input text.
            model: Provider model id, e.g. "claude-haiku-4-5-20251001".
            max_tokens: Output token budget for this attempt.
            output_type: The Pydantic model the response must validate against.
            effort: Optional reasoning-effort hint; ignored by an adapter/model that
                has no such concept.

        Returns:
            An `ExtractResult[output_type]`. Implementations must not raise for a
            provider-side failure (network error, rate limit, malformed response) —
            report it as `ExtractResult(recipe=None, error=...)` instead, so a
            caller's retry-once-then-degrade logic has one uniform shape to handle
            regardless of provider.
        """
        ...
