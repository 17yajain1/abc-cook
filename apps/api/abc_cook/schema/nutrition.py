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
    "absorbed_estimate",
    "fry_method_uncertain",
    "deep_fry_fallback",
]
FoodSourceName = Literal["cache", "alias", "exact", "llm"]
"""How a line got its food: the food-map cache, a curated alias, an exact name match, or a fresh
model pick."""
FatMethod = Literal["deep_fry", "shallow_or_plain"]
FatRule = Literal[
    "stated",
    "default_half_tbsp",
    "default_1tsp_beside_stated",
    "deep_fry_10pct",
    "deep_fry_fallback",
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
    food_source: FoodSourceName | None = Field(
        default=None, description="How the food was found; None when the line has no food."
    )
    food_reviewed: bool = Field(
        default=False,
        description="Whether the owner has reviewed this mapping (a reviewed alias or cache row).",
    )
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
    fat_method: FatMethod | None = Field(
        default=None, description="For an oil, ghee or butter line: how the fat is used."
    )
    fat_rule: FatRule | None = Field(
        default=None, description="For a fat line: which amount rule produced `grams`."
    )
    fried_grams: float | None = Field(
        default=None, description="For a deep-fry line: the raw weight of the food being fried."
    )


class RecipeNutrition(BaseModel):
    """Per-serving nutrition for one recipe, with the lines behind it."""

    nutrition_version: int
    computed_at: datetime
    servings_basis: int = Field(ge=1, description="Servings the per-serving numbers divide by.")
    servings_basis_source: Literal["stated", "assumed", "yield_text"] = Field(
        description="`assumed` when extraction defaulted the servings; it caps the label at "
        "`estimated`. `yield_text` means the yield text gave the servings (not capped).",
    )
    yield_pieces: int | None = Field(
        default=None,
        description='A piece count read from the yield text ("12 chillas"). Not used in the '
        "maths; set only while the servings are assumed.",
    )
    per_serving: NutrientAmounts
    total: NutrientAmounts = Field(
        description="Whole recipe (all servings), not per serving: `per_serving` times "
        "`servings_basis`."
    )
    confidence: Confidence = Field(
        description="The B3 shadow thresholds plus the guard: never `calculated` when a top-5 "
        "line by kcal got its food from an unreviewed pick."
    )
    confidence_v2: Confidence = Field(
        description="The v2 official label (placeholder thresholds, no guard), kept to compare."
    )
    guard_demoted: bool = Field(
        default=False, description="The guard turned a `calculated` label into `estimated`."
    )
    optional_extras_kcal_per_serving: float | None = Field(
        default=None,
        description="Kcal per serving of the lines left out as optional, computed like counted "
        "lines. None when there are no optional lines or none can be computed.",
    )
    optional_extras_unmatched: list[str] = Field(
        default_factory=list,
        description="Optional lines that could not be computed. Non-empty means the extras sum "
        "is partial.",
    )
    drivers: list[Driver] = Field(default_factory=list)
    rows: list[IngredientNutrition] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    diet: Diet | None = None
    diet_foods_version: str | None = None
