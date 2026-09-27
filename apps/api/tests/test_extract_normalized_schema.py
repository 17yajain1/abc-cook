"""CP2-A: the `NormalizedStep` fields for explicit dependencies and optional/alternative
steps, and extraction prompt v3.

CP2-A only adds these to the extraction contract. Nothing consumes them yet: `graph.py`
ignores `depends_on_steps`/`role` until CP2-B, and production extraction stays on
prompt v2 until CP2-B switches it (v3 output fed to the current builder would have its
dependency claims ignored).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from abc_cook.extract import normalize
from abc_cook.extract.adapters.prompting import system_prompt
from abc_cook.schema.normalized import NormalizedRecipe, NormalizedStep

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "import"
PROMPTS_DIR = Path(normalize.__file__).parent / "prompts"


def _minimal_step(**overrides: object) -> NormalizedStep:
    fields: dict[str, object] = {
        "text": "Chop the onion.",
        "attention": "hands_on",
        "duration_stated": False,
        "station": "counter",
        "interruptible": True,
        "freshness": "none",
    }
    fields.update(overrides)
    return NormalizedStep.model_validate(fields)


def test_new_step_fields_default_to_legacy_required_behaviour() -> None:
    """A model response that omits every CP2 field must mean exactly what it meant
    before CP2: a required step, dependencies given by `depends_on_previous`."""
    step = _minimal_step()
    assert step.depends_on_steps is None
    assert step.role == "required"
    assert step.role_cue is None
    assert step.attach_to_step is None
    assert step.depends_on_previous is True


def test_empty_depends_on_steps_is_distinct_from_not_provided() -> None:
    """`[]` is a claim ("needs nothing earlier"); `None` is "not provided". CP2-B's
    builder branches on this difference, so the schema must preserve it."""
    assert _minimal_step(depends_on_steps=[]).depends_on_steps == []
    assert _minimal_step().depends_on_steps is None
    assert _minimal_step(depends_on_steps=[0, 2]).depends_on_steps == [0, 2]


def test_role_rejects_unknown_values() -> None:
    with pytest.raises(ValidationError, match="role"):
        _minimal_step(role="maybe")


@pytest.mark.parametrize("slug", ["pizza-dough", "dal-makhni-multibranch"])
def test_captured_replay_fixtures_still_parse_as_legacy_required_steps(slug: str) -> None:
    raw = (FIXTURES_DIR / f"{slug}.normalized.json").read_text(encoding="utf-8")
    assert "depends_on_steps" not in json.loads(raw)["steps"][0]  # captured pre-CP2
    recipe = NormalizedRecipe.model_validate_json(raw)
    assert all(step.depends_on_steps is None for step in recipe.steps)
    assert all(step.role == "required" for step in recipe.steps)


def test_production_extraction_uses_prompt_v4() -> None:
    """P0 #0 (§10 step 7) switched production extraction to v4, which adds the
    borrowed-optional-follow-on, per-unit-duration, and holding-limit rules that
    `graph.py`'s verification alone can't teach the model. v3 is kept on disk (a
    prior prompt version stays reproducible), just no longer the production path."""
    assert normalize._PROMPT_PATH.name == "v4.md"
    assert "extraction prompt (v4)" in normalize.load_prompt()
    assert (PROMPTS_DIR / "v3.md").exists()


def test_prompt_v3_schema_carries_the_new_fields() -> None:
    v3 = (PROMPTS_DIR / "v3.md").read_text(encoding="utf-8")
    rendered = system_prompt(v3, NormalizedRecipe)
    for field in ("depends_on_steps", "role", "role_cue", "attach_to_step"):
        assert f'"{field}"' in rendered


def test_prompt_v3_instructs_the_cp2_semantics() -> None:
    v3 = (PROMPTS_DIR / "v3.md").read_text(encoding="utf-8")
    assert "extraction prompt (v3)" in v3
    assert "## `depends_on_steps`" in v3
    assert "## Optional, conditional and alternative instructions" in v3
    assert "Never drop one" in v3
    assert "whether the **cook** has to be present" in v3
    # The legacy section is gone, not left alongside the new one.
    assert "## `depends_on_previous`" not in v3


def test_prompt_v3_examples_use_none_of_the_evaluated_recipes() -> None:
    """CP2-C validates against the owner's Pancakes/Burger/Oatmeal evidence. The prompt
    must not be tuned on that evidence, or the validation proves nothing."""
    v3 = (PROMPTS_DIR / "v3.md").read_text(encoding="utf-8").lower()
    for word in ("pancake", "burger", "patty", "tikki", "oatmeal", "oats", "skillet"):
        assert word not in v3


def test_prompt_v4_schema_carries_the_cp2_fields() -> None:
    v4 = (PROMPTS_DIR / "v4.md").read_text(encoding="utf-8")
    rendered = system_prompt(v4, NormalizedRecipe)
    for field in ("depends_on_steps", "role", "role_cue", "attach_to_step"):
        assert f'"{field}"' in rendered


def test_prompt_v4_instructs_the_cp2_semantics() -> None:
    v4 = (PROMPTS_DIR / "v4.md").read_text(encoding="utf-8")
    assert "extraction prompt (v4)" in v4
    assert "## `depends_on_steps`" in v4
    assert "## Optional, conditional and alternative instructions" in v4
    assert "Never drop one" in v4
    assert "whether the **cook** has to be present" in v4
    assert "## `depends_on_previous`" not in v4


def test_prompt_v4_instructs_the_p0_rules() -> None:
    """§10 step 7: prompt v4 adds exactly the three rules §6 item 3 specifies --
    the borrowed-optional-follow-on attach rule, the per-unit duration rule, and
    the holding-limit rule -- on top of v3's unchanged content."""
    v4 = (PROMPTS_DIR / "v4.md").read_text(encoding="utf-8")
    assert "only matters" in v4
    assert "earlier instruction was optional" in v4
    assert "attach_to_step` to **that earlier" in v4
    assert "optional instruction's position**" in v4
    assert "per side, per batch, or per piece" in v4
    assert "whole step's total time" in v4
    assert "duration_stated=false" in v4
    assert "holding limit" in v4


def test_prompt_v4_examples_use_none_of_the_evaluated_recipes() -> None:
    """Same CP2-C guard as v3 (§6: "no Pancakes/Oatmeal/skillet words") -- the new
    rules' own examples must not be tuned on the owner's evaluated evidence either."""
    v4 = (PROMPTS_DIR / "v4.md").read_text(encoding="utf-8").lower()
    for word in ("pancake", "burger", "patty", "tikki", "oatmeal", "oats", "skillet"):
        assert word not in v4
