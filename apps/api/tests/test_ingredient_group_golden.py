"""D3 on a real import: the sabudana golden's `consumes` and edges match what the code derives.

The golden `sabudana-khichdi.graph.json` is a frozen graph (no LLM, no `NormalizedRecipe`
to rebuild it from), so its `consumes` are checked against the resolver run over the
pre-D3 graph kept in `docs/investigations/`, and its one hand-visible edge change is
checked against the rule that derives it (the same-burner guard) on a synthetic recipe.
Fixture names live here, in tests, never in logic.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from abc_cook.extract.graph import _resolve_step_ingredient_ids, build_graph
from abc_cook.schema import CookingGraph
from abc_cook.schema.graph import SourceRef
from abc_cook.schema.normalized import NormalizedIngredient, NormalizedRecipe, NormalizedStep

_ROOT = Path(__file__).resolve().parents[3]
_GOLDEN = Path(__file__).parent / "fixtures" / "sabudana-khichdi.graph.json"
_PRE_D3 = _ROOT / "docs" / "investigations" / "sabudana-2026-10-13.library.json"

_SOURCE = SourceRef(kind="url", value="https://example.test", imported_at=datetime.now(UTC))


def _golden() -> CookingGraph:
    return CookingGraph.model_validate_json(_GOLDEN.read_text(encoding="utf-8"))


def _pre_d3() -> dict[str, Any]:
    data = json.loads(_PRE_D3.read_text(encoding="utf-8"))
    graph: dict[str, Any] = data["recipes"][0]["payload"]["graph"]
    return graph


def test_golden_consumes_equal_the_resolver_over_the_pre_d3_graph() -> None:
    """(c) Ingredient ids per node equal the resolver's output; component ids are untouched."""
    pre = _pre_d3()
    name_of = {i["id"]: i["name"] for i in pre["ingredients"]}
    group_of = {i["id"]: i.get("group") for i in pre["ingredients"]}
    name_to_ids: dict[str, list[str]] = {}
    for ingredient in pre["ingredients"]:
        name_to_ids.setdefault(ingredient["name"].lower(), []).append(ingredient["id"])
    step_names = [[name_of[c] for c in n["consumes"] if c in name_of] for n in pre["nodes"]]
    resolved = _resolve_step_ingredient_ids(step_names, name_to_ids, group_of)

    golden = _golden()
    assert [n.id for n in golden.nodes] == [n["id"] for n in pre["nodes"]]
    for node, pre_node, expected in zip(golden.nodes, pre["nodes"], resolved, strict=True):
        assert [c for c in node.consumes if c in name_of] == expected, node.id
        assert [c for c in node.consumes if c not in name_of] == [
            c for c in pre_node["consumes"] if c not in name_of
        ], node.id


def test_golden_every_ingredient_is_still_consumed() -> None:
    golden = _golden()
    consumed = {c for node in golden.nodes for c in node.consumes}
    assert all(i.id in consumed for i in golden.ingredients)


def test_golden_hot_pan_step_shares_no_resolved_id_with_the_chutney_step() -> None:
    """(b) The false edge is gone: the two steps share no ingredient id, and the pan step's
    only dependency is the last earlier step on the same burner."""
    golden = _golden()
    by_id = {n.id: n for n in golden.nodes}
    ingredient_ids = {i.id for i in golden.ingredients}
    temper = by_id["step_heat_ghee_or_oil_in_a"]
    chutney = by_id["step_for_the_green_chutney_in_a"]
    assert (set(temper.consumes) & set(chutney.consumes)) & ingredient_ids == set()

    position = {n.id: k for k, n in enumerate(golden.nodes)}
    earlier_burner = [
        n.id
        for n in golden.nodes
        if n.station == temper.station and position[n.id] < position[temper.id]
    ]
    assert temper.station == "burner"
    assert temper.depends_on == [earlier_burner[-1]]
    assert chutney.id not in temper.depends_on


def test_same_burner_guard_derives_the_pan_step_edge_once_the_false_edge_is_gone() -> None:
    """(a) The rule behind that edge, on a synthetic recipe: a burner step with an empty
    claim that shares no resolved id with the intervening counter step still waits for the
    last earlier burner step, and does not depend on the counter step."""

    def ing(name: str, group: str | None = None) -> NormalizedIngredient:
        return NormalizedIngredient(name=name, qty="1", unit="tsp", prep_note=None, group=group)

    def step(
        text: str, station: str, claim: list[int], *consumes: str, produces: str | None = None
    ) -> NormalizedStep:
        return NormalizedStep(
            text=text,
            attention="hands_on",
            duration_stated=False,
            station=station,  # type: ignore[arg-type]
            interruptible=False,
            freshness="none",
            consumes_ingredients=list(consumes),
            depends_on_steps=claim,
            produces_component=produces,
        )

    recipe = NormalizedRecipe(
        title="Synthetic",
        method_grounded=True,
        servings=2,
        ingredients=[
            ing("Rice"),
            ing("Cumin"),
            ing("Onion"),
            ing("Cumin", "Chutney"),
            ing("Mint", "Chutney"),
        ],
        steps=[
            step("Toast the rice.", "burner", [], "Rice"),
            # A named product makes this a branch boundary, so the guard edge's descendant
            # closure stops here instead of pulling the counter step in.
            step("Chop cumin and onion.", "counter", [0], "Cumin", "Onion", produces="Spice mix"),
            step("Crackle cumin with mint.", "burner", [], "Cumin", "Mint"),
            step("Serve everything.", "counter", [0, 1, 2], "Spice mix"),
        ],
    )
    result = build_graph(
        recipe, "Toast the rice. Chop cumin and onion. Crackle cumin with mint. Serve.",
        graph_id="g_synthetic", source=_SOURCE,
    )
    assert result.graph is not None
    toast, chop, crackle, _serve = result.graph.nodes
    assert crackle.depends_on == [toast.id]
    assert chop.id not in crackle.depends_on
    assert any("uses the same burner" in w for w in result.warnings)
