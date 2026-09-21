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
from abc_cook.schedule.summary import _slow_plan
from abc_cook.schema import CookingGraph, CookingPlan, Node, PlanSummary, Stage
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

# The M3.1a multi-sitting golden (rajma: rinse -> soak 8 hr -> cook), tested separately
# from GOLDEN below since it is not single-sitting -- most of this module's `slug`
# tests assert the single-sitting invariant.
MULTI_SITTING_SLUG = "synthetic-two-sittings"

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


@pytest.fixture(params=[*GOLDEN, MULTI_SITTING_SLUG])
def any_slug(request: pytest.FixtureRequest) -> str:
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


# --- M3.1a: Session.elapsed_min / elapsed_high_min / preceded_by_host_node_ids ------
# Generic invariants over every golden plus the multi-sitting one, so nothing here is
# tuned to a single recipe shape. See docs: the M3.1a section of the M3.2 plan §2/§3/§4.


def test_session_elapsed_min_is_its_own_span(any_slug: str) -> None:
    for session in _summary(any_slug).sessions:
        assert session.elapsed_min == pytest.approx(session.end_min - session.start_min)


def test_session_elapsed_high_is_never_below_elapsed(any_slug: str) -> None:
    """A cook is never faster than typical, even within a single sitting."""
    for session in _summary(any_slug).sessions:
        assert session.elapsed_high_min >= session.elapsed_min


def test_single_sitting_session_matches_the_whole_recipe_range(slug: str) -> None:
    """Degenerate case: with one sitting, its range IS the recipe's range."""
    summary = _summary(slug)
    (session,) = summary.sessions
    assert session.elapsed_min == pytest.approx(summary.elapsed_min)
    assert session.elapsed_high_min == pytest.approx(summary.elapsed_high_min)


def test_first_session_has_no_preceding_host(any_slug: str) -> None:
    summary = _summary(any_slug)
    assert summary.sessions[0].preceded_by_host_node_ids == []


def test_preceding_host_nodes_are_hands_off_and_overlap_the_gap(any_slug: str) -> None:
    graph = _graph(any_slug)
    nodes = {n.id: n for n in graph.nodes}
    plan = _plan(any_slug)
    scheduled = {s.node_id: s for s in plan.scheduled}
    summary = _summary(any_slug)

    for previous, current in zip(summary.sessions, summary.sessions[1:], strict=False):
        for host_id in current.preceded_by_host_node_ids:
            assert nodes[host_id].attention != "hands_on"
            host = scheduled[host_id]
            assert host.start_min < current.start_min
            assert host.end_min > previous.end_min


def test_sum_of_session_elapsed_never_exceeds_the_plan(any_slug: str) -> None:
    """Session-break gaps are excluded from every sitting's span, so the sittings'
    spans can only fall short of the makespan, never exceed it."""
    plan = _plan(any_slug)
    summary = _summary(any_slug)
    assert sum(s.elapsed_min for s in summary.sessions) <= plan.total_min + 1e-6


def test_synthetic_two_sittings_matches_the_pinned_values() -> None:
    """M3.1a plan §2 row 2': rinse -> soak 8 hr -> cook, a non-pizza multi-sitting
    shape, proving the algorithm doesn't name a source or a process."""
    summary = _summary(MULTI_SITTING_SLUG)

    assert [(s.start_min, s.end_min) for s in summary.sessions] == [(0.0, 3.0), (483.0, 535.0)]
    assert [(s.elapsed_min, s.elapsed_high_min) for s in summary.sessions] == [
        (3.0, 5.0),
        (52.0, 58.0),
    ]
    assert [s.preceded_by_host_node_ids for s in summary.sessions] == [[], ["soak_beans"]]


# --- §3: the high bound is per-sitting node identity, never a re-clustering --------


