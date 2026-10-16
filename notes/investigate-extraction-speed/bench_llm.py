"""B1 / B1b / B3 LLM benchmark (scratch). LIVE CALLS except `dry`. Hard cap INR 30.

    PYTHONPATH=apps/api:notes/investigate-extraction-speed python notes/investigate-extraction-speed/bench_llm.py PHASE

PHASE: dry | p1 | p2 | p3 | p4 | p5 | p6 | report
  p1 chole x {minimal, low, low, medium}          p2 5 recipes x {minimal, low} + pizza low rep 2
  p3 staged fast call x 6 x {gpt-5-mini minimal, gpt-4.1-mini}
  p4 chole translate-first                         p5 two streaming probes (kadhi)
  p6 chole 32K probe (lowest effort that still failed at 16K)

Sequential, workers=1, so wall time is not skewed by concurrency. Repair is STUBBED (never calls
Sonnet): a violation records "repair would fire" and takes the deterministic degrade path.
Spend is persisted in raw/ledger.jsonl so the INR 30 cap holds across invocations.
"""

from __future__ import annotations

import json
import sys
import time
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import common as c
import openai
import pydantic
from abc_cook.extract.adapters.base import ExtractResult
from abc_cook.extract.adapters.openai import OpenAIAdapter
from abc_cook.extract.adapters.prompting import system_prompt
from abc_cook.extract.normalize import (
    ESCALATED_MAX_TOKENS,
    MAX_TOKENS,
    load_prompt,
    normalize,
    render_source_text,
)
from abc_cook.extract.postprocess import postprocess, reprocess
from abc_cook.extract.pricing import call_cost_inr
from abc_cook.extract.repair import REPAIRABLE_RULES, replay_repair_or_degrade
from abc_cook.schema.graph import SourceRef
from abc_cook.schema.normalized import ImportOriginal, NormalizedRecipe

CAP = 30.0
LEDGER = c.RAW / "ledger.jsonl"
RUNS = c.RAW / "runs.jsonl"
EFFORT = {"minimal": "minimal", "low": "low", "medium": None}  # medium == provider default
RESERVE_FULL = 1.2  # a non-chole full run measured 0.9-1.9 at medium; low/minimal are cheaper
RESERVE_CHOLE = 3.0  # 16K cap: 16000 out = 2.72 + ~12K in = 0.25
RESERVE_FAST = 0.5


def spent() -> float:
    if not LEDGER.exists():
        return 0.0
    return sum(json.loads(line)["inr"] for line in LEDGER.read_text(encoding="utf-8").splitlines())


def ledger(label: str, inr: float) -> None:
    with LEDGER.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"label": label, "inr": round(inr, 4)}) + "\n")
    print(f"   [spent INR {spent():.2f} / {CAP:.0f}]", flush=True)


def gate(label: str, reserve: float) -> bool:
    if spent() + reserve > CAP:
        print(f"SKIP {label}: reserve {reserve} would cross the INR {CAP} cap (spent {spent():.2f})")
        return False
    return True


# ---- projection / diff ----------------------------------------------------------------
def project(out: Any) -> dict[str, Any]:
    """Reduce an ImportResult to what the goldens pin (same fields as regen_corpus_expected)."""
    g, p, s, pv = out.graph, out.plan, out.summary, out.provenance
    label = {n.id: n.label.strip().lower() for n in g.nodes}
    sched = {x.node_id: x for x in p.scheduled}
    nodes = [
        {
            "label": label[n.id],
            "duration_min": n.duration_min,
            "duration_source": pv.nodes[n.id].fields["duration"],
            "depends_on": sorted(label[d] for d in n.depends_on),
            "window": sched[n.id].window_id,
        }
        for n in g.nodes
    ]
    return {
        "nodes": nodes,
        "edges": sorted(f"{d} -> {n['label']}" for n in nodes for d in n["depends_on"]),
        "stated": sorted(n["duration_min"] for n in nodes if n["duration_source"] == "extracted"),
        "parallel": sum(len(w.assigned) for w in p.windows),
        "windows": len(p.windows),
        "total_min": p.total_min,
        "saved_min": p.saved_min,
    }


