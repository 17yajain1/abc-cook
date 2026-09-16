"""The client-side saved-recipe envelope. See M2.12 plan, IMPORT -> SAVE -> LIBRARY -> REOPEN.

`SavedRecipe`/`SavedLibrary` are a contract only in v1 — there is no route and no server
storage. The web app writes and reads `SavedLibrary` JSON directly in `localStorage`
(`abc_cook/../packages/schema` generates the TS these are validated against; the model
lives here so a future Supabase row can reuse its shape without inventing a new one for
M5). `payload` is the exact `RecipePlanResponse` a successful import or fixture fetch
produced -- nothing re-derived, nothing dropped, so a saved recipe reopens exactly as it
was scheduled.

`source_key` is a deterministic string derived from `CookingGraph.source` that collapses
equivalent URLs (tracking params, YouTube's several URL shapes) to one key, so the same
video saved twice updates one entry instead of creating a duplicate. The canonical
derivation lives in the web module (`src/library/sourceKey.ts`) since the API never
computes it in v1 -- this field just carries whatever the client computed.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from abc_cook.schema.api import RecipePlanResponse
from abc_cook.schema.normalized import GraphProvenance, ImportSource


class ImportMeta(BaseModel):
    """Import-status fields from `ImportResult` that `RecipePlanResponse` doesn't carry.

    `RecipePlanResponse` stays the frozen `{graph, plan, stages}` contract (M2.9 decision
    3); this is a sibling field so a saved-and-reopened recipe can still show that its
    plan was simplified or its timings estimated (A6) instead of looking like a normal
    plan. `degraded` is computed once by the client at save time from
    `"degraded" in warnings` -- not a new server field.
    """

    warnings: list[str] = Field(default_factory=list)
    review_recommended: bool = Field(default=False)
    sources: list[ImportSource] = Field(default_factory=list)
    provenance: GraphProvenance | None = Field(default=None)
    degraded: bool = Field(default=False)


class SavedRecipe(BaseModel):
    """One recipe a user has saved on this device."""

    id: str = Field(description="Stable id for this saved entry, assigned at first save.")
    source_key: str = Field(
        description="Canonical key derived from the source's URL/text; see module docstring.",
    )
    saved_at: datetime = Field(description="When this entry was first saved. Never changes.")
    updated_at: datetime = Field(
        description="When this entry's payload was last replaced. Equals saved_at on first save.",
    )
    payload: RecipePlanResponse = Field(
        description="The exact graph/plan/stages a successful import or fetch produced.",
    )
    import_meta: ImportMeta | None = Field(
        default=None,
        description=(
            "Import-status context alongside `payload` (A6). Null for fixture-path "
            "recipes, which never went through `/import`."
        ),
    )


class SavedLibrary(BaseModel):
    """The whole saved-recipe library, as stored under one `localStorage` key."""

    version: Literal[1] = Field(default=1, description="Storage format version. Always 1 in v1.")
    recipes: list[SavedRecipe] = Field(description="Saved entries, in no particular order.")
