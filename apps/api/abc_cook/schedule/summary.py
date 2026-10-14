"""Recipe-level timing summary over a finished plan. See docs/COOKING_GRAPH.md §4.

The header range, the "advance prep" line, and the between-stage wait row all need a
recipe-level number, and `CLAUDE.md` forbids the frontend from deriving one. This module
is that number, computed the same way the M3 pre-implementation review validated it: run
the real scheduler twice (once as scheduled, once with every `hands_on` node slowed to
its `duration_max`) and read the honest range off the two timelines, then split the
timeline into sittings wherever the cook is idle long enough to leave the kitchen.

One rule shapes both splits: an `unattended` node that starts strictly inside a gap needs
the cook at its start instant (start a timer, switch an appliance on), so that instant
counts as attended even though the node itself needs nobody afterwards.

Pure, like the rest of `abc_cook/schedule/`: no I/O, no network, no clock, no randomness.
"""

from typing import Any

from abc_cook.schedule.scheduler import schedule
from abc_cook.schedule.windows import MINUTE_DP
from abc_cook.schema import (
    CookingGraph,
    CookingPlan,
    LongWait,
    Node,
    Phase,
    PlanSummary,
    ScheduledNode,
    Session,
)

SESSION_BREAK_MIN = 120.0
"""Idle stretch, in minutes, long enough to count as a separate sitting -- "come back
later" rather than "wait here". Pizza's 4.5-hr rise splits; donuts' 57-min rise does
not. Product decision, validated at the M3 pre-implementation review (§V5)."""

PHASE_BREAK_MIN = 45.0
"""Hands-free gap, in minutes (no `hands_on` and no `periodic` node running), after which
a new phase starts -- "come back later" rather than "wait here". Provisional: equal to
`LONG_WAIT_MIN` today but deliberately a separate constant, free to move independently.
No fixture has a gap between 40 and 57 min, so the value is untested by real data there."""

LONG_WAIT_MIN = 45.0
"""Idle stretch, in minutes, long enough that the cook can leave the kitchen but not
long enough to be a separate sitting. Below this, a wait is just part of the current
stage's rhythm and gets no special callout."""


def _round(minutes: float) -> float:
    """Quantise a minute value to match every other minute field in the plan."""
    return round(minutes, MINUTE_DP)


def _merge(intervals: list[tuple[float, float]]) -> list[list[float]]:
    """Merge overlapping or touching (start, end) intervals, sorted by start."""
    merged: list[list[float]] = []
    for start, end in sorted(intervals):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return merged


def _slow_plan(graph: CookingGraph, *, burner_capacity: int) -> CookingPlan:
    """Reschedule with every `hands_on` node slowed to its `duration_max`.

    Hands-off nodes are untouched -- they are result-dependent, not human-dependent, so
    a cook's pace has no bearing on them. This is the "honest upper bound": a cook who
    is slower than typical at every chop, not a naive sum of every node's `duration_max`
    (which overstates by ignoring slack that wait windows already absorb).

    Scheduled once and reused for both `PlanSummary.elapsed_high_min` (its `total_min`)
    and each `Session.elapsed_high_min` (the occupied footprint of that sitting's own
    nodes on this same timeline).
    """
    slowed_nodes = [
        node.model_copy(update={"duration_typical": node.duration_max})
        if node.attention == "hands_on"
        else node
        for node in graph.nodes
    ]
    slowed_graph = graph.model_copy(update={"nodes": slowed_nodes})
    return schedule(slowed_graph, burner_capacity=burner_capacity)


def _host_node_ids(
    by_start: list[ScheduledNode],
    gap_start: float,
    gap_end: float,
) -> list[str]:
    """Hands-off nodes whose interval overlaps the open gap `(gap_start, gap_end)`.

    Same predicate as `LongWait.host_node_ids` -- a session break and a long wait are
    both just gaps of different lengths, so "what's the dish busy with" is one question.
    """
    return [
        s.node_id
        for s in by_start
        if not s.occupies_cook and s.start_min < gap_end and s.end_min > gap_start
    ]


def _hand_started_ids(
    nodes: dict[str, Node],
    by_start: list[ScheduledNode],
    occupied: list[list[float]],
) -> set[str]:
    """`unattended` nodes whose start falls strictly inside an interior occupied gap.

    Somebody has to be there to start such a node, so its start instant ends the
    hands-free gap it sits in. A node starting exactly on a stretch edge is unaffected
    (the cook is already there), and leading/trailing time is ignored because the outer
    edges already widen to `0`/`total_min`.

    One set serves both partitions: occupied time is a subset of attended time, so a
    start inside an attended gap is always inside an occupied gap, and a start inside a
    periodic run merges into that run and changes nothing. Feeding the same points to
    both keeps every session boundary a phase boundary.
    """
    gaps = [(occupied[i][1], occupied[i + 1][0]) for i in range(len(occupied) - 1)]
    return {
        s.node_id
        for s in by_start
        if nodes[s.node_id].attention == "unattended"
        and any(gap_start < s.start_min < gap_end for gap_start, gap_end in gaps)
    }


