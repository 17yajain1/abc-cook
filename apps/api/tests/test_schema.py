"""The schema models are the contract; these tests keep them constructible and stable.

They deliberately assert nothing about scheduling — there is no scheduler yet.
"""

from datetime import UTC, datetime

from abc_cook.schema import (
    CookingGraph,
    CookingPlan,
    Ingredient,
    Node,
    ScheduledNode,
    SourceRef,
    Stage,
    WaitWindow,
)


def _graph() -> CookingGraph:
    """Build a two-node graph: chop an onion, then sauté it."""
    return CookingGraph(
        id="g_test",
        title="Test Recipe",
        servings=2,
        cuisine=None,
        source=SourceRef(kind="text", value="chop onion, saute", imported_at=datetime.now(UTC)),
        ingredients=[
            Ingredient(
                id="ing_onion",
                name="Onion",
                qty=2,
                unit="medium",
                prep_note="finely chopped",
                group=None,
            ),
        ],
        stages=[
            Stage(id="prep", label="Prep", color_key="prep"),
            Stage(id="cook_base", label="Cook the base", color_key="cook_base"),
        ],
        nodes=[
            Node(
                id="chop_onion",
                stage="prep",
                label="Chop onion",
                instruction="Finely chop the onions.",
                kind="prep",
                attention="hands_on",
                duration_min=2,
                duration_typical=3,
                duration_max=5,
                station="counter",
                consumes=["ing_onion"],
                produces="comp_onion",
                interruptible=True,
            ),
            Node(
                id="saute_onion",
                stage="cook_base",
                label="Sauté onion",
                instruction="Sauté the onions until light golden.",
                kind="finish",
                attention="hands_on",
                duration_min=4,
                duration_typical=5,
                duration_max=8,
                station="burner",
                depends_on=["chop_onion"],
                consumes=["comp_onion"],
                interruptible=False,
                doneness_cue="onions light golden, oil separating",
            ),
        ],
        stated_total_min=8,
    )


def test_graph_round_trips_through_json() -> None:
    graph = _graph()
    assert CookingGraph.model_validate_json(graph.model_dump_json()) == graph


def test_node_defaults_are_empty_not_shared() -> None:
    graph = _graph()
    chop, saute = graph.nodes
    assert chop.depends_on == []
    assert saute.depends_on == ["chop_onion"]
    assert chop.max_lead_min is None


def test_plan_round_trips_through_json() -> None:
    plan = CookingPlan(
        graph_id="g_test",
        scheduled=[
            ScheduledNode(node_id="chop_onion", start_min=0, end_min=3, occupies_cook=True),
            ScheduledNode(
                node_id="saute_onion",
                start_min=3,
                end_min=8,
                occupies_cook=True,
                window_id="w1",
                rank_in_window=0,
            ),
        ],
        windows=[
            WaitWindow(
                id="w1",
                host_node_id="chop_onion",
                capacity_min=2.7,
                assigned=["saute_onion"],
                used_min=2.0,
                slack_min=0.7,
            ),
        ],
        total_min=8,
        serial_min=8,
        saved_min=0,
        critical_path=["chop_onion", "saute_onion"],
    )
    assert CookingPlan.model_validate_json(plan.model_dump_json()) == plan
    assert plan.warnings == []


def test_json_schema_generates() -> None:
    """`make types` generates TS from these schemas, so they must be emittable."""
    for model in (CookingGraph, CookingPlan):
        assert model.model_json_schema()["title"] == model.__name__
