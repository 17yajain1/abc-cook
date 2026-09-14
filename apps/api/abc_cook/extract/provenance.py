"""Computes `GraphProvenance` from `graph.py`'s verified decisions.

See docs/M2.9-youtube-import-design.md §5 ("Where confidence/provenance lives") and
LOCKED DECISION 8: provenance is computed from the verified graph semantics graph.py
already worked out — never by copying an LLM self-report. This module does not
re-derive attention/duration/freshness itself (that would duplicate graph.py's
verification and risk it drifting out of sync); it assembles the `NodeDecision`s
`build_graph` already produced into the sibling `GraphProvenance` record.

Deliberately not a field on `Node` — `Node` and the golden fixtures stay untouched.
"""

from __future__ import annotations

from abc_cook.extract.graph import GraphBuildResult
from abc_cook.schema.normalized import GraphProvenance, NodeProvenance


def compute_provenance(build_result: GraphBuildResult) -> GraphProvenance:
    """Assemble a `GraphProvenance` from a completed `GraphBuildResult`.

    Args:
        build_result: The output of `graph.build_graph`. Must have `.graph` set —
            there is nothing to attach provenance to for a Tier 0 refusal.

    Returns:
        One `NodeProvenance` entry per node in `build_result.graph.nodes`.
    """
    nodes: dict[str, NodeProvenance] = {}
    for decision in build_result.node_decisions:
        nodes[decision.node_id] = NodeProvenance(
            fields={
                "attention": decision.attention_source,
                "duration": decision.duration_source,
                "depends_on_previous": decision.depends_on_previous_source,
            },
            freshness=decision.freshness,
            freshness_cue=decision.freshness_cue,
        )
    return GraphProvenance(nodes=nodes)
