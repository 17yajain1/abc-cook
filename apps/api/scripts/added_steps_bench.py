r"""FGC-3 live bench: added steps off (arm A) vs on (arm B), on the frozen raw acquisitions.

Same harness as `strict_bench.py` (it reuses its recorder, budget and mock): each call goes through
`run_import` with a `DraftingAdapter`, the real `build_default_adapter()` and the route's own cost
line. Acquisition is the frozen `*.raw.json` at 0 s: no yt-dlp, no captions, no YouTube. Strict
structured output is on and effort is `low` for every call. Repair is never called: the Anthropic
key is set invalid in this process and a repair request is answered locally with an `infra` error
("repair would fire" is recorded instead, with the violations).

    # INR 0: prints the full run list, then smokes the code path on a mock transport
    python apps/api/scripts/added_steps_bench.py --dry --out notes/fgc-345

    # live (OPENAI_API_KEY is read from the main checkout's .env, never printed)
    python apps/api/scripts/added_steps_bench.py --live --out notes/fgc-345

Hard cap INR 20 (INR 2.8 reserved per call: a 16K-output worst case). It stops at the first auth,
infra, request or refusal failure. Output per call: `<out>/calls/<id>.json`; spend in
`<out>/ledger.jsonl`. A call that already has a ledger line is not run again.
"""

# ruff: noqa: D103, E501

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

import strict_bench as sb  # noqa: E402

from abc_cook.api.routes.import_ import _log_import_cost  # noqa: E402
from abc_cook.extract.acquire import RawAcquisition  # noqa: E402
from abc_cook.extract.adapters.base import (  # noqa: E402
    ADDED_STEPS_ENV,
    STREAM_EXTRACTION_ENV,
    STRICT_EXTRACTION_ENV,
)
from abc_cook.extract.adapters.drafting import DraftingAdapter  # noqa: E402
from abc_cook.extract.adapters.routing import build_default_adapter  # noqa: E402
from abc_cook.extract.import_pipeline import ImportTelemetry, run_import  # noqa: E402
from abc_cook.extract.pricing import call_cost_inr  # noqa: E402
from abc_cook.schema.api import StreamedDraft  # noqa: E402

FIXTURES = sb.FIXTURES
RAW_FILES = {
    **sb.RAW_FILES,
    "vanilla-cupcakes": FIXTURES / "known-wrong" / "vanilla-cupcakes.raw.json",
    "partial-ingredients-only": FIXTURES / "partial-ingredients-only.raw.json",
}
EFFORT = "low"


@dataclass(frozen=True)
class Group:
    """A recipe with the number of calls per arm and the per-call estimate (plan D8)."""

    slug: str
    a: int
    b: int
    est: float
    covers: str


GROUPS = [
    Group("vanilla-cupcakes", 3, 3, 0.45, "D3 rule 2: the missing batter step (the motivating case)"),
    Group("chole-bhature", 0, 1, 1.70, "amendment 6, mandatory: Hindi false positives, silence; A ref = S3 row 4"),
    Group("partial-ingredients-only", 1, 2, 0.35, "D3 rule 4: stays Tier 0"),
    Group("kadhi-pakora", 3, 3, 0.80, "D3 rule 1: 0 added steps on a complete method"),
    Group("pumpkin-pancakes", 3, 3, 0.50, "D3 rule 1 + FGC-4 M: step 6 as a tip, priority inversion"),
    Group("croissant", 3, 3, 0.70, "D3 rule 1: only a preheat is acceptable (FGC-7)"),
]


def run_list() -> list[tuple[str, str, int]]:
    """`(slug, arm, rep)` in call order: per recipe A,B,A,B,... so slow drift hits both arms."""
    order: list[tuple[str, str, int]] = []
    for g in GROUPS:
        reps = {"A": 0, "B": 0}
        left = {"A": g.a, "B": g.b}
        arm = "B" if g.a == 0 else "A"
        while left["A"] or left["B"]:
            if left[arm]:
                order.append((g.slug, arm, reps[arm]))
                reps[arm] += 1
                left[arm] -= 1
            arm = "B" if arm == "A" else "A"
    return order


def call_id(slug: str, arm: str, rep: int) -> str:
    return f"{slug}.{arm}{rep + 1}"


def est_of(slug: str) -> float:
    return next(g.est for g in GROUPS if g.slug == slug)


def print_run_list() -> float:
    print(f"{'#':>2}  {'call id':<28} {'recipe':<25} {'arm':<3} {'added steps':<11} {'est INR':>8} {'reserve':>8}")
    total = 0.0
    for i, (slug, arm, rep) in enumerate(run_list(), 1):
        est = est_of(slug)
        total += est
        print(
            f"{i:>2}  {call_id(slug, arm, rep):<28} {slug:<25} {arm:<3} {'on' if arm == 'B' else 'off':<11} "
            f"{est:>8.2f} {sb.RESERVE_INR:>8.2f}"
        )
    print(
        f"    {len(run_list())} calls; estimated INR {total:.2f}; reserve INR {sb.RESERVE_INR} per call; "
        f"hard cap INR {sb.CAP_INR:.0f}"
    )
    print("    arm A = ABC_COOK_ADDED_STEPS off (v7, production today); arm B = on (v8)")
    print(f"    effort {EFFORT}, strict structured output on, streaming on, repair key invalid")
    for g in GROUPS:
        print(f"    {g.slug}: A n={g.a}, B n={g.b} at INR {g.est:.2f}/call -- {g.covers}")
    return total


