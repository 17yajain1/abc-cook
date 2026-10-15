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

from collections.abc import Iterable, Mapping

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


def _cook_ancestors(nodes: Mapping[str, Node]) -> dict[str, frozenset[str]]:
    """Map each node to every hands-on node it transitively depends on.

    Walks through unattended nodes too: a hands-on step behind a soak is still a
    prerequisite the cook must do first.
    """
    memo: dict[str, frozenset[str]] = {}

    def of(node_id: str) -> frozenset[str]:
        if node_id not in memo:
            found: set[str] = set()
            for dep in nodes[node_id].depends_on:
                found |= of(dep)
                if _occupies_cook(nodes[dep]):
                    found.add(dep)
            memo[node_id] = frozenset(found)
        return memo[node_id]

    return {node_id: of(node_id) for node_id in nodes}


def _drop_tasks_with_unclaimed_ancestors(
    assigned: Iterable[str],
    host_start: float,
    ancestors: Mapping[str, frozenset[str]],
    starts: Mapping[str, float],
) -> list[str]:
    """Keep only window tasks whose in-window cook prerequisites are also in the window.

    A task is dropped when a hands-on ancestor started at or after the host's start but
    is not in `assigned` (it failed a gate, or another window owns it). Dropping one task
    can orphan its consumers, so this repeats to a fixpoint. Ancestors that started
    before the host are the step the cook is already on and never cause a drop.

    Args:
        assigned: Node ids the window claimed, in claim order.
        host_start: Start minute of the window's host.
        ancestors: Hands-on transitive ancestors per node (`_cook_ancestors`).
        starts: Start minute per node id.

    Returns:
        The surviving ids, in their original order.
    """
    kept = list(assigned)
    while True:
        members = set(kept)
        survivors = [
            node_id
            for node_id in kept
            if all(
                anc in members
                for anc in ancestors[node_id]
                if starts[anc] >= host_start
            )
        ]
        if len(survivors) == len(kept):
            return kept
        kept = survivors


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


def _pan_chain_gates(
    nodes: dict[str, Node], consumers: dict[str, list[str]]
) -> dict[str, frozenset[str]]:
    """Gate each hot pan step on the rest of its pan chain (§4.1.c, §4.5).

    A hands-on burner step that feeds another burner step is part of a pan chain: its
    output stays in the pan. Running it early, in an unrelated wait window, would leave
    the pan sitting for the window's length. Such a step is "flagged" and is withheld
    until every node in its gate is done — the other inputs of the burner step(s) it
    feeds, recursively through flagged successors, minus anything downstream of itself.
    A step whose output leaves the pan (a consumer off the burner that is not a sink) is
    exempt.

    Known gap: the schema has no pan/vessel identity, so "same pan" is inferred from
    burner-step adjacency. Some safe overlaps (tadka poured in, then a short simmer) get
    serialised on purpose. The real fix is pan/vessel identity (PR-D / prompt v8).

    Args:
        nodes: Every node by id.
        consumers: For each node id, the ids that depend on it.

    Returns:
        Gate per flagged node id. Unflagged nodes are absent.
    """
    def burner_succ(node_id: str) -> list[str]:
        return [c for c in consumers.get(node_id, []) if nodes[c].station == "burner"]

    def flagged(node: Node) -> bool:
        if node.attention != "hands_on" or node.station != "burner":
            return False
        if not burner_succ(node.id):
            return False
        return not any(
            nodes[c].station != "burner" and consumers.get(c)
            for c in consumers.get(node.id, [])
        )

    def descendants(node_id: str) -> set[str]:
        seen: set[str] = set()
        stack = list(consumers.get(node_id, []))
        while stack:
            current = stack.pop()
            if current not in seen:
                seen.add(current)
                stack.extend(consumers.get(current, []))
        return seen

    gates: dict[str, frozenset[str]] = {}

    def gate(node_id: str) -> frozenset[str]:
        if node_id in gates:
            return gates[node_id]
        members: set[str] = set()
        for succ_id in burner_succ(node_id):
            members.update(set(nodes[succ_id].depends_on) - {node_id})
            if flagged(nodes[succ_id]):
                members.update(gate(succ_id))
        members -= descendants(node_id) | {node_id}
        gates[node_id] = frozenset(members)
        return gates[node_id]

    for node in nodes.values():
        if flagged(node):
            gate(node.id)
    return {k: v for k, v in gates.items() if flagged(nodes[k])}


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

    pan_gates = _pan_chain_gates(nodes, consumers)

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

    def pan_ready(node: Node) -> bool:
        """Withhold a pan-chain step until the rest of its chain's inputs are done."""
        return all(dep in done for dep in pan_gates.get(node.id, ()))

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
        #     outstanding dependency (§4.5), and pan-chain steps until their chain's
        #     other inputs are done (`_pan_chain_gates`).
        if not cook_busy:
            eligible = [
                n
                for n in ready()
                if _occupies_cook(n) and station_has_room(n) and freshness_ready(n)
            ]
            candidates = [n for n in eligible if pan_ready(n)]
            # Deadlock valve: two pan steps feeding one burner step gate each other. If
            # the cook is free, nothing is running and only pan-withheld steps remain,
            # release the gate for this pick.
            if not candidates and eligible and not any(end[r] > now for r in running):
                candidates = eligible
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
    # in §4.4 key order (longest first). The claimed set is then re-ranked by start_min
    # so rank 0 is the task the cook actually starts first. A window claims a task only
    # if it passes BOTH gates:
    #   1. typical packing:      used_typical + task.duration_typical <= capacity_min
    #   2. worst-case eligibility: task.duration_max            <= capacity_min
    # A task failing either gate is left for a later, roomier window. One task, one
    # window. A task no window can safely hold is just a serial step — not a warning.
    #   3. closure: a window keeps a task only if every hands-on ancestor that started at
    #      or after the host's start is in the same window (to a fixpoint). Otherwise the
    #      list would name a task whose prerequisite is not on the card. A dropped task
    #      is released for later windows; freed capacity is not re-packed.
    windows = derive_windows(graph, scheduled)
    ancestors = _cook_ancestors(nodes)
    starts = {s.node_id: s.start_min for s in scheduled}
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
        kept = _drop_tasks_with_unclaimed_ancestors(
            window.assigned, host.start_min, ancestors, starts
        )
        for node_id in set(window.assigned) - set(kept):
            claimed.discard(node_id)
            used -= float(nodes[node_id].duration_typical)
        window.assigned = kept
        window.assigned = rank_window_tasks(window, starts)
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
