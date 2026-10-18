"""Before -> after of every golden and fixture, with the committed code (HEAD) vs the working tree."""
# ruff: noqa
import sys, json, importlib.util, datetime
from pathlib import Path
from unittest import mock
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import analyze as A
from abc_cook.extract import graph as G
from abc_cook.extract.postprocess import reprocess
from abc_cook.extract.normalize import render_source_text
from abc_cook.extract.acquire import RawAcquisition
from abc_cook.schema.graph import SourceRef
from abc_cook.schema.normalized import ImportOriginal, NormalizedRecipe

spec = importlib.util.spec_from_file_location("abc_cook.extract.graph_before", sys.argv[1])
old = importlib.util.module_from_spec(spec); sys.modules["abc_cook.extract.graph_before"] = old; spec.loader.exec_module(old)

cands = {}
for p in sorted(A.FIX.glob("*.original.json")) + sorted((A.FIX / "known-wrong").glob("*.original.json")):
    cands[p.name] = ImportOriginal.model_validate_json(p.read_text(encoding="utf-8"))
now = datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)
raw = RawAcquisition.model_validate_json((A.FIX / "pizza-dough.raw.json").read_text(encoding="utf-8"))
cands["pizza-dough (normalized+raw)"] = ImportOriginal(recipe=NormalizedRecipe.model_validate_json((A.FIX / "pizza-dough.normalized.json").read_text(encoding="utf-8")), repair=None, source_text=render_source_text(raw), raw_title=raw.title, source=SourceRef(kind="url", value="https://example.invalid/p", imported_at=now), graph_id="g")
cands["dal-makhni (normalized+source_text)"] = ImportOriginal(recipe=NormalizedRecipe.model_validate_json((A.FIX / "dal-makhni-multibranch.normalized.json").read_text(encoding="utf-8")), repair=None, source_text=(A.FIX / "dal-makhni-multibranch.source_text.txt").read_text(encoding="utf-8"), raw_title="dal", source=SourceRef(kind="url", value="https://example.invalid/d", imported_at=now), graph_id="g")

def snap(o, use_old):
    ctx = mock.patch.object(G, "_verify_duration", old._verify_duration) if use_old else mock.MagicMock()
    with ctx:
        res = reprocess(o).result
    p = A.project(res)
    p["tier"] = res.provenance and getattr(res, "degraded", None)
    p["status"] = res.status; p["warnings"] = list(res.warnings)
    p["n_nodes"] = len(p["nodes"]); p["edges"] = sorted((n["id"], d) for n in p["nodes"] for d in n["depends_on"])
    return p

only_min = True
for name, o in cands.items():
    b, a = snap(o, True), snap(o, False)
    changes, other = [], []
    for k in ("n_nodes", "edges", "stated", "parallel", "windows", "total_min", "saved_min", "status", "tier"):
        if b[k] != a[k]: other.append((k, b[k], a[k]))
    if b["warnings"] != a["warnings"]: other.append(("warnings", len(b["warnings"]), len(a["warnings"])))
    for nb, na in zip(b["nodes"], a["nodes"]):
        for k in ("typ", "max", "source", "window", "start", "end", "depends_on", "label"):
            if nb[k] != na[k]: other.append((nb["label"], k, nb[k], na[k]))
        if nb["min"] != na["min"]: changes.append((nb["label"], nb["min"], na["min"]))
    only_min &= not other
    print(f"{name}: nodes={a['n_nodes']} tier/status={a['status']} | duration_min changes: {changes or 'none'} | OTHER changes: {other or 'none'}")
print("ONLY duration_min changed everywhere:", only_min)

# ---- per changed node: the stated phrase it was raised to ----
print()
for name, o in cands.items():
    b, a = snap(o, True), snap(o, False)
    for nb, na in zip(b["nodes"], a["nodes"]):
        if nb["min"] != na["min"]:
            ex = A.step_exprs(na["instruction"], o.source_text, na["attention"])
            print(f"{name} | node '{na['label']}' | duration_min {nb['min']} -> {na['min']} | typical {nb['typ']} -> {na['typ']} | max {nb['max']} -> {na['max']} | stated phrase low-high {[(e.low_min, e.high_min) for e in ex]} | text: {na['instruction'][:70]!r}")
