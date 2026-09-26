"""extract/repair.py -- one repair pass on a failed graph, else Tier 1 degrade.

Offline: a fake `LLMAdapter` stands in for the provider (same pattern as
test_extract_normalize.py). The real, live repair pass against the actual multi-branch
recipe that failed validation at the M2.9 s15 checkpoint is a separate
`@pytest.mark.llm` test at the bottom of this file, excluded from the default run.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import pytest

from abc_cook.extract.adapters.base import ExtractResult
from abc_cook.extract.graph import build_graph
from abc_cook.extract.provenance import compute_provenance
from abc_cook.extract.repair import (
    RepairProposal,
    StepRepair,
    _merge_repair,
    load_repair_prompt,
    render_repair_source,
    repair_or_degrade,
)
from abc_cook.extract.validate import validate
from abc_cook.schema.graph import SourceRef
from abc_cook.schema.normalized import NormalizedIngredient, NormalizedRecipe, NormalizedStep

SOURCE = SourceRef(kind="url", value="https://youtu.be/test", imported_at=datetime.now(UTC))


def _step(**overrides: object) -> NormalizedStep:
    defaults: dict[str, object] = {
        "text": "Do something.",
        "attention": "hands_on",
        "duration_stated": True,
        "duration_min": 2,
        "duration_typical_min": 3,
        "duration_max": 5,
        "station": "counter",
        "interruptible": True,
        "freshness": "none",
    }
    defaults.update(overrides)
    return NormalizedStep(**defaults)  # type: ignore[arg-type]


def _recipe(steps: list[NormalizedStep], **overrides: object) -> NormalizedRecipe:
    defaults: dict[str, object] = {
        "title": "Test",
        "method_grounded": True,
        "ingredients": [
            NormalizedIngredient(name="Onion", qty="1", unit=None, prep_note=None),
            NormalizedIngredient(name="Butter", qty="1", unit="tbsp", prep_note=None),
        ],
        "steps": steps,
    }
    defaults.update(overrides)
    return NormalizedRecipe(**defaults)  # type: ignore[arg-type]


# Two branches (chop onion; melt butter) that a real multi-branch recipe shape would
# produce, one of them honestly independent (no shared ingredient/component with its
# predecessor). B1 (fork/join edge construction) now joins both branches back in at
# "Serve hot." by construction -- this recipe no longer reproduces the *structural*
# failure (single_finish_sink/no_orphans) the old chain-break used to cause; see
# docs/cooking-plan-investigation.md §5 B1. It is re-broken here by a genuine,
# structure-independent violation instead: "Salt" is listed as an ingredient but no
# step consumes it (ingredients_consumed) -- still repairable (REPAIRABLE_RULES),
# still the same fault family (a real recipe's ingredient list not fully wired to its
# steps), just no longer dependent on the chain-break this fixture used to rely on.
def _broken_two_branch_recipe() -> NormalizedRecipe:
    return _recipe(
        [
            _step(text="Chop the onion.", consumes_ingredients=["Onion"]),
            _step(
                text="Melt the butter in a pan.",
                depends_on_previous=False,  # independent claim: true here, no shared ingredient
                consumes_ingredients=["Butter"],
            ),
            _step(text="Serve hot.", consumes_ingredients=[]),
        ],
        ingredients=[
            NormalizedIngredient(name="Onion", qty="1", unit=None, prep_note=None),
            NormalizedIngredient(name="Butter", qty="1", unit="tbsp", prep_note=None),
            NormalizedIngredient(name="Salt", qty="1", unit="tsp", prep_note=None),  # unconsumed
        ],
    )


def _source_text() -> str:
    return "Chop the onion. Melt the butter in a pan. Serve hot."


def _proposal(
    steps: list[tuple[list[str], str | None, bool]],
) -> RepairProposal:
    """Build a `RepairProposal` from `(consumes_ingredients, produces_component,
    depends_on_previous)` tuples, one per step, in order."""
    return RepairProposal(
        steps=[
            StepRepair(
                consumes_ingredients=consumes,
                produces_component=produces,
                depends_on_previous=dep_prev,
            )
            for consumes, produces, dep_prev in steps
        ]
    )


@dataclass
class _FakeAdapter:
    """Returns queued `ExtractResult`s in order, one per `.extract()` call."""

    results: list[ExtractResult]
    calls: int = 0

    def extract(
        self,
        *,
        prompt: str,
        source_text: str,
        model: str,
        max_tokens: int,
        output_type: type,
        effort: str | None = None,
    ) -> ExtractResult:
        result = self.results[self.calls]
        self.calls += 1
        return result


def _build_and_validate(recipe: NormalizedRecipe, source_text: str) -> list:
    result = build_graph(recipe, source_text, graph_id="g_test", source=SOURCE)
    assert result.graph is not None
    return validate(result.graph)


def test_confirms_the_broken_fixture_actually_fails_first() -> None:
    """Sanity check: the synthetic recipe reproduces a real failure before repair.py
    ever gets involved. Under B1 the two branches join structurally (single sink, no
    orphans) -- the fixture's remaining, genuine failure is the unconsumed "Salt"."""
    violations = _build_and_validate(_broken_two_branch_recipe(), _source_text())
    assert violations  # must actually fail, or this test fixture proves nothing
    rules = {v.rule for v in violations}
    assert rules == {"ingredients_consumed"}


