"""Per-stage rollups over the golden plans (abc_cook/schedule/rollup.py).

`stage_spans` is a view, not a scheduling decision — these tests assert it accounts for
every node exactly once and that its arithmetic is self-consistent. The one fixture
asserted by hand is `kadai-paneer`, because its overlapping prep/cook_base spans are the
behaviour the Plan view is built around.
"""

import json
from pathlib import Path
from typing import Any

import pytest

from abc_cook.schedule import schedule, stage_spans
from abc_cook.schema import CookingGraph, CookingPlan

FIXTURES = Path(__file__).parent / "fixtures"

GOLDEN = [
    "kadai-paneer",
    "maggi-2min",
    "chicken-biryani",
    "homemade-donuts",
    "strawberry-shortcake",
]


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


def test_every_node_appears_in_exactly_one_span(slug: str) -> None:
    graph = _graph(slug)
    spans = stage_spans(graph, _plan(slug))

    listed = [node_id for span in spans for node_id in span.node_ids]
    assert sorted(listed) == sorted(n.id for n in graph.nodes)
    assert len(listed) == len(set(listed)), "a node was rolled up into two stages"


def test_spans_follow_graph_stage_order(slug: str) -> None:
    """The Plan view lists stages in narrative order, not chronological order."""
    graph = _graph(slug)
    spans = stage_spans(graph, _plan(slug))

    populated = [s.id for s in graph.stages if any(n.stage == s.id for n in graph.nodes)]
    assert [span.stage_id for span in spans] == populated


def test_span_arithmetic_is_self_consistent(slug: str) -> None:
    graph = _graph(slug)
    plan = _plan(slug)
    spans = stage_spans(graph, plan)
    durations = {n.id: n.duration_typical for n in graph.nodes}
    windowed = {s.node_id for s in plan.scheduled if s.window_id is not None}

    for span in spans:
        assert span.elapsed_min == pytest.approx(span.end_min - span.start_min)
        assert span.work_min == pytest.approx(
            span.windowed_work_min + span.inline_work_min,
        )
        assert span.work_min == pytest.approx(sum(durations[n] for n in span.node_ids))
        assert span.windowed_work_min == pytest.approx(
            sum(durations[n] for n in span.node_ids if n in windowed),
        )
        assert span.start_min <= span.end_min


def test_spans_cover_the_whole_makespan(slug: str) -> None:
    plan = _plan(slug)
    spans = stage_spans(_graph(slug), plan)

    assert min(span.start_min for span in spans) == pytest.approx(0.0)
    assert max(span.end_min for span in spans) == pytest.approx(plan.total_min)


def test_stage_spans_are_deterministic(slug: str) -> None:
    graph = _graph(slug)
    plan = _plan(slug)
    assert stage_spans(graph, plan) == stage_spans(graph, plan)


def test_kadai_paneer_stages_overlap() -> None:
    """The interleaving the Plan view exists to show.

    Three prep nodes run inside the cook-base window, so `prep` is still open at t=19
    while `cook_base` has been running since t=3. A UI that drew stages as sequential
    blocks would be lying about this recipe.
    """
    graph = _graph("kadai-paneer")
    spans = {span.stage_id: span for span in stage_spans(graph, _plan("kadai-paneer"))}

    prep, cook_base = spans["prep"], spans["cook_base"]

    assert (prep.start_min, prep.end_min) == (0.0, 19.0)
    assert (cook_base.start_min, cook_base.end_min) == (3.0, 22.0)
    assert cook_base.start_min < prep.end_min, "prep and cook_base must overlap"

    # Prep is 14 min of work, but 9 of it is absorbed into the cook-base window, so the
    # Prep card itself only still owns chop_onion (3) + chop_tomato (2).
    assert prep.work_min == 14.0
    assert prep.windowed_work_min == 9.0
    assert prep.inline_work_min == 5.0

    # Nothing in cook_base is borrowed by another stage's window.
    assert cook_base.windowed_work_min == 0.0
    assert cook_base.inline_work_min == 17.0


def test_maggi_has_no_windowed_work() -> None:
    """Nothing to parallelise: every stage keeps all of its own work."""
    graph = _graph("maggi-2min")
    for span in stage_spans(graph, _plan("maggi-2min")):
        assert span.windowed_work_min == 0.0
        assert span.inline_work_min == span.work_min
