"""Deriving wait windows from a timeline. See docs/COOKING_GRAPH.md §4.3.

Pure. No I/O, no clock, no randomness.
"""

from abc_cook.schema import CookingGraph, ScheduledNode, WaitWindow

UNATTENDED_CAPACITY_FACTOR = 0.9
"""Usable fraction of an `unattended` host node's duration."""

PERIODIC_CAPACITY_FACTOR = 0.75
"""Usable fraction of a `periodic` host node's duration."""

PERIODIC_MAX_TASK_MIN = 3.0
"""Longest non-`interruptible` task allowed inside a `periodic` window (§4.3).

`interruptible` tasks are bounded only by `capacity_min`: the 0.75 factor already
encodes the stir-tax, and a task you can set down mid-stroke can absorb it.
"""

MINUTE_DP = 2
"""Decimal places every minute value in the plan is rounded to (§4.3).

`duration_typical * 0.9` is not exactly representable in binary and golden-plan
comparison is exact; 0.01 min is finer than any kitchen needs.
"""

# The multipliers are safety margin, not arithmetic. The user is a human in a kitchen,
# not a CPU: nine minutes of chopping inside a nine-minute simmer burns the base.
# Never pack a window to 100%.


def capacity_for(graph: CookingGraph, host_node_id: str) -> float:
    """Compute a window's usable minutes from its host node's attention and duration.

    Args:
        graph: The graph containing the host node.
        host_node_id: The unattended or periodic node whose duration creates the window.

    Returns:
        Usable minutes, after the safety multiplier.

    Raises:
        ValueError: If the named node is `hands_on` and cannot host a window.
    """
    node = next(n for n in graph.nodes if n.id == host_node_id)
    if node.attention == "unattended":
        return round(node.duration_typical * UNATTENDED_CAPACITY_FACTOR, MINUTE_DP)
    if node.attention == "periodic":
        return round(node.duration_typical * PERIODIC_CAPACITY_FACTOR, MINUTE_DP)
    msg = f"{host_node_id} is {node.attention}; only unattended/periodic nodes host windows"
    raise ValueError(msg)


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
        Wait windows with capacity set and `assigned` still empty, ordered by host
        start time and numbered `w1`, `w2`, ….
    """
    attention = {n.id: n.attention for n in graph.nodes}
    hosts = [s for s in scheduled if attention[s.node_id] in ("unattended", "periodic")]
    hosts.sort(key=lambda s: (s.start_min, s.node_id))

    windows: list[WaitWindow] = []
    for i, host in enumerate(hosts, start=1):
        capacity = capacity_for(graph, host.node_id)
        windows.append(
            WaitWindow(
                id=f"w{i}",
                host_node_id=host.node_id,
                capacity_min=capacity,
                assigned=[],
                used_min=0.0,
                slack_min=capacity,
            ),
        )
    return windows
