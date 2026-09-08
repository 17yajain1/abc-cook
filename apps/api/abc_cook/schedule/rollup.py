"""Per-stage rollups over a finished plan. See docs/COOKING_GRAPH.md §4.

The Plan view puts a minute count on every stage card, and the frontend is forbidden
from deriving one — every number on screen originates here (CLAUDE.md). This module is
the smallest thing that satisfies that: a read-only view over an already-scheduled
plan.

It is deliberately separate from `CookingPlan`. Folding these fields into the plan would
change all five golden fixtures, and a golden plan only changes for a product reason.

Pure, like the rest of `abc_cook/schedule/`: no I/O, no network, no clock, no randomness.
"""

from abc_cook.schedule.windows import MINUTE_DP
from abc_cook.schema import CookingGraph, CookingPlan, StageSpan


def _round(minutes: float) -> float:
    """Quantise a minute value to match every other minute field in the plan."""
    return round(minutes, MINUTE_DP)


def stage_spans(graph: CookingGraph, plan: CookingPlan) -> list[StageSpan]:
    """Summarise where each stage lands on the scheduled timeline.

    Stages are returned in `graph.stages` order — the recipe's narrative order, which is
    what the Plan view lists down the screen. That order is *not* chronological and the
    spans overlap: in Kadai Paneer `prep` spans 0-19 and `cook_base` spans 3-22, because
    three prep nodes run inside the cook-base wait window. That overlap is the product's
    whole argument, so it is surfaced rather than flattened.

    `work_min` splits into `windowed_work_min` (minutes the scheduler placed inside some
    other node's wait window, which the UI renders in that window's block) and
    `inline_work_min` (what remains on the stage's own card).

    Args:
        graph: The graph the plan was scheduled from.
        plan: The plan to summarise. Must have been scheduled from `graph`.

    Returns:
        One span per stage in `graph.stages`, ordered as `graph.stages` is. Stages with
        no nodes are omitted — an empty stage card is noise.

    Raises:
        KeyError: If `plan` references a node that is not in `graph`.
    """
    nodes = {n.id: n for n in graph.nodes}
    placed = sorted(plan.scheduled, key=lambda s: (s.start_min, s.node_id))

    by_stage: dict[str, list[str]] = {}
    for entry in placed:
        by_stage.setdefault(nodes[entry.node_id].stage, []).append(entry.node_id)

    windowed = {s.node_id for s in plan.scheduled if s.window_id is not None}
    bounds = {s.node_id: (s.start_min, s.end_min) for s in plan.scheduled}

    spans: list[StageSpan] = []
    for stage in graph.stages:
        node_ids = by_stage.get(stage.id)
        if not node_ids:
            continue

        start = min(bounds[node_id][0] for node_id in node_ids)
        end = max(bounds[node_id][1] for node_id in node_ids)
        work = float(sum(nodes[node_id].duration_typical for node_id in node_ids))
        in_window = float(
            sum(nodes[node_id].duration_typical for node_id in node_ids if node_id in windowed),
        )

        spans.append(
            StageSpan(
                stage_id=stage.id,
                start_min=_round(start),
                end_min=_round(end),
                elapsed_min=_round(end - start),
                work_min=_round(work),
                windowed_work_min=_round(in_window),
                inline_work_min=_round(work - in_window),
                node_ids=node_ids,
            ),
        )
    return spans
