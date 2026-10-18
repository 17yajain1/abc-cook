# PR-S3: strict structured output + effort/quality measurements (plan)

## Owner amendments (2026-10-18)

Where this section conflicts with the plan body below, this section wins.

Answers:
- Q1: regrade FGC-11 to P2 only if the ₹0 trace confirms no number on screen changes. Ship F11-a
  (floor only). Also report how many affected steps use hedged wording ("about", "approx", "~",
  "लगभग"); the floor still applies to them.
- Q2: option A (prompt byte-identical, schema still pasted).
- Q3: new ImportFailure "refused". Copy: title "We couldn't read this recipe", body "Paste the
  recipe text, or try another link." Same buttons as incomplete.
- Q4: keep the one defensive retry under strict, logged as a WARNING "strict contract violation".
- Q5: the run table is reshaped below.
- Q6: the request-error fix is in S3. Confirm 429 and 5xx stay infra; report how a 400 for
  context length is classified.

Amendments:
- A1. Run table:
  - Drop rows 10 and 11.
  - Row 4 (chole low, strict on) n=3 → n=2. FGC-15 for chole also cites the earlier low runs
    (total_min 473 vs 909).
  - Add row 12: chole, minimal, strict on, n=2. Run it only if rows 6 and 7 (kadhi and croissant
    minimal) both pass the floor.
  - Minimal ships only if row 12 also passes. If row 12 is skipped or fails, low stays.
  - Hard cap stays ₹20.
  - FGC-13's reduction is argued by construction, not measured. State this in the results.
- A2. Check v7.md and OUTPUT_FORMAT_INSTRUCTIONS for any instruction to omit null/default fields
  or to shorten output by leaving keys out. Report each conflict with strict's all-required, and
  whether it explains extra output tokens. No prompt change (FGC-27).
- A3. The provider caches the compiled schema per schema, not per deploy; correct the risk text.
  Report row 1's first-content time separately and leave it out of the averages.
- A4. If depends_on_previous=false (or a non-default role or servings_source) is noticeably more
  frequent under strict than off, flag it at STOP A with the steps involved and whether graph.py
  accepted them.
- A5. STOP A includes a target table: first ingredient from paste (6 s acquire + call) per arm
  (low/minimal × strict on/off) against ≤ 15 s typical / ≤ 20 s worst and today's 14.7–16.9 s.
  Steps-complete and done are shown side by side.
- A6. Parity test: note in the test that an SDK upgrade breaking it means updating the test, not
  production code. Report the installed openai version in the results.
- A7. Commit 3: after make types, run git diff --stat on the web fixtures and restore CRLF-only
  rewrites with git checkout.

---

Read from `origin/main` @ ef99106 (fetched 2026-10-18), in plan mode from the main checkout,
which stays on `docs/sabudana-investigation-library`.

## Context

Extraction (GPT-5-mini, effort `low`, streamed since S2a) pastes the JSON Schema into the prompt
and parses by hand. About 13% of calls come back unparseable and pay for an identical retry
(+18–24 s, ~2x cost; FGC-13). The first-ingredient target (≤ 15 s typical, ≤ 20 s worst, from
paste) is missed today by about 0–2 s (14.7–16.9 s, assuming a 6 s acquire). Most of that gap is
the reasoning wait before the first content. S3 moves extraction to OpenAI strict structured
output, measures whether that or effort `minimal` closes the gap, finds where FGC-11's "55 min"
comes from, and answers FGC-12/15 with n=3 data. Quality is the floor, then speed, then cost.

---

## 1. Facts verified in the code (origin/main @ ef99106)

**Extraction call**
- `normalize.py:34` `DEFAULT_MODEL = "gpt-5-mini"`; `:36` `EXTRACTION_EFFORT = "low"`;
  `:43` `EXTRACTION_EFFORT_CEILING = "low"` (minimal is below it, so no override is needed);
  `:58` `MAX_TOKENS = 16_000`; `:63` `ESCALATED_MAX_TOKENS = 32_000`; `:94` prompt `v7.md`.
- Retry policy, `normalize.py:267-417`:
  - infra stops at once (`:342`, `:373`, `:391`);
  - a truncation either stops as reasoning-exhausted (`:347`), stops as a runaway (`:359`), or
    escalates once (`:371`);
  - unparseable gets one identical retry (`:389-392`), then Tier 0 "failed twice" (`:394-402`).
- **Bug:** `error_kind == "request"` (any non-infra 4xx) falls through to that unparseable retry
  and ends as `method_not_grounded`. A rejected schema (HTTP 400) would surface as "no method".
- `openai.py`:
  - the module docstring `:4-7` says "never this provider's native structured-output mode"
    (S3 reverses this);
  - the stream switch is read once at construction (`:184`);
  - blocking create `:249-255`; streaming create `:332-340` (`stream`,
    `stream_options.include_usage`);
  - only `delta.content` is read (`:365`); **`delta.refusal` and `message.refusal` are ignored**;
  - `finish_reason == "length"` → truncated (`:283`, `:419`); otherwise `parse` (`:295`, `:429`).
- `prompting.py:21-38` `OUTPUT_FORMAT_INSTRUCTIONS` ("valid against the JSON Schema below",
  compact JSON); `:41-44` `system_prompt` = prompt + that block with
  `json.dumps(model_json_schema(), ensure_ascii=False)`.
