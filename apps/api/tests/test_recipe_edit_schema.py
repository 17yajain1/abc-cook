"""R6: the `RecipeEdit` op union (docs/plans/r6-tier-a-editing.md B2).

Edits are a patch over the imported original, validated here as a contract only: the web app
writes and reads them in `localStorage` and keeps any item it does not understand verbatim.
"""

from datetime import UTC, datetime
from typing import Any

import pytest
from pydantic import TypeAdapter, ValidationError

from abc_cook.schema import RecipeEdit, SavedLibrary, SavedRecipe
from abc_cook.schema.api import RecipePlanResponse

_ADAPTER: TypeAdapter[Any] = TypeAdapter(RecipeEdit)
_AT = "2026-10-20T08:00:00Z"
_ING = {"index": 1, "expected": {"name": "Besan", "qty_text": "4", "unit": "tbsp"}}
_STEP = {"index": 2, "expected": {"text": "Stir."}}


def _edit(op: str, **fields: object) -> dict[str, object]:
    return {"id": "e1", "created_at": _AT, "op": op, **fields}


GOOD: list[dict[str, object]] = [
    _edit("set_ingredient_name", anchor=_ING, value={"name": "Gram flour"}),
    _edit(
        "set_ingredient_amount",
        anchor=_ING,
        value={"amount": {"kind": "number", "low": 1.5, "high": None}, "unit": "tbsp"},
    ),
    _edit(
        "set_ingredient_amount",
        anchor=_ING,
        value={"amount": {"kind": "number", "low": 1, "high": 2}, "unit": None},
    ),
    _edit(
        "set_ingredient_amount",
        anchor=_ING,
        value={"amount": {"kind": "to_taste"}, "unit": None},
    ),
    _edit("remove_ingredient", anchor=_ING),
    _edit(
        "add_ingredient",
        value={
            "name": "Lemon juice",
            "amount": {"kind": "number", "low": 1, "high": None},
            "unit": "tsp",
            "step": None,
        },
    ),
    _edit(
        "add_ingredient",
        value={"name": "Curry leaves", "amount": None, "unit": None, "step": _STEP},
    ),
    _edit("set_step_text", anchor=_STEP, value={"text": "Stir for ten minutes."}),
]


@pytest.mark.parametrize("raw", GOOD, ids=[f"{g['op']}-{i}" for i, g in enumerate(GOOD)])
def test_each_op_round_trips(raw: dict[str, object]) -> None:
    edit = _ADAPTER.validate_python(raw)
    again = _ADAPTER.validate_json(_ADAPTER.dump_json(edit))
    assert again == edit
    assert edit.op == raw["op"]


def test_the_op_picks_the_model() -> None:
    names = {type(_ADAPTER.validate_python(raw)).__name__ for raw in GOOD}
    assert names == {
        "SetIngredientName",
        "SetIngredientAmount",
        "RemoveIngredient",
        "AddIngredient",
        "SetStepText",
    }


@pytest.mark.parametrize(
    "bad",
    [
        _edit("set_everything", anchor=_ING, value={"name": "x"}),
        _edit(
            "set_ingredient_name",
            anchor={"index": -1, "expected": _ING["expected"]},
            value={"name": "x"},
        ),
        _edit("set_ingredient_name", anchor={"index": 1}, value={"name": "x"}),
        _edit("set_ingredient_name", anchor=_ING, value={"name": ""}),
        _edit("set_ingredient_name", anchor=_ING, value={"name": "   "}),
        _edit("set_ingredient_name", anchor=_ING, value={"name": "x" * 81}),
        _edit(
            "set_ingredient_amount",
            anchor=_ING,
            value={"amount": {"kind": "number", "low": 0, "high": None}, "unit": "tbsp"},
        ),
        _edit(
            "set_ingredient_amount",
            anchor=_ING,
            value={"amount": {"kind": "number", "low": -1, "high": None}, "unit": "tbsp"},
        ),
        _edit(
            "set_ingredient_amount",
            anchor=_ING,
            value={"amount": {"kind": "number", "low": 2, "high": 2}, "unit": "tbsp"},
        ),
        _edit(
            "set_ingredient_amount",
            anchor=_ING,
            value={"amount": {"kind": "number", "low": 2, "high": 1}, "unit": "tbsp"},
        ),
        _edit(
            "set_ingredient_amount",
            anchor=_ING,
            value={"amount": {"kind": "as_written"}, "unit": "tbsp"},
        ),
        _edit(
            "set_ingredient_amount",
            anchor=_ING,
            value={"amount": {"kind": "to_taste"}, "unit": "tbsp"},
        ),
        _edit("add_ingredient", value={"name": "", "amount": None, "unit": None, "step": None}),
        _edit("set_step_text", anchor=_STEP, value={"text": ""}),
        _edit("set_step_text", anchor=_STEP, value={"text": "x" * 1001}),
        _edit("set_step_text", anchor={"index": 2}, value={"text": "ok"}),
        {"id": "e1", "op": "remove_ingredient", "anchor": _ING},
    ],
    ids=[
        "unknown-op",
        "negative-index",
        "no-expected",
        "empty-name",
        "blank-name",
        "long-name",
        "low-zero",
        "low-negative",
        "high-equals-low",
        "high-below-low",
        "as-written-dropped",
        "to-taste-with-unit",
        "add-empty-name",
        "step-empty",
        "step-too-long",
        "step-no-expected",
        "no-created-at",
    ],
)
def test_rejects_the_malformed(bad: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        _ADAPTER.validate_python(bad)


def test_a_name_is_trimmed() -> None:
    edit = _ADAPTER.validate_python(
        _edit("set_ingredient_name", anchor=_ING, value={"name": "  Gram flour "})
    )
    assert edit.value.name == "Gram flour"


def _saved(**extra: object) -> SavedRecipe:
    from fastapi.testclient import TestClient

    from abc_cook.api.main import create_app

    payload = RecipePlanResponse.model_validate(
        TestClient(create_app()).get("/recipes/kadai-paneer/plan").json()
    )
    return SavedRecipe(
        id="s1",
        source_key="text:x",
        saved_at=datetime.now(UTC),
        updated_at=datetime.now(UTC),
        payload=payload,
        **extra,  # type: ignore[arg-type]
    )


def test_saved_recipe_carries_a_list_of_edits() -> None:
    saved = _saved(edits=[GOOD[0], GOOD[1], GOOD[5]])
    assert [type(e).__name__ for e in saved.edits] == [
        "SetIngredientName",
        "SetIngredientAmount",
        "AddIngredient",
    ]
    assert SavedRecipe.model_validate_json(saved.model_dump_json()) == saved


def test_a_v2_library_with_empty_edits_still_validates() -> None:
    saved = _saved(edits=[])
    library = SavedLibrary(recipes=[saved])
    assert SavedLibrary.model_validate_json(library.model_dump_json()).recipes[0].edits == []
    assert _saved().edits == []
