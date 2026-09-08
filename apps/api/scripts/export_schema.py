"""Emit the ABC Cook JSON Schema for the TypeScript generator.

`make types` runs this, then `json-schema-to-typescript` over the output. The Pydantic
models in `abc_cook/schema/` are the single source of truth (CLAUDE.md); this is the
one bridge to the frontend's types.

Run from anywhere: `python apps/api/scripts/export_schema.py`.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic.json_schema import GenerateJsonSchema, models_json_schema

from abc_cook.schema import RecipeListResponse, RecipePlanResponse

# Two response roots. `RecipePlanResponse` transitively contains CookingGraph,
# CookingPlan, StageSpan and every child model, so listing those separately here would
# only create duplicate `Foo` / `Foo1` interfaces in the output. Add a root only when
# the frontend needs a model that nothing else already pulls in.
ROOTS = [RecipePlanResponse, RecipeListResponse]

OUT = Path(__file__).resolve().parents[3] / "packages" / "schema" / "schema.json"


# JSON Schema keywords whose value is a {name: subschema} map. Their keys are model or
# property names and must never be treated as schema keywords.
_SCHEMA_MAPS = frozenset({"properties", "$defs", "definitions", "patternProperties"})


def _normalise(node: Any, *, in_schema_map: bool = False) -> Any:
    """Tidy a Pydantic-emitted schema so json-schema-to-typescript stays readable.

    Two transforms:

    * Drop the ``title`` *keyword* from every subschema. Pydantic titles each field
      ("Id", "Servings") and the generator turns each into a standalone ``export type``
      alias — dozens of them. A property literally named ``title`` (``CookingGraph``
      has one) is left alone.
    * Where a ``$ref`` sits next to a sibling ``description``, drop the sibling. The
      generator otherwise clones the referenced model (``CookingGraph1``) rather than
      pointing at it.
    """
    if isinstance(node, dict):
        if not in_schema_map:
            node.pop("title", None)
            if "$ref" in node and len(node) > 1:
                return {"$ref": node["$ref"]}
        return {
            key: _normalise(value, in_schema_map=key in _SCHEMA_MAPS)
            for key, value in node.items()
        }
    if isinstance(node, list):
        return [_normalise(item) for item in node]
    return node


def build() -> dict[str, Any]:
    """Produce one normalised schema document with every model under ``$defs``.

    Returns:
        A JSON-Schema-shaped dict ready for ``json-schema-to-typescript``.
    """
    _, schema = models_json_schema(
        [(model, "validation") for model in ROOTS],
        ref_template="#/$defs/{model}",
        schema_generator=GenerateJsonSchema,
    )
    normalised: dict[str, Any] = _normalise(schema)
    normalised["title"] = "ABCCookSchema"
    return normalised


def main() -> None:
    """Write the schema to ``packages/schema/schema.json``, pretty and stable."""
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(
        json.dumps(build(), indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