- `base.py`:
  - `:30` `ErrorKind = infra|request|unparseable|truncated`;
  - `:49` `STREAM_IDLE_TIMEOUT_S = 60.0`;
  - `:72-80` `ABC_COOK_STREAM_EXTRACTION` (unset = on; `0`/`false`/`off` = off).
- Sizes (o200k, computed in memory from origin/main):
  - `v7.md` is 4,423 tokens;
  - the schema is 11,263 chars / 2,893 tokens; the format block with the schema is 3,024 tokens;
  - the full system prompt is 7,446 tokens.
  - S2a live check: croissant `prompt_tokens` 8,061 (6,912 cached); kadhi 10,001 (0 cached).

**Schema (`schema/normalized.py`)**
- Key order is pydantic field order:
  - recipe: `title, channel, method_grounded, servings, servings_source, yield_text, cuisine,
    stated_total_min, ingredients, steps, chapters, notes`;
  - step: `text` first (`:124`).
- Required today:
  - recipe: `title`, `method_grounded`;
  - ingredient: `name, qty, unit, prep_note`;
  - step: `text, attention, duration_stated, station, interruptible, freshness`;
  - chapter: `label, start_sec`.
- Defaults that show in the schema: 19 are `None`. Three are not: `servings_source="defaulted"`,
  `depends_on_previous=True`, `role="required"`. The list fields use `default_factory`, so no
  default shows: `ingredients, steps, chapters, notes, consumes_ingredients`.
- No validators on these models. No `minLength`/`pattern`/`format`/`min*`/`max*`/`const`
  anywhere. No `exclude_unset`/`model_fields_set` use in `abc_cook/`.
- `ImportFailure = unavailable|incomplete` (`:425`). The web narrows on it in
  `apps/web/src/import/ImportProgress.tsx:231` and `FAILURE_COPY` (`import/phase.ts`).

**FGC-11 evidence**
- `notes/investigate-extraction-speed/raw/croissant__low__0.normalized.json`: the rest steps
  "1 hour" / "one hour" / "1 hour" come back as min/typical/max **55/60/65**, stated. Minimal
  gives 60/60/60.
- **Root cause 1 (prompt):** `v7.md:157-159` tells the model to "set
  `duration_min`/`duration_typical`/`duration_max` around that number (small min/max spread is
  fine, e.g. stated "10 minutes" → min 9, typical 10, max 12)". The model at low follows the rule.
  (Side finding: `:158` says `duration_typical`; the field is `duration_typical_min`.)
- **Root cause 2 (postprocess keeps it):** `graph.py:848-861` (`_verify_duration`, one grounded
  plain expression) clamps typical into the stated interval. It then *widens*:
  `dmin = min(dmin, low)` (`:859`), `dmax = max(dmax, high)` (`:860`). It never raises a min that
  sits below the stated value.
- Repair isn't involved: `RepairProposal` can't touch durations.
- **Not croissant- or low-specific.** The frozen originals carry the same pattern:
  - kadhi 28/30/32;
  - cupcakes preheat 9/10/11;
  - pizza 4.5/5/6, 1.8/2/2.5, and 55/60/70 ("1 hour before").
- **Where 55 reaches the user:**
  - the scheduler reads `duration_typical` (60, correct) for the timeline (`windows.py:49-52`,
    `scheduler.py`) and `duration_max` for eligibility (`:383`) and the slow case (`summary.py:78`);
  - `duration_min` reaches the web only through `cooking-mode/viewModel.ts:175` (the `~Nm`
    countdown when max − min > 15).
  - So today the 55 is a data-level stated-time violation (`provenance: extracted`) with **no
    visible number on screen**. Step 4 confirms this; if it holds, I'd regrade FGC-11 from P1 to
    P2 (question 1).

**Stream, draft, replay**
- `DraftScanner` (`draft.py`):
  - ignores whitespace and doesn't need `text` first for correctness, because it takes the step
    object's `text` key wherever it is (`:193`, `:179`);
  - it does need `ingredients`/`steps` to be top-level arrays (`:205`);
  - order matters only for latency.
- `DraftingAdapter` logs `first_content_s`, `first_ingredient_s`, `ingredients_s`,
  `first_step_s` per call (`drafting.py:127-131`).
- Replay texts aren't stored: `devtools/replay.py:92-113` streams
  `recipe.model_dump_json()` of the golden originals plus
  `tests/fixtures/stream/chole-bhature.low.normalized.json`. That dump is already
  every-key-present, in schema order, compact.
- Watchdog guards: `tests/test_extract_streaming.py:276` (`STREAM_IDLE_TIMEOUT_S >= 3 * 16.4`)
  and `tests/test_replay_harness.py:135` (`== 60.0`).

**Cache and goldens**
- `cache.py:208` `POSTPROCESS_VERSION = 10`. `PipelineFingerprint` (`:220-243`) hashes
  `system_prompt(prompt, NormalizedRecipe)` (`:287-293`) and has no field for the request format.
- `tests/test_postprocess_version.py` hashes the ASTs of `graph.py`, `normalize.py`, … and
  `schedule/`. Any code change in `normalize.py` forces a bump.
