"""A4 + C1 reasoning-effort A/B (competitor-audit plan, order step 3).

THIS MAKES LIVE LLM CALLS (GPT-5-mini extraction, Sonnet only if repair fires), capped by
`--budget-inr`. Cache is off by construction (there is no cache yet). Production effort is
not changed by anything here: each run passes `extraction_effort=<arm>` to `run_import`.

Inputs (positional), mixed freely:
  * a URL            -- acquired ONCE and the RawAcquisition reused by every arm and rep,
                        so arms differ only in effort, never in acquisition variance;
  * a *.raw.json     -- a saved RawAcquisition (tests/fixtures/import/);
  * text:<path>      -- a pasted-text recipe file.

Arms: `--arms minimal,low,medium` (`medium` sends the provider default, i.e. production,
as `None`). `--n` reps per (input, arm). Runs are interleaved and executed on a small
thread pool.

Per run it records: stage seconds, extraction latency, output/reasoning tokens, cost,
tier, degraded, pre-repair violations (rules, plus messages recomputed OFFLINE from the
recorded extraction), repair attempted/skip reason, steps, windows, parallel tasks
(nodes assigned into wait windows), and a graph fingerprint (node labels + dependency
edges) so arms can be diffed. The model's raw `NormalizedRecipe` for every extraction
call is saved next to the result (these become the offline replay fixtures, C4).

Usage:
    python apps/api/scripts/effort_ab.py --out DIR --arms low,medium --n 2 INPUT [INPUT ...]
    python apps/api/scripts/effort_ab.py --report DIR          # re-print the table, no calls
"""

# ruff: noqa: D101, D102, D103, D107

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

API_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(API_ROOT / ".env")
sys.path.insert(0, str(API_ROOT))

from abc_cook.extract.acquire import RawAcquisition  # noqa: E402
from abc_cook.extract.acquire.pipeline import acquire  # noqa: E402
from abc_cook.extract.acquire.text import from_pasted_text  # noqa: E402
from abc_cook.extract.adapters.base import EffortLevel, ExtractResult  # noqa: E402
from abc_cook.extract.adapters.routing import build_default_adapter  # noqa: E402
from abc_cook.extract.graph import build_graph  # noqa: E402
from abc_cook.extract.import_pipeline import ImportTelemetry, run_import  # noqa: E402
from abc_cook.extract.normalize import render_source_text  # noqa: E402
from abc_cook.extract.validate import validate  # noqa: E402
from abc_cook.schema.graph import CookingGraph, SourceRef  # noqa: E402
from abc_cook.schema.normalized import ImportResult, NormalizedRecipe  # noqa: E402

ARM_EFFORT: dict[str, EffortLevel | None] = {
    "minimal": "minimal",
    "low": "low",
    "medium": None,  # provider default == production
    "high": "high",
}


class RecordingAdapter:
    """Delegates to the real adapter and keeps every extraction's parsed output."""

    def __init__(self, inner: Any) -> None:
        self._inner = inner
        self.recipes: list[NormalizedRecipe] = []

    def extract(self, **kwargs: Any) -> ExtractResult[Any]:
        result: ExtractResult[Any] = self._inner.extract(**kwargs)
        if isinstance(result.recipe, NormalizedRecipe):
            self.recipes.append(result.recipe)
        return result


@dataclass
class Budget:
    cap_inr: float
    spent: float = 0.0
    unpriced: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)

    def add(self, cost: float | None) -> None:
        with self.lock:
            if cost is None:
                self.unpriced += 1
            else:
                self.spent += cost

    def exhausted(self) -> bool:
        with self.lock:
            return self.spent >= self.cap_inr


def _slug(text: str) -> str:
    keep = "".join(c if c.isalnum() else "-" for c in text).strip("-")
    return keep[-48:] or "input"


