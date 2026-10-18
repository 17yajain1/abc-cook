"""PR-S3 STOP A extras (INR 0): ledger, FGC-11 trace, F11-a diffs, FGC-22, FGC-23, A4."""
# ruff: noqa
import json, sys, re, collections
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import analyze as A
from abc_cook.schema.normalized import ImportOriginal, NormalizedRecipe
from abc_cook.extract.acquire import RawAcquisition

out = {}
led = [json.loads(l) for l in (HERE/"ledger.jsonl").read_text().splitlines()]
byrow = collections.defaultdict(float)
for l in led: byrow[l["row"]] += l["inr"]
out["spend"] = {"per_row": dict(byrow), "total": round(sum(byrow.values()), 2), "lower_bound_flags": sum(l["lower_bound"] for l in led)}

recs = A.load_calls()
# FGC-11 trace on every croissant call + the earlier frozen low output
def trace(orig):
    res = A.run_post(orig, False).result
    p = A.project(res)
    rows = []
    for i, (s, n) in enumerate(zip(orig.recipe.steps, p["nodes"])):
        pl = A.step_exprs(n["instruction"], orig.source_text, n["attention"])
        if len(pl) == 1 and s.duration_min is not None and s.duration_min < pl[0].low_min:
            v = A._orig_verify(s, orig.source_text, n["attention"])
            rows.append({"step": i, "stated": f"{pl[0].low_min:g}-{pl[0].high_min:g}", "model": [s.duration_min, s.duration_typical_min, s.duration_max],
                         "verify_out": list(v[:3]), "node": [n["min"], n["typ"], n["max"]], "node_source": n["source"],
                         "timeline_minutes": round(n["end"] - n["start"], 1), "spread_gt_15": (n["max"] - n["min"]) > 15, "hedged": bool(A.HEDGES.search(n["instruction"]))})
    return rows
out["fgc11_trace"] = {r["row"].__str__()+"-"+str(r["rep"]): trace(ImportOriginal.model_validate(r["original"])) for r in recs if r["original"] and r["slug"]=="croissant" and r["effort"]=="low"}

# recurrence at low
rec = collections.defaultdict(lambda: [0, 0])
for row in [A.analyse(r) for r in recs]:
    if row["effort"] != "low" or "floor_violations_off" not in row: continue
    k = "strict_on" if row["strict"] else "strict_off"
    rec[k][1] += 1; rec[k][0] += row["floor_violations_off"] > 0
out["recurrence_low"] = dict(rec)

# F11-a diffs for every golden / fixture original
cands = {}
for p in sorted(A.FIX.glob("*.original.json")) + sorted((A.FIX/"known-wrong").glob("*.original.json")):
    cands[p.name] = ImportOriginal.model_validate_json(p.read_text(encoding="utf-8"))
for name, rawn, norm in [("pizza-dough", "pizza-dough.raw.json", "pizza-dough.normalized.json"), ("dal-makhni", None, "dal-makhni-multibranch.normalized.json")]:
    try:
        rec_ = NormalizedRecipe.model_validate_json((A.FIX/norm).read_text(encoding="utf-8"))
        if rawn:
            raw = RawAcquisition.model_validate_json((A.FIX/rawn).read_text(encoding="utf-8"))
            from abc_cook.extract.normalize import render_source_text
            src = render_source_text(raw); title = raw.title
        else:
            src = (A.FIX/"dal-makhni-multibranch.source_text.txt").read_text(encoding="utf-8"); title = "dal"
        from abc_cook.schema.graph import SourceRef
        from abc_cook.schema.normalized import ImportOriginal as IO
        import inspect
        cands[name] = IO(recipe=rec_, repair=None, source_text=src, raw_title=title, source=SourceRef(kind="url", value="https://example.invalid/x", imported_at=__import__("datetime").datetime(2026,1,1,tzinfo=__import__("datetime").timezone.utc)), graph_id="g")
    except Exception as e:
        cands[name] = f"skipped: {type(e).__name__}: {str(e)[:120]}"
diffs = {}
for name, orig in cands.items():
    if isinstance(orig, str): diffs[name] = orig; continue
    try:
        a = A.project(A.run_reprocess(orig, False).result); b = A.project(A.run_reprocess(orig, True).result)
    except Exception as e:
        diffs[name] = f"error {type(e).__name__}: {str(e)[:100]}"; continue
    d = []
    for na, nb in zip(a["nodes"], b["nodes"]):
        if (na["min"], na["typ"], na["max"], na["source"]) != (nb["min"], nb["typ"], nb["max"], nb["source"]):
            d.append({"label": na["label"], "min": f'{na["min"]} -> {nb["min"]}', "typ": f'{na["typ"]} -> {nb["typ"]}', "max": f'{na["max"]} -> {nb["max"]}',
                      "hedged": bool(A.HEDGES.search(na["instruction"])), "spread_gt_15": f'{(na["max"]-na["min"])>15} -> {(nb["max"]-nb["min"])>15}'})
    diffs[name] = {"nodes_changed": d, "total_min": [a["total_min"], b["total_min"]], "windows": [a["windows"], b["windows"]], "parallel": [a["parallel"], b["parallel"]],
                   "plan_identical_other_than_min": [(x["typ"], x["max"], x["start"], x["end"], x["window"]) for x in a["nodes"]] == [(x["typ"], x["max"], x["start"], x["end"], x["window"]) for x in b["nodes"]]}
out["f11a_diffs"] = diffs

# FGC-15 spread, FGC-22, FGC-23, A4
rows = [A.analyse(r) for r in recs]
out["fgc15_output_tokens"] = {f"{k[0]} {k[1]} strict={'on' if k[2] else 'off'}": sorted(r["output_tokens"] for r in g) for k, g in A.groups(rows).items()}
out["fgc22"] = [{"id": r["id"], "key_order": r.get("key_order"), "scanner": r.get("scanner")} for r in rows]
out["fgc23"] = {"max_first_content_s": max(r["first_content_s"] for r in rows if r["first_content_s"]), "max_gap_s": max(r["max_gap_s"] for r in rows),
                "first_strict_call_first_content_s": rows[0]["first_content_s"]}
a4 = collections.defaultdict(lambda: [0, 0, 0, 0])
for r in rows:
    nd = r.get("non_default");
    if not nd: continue
    k = "strict_on" if r["strict"] else "strict_off"; v = a4[k]
    v[0] += nd["steps"]; v[1] += nd["depends_on_previous_false"]; v[2] += nd["role_non_required"]; v[3] += nd["servings_source_non_default"]
out["a4_steps_dpp_false_role_serv"] = dict(a4)
hon = collections.Counter()
for r in recs:
    if not r["original"]: continue
    o = ImportOriginal.model_validate(r["original"]); res = A.run_post(o, False).result
    if res.graph is None or res.provenance is None: continue
    for i, s_ in enumerate(o.recipe.steps):
        if i > 0 and s_.depends_on_previous is False and not s_.depends_on_steps:
            nid = res.graph.nodes[i].id
            hon[("strict_on" if r["strict"] else "strict_off", str(res.provenance.nodes[nid].fields.get("dependencies")))] += 1
out["a4_independent_steps_dependency_provenance"] = {f"{k[0]}:{k[1]}": v for k, v in hon.items()}
(HERE/"results2.json").write_text(json.dumps(out, indent=1, ensure_ascii=False, default=str), encoding="utf-8", newline="\n")
print(json.dumps(out, indent=1, ensure_ascii=False, default=str)[:14000])