def _partition(
    nodes: dict[str, Node],
    by_start: list[ScheduledNode],
    slow_plan: CookingPlan,
    intervals: list[list[float]],
    threshold: float,
    *,
    total_min: float,
    counted_ids: set[str],
    start_only_ids: set[str],
) -> list[dict[str, Any]]:
    """Split the timeline into stretches separated by gaps >= `threshold`.

    Shared by sessions (cook-occupied intervals) and phases (attended intervals); the
    returned dicts hold the fields both models have in common.

    Args:
        nodes: The graph's nodes by id.
        by_start: The plan's scheduled nodes, sorted by (start, id).
        slow_plan: The slowed-pace reschedule (see `_slow_plan`).
        intervals: Merged, sorted intervals whose gaps are measured.
        threshold: Minimum gap, in minutes, that starts a new stretch.
        total_min: The plan's `total_min`; the outer edges widen to `0` and this.
        counted_ids: Nodes whose interval counts toward a stretch's slow-timeline footprint.
        start_only_ids: Hand-started `unattended` nodes (see `_hand_started_ids`); only
            their start instant counts toward the footprint, as a zero-length point.
    """
    clusters: list[list[float]] = [list(intervals[0])] if intervals else [[0.0, total_min]]
    for start, end in intervals[1:]:
        if start - clusters[-1][1] < threshold:
            clusters[-1][1] = end
        else:
            clusters.append([start, end])

    # A recipe rarely opens or closes on a hands-on beat -- pizza's first sitting
    # includes 5 min of unattended mixing before any chop, and its last includes the
    # unattended slide-and-rest after the last hands-on step. Widen the outer edges to
    # the plan's own bounds so a stretch's span matches what the cook actually lived
    # through, not just its hands-on interior. Interior boundaries are untouched.
    clusters[0][0] = 0.0
    clusters[-1][1] = total_min

    def _cluster_index(start_min: float) -> int:
        """The last cluster whose work had begun by `start_min`.

        A node that starts inside a break gap (the long unattended stretch itself --
        refrigerating dough, letting an oven preheat) is attributed to the stretch that
        triggered it, not the one that follows: starting the wait is the last thing the
        cook did in that stretch. A wait that starts on a stretch edge still belongs to
        the stretch that began it. A hand-started node (`start_only_ids`) is the
        exception: its own start creates a stretch, so it belongs to that one.
        """
        index = 0
        for i, cluster in enumerate(clusters):
            if cluster[0] <= start_min:
                index = i
        return index

    node_ids_by_cluster: list[list[str]] = [[] for _ in clusters]
    for entry in by_start:
        node_ids_by_cluster[_cluster_index(entry.start_min)].append(entry.node_id)

    slow_by_id = {s.node_id: s for s in slow_plan.scheduled}
    last_cluster = len(clusters) - 1

    parts: list[dict[str, Any]] = []
    for i, cluster in enumerate(clusters):
        node_ids = node_ids_by_cluster[i]
        active = float(
            sum(
                nodes[node_id].duration_typical
                for node_id in node_ids
                if nodes[node_id].attention == "hands_on"
            ),
        )
        preceded_by_wait_min = None if i == 0 else _round(cluster[0] - clusters[i - 1][1])

        footprint = [
            (slow_by_id[node_id].start_min, slow_by_id[node_id].end_min)
            if node_id in counted_ids
            else (slow_by_id[node_id].start_min, slow_by_id[node_id].start_min)
            for node_id in node_ids
            if node_id in counted_ids or node_id in start_only_ids
        ]
        low = min((start for start, _ in footprint), default=0.0)
        high = max((end for _, end in footprint), default=slow_plan.total_min)
        if i == 0:
            low = 0.0
        if i == last_cluster:
            high = slow_plan.total_min

        preceded_by_host_node_ids = (
            [] if i == 0 else _host_node_ids(by_start, clusters[i - 1][1], cluster[0])
        )

        elapsed_min = _round(cluster[1] - cluster[0])

        parts.append(
            {
                "start_min": _round(cluster[0]),
                "end_min": _round(cluster[1]),
                "active_min": _round(active),
                "node_ids": node_ids,
                "preceded_by_wait_min": preceded_by_wait_min,
                "elapsed_min": elapsed_min,
                # Converging independent chains can pin this stretch's slow-timeline
                # footprint below its typical-pace span -- a slower cook upstream shifts
                # this stretch's own nodes later without lengthening them, so the raw
                # footprint can undershoot `elapsed_min`. Clamped: the field's contract is
                # "at least what the shown schedule takes", and being slower can never
                # shrink this stretch.
                "elapsed_high_min": max(_round(high - low), elapsed_min),
                "preceded_by_host_node_ids": preceded_by_host_node_ids,
            },
        )
    return parts


