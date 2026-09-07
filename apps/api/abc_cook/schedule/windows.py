"""Deriving wait windows from a timeline. See docs/COOKING_GRAPH.md §4.3.

Pure. No I/O, no clock, no randomness.
"""

from abc_cook.schema import CookingGraph, ScheduledNode, WaitWindow

UNATTENDED_CAPACITY_FACTOR = 0.9
"""Usable fraction of an `unattended` host node's duration."""

PERIODIC_CAPACITY_FACTOR = 0.75
"""Usable fraction of a `periodic` host node's duration."""

PERIODIC_MAX_TASK_MIN = 3.0
"""Longest single task allowed inside a `periodic` window; the task must be interruptible."""

# The multipliers are safety margin, not arithmetic. The user is a human in a kitchen,
# not a CPU: nine minutes of chopping inside a nine-minute simmer burns the base.
# Never pack a window to 100%.


def derive_windows(
    graph: CookingGraph,
    scheduled: list[ScheduledNode],
) -> list[WaitWindow]:
    """Find the intervals where the cook is free because something is cooking itself.

    A window exists wherever a node with `attention` of `unattended` or `periodic` is
    running and does not require the cook. Capacity comes from the factors above.

    Note that eligibility is decided by `attention`, never by `kind`.

    Args:
        graph: The graph the timeline was scheduled from.
        scheduled: The placed nodes, before window assignment.

    Returns:
        Wait windows with capacity set and `assigned` still empty.
    """
    raise NotImplementedError("M1: see docs/COOKING_GRAPH.md §4.3")


def capacity_for(graph: CookingGraph, host_node_id: str) -> float:
    """Compute a window's usable minutes from its host node's attention and duration.

    Args:
        graph: The graph containing the host node.
        host_node_id: The unattended or periodic node whose duration creates the window.

    Returns:
        Usable minutes, after the safety multiplier.
    """
    raise NotImplementedError("M1: see docs/COOKING_GRAPH.md §4.3")
