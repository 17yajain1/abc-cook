"""The Ingredient model. See docs/COOKING_GRAPH.md §2."""

from pydantic import BaseModel, Field


class Ingredient(BaseModel):
    """One ingredient line from the source recipe.

    A `prep_note` is a hint that a prep node exists: "2 onions, finely chopped"
    implies a `chop_onion` node even when no written step mentions chopping.
    """

    id: str = Field(description='Stable id, e.g. "ing_onion".')
    name: str = Field(description='Display name, e.g. "Onion".')
    qty: float | None = Field(description="Quantity, or null when the recipe gives none.")
    unit: str | None = Field(description='Unit, e.g. "medium", "g", "tbsp".')
    prep_note: str | None = Field(
        description='Preparation stated on the ingredient line, e.g. "finely chopped".',
    )
    group: str | None = Field(
        description='Ingredient grouping, e.g. "For the masala" / "For garnish".',
    )
    optional: bool = Field(
        default=False,
        description="Optional ingredients are exempt from the consumption invariant (§5.5).",
    )
