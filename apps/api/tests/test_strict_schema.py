"""`strict_json_schema`: the provider's strict structured-output form of a Pydantic schema (PR-S3).

Pure and offline. The pydantic models are not edited; this is a deterministic transform of
`model_json_schema()`. `test_matches_the_sdk_transform` pins it to the SDK's own helper, which is
what the SDK's `.parse()` sends and the API accepts. If an SDK upgrade breaks that one test, the
fix is to update the test (or the transform to follow the SDK), never production behaviour.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path
from typing import Any

import pytest

from abc_cook.extract.adapters.prompting import strict_json_schema
from abc_cook.schema.normalized import NormalizedRecipe

_FIXTURES = Path(__file__).parent / "fixtures"
_ORIGINALS = sorted(
    [
        *(_FIXTURES / "import").glob("*.original.json"),
        *(_FIXTURES / "stream").glob("*.original.json"),
    ]
)
_UNSUPPORTED = {
    "minLength",
    "maxLength",
    "pattern",
    "format",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "multipleOf",
    "minItems",
    "maxItems",
    "uniqueItems",
    "const",
    "oneOf",
    "not",
    "patternProperties",
}


def _objects(node: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if isinstance(node, dict):
        if node.get("type") == "object":
            found.append(node)
        for value in node.values():
            found.extend(_objects(value))
    elif isinstance(node, list):
        for value in node:
            found.extend(_objects(value))
    return found


def _keywords(node: Any) -> set[str]:
    out: set[str] = set()
    if isinstance(node, dict):
        out |= set(node)
        for key, value in node.items():
            if key != "properties":  # property NAMES are not keywords
                out |= _keywords(value)
            else:
                for prop in value.values():
                    out |= _keywords(prop)
    elif isinstance(node, list):
        for value in node:
            out |= _keywords(value)
    return out


def test_every_object_is_closed_and_fully_required() -> None:
    schema = strict_json_schema(NormalizedRecipe)
    objects = _objects(schema)
    assert len(objects) == 4  # recipe, ingredient, step, chapter
    for obj in objects:
        assert obj["additionalProperties"] is False
        assert obj["required"] == list(obj["properties"])


def test_property_order_is_preserved_with_text_first() -> None:
    schema = strict_json_schema(NormalizedRecipe)
    assert list(schema["properties"]) == list(NormalizedRecipe.model_json_schema()["properties"])
    assert list(schema["properties"])[:3] == ["title", "channel", "method_grounded"]
    assert next(iter(schema["$defs"]["NormalizedStep"]["properties"])) == "text"


def test_no_unsupported_keywords() -> None:
    assert not (_keywords(strict_json_schema(NormalizedRecipe)) & _UNSUPPORTED)


def test_null_defaults_are_dropped_and_the_null_branch_stays() -> None:
    schema = strict_json_schema(NormalizedRecipe)
    step = schema["$defs"]["NormalizedStep"]["properties"]
    for name, prop in step.items():
        assert prop.get("default", "absent") is not None, name
    duration = step["duration_min"]
    assert {"type": "null"} in duration["anyOf"]


def test_non_null_defaults_are_kept() -> None:
    schema = strict_json_schema(NormalizedRecipe)
    assert schema["properties"]["servings_source"]["default"] == "defaulted"
    step = schema["$defs"]["NormalizedStep"]["properties"]
    assert step["depends_on_previous"]["default"] is True
    assert step["role"]["default"] == "required"


def test_deterministic_bytes_and_no_mutation_of_the_cached_schema() -> None:
    before = copy.deepcopy(NormalizedRecipe.model_json_schema())
    first = json.dumps(strict_json_schema(NormalizedRecipe))
    second = json.dumps(strict_json_schema(NormalizedRecipe))
    assert first == second
    assert NormalizedRecipe.model_json_schema() == before
    assert "additionalProperties" not in NormalizedRecipe.model_json_schema()


def test_matches_the_sdk_transform() -> None:
    # An SDK upgrade that breaks this means updating this test (or following the SDK), not
    # changing production behaviour: the SDK's helper is the reference for what the API accepts.
    from openai.lib._pydantic import to_strict_json_schema

    assert strict_json_schema(NormalizedRecipe) == to_strict_json_schema(NormalizedRecipe)
    assert json.dumps(strict_json_schema(NormalizedRecipe)) == json.dumps(
        to_strict_json_schema(NormalizedRecipe)
    )


def _conforms(value: Any, schema: dict[str, Any], root: dict[str, Any], path: str = "$") -> None:
    """A small structural checker for the subset of JSON Schema this schema uses."""
    if "$ref" in schema:
        target: Any = root
        for part in schema["$ref"][2:].split("/"):
            target = target[part]
        _conforms(value, target, root, path)
        return
    if "anyOf" in schema:
        errors: list[str] = []
        for branch in schema["anyOf"]:
            try:
                _conforms(value, branch, root, path)
                return
            except AssertionError as exc:
                errors.append(str(exc))
        raise AssertionError(f"{path}: no anyOf branch matched ({errors})")
    kind = schema.get("type")
    if "enum" in schema:
        assert value in schema["enum"], f"{path}: {value!r} not in enum"
    if kind == "null":
        assert value is None, f"{path}: expected null"
    elif kind == "string":
        assert isinstance(value, str), f"{path}: expected string"
    elif kind == "boolean":
        assert isinstance(value, bool), f"{path}: expected boolean"
    elif kind == "integer":
        assert isinstance(value, int), f"{path}: expected integer"
        assert not isinstance(value, bool), f"{path}: expected integer"
    elif kind == "number":
        assert isinstance(value, (int, float)), f"{path}: expected number"
        assert not isinstance(value, bool), f"{path}: expected number"
    elif kind == "array":
        assert isinstance(value, list), f"{path}: expected array"
        for i, item in enumerate(value):
            _conforms(item, schema["items"], root, f"{path}[{i}]")
    elif kind == "object":
        assert isinstance(value, dict), f"{path}: expected object"
        assert set(value) == set(schema["required"]), (
            f"{path}: keys {sorted(set(value) ^ set(schema['required']))} differ from required"
        )
        for key, prop in schema["properties"].items():
            _conforms(value[key], prop, root, f"{path}.{key}")


@pytest.mark.parametrize("path", _ORIGINALS, ids=lambda p: p.name)
def test_every_stored_original_recipe_dump_validates(path: Path) -> None:
    """`model_dump_json` already writes every key, so stored recipes fit the strict schema."""
    original = json.loads(path.read_text(encoding="utf-8"))
    recipe = NormalizedRecipe.model_validate(original["recipe"])
    dumped = json.loads(recipe.model_dump_json())
    schema = strict_json_schema(NormalizedRecipe)
    _conforms(dumped, schema, schema)


def test_the_checker_rejects_a_missing_key() -> None:
    schema = strict_json_schema(NormalizedRecipe)
    original = json.loads(_ORIGINALS[0].read_text(encoding="utf-8"))
    dumped = json.loads(NormalizedRecipe.model_validate(original["recipe"]).model_dump_json())
    del dumped["steps"][0]["role"]
    with pytest.raises(AssertionError):
        _conforms(dumped, schema, schema)
