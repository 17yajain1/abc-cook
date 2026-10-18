"""Offline (INR 0) analysis of notes/fgc-345/calls/*.json -> summary.md + printed tables."""
import json
import re
import statistics
import sys
from collections import defaultdict
from itertools import combinations
from pathlib import Path

ROOT = Path(__file__).parent
calls = []
for f in sorted((ROOT / "calls").glob("*.json")):
    if f.name.endswith(".dry.json"):
        continue
    calls.append(json.loads(f.read_text(encoding="utf-8")))
calls.sort(key=lambda c: (c["slug"], c["arm"], c["rep"]))

STAPLE = {"ing_salt", "ing_water", "ing_oil"}


def ancestors(nodes, nid):
    by = {n["id"]: n for n in nodes}
    seen, stack = set(), list(by[nid]["depends_on"])
    while stack:
        x = stack.pop()
        if x in seen:
            continue
        seen.add(x)
        stack.extend(by[x]["depends_on"])
    return seen


def gap_fires(plan):
    if not plan:
        return None
    nodes = plan["nodes"]
    by = {n["id"]: n for n in nodes}
    for n in nodes:
        if n["attention"] == "hands_on":
            continue
        raw = {c for c in n["consumes"] if c.startswith("ing_") and c not in STAPLE}
        touched = set()
        for a in ancestors(nodes, n["id"]):
            if by[a]["attention"] == "hands_on":
                touched |= set(by[a]["consumes"])
        if len(raw - touched) >= 2:
            return n["label"]
    return False


def rule2(c):
    plan = c["plan"]
    if not plan:
        return False
    nodes = plan["nodes"]
    bake = next((n for n in nodes if "bake" in n["label"].lower() or "bake" in n["instruction"].lower()), None)
    added = [n for n in nodes if n["origin"] == "added" and n["attention"] == "hands_on"]
    names = " ".join(" ".join(n["consumes"]) for n in added).lower()
    ok_ing = ("butter" in names or "sugar" in names) and any(k in names for k in ("flour", "egg", "milk"))
    pre = bake is not None and all(
        (n["start_min"] is not None and bake["start_min"] is not None and n["start_min"] < bake["start_min"])
        for n in added
    )
    return bool(added) and ok_ing and pre


STOP = {"the", "a", "an", "and", "to", "of", "in", "with", "for", "until", "on", "into"}


def toks(s):
    return {w for w in re.findall(r"[a-z0-9]+", s.lower()) if w not in STOP}


def match(a, b, thr=0.30):
    pairs = []
    for i, x in enumerate(a):
        for j, y in enumerate(b):
            tx, ty = toks(x["label"]), toks(y["label"])
            if tx and ty and len(tx & ty) / len(tx | ty) >= thr:
                pairs.append((len(tx & ty) / len(tx | ty), i, j))
    pairs.sort(reverse=True)
    mp, used = {}, set()
    for _s, i, j in pairs:
        if i not in mp and j not in used:
            mp[i] = j
            used.add(j)
    return mp


def edge_agree(p, q):
    """Symmetric mean of edge recall/precision over mapped endpoints (source nodes only)."""
    a = [n for n in p["nodes"] if n["origin"] == "source"]
    b = [n for n in q["nodes"] if n["origin"] == "source"]
    mp = match(a, b)
    ai = {n["id"]: i for i, n in enumerate(a)}
    bi = {n["id"]: i for i, n in enumerate(b)}
    ea = {(ai[d], i) for i, n in enumerate(a) for d in n["depends_on"] if d in ai}
    eb = {(bi[d], i) for i, n in enumerate(b) for d in n["depends_on"] if d in bi}
    mapped = {(mp[x], mp[y]) for x, y in ea if x in mp and y in mp}
    inv = set(mp.values())
    scope = {(x, y) for x, y in eb if x in inv and y in inv}
    if not scope or not mapped:
        return None
    rec = len(scope & mapped) / len(scope)
    prec = len(mapped & eb) / len(mapped)
    return (rec + prec) / 2


