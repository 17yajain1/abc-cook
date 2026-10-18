"""FGC-3 (PR 2): steps the source skips, marked `origin="added"`, and FGC-4's prompt rule.

Offline. Covers the schema field and its kill switch (`ABC_COOK_ADDED_STEPS`), the v8 prompt, the
byte-identity of the switched-off request, the Tier 0 rule, every `graph.py` added-step guard,
provenance, the streamed-draft scanner and the cache fingerprint. No recipe names: every source
is synthetic.
"""

from __future__ import annotations

import difflib
import hashlib
import importlib.util
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.adapters.base import (
    ADDED_STEPS_ENV,
    ExtractResult,
    added_steps_enabled,
)
from abc_cook.extract.adapters.prompting import model_schema, strict_json_schema, system_prompt
from abc_cook.extract.cache import cache_identity, current_fingerprint
from abc_cook.extract.draft import DraftScanner
from abc_cook.extract.graph import GraphBuildResult, build_graph
from abc_cook.extract.normalize import load_prompt, normalize
from abc_cook.extract.provenance import compute_provenance
from abc_cook.extract.validate import validate
from abc_cook.schema.api import DraftStep, StreamedDraft
from abc_cook.schema.graph import SourceRef
from abc_cook.schema.normalized import (
    NodeProvenance,
    NormalizedIngredient,
    NormalizedRecipe,
    NormalizedStep,
)

SOURCE = SourceRef(kind="url", value="https://youtu.be/test", imported_at=datetime.now(UTC))
_API = Path(__file__).resolve().parents[1]
_PROMPTS = _API / "abc_cook" / "extract" / "prompts"
_BEFORE = Path(__file__).parent / "fixtures" / "request"


def _load_dump_script() -> Any:
    spec = importlib.util.spec_from_file_location(
        "dump_extraction_request_added", _API / "scripts" / "dump_extraction_request.py"
    )
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


dump = _load_dump_script()


@pytest.fixture
def on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(ADDED_STEPS_ENV, "1")


@pytest.fixture
def off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(ADDED_STEPS_ENV, "0")


def _step(**overrides: object) -> NormalizedStep:
    defaults: dict[str, object] = {
        "text": "Do something.",
        "attention": "hands_on",
        "duration_stated": False,
        "station": "counter",
        "interruptible": True,
        "freshness": "none",
    }
    defaults.update(overrides)
    return NormalizedStep(**defaults)  # type: ignore[arg-type]


def _ingredients(*names: str) -> list[NormalizedIngredient]:
    return [NormalizedIngredient(name=n, qty="1", unit=None, prep_note=None) for n in names]


def _recipe(steps: list[NormalizedStep], *names: str) -> NormalizedRecipe:
    return NormalizedRecipe(
        title="Test",
        method_grounded=True,
        ingredients=_ingredients(*(names or ("Flour", "Milk"))),
        steps=steps,
    )


def _build(recipe: NormalizedRecipe, source_text: str) -> GraphBuildResult:
    return build_graph(recipe, source_text, graph_id="g_test", source=SOURCE)


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# The field and the kill switch
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [(None, False), ("", False), ("0", False), ("false", False), ("OFF", False), (" off ", False),
     ("garbage", False), ("1", True), ("true", True), ("ON", True), (" on ", True)],
)
def test_added_steps_switch(
    monkeypatch: pytest.MonkeyPatch, value: str | None, expected: bool
) -> None:
    if value is None:
        monkeypatch.delenv(ADDED_STEPS_ENV, raising=False)
    else:
        monkeypatch.setenv(ADDED_STEPS_ENV, value)
    assert added_steps_enabled() is expected


def test_origin_is_the_first_key_of_a_step_and_defaults_to_source() -> None:
    assert next(iter(NormalizedStep.model_fields)) == "origin"
    assert _step().origin == "source"
    assert next(iter(json.loads(_step().model_dump_json()))) == "origin"
    # An old stored original has no `origin` key at all.
    old = {k: v for k, v in json.loads(_step().model_dump_json()).items() if k != "origin"}
    assert NormalizedStep.model_validate(old).origin == "source"


