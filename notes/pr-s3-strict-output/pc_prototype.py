"""Prototype (offline, INR 0): drop `produces` on a final step before build_graph; re-score all calls."""
# ruff: noqa
import sys, collections
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import analyze as A
from abc_cook.extract.graph import build_graph
from abc_cook.extract.validate import validate
from abc_cook.schema.normalized import ImportOriginal

def fixed(o):
    steps = list(o.recipe.steps)
    steps[-1] = steps[-1].model_copy(update={"produces_component": None})
    return o.model_copy(update={"recipe": o.recipe.model_copy(update={"steps": steps})})

g = {s: A.golden(s) for s in A.GOLDEN_SLUGS}
tab = collections.defaultdict(lambda: {"n": 0, "fire_before": 0, "fire_after": 0, "R": [], "P": []})
for r in A.load_calls():
    o = ImportOriginal.model_validate(r["original"]); k = (r["slug"], r["effort"], "on" if r["strict"] else "off")
    def fires(oo):
        b = build_graph(oo.recipe, oo.source_text, graph_id="g", source=oo.source); return bool(validate(b.graph))
    t = tab[k]; t["n"] += 1; t["fire_before"] += fires(o); t["fire_after"] += fires(fixed(o))
    if r["slug"] in g:
        c = A.cmp_golden(A.project(A.run_post(fixed(o), False).result), g[r["slug"]])
        t["R"].append(c["edge_recall"]); t["P"].append(c["edge_precision"])
for k, t in sorted(tab.items()):
    print(k, f"repair-would-fire before {t['fire_before']}/{t['n']} -> after {t['fire_after']}/{t['n']}", "edge R", t["R"], "P", t["P"])
# goldens: any final-step produces?
for s in A.GOLDEN_SLUGS:
    o = ImportOriginal.model_validate_json((A.FIX / f"{s}.original.json").read_text(encoding="utf-8"))
    print("golden", s, "final step produces_component =", o.recipe.steps[-1].produces_component)
