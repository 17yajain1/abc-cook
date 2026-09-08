"""Ordering tasks inside a wait window. See docs/COOKING_GRAPH.md §4.4.

Pure. No I/O, no clock, no randomness.
"""

from abc_cook.schema import CookingGraph, WaitWindow


def rank_window_tasks(graph: CookingGraph, window: WaitWindow) -> list[str]:
    """Order a window's assigned tasks so rank 0 is the one to start with.

    Ordered by `duration_typical` descending — the longest task is the one most at risk
    of not fitting, and "start with the big one" is the right instinct at the stove —
    then `node_id` ascending as a deterministic tie-break.

    Freshness is not an input here: a task whose `max_lead_min` is too tight is kept out
    of the window entirely by the §4.5 checks, not merely ranked last.

    The UI promotes rank 0 as "Start with: …" and shows the rest as secondary — the list
    is ranked, never flat.

    Args:
        graph: The graph the window's nodes belong to.
        window: A window with `assigned` populated but unordered.

    Returns:
        The assigned node ids, best-first.
    """
    duration = {n.id: n.duration_typical for n in graph.nodes}
    return sorted(window.assigned, key=lambda node_id: (-duration[node_id], node_id))