def test_strict_schema_carries_origin_first_and_required_when_on(on: None) -> None:
    step = strict_json_schema(NormalizedRecipe)["$defs"]["NormalizedStep"]
    assert next(iter(step["properties"])) == "origin"
    assert "origin" in step["required"]
    assert step["properties"]["origin"]["enum"] == ["source", "added"]


def test_origin_is_absent_from_both_schemas_when_off(off: None) -> None:
    pasted = model_schema(NormalizedRecipe)["$defs"]["NormalizedStep"]["properties"]
    strict = strict_json_schema(NormalizedRecipe)["$defs"]["NormalizedStep"]
    assert "origin" not in pasted
    assert "origin" not in strict["properties"]
    assert "origin" not in strict["required"]
    assert '"origin"' not in system_prompt(load_prompt(), NormalizedRecipe)


def test_pasted_schema_carries_origin_when_on(on: None) -> None:
    assert '"origin"' in system_prompt(load_prompt(), NormalizedRecipe)


def test_off_prompt_and_schema_are_the_frozen_pre_origin_bytes(off: None) -> None:
    assert (
        _sha(system_prompt(load_prompt(), NormalizedRecipe))
        == "7d74b48a6aac30d82f775c19954fc4852dafa59e3fde9538ee8dfebf27ae3993"
    )
    assert (
        _sha(json.dumps(model_schema(NormalizedRecipe), sort_keys=True, ensure_ascii=False))
        == "5dd564a4d4244831ffa6f27e70a794130d03992f8a50307c3d7dca705d747f7b"
    )


def test_on_prompt_and_schemas_are_pinned(on: None) -> None:
    """The switched-on bytes (v8 prompt, pasted schema, strict schema). A diff here is a prompt or
    schema change: a product decision with a new POSTPROCESS_VERSION and A/B evidence."""
    assert (
        _sha(system_prompt(load_prompt(), NormalizedRecipe))
        == "332239cd3947750cb2f936b0efeeeab7833dfa4af66a744d992d35ac4f8d3da5"
    )
    assert (
        _sha(json.dumps(model_schema(NormalizedRecipe), sort_keys=True, ensure_ascii=False))
        == "8a14205e73f98d5e20e5ab70ca428bfbb2fc1ba34d9e68e4356f2c2579fb1d45"
    )
    assert (
        _sha(json.dumps(strict_json_schema(NormalizedRecipe), sort_keys=True, ensure_ascii=False))
        == "8aef97a9cf6b62a637eab90ab9f8beaa28c9910ef4b13b4d788eea10203f8ddd"
    )


def test_load_prompt_follows_the_switch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(ADDED_STEPS_ENV, "on")
    assert "extraction prompt (v8)" in load_prompt()
    monkeypatch.delenv(ADDED_STEPS_ENV, raising=False)
    assert "extraction prompt (v7)" in load_prompt()  # the default is off
    monkeypatch.setenv(ADDED_STEPS_ENV, "off")
    assert "extraction prompt (v7)" in load_prompt()


@pytest.mark.parametrize("stream", [True, False])
@pytest.mark.parametrize("strict", [True, False])
def test_off_request_is_the_frozen_before_body_in_all_four_combos(
    stream: bool, strict: bool
) -> None:
    before: dict[str, Any] = json.loads(
        (_BEFORE / f"before-stream-{'on' if stream else 'off'}.json").read_text(encoding="utf-8")
    )
    body = dump.capture(stream=stream, strict=strict, added=False)
    if strict:
        assert body.pop("response_format")["json_schema"]["strict"] is True
    assert body == before


