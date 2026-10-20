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
`edits` (R6: the cook's edits). With `original` kept, a stale `payload` is rebuilt free via
`POST /recipes/reprocess` rather than by a re-import.
"""

from collections.abc import Callable
from datetime import datetime
from typing import Annotated, Literal, Self

from pydantic import AfterValidator, BaseModel, Field, model_validator

from abc_cook.schema.api import RecipePlanResponse
from abc_cook.schema.normalized import ImportMeta, ImportOriginal


class IngredientExpected(BaseModel):
    """What the ingredient line looked like when the edit was made (its anchor's guard)."""

    name: str = Field(description="`Ingredient.name` at that index.")
    qty_text: str | None = Field(description="`Ingredient.qty_text` there, or null.")
    unit: str | None = Field(description="`Ingredient.unit` there, or null.")


class IngredientAnchor(BaseModel):
    """Where an ingredient edit applies: a position in `graph.ingredients` plus its guard."""

    index: int = Field(ge=0, description="Position in `payload.graph.ingredients`.")
    expected: IngredientExpected = Field(
        description="The line expected there; a mismatch after a refresh orphans the edit.",
    )


class StepExpected(BaseModel):
    """What the step read when the edit was made."""

    text: str = Field(description="`Node.instruction` of the step.")


class StepAnchor(BaseModel):
    """Where a step edit applies: the expected text, with the index as a tiebreak."""

    index: int = Field(ge=0, description="Position in `payload.graph.nodes`; breaks a tie.")
    expected: StepExpected = Field(description="Matched against `Node.instruction`.")


class NumberAmount(BaseModel):
    """An amount the cook typed: one number or a range."""

    kind: Literal["number"] = Field(description="Discriminator: a number or a range.")
    low: float = Field(gt=0, description="The number, or the low end of a range.")
    high: float | None = Field(
        default=None,
        description="The high end of a range; null for an exact amount. Always above `low`.",
    )

    @model_validator(mode="after")
    def _high_above_low(self) -> Self:
        if self.high is not None and self.high <= self.low:
            raise ValueError("high must be greater than low")
        return self


class ToTasteAmount(BaseModel):
    """No quantity: the line reads "to taste"."""

    kind: Literal["to_taste"] = Field(description="Discriminator: no number.")


type Amount = Annotated[NumberAmount | ToTasteAmount, Field(discriminator="kind")]


def _trimmed(limit: int) -> Callable[[str], str]:
    def check(value: str) -> str:
        text = value.strip()
        if not 1 <= len(text) <= limit:
            raise ValueError(f"must be 1 to {limit} characters once trimmed")
        return text

    return check


Name = Annotated[str, AfterValidator(_trimmed(80))]
StepText = Annotated[str, AfterValidator(_trimmed(1000))]


class NameValue(BaseModel):
    """The new ingredient name."""

    name: Name = Field(description="1 to 80 characters, trimmed.")


class AmountValue(BaseModel):
    """The new amount and unit. `unit` is null for "No unit" and always null for to-taste."""

    amount: Amount = Field(description="A number, a range, or to taste.")
    unit: str | None = Field(description="The unit as shown, or null for no unit.")

    @model_validator(mode="after")
    def _to_taste_has_no_unit(self) -> Self:
        if isinstance(self.amount, ToTasteAmount) and self.unit is not None:
            raise ValueError("a to-taste amount has no unit")
        return self


class AddValue(BaseModel):
    """An ingredient the cook added. `step` links it to a step (R6b); null in R6a."""

    name: Name = Field(description="1 to 80 characters, trimmed.")
    amount: Amount | None = Field(description="Null for a line with no amount.")
    unit: str | None = Field(description="The unit as shown, or null.")
    step: StepAnchor | None = Field(description="The step that uses it, or null.")

    @model_validator(mode="after")
    def _to_taste_has_no_unit(self) -> Self:
        if isinstance(self.amount, ToTasteAmount) and self.unit is not None:
            raise ValueError("a to-taste amount has no unit")
        return self


class TextValue(BaseModel):
    """The new step text."""

    text: StepText = Field(description="1 to 1000 characters, trimmed.")


class _EditBase(BaseModel):
    id: str = Field(description="Stable id for this edit.")
    created_at: datetime = Field(description="When the user made the edit.")


class SetIngredientName(_EditBase):
    """Rename an ingredient line."""

    op: Literal["set_ingredient_name"] = Field(description="Discriminator.")
    anchor: IngredientAnchor
    value: NameValue


class SetIngredientAmount(_EditBase):
    """Change an ingredient line's amount and unit."""

    op: Literal["set_ingredient_amount"] = Field(description="Discriminator.")
    anchor: IngredientAnchor
    value: AmountValue


class RemoveIngredient(_EditBase):
    """Take an ingredient line off the list."""

    op: Literal["remove_ingredient"] = Field(description="Discriminator.")
    anchor: IngredientAnchor


class AddIngredient(_EditBase):
    """Add an ingredient line the recipe did not have."""

    op: Literal["add_ingredient"] = Field(description="Discriminator.")
    value: AddValue


class SetStepText(_EditBase):
    """Rewrite a step's text. The plan's timing is not recomputed (R6b)."""

    op: Literal["set_step_text"] = Field(description="Discriminator.")
    anchor: StepAnchor
    value: TextValue


type RecipeEdit = Annotated[
    SetIngredientName | SetIngredientAmount | RemoveIngredient | AddIngredient | SetStepText,
    Field(discriminator="op"),
]
"""A user edit, stored as a patch over the imported recipe (R6, Tier A: ingredients and step
text; nothing here changes timing).

The web app applies the patch to the finished plan after scheduling (an overlay), never to the
original and never through `reprocess`, so node ids, edges and durations cannot move.
Ingredient edits are anchored by index into `payload.graph.ingredients` plus the line
expected there; step edits by the expected step text, with the index as a tiebreak. An edit
whose anchor no longer matches after a refresh is kept and shown as one that could not be
applied, never dropped and never forced. The web app keeps any stored item it does not
understand verbatim, so this union is a contract for what it writes, not a gate on what it
reads.
"""


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
        description=(
            "The cook's edits (R6), as a patch over `payload`. Readers keep items they do not "
            "understand verbatim."
        ),
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