def test_raises_if_called_with_no_violations() -> None:
    """LOCKED requirement 1: repair only runs on an actual validation failure."""
    adapter = _FakeAdapter(results=[])
    with pytest.raises(ValueError, match="no violations"):
        repair_or_degrade(
            _broken_two_branch_recipe(),
            _source_text(),
            [],
            adapter,
            graph_id="g",
            source=SOURCE,
        )
    assert adapter.calls == 0


def test_successful_repair_is_fully_revalidated() -> None:
    """A repair response that fixes the fixture's genuine failure -- "Salt" named by
    the merge step -- must produce a graph that passes every invariant. (The two
    branches themselves no longer need a repair to join: B1 already does that by
    construction -- see `_broken_two_branch_recipe`'s docstring.)"""
    recipe = _broken_two_branch_recipe()
    violations = _build_and_validate(recipe, _source_text())

    proposal = _proposal(
        [
            (["Onion"], "chopped onion", True),
            (["Butter"], "melted butter", False),
            (["chopped onion", "melted butter", "Salt"], None, True),
        ]
    )
    adapter = _FakeAdapter(results=[ExtractResult(recipe=proposal)])

    outcome = repair_or_degrade(
        recipe, _source_text(), violations, adapter, graph_id="g", source=SOURCE
    )

    assert outcome.tier == "repaired"
    assert outcome.build_result.graph is not None
    assert validate(outcome.build_result.graph) == []
    assert any("repaired" in w.lower() for w in outcome.build_result.warnings)
    assert outcome.build_result.review_recommended is True
    assert adapter.calls == 1


def test_failed_repair_degrades_to_tier1_linear() -> None:
    """A repair response that doesn't actually fix anything must fall through to the
    guaranteed-safe linear degrade, never an invalid graph."""
    recipe = _broken_two_branch_recipe()
    violations = _build_and_validate(recipe, _source_text())

    # The model "tries" but returns the exact same (still-broken) relationships.
    same = _proposal([(["Onion"], None, True), (["Butter"], None, False), ([], None, True)])
    adapter = _FakeAdapter(results=[ExtractResult(recipe=same)])

    outcome = repair_or_degrade(
        recipe, _source_text(), violations, adapter, graph_id="g", source=SOURCE
    )

    assert outcome.tier == "degraded"
    assert outcome.build_result.graph is not None
    assert validate(outcome.build_result.graph) == []  # Tier 1 must always be valid
    assert "degraded" in outcome.build_result.warnings
    # Tier 1 forces the whole thing sequential -- no independent branches survive.
    ids = [n.id for n in outcome.build_result.graph.nodes]
    assert outcome.build_result.graph.nodes[1].depends_on == [ids[0]]


