"""The greedy list scheduler. See docs/COOKING_GRAPH.md §4.1 and §4.2.

Resource-constrained project scheduling with one renewable resource of capacity 1
(the cook) plus contended stations. Recipes have 8-30 nodes, so a greedy list
scheduler with good priority rules is fast and good enough. Do not reach for an ILP
solver.

Pure. No I/O, no network, no DB, no clock reads, no randomness: the same graph in
produces the same plan out, every time.
"""

from collections.abc import Callable

from abc_cook.schedule.levels import compute_levels, critical_path
from abc_cook.schedule.ranking import rank_window_tasks
from abc_cook.schedule.safety import check_plan
from abc_cook.schedule.windows import derive_windows
from abc_cook.schema import CookingGraph, CookingPlan, Node, ScheduledNode

_COOKING_KINDS = ("active", "combine", "finish")
"""`kind` values that unblock downstream cooking; preferred over prep when the cook is
free (§4.1.c.iii). This is a render/classification read, not a cook-occupancy one — the
latter must always go through `attention` (§4)."""

_CookKey = tuple[float, float, float, str]


def serial_minutes(graph: CookingGraph) -> float:
    """Sum every node's `duration_typical` — the baseline of cooking one thing at a time.

    This is the number `saved_min` is measured against.

    Args:
        graph: The graph to total.

    Returns:
        Minutes.
    """
    return float(sum(n.duration_typical for n in graph.nodes))


def _occupies_cook(node: Node) -> bool:
    """Whether a running node holds the cook. Reads `attention`, never `kind` (§4)."""
    return node.attention == "hands_on"


def _cook_priority(
    levels: dict[str, float],
    *,
    window_open: bool,
) -> Callable[[Node], _CookKey]:
    """Build the sort key for choosing the cook's next hands-on task (§4.1.c).

    Outside a wait window: critical path first (§4.1.c.ii), then `active` before `prep`
    (§4.1.c.iii), then longest `duration_typical` (§4.1.c.iv), then id.

    Inside a wait window: drop the level term. The window host *is* the critical path;
    the tasks competing here are off-path prep, and §3's worked example orders them by
    duration — "start with the big one" (§4.4) — not by level.
    """

    def key(node: Node) -> _CookKey:
        level_term = 0.0 if window_open else -levels[node.id]
        cooking_first = 0.0 if node.kind in _COOKING_KINDS else 1.0
        return (level_term, cooking_first, -float(node.duration_typical), node.id)

    return key


def schedule(graph: CookingGraph) -> CookingPlan:
    """Schedule a validated cooking graph into a renderable plan.

    Places nodes greedily by critical-path level, starting unattended and periodic work
    as early as its dependencies allow (§4.2 — this single heuristic is the difference
    between a good plan and a useless one), then derives wait windows, assigns and ranks
    the tasks inside them, and runs the safety checks.

    Args:
        graph: A validated, acyclic graph. Validation is the caller's job (§5).

    Returns:
        The plan, including `saved_min` and any safety warnings.
    """
    nodes = {n.id: n for n in graph.nodes}
    levels = compute_levels(graph)

    start: dict[str, float] = {}
    end: dict[str, float] = {}
    station_free_at: dict[str, float] = {}
    done: set[str] = set()
    running: set[str] = set()
    now = 0.0

    def station_free(node: Node, at: float) -> bool:
        return node.station == "none" or station_free_at.get(node.station, 0.0) <= at

    def begin(node: Node, at: float) -> None:
        start[node.id] = at
        end[node.id] = at + node.duration_typical
        if node.station != "none":
            station_free_at[node.station] = at + node.duration_typical
        running.add(node.id)

    def ready() -> list[Node]:
        return [
            n
            for node_id, n in nodes.items()
            if node_id not in start and all(dep in done for dep in n.depends_on)
        ]

    for _ in range(4 * len(nodes) + 8):
        if len(done) == len(nodes):
            break

        # (b) Start every ready node that does not hold the cook, as early as its
        #     dependencies allow (§4.2) — before any prep the cook could do later.
        for node in sorted(ready(), key=lambda n: (-levels[n.id], n.id)):
            if not _occupies_cook(node) and station_free(node, now):
                begin(node, now)

        cook_busy = any(_occupies_cook(nodes[r]) and end[r] > now for r in running)
        window_open = any(
            not _occupies_cook(nodes[r]) and start[r] <= now < end[r] for r in running
        )

        # (c) If the cook is free, start one ready hands-on node.
        if not cook_busy:
            candidates = [
                n for n in ready() if _occupies_cook(n) and station_free(n, now)
            ]
            if candidates:
                begin(min(candidates, key=_cook_priority(levels, window_open=window_open)), now)

        # (d) Advance to the next completion event.
        pending = [end[r] for r in running if end[r] > now]
        if not pending:
            continue
        now = min(pending)
        for node_id in [r for r in running if end[r] <= now]:
            running.discard(node_id)
            done.add(node_id)

    if len(done) != len(nodes):  # pragma: no cover - guards against a malformed graph
        msg = f"scheduler stalled; unplaced nodes: {sorted(set(nodes) - done)}"
        raise RuntimeError(msg)

    scheduled = [
        ScheduledNode(
            node_id=node_id,
            start_min=start[node_id],
            end_min=end[node_id],
            occupies_cook=_occupies_cook(nodes[node_id]),
        )
        for node_id in nodes
    ]
    placed = {s.node_id: s for s in scheduled}

    windows = derive_windows(graph, scheduled)
    for window in windows:
        host = placed[window.host_node_id]
        inside = sorted(
            (
                s
                for s in scheduled
                if s.node_id != window.host_node_id
                and _occupies_cook(nodes[s.node_id])
                and s.start_min >= host.start_min
                and s.end_min <= host.end_min
            ),
            key=lambda s: (-nodes[s.node_id].duration_typical, s.node_id),
        )
        used = 0.0
        for candidate in inside:
            typical = float(nodes[candidate.node_id].duration_typical)
            if used + typical <= window.capacity_min:
                window.assigned.append(candidate.node_id)
                used += typical
        window.assigned = rank_window_tasks(graph, window)
        window.used_min = used
        window.slack_min = window.capacity_min - used
        for rank, node_id in enumerate(window.assigned):
            placed[node_id].window_id = window.id
            placed[node_id].rank_in_window = rank

    scheduled.sort(key=lambda s: (s.start_min, s.node_id))

    total = max(end.values())
    serial = serial_minutes(graph)
    return CookingPlan(
        graph_id=graph.id,
        scheduled=scheduled,
        windows=windows,
        total_min=total,
        serial_min=serial,
        saved_min=serial - total,
        critical_path=critical_path(graph, levels),
        warnings=check_plan(graph, scheduled, windows),
    )
