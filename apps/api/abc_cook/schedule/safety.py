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

    Covers overrun risk (a single assigned task whose `duration_max` alone exceeds the
    whole window's `capacity_min`), freshness violations (`max_lead_min`), station
    contention, and non-`interruptible` tasks over 3 min in a `periodic` window.

    Packing (§4.4) and the overrun check are independent: packing sums `duration_typical`
    against `capacity_min` to decide membership; this check tests each member's
    `duration_max` against the total capacity as a pessimistic-duration safety net. A
    window packed to exactly its typical capacity is expected and does not warn.

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
    placed = {s.node_id: s for s in scheduled}
    warnings: list[str] = []

    for window in windows:
        host = nodes[window.host_node_id]
        for node_id in window.assigned:
            node = nodes[node_id]

            if node.duration_max > window.capacity_min:
                warnings.append(
                    f"{node_id}: worst case {node.duration_max} min may overrun the "
                    f"{window.capacity_min:g}-min window {window.id}",
                )

            if node.max_lead_min is not None:
                consumer_starts = [
                    placed[c.id].start_min
                    for c in graph.nodes
                    if node_id in c.depends_on and c.id in placed
                ]
                if consumer_starts:
                    lead = min(consumer_starts) - placed[node_id].end_min
                    if lead > node.max_lead_min:
                        warnings.append(
                            f"{node_id}: ready {lead:g} min before it is needed "
                            f"(max lead {node.max_lead_min} min)",
                        )

            if (
                host.attention == "periodic"
                and not node.interruptible
                and node.duration_typical > PERIODIC_MAX_TASK_MIN
            ):
                warnings.append(
                    f"{node_id}: not interruptible and over {PERIODIC_MAX_TASK_MIN:g} min, "
                    f"cannot sit in periodic window {window.id}",
                )

    stationed = [s for s in scheduled if nodes[s.node_id].station != "none"]
    for i, first in enumerate(stationed):
        for second in stationed[i + 1 :]:
            station = nodes[first.node_id].station
            if nodes[second.node_id].station != station:
                continue
            if first.start_min < second.end_min and second.start_min < first.end_min:
                warnings.append(
                    f"{station}: {first.node_id} and {second.node_id} run at once "
                    f"(needs 2 {station}s)",
                )

    return warnings