- Goldens: `kadhi-pakora`, `croissant`, `pumpkin-pancakes` `.replay-expected.json` via
  `reprocess(original)` (`test_corpus_replay.py`). They are regenerated only by
  `scripts/regen_corpus_expected.py`.
- `"import cost:"` is logged by the route (`api/routes/import_.py:183`), not by `run_import`.

**Today's timings (S2a live check, `notes/pr-s2-streamed-draft/live-check.json`, n=1, low)**

| recipe | first content | ingredients complete | first step | steps complete | done |
|---|---|---|---|---|---|
| kadhi | 10.4 s | 15.5 s | 15.8 s | 23.9 s | 24.8 s |
| croissant | 7.9 s | 10.4 s | 10.6 s | 32.6 s | 33.7 s |

With a 6 s acquire, the first-ingredient target is **≤ 9 s typical, ≤ 14 s worst into the call**.

---

## 2. Model-facing byte changes, and the dump-diff method

**Recommended (option A): add `response_format`, keep the prompt byte-identical.**

| Model-facing input | Change |
|---|---|
| Prompt text (`v7.md` + `OUTPUT_FORMAT_INSTRUCTIONS` + pasted schema) | **None, byte-identical.** No v8 and no prompt-version bump. The pasted schema stays today's `model_json_schema()` (not the strict one), so system-prompt bytes are identical with strict on or off. |
| Schema descriptions (pydantic docstrings / `Field(description=)`) | **None.** No model class changes. |
| Request fields | **+`response_format`** = `{"type":"json_schema","json_schema":{"name":"NormalizedRecipe","strict":true,"schema":<strict_json_schema(NormalizedRecipe)>}}`. Nothing else changes: `model`, `messages`, `max_completion_tokens`, `reasoning_effort`, `stream`, `stream_options` and `timeout` stay as they are. |
| Effort | Unchanged in this PR's code unless the owner approves `minimal` at STOP A. Then `normalize.py:36` becomes `"minimal"`, which changes `reasoning_effort` from `"low"` to `"minimal"`. |

- **Input tokens, option A:** strict on = today plus the provider's rendering of the
  response-format schema. That is an estimated +2.6–3.1K tokens (the schema text is 2,893); the
  bench measures it as `prompt_tokens(on) − prompt_tokens(off)` per recipe. Cost is about
  +₹0.06/call uncached and less when cached. The cached prefix (system message) doesn't change.
- **Option B (not recommended for S3):** drop the pasted schema when strict is on. That saves
  3,024 tokens of prompt text, so the net is about 0 after the response-format tokens. But the
  prompt bytes then differ between the strict on/off arms, so a quality change couldn't be
  pinned on strict. Proposed as a follow-up (FGC-27), measured on its own. Question 2.

**Dump-diff artifact (₹0).**
- `scripts/dump_extraction_request.py` builds the adapter over an `httpx.MockTransport` that
  captures the request body. It reuses the `tests/stream_fakes.py` `scripted_adapter` pattern,
  so no network call is made.
- It writes one canonical JSON per combination
  (`{stream on,off} × {strict on,off}` × kadhi raw) to
  `notes/pr-s3-strict-output/request-dumps/`.
- `before-*.json` is captured from origin/main code in commit 1, before any adapter change.
- Planned diffs, shown at STOP A:
  - `before-X` vs `after-X-strict-off`: **empty** (byte-identical);
  - `after-X-strict-off` vs `after-X-strict-on`: **exactly one added key, `response_format`**.
- Also saved: `strict-schema.json`, and its diff against `model_json_schema()`, which should show
  only `additionalProperties`, `required` and the dropped null defaults.

**Versions**
- Prompt version: none.
- `PipelineFingerprint`: add `extraction_strict: bool` and
  `extraction_response_format_sha256: str | None`. This makes every identity miss once; the cache
  is off in prod anyway.
- `POSTPROCESS_VERSION` 10 → **11**. `normalize.py` gets new code paths (refusal, request
  errors), and the FGC-11 floor touches `graph.py`. That is one new history entry (`"11"`). Its
  hash is refreshed by later commits of this same PR before push; the squash adds a single new
  entry and no old entry is edited.

---

## 3. Schema changes strict mode forces, and what they do to parsing

Implemented as `strict_json_schema(output_type)` in `adapters/prompting.py`, a pure,
deterministic transform of `model_json_schema()`. It mirrors the SDK's own
`openai.lib._pydantic.to_strict_json_schema`, which is what the SDK's `.parse()` sends and the
API accepts. Production code doesn't import that private module; a test asserts parity with it.
The pydantic models are **not** edited.

| Forced change | Where | Parse impact |
|---|---|---|
| `additionalProperties: false` on every object | root, NormalizedIngredient, NormalizedStep, NormalizedChapter | None: pydantic ignores extras today; now they can't appear. |
| `required` = all properties | 4 objects | See below. |
| `default: null` removed | 19 sites, all nullable `anyOf[…, null]` | None: the model emits `null`, and null == default. |
| Non-null defaults kept, as the SDK does | `servings_source`, `depends_on_previous`, `role` | The model must now choose a value. |
| Unsupported keywords | none present (checked) | none |
| `$ref` with siblings unravelled | none present (checked) | none |

What "all required" means for the parsed `NormalizedRecipe`:
- **Equivalent:** every nullable field now arrives as an explicit `null` instead of missing, and
  the parsed value is the same.
