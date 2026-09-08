"""The list scheduler — the global stage. See docs/COOKING_GRAPH.md §4.1 and §4.2.

Resource-constrained project scheduling with one renewable resource of capacity 1
(the cook) plus contended stations. Recipes have 8-30 nodes, so a greedy list
scheduler with good priority rules is fast and good enough. Do not reach for an ILP
solver.

This module runs the clock and places every node in time. It is a separate stage from
§4.4 (windowed-prep ownership and ranking), which runs afterwards on the finished
timeline and never moves a node.

Pure. No I/O, no network, no DB, no clock reads, no randomness: the same graph in
produces the same plan out, every time.
"""

from abc_cook.schedule.levels import compute_levels, critical_path
from abc_cook.schedule.ranking import rank_window_tasks
from abc_cook.schedule.safety import check_plan
from abc_cook.schedule.windows import MINUTE_DP, derive_windows
from abc_cook.schema import CookingGraph, CookingPlan, Node, ScheduledNode

_COOKING_KINDS = ("active", "combine", "finish")
"""`kind` values that unblock downstream cooking; preferred over prep when the cook is
free and no window is open (§4.1.c). A render/classification read, not a cook-occupancy
one — the latter must always go through `attention` (§4)."""

# Out-of-window key: (-level, cooking-before-prep, -duration_typical, id).
# In-window key: (-duration_typical, id) — strictly §4.4, nothing else.
_OutKey = tuple[float, float, float, str]
_InKey = tuple[float, str]


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


def _round(minutes: float) -> float:
    """Quantise a minute value so golden-plan comparison is exact (§4.3)."""
    return round(minutes, MINUTE_DP)


def _cook_choice(
    candidates: list[Node],
    levels: dict[str, float],
    *,
    window_open: bool,
) -> Node:
    """Pick the cook's next hands-on task (§4.1.c).

    While a wait window is open the cook is filling time, so the choice is strictly the
    §4.4 key: longest `duration_typical` first, then `node_id`. Critical-path rank does
    not apply — the window host is already the critical path.

    Otherwise: highest `level` (critical path first), then a cooking node
    (`active`/`combine`/`finish`) before `prep`, then longest `duration_typical`,
    then `node_id`.
    """
    def in_key(node: Node) -> _InKey:
        return (-float(node.duration_typical), node.id)

    def out_key(node: Node) -> _OutKey:
        cooking_first = 0.0 if node.kind in _COOKING_KINDS else 1.0
        return (-levels[node.id], cooking_first, -float(node.duration_typical), node.id)

    if window_open:
        return min(candidates, key=in_key)
    return min(candidates, key=out_key)


