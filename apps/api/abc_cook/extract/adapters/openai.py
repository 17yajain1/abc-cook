"""The only file that imports the `openai` SDK (CLAUDE.md's adapter-boundary rule).

Added M2.11 (production extraction model change: Haiku -> GPT-5-mini, per the M2.10
repair/extraction bake-offs). Same mechanism as `anthropic.py` -- schema-in-prompt +
manual `json.loads`/`model_validate` via the shared `prompting` module, never this
provider's native structured-output mode -- so the extraction task is provably
identical across providers, not just similar.

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
- No SDK-side non-streaming timeout ceiling analogous to Anthropic's -- this adapter
  never needs to stream at the 8K-32K max_tokens this project uses. Untested above
  that; not assumed safe.
"""

from __future__ import annotations

import os
import time
from typing import Literal

import openai
import pydantic

from abc_cook.extract.adapters.base import CallUsage, EffortLevel, ExtractResult
from abc_cook.extract.adapters.prompting import parse, system_prompt

_EFFORT_MAP: dict[EffortLevel, Literal["low", "medium", "high"]] = {
    "low": "low",
    "medium": "medium",
    "high": "high",
    "xhigh": "high",  # GPT-5-series has no "xhigh" -- capped, not dropped silently.
    "max": "high",
}


class OpenAIAdapter:
    """Adapter for OpenAI's Chat Completions API.

    Reads `OPENAI_API_KEY` from the environment by default (see `.env.example`); like
    `AnthropicAdapter`, the app does not load `.env` automatically at import time --
    callers that need it (tests, one-off scripts) load it themselves first.
    """

    def __init__(self, api_key: str | None = None) -> None:
        """Construct the adapter, defaulting the API key to `OPENAI_API_KEY`."""
        self._client = openai.OpenAI(api_key=api_key or os.environ.get("OPENAI_API_KEY"))

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
        """Run one plain-text extraction call. Never raises — see `LLMAdapter.extract`."""
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
            )
        except openai.APIError as exc:
            return ExtractResult(recipe=None, error=f"{type(exc).__name__}: {exc}")
        latency_ms = (time.monotonic() - start) * 1000

        choice = response.choices[0]
        text = choice.message.content or ""
        usage_obj = response.usage
        cached = 0
        if usage_obj is not None and usage_obj.prompt_tokens_details is not None:
            cached = usage_obj.prompt_tokens_details.cached_tokens or 0
        usage = CallUsage(
            model=model,
            input_tokens=(usage_obj.prompt_tokens - cached) if usage_obj else 0,
            output_tokens=usage_obj.completion_tokens if usage_obj else 0,
            cache_read_input_tokens=cached,
            cache_creation_input_tokens=None,  # no explicit cache-write field in this API
            stop_reason=choice.finish_reason,
            latency_ms=latency_ms,
            max_tokens_requested=max_tokens,
        )

        if choice.finish_reason == "length":
            # Same truncation contract as anthropic.py's `stop_reason == "max_tokens"`
            # branch -- retry-eligible, never at the same cap (M2.10 s18 F2).
            return ExtractResult(
                recipe=None, truncated=True, error="max_tokens", usage=usage, raw_text=text
            )

        parsed = parse(text, output_type)
        if parsed is None:
            return ExtractResult(
                recipe=None,
                error=f"response was not valid {output_type.__name__} JSON",
                usage=usage,
            )
        return ExtractResult(recipe=parsed, usage=usage)