def test_repair_call_erroring_twice_degrades_to_tier1() -> None:
    recipe = _broken_two_branch_recipe()
    violations = _build_and_validate(recipe, _source_text())
    adapter = _FakeAdapter(
        results=[
            ExtractResult(recipe=None, error="boom"),
            ExtractResult(recipe=None, error="boom again"),
        ]
    )
    outcome = repair_or_degrade(
        recipe, _source_text(), violations, adapter, graph_id="g", source=SOURCE
    )
    assert outcome.tier == "degraded"
    assert adapter.calls == 2  # retried once, per normalize.py's own truncation policy
    assert validate(outcome.build_result.graph) == []


def test_repair_cannot_invent_a_step() -> None:
    """LOCKED requirement 3: no invented steps. A proposal with the wrong number of
    entries must be rejected wholesale, not partially merged."""
    recipe = _broken_two_branch_recipe()
    violations = _build_and_validate(recipe, _source_text())

    extra_entry = _proposal(
        [(["Onion"], None, True), (["Butter"], None, False), ([], None, True), ([], None, True)]
    )
    adapter = _FakeAdapter(results=[ExtractResult(recipe=extra_entry)])

    outcome = repair_or_degrade(
        recipe, _source_text(), violations, adapter, graph_id="g", source=SOURCE
    )
    assert outcome.tier == "degraded"  # the extra entry got the whole repair rejected
    assert len(outcome.build_result.graph.nodes) == 3  # original step count, not 4


def test_repair_response_schema_has_no_content_fields() -> None:
    """LOCKED requirement 3, structurally: `StepRepair` physically cannot carry step
    text, an ingredient, attention, duration, or freshness -- there is no field for a
    repair pass to invent or rewrite any of that into, regardless of prompt
    compliance. This is what makes the guardrail unconditional rather than a check
    that could be forgotten."""
    forbidden_fields = {
        "text",
        "attention",
        "attention_cue",
        "duration_min",
        "duration_typical_min",
        "duration_max",
        "duration_stated",
        "freshness",
        "freshness_cue",
        "max_lead_min",
        "doneness_cue",
        "station",
        "interruptible",
        # CP2: extracted dependency lists and optional/alternative roles are semantic
        # decisions made from the source; repair has no field to overwrite them with.
        "depends_on_steps",
        "role",
        "role_cue",
        "attach_to_step",
    }
    assert forbidden_fields.isdisjoint(StepRepair.model_fields)
    assert set(StepRepair.model_fields) == {
        "consumes_ingredients",
        "produces_component",
        "depends_on_previous",
    }
    assert set(RepairProposal.model_fields) == {"steps"}


def test_repair_naming_an_unknown_ingredient_is_a_warning_not_an_invention() -> None:
    """A step naming an ingredient that doesn't exist can't create a new Ingredient
    (RepairProposal has no ingredient list at all) -- graph.py's existing unmatched-
    reference handling (a warning, no phantom ingredient) applies unchanged."""
    recipe = _broken_two_branch_recipe()
    violations = _build_and_validate(recipe, _source_text())

    proposal = _proposal(
        [
            (["Onion", "Unicorn Dust"], "chopped onion", True),
            (["Butter"], "melted butter", False),
            (["chopped onion", "melted butter", "Salt"], None, True),
        ]
    )
    adapter = _FakeAdapter(results=[ExtractResult(recipe=proposal)])

    outcome = repair_or_degrade(
        recipe, _source_text(), violations, adapter, graph_id="g", source=SOURCE
    )
    assert outcome.build_result.graph is not None
    assert len(outcome.build_result.graph.ingredients) == 3  # never grew past the recipe's own 3
    assert any("Unicorn Dust" in w for w in outcome.build_result.warnings)