@pytest.mark.parametrize("stream", [True, False])
@pytest.mark.parametrize("strict", [True, False])
def test_on_request_differs_only_in_prompt_and_strict_schema(stream: bool, strict: bool) -> None:
    off_body = dump.capture(stream=stream, strict=strict, added=False)
    on_body = dump.capture(stream=stream, strict=strict, added=True)
    assert set(on_body) == set(off_body)
    changed = {k for k in on_body if on_body[k] != off_body[k]}
    assert changed == ({"messages", "response_format"} if strict else {"messages"})
    assert on_body["messages"][1:] == off_body["messages"][1:]  # only messages[0].content moves
    assert on_body["messages"][0]["content"] != off_body["messages"][0]["content"]
    if strict:
        on_schema = on_body["response_format"]["json_schema"]["schema"]
        off_schema = off_body["response_format"]["json_schema"]["schema"]
        on_step = on_schema["$defs"]["NormalizedStep"]
        off_step = off_schema["$defs"]["NormalizedStep"]
        assert next(iter(on_step["properties"])) == "origin"
        assert list(on_step["properties"])[1:] == list(off_step["properties"])
        assert on_step["required"] == ["origin", *off_step["required"]]


def test_v8_is_v7_plus_only_the_added_passages() -> None:
    v7 = (_PROMPTS / "v7.md").read_text(encoding="utf-8").splitlines()
    v8 = (_PROMPTS / "v8.md").read_text(encoding="utf-8").splitlines()
    assert v8[0].endswith("(v8)")
    assert v7[0].endswith("(v7)")
    removed = [
        line
        for line in difflib.unified_diff(v7[1:], v8[1:], lineterm="", n=0)
        if line.startswith("-") and not line.startswith("---")
    ]
    # The one sentence after "never invent" is reflowed; nothing else of v7 may change.
    assert len(removed) <= 3, removed
    text = "\n".join(v8)
    assert '`origin="added"`' in text
    assert "## Steps the source skips" in text
    assert "can be replaced" in text or "substitution" in text.lower()
    assert "several ways" in text.lower() or "ways to serve" in text.lower()


def test_v8_examples_use_none_of_the_evaluated_recipes() -> None:
    v8 = (_PROMPTS / "v8.md").read_text(encoding="utf-8").lower()
    for word in (
        "pancake", "burger", "patty", "tikki", "oatmeal", "oats", "skillet",
        "cupcake", "kadhi", "croissant", "pumpkin", "chole", "biryani",
    ):
        assert word not in v8


def test_fingerprint_changes_with_the_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(ADDED_STEPS_ENV, "1")
    on_fp = current_fingerprint(None)
    monkeypatch.delenv(ADDED_STEPS_ENV, raising=False)
    off_fp = current_fingerprint(None)  # the default is off
    assert on_fp.extraction_added_steps is True
    assert off_fp.extraction_added_steps is False
    assert cache_identity("k", on_fp) != cache_identity("k", off_fp)


# ---------------------------------------------------------------------------
# Tier 0: at least one step from the source
# ---------------------------------------------------------------------------


class _FakeAdapter:
    def __init__(self, recipe: NormalizedRecipe) -> None:
        self.recipe = recipe
        self.calls = 0

    def extract(self, **_: object) -> ExtractResult[NormalizedRecipe]:
        self.calls += 1
        return ExtractResult(recipe=self.recipe)


def _raw() -> RawAcquisition:
    return RawAcquisition(
        source_url="https://youtu.be/test",
        title="Test",
        description="1 cup flour, 1 cup milk.",
    )


def test_a_recipe_of_only_added_steps_is_tier_0_with_ingredients_kept() -> None:
    steps = [_step(text="Mix the flour.", origin="added"), _step(text="Bake.", origin="added")]
    recipe = _recipe(steps)
    outcome = normalize(_raw(), _FakeAdapter(recipe))  # type: ignore[arg-type]
    assert outcome.recipe is None
    assert outcome.tier0_result is not None
    assert outcome.tier0_result.status == "method_not_grounded"
    assert [i.name for i in outcome.tier0_result.ingredients] == ["Flour", "Milk"]


