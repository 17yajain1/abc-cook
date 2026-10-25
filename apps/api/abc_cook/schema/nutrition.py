"""Per-serving nutrition for a recipe. See notes/3a-nutrition/part-a-plan.md §6-§7.

Pydantic is the single source of truth; the calculator in `abc_cook.nutrition` builds these.
Floats are stored unrounded (rounding is a render concern). Not in `export_schema` ROOTS until
the page panel exists (Part C), so no TypeScript is generated from this yet.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

GramsBasis = Literal["stated", "table", "estimated", "missing", "unmatched"]
"""stated: metric arithmetic or a gram hint in the line. table: converted from a spoon, cup or
count through the fixed table or an FDC portion. estimated: an LLM guess, a range midpoint, or a
defaulted amount. missing: the line has no amount. unmatched: no food was found for the line."""

Confidence = Literal["calculated", "estimated", "rough"]
Diet = Literal["veg", "non_veg", "egg"]
HintReading = Literal["total", "per_unit"]
LineFlag = Literal[
    "default_fat",
    "frying",
    "fat_default_beside_stated_fat",
    "hint_conflict",
    "range_midpoint",
    "to_taste",
    "unparseable_amount",
]


class NutrientAmounts(BaseModel):
    """The five nutrients, unrounded."""

    kcal: float = 0.0
    protein_g: float = 0.0
    carbs_g: float = Field(default=0.0, description="Total carbohydrate, not net.")
    fat_g: float = 0.0
    fibre_g: float = 0.0


class FoodRef(BaseModel):
    """The food a line was matched to."""

    source: Literal["usda_fdc", "indb", "ifct"] = "usda_fdc"
    food_id: str = Field(description='"fdc:<id>" for USDA FoodData Central.')
    name: str
    foods_version: str


class PortionRef(BaseModel):
    """The FDC household portion a count or size word was converted through."""

    unit: str
    prep: str
    grams: float = Field(description="Grams for one of the unit.")
    raw_modifier: str


class Driver(BaseModel):
    """One of the lines that moves the recipe's calories most."""

    ingredient_id: str
    text: str = Field(description='Display text, e.g. "Oil 2 tbsp ≈ 240 kcal".')
    basis: GramsBasis
    kcal: float


class IngredientNutrition(BaseModel):
    """What one ingredient line contributes, and how the number was reached."""

    ingredient_id: str
    ingredient_index: int = Field(ge=0)
    line_text: str
    food: FoodRef | None = None
    grams: float | None = None
    grams_basis: GramsBasis
    nutrients: NutrientAmounts | None = None
    est_kcal: float = Field(default=0.0, description="Line kcal; 0 when unmatched or missing.")
    excluded_reason: Literal["optional", "to_taste"] | None = Field(
        default=None,
        description="Set when the line is left out of the totals (it never counts against "
        "confidence).",
    )
    flags: list[LineFlag] = Field(default_factory=list)
    hint_reading: HintReading | None = None
    portion: PortionRef | None = None


class RecipeNutrition(BaseModel):
    """Per-serving nutrition for one recipe, with the lines behind it."""

    nutrition_version: int
    computed_at: datetime
    servings_basis: int = Field(ge=1, description="Servings the per-serving numbers divide by.")
    servings_basis_source: Literal["stated", "assumed"] = Field(
        description="`assumed` when extraction defaulted the servings; it caps the label at "
        "`estimated`.",
    )
    per_serving: NutrientAmounts
    total: NutrientAmounts
    confidence: Confidence
    drivers: list[Driver] = Field(default_factory=list)
    rows: list[IngredientNutrition] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    diet: Diet | None = None
    diet_foods_version: str | None = None
