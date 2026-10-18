"""produces_consumed investigation (INR 0). No live call, no repair call."""
# ruff: noqa
import json, sys, collections, itertools
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import analyze as A
from abc_cook.extract.graph import build_graph
from abc_cook.extract.validate import validate
from abc_cook.schema.normalized import ImportOriginal

recs = {f"{r['row']}-{r['rep']}": r for r in A.load_calls()}
CROISSANT = ["1-0","2-0","2-1","3-0","3-1","3-2","7-0","7-1","7-2"]
out = {}

def raw_steps(r):
    return json.loads(r["calls"][-1]["raw_text"])["steps"]

# 1. every violation, with raw fields exactly as emitted
print("=== 1. produces_consumed violations per croissant call (raw model fields as emitted) ===")
for cid in CROISSANT:
    r = recs[cid]; o = ImportOriginal.model_validate(r["original"])
    br = build_graph(o.recipe, o.source_text, graph_id="g", source=o.source)
    viols = validate(br.graph)
    steps = raw_steps(r)
    idx = {n.id: i for i, n in enumerate(br.graph.nodes)}
    print(f"\n-- {cid}  strict={'on' if r['strict'] else 'off'} effort={r['effort']}  violations={[(v.rule) for v in viols]}")
    for v in viols:
        print("   ", v.rule, "|", v.message)
        if v.rule != "produces_consumed": continue
        nid = v.message.split('"')[1]; i = idx[nid]; s = steps[i]
        print(f"    step {i}: {s['text']!r}")
        print(f"      raw: produces_component={s.get('produces_component','<KEY ABSENT>')!r} consumes_ingredients={s.get('consumes_ingredients','<KEY ABSENT>')!r} depends_on_steps={s.get('depends_on_steps','<KEY ABSENT>')!r} depends_on_previous={s.get('depends_on_previous','<KEY ABSENT>')!r}")
        lab = (s.get('produces_component') or '').lower()
        for j in range(i+1, len(steps)):
            cons = steps[j].get('consumes_ingredients') or []
            hit = [c for c in cons if lab and (lab in c.lower() or c.lower() in lab)]
            if hit or (steps[j].get('depends_on_steps') and i in steps[j]['depends_on_steps']):
                print(f"      later step {j}: consumes={cons!r} depends_on_steps={steps[j].get('depends_on_steps','<ABSENT>')!r} dpp={steps[j].get('depends_on_previous','<ABSENT>')!r} :: {steps[j]['text'][:70]!r}")
        print("      later steps whose consumes name it:", [j for j in range(i+1, len(steps)) if any(lab and (lab in c.lower() or c.lower() in lab) for c in (steps[j].get('consumes_ingredients') or []))])

# 2. field-by-field presence/emptiness stats
print("\n=== 2. field fill rates per arm (croissant, low: key absent / null / [] / filled) ===")
FIELDS = ["produces_component","consumes_ingredients","depends_on_steps","depends_on_previous","attach_to_step","role_cue","attention_cue","label"]
for arm, ids in (("strict-off", ["3-0","3-1","3-2"]), ("strict-on", ["1-0","2-0","2-1"]), ("strict-on minimal", ["7-0","7-1","7-2"])):
    print(f" {arm}:")
    for f in FIELDS:
        c = collections.Counter(); n = 0
        for cid in ids:
            for s in raw_steps(recs[cid]):
                n += 1
                if f not in s: c["absent"] += 1
                elif s[f] is None: c["null"] += 1
                elif s[f] == [] : c["[]"] += 1
                elif s[f] is False: c["false"] += 1
                else: c["filled"] += 1
        print(f"   {f:22s} n={n:3d} {dict(c)}")
print(" produced labels per call (producer step idx: label -> later consumers by name match):")
for cid in CROISSANT:
    steps = raw_steps(recs[cid]); items = []
    for i, s in enumerate(steps):
        lab = s.get("produces_component")
        if lab:
            l = lab.lower()
            cons = [j for j in range(i+1, len(steps)) if any(l in c.lower() or c.lower() in l for c in (steps[j].get("consumes_ingredients") or []))]
            items.append((i, lab, cons))
    print("  ", cid, "on" if recs[cid]["strict"] else "off", recs[cid]["effort"], items)

# 6. fairness: pairwise edge agreement
print("\n=== 6. pairwise edge agreement (same matcher; recall/precision of A vs B) ===")
proj = {}
for cid in CROISSANT:
    o = ImportOriginal.model_validate(recs[cid]["original"])
    proj[cid] = A.project(A.run_post(o, False).result)
