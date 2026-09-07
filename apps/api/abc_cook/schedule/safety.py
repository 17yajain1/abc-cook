"""Post-scheduling safety checks. See docs/COOKING_GRAPH.md §4.5.

Findings land in `CookingPlan.warnings`. Pure. No I/O, no clock, no randomness.
"""

from abc_cook.schema import CookingGraph, ScheduledNode, WaitWindow


def check_plan(
    graph: CookingGraph,
    scheduled: list[ScheduledNode],
    windows: list[WaitWindow],
) -> list[str]:
    """Run the §4.5 checks over a scheduled plan.

    Covers overrun risk (a task's `duration_max` exceeding remaining window capacity),
    freshness violations (`max_lead_min`), station contention, and non-interruptible
    tasks assigned to a `periodic` window.

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
    raise NotImplementedError("M1: see docs/COOKING_GRAPH.md §4.5")
