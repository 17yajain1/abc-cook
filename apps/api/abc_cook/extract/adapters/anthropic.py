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

import json
import os
import re

import anthropic
import pydantic

from abc_cook.extract.adapters.base import EffortLevel, ExtractResult

_CODE_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)

_OUTPUT_FORMAT_INSTRUCTIONS = """

## Output format

Respond with ONLY a single JSON object valid against the JSON Schema below. No prose
before or after it, no markdown code fences -- the response body must be parseable by
`json.loads` as-is.

```json
{schema}
```
"""


def _system_prompt(prompt: str, output_type: type[pydantic.BaseModel]) -> str:
    schema = json.dumps(output_type.model_json_schema(), ensure_ascii=False)
    return prompt + _OUTPUT_FORMAT_INSTRUCTIONS.format(schema=schema)


def _strip_code_fences(text: str) -> str:
    return _CODE_FENCE.sub("", text.strip()).strip()


def _parse[T: pydantic.BaseModel](text: str, output_type: type[T]) -> T | None:
    try:
        data = json.loads(_strip_code_fences(text))
    except json.JSONDecodeError:
        return None
    try:
        return output_type.model_validate(data)
    except pydantic.ValidationError:
        return None


class AnthropicAdapter:
    """Adapter for Anthropic's Messages API.

    Reads `LLM_API_KEY` from the environment by default (see `.env.example`); the app
    does not currently load `.env` automatically at import time (see `abc_cook.api.main`
    for the analogous `os.environ` pattern for `CORS_ORIGINS`/`APP_ENV`) — callers that
    need `.env` (tests, one-off scripts) load it themselves before constructing this.
    """

    def __init__(self, api_key: str | None = None) -> None:
        """Construct the adapter, defaulting the API key to `LLM_API_KEY`."""
        self._client = anthropic.Anthropic(api_key=api_key or os.environ.get("LLM_API_KEY"))

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
        try:
            message = self._client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=_system_prompt(prompt, output_type),
                messages=[{"role": "user", "content": source_text}],
                output_config=output_config,
            )
        except anthropic.APIError as exc:
            return ExtractResult(recipe=None, error=f"{type(exc).__name__}: {exc}")

        if message.stop_reason == "max_tokens":
            # §10.C finding 5: the richest bucket-A/D inputs neared ~4800 output
            # tokens at max_tokens=4000 and truncated mid-JSON. A truncated response
            # is retry-eligible, not a hard failure — the caller owns the retry.
            return ExtractResult(recipe=None, truncated=True, error="max_tokens")

        text = "".join(block.text for block in message.content if block.type == "text")
        parsed = _parse(text, output_type)
        if parsed is None:
            return ExtractResult(
                recipe=None, error=f"response was not valid {output_type.__name__} JSON"
            )
        return ExtractResult(recipe=parsed)
