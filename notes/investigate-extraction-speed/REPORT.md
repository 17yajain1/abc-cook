# Extraction-speed investigation — measured results + Step C

Branch `investigate/extraction-speed`, base 825a9e1. **No change under `apps/api/abc_cook` or `apps/web`.**
Scripts: `common.py`, `b0.py`, `bench_llm.py`, `bench_acquire.py`, `diff_goldens.py`, `make_tables.py`
(all scratch, run with `PYTHONPATH=<abs apps/api>;<abs notes dir>`; on Windows the separator is `;`).
Raw outputs: `raw/` (`runs.jsonl`, `ledger.jsonl`, `acquire.json`, per-run `*.normalized.json`, logs), `b0.json`, `diff_goldens.json`.
Keys came from the main checkout's `.env` via python-dotenv; never printed or copied.

## Read this first — four things the plan had wrong or that change the picture

1. **Chole did not fail "at low".** The 2026-10-16 corpus capture ran `effort_ab --arms medium`, and
   `effort_ab.ARM_EFFORT["medium"]` is `None`, i.e. the **provider default (medium)**, not production's `low`
   (`normalize.py:32`, `import_pipeline.py:183`). Plan A2's "chole failed *at low*" is wrong; FGC-1 happened at **medium**.
2. **FGC-1 did not reproduce.** Chole reached a plan in **5 of 5** new attempts (minimal, low ×2, medium, translate-first
   at low), including **medium** (6,912 reasoning tokens, 99.8 s). So the 16,000/16,000 reasoning exhaustion is a rare
   stochastic event at medium (1 failure in 2 medium attempts overall); at `low`, reasoning was 192–512 tokens (0 of 2 failed).
3. **"Imports take ~2 min" is the medium-effort number.** All five corpus captures (54–141 s extraction) were medium.
   At production `low` the extraction call measured **13.8–38.2 s** (single-call runs). Whether production traffic still
   sees ~2 min was not measured end-to-end (see caveats).
4. **The chole transcript is 11,602 chars, not 29,442.** 29,442 is its UTF-8 byte length (Devanagari = 3 bytes/char).

Also confirmed in code: `_is_runaway` returns True whenever `"steps"` is absent (`normalize.py`, the `if '"steps"' not in raw_text` branch), so an all-reasoning,
empty-output truncation is reported as "repeated or missing steps". Not changed.

**Time model (the single most useful finding):** for the 14 single-call runs, `wall ≈ output_tokens / 121 tok/s − 1.3 s`
(reasoning tokens count as output). Input size, caching and language barely matter; **output tokens are the clock**:
each 1,000 output tokens ≈ 8.3 s ≈ ₹0.17.

## 1–6 Results
### T1. Spend per run (INR, running total, cap 30)

| run | INR | running |
|---|---|---|
| chole-bhature__minimal__0 | 1.03 | 1.03 |
| chole-bhature__low__0 | 1.03 | 2.06 |
| chole-bhature__low__1 | 0.89 | 2.95 |
| chole-bhature__medium__0 | 2.07 | 5.02 |
| pumpkin-pancakes__minimal__0 | 0.27 | 5.29 |
| pumpkin-pancakes__low__0 | 0.34 | 5.63 |
| kadhi-pakora__minimal__0 | 0.52 | 6.14 |
| kadhi-pakora__low__0 | 0.65 | 6.79 |
| croissant__minimal__0 | 0.85 | 7.64 |
| croissant__low__0 | 0.67 | 8.31 |
| vanilla-cupcakes__minimal__0 | 0.36 | 8.67 |
| vanilla-cupcakes__low__0 | 0.40 | 9.07 |
| pizza-dough__minimal__0 | 0.59 | 9.66 |
| pizza-dough__low__0 | 1.43 | 11.10 |
| pizza-dough__low__1 | 0.66 | 11.76 |
| fast__pizza-dough__gpt-5-mini__0 | 0.28 | 12.04 |
| fast__pizza-dough__gpt-4.1-mini__0 | 0.32 | 12.36 |
| fast__pumpkin-pancakes__gpt-5-mini__0 | 0.10 | 12.46 |
| fast__pumpkin-pancakes__gpt-4.1-mini__0 | 0.08 | 12.54 |
| fast__kadhi-pakora__gpt-5-mini__0 | 0.21 | 12.75 |
| fast__kadhi-pakora__gpt-4.1-mini__0 | 0.21 | 12.96 |
| fast__croissant__gpt-5-mini__0 | 0.15 | 13.11 |
| fast__croissant__gpt-4.1-mini__0 | 0.11 | 13.21 |
| fast__vanilla-cupcakes__gpt-5-mini__0 | 0.09 | 13.31 |
| fast__vanilla-cupcakes__gpt-4.1-mini__0 | 0.07 | 13.38 |
| fast__chole-bhature__gpt-5-mini__0 | 0.34 | 13.72 |
| fast__chole-bhature__gpt-4.1-mini__0 | 0.38 | 14.10 |
| chole-bhature__translate-first:translate | 0.44 | 14.53 |
| chole-bhature__low__0__translate-first | 0.86 | 15.40 |
| stream__fast__gpt-4.1-mini | 0.14 | 15.54 |
| stream__full__gpt-5-mini-low | 0.62 | 16.16 |

