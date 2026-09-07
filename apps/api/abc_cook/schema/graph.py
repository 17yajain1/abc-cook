"""The CookingGraph and its parts. See docs/COOKING_GRAPH.md §2.

The Cooking Graph is internal: it is what the LLM extracts and what the scheduler
consumes. Users never see it — they see a CookingPlan.
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from abc_cook.schema.ingredient import Ingredient
from abc_cook.schema.node import Node

SourceKind = Literal["url", "image", "text"]
"""How the recipe arrived."""

EdgeKind = Literal["sequence", "ingredient", "merge"]
"""Why an edge exists. Derived for rendering, never authored by the LLM."""


class SourceRef(BaseModel):
    """Where a recipe came from."""

    kind: SourceKind = Field(description="url / image / pasted text.")
    value: str = Field(description="The URL, the image reference, or the pasted text itself.")
    imported_at: datetime = Field(description="When the import ran.")


class Stage(BaseModel):
    """A named group of nodes: Prep, Cook Base, Add Veggies, Finish.

    Stages are user-facing and ordered; the Plan view groups by them.
    """

    id: str = Field(description='Stable id, e.g. "cook_base".')
    label: str = Field(description='User-facing name, e.g. "Cook the base".')
    color_key: str = Field(description="Key into the stage palette in docs/DESIGN_SYSTEM.md.")


class Edge(BaseModel):
    """A denormalised dependency, derived from `Node.depends_on` for rendering.

    Never authored by the extractor. `Node.depends_on` is the source of truth.
    """

    src: str = Field(description="Id of the node that must complete first.")
    dst: str = Field(description="Id of the dependent node.")
    kind: EdgeKind = Field(description="Why this edge exists.")


class CookingGraph(BaseModel):
    """The internal DAG of a recipe: what the LLM extracts, what the scheduler consumes."""

    id: str = Field(description="Stable graph id.")
    title: str = Field(description='Recipe title, e.g. "Kadai Paneer".')
    servings: int = Field(description="Servings the quantities are stated for.")
    cuisine: str | None = Field(description="Cuisine, when the source states or implies one.")
    source: SourceRef = Field(description="Where this recipe came from.")
    ingredients: list[Ingredient] = Field(description="Every ingredient the recipe lists.")
    nodes: list[Node] = Field(description="Every unit of work.")
    stages: list[Stage] = Field(
        description="Ordered stages; every node's `stage` must appear here.",
    )
    stated_total_min: int | None = Field(
        description="Total time the original recipe claimed. Sanity-checks extraction (§5.8).",
    )