def schedule(graph: CookingGraph, *, burner_capacity: int = 1) -> CookingPlan:
    """Schedule a validated cooking graph into a renderable plan.

    Runs the §4.1 loop: start unattended and periodic work as early as its dependencies
    allow (§4.2 — the single heuristic that separates a good plan from a useless one),
    fill the resulting wait windows with prep, then derive windows, assign and rank the
    tasks inside them (§4.4), and run the safety checks (§4.5).

    Args:
        graph: A validated, acyclic graph. Validation is the caller's job (§5).
        burner_capacity: How many burner nodes may run at once — a property of the
            kitchen, not the recipe (§4.6). Default 1 (serialised).

    Returns:
        The plan, including `saved_min` and any safety warnings.
    """
    nodes = {n.id: n for n in graph.nodes}
    levels = compute_levels(graph)
    capacity_of = {"burner": burner_capacity}

    consumers: dict[str, list[str]] = {}
    for consumer in graph.nodes:
        for dep in consumer.depends_on:
            consumers.setdefault(dep, []).append(consumer.id)

    start: dict[str, float] = {}
    end: dict[str, float] = {}
    done: set[str] = set()
    running: set[str] = set()
    now = 0.0

    def station_has_room(node: Node) -> bool:
        if node.station == "none":
            return True
        cap = capacity_of.get(node.station, 1)
        active = sum(1 for r in running if nodes[r].station == node.station)
        return active < cap

    def freshness_ready(node: Node) -> bool:
        """Withhold a `max_lead_min` node until its consumer's last other dep is done.

        M1 scope (§4.5): only the canonical single-consumer case delays. A fresh node
        with zero or several consumers schedules normally — the post-hoc lead warning
        in `check_plan` still covers it.
        """
        if node.max_lead_min is None:
            return True
        downstream = consumers.get(node.id, [])
        if len(downstream) != 1:
            return True
        other_deps = nodes[downstream[0]].depends_on
        return all(
            dep in done
            for dep in other_deps
            if dep != node.id and nodes[dep].max_lead_min is None
        )

    def begin(node: Node, at: float) -> None:
        start[node.id] = at
        end[node.id] = at + node.duration_typical
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

        # (b) Start every ready unattended/periodic node with station room, as early as
        #     its dependencies allow (§4.2). These do not occupy the cook.
        for node in sorted(ready(), key=lambda n: (-levels[n.id], n.id)):
            if not _occupies_cook(node) and station_has_room(node):
                begin(node, now)

        cook_busy = any(_occupies_cook(nodes[r]) and end[r] > now for r in running)
        window_open = any(
            not _occupies_cook(nodes[r]) and start[r] <= now < end[r] for r in running
        )

        # (c) If the cook is free, start one ready hands-on node (§4.1.c). Freshness-
        #     constrained nodes are withheld until they are their consumer's last
        #     outstanding dependency (§4.5).
        if not cook_busy:
            candidates = [
                n
                for n in ready()
                if _occupies_cook(n) and station_has_room(n) and freshness_ready(n)
            ]
            if candidates:
                begin(_cook_choice(candidates, levels, window_open=window_open), now)

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
            start_min=_round(start[node_id]),
            end_min=_round(end[node_id]),
            occupies_cook=_occupies_cook(nodes[node_id]),
        )
        for node_id in nodes
    ]
    placed = {s.node_id: s for s in scheduled}

    # §4.4 — the post-timeline stage. Walk windows in (host start, host id) order; each
    # claims still-unclaimed hands-on nodes that ran fully inside its host's interval,
    # in §4.4 key order. A window claims a task only if it passes BOTH gates:
    #   1. typical packing:      used_typical + task.duration_typical <= capacity_min
    #   2. worst-case eligibility: task.duration_max            <= capacity_min
    # A task failing either gate is left for a later, roomier window. One task, one
    # window. A task no window can safely hold is just a serial step — not a warning.
    windows = derive_windows(graph, scheduled)
    claimed: set[str] = set()
    for window in windows:
        host = placed[window.host_node_id]
        inside = sorted(
            (
                s
                for s in scheduled
                if s.node_id != window.host_node_id
                and s.node_id not in claimed
                and _occupies_cook(nodes[s.node_id])
                and s.start_min >= host.start_min
                and s.end_min <= host.end_min
            ),
            key=lambda s: (-nodes[s.node_id].duration_typical, s.node_id),
        )
        used = 0.0
        for candidate in inside:
            node = nodes[candidate.node_id]
            typical = float(node.duration_typical)
            fits_typical = used + typical <= window.capacity_min
            safe_worst_case = node.duration_max <= window.capacity_min
            if fits_typical and safe_worst_case:
                window.assigned.append(candidate.node_id)
                claimed.add(candidate.node_id)
                used += typical
        window.assigned = rank_window_tasks(graph, window)
        window.used_min = _round(used)
        window.slack_min = _round(window.capacity_min - used)

    # An empty window is dead time, not a "while this cooks" opportunity. Drop it and
    # renumber so plan.windows only holds windows the UI would show.
    windows = [w for w in windows if w.assigned]
    for index, window in enumerate(windows, start=1):
        window.id = f"w{index}"
        for rank, node_id in enumerate(window.assigned):
            placed[node_id].window_id = window.id
            placed[node_id].rank_in_window = rank

    scheduled.sort(key=lambda s: (s.start_min, s.node_id))

    total = _round(max(end.values()))
    serial = _round(serial_minutes(graph))
    return CookingPlan(
        graph_id=graph.id,
        scheduled=scheduled,
        windows=windows,
        total_min=total,
        serial_min=serial,
        saved_min=_round(serial - total),
        critical_path=critical_path(graph, levels),
        warnings=check_plan(graph, scheduled, windows),
    )