gold = A.golden("croissant")
def show(name, ids):
    vals = []
    for a, b in itertools.combinations(ids, 2):
        c1 = A.cmp_golden(proj[a], proj[b]); c2 = A.cmp_golden(proj[b], proj[a])
        vals.append((a, b, c1["edge_recall"], c1["edge_precision"], c2["edge_recall"], c2["edge_precision"]))
    print(f" {name}:")
    for v in vals: print("   %s vs %s: R/P(a|b)=%s/%s  R/P(b|a)=%s/%s" % v)
    flat = [x for v in vals for x in v[2:] if x is not None]
    print("   range of all pairwise numbers:", min(flat), "-", max(flat), " mean", round(sum(flat)/len(flat), 2))
show("strict-off pairs", ["3-0","3-1","3-2"])
show("strict-on pairs (low)", ["1-0","2-0","2-1"])
print(" vs golden:")
for cid in CROISSANT:
    c = A.cmp_golden(proj[cid], gold); print(f"   {cid} {'on ' if recs[cid]['strict'] else 'off'} {recs[cid]['effort']}: R/P {c['edge_recall']}/{c['edge_precision']} nodes {c['nodes']}")
cross = [A.cmp_golden(proj[a], proj[b]) for a in ["1-0","2-0","2-1"] for b in ["3-0","3-1","3-2"]]
print(" cross on-vs-off recall/precision:", [(c['edge_recall'], c['edge_precision']) for c in cross])

# 7. counts on every call
print("\n=== 7. produces_consumed count per call (pre-repair rules) ===")
tot = collections.defaultdict(lambda: [0, 0])
for cid, r in sorted(recs.items(), key=lambda kv: (int(kv[0].split('-')[0]), kv[0])):
    n = r["violations_pre_repair"].count("produces_consumed")
    print(f" {cid:5s} {r['slug']:17s} {r['effort']:8s} strict={'on ' if r['strict'] else 'off'} rules={r['violations_pre_repair']} produces_consumed={n}")
    k = (r['slug'], r['effort'], r['strict']); tot[k][0] += n > 0; tot[k][1] += 1
print(" calls with >=1 produces_consumed / calls:")
for k, v in sorted(tot.items()): print("  ", k, f"{v[0]}/{v[1]}")

# 3/5 extras: is the producer always the final step? what can repair do (no LLM)?
print("\n=== final-step check, all calls ===")
from abc_cook.extract.repair import replay_repair_or_degrade
from abc_cook.schema.normalized import RepairProposal, StepRepair
last_prod = collections.defaultdict(lambda: [0, 0])
for cid, r in sorted(recs.items(), key=lambda kv: (int(kv[0].split('-')[0]), kv[0])):
    steps = raw_steps(r); o = ImportOriginal.model_validate(r["original"])
    br = build_graph(o.recipe, o.source_text, graph_id="g", source=o.source)
    viols = [v for v in validate(br.graph) if v.rule == "produces_consumed"]
    idx = {n.id: i for i, n in enumerate(br.graph.nodes)}
    where = [(idx[v.message.split('"')[1]], len(steps)) for v in viols]
    lp = bool(steps[-1].get("produces_component"))
    k = (r['slug'], r['effort'], r['strict']); last_prod[k][0] += lp; last_prod[k][1] += 1
    print(f" {cid:5s} {r['slug']:16s} {r['effort']:7s} {'on ' if r['strict'] else 'off'} violating (step, of n)={where} final-step-has-produces_component={lp} second-to-last={bool(steps[-2].get('produces_component'))}")
print(" calls whose FINAL step carries produces_component / calls:")
for k, v in sorted(last_prod.items()): print("  ", k, f"{v[0]}/{v[1]}")
print("\n=== repair, no LLM: replay with hand-built proposals on call 1-0 ===")
r = recs["1-0"]; o = ImportOriginal.model_validate(r["original"])
br = build_graph(o.recipe, o.source_text, graph_id="g", source=o.source); viols = validate(br.graph)
n = len(o.recipe.steps)
for name, prop in (("no-op proposal (all fields omitted)", RepairProposal(steps=[StepRepair() for _ in range(n)])),
                   ("no proposal", None)):
    out = replay_repair_or_degrade(o.recipe, o.source_text, viols, prop, graph_id="g", source=o.source)
    print(f" {name}: tier={out.tier} nodes={len(out.build_result.graph.nodes)} edges={sum(len(x.depends_on) for x in out.build_result.graph.nodes)}")
steps = [StepRepair() for _ in range(n)]; steps[n-1] = StepRepair(produces_component="")
out = replay_repair_or_degrade(o.recipe, o.source_text, viols, RepairProposal(steps=steps), graph_id="g", source=o.source)
print(f" produces_component='' on the last step: tier={out.tier}")
print(f" baseline postprocess edges (unrepaired structure) = {sum(len(x.depends_on) for x in br.graph.nodes)} edges, tier would be repaired/degraded:", )
