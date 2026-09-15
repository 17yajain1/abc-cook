"""Real, measured-usage cost in INR for one LLM call (M2.10 s18 F5).

Never estimates: `call_cost_inr` only prices a call whose `model` is a known key
below, using tokens the provider actually reported on `CallUsage`. An unknown model
returns None rather than a guessed number -- see docs/M2.9-youtube-import-design.md's
general "never invent a number" posture, applied to cost the same as to durations.

Rates from the M2.10 s18 cost-efficiency diagnosis (handoff s17/s18), re-derived from
the published per-token USD prices at an INR85/$ rate card checked 2026-09-13:
Haiku 4.5 $1/$5 per M tokens, Sonnet 5 $2/$10 per M tokens. Cache read/write
multipliers (0.1x / 1.25x of the input rate) are Anthropic's standard published
convention; harmless to include now even though nothing in this phase sets
`cache_control` yet (F6, not built), since the cache token fields are 0/None on every
real call until then.

`gpt-5-mini` added M2.11 (production extraction model change): $0.25/$2.00 per M
tokens (in/out), checked live against OpenAI's own pricing docs 2026-09-15, same
INR85/$ card. OpenAI has no published cache-write premium (its caching is automatic,
not an opt-in `cache_control` write), so `gpt-5-mini` has no separate write multiplier
here -- `adapters/openai.py`'s `CallUsage.cache_creation_input_tokens` is always None,
so the existing write-multiplier term in `call_cost_inr` contributes 0 for this model
without this file needing a provider-specific branch. The 0.1x cache-*read* multiplier
below is reused as-is for `gpt-5-mini` too (OpenAI's cached-input rate is also 1/10th
of its standard input rate, confirmed against the same pricing doc) -- `adapters/
openai.py` normalizes `input_tokens` to exclude cached tokens before this formula ever
sees them (OpenAI's `prompt_tokens` includes cache hits as a subset; Anthropic's
`input_tokens` already excludes them), so this formula needed no change to stay
correct for the new provider.
"""

from __future__ import annotations

from abc_cook.extract.adapters.base import CallUsage

INR_PER_1K_TOKENS: dict[str, tuple[float, float]] = {
    "claude-haiku-4-5-20251001": (0.085, 0.425),
    "claude-sonnet-5": (0.17, 0.85),
    "gpt-5-mini": (0.02125, 0.17),
}
"""model -> (input ₹/1K tokens, output ₹/1K tokens)."""

_CACHE_WRITE_MULTIPLIER = 1.25
_CACHE_READ_MULTIPLIER = 0.1


def call_cost_inr(usage: CallUsage) -> float | None:
    """The measured INR cost of one call, or None if `usage.model` has no known rate."""
    rates = INR_PER_1K_TOKENS.get(usage.model)
    if rates is None:
        return None
    rate_in, rate_out = rates
    cache_write = usage.cache_creation_input_tokens or 0
    cache_read = usage.cache_read_input_tokens or 0
    return (
        (usage.input_tokens / 1000) * rate_in
        + (cache_write / 1000) * rate_in * _CACHE_WRITE_MULTIPLIER
        + (cache_read / 1000) * rate_in * _CACHE_READ_MULTIPLIER
        + (usage.output_tokens / 1000) * rate_out
    )


def total_cost_inr(calls: list[CallUsage]) -> float | None:
    """Sum of `call_cost_inr` over every call.

    None if any call's model is unpriced -- a partial total would understate cost
    silently, which is worse than admitting it isn't fully known.
    """
    costs = [call_cost_inr(call) for call in calls]
    if any(cost is None for cost in costs):
        return None
    return sum(cost for cost in costs if cost is not None)
