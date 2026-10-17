r"""Measure when the streamed draft becomes visible, as a client polling the API would see it.

INR 0: the real FastAPI app runs in a uvicorn thread with the replay adapter and a stand-in
acquire (see `abc_cook/devtools/replay.py`); nothing touches a key, the network or YouTube.

    python apps/api/scripts/stream_draft_bench.py --out notes/pr-s2-streamed-draft/replay.json

For each fixture it POSTs `/import`, then polls at the web's 1.2 s cadence and records the first
poll that shows: `acquired`, the ingredients, the first step, `steps_complete` and a terminal
status, as seconds since the POST. n=3 per fixture on the clean script, plus a retry run
(`invalid_json,ok`) and a stall run (`stall_after:<chars>`). It also records the largest
draft-bearing poll, raw and as sent over the wire with gzip.

Calibration caveat, printed with the table: the replay pace comes from ONE measured run (REPORT
T6, kadhi, n=1). These are the timings of the plumbing at that pace, not of any real import.
"""

from __future__ import annotations

import argparse
import gzip
import json
import statistics
import sys
import threading
import time
from pathlib import Path
from typing import Any

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

import httpx  # noqa: E402
import uvicorn  # noqa: E402

from abc_cook.devtools.replay import (  # noqa: E402
    FIXTURE_NAMES,
    create_replay_app,
    load_fixture,
)

POLL_S = 1.2
TERMINAL = {"done", "failed", "method_not_grounded", "no_recipe_found"}
METADATA_AT_S = 3.5
DONE_AT_S = 6.0
TARGETS = {"first_ingredient_s": 15.0, "first_step_s": 20.0, "done_s": 40.0}
"""Upper bounds from the plan's section 6: the first ingredient at most 15 s typical (20 s
worst), the first step at about 18-20 s, and the full plan at most 40 s typical."""


def _serve(app: Any, port: int) -> tuple[uvicorn.Server, threading.Thread]:
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(100):
        if server.started:
            return server, thread
        time.sleep(0.05)
    raise RuntimeError("replay server did not start")


