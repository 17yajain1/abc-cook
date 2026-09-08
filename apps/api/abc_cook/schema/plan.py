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


class StageSpan(BaseModel):
    """A stage's footprint on the scheduled timeline.

    Deliberately NOT part of `CookingPlan`: it is a view over a finished plan, computed
    by `abc_cook.schedule.rollup`, and adding it to the plan would rewrite all five
    golden fixtures for a rendering convenience.

    It exists because the Plan view shows a per-stage minute count, and the frontend is
    forbidden from deriving one (CLAUDE.md). Stages interleave — in Kadai Paneer `prep`
    spans 0-19 while `cook_base` spans 3-22 — so a stage is a span, not a block.
    """

    stage_id: str = Field(description="Id of the stage in the source graph.")
    start_min: float = Field(description="Earliest start among this stage's nodes.")
    end_min: float = Field(description="Latest end among this stage's nodes.")
    elapsed_min: float = Field(
        description="Wall-clock span of the stage. Overlaps other stages' spans.",
    )
    work_min: float = Field(description="Sum of `duration_typical` over the stage's nodes.")
    windowed_work_min: float = Field(
        description="Of `work_min`, the minutes absorbed into another stage's wait window.",
    )
    inline_work_min: float = Field(
        description="`work_min - windowed_work_min`. What the stage's own card still shows.",
    )
    node_ids: list[str] = Field(description="This stage's nodes, in scheduled order.")


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