def jacc(a: list[str], b: list[str]) -> float:
    sa, sb = set(a), set(b)
    return 1.0 if not sa and not sb else round(len(sa & sb) / len(sa | sb), 2)


def stub_repair(box: dict[str, Any]):  # noqa: ANN201
    def _fn(recipe, source_text, violations, *, graph_id, source):  # noqa: ANN001, ANN202
        box["would_fire"] = True
        box["rules"] = sorted({v.rule for v in violations})
        box["all_repairable"] = all(v.rule in REPAIRABLE_RULES for v in violations)
        box["messages"] = [f"{v.rule}: {v.message}" for v in violations]
        return replay_repair_or_degrade(
            recipe, source_text, violations, None, graph_id=graph_id, source=source
        )

    return _fn


def make_original(raw: Any, recipe: NormalizedRecipe, gid: str) -> ImportOriginal:
    return ImportOriginal(
        recipe=recipe,
        repair=None,
        source_text=render_source_text(raw),
        raw_title=raw.title,
        blog_name=raw.blog_recipe.get("name") if raw.blog_recipe else None,
        source=SourceRef(kind=raw.source_kind, value=raw.source_url, imported_at=datetime.now(UTC)),
        graph_id=gid,
        acquisition_warnings=list(raw.acquisition_warnings),
        sources=[],
    )


_GOLD: dict[str, dict[str, Any] | None] = {}


def golden(slug: str) -> dict[str, Any] | None:
    if slug in _GOLD:
        return _GOLD[slug]
    ref = c.INPUTS[slug][1]
    g: dict[str, Any] | None = None
    if slug == "chole-bhature" or ref is None:
        g = None
    elif slug == "pizza-dough":
        raw = c.load_raw(slug)
        rec = NormalizedRecipe.model_validate_json(ref.read_text(encoding="utf-8"))
        post = postprocess(make_original(raw, rec, "g_gold"), repair_fn=stub_repair({}))
        g = project(post.result)
    else:
        orig = ref if ref.name.endswith(".original.json") else c.FIX / ref.name.replace(
            ".replay-expected.json", ".original.json"
        )
        g = project(reprocess(ImportOriginal.model_validate_json(orig.read_text(encoding="utf-8"))).result)
    _GOLD[slug] = g
    return g


def diff_vs_golden(slug: str, run: dict[str, Any]) -> dict[str, Any] | None:
    g = golden(slug)
    if g is None or run is None:
        return None
    gl = [n["label"] for n in g["nodes"]]
    rl = [n["label"] for n in run["nodes"]]
    return {
        "steps": f"{len(rl)} vs golden {len(gl)}",
        "label_jaccard": jacc(rl, gl),
        "edge_jaccard": jacc(run["edges"], g["edges"]),
        "stated_durations": f"run {run['stated']} vs golden {g['stated']}",
        "stated_equal": run["stated"] == g["stated"],
        "parallel": f"{run['parallel']} vs {g['parallel']}",
        "windows": f"{run['windows']} vs {g['windows']}",
        "total_min": f"{run['total_min']} vs {g['total_min']}",
        "saved_min": f"{run['saved_min']} vs {g['saved_min']}",
    }


# ---- one full extraction run ------------------------------------------------------------
class Rec:
    def __init__(self, inner: Any) -> None:
        self.inner, self.calls, self.results = inner, [], []

    def extract(self, **kw: Any) -> ExtractResult[Any]:
        r = self.inner.extract(**kw)
        self.results.append(r)
        return r


