r"""PR-S3 live bench: strict structured output on/off x effort, on the frozen raw acquisitions.

Each call goes through the same code the import route runs: `run_import` with a
`DraftingAdapter` (so the draft milestones are the ones a cook would see), the real
`build_default_adapter()` and the route's own `_log_import_cost`, whose `import cost:` line is the
spend record. Acquisition is replaced by the frozen `*.raw.json` at 0 s: no yt-dlp, no captions,
no YouTube. Repair is never called: the Anthropic key is set invalid in this process and a repair
request is answered locally with an `infra` error ("repair would fire" is recorded instead).

    # INR 0: prints the run list with reservations, then smokes the code path on a mock transport
    python apps/api/scripts/strict_bench.py --dry --out notes/pr-s3-strict-output

    # live (OPENAI_API_KEY is read from the main checkout's .env, never printed)
    python apps/api/scripts/strict_bench.py --live --rows 1 --out notes/pr-s3-strict-output
    python apps/api/scripts/strict_bench.py --live --rows 2,3,4,5,6,7,8,9 --out notes/pr-s3-strict-output

Hard cap INR 20 (`Budget`, INR 2.8 reserved per call: a 16K-output worst case). It stops at the
first auth, infra, request or refusal failure and says so. Row 1 must succeed before anything
else runs. Output per call: `<out>/calls/row<N>-<rep>.json`; spend in `<out>/ledger.jsonl`.
"""

# ruff: noqa: D102, D107, E501

from __future__ import annotations

import argparse
import itertools
import json
import logging
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

API_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API_ROOT))

from abc_cook.api.routes.import_ import _log_import_cost  # noqa: E402
from abc_cook.extract.acquire import RawAcquisition  # noqa: E402
from abc_cook.extract.adapters.base import (  # noqa: E402
    STREAM_EXTRACTION_ENV,
    STRICT_EXTRACTION_ENV,
    EffortLevel,
    ExtractResult,
)
from abc_cook.extract.adapters.drafting import DraftingAdapter  # noqa: E402
from abc_cook.extract.adapters.routing import build_default_adapter  # noqa: E402
from abc_cook.extract.import_pipeline import ImportTelemetry, run_import  # noqa: E402
from abc_cook.extract.normalize import DEFAULT_MODEL  # noqa: E402
from abc_cook.extract.pricing import call_cost_inr  # noqa: E402
from abc_cook.extract.repair import RepairProposal  # noqa: E402
from abc_cook.schema.api import StreamedDraft  # noqa: E402
from abc_cook.schema.normalized import NormalizedRecipe  # noqa: E402

ENV_FILE = Path(r"C:\Users\ashya\Music\ABC cook\apps\api\.env")
FIXTURES = API_ROOT / "tests" / "fixtures" / "import"
RAW_FILES = {
    "croissant": FIXTURES / "croissant.raw.json",
    "kadhi-pakora": FIXTURES / "kadhi-pakora.raw.json",
    "pumpkin-pancakes": FIXTURES / "pumpkin-pancakes.raw.json",
    "chole-bhature": FIXTURES / "known-wrong" / "chole-bhature.raw.json",
}
CAP_INR = 20.0
RESERVE_INR = 2.8
INVALID = "invalid-key-bench-never-spends"


@dataclass(frozen=True)
class Row:
    """One line of the run table (plan section 8, amended by A1)."""

    n: int
    slug: str
    effort: EffortLevel
    strict: bool
    reps: int
    est_per_call: float
    covers: str