def _mismatch_graph() -> CookingGraph:
    """A hands-on task placed right after a shared step, ahead of a long unattended
    rest, whose `duration_max` is large enough that slowing it collapses what were two
    typical-pace sittings into one -- if the high bound were computed by independently
    re-clustering the slowed timeline and pairing sittings by index, the counts would
    mismatch (2 typical sittings vs. 1 slow-timeline cluster) and there would be
    nothing to pair. `summarize` never re-clusters, so this must resolve cleanly: each
    sitting's high is the footprint of ITS OWN nodes on the slowed timeline.
    """
    src = SourceRef(kind="text", value="mismatch test", imported_at=datetime.now(UTC))
    common = {"stage": "s", "doneness_cue": None, "tip": None, "max_lead_min": None}
    return CookingGraph(
        id="mismatch",
        title="Mismatch",
        servings=1,
        cuisine=None,
        source=src,
        stated_total_min=None,
        ingredients=[],
        stages=[Stage(id="s", label="S", color_key="prep")],
        nodes=[
            Node(
                id="start",
                label="Start",
                instruction="Do the shared first step.",
                kind="prep",
                attention="hands_on",
                duration_min=8,
                duration_typical=10,
                duration_max=12,
                station="counter",
                depends_on=[],
                consumes=[],
                produces="comp_start",
                interruptible=True,
                **common,
            ),
            Node(
                id="rest",
                label="Rest",
                instruction="Leave it to rest.",
                kind="passive",
                attention="unattended",
                duration_min=140,
                duration_typical=150,
                duration_max=160,
                station="none",
                depends_on=["start"],
                consumes=["comp_start"],
                produces="comp_rested",
                interruptible=True,
                **common,
            ),
            Node(
                id="chop",
                label="Chop",
                instruction="Chop a side ingredient.",
                kind="prep",
                attention="hands_on",
                duration_min=4,
                duration_typical=5,
                duration_max=100,
                station="counter",
                depends_on=["start"],
                consumes=["comp_start"],
                produces="comp_chopped",
                interruptible=True,
                **common,
            ),
            Node(
                id="finish",
                label="Finish",
                instruction="Bring it together and serve.",
                kind="finish",
                attention="hands_on",
                duration_min=1,
                duration_typical=2,
                duration_max=3,
                station="none",
                depends_on=["rest", "chop"],
                consumes=["comp_rested", "comp_chopped"],
                produces=None,
                interruptible=False,
                **common,
            ),
        ],
    )


def test_high_bound_resolves_without_a_fallback_on_the_mismatch_case() -> None:
    graph = _mismatch_graph()
    plan = schedule(graph)
    summary = summarize(graph, plan)

    # Two sittings at typical pace: the 5-min chop keeps the gap at 145 min (>= 120).
    assert [(s.start_min, s.end_min) for s in summary.sessions] == [(0.0, 15.0), (160.0, 162.0)]

    # No exception, nothing null: each sitting's high is its own occupied footprint on
    # the slowed timeline, not a re-clustered pairing.
    highs = [s.elapsed_high_min for s in summary.sessions]
    assert all(h >= 0 for h in highs)
    assert highs == [112.0, 3.0]


# --- CP0: the high bound is clamped, never reported raw when chains converge --------


def _converging_chains_graph() -> CookingGraph:
    """Two independent chains that converge on the last sitting's `finish` node.

    Chain 1 (hands-on, slowable): `sear` (typical 10, max 30) -> `braise` (unattended,
    540, untouched by pace) -> `plate` (hands-on, 5). Chain 2 (hands-off, untouched):
    `marinate` (unattended, 600) alone. `finish` needs both.

    At typical pace the cook returns for `plate` at 550 (braise's end) and the sitting
    runs to 605 -- 45 of its 55 min spent waiting on `marinate`, which is still running.
    On the slowed timeline `sear` takes its full 30, pushing `braise` (untouched) to end
    at 570 instead of 550; `plate` now starts at 570, but `finish` still starts at 600 --
    pinned by `marinate`, which never moved. The sitting's raw slow-timeline footprint
    (`plate` start to `finish` end) is therefore 35, *below* the typical 55: the slow
    cook spent all their extra time in sitting 1, not this one. Reproduced and recorded
    in the M3.2 plan §2 (bug B) / §12a (CP0 semantic validation).
    """
    src = SourceRef(kind="text", value="converging chains test", imported_at=datetime.now(UTC))
    common = {"stage": "s", "doneness_cue": None, "tip": None, "max_lead_min": None}
    return CookingGraph(
        id="converging",
        title="Converging Chains",
        servings=1,
        cuisine=None,
        source=src,
        stated_total_min=None,
        ingredients=[],
        stages=[Stage(id="s", label="S", color_key="prep")],
        nodes=[
            Node(
                id="sear",
                label="Sear",
                instruction="Sear until browned.",
                kind="active",
                attention="hands_on",
                duration_min=8,
                duration_typical=10,
                duration_max=30,
                station="burner",
                depends_on=[],
                consumes=[],
                produces="comp_seared",
                interruptible=True,
                **common,
            ),
            Node(
                id="braise",
                label="Braise",
                instruction="Braise low and slow.",
                kind="passive",
                attention="unattended",
                duration_min=540,
                duration_typical=540,
                duration_max=540,
                station="oven",
                depends_on=["sear"],
                consumes=["comp_seared"],
                produces="comp_braised",
                interruptible=True,
                **common,
            ),
            Node(
                id="plate",
                label="Plate",
                instruction="Plate the braise.",
                kind="combine",
                attention="hands_on",
                duration_min=4,
                duration_typical=5,
                duration_max=5,
                station="counter",
                depends_on=["braise"],
                consumes=["comp_braised"],
                produces="comp_plated",
                interruptible=True,
                **common,
            ),
            Node(
                id="marinate",
                label="Marinate",
                instruction="Marinate separately.",
                kind="passive",
                attention="unattended",
                duration_min=600,
                duration_typical=600,
                duration_max=600,
                station="fridge",
                depends_on=[],
                consumes=[],
                produces="comp_marinated",
                interruptible=True,
                **common,
            ),
            Node(
                id="finish",
                label="Finish",
                instruction="Bring both together and serve.",
                kind="finish",
                attention="hands_on",
                duration_min=4,
                duration_typical=5,
                duration_max=5,
                station="none",
                depends_on=["plate", "marinate"],
                consumes=["comp_plated", "comp_marinated"],
                produces=None,
                interruptible=False,
                **common,
            ),
        ],
    )


