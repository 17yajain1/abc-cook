# Investigate import latency + FGC-1 (diagnosis only)

Read from `origin/main` @ 825a9e1 (fetched 2026-10-16). This checkout stays on
`docs/sabudana-investigation-library`. No product code changes in this task.

## Context

Imports take ~2 min. ReciMe does chole bhature (FU1ZVLMbWjA) in ~10 s, and Copymenu shows the
title, photo and description in ~1 s. FGC-1: on chole, our extraction spent all 16,000 output
tokens on reasoning and returned Tier 0 with the wrong warning. The hypothesis is that hidden
reasoning causes both problems. This plan measures that before anyone changes anything.

## Targets (owner, 2026-10-16)

Step C ranks every lever against these targets.

| Target | Value |
|---|---|
| First thing on screen (title/thumbnail/description) | ≤ 3 s |
| Ingredients + steps readable | ≤ 15 s |
| Full plan | ≤ 30 s typical; ≤ 60 s for long videos (chole) |
| Cost | ≤ ₹2 per typical import; ₹0 to re-import the same video |
| Quality floor | No new wrong advice: the goldens' edges and stated durations stay unchanged, no tier gets worse, and chole reaches a plan |

When targets conflict, the priority is:
1. Quality floor.
2. Speed, with time to the first useful screen weighted most.
3. Cost.

For the recommended combination of levers, Step C must give the expected value for each target
next to today's value, and list the targets it still misses.

## Step A — findings (read-only, origin/main)

### A1. `run_import` stages, in order (`extract/import_pipeline.py`)
1. Cache lookup, `:306-323` (only when a cache is passed in; see A4).
2. **Acquire**, `:327` → `acquire/pipeline.py:72`:
   - Host gate `:93-99`. A non-video host goes to the recipe-page fetch `:111`.
   - `youtube.fetch` (`youtube.py:84`): yt-dlp `extract_info` with `socket_timeout` 30
     (`:99-102`), then the caption track is fetched **serially after it** (`fetch_segments`,
     ~`:117`).
   - Then, only when there's no blog yet, it tries the description's candidate blog links
     **serially, one at a time** (`pipeline.py:104-107`).
3. `build_preview` `:344`, which only does anything with blog JSON-LD (`preview.py:70-78`). A
   YouTube video with no linked blog gets **no preview**, so the user has nothing to read until
   the whole plan is done.
4. **Extract**, `:351` → `normalize()` (`normalize.py:201`): one call, then either one
   escalation to 32K on a truncation (`:262`) or one retry on unparseable output (`:279`).
5. `postprocess`, `:407`: title, `build_graph`, `validate`, then repair (Sonnet, only when
   needed), then `schedule` (`postprocess.py:106,137,165`).
6. Cache store, `:440-447`.

What runs serially that doesn't have to:
- Caption fetch and blog-link fetch both depend only on yt-dlp's `info`/description, so they
  could run in parallel.
- Candidate blog links are fetched one at a time and could be fetched concurrently.
- A metadata preview (title, thumbnail, description) is ready right after `extract_info`, but
  nothing shows it.
- The LLM call can't start before acquisition finishes, because it needs the transcript.

### A2. Extraction call settings
- Model: `gpt-5-mini` (`normalize.py:30`). Routed through `routing.py:63-78`.
- Reasoning effort: **`"low"` in production already** (`normalize.py:32`, decided 2026-10-06 in
  the A4 memo §13.6). So chole failed *at low*.
- Max output tokens: 16,000 (`:44`), escalating to 32,000 (`:49`). The cap is shared between
  reasoning and visible output (`openai.py:94`, `max_completion_tokens`).
- Request timeout: `60 + max_tokens/50` = 380 s at 16K (`base.py:33-40`), with `MAX_RETRIES=1`.
- Prompt: `prompts/v7.md` is 18,129 bytes, plus the `NormalizedRecipe` JSON Schema appended
  (`prompting.py:41-44`), plus the source as the user message (`normalize.py:156-180`, which
  includes the full blog JSON-LD pretty-printed with `indent=2`).