ROWS = [
    Row(1, "croissant", "low", True, 1, 0.70, "schema acceptance, first-schema latency, FGC-11"),
    Row(2, "croissant", "low", True, 2, 0.70, "FGC-11/15 n=3"),
    Row(3, "croissant", "low", False, 3, 0.68, "strict on vs off; FGC-11 recurrence; FGC-13 logs"),
    Row(4, "chole-bhature", "low", True, 2, 1.70, "FGC-12/15, long input, max silence"),
    Row(5, "kadhi-pakora", "low", True, 3, 0.80, "FGC-12/15"),
    Row(6, "kadhi-pakora", "minimal", True, 3, 0.55, "FGC-12"),
    Row(7, "croissant", "minimal", True, 3, 0.50, "FGC-12"),
    Row(8, "pumpkin-pancakes", "low", True, 1, 0.50, "corpus quality (third golden)"),
    Row(9, "kadhi-pakora", "low", False, 1, 0.77, "strict on vs off on a second recipe"),
    Row(12, "chole-bhature", "minimal", True, 2, 1.20, "A1: only if rows 6 and 7 pass the floor"),
    Row(
        13,
        "croissant",
        "low",
        True,
        3,
        0.65,
        "STOP A decision 4: produces/F11-a replication, strict on",
    ),
    Row(
        14,
        "croissant",
        "low",
        False,
        2,
        0.65,
        "STOP A decision 4: produces/F11-a replication, strict off",
    ),
    Row(15, "pumpkin-pancakes", "low", True, 2, 0.45, "STOP B review: pumpkin n=3 per arm, on"),
    Row(16, "pumpkin-pancakes", "low", False, 3, 0.45, "STOP B review: pumpkin n=3 per arm, off"),
]


@dataclass
class Budget:
    """Sequential spend tracker. A call runs only if `spent + reserve` fits under the cap."""

    cap_inr: float = CAP_INR
    reserve_inr: float = RESERVE_INR
    spent: float = 0.0
    lower_bound: bool = False

    def fits(self) -> bool:
        return self.spent + self.reserve_inr <= self.cap_inr


def _read_spent(ledger: Path) -> float:
    if not ledger.exists():
        return 0.0
    return sum(json.loads(line)["inr"] for line in ledger.read_text(encoding="utf-8").splitlines())


class _LogCatcher(logging.Handler):
    """Keeps the `import cost:` and `draft:` lines this process logs."""

    def __init__(self) -> None:
        super().__init__(level=logging.INFO)
        self.lines: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        message = record.getMessage()
        if message.startswith(
            ("import cost:", "draft:", "extraction response unparseable", "strict")
        ):
            self.lines.append(message)
        elif record.levelno >= logging.WARNING:
            self.lines.append(f"WARNING {record.name}: {message[:300]}")


class Recorder:
    """Wraps the real adapter: timestamps every delta, keeps the raw text, never repairs."""

    def __init__(self, inner: Any) -> None:
        self._inner = inner
        self.calls: list[dict[str, Any]] = []
        self.repair_would_fire = False
        self.t0 = time.monotonic()

    @property
    def streams_text(self) -> bool:
        return bool(getattr(self._inner, "streams_text", False))

    def extract(self, **kwargs: Any) -> ExtractResult[Any]:
        if kwargs["output_type"] is RepairProposal:
            self.repair_would_fire = True
            return ExtractResult(recipe=None, error="repair skipped (bench)", error_kind="infra")
        on_text = kwargs.pop("on_text", None)
        start = time.monotonic()
        stamps: list[float] = []
        parts: list[str] = []

        def tapped(delta: str) -> None:
            stamps.append(time.monotonic() - start)
            parts.append(delta)
            if on_text is not None:
                on_text(delta)

        result: ExtractResult[Any] = self._inner.extract(on_text=tapped, **kwargs)
        end = time.monotonic()
        gaps = [b - a for a, b in itertools.pairwise(stamps)]
        self.calls.append(
            {
                "started_s": round(start - self.t0, 3),
                "ended_s": round(end - self.t0, 3),
                "max_tokens": kwargs["max_tokens"],
                "effort": kwargs.get("effort"),
                "first_content_s": round(stamps[0], 3) if stamps else None,
                "last_delta_s": round(stamps[-1], 3) if stamps else None,
                "max_gap_s": round(max(gaps), 3) if gaps else None,
                "n_deltas": len(stamps),
                "delta_lengths": [len(p) for p in parts],
                "error_kind": result.error_kind,
                "error": result.error,
                "truncated": result.truncated,
                "ok": result.recipe is not None,
                "raw_text": "".join(parts),  # the streamed text, on success too
            }
        )
        return result