def test_one_source_step_among_added_ones_is_enough() -> None:
    recipe = _recipe([_step(text="Mix the flour.", origin="added"), _step(text="Bake it.")])
    outcome = normalize(_raw(), _FakeAdapter(recipe))  # type: ignore[arg-type]
    assert outcome.recipe is not None
    assert outcome.tier0_result is None


def test_build_graph_refuses_a_recipe_with_no_source_step() -> None:
    recipe = _recipe([_step(text="Mix the flour.", origin="added")])
    assert _build(recipe, "1 cup flour.").graph is None


# ---------------------------------------------------------------------------
# graph.py added-step guards
# ---------------------------------------------------------------------------

_SRC = "Add the dry mix to the bowl. Bake at 180 C for 20 minutes. Serve."


def _with_added(added: NormalizedStep, *, source: str = _SRC) -> tuple[GraphBuildResult, str]:
    steps = [
        _step(text="Add the dry mix to the bowl.", consumes_ingredients=["Milk"]),
        added,
        _step(
            text="Bake at 180 C for 20 minutes.",
            attention="unattended",
            attention_cue="Bake at 180 C for 20 minutes",
            duration_min=20,
            duration_typical_min=20,
            duration_max=22,
            duration_stated=True,
            station="oven",
            consumes_ingredients=["Flour"],
        ),
        _step(text="Serve."),
    ]
    return _build(_recipe(steps), source), source


def test_an_added_step_is_kept_hands_on_with_an_estimated_duration() -> None:
    result, _ = _with_added(
        _step(
            text="Stir the mixture until combined.",
            origin="added",
            attention="unattended",
            attention_cue="Stir",
            duration_stated=True,
            duration_min=5,
            duration_typical_min=7,
            duration_max=9,
        )
    )
    assert result.graph is not None
    nodes = {n.instruction: n for n in result.graph.nodes}
    node = nodes["Stir the mixture until combined."]
    assert node.attention == "hands_on"
    decisions = {d.node_id: d for d in result.node_decisions}
    assert decisions[node.id].origin == "added"
    assert decisions[node.id].duration_source != "extracted"
    assert decisions[node.id].attention_source != "extracted"
    assert all(d.origin == "source" for d in result.node_decisions if d.node_id != node.id)
    assert validate(result.graph) == []


def test_a_non_required_added_step_is_dropped_not_made_a_tip() -> None:
    result, _ = _with_added(
        _step(
            text="Dust with sugar if desired.",
            origin="added",
            role="optional",
            role_cue="if desired",
            attach_to_step=0,
        ),
        source=_SRC + " Dust with sugar if desired.",
    )
    assert result.graph is not None
    assert all("Dust" not in n.instruction for n in result.graph.nodes)
    assert all("Dust" not in (n.tip or "") for n in result.graph.nodes)
    assert any("added" in w.lower() for w in result.warnings)


@pytest.mark.parametrize(
    ("text", "kept"),
    [
        ("Rest the mixture for 20 minutes.", True),   # the source's own 20 minutes
        ("Rest the mixture for 7 minutes.", False),   # nowhere in the source
        ("Preheat to 180 C.", True),
        ("Preheat to 200 C.", False),
        ("Preheat to 350 F.", False),                 # the source's number is in the other system
        ("Preheat to 180 degrees.", True),
        ("Preheat to 220 degrees.", False),
        ("Preheat to gas mark 6.", False),
    ],
)
def test_an_added_step_with_an_ungrounded_time_or_temperature_is_dropped(
    text: str, kept: bool
) -> None:
    result, _ = _with_added(_step(text=text, origin="added"))
    assert result.graph is not None
    assert (text in {n.instruction for n in result.graph.nodes}) is kept
    if not kept:
        assert result.review_recommended is True
        assert any(text[:20] in w for w in result.warnings)
    assert validate(result.graph) == []