def test_repair_cannot_bypass_the_independence_safety_test() -> None:
    """LOCKED requirement 8/9: even inside a repair pass, an unsupported
    depends_on_previous=False claim is independently re-verified and rejected --
    repair cannot manufacture parallelism that wasn't safe in the first pass."""
    recipe = _recipe(
        [
            _step(text="Chop the onion.", consumes_ingredients=["Onion"]),
            _step(text="Fry the chopped onion.", consumes_ingredients=["Onion"]),
            _step(text="Serve hot.", consumes_ingredients=[]),
        ]
    )
    violations = _build_and_validate(recipe, "Chop the onion. Fry it. Serve hot.")

    # The repair pass tries to "fix" the invariant failure the wrong way: claiming
    # step 2 is independent of step 1, even though they share "Onion".
    unsafe_proposal = _proposal(
        [(["Onion"], None, True), (["Onion"], None, False), ([], None, True)]
    )
    adapter = _FakeAdapter(results=[ExtractResult(recipe=unsafe_proposal)])

    outcome = repair_or_degrade(
        recipe,
        "Chop the onion. Fry it. Serve hot.",
        violations,
        adapter,
        graph_id="g",
        source=SOURCE,
    )
    # Whichever tier it lands on, the "fry" step must still depend on "chop" --
    # the independence claim must never survive re-verification.
    graph = outcome.build_result.graph
    assert graph is not None
    fry_node = next(n for n in graph.nodes if "fry" in n.instruction.lower())
    chop_node = next(n for n in graph.nodes if "chop" in n.instruction.lower())
    assert chop_node.id in fry_node.depends_on


def test_provenance_reflects_verified_repaired_graph() -> None:
    recipe = _broken_two_branch_recipe()
    violations = _build_and_validate(recipe, _source_text())
    proposal = _proposal(
        [
            (["Onion"], "chopped onion", True),
            (["Butter"], "melted butter", False),
            (["chopped onion", "melted butter"], None, True),
        ]
    )
    adapter = _FakeAdapter(results=[ExtractResult(recipe=proposal)])
    outcome = repair_or_degrade(
        recipe, _source_text(), violations, adapter, graph_id="g", source=SOURCE
    )
    assert outcome.build_result.graph is not None
    provenance = compute_provenance(outcome.build_result)
    assert set(provenance.nodes.keys()) == {n.id for n in outcome.build_result.graph.nodes}


def test_degraded_provenance_also_covers_every_node() -> None:
    recipe = _broken_two_branch_recipe()
    violations = _build_and_validate(recipe, _source_text())
    same = _proposal([(["Onion"], None, True), (["Butter"], None, False), ([], None, True)])
    adapter = _FakeAdapter(results=[ExtractResult(recipe=same)])  # no-op "fix"
    outcome = repair_or_degrade(
        recipe, _source_text(), violations, adapter, graph_id="g", source=SOURCE
    )
    assert outcome.tier == "degraded"
    provenance = compute_provenance(outcome.build_result)
    assert len(provenance.nodes) == len(outcome.build_result.graph.nodes)


# ---------------------------------------------------------------------------
# CP2 decision D: an omitted repair field means "unchanged", and dependency repair is
# additive only. Before CP2, `StepRepair` defaulted `depends_on_previous=True` and
# `_merge_repair` wrote it back unconditionally, so a repair response that simply
# omitted the field reset an extracted independence claim to sequential.
# ---------------------------------------------------------------------------


def _merge(
    recipe: NormalizedRecipe, proposal: RepairProposal
) -> tuple[NormalizedRecipe, list[str]]:
    merged = _merge_repair(recipe, proposal)
    assert merged is not None
    return merged


def test_omitted_repair_fields_leave_the_step_unchanged() -> None:
    recipe = _broken_two_branch_recipe()
    merged, notes = _merge(recipe, RepairProposal(steps=[StepRepair() for _ in recipe.steps]))
    assert merged.steps == recipe.steps
    assert notes == []


def test_step_repair_fields_all_default_to_unchanged() -> None:
    assert StepRepair().model_dump() == {
        "consumes_ingredients": None,
        "produces_component": None,
        "depends_on_previous": None,
    }


