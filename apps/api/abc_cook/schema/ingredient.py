"""The Ingredient model. See docs/COOKING_GRAPH.md §2."""

from pydantic import BaseModel, Field


class QtyAmount(BaseModel):
    """A quantity parsed from the source text, structured so it can be multiplied.

    Present only when the parser (`abc_cook.extract.quantity.parse_amount`) was certain; the
    line then reads back as `prefix + number(s) + rest`. Everything it is not certain about
    has no `QtyAmount`, and the line renders as the source wrote it.
    """

    low: float = Field(gt=0, description="The number, or the low end of a range.")
    high: float | None = Field(
        default=None,
        description="The high end of a range (always above `low`); null for an exact amount.",
    )
    prefix: str = Field(
        default="",
        description='An approximate word kept verbatim, e.g. "about ".',
    )
    rest: str = Field(
        default="",
        description='The source text after the number(s), verbatim, e.g. " cup", "g", " pieces".',
    )


class Ingredient(BaseModel):
    """One ingredient line from the source recipe.

    A `prep_note` is a hint that a prep node exists: "2 onions, finely chopped"
    implies a `chop_onion` node even when no written step mentions chopping.
    """

    id: str = Field(description='Stable id, e.g. "ing_onion".')
    name: str = Field(description='Display name, e.g. "Onion".')
    qty: float | None = Field(description="Quantity, or null when the recipe gives none.")
    qty_text: str | None = Field(
        default=None,
        description=(
            "Quantity as the source stated it, e.g. \"1 1/4\", \"2-3\", \"a pinch\". "
            "Display fallback when `qty` cannot be parsed as a single number, and the "
            "honest form of ranges and vague amounts that `qty` would otherwise lose."
        ),
    )
    qty_amount: QtyAmount | None = Field(
        default=None,
        description=(
            "Structured form of `qty_text`, set only when it parsed with certainty. Null means "
            "the amount cannot be scaled (vague, a second amount, a package size, ...) and is "
            "shown as written."
        ),
    )
    unit: str | None = Field(description='Unit, e.g. "medium", "g", "tbsp".')
    unit_canonical: str | None = Field(
        default=None,
        description=(
            "`unit` mapped to one canonical spelling (g, kg, ml, l, tsp, tbsp, cup, katori, "
            "glass, oz, lb, pinch, count), or null when the unit is absent or not in the closed "
            "alias table. Never guessed; `unit` itself is not rewritten."
        ),
    )
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
