"""Critical-path ranking. See docs/COOKING_GRAPH.md §4.1 step 2.

Pure. No I/O, no clock, no randomness.
"""

from abc_cook.schema import CookingGraph


def compute_levels(graph: CookingGraph) -> dict[str, float]:
    """Compute each node's longest path to any sink, weighted by `duration_typical`.

    This is the classic critical-path rank: a high level means the node has a lot of
    work downstream of it, so starting it late delays everything.

    Args:
        graph: The graph to rank. Assumed already validated and acyclic.

    Returns:
        Node id to level, in minutes. A sink node's level is its own duration.
    """
    raise NotImplementedError("M1: see docs/COOKING_GRAPH.md §4.1")


def critical_path(graph: CookingGraph, levels: dict[str, float]) -> list[str]:
    """Trace the longest path through the graph, in execution order.

    Args:
        graph: The graph the levels were computed from.
        levels: Output of `compute_levels`.

    Returns:
        Node ids along the critical path, source first.
    """
    raise NotImplementedError("M1: see docs/COOKING_GRAPH.md §4.1")