def test_a_hindi_temperature_is_grounded_by_the_same_number() -> None:
    source = "सब मिलाएं। 180 डिग्री पर बेक करें।"
    steps = [
        _step(text="सब मिलाएं।"),
        _step(text="ओवन 180 डिग्री पर गरम करें।", origin="added"),
        _step(text="ओवन 200 डिग्री पर गरम करें।", origin="added"),
        _step(text="180 डिग्री पर बेक करें।"),
    ]
    result = _build(_recipe(steps), source)
    assert result.graph is not None
    texts = {n.instruction for n in result.graph.nodes}
    assert "ओवन 180 डिग्री पर गरम करें।" in texts
    assert "ओवन 200 डिग्री पर गरम करें।" not in texts


def test_an_added_step_produces_a_label_only_if_a_later_step_consumes_it() -> None:
    steps = [
        _step(text="Add the dry mix to the bowl.", consumes_ingredients=["Milk"]),
        _step(
            text="Whisk it all together.",
            origin="added",
            consumes_ingredients=["Flour"],
            produces_component="the whisked mix",
        ),
        _step(text="Serve."),
    ]
    result = _build(_recipe(steps), "Add the dry mix to the bowl. Serve.")
    assert result.graph is not None
    whisk = next(n for n in result.graph.nodes if n.instruction == "Whisk it all together.")
    assert whisk.produces is None
    assert validate(result.graph) == []

    steps[2] = _step(text="Serve the whisked mix.", consumes_ingredients=["the whisked mix"])
    consumed = _build(_recipe(steps), "Add the dry mix to the bowl. Serve the whisked mix.")
    assert consumed.graph is not None
    whisk = next(n for n in consumed.graph.nodes if n.instruction == "Whisk it all together.")
    assert whisk.produces is not None
    assert validate(consumed.graph) == []


def test_a_dropped_added_step_hands_its_ingredients_to_the_step_that_needed_them() -> None:
    steps = [
        _step(text="Add the dry mix to the bowl.", consumes_ingredients=["Milk"]),
        _step(
            text="Heat to 999 C.",
            origin="added",
            consumes_ingredients=["Flour"],
            produces_component="the base",
            depends_on_steps=[0],
        ),
        _step(
            text="Bake it.",
            consumes_ingredients=["the base"],
            depends_on_steps=[1],
        ),
    ]
    result = _build(_recipe(steps), "Add the dry mix to the bowl. Bake it.")
    assert result.graph is not None
    assert [n.instruction for n in result.graph.nodes] == [
        "Add the dry mix to the bowl.",
        "Bake it.",
    ]
    bake = result.graph.nodes[1]
    flour = next(i.id for i in result.graph.ingredients if i.name == "Flour")
    assert flour in bake.consumes
    assert result.graph.nodes[0].id in bake.depends_on
    assert validate(result.graph) == []


def test_source_only_recipes_build_exactly_as_before() -> None:
    steps = [_step(text="Add the dry mix to the bowl."), _step(text="Serve.")]
    result = _build(_recipe(steps), "Add the dry mix to the bowl. Serve.")
    assert result.graph is not None
    assert all(d.origin == "source" for d in result.node_decisions)


# ---------------------------------------------------------------------------
# Provenance
# ---------------------------------------------------------------------------


def test_provenance_records_origin_per_node() -> None:
    result, _ = _with_added(_step(text="Stir the mixture until combined.", origin="added"))
    provenance = compute_provenance(result)
    by_text = {
        n.instruction: provenance.nodes[n.id].origin
        for n in (result.graph.nodes if result.graph else [])
    }
    assert by_text["Stir the mixture until combined."] == "added"
    assert by_text["Serve."] == "source"


def test_old_provenance_without_origin_reads_as_source() -> None:
    assert NodeProvenance.model_validate({"fields": {}}).origin == "source"


