"""Ordering tasks inside a wait window. See docs/COOKING_GRAPH.md §4.4.

Pure. No I/O, no clock, no randomness.
"""

from abc_cook.schema import CookingGraph, WaitWindow


def rank_window_tasks(graph: CookingGraph, window: WaitWindow) -> list[str]:
    """Order a window's assigned tasks so rank 0 is the one to start with.

    Ordered by: tasks the next stage depends on first (finishing them unblocks
    progress), then longest duration first (those are at risk of not fitting), then
    tasks with a tight `max_lead_min` last (freshness).

    The UI promotes rank 0 as "Start with: …" and shows the rest as secondary — the
    list is ranked, never flat.

    Args:
        graph: The graph the window's nodes belong to.
        window: A window with `assigned` populated but unordered.

    Returns:
        The assigned node ids, best-first.
    """
    raise NotImplementedError("M1: see docs/COOKING_GRAPH.md §4.4")
