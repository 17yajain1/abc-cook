"""Re-score every bench call through the real code, before vs after the two fixes (INR 0).

    PYTHONPATH=apps/api python notes/pr-s3-strict-output/rescore.py /tmp/graph_stopA.py

argv[1] is the pre-fix graph.py (`git show ff7be01:apps/api/abc_cook/extract/graph.py`), used for
the "before" column only. "After" is the working tree. No network, no keys.
"""
# ruff: noqa
import sys, json, itertools, statistics, importlib.util, datetime, collections
from pathlib import Path
from unittest import mock
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import analyze as A
from abc_cook.extract import graph as G, postprocess as PP, repair as RP
from abc_cook.extract.normalize import render_source_text
from abc_cook.extract.acquire import RawAcquisition
from abc_cook.extract.validate import validate
from abc_cook.schema.graph import SourceRef
from abc_cook.schema.normalized import ImportOriginal, NormalizedRecipe

spec = importlib.util.spec_from_file_location("abc_cook.extract.graph_before", sys.argv[1])
old = importlib.util.module_from_spec(spec); sys.modules["abc_cook.extract.graph_before"] = old; spec.loader.exec_module(old)
NOW = datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)

def before_ctx():
    es = mock.patch.object(G, "_verify_duration", old._verify_duration)
    return [es, mock.patch.object(PP, "build_graph", old.build_graph), mock.patch.object(RP, "build_graph", old.build_graph),
            mock.patch.object(G, "build_graph", old.build_graph)]

class Both:
    def __init__(self, patches): self.p = patches
    def __enter__(self): [p.start() for p in self.p]
    def __exit__(self, *a): [p.stop() for p in self.p]

def score(o, use_old):
    ctx = Both(before_ctx()) if use_old else Both([])
    with ctx:
        bg = (old if use_old else G).build_graph(o.recipe, o.source_text, graph_id="g", source=o.source)
        fires = bool(validate(bg.graph)) if bg.graph is not None else True
        res = A.run_post(o, False).result
        proj = A.project(res) if res.graph is not None else None
    viol = A.floor_violations(proj, o.source_text) if proj else []
    return {"fires": fires, "proj": proj, "floor_viol": len(viol)}

def load_frozen(slug):
    raw = RawAcquisition.model_validate_json(A.load_raw_path(slug).read_text(encoding="utf-8")) if False else None

rows = []
for r in A.load_calls():
    o = ImportOriginal.model_validate(r["original"])
    rows.append({"id": f"{r['row']}-{r['rep']}", "slug": r["slug"], "effort": r["effort"], "strict": r["strict"], "row1": r["first_strict_schema_call"],
                 "before": score(o, True), "after": score(o, False)})

def arm(slug, effort, strict, row1=True):
    return [x for x in rows if x["slug"] == slug and x["effort"] == effort and x["strict"] == strict and (row1 or not x["row1"])]

def agree(a, b):
    c1, c2 = A.cmp_golden(a["after"]["proj"], b["after"]["proj"]), A.cmp_golden(b["after"]["proj"], a["after"]["proj"])
    v = [x for x in (c1["edge_recall"], c2["edge_recall"]) if x is not None]
    return sum(v) / len(v) if v else None

def stats(vals):
    v = [x for x in vals if x is not None]
    return {"n": len(v), "mean": round(statistics.mean(v), 3), "min": round(min(v), 2), "max": round(max(v), 2)} if v else {"n": 0}

def pair_stats(xs, ys=None):
    pairs = list(itertools.combinations(xs, 2)) if ys is None else list(itertools.product(xs, ys))
    return stats([agree(a, b) for a, b in pairs])

print("=== repair-would-fire and stated-floor violations, before -> after both fixes ===")
for key in sorted({(x["slug"], x["effort"], x["strict"]) for x in rows}):
    g = arm(*key)
    print(f" {key[0]:17s} {key[1]:8s} strict={'on ' if key[2] else 'off'} n={len(g)}  repair-would-fire {sum(x['before']['fires'] for x in g)}/{len(g)} -> {sum(x['after']['fires'] for x in g)}/{len(g)}   floor-violating calls {sum(x['before']['floor_viol']>0 for x in g)} -> {sum(x['after']['floor_viol']>0 for x in g)} (violations {sum(x['before']['floor_viol'] for x in g)} -> {sum(x['after']['floor_viol'] for x in g)})")

print("\n=== edge agreement (mean of recall both ways), after both fixes ===")
res = {}
for slug in ("croissant", "kadhi-pakora"):
    for row1 in (False, True):
        on, off = arm(slug, "low", True, row1), arm(slug, "low", False)
        res[(slug, row1)] = {"within_off": pair_stats(off), "within_on": pair_stats(on), "cross": pair_stats(on, off), "n_on": len(on), "n_off": len(off)}
        print(f" {slug} (strict-on n={len(on)}{' incl. row 1' if row1 else ' excl. row 1'}, off n={len(off)}):")
        for k in ("within_off", "within_on", "cross"): print(f"    {k:11s}", res[(slug, row1)][k])
print("\n=== vs golden, after both fixes (edge recall/precision) ===")
for x in rows:
    if x["slug"] in A.GOLDEN_SLUGS:
        c = A.cmp_golden(x["after"]["proj"], A.golden(x["slug"]))
        print(f" {x['id']:5s} {x['slug']:16s} {x['effort']:7s} {'on ' if x['strict'] else 'off'} R/P {c['edge_recall']}/{c['edge_precision']}  tier-clean={not x['after']['fires']}")