def run_one(row: Row, rep: int, budget: Budget, out: Path, *, dry: bool) -> dict[str, Any]:
    """One call through `run_import`; returns the record that is also written to disk."""
    raw = RawAcquisition.model_validate_json(RAW_FILES[row.slug].read_text(encoding="utf-8"))
    os.environ[STREAM_EXTRACTION_ENV] = "1"
    os.environ[STRICT_EXTRACTION_ENV] = "1" if row.strict else "0"
    inner = build_default_adapter()
    if dry:
        _mock_openai(inner)

    recorder = Recorder(inner)

    job_id = f"s3-row{row.n}-{rep}"
    marks: dict[str, float] = {}
    started = time.monotonic()

    def on_draft(draft: StreamedDraft) -> None:
        now = time.monotonic() - started
        if draft.ingredients:
            marks.setdefault("first_ingredient_s", now)
        if draft.ingredients_complete:
            marks.setdefault("ingredients_complete_s", now)
        if draft.steps:
            marks.setdefault("first_step_s", now)
        if draft.steps_complete:
            marks.setdefault("steps_complete_s", now)

    telemetry: list[ImportTelemetry] = []

    def on_telemetry(value: ImportTelemetry) -> None:
        telemetry.append(value)
        _log_import_cost(job_id, value)

    catcher = _LogCatcher()
    loggers = [
        logging.getLogger(name)
        for name in (
            "abc_cook.api.routes.import_",
            "abc_cook.extract.adapters.drafting",
            "abc_cook.extract.adapters.openai",
            "abc_cook.extract.normalize",
        )
    ]
    for lg in loggers:
        lg.addHandler(catcher)
        lg.setLevel(logging.INFO)
    error: str | None = None
    result = None
    try:
        result = run_import(
            raw.source_url,
            DraftingAdapter(recorder, on_draft, graph_id=job_id),  # type: ignore[arg-type]
            graph_id=job_id,
            acquire_fn=lambda _url, **_kw: raw,
            on_telemetry=on_telemetry,
            extraction_effort=row.effort,
            cache=None,
        )
    except Exception as exc:  # the bench reports it and stops
        error = f"{type(exc).__name__}: {exc}"[:300]
    finally:
        for lg in loggers:
            lg.removeHandler(catcher)
    total_s = time.monotonic() - started

    tele = telemetry[0] if telemetry else None
    ext_calls = tele.extraction_calls if tele else []
    cost = tele.cost_inr if tele else None
    cost_lines = [ln for ln in catcher.lines if ln.startswith("import cost:")]
    for i, call in enumerate(recorder.calls):
        if i < len(ext_calls):
            u = ext_calls[i]
            call["usage"] = {
                "input_tokens_uncached": u.input_tokens,
                "cached_tokens": u.cache_read_input_tokens,
                "output_tokens": u.output_tokens,
                "reasoning_tokens": u.reasoning_tokens,
                "stop_reason": u.stop_reason,
                "latency_ms": round(u.latency_ms),
                "first_content_ms": None
                if u.first_content_ms is None
                else round(u.first_content_ms),
                "cost_inr": call_cost_inr(u),
            }
    record: dict[str, Any] = {
        "row": row.n,
        "rep": rep,
        "slug": row.slug,
        "effort": row.effort,
        "strict": row.strict,
        "dry": dry,
        "first_strict_schema_call": row.n == 1 and rep == 0,
        "error": error,
        "status": None if result is None else result.status,
        "failure": None if result is None else result.failure,
        "tier": None if tele is None else tele.tier,
        "cost_inr": cost,
        "total_s": round(total_s, 3),
        "marks_s": {k: round(v, 3) for k, v in marks.items()},
        "extraction_calls": len(recorder.calls),
        "retries": max(len(recorder.calls) - 1, 0),
        "repair_would_fire": recorder.repair_would_fire,
        "violations_pre_repair": [] if tele is None else tele.violations_pre_repair,
        "escalated": None if tele is None else tele.extraction_escalated,
        "stage_s": {} if tele is None else {k: round(v, 3) for k, v in tele.stage_s.items()},
        "calls": recorder.calls,
        "log_lines": catcher.lines,
        "import_cost_lines": cost_lines,
        "original": None
        if result is None or result.original is None
        else result.original.model_dump(mode="json"),
        "warnings": [] if result is None else result.warnings,
    }
    calls_dir = out / "calls"
    calls_dir.mkdir(parents=True, exist_ok=True)
    (calls_dir / f"row{row.n}-{rep}{'.dry' if dry else ''}.json").write_text(
        json.dumps(record, indent=1, ensure_ascii=False), encoding="utf-8", newline="\n"
    )
    return record


