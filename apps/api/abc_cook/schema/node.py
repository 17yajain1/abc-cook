"""The Node model — the unit of work in a cooking graph. See docs/COOKING_GRAPH.md §2."""

from typing import Literal

from pydantic import BaseModel, Field

NodeKind = Literal["prep", "active", "passive", "combine", "finish"]
"""How a node renders. Has no effect on scheduling (§4)."""

Attention = Literal["hands_on", "periodic", "unattended"]
"""Whether the node occupies the cook. This, never `kind`, drives every scheduler decision."""

Station = Literal["burner", "oven", "counter", "sink", "fridge", "none"]
"""A contended resource. Two nodes on the same station cannot overlap without a warning."""


class Node(BaseModel):
    """One unit of work in the cooking graph.

    `kind` and `attention` are separate on purpose. `attention` decides whether the
    node occupies the cook and therefore whether it creates a wait window; `kind`
    decides how it renders. Scheduler code must branch on `attention` only.
    """

    id: str = Field(description='Stable id, e.g. "cook_base".')
    stage: str = Field(description="Id of the stage this node belongs to; must exist in `stages`.")
    label: str = Field(description="UI heading, four words or fewer.")
    instruction: str = Field(description="Full sentence(s) shown in step mode.")

    kind: NodeKind = Field(description="Render classification. Not used by the scheduler.")
    attention: Attention = Field(
        description="Whether the cook is occupied. `unattended` and `periodic` create windows.",
    )

    duration_min: int = Field(description="Optimistic duration in minutes.")
    duration_typical: int = Field(description="Duration the plan displays and schedules on.")
    duration_max: int = Field(description="Pessimistic duration; window-safety checks use this.")

    station: Station = Field(description="The resource this node contends for.")

    depends_on: list[str] = Field(
        default_factory=list,
        description="Node ids that must COMPLETE before this node may start.",
    )
    consumes: list[str] = Field(
        default_factory=list,
        description="Ingredient ids and/or component ids this node uses up.",
    )
    produces: str | None = Field(
        default=None,
        description='Component id this node yields, e.g. "comp_base".',
    )

    interruptible: bool = Field(
        description="Whether the cook can drop this mid-way and return. Gates `periodic` windows.",
    )
    max_lead_min: int | None = Field(
        default=None,
        description="Freshness ceiling: minutes this may finish before its consumer starts (§4.5).",
    )
    doneness_cue: str | None = Field(
        default=None,
        description='Sensory finish signal, e.g. "onions light golden, oil separating".',
    )
    tip: str | None = Field(default=None, description="Optional aside shown in step mode.")