def usage_rows(res: list[ExtractResult[Any]]) -> list[dict[str, Any]]:
    rows = []
    for r in res:
        u = r.usage
        if u is None:
            rows.append({"error": r.error})
            continue
        rows.append(
            {
                "latency_s": round(u.latency_ms / 1000, 1),
                "input": u.input_tokens + (u.cache_read_input_tokens or 0),
                "cached": u.cache_read_input_tokens or 0,
                "output": u.output_tokens,
                "reasoning": u.reasoning_tokens,
                "visible": u.output_tokens - (u.reasoning_tokens or 0),
                "stop": u.stop_reason,
                "max": u.max_tokens_requested,
                "inr": round(call_cost_inr(u) or 0, 3),
                "truncated": r.truncated,
                "error": r.error,
            }
        )
    return rows


def full_run(slug: str, arm: str, rep: int, *, max_tokens: int = MAX_TOKENS, tag: str = "",
             raw: Any = None, extra: dict[str, Any] | None = None, reserve: float | None = None) -> dict[str, Any] | None:
    run_id = f"{slug}__{arm}__{rep}{tag}"
    if reserve is None:
        reserve = RESERVE_CHOLE if slug == "chole-bhature" else RESERVE_FULL
    if not gate(run_id, reserve):
        return None
    raw = raw or c.load_raw(slug)
    rec = Rec(OpenAIAdapter())
    t0 = time.monotonic()
    outcome = normalize(raw, rec, effort=EFFORT[arm], max_tokens=max_tokens)  # type: ignore[arg-type]
    wall = time.monotonic() - t0
    calls = usage_rows(rec.results)
    inr = sum(x.get("inr", 0) for x in calls)
    ledger(run_id, inr)
    row: dict[str, Any] = {
        "run_id": run_id, "slug": slug, "arm": arm, "rep": rep, "max_tokens": max_tokens,
        "wall_s": round(wall, 1), "calls": calls, "inr": round(inr, 3),
        "truncations": outcome.truncations, "escalated": outcome.escalated,
        "extra": extra or {},
    }
    if outcome.tier0_result is not None:
        row.update(tier="tier0", steps=0, validate_pass=None, would_fire=None,
                   warning=outcome.tier0_result.warnings)
    else:
        box: dict[str, Any] = {}
        recipe = outcome.recipe
        assert recipe is not None
        (c.RAW / f"{run_id}.normalized.json").write_text(recipe.model_dump_json(indent=2), encoding="utf-8")
        post = postprocess(make_original(raw, recipe, f"g_{run_id}"[:60]), repair_fn=stub_repair(box))
        pr = project(post.result)
        row.update(
            tier="clean" if not box.get("would_fire") else "repair-would-fire",
            steps=len(recipe.steps), validate_pass=not box.get("would_fire", False),
            would_fire=box.get("would_fire", False), rules=box.get("rules", []),
            all_repairable=box.get("all_repairable"), messages=box.get("messages", []),
            projection=pr, diff=diff_vs_golden(slug, pr),
            parallel=pr["parallel"], total_min=pr["total_min"], saved_min=pr["saved_min"],
        )
    with RUNS.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False, default=str) + "\n")
    print(f"done {run_id}: tier={row['tier']} wall={row['wall_s']}s steps={row.get('steps')} "
          f"calls={[(x.get('reasoning'), x.get('output')) for x in calls]} inr={row['inr']}", flush=True)
    return row


# ---- staged (flat schema) fast call ------------------------------------------------------
class FlatIngredientGroup(pydantic.BaseModel):
    group: str
    items: list[str]


class FlatStep(pydantic.BaseModel):
    text: str
    stated_minutes: int | None = None


class FlatRecipe(pydantic.BaseModel):
    title: str
    ingredients: list[FlatIngredientGroup]
    steps: list[FlatStep]


FAST_PROMPT = (
    "Extract the recipe from the source. Return ONLY JSON matching the schema.\n"
    "- title: the dish name.\n"
    "- ingredients: grouped as the source groups them (group name, or 'Ingredients'); each item as written.\n"
    "- steps: the method in order, one plain sentence-level instruction per step, in English.\n"
    "- stated_minutes: ONLY a time the source explicitly states for that step (integer minutes), else null. Never guess.\n"
    "Use only what the source says; do not invent ingredients, steps or times.\n\nSchema:\n"
)


