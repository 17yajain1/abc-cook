"""Graph invariants — the hard gates every extracted `CookingGraph` must pass.

See docs/COOKING_GRAPH.md §5. These are gates, not warnings (that doc's own words):
"On failure: one repair pass ... If it fails again, degrade to a linear chain". This
module only detects violations; `repair.py` and the Tier 1 degrade path decide what to
do with them.

Pure and offline: no I/O, no network, no LLM call. Every golden fixture under
`tests/fixtures/*.graph.json` must pass `validate()` unchanged — see
`tests/test_extract_validate.py`.
"""

from __future__ import annotations

from dataclasses import dataclass

from abc_cook.schema.graph import CookingGraph
from abc_cook.schema.node import Node


@dataclass(frozen=True)
class Violation:
    """One broken invariant.

    Attributes:
        rule: Short, stable id for the invariant, e.g. "acyclic". Machine-checkable.
        message: Human-readable detail, for the repair pass and for logs.
    """

    rule: str
    message: str


def validate(graph: CookingGraph) -> list[Violation]:
    """Check `graph` against every docs/COOKING_GRAPH.md §5 invariant.

    Args:
        graph: The graph to check. Never mutated.

    Returns:
        Every violation found, in invariant order. An empty list means `graph` is safe
        to schedule.
    """
    nodes_by_id = {node.id: node for node in graph.nodes}
    stage_ids = {stage.id for stage in graph.stages}

    violations: list[Violation] = []
    violations += _check_depends_on_exist(graph, nodes_by_id)
    violations += _check_acyclic(graph)
    violations += _check_single_finish_sink(graph)
    violations += _check_no_orphans(graph, nodes_by_id)
    violations += _check_ingredients_consumed(graph)
    violations += _check_produces_consumed(graph, nodes_by_id)
    violations += _check_duration_ordering(graph)
    violations += _check_stated_total(graph)
    violations += _check_unattended_kind(graph)
    violations += _check_stage_refs(graph, stage_ids)
    return violations


def _check_depends_on_exist(graph: CookingGraph, nodes_by_id: dict[str, Node]) -> list[Violation]:
    """Invariant 1: every `depends_on` id refers to a real node."""
    violations = []
    for node in graph.nodes:
        for dep in node.depends_on:
            if dep not in nodes_by_id:
                violations.append(
                    Violation(
                        "depends_on_exists",
                        f'Node "{node.id}" depends_on unknown node "{dep}".',
                    )
                )
    return violations


def _check_acyclic(graph: CookingGraph) -> list[Violation]:
    """Invariant 2: the dependency graph is acyclic (a topological sort succeeds)."""
    indegree = {node.id: 0 for node in graph.nodes}
    dependents: dict[str, list[str]] = {node.id: [] for node in graph.nodes}
    for node in graph.nodes:
        for dep in node.depends_on:
            if dep in indegree:
                indegree[node.id] += 1
                dependents[dep].append(node.id)

    queue = [node_id for node_id, degree in indegree.items() if degree == 0]
    visited = 0
    while queue:
        current = queue.pop()
        visited += 1
        for dependent in dependents[current]:
            indegree[dependent] -= 1
            if indegree[dependent] == 0:
                queue.append(dependent)

    if visited != len(graph.nodes):
        return [
            Violation(
                "acyclic",
                "The dependency graph contains a cycle; topological sort could not "
                "visit every node.",
            )
        ]
    return []


def _sinks(graph: CookingGraph) -> list[Node]:
    """Nodes nothing else depends on."""
    depended_upon = {dep for node in graph.nodes for dep in node.depends_on}
    return [node for node in graph.nodes if node.id not in depended_upon]


def _check_single_finish_sink(graph: CookingGraph) -> list[Violation]:
    """Invariant 3: exactly one sink node, and it is `kind == "finish"`."""
    sinks = _sinks(graph)
    if len(sinks) != 1:
        ids = ", ".join(node.id for node in sinks) or "none"
        return [
            Violation(
                "single_finish_sink",
                f"Expected exactly one sink node, found {len(sinks)}: {ids}.",
            )
        ]
    sink = sinks[0]
    if sink.kind != "finish":
        return [
            Violation(
                "single_finish_sink",
                f'Sink node "{sink.id}" has kind "{sink.kind}", expected "finish".',
            )
        ]
    return []