def load_input(spec: str, out: Path) -> tuple[str, RawAcquisition]:
    """Resolve one positional input to `(name, RawAcquisition)`; URLs are acquired once."""
    if spec.startswith("text:"):
        path = Path(spec[5:])
        return path.stem, from_pasted_text(path.read_text(encoding="utf-8"))
    if spec.endswith(".raw.json"):
        path = Path(spec)
        raw = RawAcquisition.model_validate_json(path.read_text(encoding="utf-8"))
        return path.name.removesuffix(".raw.json"), raw
    name = _slug(spec)
    cached = out / f"{name}.raw.json"
    if cached.exists():
        return name, RawAcquisition.model_validate_json(cached.read_text(encoding="utf-8"))
    raw = acquire(spec)
    cached.write_text(raw.model_dump_json(indent=2), encoding="utf-8")
    return name, raw


def fingerprint(graph: CookingGraph) -> dict[str, Any]:
    """Order-independent shape of a graph: node labels and label->label dependency edges."""
    label = {n.id: n.label.strip().lower() for n in graph.nodes}
    edges = sorted(f"{label[d]} -> {label[n.id]}" for n in graph.nodes for d in n.depends_on)
    return {"nodes": sorted(label.values()), "edges": edges}


def parallel_tasks(result: ImportResult) -> int:
    """Nodes the scheduler placed inside wait windows."""
    if result.plan is None:
        return 0
    return sum(len(w.assigned) for w in result.plan.windows)


def offline_violations(raw: RawAcquisition, recipe: NormalizedRecipe) -> list[dict[str, str]]:
    """The first extraction's pre-repair violations WITH messages, recomputed offline."""
    from datetime import UTC, datetime

    source = SourceRef(kind=raw.source_kind, value=raw.source_url, imported_at=datetime.now(UTC))
    built = build_graph(recipe, render_source_text(raw), graph_id="g_ab", source=source)
    if built.graph is None:
        return [{"rule": "build_graph_refused", "message": "; ".join(built.warnings)}]
    return [{"rule": v.rule, "message": v.message} for v in validate(built.graph)]


def one_run(
    name: str, raw: RawAcquisition, arm: str, rep: int, out: Path, real: Any, budget: Budget
) -> dict[str, Any] | None:
    if budget.exhausted():
        print(f"SKIP {name}/{arm}/{rep}: budget cap reached", flush=True)
        return None
    run_id = f"{name}__{arm}__{rep}"
    adapter = RecordingAdapter(real)
    box: list[ImportTelemetry] = []
    t0 = time.monotonic()
    try:
        result = run_import(
            raw.source_url,
            adapter,
            graph_id=f"g_{run_id}"[:60],
            acquire_fn=lambda _u: raw,
            on_telemetry=box.append,
            extraction_effort=ARM_EFFORT[arm],
        )
    except Exception as exc:
        print(f"FAIL {run_id}: {type(exc).__name__}: {exc}", flush=True)
        return {"run_id": run_id, "input": name, "arm": arm, "rep": rep, "error": str(exc)}
    wall = time.monotonic() - t0
    tele = box[0]
    budget.add(tele.cost_inr)

    for i, recipe in enumerate(adapter.recipes):
        (out / f"{run_id}.call{i}.normalized.json").write_text(
            recipe.model_dump_json(indent=2), encoding="utf-8"
        )
    (out / f"{run_id}.result.json").write_text(result.model_dump_json(indent=2), encoding="utf-8")

    row: dict[str, Any] = {
        "run_id": run_id,
        "input": name,
        "arm": arm,
        "rep": rep,
        "status": result.status,
        "tier": tele.tier,
        "degraded": tele.degraded,
        "wall_s": round(wall, 1),
        "extract_s": round(tele.stage_s.get("extract", 0.0), 1),
        "repair_s": round(tele.stage_s.get("repair", 0.0), 1),
        "output_tokens": tele.output_tokens,
        "reasoning_tokens": tele.reasoning_tokens,
        "cost_inr": tele.cost_inr,
        "truncations": tele.extraction_truncations,
        "violations": tele.violations_pre_repair,
        "repair_attempted": tele.repair_attempted,
        "skip_reason": tele.repair_skip_reason,
        "steps": tele.step_count,
        "windows": tele.windows,
        "parallel_tasks": parallel_tasks(result),
        "warnings": result.warnings,
    }
    if tele.violations_pre_repair and adapter.recipes:
        row["violation_messages"] = offline_violations(raw, adapter.recipes[0])
    if result.graph is not None:
        row["fingerprint"] = fingerprint(result.graph)
    print(
        f"done {run_id}: tier={row['tier']} extract={row['extract_s']}s "
        f"reasoning={row['reasoning_tokens']} cost={row['cost_inr']} "
        f"violations={row['violations']} parallel={row['parallel_tasks']} "
        f"[spent {budget.spent:.2f}/{budget.cap_inr:.0f}]",
        flush=True,
    )
    return row