def fast_call(slug: str, model: str, raw: Any = None, rep: int = 0) -> dict[str, Any] | None:
    run_id = f"fast__{slug}__{model}__{rep}"
    if not gate(run_id, RESERVE_FAST):
        return None
    raw = raw or c.load_raw(slug)
    schema = json.dumps(FlatRecipe.model_json_schema(), ensure_ascii=False)
    kw: dict[str, Any] = {}
    if model.startswith("gpt-5"):
        kw["reasoning_effort"] = "minimal"
    t0 = time.monotonic()
    try:
        r = openai.OpenAI(max_retries=1).chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": FAST_PROMPT + schema},
                      {"role": "user", "content": render_source_text(raw)}],
            max_completion_tokens=8000, response_format={"type": "json_object"}, timeout=180, **kw)
    except openai.APIError as exc:
        print(f"FAIL {run_id}: {exc}")
        ledger(run_id, 0.0)
        return {"run_id": run_id, "error": str(exc)}
    wall = time.monotonic() - t0
    u = r.usage
    cached = u.prompt_tokens_details.cached_tokens or 0 if u and u.prompt_tokens_details else 0
    reasoning = (u.completion_tokens_details.reasoning_tokens or 0) if u and u.completion_tokens_details else 0
    inr = c.cost_inr(model, u.prompt_tokens - cached, cached, u.completion_tokens)
    ledger(run_id, inr)
    text = r.choices[0].message.content or ""
    parsed = None
    try:
        parsed = FlatRecipe.model_validate_json(text)
    except Exception as exc:  # noqa: BLE001
        parsed = None
        err = str(exc)[:120]
    row: dict[str, Any] = {
        "run_id": run_id, "slug": slug, "model": model, "wall_s": round(wall, 1),
        "input": u.prompt_tokens, "cached": cached, "output": u.completion_tokens,
        "reasoning": reasoning, "inr": round(inr, 3), "stop": r.choices[0].finish_reason,
        "parsed": parsed is not None,
    }
    if parsed:
        row.update(steps=len(parsed.steps), ingredient_groups=len(parsed.ingredients),
                   ingredient_items=sum(len(g.items) for g in parsed.ingredients),
                   stated=sorted(s.stated_minutes for s in parsed.steps if s.stated_minutes),
                   title=parsed.title)
        (c.RAW / f"{run_id}.flat.json").write_text(parsed.model_dump_json(indent=2), encoding="utf-8")
    else:
        row["parse_error"] = err
    with RUNS.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"kind": "fast", **row}, ensure_ascii=False) + "\n")
    print(f"done {run_id}: wall={row['wall_s']}s steps={row.get('steps')} out={row['output']} "
          f"reasoning={reasoning} inr={row['inr']}", flush=True)
    return row


# ---- translate first (chole) -------------------------------------------------------------
TRANSLATE_PROMPT = (
    "Translate the following Hindi (Devanagari) cooking-video transcript into plain English. "
    "Keep every ingredient, quantity, number, time, temperature and instruction exactly; spoken "
    "number words become digits. Do not summarize, reorder, add or omit anything. Output only the translation."
)