def test_extracted_independence_survives_a_repair_that_omits_it() -> None:
    """Evidence #5 regression, end to end: the repair fixes the real violation (the
    unconsumed "Salt") without mentioning `depends_on_previous` at all. The extracted,
    verified independence of "Melt the butter" must still be in the repaired graph."""
    recipe = _broken_two_branch_recipe()
    assert recipe.steps[1].depends_on_previous is False
    violations = _build_and_validate(recipe, _source_text())

    proposal = RepairProposal(
        steps=[
            StepRepair(produces_component="chopped onion"),
            StepRepair(produces_component="melted butter"),
            StepRepair(consumes_ingredients=["chopped onion", "melted butter", "Salt"]),
        ]
    )
    adapter = _FakeAdapter(results=[ExtractResult(recipe=proposal)])
    outcome = repair_or_degrade(
        recipe, _source_text(), violations, adapter, graph_id="g", source=SOURCE
    )

    assert outcome.tier == "repaired"
    graph = outcome.build_result.graph
    assert graph is not None
    assert validate(graph) == []
    chop, melt = graph.nodes[0], graph.nodes[1]
    assert chop.id not in melt.depends_on  # still independent: runs alongside the chop
    assert melt.depends_on == []


def test_repair_cannot_remove_an_extracted_dependency() -> None:
    recipe = _recipe(
        [
            _step(text="Chop the onion.", consumes_ingredients=["Onion"]),
            _step(text="Melt the butter.", consumes_ingredients=["Butter"]),
        ]
    )
    assert recipe.steps[1].depends_on_previous is True
    merged, notes = _merge(
        recipe, RepairProposal(steps=[StepRepair(), StepRepair(depends_on_previous=False)])
    )
    assert merged.steps[1].depends_on_previous is True
    assert len(notes) == 1
    assert "ignored" in notes[0]


def test_repair_can_add_a_dependency_and_says_so() -> None:
    recipe = _broken_two_branch_recipe()
    assert recipe.steps[1].depends_on_previous is False
    merged, notes = _merge(
        recipe,
        RepairProposal(steps=[StepRepair(), StepRepair(depends_on_previous=True), StepRepair()]),
    )
    assert merged.steps[1].depends_on_previous is True
    assert len(notes) == 1
    assert "step 1" in notes[0]
    assert "wait" in notes[0]


def test_added_dependency_is_reported_in_the_repaired_graphs_warnings() -> None:
    recipe = _broken_two_branch_recipe()
    violations = _build_and_validate(recipe, _source_text())
    proposal = RepairProposal(
        steps=[
            StepRepair(),
            StepRepair(depends_on_previous=True),
            StepRepair(consumes_ingredients=["Salt"]),
        ]
    )
    adapter = _FakeAdapter(results=[ExtractResult(recipe=proposal)])
    outcome = repair_or_degrade(
        recipe, _source_text(), violations, adapter, graph_id="g", source=SOURCE
    )
    assert outcome.tier == "repaired"
    assert any("wait for the step before it" in w for w in outcome.build_result.warnings)


def test_repair_consumes_are_added_never_replacing_extracted_ones() -> None:
    recipe = _recipe([_step(text="Chop the onion.", consumes_ingredients=["Onion"])])
    merged, _ = _merge(
        recipe, RepairProposal(steps=[StepRepair(consumes_ingredients=["onion", "Butter"])])
    )
    assert merged.steps[0].consumes_ingredients == ["Onion", "Butter"]


def test_repair_produces_replaces_only_when_given() -> None:
    recipe = _recipe(
        [
            _step(text="Chop the onion.", produces_component="chopped onion"),
            _step(text="Melt the butter.", produces_component="melted butter"),
        ]
    )
    merged, _ = _merge(
        recipe,
        RepairProposal(steps=[StepRepair(), StepRepair(produces_component="butter sauce")]),
    )
    assert merged.steps[0].produces_component == "chopped onion"
    assert merged.steps[1].produces_component == "butter sauce"


def test_repair_never_touches_extracted_dependency_lists_or_roles() -> None:
    recipe = _recipe(
        [
            _step(text="Chop the onion.", depends_on_steps=[]),
            _step(
                text="If you like, melt the butter.",
                depends_on_steps=[],
                role="optional",
                role_cue="If you like",
                attach_to_step=0,
            ),
        ]
    )
    merged, _ = _merge(
        recipe,
        RepairProposal(
            steps=[
                StepRepair(depends_on_previous=True),
                StepRepair(depends_on_previous=True, consumes_ingredients=["Butter"]),
            ]
        ),
    )
    for field in ("depends_on_steps", "role", "role_cue", "attach_to_step"):
        assert [getattr(s, field) for s in merged.steps] == [
            getattr(s, field) for s in recipe.steps
        ]


