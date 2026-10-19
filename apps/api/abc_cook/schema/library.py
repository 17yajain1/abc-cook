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

v2 (saved-recipe staleness plan, 2026-10-16) adds three siblings of `payload`/`import_meta`
(which stay top-level and are now the *derived* copy): `original` (the post-processing
inputs, immutable), `postprocess_version` (which code produced the derived copy) and
`edits` (reserved for R6). With `original` kept, a stale `payload` is rebuilt free via
`POST /recipes/reprocess` rather than by a re-import.
"""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, Field, JsonValue

from abc_cook.schema.api import RecipePlanResponse
from abc_cook.schema.normalized import ImportMeta, ImportOriginal


class RecipeEdit(BaseModel):
    """Placeholder envelope for a user edit (R6 fills in the operation union).

    Edits target the *original* (`ImportOriginal.recipe` ingredient and step indices),
    never graph node ids, which are derived and can change on a reprocess. `anchor` holds
    the index plus the value expected there; an edit whose anchor no longer matches after
    a refresh is kept and marked orphaned, never dropped and never force-applied. Nothing
    writes these yet: readers preserve them verbatim.
    """

    id: str = Field(description="Stable id for this edit.")
    created_at: datetime = Field(description="When the user made the edit.")
    op: str = Field(description="Operation name. The union is defined in R6.")
    anchor: JsonValue = Field(description="Where it applies: an index and the expected value.")
    value: JsonValue = Field(description="The new value.")


BATCH_MULTIPLIERS = (0.5, 1.0, 1.5, 2.0, 3.0)


def _closed_batch_set(value: float) -> float:
    if value not in BATCH_MULTIPLIERS:
        raise ValueError(f"multiplier must be one of {BATCH_MULTIPLIERS}")
    return value


class ServingsByCount(BaseModel):
    """The recipe states how many it serves, so the cook picked a headcount (R4)."""

    mode: Literal["servings"] = Field(description="Discriminator: a headcount choice.")
    chosen: int = Field(ge=1, description="The headcount the cook picked.")
    original: int = Field(
        ge=1,
        description="The servings the recipe stated when this was chosen; a mismatch voids it.",
    )


class ServingsByBatch(BaseModel):
    """The recipe does not state its servings, so the cook picked a relative size (R4)."""

    mode: Literal["batch"] = Field(description="Discriminator: a relative batch size.")
    # A float, not `Literal[0.5, ...]`: mypy --strict rejects float literals, and JS writes
    # `1` and `2` for whole numbers. The enum keeps the generated TS a closed union.
    multiplier: Annotated[float, AfterValidator(_closed_batch_set)] = Field(
        json_schema_extra={"enum": list(BATCH_MULTIPLIERS)},
        description="Relative batch size: 0.5, 1, 1.5, 2 or 3.",
    )


type ServingsChoice = Annotated[ServingsByCount | ServingsByBatch, Field(discriminator="mode")]


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
    original: ImportOriginal | None = Field(
        default=None,
        description=(
            "The post-processing inputs from the import, immutable after save. `payload` and "
            "`import_meta` are derived from it and can be rebuilt free via "
            "`POST /recipes/reprocess`. Null for a feed save or a legacy import."
        ),
    )
    postprocess_version: int | None = Field(
        default=None,
        description=(
            "`POSTPROCESS_VERSION` of the code that produced `payload`. Null means unknown, "
            "which is treated as stale."
        ),
    )
    edits: list[RecipeEdit] = Field(
        default_factory=list,
        description="Reserved for R6. Always empty for now; readers preserve items verbatim.",
    )
    servings_choice: ServingsChoice | None = Field(
        default=None,
        description=(
            "The cook's chosen servings for this recipe (R4b). Null or absent means as written. "
            "Additive in v2. The web app reconciles it against `payload` on read; nothing here "
            "checks it against the recipe."
        ),
    )


class SavedLibrary(BaseModel):
    """The whole saved-recipe library, as stored under one `localStorage` key."""

    version: Literal[2] = Field(
        default=2,
        description=(
            "Storage format version. The web store also reads version 1 (no `original`, "
            "`postprocess_version` or `edits`) and migrates it on first write; this model "
            "describes v2 only."
        ),
    )
    recipes: list[SavedRecipe] = Field(description="Saved entries, in no particular order.")