json.dump({"rows": [{k: v for k, v in x.items() if k not in ('before', 'after')} | {"before_fires": x["before"]["fires"], "after_fires": x["after"]["fires"], "floor_before": x["before"]["floor_viol"], "floor_after": x["after"]["floor_viol"]} for x in rows],
           "agreement": {f"{k[0]}|row1={k[1]}": v for k, v in res.items()}}, open(HERE / "rescore.json", "w", encoding="utf-8"), indent=1)

# ---- decision rule for the strict default (STOP A decisions) ----
def frozen(slug):
    """An earlier production-config (strict off, low) run from the speed investigation, run through the fixed code."""
    raw_path = A.FIX / f"{slug}.raw.json"
    raw = RawAcquisition.model_validate_json(raw_path.read_text(encoding="utf-8"))
    rec = NormalizedRecipe.model_validate_json((REPO_RAW / f"{slug}__low__0.normalized.json").read_text(encoding="utf-8"))
    o = ImportOriginal(recipe=rec, repair=None, source_text=render_source_text(raw), raw_title=raw.title, source=SourceRef(kind="url", value=raw.source_url, imported_at=NOW), graph_id="g")
    sc = score(o, False)
    sc["cmp"] = A.cmp_golden(sc["proj"], A.golden(slug)) if sc["proj"] else None
    return sc
REPO_RAW = HERE.parents[0] / "investigate-extraction-speed" / "raw"

print("\n=== DECISION RULE (after both fixes) ===")
on, off = arm("croissant", "low", True, False), arm("croissant", "low", False)
ra, rb = sum(x["after"]["fires"] for x in on) / len(on), sum(x["after"]["fires"] for x in off) / len(off)
print(f"croissant low: strict-on n={len(on)} (excl. row 1), off n={len(off)}")
print(f" a. repair-would-fire rate on {ra:.2f} <= off {rb:.2f}: {'PASS' if ra <= rb else 'FAIL'}")
wo, cr, wn = pair_stats(off), pair_stats(on, off), pair_stats(on)
print(f"    agreement within-off {wo}\n    within-on  {wn}\n    cross      {cr}")
print(f" b. cross mean {cr['mean']} >= within-off mean {wo['mean']} - 0.05 = {round(wo['mean'] - 0.05, 3)}: {'PASS' if cr['mean'] >= wo['mean'] - 0.05 else 'FAIL'}")
viol_on = sum(x["after"]["floor_viol"] for x in rows if x["strict"] and x["effort"] == "low")
viol_off = sum(x["after"]["floor_viol"] for x in rows if not x["strict"] and x["effort"] == "low")
print(f" c. stated-floor violations with F11-a on: strict-on low calls {viol_on}, strict-off low calls {viol_off}: {'PASS' if viol_on == 0 and viol_off == 0 else 'FAIL'}")
dpass = True
for slug in ("kadhi-pakora", "pumpkin-pancakes"):
    # kadhi keeps its earlier frozen low run as extra baseline (unchanged evidence); pumpkin now has
    # a real strict-off arm of n=3 from the bench, so the rule compares bench arms only.
    base = [x["after"] for x in arm(slug, "low", False)] + ([frozen(slug)] if slug == "kadhi-pakora" else [])
    new = [x["after"] for x in arm(slug, "low", True)]
    def agg(g):
        cs = [A.cmp_golden(z["proj"], A.golden(slug)) for z in g if z["proj"]]
        r = [c["edge_recall"] for c in cs if c["edge_recall"] is not None]; p = [c["edge_precision"] for c in cs if c["edge_precision"] is not None]
        return {"n": len(g), "fires": sum(z["fires"] for z in g), "floor_viol": sum(z["floor_viol"] for z in g), "R": round(statistics.mean(r), 2) if r else None, "P": round(statistics.mean(p), 2) if p else None}
    b, n = agg(base), agg(new)
    ok = (n["fires"] / n["n"] <= b["fires"] / b["n"]) and n["floor_viol"] == 0 and (n["R"] is None or b["R"] is None or n["R"] >= b["R"] - 0.05) and (n["P"] is None or b["P"] is None or n["P"] >= b["P"] - 0.05)
    dpass &= ok
    print(f" d. {slug}: today (strict off, incl. earlier frozen low run) {b}  |  strict on {n}: {'PASS' if ok else 'FAIL'}")
pk_on, pk_off = arm("pumpkin-pancakes", "low", True), arm("pumpkin-pancakes", "low", False)
for lab, g in (("pumpkin strict-on", pk_on), ("pumpkin strict-off", pk_off)):
    for x in g:
        c = A.cmp_golden(x["after"]["proj"], A.golden("pumpkin-pancakes"))
        print(f"    {lab} {x['id']}: repair-would-fire(after fixes)={x['after']['fires']} floor_viol={x['after']['floor_viol']} R/P {c['edge_recall']}/{c['edge_precision']}")
frozen_pk = frozen("pumpkin-pancakes"); print("    (earlier frozen strict-off low run, for reference: fires", frozen_pk["fires"], "R/P", frozen_pk["cmp"]["edge_recall"], frozen_pk["cmp"]["edge_precision"], ")")
print(f" d overall: {'PASS' if dpass else 'FAIL'}")
