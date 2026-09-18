"""Recipe-level timing summary (abc_cook/schedule/summary.py).

Locks the V2 table from the M3 pre-implementation review
(`~/.claude/plans/we-are-about-to-luminous-gizmo.md` §V2), which was itself produced by
running this exact code against the six golden graphs plus a fresh replay of the
captured pizza-dough import -- not transcribed by hand. If a fixture's expected value
here changes, that is a product decision (`CLAUDE.md`), not a test fix.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest

from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.graph import build_graph
from abc_cook.extract.normalize import render_source_text
from abc_cook.schedule import LONG_WAIT_MIN, SESSION_BREAK_MIN, schedule, summarize
from abc_cook.schema import CookingGraph, CookingPlan, PlanSummary
from abc_cook.schema.graph import SourceRef
from abc_cook.schema.normalized import NormalizedRecipe

FIXTURES = Path(__file__).parent / "fixtures"
IMPORT_FIXTURES = FIXTURES / "import"

GOLDEN = [
    "kadai-paneer",
    "maggi-2min",
    "chicken-biryani",
    "homemade-donuts",
    "strawberry-shortcake",
    "synthetic-two-windows",
]

# active_min, attended_min, elapsed_high_min -- the V2 table, per fixture.
EXPECTED = {
    "kadai-paneer": (31.0, 43.0, 46.0),
    "maggi-2min": (2.0, 4.0, 9.0),
    "chicken-biryani": (22.0, 51.0, 72.0),
    "homemade-donuts": (42.0, 56.0, 158.0),
    "strawberry-shortcake": (24.0, 24.0, 57.0),
    "synthetic-two-windows": (29.0, 29.0, 56.0),
}

# One long wait (>= LONG_WAIT_MIN, < SESSION_BREAK_MIN) each: only the donut's
# first_rise. Every other golden has none.
EXPECTED_LONG_WAITS = {
    "homemade-donuts": [(21.0, 78.0, 57.0, ["first_rise"])],
}


@pytest.fixture(params=GOLDEN)
def slug(request: pytest.FixtureRequest) -> str:
    return str(request.param)


def _graph(slug: str) -> CookingGraph:
    return CookingGraph.model_validate_json((FIXTURES / f"{slug}.graph.json").read_text())


def _kitchen(slug: str) -> dict[str, Any]:
    path = FIXTURES / f"{slug}.kitchen.json"
    if not path.exists():
        return {}
    loaded: dict[str, Any] = json.loads(path.read_text())
    return loaded


def _plan(slug: str) -> CookingPlan:
    return schedule(_graph(slug), **_kitchen(slug))


def _summary(slug: str) -> PlanSummary:
    capacity = _kitchen(slug).get("burner_capacity", 1)
    return summarize(_graph(slug), _plan(slug), burner_capacity=capacity)


def test_thresholds_are_the_owner_approved_values() -> None:
    """M3 pre-implementation review §V5: head-start gap >= 120 min, long wait >= 45 min."""
    assert SESSION_BREAK_MIN == 120.0
    assert LONG_WAIT_MIN == 45.0


def test_active_attended_and_elapsed_high_match_the_v2_table(slug: str) -> None:
    summary = _summary(slug)
    active, attended, elapsed_high = EXPECTED[slug]
    assert summary.active_min == pytest.approx(active)
    assert summary.attended_min == pytest.approx(attended)
    assert summary.elapsed_high_min == pytest.approx(elapsed_high)


def test_elapsed_min_mirrors_plan_total(slug: str) -> None:
    plan = _plan(slug)
    capacity = _kitchen(slug).get("burner_capacity", 1)
    summary = summarize(_graph(slug), plan, burner_capacity=capacity)
    assert summary.elapsed_min == pytest.approx(plan.total_min)


def test_elapsed_high_is_never_below_elapsed(slug: str) -> None:
    """A cook is never faster than typical, so the honest upper bound is >= typical."""
    summary = _summary(slug)
    assert summary.elapsed_high_min >= summary.elapsed_min


def test_every_golden_recipe_is_a_single_sitting(slug: str) -> None:
    """None of the six golden fixtures has an idle stretch >= SESSION_BREAK_MIN (120)."""
    summary = _summary(slug)
    assert len(summary.sessions) == 1
    assert summary.sessions[0].preceded_by_wait_min is None


def test_single_sitting_spans_the_whole_plan(slug: str) -> None:
    plan = _plan(slug)
    summary = _summary(slug)
    session = summary.sessions[0]
    assert session.start_min == pytest.approx(0.0)
    assert session.end_min == pytest.approx(plan.total_min)
    assert session.active_min == pytest.approx(summary.active_min)


def test_long_waits_match_the_v2_table(slug: str) -> None:
    summary = _summary(slug)
    expected = EXPECTED_LONG_WAITS.get(slug, [])
    actual = [
        (lw.start_min, lw.end_min, lw.idle_min, lw.host_node_ids) for lw in summary.long_waits
    ]
    assert actual == expected


def test_every_node_appears_in_exactly_one_session(slug: str) -> None:
    graph = _graph(slug)
    summary = _summary(slug)
    listed = [node_id for session in summary.sessions for node_id in session.node_ids]
    assert sorted(listed) == sorted(n.id for n in graph.nodes)
    assert len(listed) == len(set(listed)), "a node was assigned to two sessions"


def test_summary_is_deterministic(slug: str) -> None:
    graph = _graph(slug)
    plan = _plan(slug)
    capacity = _kitchen(slug).get("burner_capacity", 1)
    assert summarize(graph, plan, burner_capacity=capacity) == summarize(
        graph, plan, burner_capacity=capacity
    )


# --- The real pizza-dough import: the multi-session case (§V2's "deciding case"). ---

SOURCE = SourceRef(kind="url", value="https://youtu.be/WM1XcYXix0Y", imported_at=datetime.now(UTC))


def _pizza_graph() -> CookingGraph:
    """Replay the captured pizza-dough fixture through the real pipeline, offline.

    Mirrors `test_extract_replay.py`'s fixture loading exactly, so this stays a fresh
    build rather than trusting a frozen `import_result.json` that could drift from the
    code that produced it.
    """
    recipe = NormalizedRecipe.model_validate_json(
        (IMPORT_FIXTURES / "pizza-dough.normalized.json").read_text(encoding="utf-8"),
    )
    raw = RawAcquisition.model_validate_json(
        (IMPORT_FIXTURES / "pizza-dough.raw.json").read_text(encoding="utf-8"),
    )
    source_text = render_source_text(raw)
    result = build_graph(recipe, source_text, graph_id="g_pizza_summary", source=SOURCE)
    assert result.graph is not None
    return result.graph


def test_pizza_is_a_three_sitting_recipe() -> None:
    """§V2's deciding case: the whole-recipe range would be ~24 hr 30 min, exactly the
    failure the review was written to catch. Per sitting, neither bound implies a day
    of cooking."""
    graph = _pizza_graph()
    plan = schedule(graph, burner_capacity=1)
    summary = summarize(graph, plan, burner_capacity=1)

    assert plan.total_min == pytest.approx(1470.0)
    assert summary.elapsed_high_min == pytest.approx(1493.0)
    assert summary.active_min == pytest.approx(35.0)

    assert [(s.start_min, s.end_min) for s in summary.sessions] == [
        (0.0, 10.0),
        (280.0, 290.0),
        (1440.0, 1470.0),
    ]
    assert [s.active_min for s in summary.sessions] == [5.0, 10.0, 20.0]
    assert [s.preceded_by_wait_min for s in summary.sessions] == [None, 270.0, 1150.0]
    assert summary.long_waits == []  # both gaps are >= SESSION_BREAK_MIN, not long waits

    listed = [node_id for session in summary.sessions for node_id in session.node_ids]
    assert sorted(listed) == sorted(n.id for n in graph.nodes)