def _jaccard(a: list[str], b: list[str]) -> float:
    sa, sb = set(a), set(b)
    return 1.0 if not sa and not sb else len(sa & sb) / len(sa | sb)


def report(rows: list[dict[str, Any]], out: Path) -> None:
    """Per (input, arm): means and rates, plus edge similarity to the medium arm."""
    ok = [r for r in rows if "error" not in r]
    by: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for r in ok:
        by[(r["input"], r["arm"])].append(r)

    def mean(rs: list[dict[str, Any]], key: str) -> float | None:
        vals = [r[key] for r in rs if r.get(key) is not None]
        return round(sum(vals) / len(vals), 1) if vals else None

    header = (
        "input",
        "arm",
        "n",
        "extract_s",
        "reason_tok",
        "inr",
        "degraded",
        "viol_runs",
        "parallel",
        "windows",
        "steps",
        "edges~medium",
    )
    lines = [header]
    for (name, arm), rs in sorted(by.items()):
        ref = by.get((name, "medium"))
        sim = "-"
        if ref and arm != "medium":
            sims = [
                _jaccard(a["fingerprint"]["edges"], b["fingerprint"]["edges"])
                for a in rs
                for b in ref
                if "fingerprint" in a and "fingerprint" in b
            ]
            sim = f"{sum(sims) / len(sims):.2f}" if sims else "-"
        lines.append(
            (
                name[:28],
                arm,
                str(len(rs)),
                str(mean(rs, "extract_s")),
                str(mean(rs, "reasoning_tokens")),
                str(mean(rs, "cost_inr")),
                f"{sum(r['degraded'] for r in rs)}/{len(rs)}",
                f"{sum(bool(r['violations']) for r in rs)}/{len(rs)}",
                str(mean(rs, "parallel_tasks")),
                str(mean(rs, "windows")),
                str(mean(rs, "steps")),
                sim,
            )
        )
    widths = [max(len(line[i]) for line in lines) for i in range(len(header))]
    text = "\n".join(
        "  ".join(c.ljust(w) for c, w in zip(line, widths, strict=True)) for line in lines
    )
    print(text)
    (out / "summary.txt").write_text(text + "\n", encoding="utf-8")
    (out / "results.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")


def main() -> None:
    """Run (or re-report) the A/B."""
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("inputs", nargs="*")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--arms", default="low,medium")
    parser.add_argument("--n", type=int, default=2)
    parser.add_argument("--budget-inr", type=float, default=50.0)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--report", type=Path, help="re-print the table from DIR/results.json")
    args = parser.parse_args()

    if args.report:
        report(json.loads((args.report / "results.json").read_text(encoding="utf-8")), args.report)
        return
    if not args.out or not args.inputs:
        parser.error("--out and at least one input are required")
    args.out.mkdir(parents=True, exist_ok=True)

    arms = args.arms.split(",")
    for arm in arms:
        if arm not in ARM_EFFORT:
            parser.error(f"unknown arm {arm!r}")

    loaded = [load_input(spec, args.out) for spec in args.inputs]
    real = build_default_adapter()
    budget = Budget(cap_inr=args.budget_inr)
    jobs = [(n, raw, arm, rep) for rep in range(args.n) for n, raw in loaded for arm in arms]
    rows: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [
            pool.submit(one_run, n, raw, arm, rep, args.out, real, budget)
            for n, raw, arm, rep in jobs
        ]
        rows = [r for f in futures if (r := f.result()) is not None]
    print(f"\nspent INR {budget.spent:.2f} (unpriced calls: {budget.unpriced})")
    report(rows, args.out)


if __name__ == "__main__":
    main()
