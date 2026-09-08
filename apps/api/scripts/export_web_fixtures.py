"""Freeze a few `RecipePlanResponse` payloads for the web unit tests.

`apps/web/src/plan/derive.test.ts` runs against real scheduler output, but the web test
run has no Python. This writes the payloads it needs into the web package. Re-run after
any change to the schema or the scheduler:

    python apps/api/scripts/export_web_fixtures.py
"""

from __future__ import annotations

from pathlib import Path

from abc_cook.api.routes.recipes import burner_capacity_for, load_graph
from abc_cook.schedule import schedule, stage_spans
from abc_cook.schema import RecipePlanResponse

# One straightforward case, one that degrades to nothing, one with two windows.
SLUGS = ["kadai-paneer", "maggi-2min", "chicken-biryani"]

OUT = Path(__file__).resolve().parents[2] / "web" / "src" / "plan" / "__fixtures__"


def main() -> None:
    """Write `<slug>.plan-response.json` for each slug in `SLUGS`."""
    OUT.mkdir(parents=True, exist_ok=True)
    for slug in SLUGS:
        graph = load_graph(slug)
        plan = schedule(graph, burner_capacity=burner_capacity_for(slug))
        payload = RecipePlanResponse(graph=graph, plan=plan, stages=stage_spans(graph, plan))
        (OUT / f"{slug}.plan-response.json").write_text(
            payload.model_dump_json(indent=2) + "\n",
            encoding="utf-8",
        )
        print(f"wrote {slug}")


if __name__ == "__main__":
    main()
