"""Golden-fixture tests for the scheduler (docs/COOKING_GRAPH.md §7).

Each fixture is a hand-authored `<slug>.graph.json` plus the plan it must produce,
`<slug>.plan.json`. The scheduler is deterministic (§4) so this is exact equality, not
a tolerance.

If a fixture's expected plan changes, that is a product decision, not a test fix —
surface it rather than editing the `.plan.json` to match new code (CLAUDE.md).
"""

import json
from pathlib import Path

import pytest

from abc_cook.schedule import schedule
from abc_cook.schedule.scheduler import serial_minutes
from abc_cook.schema import CookingGraph, CookingPlan

FIXTURES = Path(__file__).parent / "fixtures"

# Slugs with both a `.graph.json` and a `.plan.json` in tests/fixtures/.
# Grows to the full five from COOKING_GRAPH.md §7 as each is authored.
GOLDEN = ["kadai-paneer"]


@pytest.fixture(params=GOLDEN)
def slug(request: pytest.FixtureRequest) -> str:
    return str(request.param)


def _graph(slug: str) -> CookingGraph:
    return CookingGraph.model_validate_json((FIXTURES / f"{slug}.graph.json").read_text())


def _expected_plan(slug: str) -> CookingPlan:
    return CookingPlan.model_validate_json((FIXTURES / f"{slug}.plan.json").read_text())


def test_fixture_files_are_well_formed(slug: str) -> None:
    """No scheduler needed: the graph and plan JSON parse and self-reference cleanly."""
    graph = _graph(slug)
    plan = _expected_plan(slug)

    assert plan.graph_id == graph.id
    graph_ids = {n.id for n in graph.nodes}
    assert {s.node_id for s in plan.scheduled} == graph_ids
    assert set(plan.critical_path) <= graph_ids
    for window in plan.windows:
        assert window.host_node_id in graph_ids
        assert set(window.assigned) <= graph_ids


def test_expected_plan_is_internally_consistent(slug: str) -> None:
    """The golden numbers must agree with each other before we chase them in code."""
    plan = _expected_plan(slug)

    assert plan.saved_min == plan.serial_min - plan.total_min
    assert plan.total_min == max(s.end_min for s in plan.scheduled)
    for window in plan.windows:
        assigned_typical = sum(
            _node(_graph(slug), nid).duration_typical for nid in window.assigned
        )
        assert window.used_min == assigned_typical
        assert window.slack_min == window.capacity_min - window.used_min


def test_serial_minutes_matches_golden(slug: str) -> None:
    assert serial_minutes(_graph(slug)) == _expected_plan(slug).serial_min


def test_schedule_matches_golden_plan(slug: str) -> None:
    assert schedule(_graph(slug)) == _expected_plan(slug)


def test_schedule_is_deterministic(slug: str) -> None:
    graph = _graph(slug)
    assert schedule(graph) == schedule(graph)


def _node(graph: CookingGraph, node_id: str):  # noqa: ANN202 - test helper
    return next(n for n in graph.nodes if n.id == node_id)


def test_plan_json_round_trips(slug: str) -> None:
    """The golden file is exactly what `CookingPlan` serializes back to."""
    plan = _expected_plan(slug)
    on_disk = json.loads((FIXTURES / f"{slug}.plan.json").read_text())
    assert json.loads(plan.model_dump_json()) == on_disk