- **Arrays:** `ingredients/steps/chapters/notes/consumes_ingredients` must be emitted. `[]` is the
  same as the default.
- **Named differences:** three fields today's model may omit (falling back to the default) must
  now be chosen:
  - `depends_on_previous` (default `True`): an explicit `false` on a step whose
    `depends_on_steps` is null now reaches `graph.py`'s two-condition independence test
    (`graph.py` ~`:1118`), which still verifies it. Medium risk.
  - `role` (default `"required"`): non-required still needs a `role_cue` found in the source
    (`_role_honored`). Low risk.
  - `servings_source`: `_resolve_servings` re-verifies it. Low risk.
  - The bench counts how often each of these is non-default under strict on vs off.
- `ImportOriginal`/goldens: `model_dump_json` already writes every key, so stored originals are
  unchanged. Every golden `original.recipe` dump is tested to validate against the strict schema.
- **Output size:** explicit nulls cost output tokens if the model omits fields today. That's
  about 16 defaulted fields per step, so possibly +30–60 tokens/step, or 0.3–0.5 s/step at about
  120 tok/s. This hits steps-complete and done, but barely touches first-ingredient (only
  `group` is defaulted). The bench measures output tokens on vs off.

---

## 4. FGC-11: diagnosis method and generic fixes

**Method (₹0, before any fix).**
1. `reprocess()` the low output (`croissant__low__0.normalized.json` wrapped in the frozen
   croissant `ImportOriginal`) and the golden. For the three rests, record Node `duration_*`,
   provenance, the window capacities, `PlanSummary`, and every number the web derives from it
   (`viewModel.ts:175`).
2. Confirm stage by stage:
   - model output = 55/60/65;
   - `_verify_duration` out = 55/60/65 (`:859`);
   - Node = 55/60/65 `extracted`;
   - plan timeline = 60;
   - visible on screen: none.
3. Run the same trace on every corpus original. It is expected to show the same widening on kadhi,
   cupcakes and pizza.
4. Live: count stated-floor violations on every bench call. A violation is a node with
   `extracted` duration where `duration_min` < the low end of the source's own stated phrase for
   that step (the same parse as `_grounded_duration_expressions`). Split by strict on/off and by
   effort. This answers "does it recur at low", n=3.

**Candidate fixes (generic, with no recipe names in code):**
- **F11-a (recommended): stated floor in postprocess.**
  - In `graph.py:848-861`, when exactly one grounded plain expression exists and the per-unit path
    doesn't fire, set `dmin = max(dmin, expr.low_min)` (capped at `dtyp`) instead of
    `min(dmin, expr.low_min)`.
  - The max headroom stays: the scheduler uses `duration_max` for worst-case window eligibility,
    so widening upward is conservative.
  - Effect: a stated "1 hour" can never have a 55 floor, whatever the model emits.
  - Predicted golden diffs (`reprocess`): kadhi `duration_min` 28→30. Croissant is unchanged
    (6/6/6.5 has min = stated). Pumpkin has no stated durations. The pizza and cupcakes fixtures
    (non-golden tests) change 4.5→5, 1.8→2, 9→10 and possibly 55→60. All of this goes to
    STOP A; nothing is regenerated silently.
- F11-b: also clamp `dmax` to `expr.high_min`. It removes headroom, so more tasks become
  window-eligible and plans change. That's a product decision; not proposed now.
- F11-c: prompt v8 drops the "min 9" spread example. It's model-facing and would confound the
  strict A/B. Deferred to FGC-27 together with option B.

---

## 5. Kill-switch matrix and retry policy

- New `ABC_COOK_STRICT_EXTRACTION` in `base.py`, next to the stream switch. It uses the same
  parsing (unset = on; `0`/`false`/`off` = off), is read once in `OpenAIAdapter.__init__`, and is
  documented in `.env.example`.
- Off = byte-identical to today's request in both the stream and blocking paths.

| stream | strict | Request | Parse |
|---|---|---|---|
| on | on (default) | today + `response_format` | deltas joined → `parse`; refusal deltas collected |
| on | off | today, exactly | today |
| off | on | blocking today + `response_format` | `message.content` → `parse`; `message.refusal` checked |
| off | off | blocking today, exactly (pre-S2) | today |

All four are tested offline with `MockTransport`: request-body snapshot, parse, refusal, length.

**Retry policy with strict on:**

| Outcome | Behaviour |
|---|---|
| `finish_reason == "length"` | Unchanged: reasoning-exhausted stop → `failed/incomplete`; runaway → Tier 0 warning; else escalate once to 32K; a second cut stops. |
| Refusal (`delta.refusal`/`message.refusal` non-empty, or `finish_reason == "content_filter"`) | New `error_kind="refused"`, **no retry**, `failed` with `failure="refused"` (new `ImportFailure` value; question 3). Usage is kept, so the cost is reported. Never `method_not_grounded`. |
| infra | Unchanged: `failed/unavailable`, no retry. |
| request (non-infra 4xx, incl. a 400 schema rejection) | **Fixed in both modes:** no retry, `failed/unavailable`, with a WARNING naming the status. Today this wrongly ends as `method_not_grounded`. |
| unparseable | Shouldn't happen under strict. Keep the one identical retry as a defensive path and log it as a WARNING "strict contract violation" (question 4). |

