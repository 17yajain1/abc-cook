r"""PR-S3 offline analysis (INR 0): every live call, FGC-11 trace, F11-a prototype, FGC-22 checks.

    PYTHONPATH=apps/api python notes/pr-s3-strict-output/analyze.py

Reads `calls/row*.json` written by `apps/api/scripts/strict_bench.py` and the frozen fixtures.
Makes no network call and never reads a key. F11-a (the stated floor) is applied here as a
monkeypatch of `graph._verify_duration`, so "off" is the code as committed and "on" is the
prototype; nothing in `abc_cook/` is changed by this script.
"""

# ruff: noqa: D103, E501, ANN, PLR, C901, T201

from __future__ import annotations

import contextlib
import json
import re
import statistics
import sys
from pathlib import Path
from typing import Any
from unittest import mock

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(REPO / "apps" / "api"))
for _s in (sys.stdout, sys.stderr):
    _s.reconfigure(encoding="utf-8")

from abc_cook.extract import graph as G  # noqa: E402
from abc_cook.extract.draft import DraftScanner  # noqa: E402
from abc_cook.extract.postprocess import postprocess, reprocess  # noqa: E402
from abc_cook.extract.repair import replay_repair_or_degrade  # noqa: E402
from abc_cook.schema.normalized import (  # noqa: E402
    ImportOriginal,
    NormalizedIngredient,
    NormalizedRecipe,
    NormalizedStep,
)

FIX = REPO / "apps" / "api" / "tests" / "fixtures" / "import"
STREAM_FIX = REPO / "apps" / "api" / "tests" / "fixtures" / "stream"
CALLS = HERE / "calls"
GOLDEN_SLUGS = ["kadhi-pakora", "croissant", "pumpkin-pancakes"]
TIER_RANK = {"clean": 0, "tier1.5": 1, "degraded": 2, "tier0": 3}
HEDGES = re.compile(r"\b(about|approx(?:imately)?|around|roughly)\b|~|लगभग", re.IGNORECASE)


# --- F11-a prototype ------------------------------------------------------------------------------

_orig_verify = G._verify_duration


def _verify_floor(step, corpus, attention="hands_on"):  # noqa: ANN001, ANN202
    """`_verify_duration` with the stated floor: the min is raised to the stated low end."""
    dmin, dtyp, dmax, stated, warnings, review = _orig_verify(step, corpus, attention)
    grounded = G._grounded_duration_expressions(
        step.text, corpus, allow_lead=attention in ("unattended", "periodic")
    )
    plain = [e for e in grounded if not e.ceiling]
    if len(plain) == 1:
        expr = plain[0]
        floor = expr.low_min if step.duration_min is None else max(step.duration_min, expr.low_min)
        dmin = min(floor, dtyp) if dtyp is not None else floor
    return dmin, dtyp, dmax, stated, warnings, review


@contextlib.contextmanager
def f11a(on: bool):  # noqa: ANN201
    if on:
        with mock.patch.object(G, "_verify_duration", _verify_floor):
            yield
    else:
        yield


def _stub_repair(recipe, source_text, violations, *, graph_id, source):  # noqa: ANN001, ANN202
    return replay_repair_or_degrade(
        recipe, source_text, violations, None, graph_id=graph_id, source=source
    )


def run_post(original: ImportOriginal, on: bool):  # noqa: ANN201
    with f11a(on):
        return postprocess(original, repair_fn=_stub_repair)


def run_reprocess(original: ImportOriginal, on: bool):  # noqa: ANN201
    with f11a(on):
        return reprocess(original)


# --- projection and golden diff (same fields as regen_corpus_expected) -----------------------------


def project(result) -> dict[str, Any]:  # noqa: ANN001
    g, p, pv = result.graph, result.plan, result.provenance
    label = {n.id: n.label.strip().lower() for n in g.nodes}
    sched = {x.node_id: x for x in p.scheduled}
    nodes = [
        {
            "id": n.id,
            "label": label[n.id],
            "min": n.duration_min,
            "typ": n.duration_typical,
            "max": n.duration_max,
            "source": pv.nodes[n.id].fields["duration"],
            "depends_on": sorted(label[d] for d in n.depends_on),
            "window": sched[n.id].window_id,
            "start": sched[n.id].start_min,
            "end": sched[n.id].end_min,
            "instruction": n.instruction,
            "attention": n.attention,
        }
        for n in g.nodes
    ]
    return {
        "nodes": nodes,
        "stated": sorted(n["min"] for n in nodes if n["source"] == "extracted"),
        "parallel": sum(len(w.assigned) for w in p.windows),
        "windows": len(p.windows),
        "total_min": p.total_min,
        "saved_min": p.saved_min,
    }


