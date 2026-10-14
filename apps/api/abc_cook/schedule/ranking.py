"""Ordering tasks inside a wait window. See docs/COOKING_GRAPH.md §4.4.

Pure. No I/O, no clock, no randomness.
"""

from collections.abc import Mapping

from abc_cook.schema import WaitWindow


def rank_window_tasks(window: WaitWindow, start_of: Mapping[str, float]) -> list[str]:
    """Order a window's assigned tasks so rank 0 is the one to start with.

    Ordered by scheduled `start_min` ascending, then `node_id` ascending as a
    deterministic tie-break. The timeline is already dependency-correct: a hands-on
    consumer starts at or after its dependency ends, and every duration is positive, so
    any ancestor — direct or transitive, inside the window or outside it — starts strictly
    earlier. Rank 0 is therefore always a task the cook can actually start first, even
    when a blocker (an outside soak, a freshness hold, a pan-chain gate, station
    contention) keeps a longer task from starting at window open.

    "Longest first" still decides which tasks the window claims (§4.4 step 1); it no
    longer decides the order they are shown in.

    The UI promotes rank 0 as "Start with: …" and shows the rest as secondary — the list
    is ranked, never flat.

    Args:
        window: A window with `assigned` populated.
        start_of: Scheduled `start_min` per node id, from the finished timeline.

    Returns:
        The assigned node ids, best-first.
    """
    return sorted(window.assigned, key=lambda node_id: (start_of[node_id], node_id))
