"""HTTP response envelopes. Part of the contract, so they live with the models.

TypeScript types are generated from these (`make types`); nothing here may be
hand-mirrored in `.ts`.
"""

from pydantic import BaseModel, Field

from abc_cook.schema.graph import CookingGraph
from abc_cook.schema.normalized import ImportResult, ImportStatus
from abc_cook.schema.plan import CookingPlan, StageSpan


class RecipeSummary(BaseModel):
    """One row in the recipe list."""

    id: str = Field(description="Slug used in the plan URL.")
    title: str = Field(description='Recipe title, e.g. "Kadai Paneer".')
    servings: int = Field(description="Servings the quantities are stated for.")


class RecipeListResponse(BaseModel):
    """Every recipe the API can currently serve."""

    recipes: list[RecipeSummary] = Field(description="Available recipes, by title.")


class RecipePlanResponse(BaseModel):
    """Everything the Plan view needs, in one round trip.

    The graph rides along because the plan is node *ids* and timings — the labels,
    instructions and ingredients the renderer draws all live on the graph. Shipping both
    keeps the frontend a pure renderer: it joins by id, and computes nothing.
    """

    graph: CookingGraph = Field(description="The graph the plan was scheduled from.")
    plan: CookingPlan = Field(description="The scheduled plan. Source of every number shown.")
    stages: list[StageSpan] = Field(
        description="Per-stage rollups, in `graph.stages` order. See schedule/rollup.py.",
    )


class ImportJobResponse(BaseModel):
    """`GET /import/{job_id}` — the client polls this (design doc §4.5).

    A separate envelope from `RecipePlanResponse`, which stays the frozen contract for
    the fixture path (design doc §9 decision 3).
    """

    job_id: str = Field(description="Id returned by `POST /import`.")
    status: ImportStatus = Field(description="Where the job is in the pipeline.")
    result: ImportResult | None = Field(
        default=None,
        description="Present once status is a terminal value (done / method_not_grounded).",
    )
    error: str | None = Field(default=None, description="Set when status is failed.")
