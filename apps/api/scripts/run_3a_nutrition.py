"""3a B2/B3: run the nutrition calculator over the eval fixtures.

For each `tests/fixtures/3a-eval/*.original.json` (or just `--ids`): `reprocess()` (no LLM) ->
`resolve_recipe` (curated alias/no_food, cache, then at most ONE gpt-5-mini call for what is left)
-> `compute_nutrition` with the graph's nodes. Writes `notes/3a-nutrition/<results-name>` (the
full `RecipeNutrition` per recipe plus ₹, latency and counts; default `b2-results.json`) and
`<lines-name>` (every line: food, grams, basis, kcal, portion, hint, flags, fat working).

Resumable: matches are cached in `apps/api/data/food_map.json` (gitignored), so a re-run makes
no calls. The mapping spend is capped (default ₹40); a refused call stops the run.

This script reads no reference values at all: the comparison is Step 6's job.

Usage:
    python apps/api/scripts/run_3a_nutrition.py --env-file "C:/.../ABC cook/apps/api/.env"
    python apps/api/scripts/run_3a_nutrition.py --no-llm --out-dir <scratch>    # offline dry run
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

API_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = API_ROOT.parents[1]
sys.path.insert(0, str(API_ROOT))

from abc_cook.extract.adapters.base import LLMAdapter  # noqa: E402
from abc_cook.extract.adapters.routing import build_default_adapter  # noqa: E402
from abc_cook.extract.postprocess import reprocess  # noqa: E402
from abc_cook.nutrition import NUTRITION_VERSION  # noqa: E402
from abc_cook.nutrition.calc import compute_nutrition  # noqa: E402
from abc_cook.nutrition.foods import load_foods  # noqa: E402
from abc_cook.nutrition.match import (  # noqa: E402
    MATCH_MODEL,
    SHORTLIST_METHOD,
    SPEND_CAP_INR,
    JsonFileFoodMapStore,
    ShortlistIndex,
    SpendGuard,
    resolve_recipe,
)
from abc_cook.schema.normalized import ImportOriginal  # noqa: E402

FIXTURE_DIR = API_ROOT / "tests" / "fixtures" / "3a-eval"
NOTES_DIR = REPO_ROOT / "notes" / "3a-nutrition"
FOOD_MAP_PATH = API_ROOT / "data" / "food_map.json"


def _fixture_id(path: Path) -> int:
    return int(path.name.split("-")[0])


def _cell(value: Any) -> str:
    return "" if value is None else str(value).replace("|", "\\|").replace("\n", " ")


def _lines_md(recipes: list[dict[str, Any]], title: str) -> str:
    out = [f"# {title}", ""]
    for rec in recipes:
        nutrition = rec["nutrition"]
        out += [
            f"## {rec['id']}. {rec['title']}",
            "",
            f"- Servings: {nutrition['servings_basis']} ({nutrition['servings_basis_source']})",
            f"- Per serving: {nutrition['per_serving']['kcal']:.0f} kcal, "
            f"{nutrition['per_serving']['protein_g']:.1f} g protein, "
            f"{nutrition['per_serving']['carbs_g']:.1f} g carbs, "
            f"{nutrition['per_serving']['fat_g']:.1f} g fat, "
            f"{nutrition['per_serving']['fibre_g']:.1f} g fibre",
            f"- Confidence: {nutrition['confidence']} (shadow {nutrition['confidence_proposed']}); "
            f"diet: {nutrition['diet']}",
            "",
            "| # | line | food | grams | basis | kcal | portion | hint | flags | miss "
            "| fat_method | fat_rule | fried_g |",
            "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
        ]
        for row, miss in zip(nutrition["rows"], rec["misses"], strict=True):
            grams = "" if row["grams"] is None else f"{row['grams']:.1f}"
            portion = row["portion"]
            portion_text = (
                f"{portion['unit']} {portion['prep']} {portion['grams']}g" if portion else ""
            )
            flags = ", ".join(
                row["flags"]
                + ([f"excluded:{row['excluded_reason']}"] if row["excluded_reason"] else [])
            )
            cells = [
                row["ingredient_index"],
                row["line_text"],
                row["food"]["name"] if row["food"] else "",
                grams,
                row["grams_basis"],
                f"{row['est_kcal']:.0f}",
                portion_text,
                row["hint_reading"],
                flags,
                miss,
                row["fat_method"],
                row["fat_rule"],
                None if row["fried_grams"] is None else f"{row['fried_grams']:.0f}",
            ]
            out.append("| " + " | ".join(_cell(c) for c in cells) + " |")
        out.append("")
    return "\n".join(out)


def main() -> int:
    """Run the calculator over every fixture and write the results."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, help="dotenv file with the provider keys")
    parser.add_argument("--ids", type=int, nargs="*", help="only these ids")
    parser.add_argument("--cap-inr", type=float, default=SPEND_CAP_INR)
    parser.add_argument("--no-llm", action="store_true", help="never call the model (dry run)")
    parser.add_argument("--out-dir", type=Path, default=NOTES_DIR)
    parser.add_argument("--results-name", default="b2-results.json")
    parser.add_argument("--lines-name", default="b2-lines.md")
    parser.add_argument("--food-map", type=Path, default=FOOD_MAP_PATH)
    args = parser.parse_args()
    if args.env_file:
        load_dotenv(args.env_file)

    table = load_foods()
    index = ShortlistIndex(table)
    store = JsonFileFoodMapStore(args.food_map)
    guard = SpendGuard(args.cap_inr)
    adapter: LLMAdapter | None = None if args.no_llm else build_default_adapter()

    recipes: list[dict[str, Any]] = []
    stopped = False
    fixtures = sorted(FIXTURE_DIR.glob("*.original.json"), key=_fixture_id)
    for path in fixtures:
        row_id = _fixture_id(path)
        if args.ids and row_id not in args.ids:
            continue
        original = ImportOriginal.model_validate_json(path.read_text(encoding="utf-8"))
        result = reprocess(original).result
        graph = result.graph
        if result.status != "done" or graph is None:
            print(f"{row_id}: skipped (status {result.status})")
            continue
        started = time.perf_counter()
        resolutions, stats = resolve_recipe(
            graph.ingredients, table=table, store=store, adapter=adapter, guard=guard, index=index
        )
        match_s = time.perf_counter() - started
        started = time.perf_counter()
        nutrition = compute_nutrition(
            graph.ingredients,
            graph.servings,
            graph.servings_stated,
            result.warnings,
            resolutions,
            computed_at=datetime.now(UTC),
            table=table,
            nodes=graph.nodes,
        )
        compute_ms = (time.perf_counter() - started) * 1000
        recipes.append(
            {
                "id": row_id,
                "title": graph.title,
                "source": original.source.value,
                "servings": graph.servings,
                "servings_stated": graph.servings_stated,
                "review_recommended": result.review_recommended,
                "warnings": result.warnings,
                "ingredient_count": len(graph.ingredients),
                "match": {
                    "llm_calls": stats.llm_calls,
                    "inr": round(stats.inr, 4),
                    "latency_ms": round(stats.latency_ms, 1),
                    "match_wall_s": round(match_s, 3),
                    "cache_hits": stats.cache_hits,
                    "alias_hits": stats.alias_hits,
                    "exact_hits": stats.exact_hits,
                    "llm_matches": stats.llm_matches,
                    "misses": stats.misses,
                    "grams_requested": stats.grams_requested,
                    "grams_received": stats.grams_received,
                    "guard_refused": stats.guard_refused,
                },
                "compute_ms": round(compute_ms, 3),
                "misses": [r.miss or "" for r in resolutions],
                "nutrition": nutrition.model_dump(mode="json"),
            }
        )
        print(
            f"{row_id}: {nutrition.per_serving.kcal:.0f} kcal/serving, {nutrition.confidence}, "
            f"calls {stats.llm_calls}, ₹{stats.inr:.3f}, total ₹{guard.spent_inr:.2f}"
        )
        if stats.guard_refused:
            print(f"STOP: the spend guard refused a call (cap ₹{args.cap_inr})")
            stopped = True
            break

    document = {
        "header": {
            "foods_version": table.foods_version,
            "shortlist_method": SHORTLIST_METHOD,
            "model": MATCH_MODEL,
            "nutrition_version": NUTRITION_VERSION,
            "generated_at": datetime.now(UTC).isoformat(),
            "mapping_spend_inr": round(guard.spent_inr, 4),
            "cap_inr": args.cap_inr,
            "recipes": len(recipes),
            "stopped_by_guard": stopped,
        },
        "recipes": recipes,
    }
    args.out_dir.mkdir(parents=True, exist_ok=True)
    (args.out_dir / args.results_name).write_text(
        json.dumps(document, indent=1, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    title = f"3a: per-line working (nutrition v{NUTRITION_VERSION}, {args.results_name})"
    (args.out_dir / args.lines_name).write_text(_lines_md(recipes, title), encoding="utf-8")
    print(f"wrote {len(recipes)} recipes; mapping spend ₹{guard.spent_inr:.2f}")
    return 2 if stopped else 0


if __name__ == "__main__":
    raise SystemExit(main())