def must_choose(original: dict[str, Any] | None) -> dict[str, int]:
    """The strict 'must choose' counts for one call (plan D4)."""
    if original is None:
        return {}
    recipe = original["recipe"]
    steps = recipe["steps"]
    return {
        "origin_added": sum(1 for s in steps if s.get("origin") == "added"),
        "role_not_required": sum(1 for s in steps if s.get("role", "required") != "required"),
        "depends_on_previous_false": sum(1 for s in steps if s.get("depends_on_previous") is False),
        "servings_source_stated": 1 if recipe.get("servings_source") == "stated" else 0,
    }


def plan_view(result: Any) -> dict[str, Any] | None:
    """The plan as the cook sees it, plus each node's origin."""
    if result is None or result.graph is None:
        return None
    origin = {k: v.origin for k, v in (result.provenance.nodes if result.provenance else {}).items()}
    dur_src = {
        k: v.fields.get("duration") for k, v in (result.provenance.nodes if result.provenance else {}).items()
    }
    scheduled = {s.node_id: s for s in (result.plan.scheduled if result.plan else [])}
    return {
        "total_min": result.plan.total_min if result.plan else None,
        "serial_min": result.plan.serial_min if result.plan else None,
        "stated_total_min": result.graph.stated_total_min,
        "nodes": [
            {
                "id": n.id,
                "label": n.label,
                "instruction": n.instruction,
                "kind": n.kind,
                "attention": n.attention,
                "duration": [n.duration_min, n.duration_typical, n.duration_max],
                "duration_source": dur_src.get(n.id),
                "origin": origin.get(n.id, "source"),
                "depends_on": n.depends_on,
                "consumes": n.consumes,
                "tip": n.tip,
                "start_min": scheduled[n.id].start_min if n.id in scheduled else None,
            }
            for n in result.graph.nodes
        ],
        "ingredients_optional": [i.name for i in result.graph.ingredients if i.optional],
    }