def run_once(fixture: str, script: list[str], port: int, speed: float) -> dict[str, Any]:
    """One import against a fresh replay server; returns the poll-observed timeline."""
    app = create_replay_app(
        load_fixture(fixture),
        script,
        speed=speed,
        metadata_at_s=METADATA_AT_S,
        done_at_s=DONE_AT_S,
    )
    server, thread = _serve(app, port)
    marks: dict[str, float] = {}
    max_raw = max_wire = 0  # largest in-flight poll that carries a draft
    last_raw = last_wire = 0  # the terminal poll, which also carries the result
    final: dict[str, Any] = {}
    polls = 0
    try:
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=30) as client:
            t0 = time.monotonic()
            job_id = client.post("/import", json={"url": "https://youtu.be/replay-bench"}).json()[
                "job_id"
            ]
            while True:
                response = client.get(f"/import/{job_id}")
                now = time.monotonic() - t0
                polls += 1
                job = response.json()
                draft = job.get("draft")
                if job.get("acquired") is not None:
                    marks.setdefault("acquired_s", now)
                if draft is not None:
                    raw = len(response.content)
                    if job["status"] not in TERMINAL and raw > max_raw:
                        max_raw, max_wire = raw, response.num_bytes_downloaded
                    if draft["ingredients"]:
                        marks.setdefault("first_ingredient_s", now)
                    if draft["ingredients_complete"]:
                        marks.setdefault("ingredients_s", now)
                    if draft["steps"]:
                        marks.setdefault("first_step_s", now)
                    if draft["steps_complete"]:
                        marks.setdefault("steps_complete_s", now)
                if job["status"] in TERMINAL:
                    marks["done_s"] = now
                    final = job
                    last_raw, last_wire = len(response.content), response.num_bytes_downloaded
                    break
                time.sleep(POLL_S)
    finally:
        server.should_exit = True
        thread.join(timeout=10)
    draft = final.get("draft") or {}
    draft_json = json.dumps(draft, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return {
        "fixture": fixture,
        "script": script,
        "speed": speed,
        "marks": {k: round(v, 2) for k, v in marks.items()},
        "status": final.get("status"),
        "failure": (final.get("result") or {}).get("failure"),
        "draft_calls": draft.get("calls"),
        "draft_ingredients": len(draft.get("ingredients") or []),
        "draft_steps": len(draft.get("steps") or []),
        "polls": polls,
        "max_inflight_poll_bytes_raw": max_raw,
        "max_inflight_poll_bytes_gzip": max_wire,
        "terminal_poll_bytes_raw": last_raw,
        "terminal_poll_bytes_gzip": last_wire,
        "draft_only_bytes_raw": len(draft_json),
        "draft_only_bytes_gzip": len(gzip.compress(draft_json)),
    }


def _median_max(runs: list[dict[str, Any]], key: str) -> str:
    values = [r["marks"][key] for r in runs if key in r["marks"]]
    if not values:
        return "-"
    return f"{statistics.median(values):.1f} / {max(values):.1f}"


def table(rows: list[dict[str, Any]]) -> str:
    """The section 6 table: median / max over the runs of each fixture + script."""
    groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for row in rows:
        groups.setdefault((row["fixture"], ",".join(row["script"])), []).append(row)
    lines = [
        "| fixture | script | n | status | acquired s | first ingredient s | "
        "ingredients complete s | first step s | steps done s | done s | calls | "
        "in-flight poll gzip / raw bytes | draft alone gzip / raw |",
        "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for (fixture, script), runs in groups.items():
        largest = max(runs, key=lambda r: r["max_inflight_poll_bytes_raw"])
        statuses = "/".join(sorted({f"{r['status']}" for r in runs}))
        lines.append(
            f"| {fixture} | {script} | {len(runs)} | {statuses} | "
            f"{_median_max(runs, 'acquired_s')} | {_median_max(runs, 'first_ingredient_s')} | "
            f"{_median_max(runs, 'ingredients_s')} | {_median_max(runs, 'first_step_s')} | "
            f"{_median_max(runs, 'steps_complete_s')} | "
            f"{_median_max(runs, 'done_s')} | {runs[0]['draft_calls']} | "
            f"{largest['max_inflight_poll_bytes_gzip']:,} / "
            f"{largest['max_inflight_poll_bytes_raw']:,} | "
            f"{largest['draft_only_bytes_gzip']:,} / {largest['draft_only_bytes_raw']:,} |"
        )
    return "\n".join(lines)


def main() -> None:
    """Run the matrix and write the JSON."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--repeat", type=int, default=3)
    parser.add_argument("--speed", type=float, default=1.0, help="divide every delay (smoke runs)")
    parser.add_argument("--port", type=int, default=8790)
    parser.add_argument("--fixtures", nargs="*", default=FIXTURE_NAMES)
    parser.add_argument("--skip-failure-rows", action="store_true")
    args = parser.parse_args()

    plan: list[tuple[str, list[str], int]] = [(f, ["ok"], args.repeat) for f in args.fixtures]
    if not args.skip_failure_rows:
        plan.append(("kadhi-pakora", ["invalid_json", "ok"], 1))
        plan.append(("kadhi-pakora", ["stall_after:3000"], 1))

    rows: list[dict[str, Any]] = []
    port = args.port
    for fixture, script, repeat in plan:
        for i in range(repeat):
            print(f"running {fixture} {script} #{i + 1}", flush=True)
            row = run_once(fixture, script, port, args.speed)
            port += 1
            print(f"  {row['status']} {row['marks']}", flush=True)
            rows.append(row)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(
            {
                "note": "Replay calibrated from REPORT T6 (kadhi, n=1). INR 0. "
                "Times are seconds since the POST, as first seen by a 1.2 s poll.",
                "poll_s": POLL_S,
                "metadata_at_s": METADATA_AT_S,
                "done_at_s": DONE_AT_S,
                "speed": args.speed,
                "targets": TARGETS,
                "rows": rows,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print()
    print(table(rows))
    print()
    print("Calibrated from REPORT T6 (kadhi, n=1): a model of the plumbing, not of any recipe.")


if __name__ == "__main__":
    main()