def translate_first() -> None:
    raw = c.load_raw("chole-bhature")
    label = "chole-bhature__translate-first"
    if not gate(label, 0.5 + RESERVE_CHOLE):
        return
    model = "gpt-4.1-mini"
    t0 = time.monotonic()
    r = openai.OpenAI(max_retries=1).chat.completions.create(
        model=model, messages=[{"role": "system", "content": TRANSLATE_PROMPT},
                               {"role": "user", "content": raw.transcript}],
        max_completion_tokens=12000, timeout=240)
    t_tr = time.monotonic() - t0
    u = r.usage
    cached = (u.prompt_tokens_details.cached_tokens or 0) if u.prompt_tokens_details else 0
    inr_tr = c.cost_inr(model, u.prompt_tokens - cached, cached, u.completion_tokens)
    ledger(label + ":translate", inr_tr)
    en = r.choices[0].message.content or ""
    (c.RAW / "chole-bhature.translated.txt").write_text(en, encoding="utf-8")
    print(f"translated in {t_tr:.1f}s: {u.prompt_tokens} in, {u.completion_tokens} out, inr {inr_tr:.2f}; finish={r.choices[0].finish_reason}")
    raw_en = raw.model_copy(update={"transcript": en, "transcript_lang": "en"})
    row = full_run("chole-bhature", "low", 0, tag="__translate-first", raw=raw_en,
                   extra={"translate_s": round(t_tr, 1), "translate_inr": round(inr_tr, 3),
                          "translate_in_tokens": u.prompt_tokens, "translate_out_tokens": u.completion_tokens,
                          "translate_finish": r.choices[0].finish_reason,
                          "transcript_chars_hi": len(raw.transcript or ""), "transcript_chars_en": len(en)},
                   reserve=RESERVE_CHOLE)
    if row:
        row["total_s_incl_translate"] = round(row["wall_s"] + t_tr, 1)
        row["total_inr_incl_translate"] = round(row["inr"] + inr_tr, 3)
        print(f"translate-first total {row['total_s_incl_translate']}s, INR {row['total_inr_incl_translate']}")
        with RUNS.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"kind": "translate-first-total", **{k: row[k] for k in ("run_id", "total_s_incl_translate", "total_inr_incl_translate", "tier", "steps")}}) + "\n")


# ---- streaming probes ----------------------------------------------------------------------
def stream_probe(name: str, model: str, system: str, user: str, effort: str | None, max_tokens: int) -> None:
    if not gate(name, 1.5):
        return
    kw: dict[str, Any] = {"reasoning_effort": effort} if effort else {}
    t0 = time.monotonic()
    stream = openai.OpenAI(max_retries=1).chat.completions.create(
        model=model, messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        max_completion_tokens=max_tokens, stream=True, stream_options={"include_usage": True},
        timeout=300, **kw)
    buf = ""
    marks: dict[str, float] = {}
    usage = None
    for ch in stream:
        if ch.usage is not None:
            usage = ch.usage
        if not ch.choices:
            continue
        d = ch.choices[0].delta.content
        if not d:
            continue
        now = time.monotonic() - t0
        marks.setdefault("first_visible_token_s", now)
        buf += d
        if '"ingredients"' in buf:
            marks.setdefault("ingredients_key_s", now)
        # ingredients array done == the next top-level key "steps" has started
        if '"steps"' in buf:
            marks.setdefault("steps_key_s", now)
        # first complete step object: count of '"text"' occurrences >= 2 means step 1 closed
        if '"steps"' in buf and buf.split('"steps"', 1)[1].count('"text"') >= 2:
            marks.setdefault("first_step_complete_s", now)
    total = time.monotonic() - t0
    marks["total_s"] = total
    cached = (usage.prompt_tokens_details.cached_tokens or 0) if usage and usage.prompt_tokens_details else 0
    rt = (usage.completion_tokens_details.reasoning_tokens or 0) if usage and usage.completion_tokens_details else 0
    inr = c.cost_inr(model, usage.prompt_tokens - cached, cached, usage.completion_tokens) if usage else 0.0
    ledger(name, inr)
    row = {"kind": "stream", "name": name, "model": model, "effort": effort,
           "marks": {k: round(v, 1) for k, v in marks.items()},
           "output_tokens": usage.completion_tokens if usage else None, "reasoning_tokens": rt,
           "input_tokens": usage.prompt_tokens if usage else None, "inr": round(inr, 3)}
    with RUNS.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row) + "\n")
    print(json.dumps(row))


