"""Phase B replay gate (docs/cooking-plan-investigation.md §5): zero-cost, offline
replay of the captured pizza-dough `NormalizedRecipe` through the full deterministic
pipeline -- `build_graph()` -> `validate()` -> `schedule()` -> `stage_spans()` -- with
no LLM/network call. This is the primary acceptance gate for B1/B2/B3, not a live
re-import: the fixture's `NormalizedRecipe` makes no `depends_on_previous=False`
claim anywhere, so this replay does not exercise B1's fork/join path -- it exercises
B2 (the sink is a grounded, unattended `finish` node) and B3 (every `produces_component`
here is either matched to a later consumer or safely dropped as chain-redundant).
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.graph import build_graph
from abc_cook.extract.normalize import render_source_text
from abc_cook.extract.provenance import compute_provenance
from abc_cook.extract.validate import validate
from abc_cook.schedule import schedule, stage_spans
from abc_cook.schema.graph import SourceRef
from abc_cook.schema.normalized import NormalizedRecipe

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "import"

SOURCE = SourceRef(kind="url", value="https://youtu.be/WM1XcYXix0Y", imported_at=datetime.now(UTC))


def _load_fixture() -> tuple[NormalizedRecipe, str]:
    recipe = NormalizedRecipe.model_validate_json(
        (FIXTURES_DIR / "pizza-dough.normalized.json").read_text(encoding="utf-8")
    )
    raw = RawAcquisition.model_validate_json(
        (FIXTURES_DIR / "pizza-dough.raw.json").read_text(encoding="utf-8")
    )
    return recipe, render_source_text(raw)


def test_pizza_dough_replay_makes_no_independence_claim() -> None:
    """Confirms the premise this replay tests: the captured recipe asserts sequential
    order for all 14 steps, so B1's fork/join path is not exercised here -- do not
    expect this fixture to suddenly become parallel."""
    recipe, _ = _load_fixture()
    assert len(recipe.steps) == 14
    assert all(step.depends_on_previous for step in recipe.steps)


def test_pizza_dough_replay_is_structurally_valid_and_makes_no_false_independence() -> None:
    recipe, source_text = _load_fixture()
    result = build_graph(recipe, source_text, graph_id="g_pizza_replay", source=SOURCE)
    assert result.graph is not None
    assert len(result.graph.nodes) == 14

    # No independence claim honored anywhere -- a single chain: one source, one sink,
    # every node depends on at least its immediate predecessor (B1's fork/join is a
    # no-op here since depends_on_previous_verified is True throughout -- see
    # `test_pizza_dough_replay_makes_no_independence_claim`). Node 6 also carries one
    # EXTRA edge to node 4 -- a pre-existing produces/consumes substring quirk
    # ("dough balls" matches inside "cold dough balls"), not something B1/B2/B3
    # introduced or need to fix; noted, not asserted away.
    sources = [n for n in result.graph.nodes if not n.depends_on]
    depended_upon = {dep for n in result.graph.nodes for dep in n.depends_on}
    sinks = [n for n in result.graph.nodes if n.id not in depended_upon]
    assert [n.id for n in sources] == [result.graph.nodes[0].id]
    assert [n.id for n in sinks] == [result.graph.nodes[-1].id]
    for previous, current in zip(result.graph.nodes, result.graph.nodes[1:], strict=False):
        assert previous.id in current.depends_on


def test_pizza_dough_replay_unattended_final_finish_is_valid() -> None:
    """B2: the grounded final instruction ("let it cool slightly before serving") is
    attention=unattended -- the sink must still validate as kind=finish, never
    silently forced to hands_on."""
    recipe, source_text = _load_fixture()
    result = build_graph(recipe, source_text, graph_id="g_pizza_replay", source=SOURCE)
    assert result.graph is not None
    sink = result.graph.nodes[-1]
    assert sink.kind == "finish"
    assert sink.attention == "unattended"


def test_pizza_dough_replay_produces_consumes_follows_the_conditional_rule() -> None:
    """B3: of the 8 `produces_component` claims in this fixture, the wiring pass
    matches 2 to a later consumer by name (kept) and the remaining 6 are never named
    by any later step -- since this is a pure chain, every later node already
    transitively depends on each of those 6 producers, so they are safely dropped
    with a warning rather than left to fail invariant 6 for no reason a repair call
    could fix differently."""
    recipe, source_text = _load_fixture()
    result = build_graph(recipe, source_text, graph_id="g_pizza_replay", source=SOURCE)
    assert result.graph is not None

    produces_claims = sum(1 for step in recipe.steps if step.produces_component is not None)
    assert produces_claims == 8

    kept = [n.id for n in result.graph.nodes if n.produces is not None]
    dropped_warnings = [w for w in result.warnings if "was marked as producing" in w]
    assert len(kept) + len(dropped_warnings) == produces_claims
    assert len(dropped_warnings) == 6


def test_pizza_dough_replay_full_pipeline_validates_schedules_and_spans_cleanly() -> None:
    """The end-to-end replay gate: build -> validate -> schedule -> stage_spans, all
    offline. `validate()` must return zero violations -- this fixture is exactly the
    real recipe that used to ship as "degraded" with a still-invalid graph
    (docs/cooking-plan-investigation.md §2.2)."""
    recipe, source_text = _load_fixture()
    result = build_graph(recipe, source_text, graph_id="g_pizza_replay", source=SOURCE)
    assert result.graph is not None
    assert validate(result.graph) == []

    plan = schedule(result.graph, burner_capacity=1)
    # No independence claim -> no parallel work is possible to place; a strict chain
    # produces no wait windows regardless of how many nodes are unattended.
    assert plan.windows == []
    assert plan.saved_min == 0.0
    assert plan.total_min == plan.serial_min

    spans = stage_spans(result.graph, plan)
    assert spans  # every node lands in some stage; no exception, no empty plan


def test_pizza_dough_replay_hands_on_unattended_split_and_inferred_host() -> None:
    """C1/C2 gate: this is the exact §2.2 case (`Cook ~304 min` showing 289 min of
    unattended waits as undifferentiated work). The split must separate the two, and
    the preheat host's inferred duration must still be marked inferred."""
    recipe, source_text = _load_fixture()
    result = build_graph(recipe, source_text, graph_id="g_pizza_replay", source=SOURCE)
    assert result.graph is not None

    plan = schedule(result.graph, burner_capacity=1)
    spans = {span.stage_id: span for span in stage_spans(result.graph, plan)}

    prep, cook, finish = spans["prep"], spans["cook"], spans["finish"]
    assert (prep.hands_on_min, prep.unattended_min, prep.inline_work_min) == (20.0, 1145.0, 1165.0)
    assert (cook.hands_on_min, cook.unattended_min, cook.inline_work_min) == (15.0, 289.0, 304.0)
    assert (finish.hands_on_min, finish.unattended_min, finish.inline_work_min) == (0.0, 1.0, 1.0)

    provenance = compute_provenance(result)
    preheat = provenance.nodes["step_place_a_pizza_stone_or_inverted"]
    assert preheat.fields["duration"] == "inferred"
    host = next(n for n in result.graph.nodes if n.id == "step_place_a_pizza_stone_or_inverted")
    assert host.attention == "unattended"
