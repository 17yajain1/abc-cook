"""The recipe endpoints serve real scheduled plans.

These exist to prove the wiring, not to re-test the scheduler: that the route reaches
the fixtures, honours the kitchen sidecar, and hands the frontend every number it needs
so no `.tsx` file has to compute one.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from abc_cook.api.main import create_app
from abc_cook.schema import RecipeListResponse, RecipePlanResponse

FIXTURES = Path(__file__).parent / "fixtures"

GOLDEN = [
    "kadai-paneer",
    "maggi-2min",
    "chicken-biryani",
    "homemade-donuts",
    "strawberry-shortcake",
    "synthetic-two-windows",
]


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


@pytest.fixture(params=GOLDEN)
def slug(request: pytest.FixtureRequest) -> str:
    return str(request.param)


def test_lists_every_fixture(client: TestClient) -> None:
    response = client.get("/recipes")
    assert response.status_code == 200

    listing = RecipeListResponse.model_validate(response.json())
    assert sorted(r.id for r in listing.recipes) == sorted(GOLDEN)
    assert [r.title for r in listing.recipes] == sorted(r.title for r in listing.recipes)


def test_plan_is_served_and_valid(client: TestClient, slug: str) -> None:
    response = client.get(f"/recipes/{slug}/plan")
    assert response.status_code == 200

    payload = RecipePlanResponse.model_validate(response.json())
    assert payload.graph.id == slug
    assert payload.plan.graph_id == slug
    assert len(payload.plan.scheduled) == len(payload.graph.nodes)
    assert payload.stages, "the Plan view needs at least one stage span"


def test_plan_matches_the_golden_fixture(client: TestClient, slug: str) -> None:
    """The route must not diverge from the plan the golden fixtures pin down."""
    expected = json.loads((FIXTURES / f"{slug}.plan.json").read_text(encoding="utf-8"))
    served = client.get(f"/recipes/{slug}/plan").json()["plan"]
    assert served == expected


def test_unknown_recipe_is_404(client: TestClient) -> None:
    response = client.get("/recipes/not-a-recipe/plan")
    assert response.status_code == 404


def test_kadai_paneer_carries_the_numbers_the_ui_shows(client: TestClient) -> None:
    """The design copy "9 min prep · fits in 12 min" must fall out of the payload."""
    payload = RecipePlanResponse.model_validate(client.get("/recipes/kadai-paneer/plan").json())

    assert (payload.plan.total_min, payload.plan.serial_min, payload.plan.saved_min) == (
        34.0,
        43.0,
        9.0,
    )

    window = payload.plan.windows[0]
    host = next(n for n in payload.graph.nodes if n.id == window.host_node_id)
    assert window.used_min == 9.0
    assert host.duration_typical == 12

    first = next(s for s in payload.plan.scheduled if s.rank_in_window == 0)
    assert first.node_id == "chop_capsicum"


def test_chicken_biryani_honours_its_kitchen_sidecar(client: TestClient) -> None:
    """burner_capacity=2 lives in a sidecar, not the graph (COOKING_GRAPH.md §4.6).

    Without it the route would silently schedule at one burner and produce a different,
    longer plan — so the warning is the proof the sidecar was read.
    """
    payload = RecipePlanResponse.model_validate(client.get("/recipes/chicken-biryani/plan").json())
    assert "uses 2 burners" in " ".join(payload.plan.warnings)


def test_stage_spans_align_with_the_graph(client: TestClient, slug: str) -> None:
    payload = RecipePlanResponse.model_validate(client.get(f"/recipes/{slug}/plan").json())

    stage_ids = {s.id for s in payload.graph.stages}
    listed = [node_id for span in payload.stages for node_id in span.node_ids]

    assert {span.stage_id for span in payload.stages} <= stage_ids
    assert sorted(listed) == sorted(n.id for n in payload.graph.nodes)