def test_converging_chains_high_bound_is_clamped_not_reported_raw() -> None:
    graph = _converging_chains_graph()
    plan = schedule(graph)
    summary = summarize(graph, plan)

    # (f) Two sittings, no exception getting here.
    assert len(summary.sessions) == 2
    sitting1, sitting2 = summary.sessions

    # (a) Sitting 1: the slowness lands here -- typical 10, slow footprint 30 (sear's
    # own duration_max, from 0).
    assert (sitting1.elapsed_min, sitting1.elapsed_high_min) == pytest.approx((10.0, 30.0))

    # (b)/(c) The raw slow-plan placements pin the unclamped footprint at exactly 35,
    # below sitting 2's normal 55 -- reproduced directly on the slow schedule, not just
    # asserted through the clamped field.
    slow_plan = _slow_plan(graph, burner_capacity=1)
    slow_by_id = {s.node_id: s for s in slow_plan.scheduled}
    assert slow_by_id["plate"].start_min == pytest.approx(570.0)
    assert slow_by_id["finish"].start_min == pytest.approx(600.0)
    assert slow_by_id["finish"].end_min == pytest.approx(605.0)
    unclamped_footprint = slow_by_id["finish"].end_min - slow_by_id["plate"].start_min
    assert unclamped_footprint == pytest.approx(35.0)
    assert sitting2.elapsed_min == pytest.approx(55.0)
    assert unclamped_footprint < sitting2.elapsed_min

    # (d) After the clamp: sitting 2's high equals its own elapsed, not the raw 35.
    assert sitting2.elapsed_high_min == pytest.approx(sitting2.elapsed_min) == pytest.approx(55.0)

    # (e) Recipe level is unaffected by the clamp -- the honest upper bound was always
    # 605 here, since the marinate chain (never slowed) dominates the critical path
    # regardless of the sear/braise/plate chain's pace.
    assert summary.elapsed_high_min == pytest.approx(summary.elapsed_min) == pytest.approx(605.0)

    # (f) Host ids for the gap between the sittings, in scheduled-start order: marinate
    # (start 0) before braise (start 10) -- both overlap the gap, ordering is by_start.
    assert sitting2.preceded_by_host_node_ids == ["marinate", "braise"]


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

    # M3.1a: the middle sitting is pizza's only real (non-synthetic) case, and the one
    # the mismatch-graph test can't stand in for -- pin it so a regression in the
    # middle-session branch of `summarize` can't hide behind single- or two-sitting
    # coverage alone.
    assert [(s.elapsed_min, s.elapsed_high_min) for s in summary.sessions] == [
        (10.0, 12.0),
        (10.0, 15.0),
        (30.0, 46.0),
    ]
    assert [s.preceded_by_host_node_ids for s in summary.sessions] == [
        [],
        ["step_cover_the_bowl_with_plastic_wrap"],
        [
            "step_cover_and_refrigerate_overnight_18_hours",
            "step_remove_the_dough_1_hour_before",
            "step_place_a_pizza_stone_or_inverted",
        ],
    ]
    assert summary.long_waits == []  # both gaps are >= SESSION_BREAK_MIN, not long waits

    listed = [node_id for session in summary.sessions for node_id in session.node_ids]
    assert sorted(listed) == sorted(n.id for n in graph.nodes)