What can no longer happen under strict: a missing or misspelt field, a wrong enum, prose or fences
around the JSON, or malformed JSON that isn't a truncation. Together these are the FGC-13 13%,
assuming its cause was schema or format; the `_log_unparseable` lines from strict-off bench rows
will show which.

Web, forced by the generated types: `make types` adds `'refused'` to `ImportFailure`, and
`FAILURE_COPY` plus `FailureBody` get a `refused` entry. It uses the same buttons as `incomplete`
(paste text / try another link) and owner-approved copy. No other UI change.

---

## 6. DraftScanner/replay re-check (FGC-22) and the watchdog (FGC-23)

**FGC-22**
- The bench saves each live call's raw streamed text (`raw_text`, kept on success in the bench
  wrapper only).
- Checks per text:
  - the top-level key sequence and each step's key sequence equal the schema order (`text` first);
  - `DraftScanner` fed char-by-char, and again in the real chunking, gives ingredients/steps equal
    to the final `parse` (`ingredients_complete`, `steps_complete`, not `broken`);
  - the key sequence of `json.loads(raw)` matches `recipe.model_dump_json()`. Byte equality isn't
    expected, because of `5` vs `5.0`, `\u` escapes and whitespace.
- If the key sequences match, the replay texts (derived from `model_dump_json`) already model
  strict output, so no fixture regeneration is needed; that is the expected result. If they
  differ, regenerate the replay source as captured raw text and re-run `stream_draft_bench.py`.
- Either way, commit two captured strict raw texts as new scanner fixtures:
  `tests/fixtures/stream/{kadhi-pakora,croissant}.strict-low.raw.txt`. They are written with the
  Write tool, LF, and a mojibake grep is run after.

**FGC-23**
- The bench wrapper timestamps every `on_text` delta and records, per call:
  - `first_content_s` (the reasoning silence);
  - the max gap between deltas;
  - whether it was the first strict call (the provider compiles a new schema on first use, which
    can add latency before the first chunk).
- The guard in `test_extract_streaming.py:276` becomes `>= 3 * <observed max silence>`, with the
  observed value cited.
- If 3 × the max exceeds 60 s (e.g. a slow first-schema call), STOP A proposes either a higher
  `STREAM_IDLE_TIMEOUT_S` or a warm-up note. `test_replay_harness.py:135` changes only if the
  constant does.

---

## 7. Tests (₹0 first, test-first; run with `-m "not llm and not network"`)

1. `test_strict_schema.py`:
   - every object has `additionalProperties:false` and `required` == all keys;
   - property order is preserved (recipe order, `text` first);
   - no unsupported keyword; nullable fields keep their null branch;
   - deterministic bytes; doesn't mutate the cached `model_json_schema()`;
   - parity with the SDK's `to_strict_json_schema`;
   - every golden/known-wrong `original.recipe` dump validates against it (`jsonschema` if it's
     already a declared dev dependency, otherwise a small structural checker).
2. `test_extract_streaming.py` / `test_openai_adapter.py`, the 4-way matrix:
   - request-body snapshot equals the frozen `before` body (strict off) or `before` +
     `response_format` (strict on);
   - parse ok; `length` → truncated;
   - refusal deltas → `refused` with usage; `content_filter` → `refused`;
   - blocking `message.refusal` → `refused`;
   - the switch is read once at construction.
3. `test_extract_normalize.py`:
   - `refused` → `failed/refused`, 1 call, never Tier 0;
   - `request` error → `failed/unavailable`, 1 call;
   - unparseable under strict → still exactly one retry (or none, per question 4);
   - all existing truncation and escalation tests unchanged.
4. `test_drafting_adapter.py` / `test_stream_draft_scanner.py`: the captured strict raw texts
   produce the same milestones as the final parse, in whole-text and chunked feeds.
5. `test_cache.py`: the strict flag and response-format hash change the identity; strict off
   still differs from strict on.
6. `test_extract_graph.py` (F11-a, generic):
   - "rest for 1 hour" with 55/60/65 → 60/60/65;
   - "5 to 10 minutes" with min 4 → 5;
   - per-unit, ceiling and lead paths unchanged;
   - no recipe name in the code.
7. `test_corpus_replay.py`: unchanged until STOP A. The approved diffs are regenerated only with
   `PYTHONPATH=<abs>/apps/api python apps/api/scripts/regen_corpus_expected.py`.
8. `test_postprocess_version.py` (entry 11) and the existing replay harness and
   `api_import_stream` suites stay green.
9. Web: `tsc` and Vitest for the `FAILURE_COPY` entry. `make types` runs with an absolute
   PYTHONPATH; CRLF-rewritten fixtures are restored with `git checkout`.

---

## 8. Live runs (₹)

**Setup**
- Frozen `*.raw.json` only: no yt-dlp, no captions, no YouTube.
- `scripts/strict_bench.py` runs the **real route in-process**. It reuses
  `devtools/replay.create_replay_app` wiring, with `fixture_acquire` at 0 s and the real
  `build_default_adapter()`. So the logged `import cost:` lines are the spend record, and
  `DraftingAdapter`'s draft log line gives the milestones.