# --- dry-run mock: serves a stored recipe as an SSE stream, so the code path runs at INR 0 -------


def _mock_openai(router: Any) -> None:
    import httpx

    adapter = router._by_model[DEFAULT_MODEL]
    golden = FIXTURES / "kadhi-pakora.original.json"
    recipe = NormalizedRecipe.model_validate(
        json.loads(golden.read_text(encoding="utf-8"))["recipe"]
    )
    text = recipe.model_dump_json()

    def sse(payload: dict[str, Any] | str) -> bytes:
        body = payload if isinstance(payload, str) else json.dumps(payload)
        return f"data: {body}\n\n".encode()

    def handler(request: httpx.Request) -> httpx.Response:
        base = {"id": "x", "object": "chat.completion.chunk", "created": 0, "model": "m"}
        out = b""
        for i in range(0, len(text), 60):
            piece = text[i : i + 60]
            out += sse({**base, "choices": [{"index": 0, "delta": {"content": piece}}]})
        out += sse({**base, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]})
        out += sse(
            {
                **base,
                "choices": [],
                "usage": {
                    "prompt_tokens": 9000,
                    "completion_tokens": 4000,
                    "total_tokens": 13000,
                    "prompt_tokens_details": {"cached_tokens": 0},
                    "completion_tokens_details": {"reasoning_tokens": 500},
                },
            }
        )
        out += sse("[DONE]")
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=out)

    adapter._client = adapter._client.with_options(
        http_client=httpx.Client(transport=httpx.MockTransport(handler))
    )


def print_run_list(rows: list[Row]) -> None:
    """The dry-run table: what would run, what is reserved, what is estimated."""
    print(
        f"{'row':>3}  {'recipe':<17} {'effort':<8} {'strict':<6} {'n':>2} {'est INR':>8} "
        f"{'reserve':>8}  covers"
    )
    calls = 0
    est = 0.0
    for r in rows:
        print(
            f"{r.n:>3}  {r.slug:<17} {r.effort:<8} {'on' if r.strict else 'off':<6} {r.reps:>2} "
            f"{r.est_per_call * r.reps:>8.2f} {RESERVE_INR * r.reps:>8.2f}  {r.covers}"
        )
        calls += r.reps
        est += r.est_per_call * r.reps
    print(
        f"     {calls} calls; estimated INR {est:.2f}; reserve INR {RESERVE_INR} per call; "
        f"hard cap INR {CAP_INR:.0f}"
    )


