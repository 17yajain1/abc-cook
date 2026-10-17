"""HTTP response envelopes. Part of the contract, so they live with the models.

TypeScript types are generated from these (`make types`); nothing here may be
hand-mirrored in `.ts`.
"""

from pydantic import BaseModel, Field

from abc_cook.schema.graph import CookingGraph
from abc_cook.schema.normalized import (
    ImportMeta,
    ImportOriginal,
    ImportResult,
    ImportStatus,
    NormalizedIngredient,
    SourcePreview,
)
from abc_cook.schema.plan import CookingPlan, PlanSummary, StageSpan


class RecipeSummary(BaseModel):
    """One row in the recipe list."""

    id: str = Field(description="Slug used in the plan URL.")
    title: str = Field(description='Recipe title, e.g. "Kadai Paneer".')
    servings: int = Field(description="Servings the quantities are stated for.")
    servings_stated: bool = Field(default=True, description="See CookingGraph.servings_stated.")
    yield_text: str | None = Field(default=None, description="See CookingGraph.yield_text.")


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
    summary: PlanSummary | None = Field(
        default=None,
        description="Recipe-level timing. See schedule/summary.py. `None` for a plan "
        "serialized before this field existed.",
    )


class ImportStartResponse(BaseModel):
    """`POST /import`'s `202` response (design doc §4.5)."""

    job_id: str = Field(description="Poll `GET /import/{job_id}` with this.")


class AcquiredSource(BaseModel):
    """What acquisition found about the source, before any LLM call.

    Lets the import screen show a title, channel and description a few seconds after submit,
    well before the plan arrives. Not model input and not persisted: `RawAcquisition` stays
    internal, and this carries only its three display fields.
    """

    title: str = Field(description="Video or page title, as the source gives it.")
    channel: str | None = Field(default=None, description="Channel or site name.")
    description: str | None = Field(
        default=None, description="The source's own description or caption, verbatim."
    )


class DraftStep(BaseModel):
    """One step of a streamed draft. The text only: never a duration field."""

    text: str = Field(description="The model's step text, as streamed (lightly normalized).")


class StreamedDraft(BaseModel):
    """What the extraction call has said so far, before anything is validated.

    Unvalidated and labelled a draft on screen. It carries no durations, timers, offsets,
    totals or servings, by construction: the scanner that fills it reads nothing but the
    ingredient lines and each step's text. The validated plan replaces it, one tap away.
    """

    ingredients: list[NormalizedIngredient] | None = Field(
        description="`None` until the model has finished the ingredients list.",
    )
    steps: list[DraftStep] = Field(
        default=[], description="Each step once its text has closed. Append-only."
    )
    steps_complete: bool = Field(default=False, description="The model has finished the step list.")
    calls: int = Field(
        default=1,
        description="Extraction calls started so far (a retry or escalation shows as 2). A "
        "later call only fills a section still empty; it never rewrites what is shown.",
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
    preview: SourcePreview | None = Field(
        default=None,
        description="The source's own readable recipe, once acquire has produced one (A2). "
        "Kept on every later status, so a failed or degraded job can still show it.",
    )
    acquired: AcquiredSource | None = Field(
        default=None,
        description="Title, channel and description once acquire has returned (not for pasted "
        "text). Kept on every later status, like `preview`.",
    )
    draft: StreamedDraft | None = Field(
        default=None,
        description="The ingredients and steps as the extraction call streams them, before "
        "validation. Kept on every later status, like `preview`, so a failed job still shows "
        "what was read. `None` for a result-cache hit, or when streaming is off.",
    )


class ReprocessRequest(BaseModel):
    """`POST /recipes/reprocess` body: the inputs a saved recipe kept (staleness plan B2)."""

    original: ImportOriginal = Field(description="The post-processing inputs from the import.")


class ReprocessResponse(BaseModel):
    """`POST /recipes/reprocess` response: the refreshed derived copy.

    `payload` and `import_meta` are exactly what a client stores beside `original` in a
    `SavedRecipe`; `postprocess_version` is the stamp it writes with them. Computed with
    no acquire and no LLM call.
    """

    payload: RecipePlanResponse = Field(description="The rebuilt graph, plan and rollups.")
    import_meta: ImportMeta = Field(description="Import-status context for the rebuilt plan.")
    postprocess_version: int = Field(description="`POSTPROCESS_VERSION` that produced this.")


class ServerInfo(BaseModel):
    """`GET /health`: liveness plus the version stamp saved recipes are compared against."""

    status: str = Field(description='Always "ok" when the API answers.')
    version: str = Field(description="The API package version.")
    postprocess_version: int = Field(
        description="`POSTPROCESS_VERSION`: a saved recipe stamped lower may be out of date."
    )