**Total INR 16.16 of 30.** Sonnet repair was stubbed (0 calls). B2 and B0 cost INR 0.

### T2. Full-extraction matrix (gpt-5-mini; repair stubbed; goldens are MEDIUM-effort output)

| recipe | arm | wall s | calls | input tok (cached) | reasoning | visible out | INR | tier | steps | validate | repair would fire (rules) | vs golden: node recall / edge recall / stated durations equal |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| chole-bhature | minimal | 37.2 | 1 | 11934 (0) | 0 | 4557 | 1.03 | clean | 17 | True | no | no golden |
| chole-bhature | low | 34.6 | 1 | 11934 (0) | 192 | 4388 | 1.03 | repair-would-fire | 16 | False | YES: ingredients_consumed,produces_consumed | no golden |
| chole-bhature | low#1 | 38.2 | 1 | 11934 (11776) | 512 | 4547 | 0.89 | repair-would-fire | 17 | False | YES: ingredients_consumed,produces_consumed | no golden |
| chole-bhature | medium | 99.8 | 1 | 11934 (11776) | 6912 | 5102 | 2.07 | repair-would-fire | 22 | False | YES: ingredients_consumed,produces_consumed | no golden |
| pumpkin-pancakes | minimal | 10.7 | 1 | 8154 (6912) | 0 | 1337 | 0.27 | clean | 6 | True | no | 0.57 / 0.5 / True |
| pumpkin-pancakes | low | 13.8 | 1 | 8154 (6912) | 320 | 1443 | 0.34 | repair-would-fire | 6 | False | YES: ingredients_consumed | 0.71 / 1.0 / True |
| kadhi-pakora | minimal | 19.2 | 1 | 10001 (6912) | 0 | 2555 | 0.52 | clean | 9 | True | no | 0.82 / 1.0 / True |
| kadhi-pakora | low | 25.4 | 1 | 10001 (6912) | 1088 | 2253 | 0.65 | clean | 7 | True | no | 0.64 / 0.67 / False |
| croissant | minimal | 38.6 | 2 | 8061 (6912) | 0+0 | 2217+2456 | 0.85 | clean | 14 | True | no | 0.5 / 0.25 / True |
| croissant | low | 28.6 | 1 | 8061 (6912) | 1024 | 2676 | 0.67 | clean | 16 | True | no | 0.56 / 0.33 / False |
| vanilla-cupcakes | minimal | 15.4 | 1 | 8238 (6912) | 0 | 1866 | 0.36 | repair-would-fire | 10 | False | YES: ingredients_consumed | 1.0 / 0.0 / True |
| vanilla-cupcakes | low | 16.1 | 1 | 8238 (6912) | 1088 | 1014 | 0.40 | clean | 4 | True | no | 1.0 / 0.67 / True |
| pizza-dough | minimal | 23.5 | 1 | 13687 (6912) | 0 | 2552 | 0.59 | clean | 13 | True | no | 0.21 / 1.0 / False |
| pizza-dough | low | 54.9 | 2 | 13687 (6912) | 832+1984 | 2293+2200 | 1.43 | clean | 10 | True | no | 0.07 / None / False |
| pizza-dough | low#1 | 27.3 | 1 | 13687 (13568) | 1536 | 2188 | 0.66 | clean | 10 | True | no | 0.0 / None / False |
| chole-bhature | low (translate-first) | 37.6 | 1 | 10565 (7936) | 256 | 4385 | 0.86 | repair-would-fire | 19 | False | YES: ingredients_consumed,produces_consumed | no golden |

