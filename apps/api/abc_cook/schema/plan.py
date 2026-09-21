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
    hands_on_min: float | None = Field(
        default=None,
        description=(
            "Of `inline_work_min`, minutes on nodes with `attention == \"hands_on\"`. "
            "`hands_on_min + unattended_min == inline_work_min`. Optional for backward "
            "compatibility with plans serialized before this field existed."
        ),
    )
    unattended_min: float | None = Field(
        default=None,
        description=(
            "Of `inline_work_min`, minutes on nodes with `attention in (\"unattended\", "
            "\"periodic\")` — the nodes that do not continuously occupy the cook (§4) and "
            "are the only ones that can host a window (§4.3). Includes `periodic`, despite "
            'the name: "not hands-on" is the scheduler\'s own binary. '
            "`work_min == hands_on_min + unattended_min + windowed_work_min`, since windowed "
            "work is always hands-on (`scheduler.py` only claims `hands_on` nodes into a "
            "window). Optional for backward compatibility with plans serialized before this "
            "field existed."
        ),
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


class Session(BaseModel):
    """A contiguous sitting: cooking activity uninterrupted by a session-break wait.

    Internal name — never shown to the user (`CLAUDE.md` § Vocabulary). The Plan and
    Cooking Mode talk about the *situation* ("start about 24 hr before you eat"), never
    the model.
    """

    start_min: float = Field(description="Start of this sitting's hands-on footprint.")
    end_min: float = Field(description="End of this sitting's hands-on footprint.")
    active_min: float = Field(
        description="Σ `duration_typical` over this sitting's `hands_on` nodes.",
    )
    node_ids: list[str] = Field(
        description="Every node assigned to this sitting, in scheduled order.",
    )
    preceded_by_wait_min: float | None = Field(
        default=None,
        description="Length of the session-break gap immediately before this sitting. "
        "`None` for the first sitting.",
    )
    elapsed_min: float = Field(
        description="`end_min - start_min`. How long this sitting takes at typical pace. "
        "For the last sitting, the header range's lower bound; for a single-sitting "
        "recipe, equal to `plan.total_min`.",
    )
    elapsed_high_min: float = Field(
        description="The occupied footprint of this sitting's own `node_ids`, measured on "
        "a timeline where every `hands_on` node's `duration_typical` is set to its "
        "`duration_max`. The header range's upper bound for the last sitting. Not "
        "derivable from `PlanSummary.elapsed_high_min - start_min`: slowness in earlier "
        "sittings shifts later ones on that timeline, but this sitting's own steps still "
        "take the same honest-worst-case time regardless of what came before.",
    )
    preceded_by_host_node_ids: list[str] = Field(
        description="The hands-off nodes whose interval overlaps the open gap between the "
        "previous sitting's end and this sitting's start -- what the dish is busy with "
        "during the break. `[]` for the first sitting. Same predicate as "
        "`LongWait.host_node_ids`.",
    )


class LongWait(BaseModel):
    """An idle stretch long enough to leave the kitchen.

    Not long enough to be a separate sitting (`LONG_WAIT_MIN` <= idle < `SESSION_BREAK_MIN`).
    """

    start_min: float = Field(description="Start of the idle stretch.")
    end_min: float = Field(description="End of the idle stretch.")
    idle_min: float = Field(description="`end_min - start_min`.")
    host_node_ids: list[str] = Field(
        description="Hands-off nodes running during the stretch, in scheduled order. "
        "Often more than one consecutive unattended node with no single host.",
    )


class PlanSummary(BaseModel):
    """Recipe-level timing, derived from the scheduled plan. See `schedule/summary.py`.

    Every field here is computed, never authored — the frontend is forbidden from
    deriving any of these numbers itself (`CLAUDE.md`). Optional on `RecipePlanResponse`
    so a plan serialized before this field existed still round-trips.
    """

    active_min: float = Field(description="Σ `duration_typical` over every `hands_on` node.")
    attended_min: float = Field(
        description="`active_min` plus Σ `duration_typical` over every `periodic` node — "
        "what being in the kitchen costs, not just what the cook's hands do.",
    )
    elapsed_min: float = Field(description="Copy of `plan.total_min`, so the UI reads one object.")
    elapsed_high_min: float = Field(
        description="Makespan with every `hands_on` node's `duration_typical` set to its "
        "`duration_max`; hands-off nodes untouched. The honest upper bound of the range.",
    )
    sessions: list[Session] = Field(
        description="The timeline partitioned at idle stretches >= `SESSION_BREAK_MIN`.",
    )
    long_waits: list[LongWait] = Field(
        description="Idle stretches >= `LONG_WAIT_MIN` that are not session breaks.",
    )
