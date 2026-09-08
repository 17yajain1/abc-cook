"""Golden-fixture tests for the scheduler (docs/COOKING_GRAPH.md §7).

Each fixture is a hand-authored `<slug>.graph.json` plus the plan it must produce,
`<slug>.plan.json`, and optionally a `<slug>.kitchen.json` with the scheduler kwargs
(e.g. `burner_capacity`) it was computed under. The scheduler is deterministic (§4) so
`schedule() == plan` is exact equality, not a tolerance.

If a fixture's expected plan changes, that is a product decision, not a test fix —
surface it rather than editing the `.plan.json` to match new code (CLAUDE.md).
"""

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from abc_cook.schedule import schedule
from abc_cook.schedule.scheduler import serial_minutes
from abc_cook.schedule.windows import UNATTENDED_CAPACITY_FACTOR
from abc_cook.schema import CookingGraph, CookingPlan, Node, SourceRef, Stage

FIXTURES = Path(__file__).parent / "fixtures"

# Slugs with both a `.graph.json` and a `.plan.json` in tests/fixtures/.
# Grows to the full five from COOKING_GRAPH.md §7 as each is authored.
GOLDEN = ["kadai-paneer", "maggi-2min", "chicken-biryani"]


@pytest.fixture(params=GOLDEN)
def slug(request: pytest.FixtureRequest) -> str:
    return str(request.param)


def _graph(slug: str) -> CookingGraph:
    return CookingGraph.model_validate_json((FIXTURES / f"{slug}.graph.json").read_text())


def _expected_plan(slug: str) -> CookingPlan:
    return CookingPlan.model_validate_json((FIXTURES / f"{slug}.plan.json").read_text())


def _kitchen(slug: str) -> dict[str, Any]:
    """Scheduler kwargs the golden plan was computed under (§4.6). Empty if no sidecar."""
    path = FIXTURES / f"{slug}.kitchen.json"
    if not path.exists():
        return {}
    loaded: dict[str, Any] = json.loads(path.read_text())
    return loaded


def _scheduled(slug: str) -> CookingPlan:
    return schedule(_graph(slug), **_kitchen(slug))


def _node(graph: CookingGraph, node_id: str) -> Node:
    return next(n for n in graph.nodes if n.id == node_id)


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
    """The golden numbers must agree with each other before we chase them in code.

    Arithmetic identities use `approx`: `capacity_min` carries the `* 0.9` rounding
    (§4.3), so `slack == capacity - used` holds only to within the quantum.
    """
    plan = _expected_plan(slug)

    assert plan.saved_min == pytest.approx(plan.serial_min - plan.total_min)
    assert plan.total_min == max(s.end_min for s in plan.scheduled)
    for window in plan.windows:
        assigned_typical = sum(
            _node(_graph(slug), nid).duration_typical for nid in window.assigned
        )
        assert window.used_min == pytest.approx(assigned_typical)
        assert window.slack_min == pytest.approx(window.capacity_min - window.used_min)


def test_serial_minutes_matches_golden(slug: str) -> None:
    assert serial_minutes(_graph(slug)) == _expected_plan(slug).serial_min


def test_schedule_matches_golden_plan(slug: str) -> None:
    assert _scheduled(slug) == _expected_plan(slug)


def test_schedule_is_deterministic(slug: str) -> None:
    assert _scheduled(slug) == _scheduled(slug)


def test_plan_json_round_trips(slug: str) -> None:
    """The golden file is exactly what `CookingPlan` serializes back to."""
    plan = _expected_plan(slug)
    on_disk = json.loads((FIXTURES / f"{slug}.plan.json").read_text())
    assert json.loads(plan.model_dump_json()) == on_disk


# --- The duration_max eligibility gate (§4.4) ---------------------------------------