### T3. Chole attempts (FU1ZVLMbWjA, 11,602-char Hindi transcript)

| attempt | max_tokens | wall s | reasoning | visible | reached a plan? | tier | steps | INR |
|---|---|---|---|---|---|---|---|---|
| CAPTURE 2026-10-16 (effort_ab `medium` = provider default) | 16000 | 141.1 | 16000 | 0 | NO (Tier 0) | tier0 | 0 | 2.75 |
| minimal | 16000 | 37.2 | 0 | 4557 | YES | clean | 17 | 1.03 |
| low | 16000 | 34.6 | 192 | 4388 | YES | repair-would-fire | 16 | 1.03 |
| low#1 | 16000 | 38.2 | 512 | 4547 | YES | repair-would-fire | 17 | 0.89 |
| medium | 16000 | 99.8 | 6912 | 5102 | YES | repair-would-fire | 22 | 2.07 |
| low + translate-first (gpt-4.1-mini, +15.9s, +INR 0.438) | 16000 | 37.6 | 256 | 4385 | YES | repair-would-fire | 19 | 0.86 |
| 32K probe | 32000 | not run | - | - | - | - | - | 0 (rule: only if some 16K attempt failed; none did) |

### T4. Tokens per character (tiktoken o200k_base; matches API usage within +2 tokens on all 6)

| recipe | lang | transcript chars | transcript UTF-8 bytes | transcript tokens | tok/char (transcript) | tok/char (whole source) | predicted input | API input |
|---|---|---|---|---|---|---|---|---|
| pizza-dough | en | 8293 | 8293 | 1882 | 0.227 | 0.266 | 13685 | 13687 |
| pumpkin-pancakes | en | 2242 | 2242 | 563 | 0.251 | 0.255 | 8152 | 8154 |
| kadhi-pakora | en | 3202 | 3202 | 783 | 0.245 | 0.278 | 9999 | 10001 |
| croissant | en | 1583 | 1585 | 404 | 0.255 | 0.258 | 8059 | 8061 |
| vanilla-cupcakes | None | 0 | 0 | 0 | None | 0.263 | 8236 | 8238 |
| chole-bhature | hi | 11602 | 29442 | 3658 | 0.315 | 0.323 | 11932 | 11934 |

System prompt = 7446 tok = v7.md 4423 + JSON-Schema/format wrapper 3023. Blog JSON-LD (pizza): 3459 tok pretty vs 3047 compact.

### T5. Staged fast call (flat schema; scratch prompt) vs full call at low

| recipe | model | wall s | in | reasoning | out | INR | steps | stated minutes | full-call wall s (low) |
|---|---|---|---|---|---|---|---|---|---|
| pizza-dough | gpt-5-mini | 7.5 | 6601 | 0 | 844 | 0.28 | 15 | [2, 5, 8, 18, 60] | 54.9 |
| pizza-dough | gpt-4.1-mini | 5.8 | 6602 | 0 | 669 | 0.32 | 18 | [2, 5, 10, 60, 270, 1080] | 54.9 |
| pumpkin-pancakes | gpt-5-mini | 4.5 | 1068 | 0 | 471 | 0.10 | 9 | [] | 13.8 |
| pumpkin-pancakes | gpt-4.1-mini | 3.0 | 1069 | 0 | 330 | 0.08 | 10 | [] | 13.8 |
| kadhi-pakora | gpt-5-mini | 7.2 | 2915 | 0 | 847 | 0.21 | 12 | [10, 30] | 25.4 |
| kadhi-pakora | gpt-4.1-mini | 7.2 | 2916 | 0 | 816 | 0.21 | 13 | [10, 30] | 25.4 |
| croissant | gpt-5-mini | 6.4 | 975 | 0 | 740 | 0.15 | 20 | [5, 6, 20, 60, 60, 60] | 28.6 |
| croissant | gpt-4.1-mini | 4.4 | 976 | 0 | 547 | 0.11 | 16 | [6, 10, 25, 60, 60, 60] | 28.6 |
| vanilla-cupcakes | gpt-5-mini | 3.8 | 1152 | 0 | 404 | 0.09 | 7 | [10] | 16.1 |
| vanilla-cupcakes | gpt-4.1-mini | 2.2 | 1153 | 0 | 208 | 0.07 | 4 | [10, 20] | 16.1 |
| chole-bhature | gpt-5-mini | 12.4 | 4848 | 0 | 1414 | 0.34 | 23 | [1, 5, 7, 10, 10] | 34.6 |
| chole-bhature | gpt-4.1-mini | 13.6 | 4849 | 0 | 1559 | 0.38 | 23 | [1, 2, 4, 5, 7, 10, 10, 10, 15, 360, 360] | 34.6 |