def test_render_repair_source_shows_depends_on_steps_only_when_present() -> None:
    legacy = _broken_two_branch_recipe()
    assert "depends_on_steps" not in render_repair_source(legacy, [], _source_text())
    explicit = _recipe(
        [_step(text="Chop.", depends_on_steps=[]), _step(text="Fry.", depends_on_steps=[0])]
    )
    rendered = render_repair_source(explicit, [], "Chop. Fry.")
    assert "depends_on_steps=[]" in rendered
    assert "depends_on_steps=[0]" in rendered


def test_repair_prompt_v2_is_in_use_and_states_omitted_means_unchanged() -> None:
    prompt = load_repair_prompt()
    assert "graph repair prompt (v2)" in prompt
    assert "leave that step's current value exactly" in prompt


# ---------------------------------------------------------------------------
# The real failure: a frozen NormalizedRecipe from the M2.9 s15 checkpoint (Kunal
# Kapur's Dal Makhni) -- three parallel prep branches (dal, tomato puree, tempering)
# converging before "Add the tomatoes to the dal". It genuinely failed validation at
# the M2.9 s15 checkpoint (12 invariants) and, per the investigation's offline audit,
# still failed on `produces_consumed` under B1 alone. Verified live post-B3
# (2026-09-16, zero LLM cost -- see docs/cooking-plan-investigation.md's Phase B
# report): B1's fork/join construction plus B3's conditional produces-drop now
# resolve it completely, 0 violations, no repair call needed at all. Kept
# `@pytest.mark.llm` and the live repair path below for the case violations reappear
# (a prompt/schema change, a different capture) -- excluded from the default run
# since that branch makes one real Sonnet call.
# ---------------------------------------------------------------------------

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "import"


def _load_real_failure() -> tuple[NormalizedRecipe, str]:
    recipe = NormalizedRecipe.model_validate_json(
        (FIXTURES_DIR / "dal-makhni-multibranch.normalized.json").read_text(encoding="utf-8")
    )
    source_text = (FIXTURES_DIR / "dal-makhni-multibranch.source_text.txt").read_text(
        encoding="utf-8"
    )
    return recipe, source_text


@pytest.mark.llm
def test_real_multibranch_failure_repairs_or_degrades_safely() -> None:
    """The primary repair test (per the owner's Step 10 instructions): run the actual
    repair pass against the actual recipe that failed validation live -- unless B1+B3
    already resolve it by construction, in which case there is nothing to repair and
    no LLM call is made at all (verified live 2026-09-16: this is the current
    outcome). Whatever happens, the result must be a graph that fully validates --
    print the outcome so it can be reported, don't just assert success."""
    recipe, source_text = _load_real_failure()
    build_result = build_graph(
        recipe, source_text, graph_id="g_dal_makhni_repair_test", source=SOURCE
    )
    assert build_result.graph is not None
    violations = validate(build_result.graph)

    if not violations:
        print("\nrepair outcome: not needed -- build_graph alone already validates cleanly")
        for node in build_result.graph.nodes:
            print(f"  {node.id} <- {node.depends_on}")
        return

    from abc_cook.extract.adapters.anthropic import AnthropicAdapter

    adapter = AnthropicAdapter()
    outcome = repair_or_degrade(
        recipe,
        source_text,
        violations,
        adapter,
        graph_id="g_dal_makhni_repair_test",
        source=SOURCE,
    )

    assert outcome.build_result.graph is not None
    assert validate(outcome.build_result.graph) == []  # must ALWAYS hold, either tier
    print(f"\nrepair outcome: {outcome.tier}")
    print(f"warnings: {outcome.build_result.warnings}")
    for node in outcome.build_result.graph.nodes:
        print(f"  {node.id} <- {node.depends_on}")
