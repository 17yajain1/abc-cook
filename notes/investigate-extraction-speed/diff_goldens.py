"""Offline (INR 0): fuzzy structural diff of every run vs its golden, and run-vs-run noise floor.

Labels are model-written, so exact label equality is meaningless. Nodes are matched greedily on
word-set Jaccard >= 0.30; an edge counts as agreeing when both endpoints map and the other side
has that edge. Reported: node recall/precision, edge recall/precision (over mapped endpoints),
stated-duration multiset equality, and the parallel/total_min deltas.
"""

from __future__ import annotations

import json
import re

import bench_llm as b
import common as c

STOP = {"the", "a", "an", "and", "to", "of", "in", "with", "for", "until", "on", "into"}


def toks(s: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", s.lower()) if w not in STOP}


def match(a: list[dict], bb: list[dict], thr: float = 0.30) -> dict[int, int]:
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


def cmp(run: dict, ref: dict) -> dict:
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
        "nodes": f"{len(rn)} vs {len(gn)}",
        "node_recall": round(len(mp) / len(gn), 2) if gn else None,
        "node_precision": round(len(mp) / len(rn), 2) if rn else None,
        "edge_recall": round(len(g_in_scope & mapped_r) / len(g_in_scope), 2) if g_in_scope else None,
        "edge_precision": round(len(agree) / len(mapped_r), 2) if mapped_r else None,
        "edges": f"{len(r_edges)} vs {len(g_edges)}",
        "stated": f"{run['stated']} vs {ref['stated']}",
        "stated_equal": run["stated"] == ref["stated"],
        "parallel": f"{run['parallel']} vs {ref['parallel']}",
        "total_min": f"{run['total_min']} vs {ref['total_min']}",
    }


runs = [json.loads(x) for x in (c.RAW / "runs.jsonl").read_text(encoding="utf-8").splitlines()]
full = {r["run_id"]: r for r in runs if "projection" in r}
out: dict = {"vs_golden": {}, "noise_floor": {}, "arm_vs_arm": {}}
for rid, r in full.items():
    g = b.golden(r["slug"])
    if g is not None:
        out["vs_golden"][rid] = {"tier": r["tier"], **cmp(r["projection"], g)}


def pair(name: str, a: str, bb: str, bucket: str) -> None:
    if a in full and bb in full:
        out[bucket][name] = {"tiers": f"{full[a]['tier']} / {full[bb]['tier']}", **cmp(full[a]["projection"], full[bb]["projection"])}


for s in ("pizza-dough", "chole-bhature"):
    pair(f"{s}: low#0 vs low#1", f"{s}__low__0", f"{s}__low__1", "noise_floor")
for s in ("pumpkin-pancakes", "kadhi-pakora", "croissant", "vanilla-cupcakes", "pizza-dough", "chole-bhature"):
    pair(f"{s}: minimal vs low#0", f"{s}__minimal__0", f"{s}__low__0", "arm_vs_arm")
pair("chole-bhature: low#0 vs medium", "chole-bhature__low__0", "chole-bhature__medium__0", "arm_vs_arm")
pair("chole-bhature: minimal vs medium", "chole-bhature__minimal__0", "chole-bhature__medium__0", "arm_vs_arm")

c.jdump(c.OUT / "diff_goldens.json", out)
for k, v in out.items():
    print(f"\n## {k}")
    for name, d in v.items():
        print(f"- {name}: " + ", ".join(f"{a}={bb}" for a, bb in d.items()))
