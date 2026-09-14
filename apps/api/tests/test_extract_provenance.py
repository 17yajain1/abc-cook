"""extract/provenance.py -- assembling GraphProvenance from graph.py's decisions.

LOCKED DECISION 8: provenance reflects the verified graph semantics graph.py already
computed, never a copy of the LLM's self-report. These tests check the assembly
itself; the verification logic they're assembled from is tested in
test_extract_graph.py.
"""

from __future__ import annotations

from datetime import UTC, datetime

from abc_cook.extract.graph import build_graph
from abc_cook.extract.provenance import compute_provenance
from abc_cook.schema.graph import SourceRef
from abc_cook.schema.normalized import NormalizedIngredient, NormalizedRecipe, NormalizedStep

SOURCE = SourceRef(kind="url", value="https://youtu.be/test", imported_at=datetime.now(UTC))


def _step(**overrides: object) -> NormalizedStep:
    defaults: dict[str, object] = {
        "text": "Do something.",
        "attention": "hands_on",
        "duration_stated": False,
        "station": "counter",
        "interruptible": True,
        "freshness": "none",
    }
    defaults.update(overrides)
    return NormalizedStep(**defaults)  # type: ignore[arg-type]


def _recipe(steps: list[NormalizedStep]) -> NormalizedRecipe:
    return NormalizedRecipe(
        title="Test",
        method_grounded=True,
        ingredients=[NormalizedIngredient(name="Onion", qty="1", unit=None, prep_note=None)],
        steps=steps,
    )


def test_every_node_gets_a_provenance_entry() -> None:
    steps = [
        _step(text="Chop the onion.", consumes_ingredients=["Onion"]),
        _step(text="Cook and serve."),
    ]
    result = build_graph(
        _recipe(steps), "Chop the onion. Cook and serve.", graph_id="g", source=SOURCE
    )
    assert result.graph is not None
    provenance = compute_provenance(result)
    assert set(provenance.nodes.keys()) == {node.id for node in result.graph.nodes}


def test_defaulted_attention_distinguishable_from_extracted() -> None:
    """A defaulted hands_on (no cue existed) must be distinguishable from an
    extracted hands_on -- design doc §5, "the distinction the owner asked for"."""
    source_text = "Simmer covered for 10 minutes, stirring occasionally. Serve."
    steps = [
        _step(
            text="Simmer covered for 10 minutes, stirring occasionally.",
            attention="periodic",
            attention_cue="stirring occasionally",
        ),
        _step(text="Chop garnish.", attention="unattended", attention_cue="not in source"),
        _step(text="Serve."),
    ]
    result = build_graph(_recipe(steps), source_text, graph_id="g", source=SOURCE)
    assert result.graph is not None
    provenance = compute_provenance(result)
    node_ids = [node.id for node in result.graph.nodes]

    verified_periodic = provenance.nodes[node_ids[0]]
    assert verified_periodic.fields["attention"] == "extracted"

    forced_hands_on = provenance.nodes[node_ids[1]]
    assert forced_hands_on.fields["attention"] == "defaulted"


def test_freshness_carried_on_provenance_not_just_fields_dict() -> None:
    source_text = "Add cream just before serving. Serve hot."
    steps = [
        _step(
            text="Add cream just before serving.",
            freshness="stated_unbounded",
            freshness_cue="just before serving",
        ),
        _step(text="Serve hot."),
    ]
    result = build_graph(_recipe(steps), source_text, graph_id="g", source=SOURCE)
    assert result.graph is not None
    provenance = compute_provenance(result)
    node_id = result.graph.nodes[0].id
    assert provenance.nodes[node_id].freshness == "stated_unbounded"
    assert provenance.nodes[node_id].freshness_cue == "just before serving"
