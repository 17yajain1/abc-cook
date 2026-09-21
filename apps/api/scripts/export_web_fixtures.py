"""Freeze a few `RecipePlanResponse` payloads for the web unit tests.

Web test suites run against real scheduler output, but the web test run has no Python.
This writes the payloads they need into the web package. Re-run after any change to the
schema or the scheduler:

    python apps/api/scripts/export_web_fixtures.py
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from abc_cook.api.routes.recipes import burner_capacity_for, load_graph
from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.graph import build_graph
from abc_cook.extract.normalize import render_source_text
from abc_cook.schedule import schedule, stage_spans, summarize
from abc_cook.schema import CookingGraph, RecipePlanResponse
from abc_cook.schema.graph import SourceRef
from abc_cook.schema.normalized import NormalizedRecipe

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
    """Write `<slug>.plan-response.json` for each slug in `SLUGS` and `IMPORT_REPLAYS`."""
    OUT.mkdir(parents=True, exist_ok=True)
    for slug in SLUGS:
        _write(slug, load_graph(slug), capacity=burner_capacity_for(slug))
    for slug in IMPORT_REPLAYS:
        _write(slug, replay_import(slug), capacity=1)


if __name__ == "__main__":
    main()
