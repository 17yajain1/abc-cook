"""The scheduler: CookingGraph in, CookingPlan out.

This package plus `abc_cook/schema/` is the moat. Everything here is a pure function —
no network, no DB, no clock reads, no randomness — which is what makes the plan
testable against golden fixtures and what makes the product trustworthy.

The one rule that governs all of it: **`attention` determines whether the cook is
occupied; `kind` does not.** If you find yourself writing `if node.kind == "passive"`
here, you almost certainly mean `if node.attention in ("unattended", "periodic")`.

See docs/COOKING_GRAPH.md §4.
"""

from abc_cook.schedule.rollup import stage_spans
from abc_cook.schedule.scheduler import schedule

__all__ = ["schedule", "stage_spans"]