def test_the_derived_wait_before_serving_is_source_not_added() -> None:
    steps = [
        _step(text="Add the fried bits ten minutes before serving."),
        _step(text="Make the topping."),
        _step(text="Serve."),
    ]
    result = _build(
        _recipe(steps), "Add the fried bits 10 minutes before serving. Make the topping. Serve."
    )
    assert result.graph is not None
    provenance = compute_provenance(result)
    wait = next(n for n in result.graph.nodes if n.label == "Wait before serving")
    assert provenance.nodes[wait.id].origin == "source"


# ---------------------------------------------------------------------------
# Streamed draft: the scanner reads `origin` before it shows a step
# ---------------------------------------------------------------------------


def _scan(text: str) -> DraftScanner:
    scanner = DraftScanner(origin_aware=True)
    scanner.feed(text)
    return scanner


def test_origin_before_text_labels_the_step_as_soon_as_its_text_closes() -> None:
    scanner = _scan('{"steps":[{"origin":"added","text":"Mix it.","label":nu')
    assert scanner.steps == ["Mix it."]
    assert scanner.step_added == [True]
    scanner = _scan('{"steps":[{"origin":"source","text":"Bake it."')
    assert scanner.steps == ["Bake it."]
    assert scanner.step_added == [False]


def test_origin_after_text_holds_the_step_until_its_object_closes() -> None:
    scanner = _scan('{"steps":[{"text":"Mix it.","origin":"added"')
    assert scanner.steps == []
    scanner = _scan('{"steps":[{"text":"Mix it.","origin":"added"},')
    assert scanner.steps == ["Mix it."]
    assert scanner.step_added == [True]


def test_a_step_with_no_origin_is_held_until_its_object_closes_then_reads_as_source() -> None:
    scanner = _scan('{"steps":[{"text":"Mix it.","label":null')
    assert scanner.steps == []
    scanner = _scan('{"steps":[{"text":"Mix it.","label":null},{"origin":"added","text":"B"')
    assert scanner.steps == ["Mix it.", "B"]
    assert scanner.step_added == [False, True]


def test_scanner_is_unchanged_when_not_origin_aware() -> None:
    scanner = DraftScanner()
    scanner.feed('{"steps":[{"text":"Mix it.","origin":"added"')
    assert scanner.steps == ["Mix it."]
    assert scanner.step_added == [False]


def test_chunked_and_whole_feeds_agree_on_a_full_recipe_with_origin() -> None:
    recipe = _recipe(
        [
            _step(text="One."),
            _step(text="Two.", origin="added"),
            _step(text="Three."),
        ]
    )
    text = recipe.model_dump_json()
    whole = _scan(text)
    assert whole.steps == ["One.", "Two.", "Three."]
    assert whole.step_added == [False, True, False]
    chunked = DraftScanner(origin_aware=True)
    for i in range(0, len(text), 7):
        chunked.feed(text[i : i + 7])
    assert chunked.steps == whole.steps
    assert chunked.step_added == whole.step_added
    assert chunked.steps_complete


def test_a_draft_step_carries_added_and_defaults_to_false() -> None:
    assert DraftStep(text="a").added is False
    draft = StreamedDraft(steps=[DraftStep(text="a", added=True)])
    assert json.loads(draft.model_dump_json())["steps"][0]["added"] is True


# ---------------------------------------------------------------------------
# An added step uses only ingredients the source lists
# ---------------------------------------------------------------------------


def test_an_added_step_with_an_unlisted_ingredient_is_dropped_with_a_warning() -> None:
    result, _ = _with_added(
        _step(text="Whisk in the vanilla.", origin="added", consumes_ingredients=["Vanilla"])
    )
    assert result.graph is not None
    assert all("vanilla" not in n.instruction.lower() for n in result.graph.nodes)
    assert any('"Vanilla"' in w and "does not list" in w for w in result.warnings)
    assert result.review_recommended is True
    assert validate(result.graph) == []


