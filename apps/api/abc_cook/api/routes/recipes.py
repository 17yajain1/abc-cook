"""Recipe listing and plan endpoints.

M2 has no importer and no database, so the golden fixtures are the data source
(ROADMAP M2). Everything below reads them off disk and runs the real scheduler — the
plan the phone renders is computed, never canned.
"""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from abc_cook.extract.postprocess import reprocess
from abc_cook.schedule import schedule, stage_spans, summarize
from abc_cook.schema import (
    CookingGraph,
    ImportMeta,
    RecipeListResponse,
    RecipePlanResponse,
    RecipeSummary,
    ReprocessRequest,
    ReprocessResponse,
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
        RecipeSummary(
            id=slug,
            title=graph.title,
            servings=graph.servings,
            servings_stated=graph.servings_stated,
            yield_text=graph.yield_text,
        )
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

    capacity = burner_capacity_for(recipe_id)
    plan = schedule(graph, burner_capacity=capacity)
    return RecipePlanResponse(
        graph=graph,
        plan=plan,
        stages=stage_spans(graph, plan),
        summary=summarize(graph, plan, burner_capacity=capacity),
    )


MAX_REPROCESS_BODY_BYTES = 512 * 1024
"""Request-body cap for `POST /recipes/reprocess`. The largest real input is bounded by
the transcript cap (`TRANSCRIPT_CHAR_CAP`) plus description, blog text and the normalized
recipe -- far under this; the headroom is for growth, the cap is for abuse."""

MAX_REPROCESS_SOURCE_CHARS = 100_000
MAX_REPROCESS_STEPS = 200
MAX_REPROCESS_INGREDIENTS = 300


async def _read_capped_body(request: Request) -> bytes:
    """Read the request body, refusing anything over `MAX_REPROCESS_BODY_BYTES`.

    A declared `Content-Length` over the cap is refused before a byte is read; the stream
    is also length-limited as it is read, so a missing or lying header cannot get past it.

    Raises:
        HTTPException: 400 on an unparseable `Content-Length`, 413 over the cap.
    """
    too_large = HTTPException(
        status_code=413, detail=f"Body exceeds {MAX_REPROCESS_BODY_BYTES} bytes."
    )
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            declared_bytes = int(declared)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Bad Content-Length.") from exc
        if declared_bytes > MAX_REPROCESS_BODY_BYTES:
            raise too_large
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_REPROCESS_BODY_BYTES:
            raise too_large
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/recipes/reprocess")
async def reprocess_recipe(request: Request) -> ReprocessResponse:
    """Rebuild a saved recipe's graph and plan from its stored import inputs.

    Pure CPU: no acquire, no LLM, no I/O. The body is read by hand (not as a typed
    parameter) so the size cap applies before any parsing.

    Args:
        request: A `ReprocessRequest` JSON body.

    Returns:
        The rebuilt payload, its `ImportMeta`, and the `POSTPROCESS_VERSION` stamp.

    Raises:
        HTTPException: 413 over the body cap, 422 on a malformed body or a field over
            its cap (`source_text`, steps, ingredients), or on an original that yields
            no plan.
    """
    body = await _read_capped_body(request)
    try:
        original = ReprocessRequest.model_validate_json(body).original
    except ValidationError as exc:
        raise HTTPException(
            status_code=422, detail=json.loads(exc.json(include_url=False, include_context=False))
        ) from exc

    if len(original.source_text) > MAX_REPROCESS_SOURCE_CHARS:
        raise HTTPException(status_code=422, detail="source_text is too long.")
    if len(original.recipe.steps) > MAX_REPROCESS_STEPS:
        raise HTTPException(status_code=422, detail="Too many steps.")
    if len(original.recipe.ingredients) > MAX_REPROCESS_INGREDIENTS:
        raise HTTPException(status_code=422, detail="Too many ingredients.")

    result = reprocess(original).result
    if (
        result.status != "done"
        or result.graph is None
        or result.plan is None
        or result.stages is None
        or result.postprocess_version is None
    ):
        raise HTTPException(status_code=422, detail="This recipe has no plan to rebuild.")
    return ReprocessResponse(
        payload=RecipePlanResponse(
            graph=result.graph, plan=result.plan, stages=result.stages, summary=result.summary
        ),
        import_meta=ImportMeta(
            warnings=result.warnings,
            review_recommended=result.review_recommended,
            sources=result.sources,
            provenance=result.provenance,
            degraded="degraded" in result.warnings,
        ),
        postprocess_version=result.postprocess_version,
    )
