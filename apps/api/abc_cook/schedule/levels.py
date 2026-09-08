"""Critical-path ranking. See docs/COOKING_GRAPH.md §4.1 step 2.

Pure. No I/O, no clock, no randomness.
"""

from abc_cook.schema import CookingGraph


def _successors(graph: CookingGraph) -> dict[str, list[str]]:
    """Map each node id to the ids that directly depend on it."""
    succ: dict[str, list[str]] = {n.id: [] for n in graph.nodes}
    for node in graph.nodes:
        for dep in node.depends_on:
            succ[dep].append(node.id)
    return succ


def compute_levels(graph: CookingGraph) -> dict[str, float]:
    """Compute each node's longest path to any sink, weighted by `duration_typical`.

    This is the classic critical-path rank: a high level means the node has a lot of
    work downstream of it, so starting it late delays everything.

    Args:
        graph: The graph to rank. Assumed already validated and acyclic.

    Returns:
        Node id to level, in minutes. A sink node's level is its own duration.
    """
    nodes = {n.id: n for n in graph.nodes}
    successors = _successors(graph)
    memo: dict[str, float] = {}

    def level(node_id: str) -> float:
        if node_id in memo:
            return memo[node_id]
        downstream = max((level(s) for s in successors[node_id]), default=0.0)
        memo[node_id] = float(nodes[node_id].duration_typical) + downstream
        return memo[node_id]

    return {node_id: level(node_id) for node_id in nodes}


def critical_path(graph: CookingGraph, levels: dict[str, float]) -> list[str]:
    """Trace the longest path through the graph, in execution order.

    Starts at the globally highest-level node — necessarily a source, since prepending
    a predecessor only raises the level — and walks to the highest-level successor at
    each step. Ties break on `node_id` so the path is deterministic.

    The resulting path's duration is not expected to equal `CookingPlan.total_min`: the
    makespan can be longer when a resource (the single cook, a contended station) forces
    an off-path node to run serially.

    Args:
        graph: The graph the levels were computed from.
        levels: Output of `compute_levels`.

    Returns:
        Node ids along the critical path, source first.
    """
    successors = _successors(graph)
    current = min(levels, key=lambda node_id: (-levels[node_id], node_id))
    path = [current]
    while successors[current]:
        current = min(successors[current], key=lambda node_id: (-levels[node_id], node_id))
        path.append(current)
    return path
