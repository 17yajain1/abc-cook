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

import copy
import json
import re
from typing import Any

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


def strict_json_schema(output_type: type[pydantic.BaseModel]) -> dict[str, Any]:
    """The provider's strict structured-output form of `output_type`'s JSON Schema (PR-S3).

    A pure, deterministic transform of `model_json_schema()`; the Pydantic models are not edited.
    It mirrors `openai.lib._pydantic.to_strict_json_schema` (what the SDK's `.parse()` sends and
    the API accepts); `tests/test_strict_schema.py` pins the two together. Every object gets
    `additionalProperties: false` and all its properties listed as `required`; `default: null`
    is dropped (the nullable branch stays); non-null defaults stay; a `$ref` with sibling keys
    is unravelled. Property order is preserved, which is what keeps `text` first in a step.
    """
    schema = copy.deepcopy(output_type.model_json_schema())
    return _strictify(schema, root=schema)


def _strictify(node: dict[str, Any], *, root: dict[str, Any]) -> dict[str, Any]:
    for key in ("$defs", "definitions"):
        defs = node.get(key)
        if isinstance(defs, dict):
            for sub in defs.values():
                _strictify(sub, root=root)

    if node.get("type") == "object" and "additionalProperties" not in node:
        node["additionalProperties"] = False

    properties = node.get("properties")
    if isinstance(properties, dict):
        node["required"] = list(properties)
        node["properties"] = {k: _strictify(v, root=root) for k, v in properties.items()}

    items = node.get("items")
    if isinstance(items, dict):
        node["items"] = _strictify(items, root=root)

    any_of = node.get("anyOf")
    if isinstance(any_of, list):
        node["anyOf"] = [_strictify(v, root=root) for v in any_of]

    all_of = node.get("allOf")
    if isinstance(all_of, list):
        if len(all_of) == 1:
            node.update(_strictify(all_of[0], root=root))
            node.pop("allOf")
        else:
            node["allOf"] = [_strictify(v, root=root) for v in all_of]

    if "default" in node and node["default"] is None:
        node.pop("default")

    ref = node.get("$ref")
    if isinstance(ref, str) and len(node) > 1:
        resolved: Any = root
        for part in ref[2:].split("/"):
            resolved = resolved[part]
        node.update({**resolved, **node})
        node.pop("$ref")
        return _strictify(node, root=root)
    return node


def response_format(output_type: type[pydantic.BaseModel]) -> dict[str, Any]:
    """The `response_format` request field that turns on strict structured output."""
    return {
        "type": "json_schema",
        "json_schema": {
            "name": output_type.__name__,
            "strict": True,
            "schema": strict_json_schema(output_type),
        },
    }


def strip_code_fences(text: str) -> str:
    """Remove a leading/trailing ```json fence, if the model added one anyway."""
    return CODE_FENCE.sub("", text.strip()).strip()


def parse_failure_reason(text: str, output_type: type[pydantic.BaseModel]) -> str:
    """Why `parse(text, output_type)` returned None, for logs (FGC-13).

    The JSON error with its line/column, or the first three failing field locations. Never
    includes the offending values, so a log line can't carry source text or a key.
    """
    try:
        data = json.loads(strip_code_fences(text))
    except json.JSONDecodeError as exc:
        return f"invalid JSON: {exc.msg} (line {exc.lineno} column {exc.colno}, char {exc.pos})"
    try:
        output_type.model_validate(data)
    except pydantic.ValidationError as exc:
        errors = exc.errors()
        shown = "; ".join(
            f"{'.'.join(str(part) for part in e['loc']) or '<root>'}: {e['type']}"
            for e in errors[:3]
        )
        more = f" (+{len(errors) - 3} more)" if len(errors) > 3 else ""
        return f"schema mismatch: {shown}{more}"
    return "parsed cleanly"


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