def streaming() -> None:
    raw = c.load_raw("kadhi-pakora")
    src = render_source_text(raw)
    stream_probe("stream__fast__gpt-4.1-mini", "gpt-4.1-mini",
                 FAST_PROMPT + json.dumps(FlatRecipe.model_json_schema()), src, None, 8000)
    stream_probe("stream__full__gpt-5-mini-low", "gpt-5-mini",
                 system_prompt(load_prompt(), NormalizedRecipe), src, "low", MAX_TOKENS)


# ---- phases ------------------------------------------------------------------------------------
RECIPES5 = ["pumpkin-pancakes", "kadhi-pakora", "croissant", "vanilla-cupcakes", "pizza-dough"]


def plan_list() -> list[tuple[str, str, Any]]:
    jobs: list[tuple[str, str, Any]] = []
    for a, rep in (("minimal", 0), ("low", 0), ("low", 1), ("medium", 0)):
        jobs.append(("p1", f"chole-bhature / {a} / rep {rep}", RESERVE_CHOLE))
    for s in RECIPES5:
        for a in ("minimal", "low"):
            jobs.append(("p2", f"{s} / {a} / rep 0", RESERVE_FULL))
    jobs.append(("p2", "pizza-dough / low / rep 1", RESERVE_FULL))
    for s in c.INPUTS:
        for m in ("gpt-5-mini(minimal)", "gpt-4.1-mini"):
            jobs.append(("p3", f"fast {s} / {m}", RESERVE_FAST))
    jobs.append(("p4", "chole translate-first (gpt-4.1-mini translate + gpt-5-mini low)", 0.5 + RESERVE_CHOLE))
    jobs.append(("p5", "stream fast (gpt-4.1-mini, kadhi)", 1.5))
    jobs.append(("p5", "stream full (gpt-5-mini low, kadhi)", 1.5))
    jobs.append(("p6", "chole 32K probe at lowest effort that failed at 16K (only if budget remains)", 5.5))
    return jobs


def main() -> None:
    phase = sys.argv[1]
    if phase == "dry":
        jobs = plan_list()
        run = 0.0
        print(f"{len(jobs)} runs; cap INR {CAP}; spent so far {spent():.2f}")
        for i, (ph, name, rsv) in enumerate(jobs, 1):
            run += rsv
            print(f"  {i:>2}. [{ph}] {name:<78} reserve {rsv:>4}  cumulative-reserve {run:>5.1f}")
        print(f"sum of reserves {run:.1f} (reserves are worst-case holds; actual spend is metered per run).")
        print("Budget rule: before each run, skip it if spent + reserve > cap. No Sonnet repair calls (stubbed).")
        return
    if phase == "p1":
        done = Counter()
        for arm in ("minimal", "low", "low", "medium"):
            full_run("chole-bhature", arm, done[arm]); done[arm] += 1
    elif phase == "p2":
        for s in RECIPES5:
            for arm in ("minimal", "low"):
                full_run(s, arm, 0)
        full_run("pizza-dough", "low", 1)
    elif phase == "p3":
        for s in c.INPUTS:
            fast_call(s, "gpt-5-mini")
            fast_call(s, "gpt-4.1-mini")
    elif phase == "p4":
        translate_first()
    elif phase == "p5":
        streaming()
    elif phase == "p6":
        rows = [json.loads(x) for x in RUNS.read_text(encoding="utf-8").splitlines()]
        failed = [r for r in rows if r.get("slug") == "chole-bhature" and r.get("tier") == "tier0"
                  and r.get("max_tokens") == MAX_TOKENS and not r["run_id"].endswith("translate-first")]
        order = {"minimal": 0, "low": 1, "medium": 2}
        if not failed:
            print("p6: no chole run failed at 16K -> probe not needed")
            return
        arm = min((r["arm"] for r in failed), key=order.get)
        print(f"p6: lowest failing effort = {arm}")
        full_run("chole-bhature", arm, 0, max_tokens=ESCALATED_MAX_TOKENS, tag="__32k-probe", reserve=5.5)
    else:
        raise SystemExit("unknown phase")
    print(f"\nSPENT INR {spent():.2f} of {CAP}")


if __name__ == "__main__":
    main()
