"""Chapter-delta vs stage-duration corroboration. Advisory only (design doc §0/§9).

LOCKED DECISION 9: chapter matching is advisory only and must never create
dependencies, durations, attention states, freshness constraints, or any other
scheduler semantics — it only ever appends human-readable warning strings. Position-
matches non-Intro/Outro chapters to `graph.stages` in stated order; if the counts
don't align reasonably, it skips silently (no warning, no gate).

A chapter delta measures how long the creator spent on screen for a stretch of the
video — not how long the cook will spend. It is never written into `Node.duration_*`.
"""

from __future__ import annotations

from abc_cook.schema.graph import CookingGraph
from abc_cook.schema.normalized import NormalizedRecipe

_SKIP_LABELS = {"intro", "outro"}
_GROSS_DIVERGENCE_RATIO = 3.0
"""e.g. the model claims ~25 min for a stretch the creator showed in ~90s (§0)."""


def corroborate(recipe: NormalizedRecipe, graph: CookingGraph) -> list[str]:
    """Compare chapter on-screen time against each stage's scheduled duration.

    Args:
        recipe: The normalized recipe carrying `chapters` (design doc §0/§4.4).
        graph: The graph built from the same recipe.

    Returns:
        Warning strings for stages whose duration grossly diverges from the matching
        chapter's on-screen delta. Empty when there are no chapters, when non-
        Intro/Outro chapter count doesn't match stage count, or when nothing diverges.
    """
    chapters = [c for c in recipe.chapters if c.label.strip().lower() not in _SKIP_LABELS]
    if not chapters or len(chapters) != len(graph.stages):
        return []

    warnings: list[str] = []
    for chapter, stage in zip(chapters, graph.stages, strict=True):
        if chapter.end_sec is None:
            continue
        chapter_min = (chapter.end_sec - chapter.start_sec) / 60
        if chapter_min <= 0:
            continue
        stage_min = sum(node.duration_typical for node in graph.nodes if node.stage == stage.id)
        if stage_min <= 0:
            continue
        ratio = stage_min / chapter_min
        if ratio >= _GROSS_DIVERGENCE_RATIO or ratio <= 1 / _GROSS_DIVERGENCE_RATIO:
            warnings.append(
                f'Stage "{stage.label}" is scheduled at {stage_min:.0f} min, but the '
                f'creator spent about {chapter_min:.1f} min on screen for "{chapter.label}" '
                "— advisory only, does not change the plan."
            )
    return warnings
