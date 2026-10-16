"""B0 (INR 0): capture effort per fixture, tokens-per-char offline, models.list (free)."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import common as c
import tiktoken
from abc_cook.extract.adapters.prompting import system_prompt
from abc_cook.extract.normalize import load_prompt, render_source_text
from abc_cook.schema.normalized import NormalizedRecipe

CAP = Path(
    r"C:\Users\ashya\AppData\Local\Temp\claude\C--Users-ashya-Music-abc-cook-corpus"
    r"\e4512937-3d6d-4c31-a880-6e4e8a0e0ead\scratchpad\corpus-capture"
)
SMOKE = Path(r"C:\Users\ashya\Music\ABC cook\notes\step3-effort-ab\pizza-dough-smoke")
VID = {
    "pumpkin-pancakes": "TYZNzCnNGwA",
    "kadhi-pakora": "Oa2s0dklrRo",
    "croissant": "OzdqThvpMko",
    "vanilla-cupcakes": "YP8a6ugKQ6Y",
    "chole-bhature": "FU1ZVLMbWjA",
}

out: dict = {"capture_effort": {}, "tokens": {}, "models": {}}

# ---- 1. capture effort -------------------------------------------------------------
rows = {r["run_id"]: r for r in json.loads((CAP / "results.json").read_text(encoding="utf-8"))}
shutil.copy(CAP / "results.json", c.RAW / "corpus-capture.results.json")
for slug, vid in VID.items():
    r = rows[f"https---www-youtube-com-watch-v-{vid}__medium__0"]
    out["capture_effort"][slug] = {
        "arm": "medium",
        "effort_sent": "None (provider default; effort_ab.ARM_EFFORT['medium'] is None)",
        "extract_s": r["extract_s"],
        "output_tokens": r["output_tokens"],
        "reasoning_tokens": r["reasoning_tokens"],
        "cost_inr": round(r["cost_inr"], 2),
        "tier": r["tier"],
        "steps": r["steps"],
        "truncations": r["truncations"],
        "violations": r["violations"],
        "repair_attempted": r["repair_attempted"],
        "repair_s": r["repair_s"],
    }
# pizza: which smoke arm (if any) equals the committed golden?
golden = json.loads((c.FIX / "pizza-dough.normalized.json").read_text(encoding="utf-8"))
pz = {}
for arm in ("low", "medium"):
    n = json.loads((SMOKE / f"pizza-dough__{arm}__0.call0.normalized.json").read_text(encoding="utf-8"))
    pz[arm] = {"identical_to_committed_golden": n == golden, "steps": len(n.get("steps", []))}
out["capture_effort"]["pizza-dough"] = {
    "note": "no committed capture record; smoke runs exist for low and medium",
    "smoke_vs_golden": pz,
}

# ---- 2. tokens per char (tiktoken o200k_base) ----------------------------------------
enc = tiktoken.get_encoding("o200k_base")
sysp = system_prompt(load_prompt(), NormalizedRecipe)
prompt_only = load_prompt()
n_sys = len(enc.encode(sysp))
n_prompt = len(enc.encode(prompt_only))
out["tokens"]["system_total"] = n_sys
out["tokens"]["v7_md"] = n_prompt
out["tokens"]["schema_and_wrapper"] = n_sys - n_prompt
out["tokens"]["v7_md_chars"] = len(prompt_only)
out["tokens"]["system_chars"] = len(sysp)
per = {}
for slug in c.INPUTS:
    raw = c.load_raw(slug)
    src = render_source_text(raw)
    tr = raw.transcript or ""
    desc = raw.description or ""
    blog = json.dumps(raw.blog_recipe, ensure_ascii=False, indent=2) if raw.blog_recipe else ""
    t_src = len(enc.encode(src))
    per[slug] = {
        "source_chars": len(src),
        "source_utf8_bytes": len(src.encode("utf-8")),
        "source_tokens": t_src,
        "src_tokens_per_char": round(t_src / len(src), 3),
        "transcript_chars": len(tr),
        "transcript_utf8_bytes": len(tr.encode("utf-8")),
        "transcript_tokens": len(enc.encode(tr)) if tr else 0,
        "transcript_tok_per_char": round(len(enc.encode(tr)) / len(tr), 3) if tr else None,
        "description_chars": len(desc),
        "description_tokens": len(enc.encode(desc)) if desc else 0,
        "blog_json_chars_indent2": len(blog),
        "blog_json_tokens_indent2": len(enc.encode(blog)) if blog else 0,
        "blog_json_tokens_compact": len(enc.encode(json.dumps(raw.blog_recipe, ensure_ascii=False, separators=(",", ":")))) if raw.blog_recipe else 0,
        "transcript_lang": raw.transcript_lang,
        "predicted_input_tokens": n_sys + t_src + 8,
    }
out["tokens"]["per_recipe"] = per

# ---- 3. models.list (free) ---------------------------------------------------------
import openai  # noqa: E402

ids = sorted(m.id for m in openai.OpenAI().models.list().data)
want = ["gpt-5-mini", "gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1-nano", "gpt-5-nano"]
out["models"] = {w: (w in ids) for w in want}
out["models"]["gpt-4.1-mini_variants"] = [i for i in ids if i.startswith("gpt-4.1-mini")]
out["models"]["n_models"] = len(ids)

c.jdump(c.OUT / "b0.json", out)
print(json.dumps(out, indent=2, ensure_ascii=False))