### T6. Streaming probes (kadhi-pakora)

| call | first visible token s | ingredients key s | steps key s | first step complete s | total s | out tok | reasoning | INR |
|---|---|---|---|---|---|---|---|---|
| stream__fast__gpt-4.1-mini | 1.2 | 1.3 | 3.5 | 3.8 | 6.8 | 824 | 0 | 0.14 |
| stream__full__gpt-5-mini-low | 7.7 | 8.1 | 13.7 | 15.2 | 25.8 | 3521 | 960 | 0.62 |

### T7. Run-to-run noise floor and arm-vs-arm (fuzzy structural diff)

| comparison | tiers | node recall | edge recall | edge precision | stated durations | total_min |
|---|---|---|---|---|---|---|
| pizza-dough: low#0 vs low#1 | clean / clean | 0.7 | 0.33 | 1.0 | [2, 4, 8, 60, 240, 1080] vs [2, 4, 8, 60, 240, 1080] | 1459.0 vs 1476.0 |
| chole-bhature: low#0 vs low#1 | repair-would-fire / repair-would-fire | 0.65 | 1.0 | 0.75 | [5, 360] vs [6, 10, 360, 360] | 473.0 vs 909.0 |
| pumpkin-pancakes: minimal vs low#0 | clean / repair-would-fire | 0.5 | 0.0 | 0.0 | [] vs [] | 27.0 vs 17.0 |
| kadhi-pakora: minimal vs low#0 | clean / clean | 1.0 | 0.86 | 0.46 | [] vs [10] | 51.0 vs 54.0 |
| croissant: minimal vs low#0 | clean / clean | 0.62 | 1.0 | 0.75 | [5, 6, 20, 60, 60, 60] vs [5, 6, 20, 55, 55, 55] | 258.0 vs 269.0 |
| vanilla-cupcakes: minimal vs low#0 | repair-would-fire / clean | 1.0 | 0.0 | 0.0 | [9, 20] vs [9, 20] | 67.0 vs 40.0 |
| pizza-dough: minimal vs low#0 | clean / clean | 1.0 | 0.29 | 0.5 | [2, 4, 8, 60, 240, 1080] vs [2, 4, 8, 60, 240, 1080] | 1480.0 vs 1459.0 |
| chole-bhature: minimal vs low#0 | clean / repair-would-fire | 0.75 | 0.62 | 0.33 | [1, 4, 10, 10, 30, 360] vs [5, 360] | 395.0 vs 473.0 |
| chole-bhature: low#0 vs medium | repair-would-fire / repair-would-fire | 0.59 | 0.71 | 0.56 | [5, 360] vs [1, 3, 4, 6, 9, 9, 28, 350, 350] | 473.0 vs 849.0 |
| chole-bhature: minimal vs medium | clean / repair-would-fire | 0.55 | 0.33 | 0.15 | [1, 4, 10, 10, 30, 360] vs [1, 3, 4, 6, 9, 9, 28, 350, 350] | 395.0 vs 849.0 |

### T8. Acquisition (B2) — **incomplete: the script stopped itself, per the politeness rules**

