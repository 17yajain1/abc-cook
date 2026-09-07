"""The greedy list scheduler. See docs/COOKING_GRAPH.md §4.1 and §4.2.

Resource-constrained project scheduling with one renewable resource of capacity 1
(the cook) plus contended stations. Recipes have 8-30 nodes, so a greedy list
scheduler with good priority rules is fast and good enough. Do not reach for an ILP
solver.

Pure. No I/O, no network, no DB, no clock reads, no randomness: the same graph in
produces the same plan out, every time.
"""

from abc_cook.schema import CookingGraph, CookingPlan


def schedule(graph: CookingGraph) -> CookingPlan:
    """Schedule a validated cooking graph into a renderable plan.

    Places nodes greedily by critical-path level, starting unattended work as early as
    its dependencies allow (§4.2 — this single heuristic is the difference between a
    good plan and a useless one), then derives wait windows, ranks the tasks inside
    them, and runs the safety checks.

    Args:
        graph: A validated, acyclic graph. Validation is the caller's job (§5).

    Returns:
        The plan, including `saved_min` and any safety warnings.
    """
    raise NotImplementedError("M1: see docs/COOKING_GRAPH.md §4.1")


def serial_minutes(graph: CookingGraph) -> float:
    """Sum every node's `duration_typical` — the baseline of cooking one thing at a time.

    This is the number `saved_min` is measured against.

    Args:
        graph: The graph to total.

    Returns:
        Minutes.
    """
    raise NotImplementedError("M1: see docs/COOKING_GRAPH.md §4.1")