def main() -> None:
    """Dry-run table and smoke, or the live rows."""
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", type=Path, required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry", action="store_true")
    mode.add_argument("--live", action="store_true")
    parser.add_argument("--rows", default="", help="comma-separated row numbers (live)")
    parser.add_argument("--cap", type=float, default=CAP_INR, help="hard cap in INR")
    parser.add_argument("--reserve", type=float, default=RESERVE_INR, help="INR held per call")
    parser.add_argument("--interleave", action="store_true", help="alternate calls across rows")
    args = parser.parse_args()

    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    args.out.mkdir(parents=True, exist_ok=True)

    if args.live:
        from dotenv import load_dotenv

        load_dotenv(ENV_FILE)  # keys stay in the environment; nothing here prints them
        os.environ["LLM_API_KEY"] = INVALID  # repair can never spend
        if not os.environ.get("OPENAI_API_KEY"):
            sys.exit("OPENAI_API_KEY is not set")
    else:
        os.environ["OPENAI_API_KEY"] = INVALID
        os.environ["LLM_API_KEY"] = INVALID

    wanted = [int(x) for x in re.split(r"[,\s]+", args.rows) if x] if args.rows else None
    rows = [r for r in ROWS if wanted is None or r.n in wanted]
    if args.dry:
        print_run_list(ROWS)
        print("\nsmoke (mock transport, both keys invalid):")
        smoke = run_one(ROWS[0], 0, Budget(), args.out, dry=True)
        print(
            json.dumps(
                {
                    k: smoke[k]
                    for k in (
                        "status",
                        "tier",
                        "marks_s",
                        "extraction_calls",
                        "cost_inr",
                        "repair_would_fire",
                    )
                },
                indent=1,
            )
        )
        return

    ledger = args.out / "ledger.jsonl"
    budget = Budget(cap_inr=args.cap, reserve_inr=args.reserve, spent=_read_spent(ledger))
    print_run_list(rows)
    print(f"\nspent so far INR {budget.spent:.2f}")
    if args.interleave:
        order = [(row, i) for i in range(max(r.reps for r in rows)) for row in rows if i < row.reps]
    else:
        order = [(row, i) for row in rows for i in range(row.reps)]
    for row, rep in order:
        if True:
            if not budget.fits():
                print(
                    f"SKIP row {row.n} rep {rep}: reserve INR {budget.reserve_inr} would cross the "
                    f"INR {budget.cap_inr:.0f} cap (spent {budget.spent:.2f})"
                )
                return
            print(
                f"\nrow {row.n} rep {rep}: {row.slug} {row.effort} strict={'on' if row.strict else 'off'}",
                flush=True,
            )
            record = run_one(row, rep, budget, args.out, dry=False)
            cost = record["cost_inr"]
            if cost is None:
                budget.lower_bound = True
                budget.spent += (
                    budget.reserve_inr if record["error"] or record["status"] == "failed" else 0.0
                )
                spent_line = "unreported (charged reserve; lower bound flagged)"
            else:
                budget.spent += cost
                spent_line = f"{cost:.2f}"
            with ledger.open("a", encoding="utf-8", newline="\n") as f:
                f.write(
                    json.dumps(
                        {"row": row.n, "rep": rep, "inr": cost or 0.0, "lower_bound": cost is None}
                    )
                    + "\n"
                )
            print(
                f"  status={record['status']} tier={record['tier']} cost INR {spent_line} "
                f"running total INR {budget.spent:.2f} / {budget.cap_inr:.0f}"
            )
            for line in record["import_cost_lines"]:
                print("  " + line)
            print(
                f"  marks={record['marks_s']} first_content={record['calls'][0]['first_content_s'] if record['calls'] else None}"
            )
            failed = (
                record["error"] is not None
                or record["status"] == "failed"
                or any(c["error_kind"] in ("infra", "request", "refused") for c in record["calls"])
            )
            if failed:
                print(
                    f"STOP: first failure on row {row.n} rep {rep}: error={record['error']} "
                    f"failure={record['failure']} calls={[(c['error_kind'], c['error']) for c in record['calls']]}"
                )
                sys.exit(2)
            if row.n == 1 and not record["calls"][0]["ok"]:
                print("STOP: row 1 did not return a parsed recipe")
                sys.exit(2)
    print(
        f"\nspent INR {budget.spent:.2f} of the INR {budget.cap_inr:.0f} cap"
        f"{' (lower bound: a call was unpriced)' if budget.lower_bound else ''}"
    )


if __name__ == "__main__":
    main()