| URL | yt-dlp `extract_info` | caption fetch | blog candidates | sequential total | parallel variant |
|---|---|---|---|---|---|
| pizza-dough (WM1XcYXix0Y) | 4.25 s (parallel rep: 2.97 s) | 1.42 s (manual/en, 242 segs) | 28 links; hit on the 2nd (`amzlink.to` 1.61 s, no recipe, then `natashaskitchen.com` 2.39 s) = 4.0 s | **9.67 s** | **not a valid measurement** (below) |
| pumpkin-pancakes | 1 call (time not saved: script stopped before its row was written) | 1 call | first candidate `amzn.to` returned **HTTP 503**, so STOP | – | – |
| kadhi, croissant, cupcakes, chole | **not run** | | | | |

- **Fetches run vs planned:** 3 of 12 yt-dlp, 3 caption fetches, 31 blog fetches (2 sequential + 28 parallel on pizza + 1 pumpkin).
  Planned: 12 yt-dlp + up to 12 caption + candidate blogs. **429s: 0.** Stop reason: HTTP 503 from `amzn.to` (a bot wall) on the
  first blog link of the 3rd video. Per the rules: no retry, script stopped.
- **The pizza parallel number is unusable and I will not quote it.** Fanning out all 28 candidates produced 26 `amzlink.to`
  fetches in one burst; my same-host 5 s pacing then serialized them inside the timed section (all done after 121.9 s) and the caption fetch
  measured 11.97 s vs 1.42 s sequentially (contention). That was a design flaw in my probe, not a property of parallel acquisition. It also
  means the probe was less polite than the plan intended for affiliate-heavy descriptions.
- **Parallel acquisition, estimated from the sequential components only (n=1):** yt-dlp 4.25 + max(caption 1.42, blog 4.0) = 8.25 s vs 9.67 s, so **about 1.4 s saved**.
- **Chole's acquisition time is unmeasured**, which matters for the ≤ 60 s long-video target.

### Staged + streaming: time to first useful screen vs time to full plan (item 6)

Acquisition input used below: **A ≈ 5.7 s without a blog (yt-dlp 4.25 + captions 1.42), ≈ 9.7 s with one (pizza, n=1)**.

| path | first useful content | ingredients | first step | all steps / plan |
|---|---|---|---|---|
| Today (full call at low, no stream, no preview unless a blog exists) | none (≈ A) | with plan | with plan | A + 14–38 s ≈ **20–48 s** |
| Metadata preview from yt-dlp `info` | title/thumbnail/description at yt-dlp done ≈ **3.0–4.3 s** (n=3) | – | – | unchanged |
| Stream the full call (measured, kadhi) | A + 7.7 s (first visible token; reasoning wait) | A + 8.1 ≈ **13.8 s** | A + 15.2 ≈ **20.9 s** | A + 25.8 ≈ **31.5 s** |
| Staged: fast call, streamed (measured, kadhi, gpt-4.1-mini) | A + 1.2 s | A + 1.3 ≈ **7 s** | A + 3.8 ≈ **9.5 s** | fast text A + 6.8 ≈ 12.5 s; **plan still arrives at the full-call time** |
| Staged fast, non-streamed | A + 2.2–13.6 s (by recipe) | same | same | chole 12–14 s, so ≈ 18–20 s |

The staged path **adds** a call (+₹0.07–0.38) without shortening the plan time.

## Step C — ranked levers

Ranking is by value against the targets, quality floor first. "Saved" is on a typical (median-sized) recipe at today's production `low`.