STOP = {"the", "a", "an", "and", "to", "of", "in", "with", "for", "until", "on", "into"}


def toks(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", s.lower()) if w not in STOP}


def match(a, bb, thr=0.30):  # noqa: ANN001, ANN201
    pairs = []
    for i, x in enumerate(a):
        tx = toks(x["label"])
        for j, y in enumerate(bb):
            ty = toks(y["label"])
            if tx and ty:
                s = len(tx & ty) / len(tx | ty)
                if s >= thr:
                    pairs.append((s, i, j))
    pairs.sort(reverse=True)
    mp: dict[int, int] = {}
    used: set[int] = set()
    for _s, i, j in pairs:
        if i not in mp and j not in used:
            mp[i] = j
            used.add(j)
    return mp


def cmp_golden(run: dict[str, Any], ref: dict[str, Any]) -> dict[str, Any]:
    rn, gn = run["nodes"], ref["nodes"]
    mp = match(rn, gn)
    ridx = {n["label"]: i for i, n in enumerate(rn)}
    gidx = {n["label"]: i for i, n in enumerate(gn)}
    r_edges = {(ridx[d], i) for i, n in enumerate(rn) for d in n["depends_on"] if d in ridx}
    g_edges = {(gidx[d], i) for i, n in enumerate(gn) for d in n["depends_on"] if d in gidx}
    mapped_r = {(mp[a], mp[b2]) for a, b2 in r_edges if a in mp and b2 in mp}
    inv = {v: k for k, v in mp.items()}
    g_in_scope = {(a, b2) for a, b2 in g_edges if a in inv and b2 in inv}
    agree = mapped_r & g_edges
    return {
        "nodes": [len(rn), len(gn)],
        "node_recall": round(len(mp) / len(gn), 2) if gn else None,
        "node_precision": round(len(mp) / len(rn), 2) if rn else None,
        "edge_recall": round(len(g_in_scope & mapped_r) / len(g_in_scope), 2) if g_in_scope else None,
        "edge_precision": round(len(agree) / len(mapped_r), 2) if mapped_r else None,
        "stated_equal": run["stated"] == ref["stated"],
        "total_min": [run["total_min"], ref["total_min"]],
    }


_GOLD: dict[str, dict[str, Any]] = {}


def golden(slug: str) -> dict[str, Any] | None:
    if slug not in GOLDEN_SLUGS:
        return None
    if slug not in _GOLD:
        orig = ImportOriginal.model_validate_json(
            (FIX / f"{slug}.original.json").read_text(encoding="utf-8")
        )
        _GOLD[slug] = project(run_reprocess(orig, False).result)
    return _GOLD[slug]


# --- stated-floor violations ----------------------------------------------------------------------


def step_exprs(text: str, corpus: str, attention: str):  # noqa: ANN201
    grounded = G._grounded_duration_expressions(
        text, corpus, allow_lead=attention in ("unattended", "periodic")
    )
    return [e for e in grounded if not e.ceiling]


def floor_violations(proj: dict[str, Any], corpus: str) -> list[dict[str, Any]]:
    """Nodes with an extracted duration whose min sits below the low end of the stated phrase."""
    out = []
    for n in proj["nodes"]:
        if n["source"] != "extracted":
            continue
        plain = step_exprs(n["instruction"], corpus, n["attention"])
        if len(plain) == 1 and n["min"] is not None and n["min"] < plain[0].low_min - 1e-9:
            out.append(
                {"label": n["label"], "min": n["min"], "stated_low": plain[0].low_min,
                 "hedged": bool(HEDGES.search(n["instruction"]))}
            )
    return out


def fgc21(proj: dict[str, Any], corpus: str) -> dict[str, int]:
    """Draft step text vs the plan: a step whose own text states one time but whose plan
    typical differs. Recorded only."""
    with_expr = mismatched = 0
    for n in proj["nodes"]:
        plain = step_exprs(n["instruction"], corpus, n["attention"])
        if len(plain) == 1 and plain[0].low_min == plain[0].high_min:
            with_expr += 1
            if n["typ"] is not None and abs(n["typ"] - plain[0].low_min) > 0.5:
                mismatched += 1
    return {"steps_with_single_stated_time": with_expr, "typical_differs_from_text": mismatched}


# --- non-default counts (A4) ----------------------------------------------------------------------


def non_default(recipe: NormalizedRecipe) -> dict[str, Any]:
    steps = recipe.steps
    return {
        "steps": len(steps),
        "depends_on_previous_false": sum(1 for s in steps if s.depends_on_previous is False),
        "role_non_required": sum(1 for s in steps if s.role != "required"),
        "servings_source_non_default": int(recipe.servings_source != "defaulted"),
    }


# --- FGC-22: key order and the scanner -----------------------------------------------------------

TOP_ORDER = list(NormalizedRecipe.model_fields)
STEP_ORDER = list(NormalizedStep.model_fields)
ING_ORDER = list(NormalizedIngredient.model_fields)


def key_order(raw: str) -> dict[str, Any]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {"parsed": False}
    return {
        "parsed": True,
        "top_equal_schema_order": list(data) == TOP_ORDER,
        "ingredients_before_steps": list(data).index("ingredients") < list(data).index("steps"),
        "every_step_equal_schema_order": all(list(s) == STEP_ORDER for s in data["steps"]),
        "text_first_in_every_step": all(next(iter(s)) == "text" for s in data["steps"]),
        "every_ingredient_equal_schema_order": all(list(i) == ING_ORDER for i in data["ingredients"]),
    }


def scan(raw: str, lengths: list[int] | None, final: NormalizedRecipe | None) -> dict[str, Any]:
    out: dict[str, Any] = {}
    s = DraftScanner()
    for ch in raw:
        s.feed(ch)
    out["char_by_char"] = {
        "ingredients": len(s.ingredients), "steps": len(s.steps), "ingredients_complete": s.ingredients_complete,
        "steps_complete": s.steps_complete, "broken": s.broken,
    }
    if lengths:
        s2 = DraftScanner()
        pos = 0
        for n in lengths:
            s2.feed(raw[pos : pos + n])
            pos += n
        out["real_chunking"] = {
            "ingredients": len(s2.ingredients), "steps": len(s2.steps), "ingredients_complete": s2.ingredients_complete,
            "steps_complete": s2.steps_complete, "broken": s2.broken,
        }
    if final is not None:
        want = (len(final.ingredients), len(final.steps))
        for k in ("char_by_char", "real_chunking"):
            if k in out:
                out[k]["equals_final_parse"] = (out[k]["ingredients"], out[k]["steps"]) == want and not out[k]["broken"] and out[k]["steps_complete"]
    return out


# --- per-call table ------------------------------------------------------------------------------


def load_calls() -> list[dict[str, Any]]:
    recs = []
    for p in sorted(CALLS.glob("row*.json"), key=lambda p: (int(re.match(r"row(\d+)", p.name).group(1)), p.name)):
        if ".dry" in p.name:
            continue
        recs.append(json.loads(p.read_text(encoding="utf-8")))
    return recs


def analyse(rec: dict[str, Any]) -> dict[str, Any]:
    c0 = rec["calls"][0] if rec["calls"] else {}
    last = rec["calls"][-1] if rec["calls"] else {}
    usage = c0.get("usage") or {}
    marks = rec["marks_s"]
    row: dict[str, Any] = {
        "id": f"row{rec['row']}-{rec['rep']}", "row": rec["row"], "rep": rec["rep"],
        "slug": rec["slug"], "effort": rec["effort"], "strict": rec["strict"],
        "first_strict_schema_call": rec["first_strict_schema_call"],
        "first_content_s": c0.get("first_content_s"),
        "first_ingredient_s": marks.get("first_ingredient_s"),
        "ingredients_complete_s": marks.get("ingredients_complete_s"),
        "first_step_s": marks.get("first_step_s"),
        "steps_complete_s": marks.get("steps_complete_s"),
        "done_s": last.get("ended_s"),
        "first_ingredient_from_paste_s": None if "first_ingredient_s" not in marks else round(6.0 + marks["first_ingredient_s"], 1),
        "max_silence_s": c0.get("first_content_s"),
        "max_gap_s": max((c.get("max_gap_s") or 0) for c in rec["calls"]) if rec["calls"] else None,
        "input_uncached": usage.get("input_tokens_uncached"), "cached": usage.get("cached_tokens"),
        "output_tokens": usage.get("output_tokens"), "reasoning_tokens": usage.get("reasoning_tokens"),
        "retries": rec["retries"], "cost_inr": rec["cost_inr"], "tier": rec["tier"],
        "repair_would_fire": rec["repair_would_fire"], "violations_pre_repair": rec["violations_pre_repair"],
        "status": rec["status"], "error_kinds": [c["error_kind"] for c in rec["calls"]],
        "stop_reasons": [(c.get("usage") or {}).get("stop_reason") for c in rec["calls"]],
    }
    row["input_total"] = (row["input_uncached"] or 0) + (row["cached"] or 0) if usage else None
    if rec["original"] is None:
        return row
    orig = ImportOriginal.model_validate(rec["original"])
    row["non_default"] = non_default(orig.recipe)
    off = run_post(orig, False)
    on = run_post(orig, True)
    if off.result.graph is None:
        row["postprocess_status"] = off.result.status
        return row
    p_off, p_on = project(off.result), project(on.result)
    corpus = orig.source_text
    v_off, v_on = floor_violations(p_off, corpus), floor_violations(p_on, corpus)
    row["floor_violations_off"] = len(v_off)
    row["floor_violations_on"] = len(v_on)
    row["floor_violation_detail_off"] = v_off
    row["hedged_among_violations_off"] = sum(1 for v in v_off if v["hedged"])
    row["total_min_off_on"] = [p_off["total_min"], p_on["total_min"]]
    row["fgc21"] = fgc21(p_off, corpus)
    g = golden(rec["slug"])
    if g is not None:
        row["vs_golden"] = cmp_golden(p_off, g)
    row["plan_nodes"] = len(p_off["nodes"])
    row["parallel"] = p_off["parallel"]
    row["stated_multiset_len"] = len(p_off["stated"])
    raw = rec["calls"][-1]["raw_text"] if rec["calls"] else None
    if raw:
        row["key_order"] = key_order(raw)
        row["scanner"] = scan(raw, rec["calls"][-1]["delta_lengths"], orig.recipe)
    return row


def mean(xs: list[float | None]) -> float | None:
    v = [x for x in xs if x is not None]
    return round(statistics.mean(v), 2) if v else None


def spread(xs: list[float | None]) -> str:
    v = [x for x in xs if x is not None]
    return "-" if not v else (f"{min(v):.1f}" if len(v) == 1 else f"{min(v):.1f}-{max(v):.1f}")


def groups(rows: list[dict[str, Any]]) -> dict[tuple, list[dict[str, Any]]]:
    out: dict[tuple, list[dict[str, Any]]] = {}
    for r in rows:
        out.setdefault((r["slug"], r["effort"], r["strict"]), []).append(r)
    return out


def minimal_floor(rows: list[dict[str, Any]], slug: str) -> dict[str, Any]:
    """The plan's decision rule for `minimal` on one recipe, vs the strict-on low arm."""
    low = [r for r in rows if r["slug"] == slug and r["effort"] == "low" and r["strict"] and not r["first_strict_schema_call"]]
    low += [r for r in rows if r["slug"] == slug and r["effort"] == "low" and r["strict"] and r["first_strict_schema_call"]]
    mini = [r for r in rows if r["slug"] == slug and r["effort"] == "minimal" and r["strict"]]
    if not low or not mini:
        return {"slug": slug, "evaluated": False}
    out: dict[str, Any] = {"slug": slug, "evaluated": True}
    low_v = [r.get("floor_violations_off", 0) for r in low]
    mini_v = [r.get("floor_violations_off", 0) for r in mini]
    out["new_stated_time_violations"] = max(mini_v) > max(low_v)
    out["violations_low_off"], out["violations_minimal_off"] = low_v, mini_v
    out["violations_minimal_on"] = [r.get("floor_violations_on", 0) for r in mini]
    out["tier_regression"] = max(TIER_RANK.get(r["tier"], 9) for r in mini) > max(TIER_RANK.get(r["tier"], 9) for r in low)
    out["tiers_low"], out["tiers_minimal"] = [r["tier"] for r in low], [r["tier"] for r in mini]
    out["repair_rate_low"] = sum(r["repair_would_fire"] for r in low) / len(low)
    out["repair_rate_minimal"] = sum(r["repair_would_fire"] for r in mini) / len(mini)
    out["repair_worse"] = out["repair_rate_minimal"] > out["repair_rate_low"]
    for k in ("edge_recall", "edge_precision"):
        lv = [r["vs_golden"][k] for r in low if r.get("vs_golden") and r["vs_golden"][k] is not None]
        mv = [r["vs_golden"][k] for r in mini if r.get("vs_golden") and r["vs_golden"][k] is not None]
        out[f"{k}_low"], out[f"{k}_minimal"] = lv, mv
        out[f"{k}_outside_low_spread"] = bool(lv and mv and (mean(mv) < min(lv) or mean(mv) > max(lv)))
    out["passes"] = not (out["new_stated_time_violations"] or out["tier_regression"] or out["repair_worse"]
                         or out.get("edge_recall_outside_low_spread") or out.get("edge_precision_outside_low_spread"))
    return out


def fmt(x: Any) -> str:
    return "-" if x is None else (f"{x:.1f}" if isinstance(x, float) else str(x))


def main() -> None:
    recs = load_calls()
    rows = [analyse(r) for r in recs]
    res: dict[str, Any] = {"rows": rows, "minimal_floor": {}}
    for slug in ("kadhi-pakora", "croissant", "chole-bhature", "pumpkin-pancakes"):
        res["minimal_floor"][slug] = minimal_floor(rows, slug)
    (HERE / "results.json").write_text(json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8", newline="\n")

    lines = ["# PR-S3 results (generated by analyze.py)\n",
             "Raw per-call JSON (streamed text, delta sizes, usage, the extraction `original`) is NOT committed (about 85k lines). It is on the author's disk in the abc-cook-s3 worktree: `C:\\Users\\ashya\\Music\\abc-cook-s3\\notes\\pr-s3-strict-output\\calls\\row<N>-<rep>.json`. `analyze.py`, `rescore.py` and `pc_investigate.py` read it from there.\n",
             "## One line per call\n",
             "| call | recipe | effort | strict | first content | first ingr | ingr done | first step | steps done | done | max gap | in | cached | out | reason | retries | INR | tier | repair? | viol off/on | nondef dpp/role/serv | fgc21 | recall/prec edges | stop |",
             "|" + "---|" * 25]
    for r in rows:
        nd = r.get("non_default", {})
        vg = r.get("vs_golden") or {}
        lines.append("| " + " | ".join([
            r["id"] + (" (first strict)" if r["first_strict_schema_call"] else ""), r["slug"], r["effort"], "on" if r["strict"] else "off",
            fmt(r["first_content_s"]), fmt(r["first_ingredient_s"]), fmt(r["ingredients_complete_s"]), fmt(r["first_step_s"]),
            fmt(r["steps_complete_s"]), fmt(r["done_s"]), fmt(r["max_gap_s"]),
            fmt(r["input_total"]), fmt(r["cached"]), fmt(r["output_tokens"]), fmt(r["reasoning_tokens"]), str(r["retries"]),
            f"{r['cost_inr']:.2f}" if r["cost_inr"] is not None else "-", str(r["tier"]), "yes" if r["repair_would_fire"] else "no",
            f"{r.get('floor_violations_off', '-')}/{r.get('floor_violations_on', '-')}",
            f"{nd.get('depends_on_previous_false', '-')}/{nd.get('role_non_required', '-')}/{nd.get('servings_source_non_default', '-')} of {nd.get('steps', '-')}",
            f"{(r.get('fgc21') or {}).get('typical_differs_from_text', '-')}/{(r.get('fgc21') or {}).get('steps_with_single_stated_time', '-')}",
            f"{vg.get('edge_recall', '-')}/{vg.get('edge_precision', '-')}" if vg else "no golden",
            ",".join(str(x) for x in r["stop_reasons"]),
        ]) + " |")
    lines += ["\n## Arms (row 1 excluded from averages, A3)\n",
              "| recipe | effort | strict | n | first content | first ingr (call) | first ingr from paste | ingr done | steps done | done | out tokens | INR | repair rate | viol off | viol on |",
              "|" + "---|" * 15]
    for (slug, effort, strict), g in sorted(groups(rows).items()):
        gg = [r for r in g if not r["first_strict_schema_call"]]
        if not gg:
            continue
        lines.append("| " + " | ".join([
            slug, effort, "on" if strict else "off", str(len(gg)), spread([r["first_content_s"] for r in gg]),
            spread([r["first_ingredient_s"] for r in gg]), spread([r["first_ingredient_from_paste_s"] for r in gg]),
            spread([r["ingredients_complete_s"] for r in gg]), spread([r["steps_complete_s"] for r in gg]),
            spread([r["done_s"] for r in gg]), spread([r["output_tokens"] for r in gg]), spread([r["cost_inr"] for r in gg]),
            f"{sum(r['repair_would_fire'] for r in gg)}/{len(gg)}",
            str([r.get("floor_violations_off") for r in gg]), str([r.get("floor_violations_on") for r in gg]),
        ]) + " |")
    lines += ["\n## Minimal floor (plan rule + A1)\n", "```json", json.dumps(res["minimal_floor"], indent=1), "```"]
    (HERE / "results.md").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
