"""Post-scheduling safety checks. See docs/COOKING_GRAPH.md §4.5.

Findings land in `CookingPlan.warnings`. Pure. No I/O, no clock, no randomness.
"""

from abc_cook.schedule.windows import PERIODIC_MAX_TASK_MIN
from abc_cook.schema import CookingGraph, ScheduledNode, WaitWindow


def check_plan(
    graph: CookingGraph,
    scheduled: list[ScheduledNode],
    windows: list[WaitWindow],
) -> list[str]:
    """Run the §4.5 checks over a scheduled plan.

    Covers freshness violations (`max_lead_min`), station contention (`uses N burners`),
    and non-`interruptible` tasks over 3 min in a `periodic` window.

    Worst-case window fit is NOT checked here: `duration_max` is an eligibility gate
    during assignment (§4.4), so a window never claims a task it cannot safely hold and
    there is nothing to drop or warn about afterwards. A prep task that no window can
    hold is simply a serial step.

    Finding no windows is not a warning — it is a fact about the recipe. The UI shows a
    plain step-by-step plan and says nothing about parallelism. Never fabricate filler
    tasks to fill a window.

    Args:
        graph: The graph the plan was scheduled from.
        scheduled: The placed nodes.
        windows: The derived windows, with tasks assigned and ranked.

    Returns:
        Human-readable warnings, empty when the plan is clean.
    """
    nodes = {n.id: n for n in graph.nodes}
    warnings: list[str] = []

    for window in windows:
        host = nodes[window.host_node_id]
        for node_id in window.assigned:
            node = nodes[node_id]
            if (
                host.attention == "periodic"
                and not node.interruptible
                and node.duration_typical > PERIODIC_MAX_TASK_MIN
            ):
                warnings.append(
                    f"{node_id}: not interruptible and over {PERIODIC_MAX_TASK_MIN:g} min, "
                    f"cannot sit in periodic window {window.id}",
                )

    warnings.extend(_freshness_notes(graph, scheduled))
    warnings.extend(_station_notes(graph, scheduled))
    return warnings


def _freshness_notes(graph: CookingGraph, scheduled: list[ScheduledNode]) -> list[str]:
    """Warn when a `max_lead_min` node finished too long before a consumer starts (§4.5).

    The scheduler withholds fresh nodes to run them just-in-time; this is the safety
    net for when resource contention pushed the consumer later anyway. Checked for
    every consumer, so it also covers the deferred multi-consumer case.
    """
    placed = {s.node_id: s for s in scheduled}
    consumers: dict[str, list[str]] = {}
    for consumer in graph.nodes:
        for dep in consumer.depends_on:
            consumers.setdefault(dep, []).append(consumer.id)

    notes: list[str] = []
    for node in graph.nodes:
        if node.max_lead_min is None:
            continue
        for consumer_id in consumers.get(node.id, []):
            lead = placed[consumer_id].start_min - placed[node.id].end_min
            if lead > node.max_lead_min:
                notes.append(
                    f"{node.id}: ready {lead:g} min before {consumer_id} needs it "
                    f"(max lead {node.max_lead_min} min)",
                )
    return notes


def _station_notes(graph: CookingGraph, scheduled: list[ScheduledNode]) -> list[str]:
    """One deterministic `"uses N Xs"` note per station the plan runs two-deep or more.

    N is the peak simultaneous count on that station. This fires whenever the finished
    timeline overlaps — including when `burner_capacity` (§4.6) permitted it — because a
    plan that assumes two free rings must say so. Nodes that only touch at a boundary
    (one ends exactly as the next starts) are not counted as overlapping.
    """
    station_of = {n.id: n.station for n in graph.nodes}
    events: dict[str, list[tuple[float, int]]] = {}
    for placed in scheduled:
        station = station_of[placed.node_id]
        if station == "none":
            continue
        events.setdefault(station, []).extend(
            ((placed.start_min, 1), (placed.end_min, -1)),
        )

    notes: list[str] = []
    for name in sorted(events):
        peak = current = 0
        for _, delta in sorted(events[name], key=lambda e: (e[0], e[1])):
            current += delta
            peak = max(peak, current)
        if peak >= 2:
            notes.append(f"uses {peak} {name}s")
    return notes