- Source sizes in the fixtures (characters of transcript / description): chole **29,442** /
  2,081 (Devanagari); pizza 8,293 / 2,229 (+blog); kadhi 3,202 / 3,529 (+blog); pumpkin
  2,242 / 359; croissant 1,585 / 592.
  - **Discrepancy:** the README and FGC-1 say chole's transcript is "11,602 chars", but the
    fixture string is 29,442. The measurement will settle which is right.
- Prompt caching: nothing explicit. OpenAI caches a ≥1,024-token prefix automatically, and the
  system prompt is static, so it should qualify. `cache_read_input_tokens` is recorded
  (`openai.py:105-115`).
- **Not streamed** (`openai.py:24-26, 91`). Chat Completions, with the schema in the prompt and
  parsed by hand.
- Repair: `claude-sonnet-5`, effort low, 8,000 max tokens (`repair.py:48-53`).

### A2b. Why FGC-1 is misdiagnosed
`_is_runaway` returns True whenever `'"steps"'` is missing from the partial text
(`normalize.py:69-70`). An empty visible output, where everything went to reasoning, therefore
counts as "runaway" (`:250-261`). Escalation is skipped and the warning wrongly says "repeated or
missing steps". This is noted as a finding only; nothing gets changed.

### A3. Existing timing and logging
- `ImportTelemetry.stage_s` records `acquire`, `extract`, `build_graph`, `repair` and
  `schedule`, plus `ttp_s`, tokens, reasoning tokens and cost (`import_pipeline.py:60-132`).
  It's logged once per import (`:290-302`), and each status transition is logged with elapsed
  time (`:249-251`). Per-call `latency_ms` is in `CallUsage`.
- Acquisition **isn't split up**: yt-dlp, captions and blog are all one `acquire` number.
- Existing harnesses to reuse:
  - `scripts/effort_ab.py`: arms × reps, budget cap with reserve, saves each call's
    `NormalizedRecipe`, graph fingerprint, offline violations.
  - `scripts/import_bench.py`: per-stage table for URLs.
  - Prior result (A4 memo §13): extraction took 27–46 s at low and 58–90 s at medium.

### A4. Result cache (`extract/cache.py`)
- The key is the canonical source key (the YouTube video id via `source_key.py:314`) plus a
  full pipeline fingerprint (`cache.py` ~`:223-320`), so it's **shared across users**.
- It's `DiskResultCache`, one directory per process, with a 7-day TTL (a placeholder).
- **It's OFF in production**: only on when `ABC_COOK_RESULT_CACHE_DIR` is set
  (`routes/import_.py:126-136`), and it's commented out in `.env.example:33`.
- On Cloud Run a disk cache would be per instance and lost on restart anyway.
- Hit rate: no counter exists. The only trace is `cache_hit=` in the finish log line. A
  cross-user hit rate can't be known today without a persistent store and a metric.

### A5. Web progress during import
- `useImportJob.ts:20-21` polls `GET /import/{id}` every 1.2 s, up to 250 polls (~5 min).
- The status copy (`ImportScreen.tsx:8-14, 52-64`) shows "Getting the recipe…", then the
  working-out copy. It never invents percentages.
- With a blog preview, `plan_building` shows the `RecipePreview` + `PreviewFooter`. For
  YouTube with no blog there's only a status word for the whole wait. No streaming and no
  partial results.

## Step B — measurement plan (approved 2026-10-16 with additions; spend needs a separate go-ahead)

**B0. Before any spend (₹0, read-only):**
- **Capture effort.** Production uses `"low"` (`normalize.py:32`), but the corpus capture ran
  `effort_ab --arms medium`. Read each capture's `result.json` and per-call usage for chole and
  the 3 goldens (pumpkin, kadhi, croissant), and also pizza and cupcakes. State the effort each
  was captured at. Every golden diff in B1 carries a note that the goldens are medium-effort
  output.
