"""Pydantic models — the single source of truth for the ABC Cook contract.

TypeScript types in `packages/schema/` are generated from these models' JSON Schema
(`make types`). Never hand-write a TS interface mirroring one of these.

See docs/COOKING_GRAPH.md §2 for the spec these implement.
"""

from abc_cook.schema.api import (
    RecipeListResponse,
    RecipePlanResponse,
    RecipeSummary,
)
from abc_cook.schema.graph import CookingGraph, Edge, EdgeKind, SourceKind, SourceRef, Stage
from abc_cook.schema.ingredient import Ingredient
from abc_cook.schema.node import Attention, Node, NodeKind, Station
from abc_cook.schema.plan import CookingPlan, ScheduledNode, StageSpan, WaitWindow

__all__ = [
    "Attention",
    "CookingGraph",
    "CookingPlan",
    "Edge",
    "EdgeKind",
    "Ingredient",
    "Node",
    "NodeKind",
    "RecipeListResponse",
    "RecipePlanResponse",
    "RecipeSummary",
    "ScheduledNode",
    "SourceKind",
    "SourceRef",
    "Stage",
    "StageSpan",
    "Station",
    "WaitWindow",
]