| # | Lever | Seconds saved (basis) | ₹ change | Quality risk vs goldens |
|---|---|---|---|---|
| 1 | **Cross-user persistent cache by video id** (+ hit-rate metric) | repeat import: ≈ 20–48 s down to <1 s; zero for a first import | −100% on a hit (₹0.3–1.0 to 0) | None: replays a stored validated plan. Needs a durable store (Supabase) and invalidation on `POSTPROCESS_VERSION`/prompt/model change. Hit rate unknown today (no counter) |
| 2 | **Stream the single full call to the web** as a labelled draft (partial `ingredients`, then `steps`) | perceived: ingredients ≈ 13.8 s and first step ≈ 20.9 s vs ≈ 31.5 s for the plan (kadhi, n=1) | 0 | Low-medium. Same call, but the draft is unvalidated: `graph.py`/title/repair can still drop or change items. Text only, no durations or parallelism (the scheduler owns those) |
| 3 | **Metadata preview from yt-dlp `info`** (title, thumbnail, description) for the no-blog case | first screen: from *nothing until the plan* to ≈ 3.0–4.3 s | 0 | None (verbatim source fields). Misses ≤ 3 s by ≤ 1.3 s; a lighter title/thumbnail source (ytimg URL is deterministic from the id; oEmbed) is **unmeasured** |
| 4 | **Cut output tokens** (trim extraction fields the graph does not need; ~270 tokens/step today) | the only lever that moves full-plan time: **8.3 s per 1,000 tokens**; e.g. −25% of 2.5–3.7K tokens ≈ −5 to −8 s (estimate, not measured) | −₹0.17 per 1,000 tokens | **Highest**: changes schema/prompt, so every golden must be re-diffed and repair/validate re-checked. Own plan and checkpoint |
| 5 | **Truthful reasoning-exhausted signal** (FGC-1's wrong warning) | 0 s | 0 | Positive: honest message. Independent of speed |
| 6 | **Unparseable-response retry** (2 of 15 full runs: croissant@minimal, pizza@low) | each retry cost +18–24 s and about 2× ₹ (pizza ₹1.43 vs 0.66); ≈ 13% of runs | about −₹0.3–0.7 avg when avoided | Unknown cause: `raw_text` is only kept on truncations, so the bad JSON was not captured. Add capture first |
| 7 | **Staged two-call extraction** (fast flat call, then full) | steps readable ≈ 9.5 s vs ≈ 21 s (kadhi); plan time unchanged | **+₹0.07–0.38** per import | **Violates "one LLM call per import".** Fast-stage stated minutes disagree with goldens (gpt-4.1-mini gave 25 for croissant; chole got 360 twice), so durations must never be shown from it |
| 8 | **Effort: minimal vs low** | about −2 s mean, within noise (−3.1, −6.2, −0.7, −3.8, +2.6 s; croissant excluded for a retry) | about −₹0.1 | No clear signal: each arm had would-repair on different recipes (n=1) |
| 9 | **Parallel acquisition** | about 1.4 s (estimated from sequential parts, 1 URL) | 0 | Low, but risky: affiliate-heavy descriptions (28 links); `amzn.to` returned a 503 |
| 10 | **Translate-first for Hindi** | **16 s slower**: 53.5 s vs 34.6–38.2 s | +₹0.3–0.4 (₹1.30 vs 0.89–1.03) | Input only −11% (11,934 to 10,565). No benefit; chole already reaches a plan at low. **Reject** |
| 11 | **Raise max tokens / 32K** | 0 | 0 | Not needed at low (chole reasoning ≤ 512). 32K probe not run (rule: no 16K attempt failed) |
| 12 | **Prompt size** (v7.md 4,423 + schema wrapper 3,023 + blog JSON) | about 0: input is not the clock, and the 6,912-token prefix is **already prompt-cached** after the first call | about −₹0.01 per 1,000 input tokens | Pointless for speed. Compact blog JSON saves 412 tokens (pizza) |

Language cost: Devanagari costs **0.315 tok/char** vs 0.227–0.255 for English transcripts (about **1.25×** per char, about 2.5× per byte), so chole's input is 11.9K tokens, not a runaway.

## Recommendation

Do **1 + 3 + 2 + 5**, in that order; keep effort at `low`; do not add a second extraction call (7) or translate-first (10) now; plan **4** as a separate
checkpointed change (the only way to reach the ≤ 30 s full-plan target); add raw-text capture for **6**.

## 8. Targets: today → expected with 1+2+3+5 → met?

| Target | Today (measured, production `low`) | Expected with the recommended combination | Met? |
|---|---|---|---|
| First thing on screen ≤ 3 s | With a blog: ≈ 9.7 s (pizza). Typical no-blog YouTube: nothing until the plan, ≈ 20–44 s | ≈ 3.0–4.3 s (yt-dlp, n=3); <1 s on a cache hit | **Close, not met** (by ≤ 1.3 s). Unmeasured oEmbed/ytimg could meet it |
| Ingredients + steps readable ≤ 15 s | = full plan ≈ 20–48 s | ingredients ≈ 14 s (no blog) / ≈ 18 s (blog); **first step ≈ 21 s; all steps ≈ 31 s**; cache hit <1 s | **Ingredients about yes; steps no.** Only staged (7) reaches ≈ 9.5 s (kadhi) and costs a second call |
| Full plan ≤ 30 s typical; ≤ 60 s long | Typical median ≈ 33–37 s (A 6–10 + extract 27 s median); retries 55–75 s; chole ≈ 41–48 s | unchanged ≈ 33–37 s first time; chole ≈ 41–48 s; <1 s on a hit | **Typical: no (3–7 s over). Long: yes.** Needs lever 4 |
| Cost ≤ ₹2 typical; ₹0 re-import | ₹0.27–1.03 per call (median ≈ 0.65); repair ₹ unmeasured (stubbed); re-import = full price (cache off in prod) | same first time; **₹0 on a hit** | **Yes** (re-import depends on the store existing and a non-zero hit rate) |
| Quality floor | see below | unchanged (same call, same validation); levers 1/3/5 touch no extraction output | **Held by construction, but the baseline itself is shaky** |

### Quality floor — what the data does and does not show

- n=1 per cell. Same-setting noise is large: chole `low` ×2 gave total_min 473 vs 909 and different stated durations ([5, 360] vs [6, 10, 360, 360]);
  pizza `low` ×2 differed in edges (recall 0.33). So "edges unchanged vs golden" cannot be certified from this data for *any* arm, including today's.
- **A real stated-duration error at production effort:** croissant `low` emitted **55** min ×3 where the source says "1 hour" three times
  (golden and `minimal` have 60), labelled `extracted`. That is an existing correctness question, not caused by any lever here.
- Tiers: no arm produced a worse tier than the golden's, except where the stub reports "repair would fire" (pumpkin@low, cupcakes@minimal, chole@low/medium).
  In production Sonnet repair (2 s in the capture) would run; its result was not measured, and the stubbed degraded totals are not comparable.
- The pizza golden (`pizza-dough.normalized.json`) is not a replay golden and matches neither the smoke `low` nor `medium` output.

## Numbered questions (with my lean)

1. **Resume B2** for the 4 unmeasured videos + chole, with yt-dlp + captions only and **no blog fan-out** (skip `amzn.to`/`amzlink.to`)? *Lean: yes, ₹0; chole's acquisition time is the missing piece for the ≤ 60 s target.*
2. **Approve lever 1** (persistent cross-user cache + hit/miss metric) as the next change, with a plan file first? *Lean: yes; it is the only lever that meets "₹0 re-import".*
3. **Show a streamed, unvalidated draft** (ingredients, then steps; text only, labelled, no durations or parallelism)? *Lean: yes, ingredients first; accept the first step at ≈ 21 s.*
4. **Allow a second, cheap extraction call** (staged) as an exception to "one LLM call per import" to reach steps ≤ 15 s? *Lean: no for now; revisit after 2 + 3 ship.*
5. **Open lever 4** (output-token reduction) as its own checkpointed plan, since it is the only route to ≤ 30 s? *Lean: yes, after 1–3; it touches the schema and all goldens.*
6. **Spend ≤ ₹6 re-trying chole at medium ×3** to estimate the FGC-1 failure rate? *Lean: no; production is `low`; fix the warning (5) instead.*
7. **Investigate the croissant 55 vs "1 hour" stated duration** as a separate bug? *Lean: yes; it is wrong advice at production effort.*
8. **Capture `raw_text` on unparseable responses** to find out why ≈ 13% of calls need a retry? *Lean: yes (₹0 to build, large tail-latency win).*

## Caveats

- `gpt-4.1-mini` is not in `pricing.py`; priced here at OpenAI list rates ($0.40 in / $0.10 cached / $1.60 out per M, INR85/$): `common.RATES`. `models.list` confirmed `gpt-4.1-mini` is available (no fallback to `gpt-4o-mini`).
- Repair was stubbed (no Sonnet), so "repair-would-fire" runs show the deterministic degrade in plan fields.
- Back-to-back calls on the same source hit OpenAI's prompt cache (see the cached column); the effect on wall time is small (output-bound).
- Streaming and fast-call probes ran on one recipe (kadhi) only.
- The chole 32K probe and the unmeasured acquisition rows are listed as not run, not as zero.
- First `b0.py` run imported the main checkout's `abc_cook` (a `:` vs `;` PYTHONPATH slip on Windows); it was re-run against this worktree and the numbers were identical.
