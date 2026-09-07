"""The CookingPlan — the scheduler's output. See docs/COOKING_GRAPH.md §2.

This is the contract the frontend renders. Every number the user sees originates
here; the frontend never infers durations, parallelism, or savings of its own.
"""

from pydantic import BaseModel, Field


class ScheduledNode(BaseModel):
    """One node placed on the timeline."""

    node_id: str = Field(description="Id of the node in the source graph.")
    start_min: float = Field(description="Minutes from the start of cooking.")
    end_min: float = Field(description="Minutes from the start of cooking.")
    occupies_cook: bool = Field(
        description="Whether the cook is busy for this interval. Follows `Node.attention`.",
    )
    window_id: str | None = Field(
        default=None,
        description="Set when this ran inside another node's wait window.",
    )
    rank_in_window: int | None = Field(
        default=None,
        description='Order within the window. 0 is the task the UI promotes as "start with this".',
    )


class WaitWindow(BaseModel):
    """An unattended interval the scheduler filled with prep work.

    User-facing as "while this cooks". Capacity is deliberately below the host node's
    duration — see §4.3 for the multipliers and why they exist.
    """

    id: str = Field(description="Stable window id.")
    host_node_id: str = Field(
        description="The unattended or periodic node whose duration creates it.",
    )
    capacity_min: float = Field(description="Usable minutes, after the safety multiplier.")
    assigned: list[str] = Field(description="Node ids, in the order the cook should do them.")
    used_min: float = Field(description="Minutes of assigned work.")
    slack_min: float = Field(description="Unused capacity.")


class CookingPlan(BaseModel):
    """The scheduled, renderable output the user sees."""

    graph_id: str = Field(description="Id of the graph this plan was computed from.")
    scheduled: list[ScheduledNode] = Field(description="Every node, placed on the timeline.")
    windows: list[WaitWindow] = Field(description="Wait windows derived from the timeline.")
    total_min: float = Field(description="Makespan of the scheduled plan.")
    serial_min: float = Field(description="Sum of all typical durations, done one at a time.")
    saved_min: float = Field(
        description="serial_min - total_min. The number the product is arguing for.",
    )
    critical_path: list[str] = Field(description="Node ids on the longest path.")
    warnings: list[str] = Field(
        default_factory=list,
        description='Safety-check findings (§4.5). "degraded" means extraction fell back.',
    )