def _check_no_orphans(graph: CookingGraph, nodes_by_id: dict[str, Node]) -> list[Violation]:
    """Invariant 4: every node is reachable from some source and reaches the sink."""
    if not graph.nodes:
        return [Violation("no_orphans", "Graph has no nodes.")]

    sources = [node.id for node in graph.nodes if not node.depends_on]
    dependents: dict[str, list[str]] = {node.id: [] for node in graph.nodes}
    for node in graph.nodes:
        for dep in node.depends_on:
            if dep in dependents:
                dependents[dep].append(node.id)

    reachable_from_source: set[str] = set()
    stack = list(sources)
    while stack:
        node_id = stack.pop()
        if node_id in reachable_from_source:
            continue
        reachable_from_source.add(node_id)
        stack.extend(dependents.get(node_id, []))

    violations = []
    unreached = [node.id for node in graph.nodes if node.id not in reachable_from_source]
    if unreached:
        violations.append(
            Violation(
                "no_orphans",
                f"Nodes not reachable from any source: {', '.join(unreached)}.",
            )
        )

    sinks = _sinks(graph)
    if len(sinks) == 1:
        sink_id = sinks[0].id
        can_reach_sink: set[str] = {sink_id}
        stack = [sink_id]
        while stack:
            node_id = stack.pop()
            current = nodes_by_id.get(node_id)
            if current is None:
                continue
            for dep in current.depends_on:
                if dep not in can_reach_sink:
                    can_reach_sink.add(dep)
                    stack.append(dep)
        cannot_reach = [node.id for node in graph.nodes if node.id not in can_reach_sink]
        if cannot_reach:
            violations.append(
                Violation(
                    "no_orphans",
                    f"Nodes that never reach the sink: {', '.join(cannot_reach)}.",
                )
            )
    return violations


def _check_ingredients_consumed(graph: CookingGraph) -> list[Violation]:
    """Invariant 5: every non-optional ingredient is consumed by >= 1 node."""
    consumed = {c for node in graph.nodes for c in node.consumes}
    violations = []
    for ingredient in graph.ingredients:
        if ingredient.optional:
            continue
        if ingredient.id not in consumed:
            violations.append(
                Violation(
                    "ingredients_consumed",
                    f'Ingredient "{ingredient.id}" ({ingredient.name}) is not consumed '
                    "by any node.",
                )
            )
    return violations


def _depends_transitively(
    node: Node, target_id: str, nodes_by_id: dict[str, Node], seen: set[str]
) -> bool:
    """Whether `node` depends on `target_id`, directly or through other nodes."""
    for dep in node.depends_on:
        if dep == target_id:
            return True
        if dep in seen:
            continue
        seen.add(dep)
        dep_node = nodes_by_id.get(dep)
        if dep_node is not None and _depends_transitively(dep_node, target_id, nodes_by_id, seen):
            return True
    return False


def _check_produces_consumed(
    graph: CookingGraph, nodes_by_id: dict[str, Node]
) -> list[Violation]:
    """Invariant 6: every `produces` component id is consumed by a downstream node."""
    violations = []
    for node in graph.nodes:
        if node.produces is None:
            continue
        consumers = [other for other in graph.nodes if node.produces in other.consumes]
        if not consumers:
            violations.append(
                Violation(
                    "produces_consumed",
                    f'Node "{node.id}" produces "{node.produces}", which no node consumes.',
                )
            )
            continue
        is_downstream = any(
            _depends_transitively(consumer, node.id, nodes_by_id, set())
            for consumer in consumers
        )
        if not is_downstream:
            violations.append(
                Violation(
                    "produces_consumed",
                    f'Node "{node.id}" produces "{node.produces}", but no consumer '
                    "depends on it, directly or transitively.",
                )
            )
    return violations


def _check_duration_ordering(graph: CookingGraph) -> list[Violation]:
    """Invariant 7: `duration_min <= duration_typical <= duration_max`, all > 0."""
    violations = []
    for node in graph.nodes:
        if node.duration_min <= 0 or node.duration_typical <= 0 or node.duration_max <= 0:
            violations.append(
                Violation("duration_ordering", f'Node "{node.id}" has a non-positive duration.')
            )
            continue
        if not (node.duration_min <= node.duration_typical <= node.duration_max):
            violations.append(
                Violation(
                    "duration_ordering",
                    f'Node "{node.id}" durations are not min <= typical <= max '
                    f"({node.duration_min} <= {node.duration_typical} <= {node.duration_max}).",
                )
            )
    return violations


def _check_stated_total(graph: CookingGraph) -> list[Violation]:
    """Invariant 8: serial time within 40% of any stated total."""
    if graph.stated_total_min is None:
        return []
    serial_min = sum(node.duration_typical for node in graph.nodes)
    allowed = 0.4 * graph.stated_total_min
    if abs(serial_min - graph.stated_total_min) > allowed:
        return [
            Violation(
                "stated_total_min",
                f"Serial time {serial_min} min is too far from the stated total "
                f"{graph.stated_total_min} min (allowed drift +/-{allowed:.1f} min).",
            )
        ]
    return []


def _check_unattended_kind(graph: CookingGraph) -> list[Violation]:
    """Invariant 9: `attention == "unattended"` implies `kind in {"passive", "prep"}`."""
    violations = []
    for node in graph.nodes:
        if node.attention == "unattended" and node.kind not in ("passive", "prep"):
            violations.append(
                Violation(
                    "unattended_kind",
                    f'Node "{node.id}" is "unattended" but kind is "{node.kind}", '
                    'expected "passive" or "prep".',
                )
            )
    return violations


def _check_stage_refs(graph: CookingGraph, stage_ids: set[str]) -> list[Violation]:
    """Invariant 10: every node's `stage` exists in `graph.stages`."""
    violations = []
    for node in graph.nodes:
        if node.stage not in stage_ids:
            violations.append(
                Violation(
                    "stage_refs",
                    f'Node "{node.id}" references unknown stage "{node.stage}".',
                )
            )
    return violations
