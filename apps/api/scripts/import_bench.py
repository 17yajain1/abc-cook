"""A0 import bench: per-import timing table over a list of URLs.

Replays each URL through the real `run_import` (`notes/competitor-audit-plan-2026-09-30.md`
Workstream A).

THIS MAKES LIVE LLM CALLS -- one GPT-5-mini call per URL (Sonnet only if repair fires);
the HIT run makes none. Run it only when spend is approved. Nothing here changes the
pipeline; it reads the `ImportTelemetry` that `run_import(on_telemetry=...)` already emits.

Each URL is imported twice (A3): run 1 with `fresh=True`, so it is always COLD and its
result is stored; run 2 normally, which should be a cache HIT. The stage/TTR/COLD_TTP/
tokens/cost/tier columns describe the COLD run; `HIT_TTP` and `hit` describe the second.
A result the cache refuses to store (degraded, Tier 0, ...) is not imported a second
time (that would be another live call): its `hit` shows `n/a (<tier>)` and HIT_TTP `-`,
so a cold number is never presented as a HIT. The cache lives in a fresh temporary
directory unless `--cache-dir` is given -- never the production cache.

Columns: stage seconds (acquire / extract / graph / repair / sched), TTR and COLD_TTP
(time-to-readable-recipe / time-to-cooking-plan; equal until A2 adds a preview), output
and reasoning tokens, cost, tier, then HIT_TTP and hit.

Usage:
    python apps/api/scripts/import_bench.py URL [URL ...]
    python apps/api/scripts/import_bench.py --urls-file urls.txt   # one URL per line
    python apps/api/scripts/import_bench.py --json out.json URL ...  # also dump raw rows
    python apps/api/scripts/import_bench.py --cache-dir DIR URL ...  # keep the cache
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

API_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(API_ROOT / ".env")
sys.path.insert(0, str(API_ROOT))

from abc_cook.extract.acquire import RawAcquisition  # noqa: E402
from abc_cook.extract.acquire.pipeline import acquire as default_acquire  # noqa: E402
from abc_cook.extract.adapters.base import LLMAdapter  # noqa: E402
from abc_cook.extract.adapters.routing import build_default_adapter  # noqa: E402
from abc_cook.extract.cache import DiskResultCache, ResultCache, is_cacheable  # noqa: E402
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
    "COLD_TTP",
    "out_tok",
    "reason_tok",
    "inr",
    "tier",
    "HIT_TTP",
    "hit",
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
        "-" if r["hit_ttp_s"] is None else f"{r['hit_ttp_s']:.2f}",
        r["hit"],
    ]


def _print_table(rows: list[dict[str, Any]]) -> None:
    table = [list(_HEADERS), *(_cells(r) for r in rows)]
    widths = [max(len(row[i]) for row in table) for i in range(len(_HEADERS))]
    for row in table:
        print("  ".join(cell.ljust(w) for cell, w in zip(row, widths, strict=True)))


def bench_url(
    url: str,
    index: int,
    adapter: LLMAdapter,
    cache: ResultCache,
    acquire_fn: Callable[[str], RawAcquisition] = default_acquire,
) -> dict[str, Any] | None:
    """COLD (fresh=True) then HIT for one URL; the COLD row plus `hit_ttp_s` / `hit`."""
    cold_box: list[ImportTelemetry] = []
    result = run_import(
        url,
        adapter,
        graph_id=f"g_bench_{index}",
        acquire_fn=acquire_fn,
        on_telemetry=cold_box.append,
        cache=cache,
        fresh=True,
    )
    if not cold_box:
        return None
    cold = cold_box[0]
    row = _row(url, cold)
    row["hit_ttp_s"] = None
    if not is_cacheable(result, cold.tier) or cold.source_kind == "text":
        row["hit"] = f"n/a ({cold.tier})"
        return row
    hit_box: list[ImportTelemetry] = []
    run_import(
        url,
        adapter,
        graph_id=f"g_bench_{index}_hit",
        acquire_fn=acquire_fn,
        on_telemetry=hit_box.append,
        cache=cache,
    )
    hit = hit_box[0] if hit_box else None
    if hit is not None and hit.cache_hit:
        row["hit_ttp_s"] = round(hit.ttp_s, 3)
        row["hit"] = "HIT"
    else:
        row["hit"] = "MISS"  # unexpected for a cacheable result; the time is not a HIT time
    return row


def main() -> None:
    """Run each URL, print the table, optionally dump JSON."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("urls", nargs="*")
    parser.add_argument("--urls-file", type=Path)
    parser.add_argument("--json", type=Path, dest="json_out")
    parser.add_argument(
        "--cache-dir",
        type=Path,
        help="Result-cache directory (default: a new temporary directory, so the "
        "production cache is never read or written).",
    )
    args = parser.parse_args()

    urls: list[str] = list(args.urls)
    if args.urls_file:
        urls += [ln.strip() for ln in args.urls_file.read_text().splitlines() if ln.strip()]
    if not urls:
        parser.error("give at least one URL")

    adapter = build_default_adapter()
    cache_dir = args.cache_dir or Path(tempfile.mkdtemp(prefix="abc_cook_bench_cache_"))
    print(f"result cache: {cache_dir}", file=sys.stderr)
    cache = DiskResultCache(cache_dir)
    rows: list[dict[str, Any]] = []
    for i, url in enumerate(urls):
        t0 = time.monotonic()
        try:
            row = bench_url(url, i, adapter, cache)
        except Exception as exc:
            print(f"FAILED {url}: {type(exc).__name__}: {exc}", file=sys.stderr)
            continue
        if row is not None:
            rows.append(row)
        print(f"done {url} in {time.monotonic() - t0:.1f}s", file=sys.stderr)

    _print_table(rows)
    if args.json_out:
        args.json_out.write_text(json.dumps(rows, indent=2))


if __name__ == "__main__":
    main()