- **Language cost, offline.** Count input tokens with tiktoken `o200k_base` for system prompt,
  schema and source, and compute tokens per character of source: chole (Devanagari) vs the
  English recipes. Check these against the API usage fields once B1 has run.
- **Model availability.** Call `models.list` on the OpenAI key (free) to confirm that the
  non-reasoning model for B3 is available.

**Setup:** worktree `C:\Users\ashya\Music\abc-cook-speed`, branch
`investigate/extraction-speed` from `origin/main`.
- Keys are loaded with `load_dotenv(r"C:\Users\ashya\Music\ABC cook\apps\api\.env")`. They're
  never printed or copied; the worktree has no `.env`.
- Scratch scripts and raw outputs go under `notes/investigate-extraction-speed/` in the
  worktree. Nothing goes in `abc_cook/`.

**B1. LLM matrix**, script `bench_llm.py`:
- It reuses `effort_ab.py`'s `Budget` and per-call capture, but calls `normalize()` directly on
  the 6 committed `RawAcquisition`s, so acquisition is skipped.
- It then runs `postprocess(original, repair_fn=<stub>)`, where the stub records "repair would
  fire" plus the violation rules and **doesn't call Sonnet**. That keeps the LLM step isolated
  and saves ₹3–5 per repair. (Repair latency comes from the earlier capture telemetry.)
- Inputs: pizza-dough, pumpkin-pancakes, kadhi-pakora, croissant (`tests/fixtures/import/`),
  vanilla-cupcakes and chole-bhature (`known-wrong/`).
- Arms: `minimal` and `low` (production) on all 6, with n=1 per cell, plus **n=2 at low for
  pizza and chole** to see run-to-run variance. Medium runs on chole only; medium × 5 was
  dropped for budget, and the goldens are already medium output (B0). Runs go sequentially
  with `workers=1`, so wall time isn't skewed by concurrency.
- Each run records:
  - wall time and `latency_ms`
  - input, cached, output and reasoning tokens
  - ₹ from `pricing.py`
  - step count; stated vs estimated durations; edges
  - whether `validate()` passes, whether repair would fire, degraded, and tier
  - a diff against the golden: `*.replay-expected.json` for pumpkin, kadhi and croissant;
    `pizza-dough.normalized.json`; `vanilla-cupcakes.original.json`; chole has no golden, so
    only whether it reaches a plan
- **Chole probe:** one extra run at the lowest effort that still failed at 16K, with
  `max_tokens=32_000` called directly. Does it reach a plan with more room? This is the
  length-vs-budget question.

**B1b. Translate first (chole)**, in `bench_llm.py`. A cheap first pass translates or
transliterates the Hindi captions to English, using the B3 non-reasoning model at a plain
prompt. Then the normal extraction runs at `low` on the English text. Record total time (both
calls), total ₹, input tokens before and after, and whether chole reaches a plan (tier, step
count). This is scratch only: no change to `normalize` or the prompt.

**B2. Acquisition timing**, script `bench_acquire.py`, no LLM, ₹0. It runs on the live source
URLs of the 6 fixtures and times separately:
- yt-dlp `extract_info`
- the caption `fetch_segments`
- each blog candidate fetch
- recipe-page fetch where relevant

It also times a "parallel" variant (captions ∥ blog links via a thread pool, inside the scratch
script only) to estimate what parallelising saves.

Politeness rules for B2:
- At most 2 reps per URL, so at most 12 yt-dlp calls in total.
- At least 5 s between any two requests to the same host.
- **STOP the whole script** on any HTTP 429, a bot or consent page, or a yt-dlp "Sign in to
  confirm" error. No retry.
- The report states how many fetches actually ran out of how many were planned.

