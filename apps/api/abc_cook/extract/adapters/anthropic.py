"""The only file that imports the `anthropic` SDK (CLAUDE.md's adapter-boundary rule).

See docs/M2.9-youtube-import-design.md §6 (decision 7, provider recommendation).

Uses a plain-text call with the requested output type's JSON Schema embedded in the
system prompt, then parses and validates the response manually -- NOT Anthropic's
`output_format=` structured-output parameter. That was tried first (per the s15
handoff note, verified working in Verification B against a smaller ad hoc schema) but
the real `NormalizedRecipe` schema -- lists of ingredients/steps/chapters, each with
several optional/union fields -- hits a real, observed server-side limit:
`400 invalid_request_error: "Schema is too complex."`, confirmed live by bisection
(a lone `NormalizedIngredient` or `NormalizedStep` schema parses fine; the combined
`NormalizedRecipe` does not). Falling back to schema-in-prompt + manual
`model_validate` is also the more portable mechanism (every provider can do plain JSON
output; not every provider's structured-output feature has the same complexity
ceiling), and matches CLAUDE.md's general "parse -> Pydantic -> graph invariants"
validation posture rather than depending on one provider's enforcement.
"""

from __future__ import annotations

import os
import time

import anthropic
import pydantic

from abc_cook.extract.adapters.base import (
    MAX_RETRIES,
    CallUsage,
    EffortLevel,
    ExtractResult,
    request_timeout_s,
)
from abc_cook.extract.adapters.prompting import parse, system_prompt

_STREAMING_REQUIRED_MAX_TOKENS = 21_333
"""Mirrors the Anthropic SDK's own non-streaming timeout check
(`_calculate_nonstreaming_timeout`: `3600 * max_tokens / 128_000 > 600`) -- past this
point the SDK raises `ValueError` on a plain `.create()` call rather than let a
request run past its 10-minute non-streaming timeout. M2.10 s18 F2/F3's 32,000-token
escalation rung sits above this, so this adapter must stream past it."""


def _call_usage(
    message: anthropic.types.Message, *, model: str, max_tokens: int, latency_ms: float
) -> CallUsage:
    usage = message.usage
    return CallUsage(
        model=model,
        input_tokens=usage.input_tokens,
        output_tokens=usage.output_tokens,
        cache_read_input_tokens=usage.cache_read_input_tokens,
        cache_creation_input_tokens=usage.cache_creation_input_tokens,
        stop_reason=message.stop_reason,
        latency_ms=latency_ms,
        max_tokens_requested=max_tokens,
    )


class AnthropicAdapter:
    """Adapter for Anthropic's Messages API.

    Reads `LLM_API_KEY` from the environment by default (see `.env.example`); the app
    does not currently load `.env` automatically at import time (see `abc_cook.api.main`
    for the analogous `os.environ` pattern for `CORS_ORIGINS`/`APP_ENV`) — callers that
    need `.env` (tests, one-off scripts) load it themselves before constructing this.
    """

    def __init__(self, api_key: str | None = None) -> None:
        """Construct the adapter, defaulting the API key to `LLM_API_KEY`."""
        self._client = anthropic.Anthropic(
            api_key=api_key or os.environ.get("LLM_API_KEY"), max_retries=MAX_RETRIES
        )

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
        output_config: anthropic.types.OutputConfigParam | anthropic.Omit = (
            {"effort": effort} if effort is not None else anthropic.omit
        )
        system = system_prompt(prompt, output_type)
        messages: list[anthropic.types.MessageParam] = [{"role": "user", "content": source_text}]

        timeout = request_timeout_s(max_tokens)
        start = time.monotonic()
        message: anthropic.types.Message
        try:
            if max_tokens > _STREAMING_REQUIRED_MAX_TOKENS:
                with self._client.messages.stream(
                    model=model,
                    max_tokens=max_tokens,
                    system=system,
                    messages=messages,
                    output_config=output_config,
                    timeout=timeout,
                ) as stream:
                    message = stream.get_final_message()
            else:
                message = self._client.messages.create(
                    model=model,
                    max_tokens=max_tokens,
                    system=system,
                    messages=messages,
                    output_config=output_config,
                    timeout=timeout,
                )
        except anthropic.APIError as exc:
            return ExtractResult(recipe=None, error=f"{type(exc).__name__}: {exc}")
        latency_ms = (time.monotonic() - start) * 1000
        usage = _call_usage(message, model=model, max_tokens=max_tokens, latency_ms=latency_ms)

        text = "".join(block.text for block in message.content if block.type == "text")

        if message.stop_reason == "max_tokens":
            # §10.C finding 5: the richest bucket-A/D inputs neared ~4800 output
            # tokens at max_tokens=4000 and truncated mid-JSON. A truncated response
            # is retry-eligible, not a hard failure — but never at the same cap
            # (M2.10 s18 F2): the caller owns the escalate-or-stop decision, and
            # `raw_text` is what its runaway-generation check reads.
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