def test_an_added_step_may_use_listed_ingredients_and_earlier_products() -> None:
    steps = [
        _step(text="Add the dry mix to the bowl.", consumes_ingredients=["Milk"],
              produces_component="the mix"),
        _step(text="Stir it smooth.", origin="added", consumes_ingredients=["flour", "the mix"]),
        _step(text="Serve."),
    ]
    result = _build(_recipe(steps), "Add the dry mix to the bowl. Serve.")
    assert result.graph is not None
    assert "Stir it smooth." in {n.instruction for n in result.graph.nodes}


# ---------------------------------------------------------------------------
# attach_to_step that points at a step which was itself demoted to a tip
# ---------------------------------------------------------------------------

_WAYS = "There are two ways to eat these."


def _ways_recipe(second_cue: str, second_text: str) -> tuple[NormalizedRecipe, str]:
    steps = [
        _step(text="Cook the batch.", consumes_ingredients=["Flour", "Milk"]),
        _step(
            text=f"{_WAYS} Eat them plain.",
            role="optional",
            role_cue=_WAYS,
            attach_to_step=0,
        ),
        _step(text=second_text, role="optional", role_cue=second_cue, attach_to_step=1),
        _step(text="Clean up."),
    ]
    source = f"Cook the batch. {_WAYS} Eat them plain. {second_text} Clean up."
    return _recipe(steps), source


def test_a_later_way_attached_to_a_demoted_first_way_becomes_a_tip_on_the_cooking_step() -> None:
    recipe, source = _ways_recipe(_WAYS, "Or eat them with honey.")
    result = _build(recipe, source)
    assert result.graph is not None
    assert [n.instruction for n in result.graph.nodes] == ["Cook the batch.", "Clean up."]
    tip = result.graph.nodes[0].tip or ""
    assert "Eat them plain." in tip
    assert "Or eat them with honey." in tip  # nothing dropped
    assert validate(result.graph) == []


def test_a_later_way_whose_cue_is_not_in_the_demoted_target_keeps_the_borrowed_cue_rule() -> None:
    """Documents today's behaviour (CP2 6.2b, unchanged): a cue that is real and optional-worded but
    not in the attach target's own text does not demote the step. It never crashes and the
    information is kept, but the step stays a required node chained after the cooking step, with a
    warning and a review flag. The v8 prompt asks the model to quote the same introducing phrase,
    which is the case the test above covers."""
    recipe, source = _ways_recipe("different ways", "Or eat them with honey.")
    result = _build(recipe, source + " There are different ways to serve.")
    assert result.graph is not None
    assert [n.instruction for n in result.graph.nodes] == [
        "Cook the batch.",
        "Or eat them with honey.",
        "Clean up.",
    ]
    assert "Eat them plain." in (result.graph.nodes[0].tip or "")
    assert any("borrowed from elsewhere" in w for w in result.warnings)
    assert result.review_recommended is True
    assert validate(result.graph) == []


def test_unset_switch_is_the_pre_fgc3_request(monkeypatch: pytest.MonkeyPatch) -> None:
    """With the variable unset (the default) the request is origin/main's, in all four combos."""
    monkeypatch.delenv(ADDED_STEPS_ENV, raising=False)
    assert added_steps_enabled() is False
    assert "extraction prompt (v7)" in load_prompt()
    assert '"origin"' not in system_prompt(load_prompt(), NormalizedRecipe)
    strict_step = strict_json_schema(NormalizedRecipe)["$defs"]["NormalizedStep"]
    assert "origin" not in strict_step["properties"]


@pytest.mark.parametrize("stream", [True, False])
@pytest.mark.parametrize("strict", [True, False])
def test_unset_switch_request_is_the_frozen_before_body(
    monkeypatch: pytest.MonkeyPatch, stream: bool, strict: bool
) -> None:
    monkeypatch.delenv(ADDED_STEPS_ENV, raising=False)
    before: dict[str, Any] = json.loads(
        (_BEFORE / f"before-stream-{'on' if stream else 'off'}.json").read_text(encoding="utf-8")
    )
    body = dump.capture(stream=stream, strict=strict, added=None)
    if strict:
        body.pop("response_format")
    assert body == before