out = []
w = out.append
w("## A/B table (one row per call)\n")
w("| call | tier | repair-would-fire | first ingr s | steps done s | done s | max silence s | max gap s | out tok | reasoning | INR | added | must-choose (added/role!=req/dop=false/serv stated) |")
w("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
for c in calls:
    m = c["marks_s"]
    u = (c["calls"][0].get("usage") or {}) if c["calls"] else {}
    mc = c["must_choose"]
    w(
        f"| {c['call_id']} | {c['tier']} | {c['repair_would_fire']} | {m.get('first_ingredient_s')} | "
        f"{m.get('steps_complete_s')} | {c['total_s']} | {c['max_silence_s']} | {c['max_inter_delta_gap_s']} | "
        f"{u.get('output_tokens')} | {u.get('reasoning_tokens')} | {c['cost_inr']} | "
        f"{len(c['added_steps_in_model_output'])} | {mc.get('origin_added')}/{mc.get('role_not_required')}/{mc.get('depends_on_previous_false')}/{mc.get('servings_source_stated')} |"
    )

w("\n## Per recipe/arm medians\n")
w("| recipe | arm | n | first ingr median | steps done median | done median | tiers |")
w("|---|---|---|---|---|---|---|")
grp = defaultdict(list)
for c in calls:
    grp[(c["slug"], c["arm"])].append(c)
for (slug, arm), cs in sorted(grp.items()):
    med = lambda k: statistics.median([x["marks_s"][k] for x in cs if k in x["marks_s"]]) if any(k in x["marks_s"] for x in cs) else None
    w(f"| {slug} | {arm} | {len(cs)} | {med('first_ingredient_s')} | {med('steps_complete_s')} | {statistics.median(x['total_s'] for x in cs):.1f} | {[x['tier'] for x in cs]} |")

w("\n## Must-choose counts per arm (sum over calls)\n")
for arm in "AB":
    tot = defaultdict(int)
    for c in calls:
        if c["arm"] == arm:
            for k, v in c["must_choose"].items():
                tot[k] += v
    w(f"- arm {arm}: {dict(tot)}")

w("\n## Every added step (model output), by recipe\n")
for slug in sorted({c["slug"] for c in calls}):
    w(f"### {slug}")
    for c in calls:
        if c["slug"] != slug:
            continue
        for s in c["added_steps_in_model_output"]:
            w(f"- {c['call_id']} step {s['index']}: \"{s['text']}\" attention={s['attention']} duration={s['duration']} stated={s['duration_stated']} consumes={s['consumes']} produces={s['produces']} role={s['role']}")
        if not c["added_steps_in_model_output"] and c["arm"] == "B":
            w(f"- {c['call_id']}: none")

w("\n## Guard drops (warnings 'Dropped the step ABC Cook would have added'), by call\n")
dr = defaultdict(lambda: defaultdict(int))
for c in calls:
    for x in c["warnings"]:
        if x.startswith("Dropped the step ABC Cook would have added"):
            reason = x.rsplit(": ", 1)[-1].rstrip(".")
            reason = re.sub(r'it uses ".*?"', 'it uses an unlisted ingredient', reason)
            dr[c["arm"]][reason] += 1
            w(f"- {c['call_id']}: {x}")
        if x.startswith("Cleared "):
            dr[c["arm"]]["produces cleared"] += 1
            w(f"- {c['call_id']}: {x}")
w(f"\nTotals per arm: {({k: dict(v) for k, v in dr.items()})}")

w("\n## Added steps that reached the plan\n")
for c in calls:
    if not c["plan"]:
        continue
    for n in c["plan"]["nodes"]:
        if n["origin"] == "added":
            w(f"- {c['call_id']}: \"{n['instruction']}\" {n['attention']} {n['duration']} src={n['duration_source']} consumes={n['consumes']} start={n['start_min']}")

w("\n## Rule 2 / gap metric (cupcakes)\n")
for c in calls:
    if c["slug"] == "vanilla-cupcakes":
        w(f"- {c['call_id']}: rule2 pass={rule2(c) if c['arm']=='B' else 'n/a'}; gap metric fires on={gap_fires(c['plan'])}; total_min={c['plan'] and c['plan']['total_min']}; nodes={[n['label'] for n in c['plan']['nodes']] if c['plan'] else None}")

w("\n## Stated (extracted) durations per recipe/arm, as sorted (min,typ,max) multisets\n")
for (slug, arm), cs in sorted(grp.items()):
    for c in cs:
        if c["plan"]:
            ms = sorted(tuple(n["duration"]) for n in c["plan"]["nodes"] if n["duration_source"] == "extracted")
            w(f"- {c['call_id']}: {ms}")

w("\n## Edge agreement (source nodes, S3 matcher; mean of recall/precision)\n")
for slug in sorted({c["slug"] for c in calls}):
    A = [c["plan"] for c in grp.get((slug, "A"), []) if c["plan"]]
    B = [c["plan"] for c in grp.get((slug, "B"), []) if c["plan"]]
    within = [edge_agree(p, q) for p, q in combinations(A, 2)] + [edge_agree(q, p) for p, q in combinations(A, 2)]
    cross = [edge_agree(p, q) for p in A for q in B] + [edge_agree(q, p) for p in A for q in B]
    f = lambda v: None if not [x for x in v if x is not None] else round(statistics.mean([x for x in v if x is not None]), 3)
    w(f"- {slug}: within-A {f(within)} (pairs {len(within)//2}), cross A x B {f(cross)} (pairs {len(cross)//2})")

w("\n## Pumpkin: serving ways and 'Serve with chips'\n")
for c in calls:
    if c["slug"] != "pumpkin-pancakes":
        continue
    steps = c["original"]["recipe"]["steps"] if c["original"] else []
    w(f"### {c['call_id']} (tier {c['tier']})")
    for i, s in enumerate(steps):
        if s["role"] != "required" or re.search(r"serve|eat|ways|chips|syrup", s["text"], re.I):
            w(f"- step {i}: role={s['role']} attach={s['attach_to_step']} cue={s['role_cue']!r} text={s['text']!r}")
    if c["plan"]:
        w(f"- plan nodes: {[n['label'] for n in c['plan']['nodes']]}")
        w(f"- tips: {[n['tip'] for n in c['plan']['nodes'] if n['tip']]}")
        chips = [n for n in c["plan"]["nodes"] if "chips" in (n["label"] + n["instruction"]).lower() and not n["tip"]]
        w(f"- 'chips' required node(s): {[(n['label'], n['depends_on']) for n in chips]}; total_min={c['plan']['total_min']}")
    w(f"- warnings on roles: {[x for x in c['warnings'] if 'optional' in x or 'alternative' in x or 'borrowed' in x or 'note' in x.lower()]}")

w("\n## Chole (B1)\n")
for c in calls:
    if c["slug"] == "chole-bhature":
        w(f"- tier={c['tier']} added={c['added_steps_in_model_output']} silence={c['max_silence_s']} gap={c['max_inter_delta_gap_s']} marks={c['marks_s']}")

w("\n## partial-ingredients-only\n")
for c in calls:
    if c["slug"] == "partial-ingredients-only":
        w(f"- {c['call_id']}: status={c['status']} tier={c['tier']} steps_in_output={len(c['original']['recipe']['steps']) if c['original'] else None} added={len(c['added_steps_in_model_output'])}")

w("\n## Violations pre-repair (repair-would-fire)\n")
for c in calls:
    if c["violations_pre_repair"] or c["repair_would_fire"]:
        w(f"- {c['call_id']}: {c['violations_pre_repair']}")

text = "\n".join(out)
(ROOT / "summary.md").write_text(text, encoding="utf-8", newline="\n")
sys.stdout.reconfigure(encoding="utf-8")
print(text)