**B3. Staged design**, inside `bench_llm.py`:
- A scratch-only flat schema (title, grouped ingredients, plain steps, stated times only) and a
  short scratch prompt, run on all 6 with two models:
  - `gpt-5-mini` at `minimal`
  - **`gpt-4.1-mini`**, a non-reasoning model. I picked it because it spends no hidden
    reasoning tokens (so it isolates reasoning's share of the time), is cheap, and has a long
    context for chole's transcript. If B0's `models.list` doesn't show it, the fallback is
    `gpt-4o-mini`, and the report says so.
- **Time to the first useful screen** = measured acquire (B2) + fast call. **Time to the full
  plan** = acquire + full call at `low` (B1).
- Plus 2 streaming probes (scratch code calling the OpenAI SDK directly, outside the adapter,
  scratch only). They measure time to the first visible token for the fast call and for the
  full call at low, to see how much a streamed UI would surface early.

**Offline (₹0):** input-token counts per recipe (system + schema + source) from the API usage
fields; how much of the prompt is the schema vs `v7.md` vs source.

**Budget: hard cap ₹30**, enforced by `Budget`, with a reserve per run. Runs go in value order,
so a cap trip drops the least useful ones.

| # | Runs | Est. ₹ each | Est. ₹ |
|---|---|---|---|
| 1 | chole × minimal, low ×2, medium (4 runs) | ≤2.75 (16K cap) | ≤11.0 |
| 2 | 5 recipes × minimal, low + pizza low rep 2 (11 runs) | 0.3 / 0.6 | ~5.1 |
| 3 | staged fast call × 6 × {gpt-5-mini minimal, gpt-4.1-mini} | ~0.3 / ~0.15 | ~2.7 |
| 4 | chole translate-first (translate + low extraction) | ~1.0 + ≤2.75 | ≤3.8 |
| 5 | 2 streaming probes | ~0.5 | ~1.0 |
| 6 | chole 32K probe (last, runs only if budget remains) | ≤5.5 | ≤5.5 |
| — | ~~5 recipes × medium~~ dropped (goldens already medium, B0) | | 0 |
| | **Total (worst case)** | | **≤29.1** |

These are estimates. The report gives ₹ per run as measured. The `Budget` reserve skips any
run that would cross ₹30.

The spend is stated per run in the output, with a running total against the ₹30 cap.

## Step C — after measuring (report, no code)

A ranked list of levers, each with measured or estimated seconds saved, cost change and quality
risk against the goldens:
- effort level
- translate-first for non-English captions
- max tokens (and a truthful reasoning-exhausted signal)
- prompt size (schema/`v7.md`/compact blog JSON)
- staged extraction
- streaming partial results to the web
- a metadata preview from yt-dlp
- parallel acquisition
- a cross-user cache by video id (persistent store + hit-rate metric)

Then a recommendation and numbered questions with my lean.

## On approval — exact steps, then STOP
1. `git worktree add -b investigate/extraction-speed C:\Users\ashya\Music\abc-cook-speed origin/main`
2. Write this plan with the Write tool to
   `C:\Users\ashya\Music\abc-cook-speed\docs\plans\investigate-extraction-speed.md`.
3. Show `git worktree list` and the first 10 lines of that file. **Stop.** The plan stays
   uncommitted, with no push, no scripts written and no spend. B0–B3 start only on a separate
   go-ahead.

Later, once runs are approved: the scripts (`bench_llm.py`, `bench_acquire.py`), the raw
outputs and the final Step C report go in `notes/investigate-extraction-speed/` and are
committed on `investigate/extraction-speed` as conventional `docs:`/`test:` commits. No product
code changes.

## Verification
- Every Step A claim is cited `file:line` against `origin/main` @ 825a9e1.
- Before any B-run, a dry run prints the run list and the budget reservation, and makes no calls.
- The goldens are only read, never rewritten. Known-wrong fixtures stay evidence, never goldens.