def _gate_graph() -> CookingGraph:
    """A prep task that packs into a small window by typical but is unsafe by max.

    `wide_prep`: typical 4, max 8. `tiny_soak` window capacity is 5 x 0.9 = 4.5 — the
    typical fits (4 <= 4.5), the max does not (8 > 4.5). `long_soak` window capacity is
    20 x 0.9 = 18.0 — both fit. `tiny_soak` sorts first (host-id order), so the gate is
    what pushes `wide_prep` into `long_soak`.
    """
    src = SourceRef(kind="text", value="gate test", imported_at=datetime.now(UTC))
    common = {
        "stage": "s",
        "consumes": [],
        "doneness_cue": None,
        "tip": None,
        "max_lead_min": None,
    }
    return CookingGraph(
        id="gate",
        title="Gate",
        servings=1,
        cuisine=None,
        source=src,
        stated_total_min=None,
        ingredients=[],
        stages=[Stage(id="s", label="S", color_key="prep")],
        nodes=[
            Node(
                id="tiny_soak",
                label="Tiny soak",
                instruction="Soak briefly.",
                kind="passive",
                attention="unattended",
                duration_min=4,
                duration_typical=5,
                duration_max=7,
                station="none",
                depends_on=[],
                produces="comp_tiny",
                interruptible=True,
                **common,
            ),
            Node(
                id="long_soak",
                label="Long soak",
                instruction="Soak a long time.",
                kind="passive",
                attention="unattended",
                duration_min=15,
                duration_typical=20,
                duration_max=25,
                station="none",
                depends_on=[],
                produces="comp_long",
                interruptible=True,
                **common,
            ),
            Node(
                id="wide_prep",
                label="Wide prep",
                instruction="Prep with a wide spread.",
                kind="prep",
                attention="hands_on",
                duration_min=3,
                duration_typical=4,
                duration_max=8,
                station="counter",
                depends_on=[],
                produces="comp_prep",
                interruptible=True,
                **common,
            ),
            Node(
                id="assemble",
                label="Assemble",
                instruction="Bring it together.",
                kind="finish",
                attention="hands_on",
                duration_min=1,
                duration_typical=1,
                duration_max=2,
                station="none",
                depends_on=["tiny_soak", "long_soak", "wide_prep"],
                produces=None,
                interruptible=False,
                **common,
            ),
        ],
    )


def test_duration_max_gate_rejects_then_a_roomier_window_claims() -> None:
    graph = _gate_graph()
    plan = schedule(graph)

    tiny_cap = round(5 * UNATTENDED_CAPACITY_FACTOR, 2)
    assert 4 <= tiny_cap < 8  # typical fits the tiny window, max does not

    # The tiny window is processed first (host-id order) but claims nothing, so it is
    # dropped. wide_prep lands in the long-soak window instead.
    assert [w.host_node_id for w in plan.windows] == ["long_soak"]
    (window,) = plan.windows
    assert window.assigned == ["wide_prep"]
    assert window.capacity_min == 18.0

    placed = {s.node_id: s for s in plan.scheduled}
    assert placed["wide_prep"].window_id == "w1"
    assert placed["wide_prep"].rank_in_window == 0

    # No overrun/serialisation warning — the gate handled it silently.
    assert plan.warnings == []


def test_chicken_biryani_max_gate_and_two_burners() -> None:
    graph = _graph("chicken-biryani")
    plan = schedule(graph, burner_capacity=2)
    placed = {s.node_id: s for s in plan.scheduled}
    slice_onions = _node(graph, "slice_onions")

    # slice_onions (typical 4, max 6) packs into the 5.4-min boil window by typical but
    # not by max, so it is rehomed to the 18-min soak window.
    boil_cap = round(6 * UNATTENDED_CAPACITY_FACTOR, 2)
    assert slice_onions.duration_typical <= boil_cap < slice_onions.duration_max
    assert "boil_spiced_water" not in {w.host_node_id for w in plan.windows}
    assert placed["slice_onions"].window_id == "w1"
    assert next(w for w in plan.windows if w.id == "w1").host_node_id == "soak_rice"

    # The overlap is real and reported exactly once, deterministically.
    assert plan.warnings == ["uses 2 burners"]
    assert not any("overrun" in w or "slice_onions" in w for w in plan.warnings)
