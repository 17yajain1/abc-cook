"""Freeze a few `RecipePlanResponse` payloads for the web unit tests.

Web test suites run against real scheduler output, but the web test run has no Python.
This writes the payloads they need into the web package. Re-run after any change to the
schema or the scheduler:

    python apps/api/scripts/export_web_fixtures.py
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from abc_cook.api.routes.recipes import burner_capacity_for, load_graph
from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.graph import GraphBuildResult, build_graph
from abc_cook.extract.normalize import render_source_text
from abc_cook.schedule import schedule, stage_spans, summarize
from abc_cook.schema import CookingGraph, RecipePlanResponse
from abc_cook.schema.graph import SourceRef
from abc_cook.schema.normalized import NormalizedIngredient, NormalizedRecipe, NormalizedStep

# Straightforward (kadai-paneer), degrades to nothing (maggi-2min), two windows and
# 4-way concurrency (chicken-biryani), a 60-min clamp case (homemade-donuts),
# non-integer minutes with off-thread freshness-held tasks (strawberry-shortcake), a
# sixth, hand-authored fixture the layout algorithm has never been tuned against
# (synthetic-two-windows), and a seventh proving the M3.1a session-timing fields are
# generic over any long unattended node, not just a rise or a rest
# (synthetic-two-sittings) — see docs/GRAPH_VIEW.md and the M3.1a plan §2 row 2'.
SLUGS = [
    "kadai-paneer",
    "maggi-2min",
    "chicken-biryani",
    "homemade-donuts",
    "strawberry-shortcake",
    "synthetic-two-windows",
    "synthetic-two-sittings",
]

# Slugs replayed from a captured import fixture instead of a hand-authored graph —
# pizza's dough rest is the multi-sitting shape with misaligned (kind-based) stages
# that M3.2b's source-section stages fix; until then it stays a Vitest fixture only
# (M3.1a plan §9), not part of the recipe picker `SLUGS` above.
IMPORT_REPLAYS = ["pizza-dough"]

IMPORT_FIXTURES = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "import"

# Shared test data, not Plan-specific: the M2.75 Map's layout.test.ts reads these too.
OUT = Path(__file__).resolve().parents[2] / "web" / "src" / "__fixtures__"


def replay_import(slug: str) -> CookingGraph:
    """Rebuild a graph from a captured import fixture, offline.

    Runs the same production path (`render_source_text` -> `build_graph`) that
    `test_summary.py`'s pizza replay and `test_extract_replay.py` already exercise
    against this fixture — no LLM or network call. `graph_id` and `imported_at` are
    fixed so re-running this script produces byte-identical output.

    Args:
        slug: Basename shared by `<slug>.normalized.json` and `<slug>.raw.json` in
            `tests/fixtures/import/`.

    Returns:
        The rebuilt graph.

    Raises:
        RuntimeError: If extraction degraded instead of producing a graph.
    """
    recipe = NormalizedRecipe.model_validate_json(
        (IMPORT_FIXTURES / f"{slug}.normalized.json").read_text(encoding="utf-8"),
    )
    raw = RawAcquisition.model_validate_json(
        (IMPORT_FIXTURES / f"{slug}.raw.json").read_text(encoding="utf-8"),
    )
    source_text = render_source_text(raw)
    source = SourceRef(
        kind="url",
        value="https://youtu.be/WM1XcYXix0Y",
        imported_at=datetime(2026, 1, 1, tzinfo=UTC),
    )
    result = build_graph(
        recipe,
        source_text,
        graph_id=f"g_{slug.replace('-', '_')}_replay",
        source=source,
    )
    if result.graph is None:
        msg = f"replay for {slug!r} degraded instead of producing a graph"
        raise RuntimeError(msg)
    return result.graph


def synthetic_defaulted_servings() -> GraphBuildResult:
    """P1 #5 Commit 4: the one scenario no other fixture here exercises.

    Every hand-authored `SLUGS` graph states its own servings directly (§R5) and
    every `IMPORT_REPLAYS` capture states servings too — none of them ever
    produces `SERVINGS_DEFAULTED_WARNING`. This synthetic recipe (no `servings`
    claim, no `yield_text`) runs through the real `build_graph()` path specifically
    to freeze one payload where the warning fires. Returns the full
    `GraphBuildResult` (not just `.graph`) because the warning itself lives on
    `.warnings` -- `RecipePlanResponse` has no field for it (it only ever carries
    the scheduler's own `plan.warnings`), so `main()` freezes it into a second,
    tiny companion JSON file for `servings.test.ts`'s drift-protection check.
    """
    recipe = NormalizedRecipe(
        title="Synthetic Defaulted Servings",
        method_grounded=True,
        servings=None,
        yield_text=None,
        ingredients=[NormalizedIngredient(name="Water", qty="1", unit="cup", prep_note=None)],
        steps=[
            NormalizedStep(
                text="Boil the water and serve.",
                attention="hands_on",
                duration_stated=False,
                consumes_ingredients=["Water"],
                station="burner",
                interruptible=False,
                freshness="none",
            )
        ],
    )
    source_text = "Synthetic Defaulted Servings. Boil the water and serve."
    source = SourceRef(
        kind="text", value=source_text, imported_at=datetime(2026, 1, 1, tzinfo=UTC)
    )
    result = build_graph(
        recipe, source_text, graph_id="g_synthetic_defaulted_servings", source=source
    )
    if result.graph is None:
        msg = "synthetic-defaulted-servings degraded instead of producing a graph"
        raise RuntimeError(msg)
    if result.graph.servings_stated:
        msg = "synthetic-defaulted-servings did not exercise the default — fixture is stale"
        raise RuntimeError(msg)
    return result


def _write(slug: str, graph: CookingGraph, *, capacity: int) -> None:
    plan = schedule(graph, burner_capacity=capacity)
    payload = RecipePlanResponse(
        graph=graph,
        plan=plan,
        stages=stage_spans(graph, plan),
        summary=summarize(graph, plan, burner_capacity=capacity),
    )
    (OUT / f"{slug}.plan-response.json").write_text(
        payload.model_dump_json(indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {slug}")


def main() -> None:
    """Write every fixture: `SLUGS`, `IMPORT_REPLAYS`, and the synthetic one.

    Also writes the synthetic fixture's companion warnings file.
    """
    OUT.mkdir(parents=True, exist_ok=True)
    for slug in SLUGS:
        _write(slug, load_graph(slug), capacity=burner_capacity_for(slug))
    for slug in IMPORT_REPLAYS:
        _write(slug, replay_import(slug), capacity=1)

    defaulted = synthetic_defaulted_servings()
    assert defaulted.graph is not None  # checked inside synthetic_defaulted_servings()
    _write("synthetic-defaulted-servings", defaulted.graph, capacity=1)
    (OUT / "synthetic-defaulted-servings.import-warnings.json").write_text(
        json.dumps({"warnings": defaulted.warnings}, indent=2) + "\n",
        encoding="utf-8",
    )
    print("wrote synthetic-defaulted-servings.import-warnings.json")


if __name__ == "__main__":
    main()
