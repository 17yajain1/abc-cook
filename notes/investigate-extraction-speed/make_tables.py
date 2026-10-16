"""Emit tables.md (markdown) from raw/*.jsonl + diff_goldens.json + b0.json. INR 0."""

from __future__ import annotations

import json

import common as c

runs = [json.loads(x) for x in (c.RAW / "runs.jsonl").read_text(encoding="utf-8").splitlines()]
ledger = [json.loads(x) for x in (c.RAW / "ledger.jsonl").read_text(encoding="utf-8").splitlines()]
dg = json.loads((c.OUT / "diff_goldens.json").read_text(encoding="utf-8"))
b0 = json.loads((c.OUT / "b0.json").read_text(encoding="utf-8"))
o: list[str] = []

o.append("### T1. Spend per run (INR, running total, cap 30)\n")
o.append("| run | INR | running |\n|---|---|---|")
t = 0.0
for e in ledger:
    t += e["inr"]
    o.append(f"| {e['label']} | {e['inr']:.2f} | {t:.2f} |")
o.append(f"\n**Total INR {t:.2f} of 30.** Sonnet repair was stubbed (0 calls). B2 and B0 cost INR 0.\n")

o.append("### T2. Full-extraction matrix (gpt-5-mini; repair stubbed; goldens are MEDIUM-effort output)\n")
o.append("| recipe | arm | wall s | calls | input tok (cached) | reasoning | visible out | INR | tier | steps | validate | repair would fire (rules) | vs golden: node recall / edge recall / stated durations equal |")
o.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
for r in runs:
    if r.get("kind") or "calls" not in r:
        continue
    cs = r["calls"]
    c0 = cs[0]
    d = dg["vs_golden"].get(r["run_id"])
    gd = f"{d['node_recall']} / {d['edge_recall']} / {d['stated_equal']}" if d else ("no golden" if r["slug"] == "chole-bhature" else "-")
    o.append(
        f"| {r['slug']} | {r['arm']}{'#'+str(r['rep']) if r['rep'] else ''}{' (translate-first)' if 'translate' in r['run_id'] else ''} | {r['wall_s']} | {len(cs)} | "
        f"{c0['input']} ({c0['cached']}) | {'+'.join(str(x['reasoning']) for x in cs)} | {'+'.join(str(x['visible']) for x in cs)} | {r['inr']:.2f} | "
        f"{r['tier']} | {r.get('steps')} | {r.get('validate_pass')} | {('YES: ' + ','.join(r.get('rules') or [])) if r.get('would_fire') else 'no'} | {gd} |"
    )

o.append("\n### T3. Chole attempts (FU1ZVLMbWjA, 11,602-char Hindi transcript)\n")
o.append("| attempt | max_tokens | wall s | reasoning | visible | reached a plan? | tier | steps | INR |\n|---|---|---|---|---|---|---|---|---|")
o.append("| CAPTURE 2026-10-16 (effort_ab `medium` = provider default) | 16000 | 141.1 | 16000 | 0 | NO (Tier 0) | tier0 | 0 | 2.75 |")
for r in runs:
    if r.get("slug") == "chole-bhature" and "calls" in r:
        c0 = r["calls"][0]
        name = r["arm"] + ("#" + str(r["rep"]) if r["rep"] else "") + (" + translate-first (gpt-4.1-mini, +%ss, +INR %s)" % (r["extra"]["translate_s"], r["extra"]["translate_inr"]) if "translate" in r["run_id"] else "")
        o.append(f"| {name} | {r['max_tokens']} | {r['wall_s']} | {c0['reasoning']} | {c0['visible']} | {'YES' if r['tier'] != 'tier0' else 'NO'} | {r['tier']} | {r.get('steps')} | {r['inr']:.2f} |")
o.append("| 32K probe | 32000 | not run | - | - | - | - | - | 0 (rule: only if some 16K attempt failed; none did) |")

o.append("\n### T4. Tokens per character (tiktoken o200k_base; matches API usage within +2 tokens on all 6)\n")
o.append("| recipe | lang | transcript chars | transcript UTF-8 bytes | transcript tokens | tok/char (transcript) | tok/char (whole source) | predicted input | API input |\n|---|---|---|---|---|---|---|---|---|")
api = {}
for r in runs:
    if "calls" in r and r["arm"] in ("low", "minimal") and r["run_id"].split("__")[0] not in api and "translate" not in r["run_id"]:
        api[r["slug"]] = r["calls"][0]["input"]
for s, v in b0["tokens"]["per_recipe"].items():
    o.append(f"| {s} | {v['transcript_lang']} | {v['transcript_chars']} | {v['transcript_utf8_bytes']} | {v['transcript_tokens']} | {v['transcript_tok_per_char']} | {v['src_tokens_per_char']} | {v['predicted_input_tokens']} | {api.get(s)} |")
tk = b0["tokens"]
o.append(f"\nSystem prompt = {tk['system_total']} tok = v7.md {tk['v7_md']} + JSON-Schema/format wrapper {tk['schema_and_wrapper']}. Blog JSON-LD (pizza): {b0['tokens']['per_recipe']['pizza-dough']['blog_json_tokens_indent2']} tok pretty vs {b0['tokens']['per_recipe']['pizza-dough']['blog_json_tokens_compact']} compact.\n")

o.append("### T5. Staged fast call (flat schema; scratch prompt) vs full call at low\n")
o.append("| recipe | model | wall s | in | reasoning | out | INR | steps | stated minutes | full-call wall s (low) |\n|---|---|---|---|---|---|---|---|---|---|")
low = {r["slug"]: r["wall_s"] for r in runs if "calls" in r and r["arm"] == "low" and r["rep"] == 0 and "translate" not in r["run_id"]}
for r in runs:
    if r.get("kind") == "fast":
        o.append(f"| {r['slug']} | {r['model']} | {r['wall_s']} | {r['input']} | {r['reasoning']} | {r['output']} | {r['inr']:.2f} | {r.get('steps')} | {r.get('stated')} | {low.get(r['slug'])} |")

o.append("\n### T6. Streaming probes (kadhi-pakora)\n")
o.append("| call | first visible token s | ingredients key s | steps key s | first step complete s | total s | out tok | reasoning | INR |\n|---|---|---|---|---|---|---|---|---|")
for r in runs:
    if r.get("kind") == "stream":
        m = r["marks"]
        o.append(f"| {r['name']} | {m.get('first_visible_token_s')} | {m.get('ingredients_key_s')} | {m.get('steps_key_s')} | {m.get('first_step_complete_s')} | {m.get('total_s')} | {r['output_tokens']} | {r['reasoning_tokens']} | {r['inr']:.2f} |")

o.append("\n### T7. Run-to-run noise floor and arm-vs-arm (fuzzy structural diff)\n")
o.append("| comparison | tiers | node recall | edge recall | edge precision | stated durations | total_min |\n|---|---|---|---|---|---|---|")
for bucket in ("noise_floor", "arm_vs_arm"):
    for k, v in dg[bucket].items():
        o.append(f"| {k} | {v['tiers']} | {v['node_recall']} | {v['edge_recall']} | {v['edge_precision']} | {v['stated']} | {v['total_min']} |")

(c.OUT / "tables.md").write_text("\n".join(o) + "\n", encoding="utf-8")
print("\n".join(o))
