"""A0 import bench: per-import timing table over a list of URLs.

Replays each URL through the real `run_import` (`notes/competitor-audit-plan-2026-09-30.md`
Workstream A).

THIS MAKES LIVE LLM CALLS -- one GPT-5-mini call per URL (Sonnet only if repair fires).
Run it only when spend is approved. Nothing here changes the pipeline; it reads the
`ImportTelemetry` that `run_import(on_telemetry=...)` already emits.

Columns: stage seconds (acquire / extract / graph / repair / sched), TTR and TTP
(time-to-readable-recipe / time-to-cooking-plan; equal until A2 adds a preview), output
and reasoning tokens, cost, tier. A3 will add COLD vs HIT columns once a cache exists.

Usage:
    python apps/api/scripts/import_bench.py URL [URL ...]
    python apps/api/scripts/import_bench.py --urls-file urls.txt   # one URL per line
    python apps/api/scripts/import_bench.py --json out.json URL ...  # also dump raw rows
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

API_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(API_ROOT / ".env")
sys.path.insert(0, str(API_ROOT))

from abc_cook.extract.adapters.routing import build_default_adapter  # noqa: E402
from abc_cook.extract.import_pipeline import ImportTelemetry, run_import  # noqa: E402

_STAGES = ("acquire", "extract", "build_graph", "repair", "schedule")
_HEADERS = (
    "url",
    "kind",
    "acq",
    "extract",
    "graph",
    "repair",
    "sched",
    "TTR",
    "TTP",
    "out_tok",
    "reason_tok",
    "inr",
    "tier",
)


def _row(url: str, t: ImportTelemetry) -> dict[str, Any]:
    return {
        "url": url,
        "kind": t.source_kind,
        "stage_s": {k: round(t.stage_s.get(k, 0.0), 2) for k in _STAGES},
        "ttr_s": round(t.ttr_s, 2),
        "ttp_s": round(t.ttp_s, 2),
        "output_tokens": t.output_tokens,
        "reasoning_tokens": t.reasoning_tokens,
        "cost_inr": t.cost_inr,
        "tier": t.tier,
        "degraded": t.degraded,
        "violations_pre_repair": t.violations_pre_repair,
        "windows": t.windows,
    }


def _cells(r: dict[str, Any]) -> list[str]:
    stages = r["stage_s"]
    cost = r["cost_inr"]
    reasoning = r["reasoning_tokens"]
    return [
        r["url"][-40:],
        r["kind"],
        *(f"{stages[k]:.1f}" for k in _STAGES),
        f"{r['ttr_s']:.1f}",
        f"{r['ttp_s']:.1f}",
        str(r["output_tokens"]),
        "-" if reasoning is None else str(reasoning),
        "-" if cost is None else f"{cost:.2f}",
        r["tier"],
    ]


def _print_table(rows: list[dict[str, Any]]) -> None:
    table = [list(_HEADERS), *(_cells(r) for r in rows)]
    widths = [max(len(row[i]) for row in table) for i in range(len(_HEADERS))]
    for row in table:
        print("  ".join(cell.ljust(w) for cell, w in zip(row, widths, strict=True)))


def main() -> None:
    """Run each URL, print the table, optionally dump JSON."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("urls", nargs="*")
    parser.add_argument("--urls-file", type=Path)
    parser.add_argument("--json", type=Path, dest="json_out")
    args = parser.parse_args()

    urls: list[str] = list(args.urls)
    if args.urls_file:
        urls += [ln.strip() for ln in args.urls_file.read_text().splitlines() if ln.strip()]
    if not urls:
        parser.error("give at least one URL")

    adapter = build_default_adapter()
    rows: list[dict[str, Any]] = []
    for i, url in enumerate(urls):
        box: list[ImportTelemetry] = []
        t0 = time.monotonic()
        try:
            run_import(url, adapter, graph_id=f"g_bench_{i}", on_telemetry=box.append)
        except Exception as exc:
            print(f"FAILED {url}: {type(exc).__name__}: {exc}", file=sys.stderr)
            continue
        if box:
            rows.append(_row(url, box[0]))
        print(f"done {url} in {time.monotonic() - t0:.1f}s", file=sys.stderr)

    _print_table(rows)
    if args.json_out:
        args.json_out.write_text(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()
