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
from abc_cook.extract.repair import RepairProposal, StepRepair, repair_or_degrade
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


# A recipe shaped exactly like the real failure: two branches (chop onion; melt
# butter) that never converge, so one of them becomes an orphan/second sink, and
# "Butter" is never consumed by anything -- ingredients_consumed + single_finish_sink
# + no_orphans all fail, same fault family as the real checkpoint case.
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
        ]
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
    """Sanity check: the synthetic recipe reproduces a real multi-branch failure
    before repair.py ever gets involved."""
    violations = _build_and_validate(_broken_two_branch_recipe(), _source_text())
    assert violations  # must actually fail, or this test fixture proves nothing
    rules = {v.rule for v in violations}
    assert "single_finish_sink" in rules or "no_orphans" in rules


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
    """A repair response that correctly wires the second branch back in (merge step
    consumes both components) must produce a graph that passes every invariant."""
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
            (["chopped onion", "melted butter"], None, True),
        ]
    )
    adapter = _FakeAdapter(results=[ExtractResult(recipe=proposal)])

    outcome = repair_or_degrade(
        recipe, _source_text(), violations, adapter, graph_id="g", source=SOURCE
    )
    assert outcome.build_result.graph is not None
    assert len(outcome.build_result.graph.ingredients) == 2  # never grew to 3
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
# The real failure: a frozen NormalizedRecipe from the M2.9 s15 checkpoint (Kunal
# Kapur's Dal Makhni), which genuinely failed 12 invariants on real extraction --
# three parallel prep branches (dal, tomato puree, tempering) converging at the end.
# Excluded from the default run: this makes one real Sonnet call.
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
    repair pass against the actual recipe that failed validation live. Whatever
    happens, the result must be a graph that fully validates -- print the outcome so
    it can be reported, don't just assert success."""
    from abc_cook.extract.adapters.anthropic import AnthropicAdapter

    recipe, source_text = _load_real_failure()
    violations = _build_and_validate(recipe, source_text)
    assert violations  # confirms the frozen fixture still reproduces the failure

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