- Keys: `load_dotenv(r"C:\Users\ashya\Music\ABC cook\apps\api\.env")`, never printed.
  `LLM_API_KEY` is set to an invalid value in the bench process, so repair can never spend (₹0;
  "repair would fire" is recorded instead). ₹0 dry runs set both keys invalid.
- Quality is computed offline per call:
  - `postprocess(original_from_call, repair_fn=stub)` with F11-a off and on;
  - compared to the golden: tier, stated durations (the multiset of `extracted` nodes'
    typical/min), stated-floor violations, and edge recall/precision via the fuzzy matcher in
    `notes/investigate-extraction-speed/diff_goldens.py`, copied to `notes/pr-s3-strict-output/`.

**Recorded per call:**
- time to first content, first ingredient, ingredients complete, first step, steps complete, done;
- max silence and max inter-delta gap;
- input, cached, output and reasoning tokens; retries;
- ₹; tier; "repair would fire";
- the non-default counts (`depends_on_previous=false`, `role`, `servings_source`);
- FGC-21 count (draft step text vs plan duration mismatches; recorded only, not fixed);
- the quality verdict.

**Run table** (₹ from the S2a and speed-investigation measurements; runs in this order).
Strict is on in every row except 3, 9 and 10. Superseded by amendment A1 above.

| # | recipe | effort | strict | n | ₹/call est. | ₹ est. | covers |
|---|---|---|---|---|---|---|---|
| 1 | croissant | low | on | 1 | 0.70 | 0.70 | schema acceptance (a 400 costs ₹0 → STOP), first-schema latency, FGC-11 |
| 2 | croissant | low | on | 2 | 0.70 | 1.40 | FGC-11/15 n=3 |
| 3 | croissant | low | **off** | 3 | 0.68 | 2.04 | strict on vs off, FGC-11 recurrence today, FGC-13 log lines |
| 4 | chole | low | on | 3 | ~1.7 (worst 2.8) | 5.10 | FGC-12/15 n=3, long input, max silence |
| 5 | kadhi | low | on | 3 | 0.80 | 2.40 | FGC-12/15 |
| 6 | kadhi | minimal | on | 3 | 0.55 | 1.65 | FGC-12 |
| 7 | croissant | minimal | on | 3 | 0.50 | 1.50 | FGC-12 |
| 8 | pumpkin | low | on | 1 | 0.50 | 0.50 | corpus quality (third golden) |
| 9 | kadhi | low | **off** | 1 | 0.77 | 0.77 | the brief's "one other recipe" for strict on vs off |
| | **Mandatory subtotal** | | | **20 calls** | | **~16.1** | |
| 10 | kadhi | low | **off** | 1 | 0.77 | 0.77 | optional: kadhi strict-off at n=2 |
| 11 | pumpkin | minimal | on | 1 | 0.40 | 0.40 | optional |
| | **Total if everything runs** | | | **22** | | **~17.2** | |

- The mandatory subtotal (about ₹16.1) is over the ₹10–15 range. Question 5 offers trimming
  chole low to n=2 (−₹1.7), which lands at about ₹14.4.
- **Hard cap ₹20**, enforced by `Budget` (from `effort_ab.py`) with a per-call reserve of ₹2.8 (a
  16K-output worst case). A call that would cross ₹20 is skipped, so in practice runs stop once
  spent > ₹17.2.

**Stop rules**
- Stop everything at the first auth, infra or 4xx failure, and report it.
- Row 1 must succeed before anything else runs.
- No retries beyond what `normalize()` itself does; those are counted in spend.
- Spend is reported from the `import cost:` lines, with a running total against the cap. A
  mid-stream failure's spend is unreported (FGC-19) and is flagged as a lower bound.

**Can `minimal` ship? Decision rule, applied at STOP A.** (Amendment A1 adds row 12, chole
minimal, as a further condition.)
- `minimal` ships only if, on every recipe where it ran:
  - zero new stated-time violations;
  - no tier regression;
  - "repair would fire" no more often than at low;
  - edge recall/precision vs golden within the low arm's own n=3 spread;
  - chole was not run at minimal (row omitted on purpose), so minimal's verdict is stated as
    kadhi/croissant/pumpkin only.
- Any drop means low stays, and the remaining first-ingredient gap goes to FGC-20.
- Strict on ships at low if it meets the same floor relative to strict off.

---

## 9. Commit sequence

Worktree `C:\Users\ashya\Music\abc-cook-s3`, branch `feat/pr-s3-strict-output`, squash-merge.

0. `docs:` the plan and FGC updates (setup, section 11). **STOP.**
1. `test:`
   - `scripts/dump_extraction_request.py`;
   - the frozen `before` request bodies (stream and blocking, captured on unmodified code);
   - the failing tests from section 7, items 1–5.
2. `feat(extract):` strict request.
   - `strict_json_schema` in `prompting.py`;
   - `ABC_COOK_STRICT_EXTRACTION` in `base.py`;
   - `response_format` on both adapter paths;
   - refusal capture and the `refused` `ErrorKind`;
   - `PipelineFingerprint` fields;
   - `.env.example`;
   - the `openai.py` docstring.
