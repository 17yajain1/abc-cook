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


class SavedLibrary(BaseModel):
    """The whole saved-recipe library, as stored under one `localStorage` key."""

    version: Literal[1] = Field(default=1, description="Storage format version. Always 1 in v1.")
    recipes: list[SavedRecipe] = Field(description="Saved entries, in no particular order.")
