"""extract/corroborate.py -- chapter-vs-stage-duration corroboration. Advisory only.

LOCKED DECISION 9: chapter matching must never create dependencies, durations,
attention states, or freshness constraints -- these tests confirm it only ever
returns warning strings (or none), never mutates the graph passed to it.
"""

from __future__ import annotations

from datetime import UTC, datetime

from abc_cook.extract.corroborate import corroborate
from abc_cook.extract.graph import build_graph
from abc_cook.schema.graph import SourceRef
from abc_cook.schema.normalized import (
    NormalizedChapter,
    NormalizedIngredient,
    NormalizedRecipe,
    NormalizedStep,
)

SOURCE = SourceRef(kind="url", value="https://youtu.be/test", imported_at=datetime.now(UTC))


def _step(**overrides: object) -> NormalizedStep:
    defaults: dict[str, object] = {
        "text": "Do something.",
        "attention": "hands_on",
        "duration_stated": True,
        "station": "counter",
        "interruptible": True,
        "freshness": "none",
    }
    defaults.update(overrides)
    return NormalizedStep(**defaults)  # type: ignore[arg-type]


def _recipe(steps: list[NormalizedStep], chapters: list[NormalizedChapter]) -> NormalizedRecipe:
    return NormalizedRecipe(
        title="Test",
        method_grounded=True,
        ingredients=[NormalizedIngredient(name="Onion", qty="1", unit=None, prep_note=None)],
        steps=steps,
        chapters=chapters,
    )


def _two_stage_steps() -> list[NormalizedStep]:
    # index 0 -> "prep" stage (kind inferred as prep from the chop verb)
    # index 1 -> "finish" stage (last node)
    return [
        _step(
            text="Chop the onions.",
            consumes_ingredients=["Onion"],
            duration_min=2,
            duration_typical_min=3,
            duration_max=5,
        ),
        _step(text="Serve.", duration_min=1, duration_typical_min=1, duration_max=2),
    ]


def test_no_warning_when_no_chapters() -> None:
    recipe = _recipe(_two_stage_steps(), chapters=[])
    result = build_graph(recipe, "Chop the onions. Serve.", graph_id="g", source=SOURCE)
    assert result.graph is not None
    assert corroborate(recipe, result.graph) == []


def test_no_warning_when_counts_dont_align() -> None:
    """LOCKED DECISION 9: mismatched counts skip silently -- no warning, no gate."""
    chapters = [
        NormalizedChapter(label="Intro", start_sec=0, end_sec=10),
        NormalizedChapter(label="Prep", start_sec=10, end_sec=60),
        NormalizedChapter(label="Cook", start_sec=60, end_sec=300),
        NormalizedChapter(label="Plate", start_sec=300, end_sec=340),
        NormalizedChapter(label="Outro", start_sec=340, end_sec=360),
    ]
    recipe = _recipe(_two_stage_steps(), chapters=chapters)
    result = build_graph(recipe, "Chop the onions. Serve.", graph_id="g", source=SOURCE)
    assert result.graph is not None
    assert corroborate(recipe, result.graph) == []


def test_warns_on_gross_divergence() -> None:
    """The prep stage is scheduled at 10 min; the creator spent 90s on screen for the
    matching chapter -- a >=3x divergence, per corroborate.py's threshold."""
    steps = [
        _step(
            text="Chop the onions.",
            consumes_ingredients=["Onion"],
            duration_min=8,
            duration_typical_min=10,
            duration_max=12,
        ),
        _step(text="Serve.", duration_min=1, duration_typical_min=1, duration_max=2),
    ]
    chapters = [
        NormalizedChapter(label="Intro", start_sec=0, end_sec=5),
        NormalizedChapter(label="Prep", start_sec=5, end_sec=95),  # 90s on screen
        NormalizedChapter(label="Serve", start_sec=95, end_sec=155),  # 1 min, matches finish
        NormalizedChapter(label="Outro", start_sec=155, end_sec=160),
    ]
    recipe = _recipe(steps, chapters=chapters)
    result = build_graph(recipe, "Chop the onions. Serve.", graph_id="g", source=SOURCE)
    assert result.graph is not None
    warnings = corroborate(recipe, result.graph)
    assert len(warnings) == 1
    assert "advisory only" in warnings[0]


def test_does_not_mutate_the_graph() -> None:
    chapters = [
        NormalizedChapter(label="Intro", start_sec=0, end_sec=5),
        NormalizedChapter(label="Prep", start_sec=5, end_sec=95),
        NormalizedChapter(label="Outro", start_sec=95, end_sec=100),
    ]
    recipe = _recipe(_two_stage_steps(), chapters=chapters)
    result = build_graph(recipe, "Chop the onions. Serve.", graph_id="g", source=SOURCE)
    assert result.graph is not None
    before = result.graph.model_copy(deep=True)
    corroborate(recipe, result.graph)
    assert result.graph == before
