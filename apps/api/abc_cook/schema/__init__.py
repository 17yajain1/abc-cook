"""Pydantic models — the single source of truth for the ABC Cook contract.

TypeScript types in `packages/schema/` are generated from these models' JSON Schema
(`make types`). Never hand-write a TS interface mirroring one of these.

See docs/COOKING_GRAPH.md §2 for the spec these implement.
"""

from abc_cook.schema.api import (
    ImportJobResponse,
    ImportStartResponse,
    RecipeListResponse,
    RecipePlanResponse,
    RecipeSummary,
)
from abc_cook.schema.graph import CookingGraph, Edge, EdgeKind, SourceKind, SourceRef, Stage
from abc_cook.schema.ingredient import Ingredient
from abc_cook.schema.library import ImportMeta, SavedLibrary, SavedRecipe
from abc_cook.schema.node import Attention, Node, NodeKind, Station
from abc_cook.schema.normalized import (
    Freshness,
    GraphProvenance,
    ImportResult,
    ImportStatus,
    NodeProvenance,
    NormalizedChapter,
    NormalizedIngredient,
    NormalizedRecipe,
    NormalizedStep,
    ProvenanceSource,
)
from abc_cook.schema.plan import (
    CookingPlan,
    LongWait,
    PlanSummary,
    ScheduledNode,
    Session,
    StageSpan,
    WaitWindow,
)

__all__ = [
    "Attention",
    "CookingGraph",
    "CookingPlan",
    "Edge",
    "EdgeKind",
    "Freshness",
    "GraphProvenance",
    "ImportJobResponse",
    "ImportMeta",
    "ImportResult",
    "ImportStartResponse",
    "ImportStatus",
    "Ingredient",
    "LongWait",
    "Node",
    "NodeKind",
    "NodeProvenance",
    "NormalizedChapter",
    "NormalizedIngredient",
    "NormalizedRecipe",
    "NormalizedStep",
    "PlanSummary",
    "ProvenanceSource",
    "RecipeListResponse",
    "RecipePlanResponse",
    "RecipeSummary",
    "SavedLibrary",
    "SavedRecipe",
    "ScheduledNode",
    "Session",
    "SourceKind",
    "SourceRef",
    "Stage",
    "StageSpan",
    "Station",
    "WaitWindow",
]