def summarize(graph: CookingGraph, plan: CookingPlan, *, burner_capacity: int = 1) -> PlanSummary:
    """Compute the recipe-level timing summary for a scheduled plan.

    An `unattended` node that starts strictly inside a hands-free gap makes its start
    instant attended in both splits (someone must start it), so that gap is cut there.

    Args:
        graph: The graph `plan` was scheduled from.
        plan: The plan to summarise.
        burner_capacity: The same value `plan` was scheduled with (§4.6) -- needed again
            here because the honest-upper-bound range reschedules the graph.

    Returns:
        The summary. `sessions` always has at least one entry.

    Raises:
        KeyError: If `plan` references a node that is not in `graph`.
    """
    nodes = {n.id: n for n in graph.nodes}
    by_start = sorted(plan.scheduled, key=lambda s: (s.start_min, s.node_id))

    active_min = float(sum(nodes[s.node_id].duration_typical for s in by_start if s.occupies_cook))
    periodic_min = float(
        sum(
            nodes[s.node_id].duration_typical
            for s in by_start
            if nodes[s.node_id].attention == "periodic"
        ),
    )

    cook_intervals = [(s.start_min, s.end_min) for s in by_start if s.occupies_cook]
    cook_occupied = _merge(cook_intervals)
    hand_started = _hand_started_ids(nodes, by_start, cook_occupied)
    start_points = [(s.start_min, s.start_min) for s in by_start if s.node_id in hand_started]
    occupied = _merge(cook_intervals + start_points)
    idle_gaps = [
        (occupied[i][1], occupied[i + 1][0])
        for i in range(len(occupied) - 1)
        if occupied[i + 1][0] > occupied[i][1]
    ]

    # Sitting bounds come from the cook-occupied intervals alone: a gap below
    # SESSION_BREAK_MIN (a short pause, or a long wait the cook stays near) keeps the
    # two occupied stretches either side of it in the same sitting; a gap at or above
    # it starts a new one.
    # The high bound reuses the same slowed-pace timeline as PlanSummary.elapsed_high_min,
    # scheduled once: a session's high is the occupied footprint of ITS OWN node set on
    # that timeline, not a re-clustering of it (see docs/COOKING_GRAPH.md §4 / M3.2 plan
    # §3) -- re-clustering would answer a different question with no way back onto the
    # sittings the app actually schedules.
    slow_plan = _slow_plan(graph, burner_capacity=burner_capacity)
    session_parts = _partition(
        nodes,
        by_start,
        slow_plan,
        occupied,
        SESSION_BREAK_MIN,
        total_min=plan.total_min,
        counted_ids={s.node_id for s in by_start if s.occupies_cook},
        start_only_ids=hand_started,
    )
    sessions = [Session(**part) for part in session_parts]

    # Phases are an independent split on the *attended* timeline: a hands_on or periodic
    # node is "the cook is here". A stir-every-few-minutes simmer therefore never opens a
    # "come back later" gap, however long it runs.
    attended_ids = {s.node_id for s in by_start if nodes[s.node_id].attention != "unattended"}
    attended = _merge(
        [(s.start_min, s.end_min) for s in by_start if s.node_id in attended_ids] + start_points,
    )
    phase_parts = _partition(
        nodes,
        by_start,
        slow_plan,
        attended,
        PHASE_BREAK_MIN,
        total_min=plan.total_min,
        counted_ids=attended_ids,
        start_only_ids=hand_started,
    )
    session_starts = [p["start_min"] for p in session_parts[1:]]
    phases = [
        Phase(**part, starts_new_session=part["start_min"] in session_starts)
        for part in phase_parts
    ]

    long_waits = [
        LongWait(
            start_min=_round(start),
            end_min=_round(end),
            idle_min=_round(end - start),
            host_node_ids=_host_node_ids(by_start, start, end),
        )
        for start, end in idle_gaps
        if LONG_WAIT_MIN <= (end - start) < SESSION_BREAK_MIN
    ]

    return PlanSummary(
        active_min=_round(active_min),
        attended_min=_round(active_min + periodic_min),
        elapsed_min=plan.total_min,
        elapsed_high_min=_round(slow_plan.total_min),
        sessions=sessions,
        long_waits=long_waits,
        phases=phases,
    )
