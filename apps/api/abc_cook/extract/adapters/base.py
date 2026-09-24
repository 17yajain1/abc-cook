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

from dataclasses import dataclass
from typing import Literal, Protocol

import pydantic

EffortLevel = Literal["low", "medium", "high", "xhigh", "max"]
"""Reasoning-effort hint (design doc §6.2: "adaptive thinking at effort: low" for the
repair pass). Optional and provider-dependent — an adapter that has no such concept
simply ignores it."""


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
    `raw_text` carries the partial response text, but only when `truncated=True` — it
    exists solely for the caller's runaway-generation check, never for parsing.
    """

    recipe: T | None
    truncated: bool = False
    error: str | None = None
    usage: CallUsage | None = None
    raw_text: str | None = None


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