3. `feat(extract):` `normalize` refusal and request-error handling.
   - `ImportFailure` gets `refused`;
   - `make types`; the web `FAILURE_COPY` entry;
   - `POSTPROCESS_VERSION` 11 plus its history entry.
   - The full ₹0 suite (`-m "not llm and not network"`), ruff on changed files, `mypy --strict`
     on schema/schedule, `tsc`, Vitest.
4. `chore(notes):` `scripts/strict_bench.py`, the dry run (both keys invalid; prints the run list
   and reservations), then the live runs; raw outputs go in `notes/pr-s3-strict-output/`
   (force-added).
5. **HARD STOP A**, for owner approval. It brings:
   - the results table (every row and metric from section 8, measured ₹ and total);
   - minimal vs low and strict on vs off verdicts;
   - FGC-11 trace and recurrence rate;
   - FGC-15 spread; FGC-22 key-order result; FGC-23 max silence;
   - request dump diffs and the input-token delta;
   - the F11-a predicted and actual `reprocess` golden diffs;
   - the proposed effort and watchdog changes.
   No golden is touched before approval.
6. After approval:
   - `fix(extract):` F11-a, with its unit tests and the approved snapshot regeneration
     (PPV-11 entry hash refreshed);
   - `feat(extract):` the effort constant, only if `minimal` is approved;
   - `test:` captured strict raw-text fixtures, scanner tests, and the watchdog guard value;
   - `docs:` FGC-11/12/13/15/22/23 resolved in `followup-golden-corpus.md`, FGC-27 added, plan
     results.
7. Full ₹0 suite plus `stream_draft_bench.py` (₹0) re-run. **HARD STOP B, before push:** show
   `git log`, the diff stat, test output, and the final request dump diff.

---

## 10. Risks and owner questions

**Risks**
- Explicit nulls lengthen the output, so steps-complete and done may regress even if the first
  ingredient improves. This is measured; the owner decides at STOP A.
- Constrained decoding can change content (an explicit `depends_on_previous`, choice of `role`).
  The n=3 floors catch only large effects, and n=3 is still small (pizza's run-to-run edge recall
  was 0.33).
- The first call with a new schema can be slow while the provider compiles it. The provider
  caches the compiled schema per schema, not per deploy, so this is paid once per schema change
  (amendment A3); it could still brush the 60 s idle and 75 s read bounds on that call.
- The hand-rolled transform could drift from the SDK's; the parity test guards this. The
  `openai>=1.0` dependency is unpinned.
- The refusal path is only exercised through fakes; no live refusal is expected on recipes.
- F11-a changes several stored-plan `duration_min` values (expected and small). `POSTPROCESS_VERSION`
  11 invalidates cached plans, and saved recipes refresh through staleness.
- Out of scope, and the plan stays inside it:
  - deploy (M5);
  - FGC-19 (untouched);
  - FGC-20 (only receives the gap);
  - FGC-21 (counted only);
  - web UI beyond the forced `refused` entry;
  - a cross-user cache;
  - output-size reduction;
  - prompt v8 / option B (FGC-27).

**Questions (my recommendation first; answered in the owner amendments above)**
1. FGC-11 severity: if the trace confirms no on-screen number changes, regrade it from P1 to P2
   but still ship F11-a (a floor only, keeping max headroom). **Rec: yes, and F11-a only.**
2. Schema in the prompt with strict on: keep it pasted (option A, prompt byte-identical, about
   +3K duplicated input tokens) and measure removal later as FGC-27? **Rec: option A now.**
3. Refusals: add `ImportFailure = "refused"`, with web copy such as "This recipe couldn't be
   read." and the paste/try-another buttons? The alternative is reusing `incomplete`, which isn't
   truthful. **Rec: a new value; you approve the copy.**
4. Unparseable under strict: keep the one identical retry as a defensive path, logged as a strict
   contract violation? **Rec: keep it; it costs nothing unless it fires.**
5. Budget: the mandatory set is about ₹16.1, over the ₹10–15 range (₹20 cap holds). Accept it, or
   trim chole low to n=2 (about ₹14.4)? **Rec: accept ₹16; chole is where the reasoning silence
   and the spread matter most.**
6. Request-error fix (a 4xx is today misreported as `method_not_grounded`): include it in S3,
   since strict creates the 400 risk? **Rec: yes.**

---

## 11. Setup steps, for after plan mode (then STOP)

1. `git fetch origin`, then
   `git worktree add -b feat/pr-s3-strict-output C:\Users\ashya\Music\abc-cook-s3 origin/main`.
2. Write this plan with the Write tool to `abc-cook-s3\docs\plans\pr-s3-strict-output.md`.
3. Edit `docs\plans\followup-golden-corpus.md` with the Edit tool:
   - FGC-11: the root cause (v7 spread rule plus the `_verify_duration` widening); evidence on
     kadhi, cupcakes and pizza; not visible on screen today; owned by S3/F11-a.
   - FGC-12/13/15/22/23: "owned by PR-S3", with the plan link.
   - FGC-27 (new): prompt v8 / remove the pasted schema / the spread rule, measured on its own.
4. Mojibake grep on both files (`Ã|â€|Â`, plus U+FFFD).
5. One commit, `docs(plans): PR-S3 strict output plan; FGC updates`, with the attribution
   trailer. **STOP:** no push, no code, no spend.

