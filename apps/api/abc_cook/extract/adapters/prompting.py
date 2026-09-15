"""Shared schema-in-prompt construction and response parsing, used by every adapter.

Split out of `anthropic.py` (M2.11) when a second provider adapter needed the exact
same mechanism: the requested output type's JSON Schema embedded in the system prompt,
plain-text response, then strip-fences-then-`model_validate`. See `anthropic.py`'s
module docstring for why this -- not a provider's native structured-output/JSON mode --
is the production mechanism. Keeping it in one module is what makes "same prompt, same
parsing, only the provider call differs" true by construction rather than by discipline
across files that could drift.
"""

from __future__ import annotations

import json
import re

import pydantic

CODE_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)

OUTPUT_FORMAT_INSTRUCTIONS = """

## Output format

Respond with ONLY a single JSON object valid against the JSON Schema below. No prose
before or after it, no markdown code fences -- the response body must be parseable by
`json.loads` as-is.

Output COMPACT JSON: no indentation, no line breaks, no extra whitespace around
punctuation (comma/colon-separated, like `json.dumps(..., separators=(",", ":"))`
would produce). This changes formatting only, never content -- every field, value, and
grounding rule above still applies in full; compact and pretty-printed JSON parse to
the identical object.

```json
{schema}
```
"""


def system_prompt(prompt: str, output_type: type[pydantic.BaseModel]) -> str:
    """The extraction/repair prompt with the output type's JSON Schema appended."""
    schema = json.dumps(output_type.model_json_schema(), ensure_ascii=False)
    return prompt + OUTPUT_FORMAT_INSTRUCTIONS.format(schema=schema)


def strip_code_fences(text: str) -> str:
    """Remove a leading/trailing ```json fence, if the model added one anyway."""
    return CODE_FENCE.sub("", text.strip()).strip()


def parse[T: pydantic.BaseModel](text: str, output_type: type[T]) -> T | None:
    """`json.loads` + `model_validate`, or None on either failure."""
    try:
        data = json.loads(strip_code_fences(text))
    except json.JSONDecodeError:
        return None
    try:
        return output_type.model_validate(data)
    except pydantic.ValidationError:
        return None
