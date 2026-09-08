"""Recipe listing and plan endpoints.

M2 has no importer and no database, so the golden fixtures are the data source
(ROADMAP M2). Everything below reads them off disk and runs the real scheduler — the
plan the phone renders is computed, never canned.
"""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from abc_cook.schedule import schedule, stage_spans
from abc_cook.schema import (
    CookingGraph,
    RecipeListResponse,
    RecipePlanResponse,
    RecipeSummary,
)

router = APIRouter(tags=["recipes"])

RECIPE_DIR = Path(__file__).resolve().parents[3] / "tests" / "fixtures"
"""Where recipe graphs are read from.

TEMPORARY (M2 only). The wheel built by `hatch` packages `abc_cook/` and not `tests/`,
so this path does not survive deployment. M5 replaces it with Supabase; until then the
fixtures are the only recipes that exist and pointing at them beats duplicating them.
"""

DEFAULT_BURNER_CAPACITY = 1
"""Burners assumed when a recipe carries no kitchen sidecar. See COOKING_GRAPH.md §4.6."""


def _read_json(path: Path) -> Any:
    """Read and parse a UTF-8 JSON file."""
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _slugs() -> tuple[str, ...]:
    """List the recipe slugs on disk, sorted.

    Returns:
        Slugs derived from `<slug>.graph.json` filenames.
    """
    return tuple(
        sorted(p.name.removesuffix(".graph.json") for p in RECIPE_DIR.glob("*.graph.json")),
    )


def load_graph(slug: str) -> CookingGraph:
    """Load and validate one recipe graph.

    Args:
        slug: Recipe id, e.g. `"kadai-paneer"`.

    Returns:
        The parsed graph.

    Raises:
        FileNotFoundError: If no graph exists for `slug`.
    """
    path = RECIPE_DIR / f"{slug}.graph.json"
    if not path.is_file():
        msg = f"no recipe graph for {slug!r}"
        raise FileNotFoundError(msg)
    return CookingGraph.model_validate(_read_json(path))


def burner_capacity_for(slug: str) -> int:
    """Read a recipe's kitchen sidecar, if it has one.

    Burner count is a property of the kitchen, not the recipe (COOKING_GRAPH.md §4.6),
    so it is not in the graph. `chicken-biryani` needs two; everything else runs at one.

    Args:
        slug: Recipe id.

    Returns:
        Burners the scheduler may use concurrently.
    """
    path = RECIPE_DIR / f"{slug}.kitchen.json"
    if not path.is_file():
        return DEFAULT_BURNER_CAPACITY
    value = _read_json(path).get("burner_capacity", DEFAULT_BURNER_CAPACITY)
    return int(value)


@router.get("/recipes")
async def list_recipes() -> RecipeListResponse:
    """List every recipe the API can serve.

    Returns:
        Recipe summaries, sorted by title.
    """
    summaries = [
        RecipeSummary(id=slug, title=graph.title, servings=graph.servings)
        for slug, graph in ((slug, load_graph(slug)) for slug in _slugs())
    ]
    summaries.sort(key=lambda r: r.title)
    return RecipeListResponse(recipes=summaries)


@router.get("/recipes/{recipe_id}/plan")
async def get_recipe_plan(recipe_id: str) -> RecipePlanResponse:
    """Schedule a recipe and return everything the Plan view renders.

    Args:
        recipe_id: Recipe slug from `GET /recipes`.

    Returns:
        The graph, its scheduled plan, and per-stage rollups.

    Raises:
        HTTPException: 404 when no recipe matches `recipe_id`.
    """
    try:
        graph = load_graph(recipe_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown recipe {recipe_id!r}") from exc

    plan = schedule(graph, burner_capacity=burner_capacity_for(recipe_id))
    return RecipePlanResponse(graph=graph, plan=plan, stages=stage_spans(graph, plan))