Standing rules for all later steps:
- Write/Edit for non-ASCII, never heredocs.
- Never `ruff format .`.
- Stop only my own PIDs; port 9222 is the owner's.
- No deploy steps, no phone runs.

## STOP A decisions

STOP A decisions (owner, 2026-10-18).

Approved, implement in this order (commit 6, split into small commits):
1. fix(extract): final-step produces drop.
   - In graph.py, when a node that produces a component has no later node, drop produces_component and log a WARNING (B3's guard made true for the empty set).
   - Generic, unit tests only, no recipe names.
   - Covered by PPV 11; refresh the history-entry hash in this PR, and add no new entry.
2. fix(extract): F11-a stated floor, with its unit tests.
   - Then run regen_corpus_expected.py with an absolute PYTHONPATH and show the full before → after diff of every golden and fixture.
   - Allowed: duration_min raised to the stated low end only (expected: kadhi 28→30, pizza 4.5→5, 1.8→2, 55→60; cupcakes 9→10).
   - If anything else changes (typical, max, edges, tier, summary, node count), STOP and report before committing.
3. ₹0, on the existing 19 calls through the real code (not the prototype):
   - repair-would-fire per arm, before → after both fixes;
   - stated-floor violations per arm;
   - edge agreement with the matcher: within strict-off (pairwise), within strict-on low (pairwise), and CROSS on-vs-off (all on×off pairs), with mean, min and max.
4. Live check, approved at about ₹3.2:
   - croissant, low, strict on n=3 plus strict off n=2; frozen transcript only; repair key invalid as before.
   - Cap for the whole PR is ₹16. Stop at the first auth, infra or 4xx failure.
   - Then recompute point 3 with all calls (croissant: on n=5 excluding row 1, off n=5).

Decision rule for the strict default (apply it and report the verdict):
Strict ships default ON only if, after both fixes, ALL of these hold:
  a. croissant repair-would-fire rate, on ≤ off;
  b. mean cross on-vs-off agreement ≥ (mean within-off agreement − 0.05);
  c. zero stated-floor violations in either arm with F11-a on;
  d. kadhi and pumpkin no worse than today's results.
Otherwise: default OFF via ABC_COOK_STRICT_EXTRACTION. Keep all the code (refusal, request-error, kill switch). Add FGC-28 with the evidence.

Other decisions:
- Effort stays low. Record the minimal results in FGC-20 (first ingredient about 8–10 s from paste; kadhi quality drop).
- STREAM_IDLE_TIMEOUT_S stays 60. Guard test: >= 3 * 15.6, citing this bench.
- Follow-ups to add to followup-golden-corpus.md:
  - FGC-28 (strict verdict, if off);
  - FGC-29: a label produced at a non-final step that nothing consumes (kadhi minimal step 1). Today it triggers a repair the repair prompt can't satisfy; consider a generic drop or a repair hint. Record only.
- Then the rest of commit 6 as planned: strict raw-text fixtures, scanner tests, watchdog guard, FGC docs.

Report at a short checkpoint (not STOP B) after point 4: the regen diff summary, the table from point 3, the live rows, spend, and the strict verdict under the rule. Then continue to the remaining commit-6 work and HARD STOP B.

## Results (PR-S3, 2026-10-18)

What shipped, and what was decided by data. Evidence is under `notes/pr-s3-strict-output/`
(`stop-a.md`, `produces-consumed.md`, `rescore.out.txt`, `regen-diff.txt`, the per-call JSON in
`calls/`).

- **Spend:** ₹16.84 over 29 live calls (the cap was ₹20, lowered to ₹16 after STOP A, then raised to
  ₹18 for the pumpkin check).
- **Strict output:** ships **on** (`ABC_COOK_STRICT_EXTRACTION=0` is the kill switch; off is
  byte-identical to the pre-PR request). The STOP A decision rule first failed on pumpkin (edge
  precision 0.60 vs 0.75, n=1 each) and the default was set off; with pumpkin at n=3 per arm
  it passes (repair-would-fire 1/3 vs 2/3, edge recall/precision 1.0/0.87 vs 0.87/0.77), so the
  default is on. Recorded as FGC-28 (resolved).
- **Effort:** stays `low`. `minimal` is 8–10 s from paste to the first ingredient but fails the
  quality floor on kadhi (FGC-12, FGC-20); chole minimal was not run.
- **Fixes that apply with strict off:** the final-step `produces` drop (croissant repair-would-fire
  3/5 strict-off and 4/6 strict-on calls → 0) and the F11-a stated floor (`duration_min` only;
  goldens byte-identical). Both are covered by POSTPROCESS_VERSION 11.
- **By construction, not measured:** FGC-13's 13% unparseable rate (0 in 24 calls; it did not
  reproduce), and the effect of explicit nulls on output size (no increase seen).
- **Follow-ups added:** FGC-28 (strict verdict, resolved: on), FGC-29 (non-final unconsumed label); FGC-27 gained
  the `v7.md:197` `depends_on_previous` conflict.
- **Idle bound:** `STREAM_IDLE_TIMEOUT_S` stays 60 s. The guard is 3 × 19.3 s, the highest silence
  seen (the STOP A decision said 15.6 s; a later call went past it). The margin is thin (57.9 s vs
  60 s): if a silence over 20 s is ever observed, revisit `STREAM_IDLE_TIMEOUT_S` (FGC-23).