def run_one(slug: str, arm: str, rep: int, out: Path, *, dry: bool) -> dict[str, Any]:
    cid = call_id(slug, arm, rep)
    raw = RawAcquisition.model_validate_json(RAW_FILES[slug].read_text(encoding="utf-8"))
    os.environ[STREAM_EXTRACTION_ENV] = "1"
    os.environ[STRICT_EXTRACTION_ENV] = "1"
    os.environ[ADDED_STEPS_ENV] = "1" if arm == "B" else "0"
    inner = build_default_adapter()
    if dry:
        sb._mock_openai(inner)
    recorder = sb.Recorder(inner)

    job_id = f"fgc3-{cid}"
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
        if any(s.added for s in draft.steps):
            marks.setdefault("first_added_step_shown_s", now)
        if draft.steps_complete:
            marks.setdefault("steps_complete_s", now)

    telemetry: list[ImportTelemetry] = []

    def on_telemetry(value: ImportTelemetry) -> None:
        telemetry.append(value)
        _log_import_cost(job_id, value)

    catcher = sb._LogCatcher()
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
            extraction_effort=EFFORT,
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
                "cost_inr": call_cost_inr(u),
            }
    original = (
        None if result is None or result.original is None else result.original.model_dump(mode="json")
    )
    first = recorder.calls[0] if recorder.calls else {}
    record: dict[str, Any] = {
        "call_id": cid,
        "slug": slug,
        "arm": arm,
        "rep": rep,
        "added_steps_switch": arm == "B",
        "effort": EFFORT,
        "strict": True,
        "dry": dry,
        "error": error,
        "status": None if result is None else result.status,
        "failure": None if result is None else result.failure,
        "tier": None if tele is None else tele.tier,
        "cost_inr": None if tele is None else tele.cost_inr,
        "total_s": round(total_s, 3),
        "marks_s": {k: round(v, 3) for k, v in marks.items()},
        "max_silence_s": max(
            (first.get("first_content_s") or 0.0), (first.get("max_gap_s") or 0.0)
        ),
        "max_inter_delta_gap_s": first.get("max_gap_s"),
        "extraction_calls": len(recorder.calls),
        "repair_would_fire": recorder.repair_would_fire,
        "violations_pre_repair": [] if tele is None else tele.violations_pre_repair,
        "escalated": None if tele is None else tele.extraction_escalated,
        "must_choose": must_choose(original),
        "plan": plan_view(result),
        "added_steps_in_model_output": []
        if original is None
        else [
            {
                "index": i,
                "text": s["text"],
                "attention": s["attention"],
                "duration": [s["duration_min"], s["duration_typical_min"], s["duration_max"]],
                "duration_stated": s["duration_stated"],
                "consumes": s["consumes_ingredients"],
                "produces": s["produces_component"],
                "role": s["role"],
            }
            for i, s in enumerate(original["recipe"]["steps"])
            if s.get("origin") == "added"
        ],
        "calls": recorder.calls,
        "log_lines": catcher.lines,
        "import_cost_lines": [ln for ln in catcher.lines if ln.startswith("import cost:")],
        "original": original,
        "warnings": [] if result is None else result.warnings,
        "review_recommended": None if result is None else result.review_recommended,
    }
    calls_dir = out / "calls"
    calls_dir.mkdir(parents=True, exist_ok=True)
    (calls_dir / f"{cid}{'.dry' if dry else ''}.json").write_text(
        json.dumps(record, indent=1, ensure_ascii=False), encoding="utf-8", newline="\n"
    )
    return record


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", type=Path, required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry", action="store_true")
    mode.add_argument("--live", action="store_true")
    parser.add_argument("--only", default="", help="comma-separated call ids to run (live)")
    parser.add_argument("--cap", type=float, default=sb.CAP_INR)
    parser.add_argument("--reserve", type=float, default=sb.RESERVE_INR)
    args = parser.parse_args()

    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")  # type: ignore[union-attr]
    args.out.mkdir(parents=True, exist_ok=True)

    if args.live:
        from dotenv import load_dotenv

        load_dotenv(sb.ENV_FILE)  # keys stay in the environment; nothing here prints them
        os.environ["LLM_API_KEY"] = sb.INVALID  # repair can never spend
        if not os.environ.get("OPENAI_API_KEY"):
            sys.exit("OPENAI_API_KEY is not set")
    else:
        os.environ["OPENAI_API_KEY"] = sb.INVALID
        os.environ["LLM_API_KEY"] = sb.INVALID

    if args.dry:
        print_run_list()
        print("\nsmoke (mock transport, both keys invalid, one call per arm):")
        for arm in ("A", "B"):
            smoke = run_one("kadhi-pakora", arm, 0, args.out, dry=True)
            print(
                arm,
                json.dumps(
                    {
                        k: smoke[k]
                        for k in ("status", "tier", "extraction_calls", "repair_would_fire", "must_choose")
                    }
                ),
            )
        return

    only = {x for x in args.only.split(",") if x}
    ledger = args.out / "ledger.jsonl"
    done = (
        {json.loads(x)["call_id"] for x in ledger.read_text(encoding="utf-8").splitlines()}
        if ledger.exists()
        else set()
    )
    budget = sb.Budget(cap_inr=args.cap, reserve_inr=args.reserve, spent=sb._read_spent(ledger))
    print_run_list()
    print(f"\nspent so far INR {budget.spent:.2f}")
    for slug, arm, rep in run_list():
        cid = call_id(slug, arm, rep)
        if cid in done or (only and cid not in only):
            continue
        if not budget.fits():
            print(f"SKIP {cid}: reserve INR {budget.reserve_inr} would cross the INR {budget.cap_inr:.0f} cap (spent {budget.spent:.2f})")
            return
        print(f"\n{cid}: {slug} arm {arm} (added steps {'on' if arm == 'B' else 'off'})", flush=True)
        record = run_one(slug, arm, rep, args.out, dry=False)
        cost = record["cost_inr"]
        if cost is None:
            budget.lower_bound = True
            budget.spent += budget.reserve_inr if record["error"] or record["status"] == "failed" else 0.0
            spent_line = "unreported (charged reserve; lower bound flagged)"
        else:
            budget.spent += cost
            spent_line = f"{cost:.2f}"
        with ledger.open("a", encoding="utf-8", newline="\n") as f:
            f.write(json.dumps({"call_id": cid, "inr": cost or 0.0, "lower_bound": cost is None}) + "\n")
        print(
            f"  status={record['status']} tier={record['tier']} cost INR {spent_line} "
            f"running total INR {budget.spent:.2f} / {budget.cap_inr:.0f}; added steps in output: "
            f"{len(record['added_steps_in_model_output'])}"
        )
        for line in record["import_cost_lines"]:
            print("  " + line)
        failed = (
            record["error"] is not None
            or record["status"] == "failed"
            or any(c["error_kind"] in ("infra", "request", "refused") for c in record["calls"])
        )
        if failed:
            print(
                f"STOP: first failure on {cid}: error={record['error']} failure={record['failure']} "
                f"calls={[(c['error_kind'], c['error']) for c in record['calls']]}"
            )
            sys.exit(2)
    print(
        f"\nspent INR {budget.spent:.2f} of the INR {budget.cap_inr:.0f} cap"
        f"{' (lower bound: a call was unpriced)' if budget.lower_bound else ''}"
    )


if __name__ == "__main__":
    main()
