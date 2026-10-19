# Follow-ups from the widened golden corpus

Source: the 2026-10-16 capture of five real imports (`docs/plans/golden-corpus-widen.md`). One live
import each, GPT-5-mini extraction at production effort, Sonnet repair. Nothing here is fixed by
the corpus PR; each item is logged with its evidence.

Frozen goldens: `kadhi-pakora`, `croissant`, `pumpkin-pancakes` (`apps/api/tests/fixtures/import/`).
Known-wrong evidence, not goldens: `known-wrong/` (see its README).
Each golden's `replay-expected.json` lists the ids below in `known_issues`; a fix that changes those
nodes is an expected snapshot diff, regenerated only with
`PYTHONPATH=apps/api python apps/api/scripts/regen_corpus_expected.py`.

## Follow-ups

### FGC-1 (P1): a long Hindi transcript exhausted the output budget on reasoning at medium, returned Tier 0, and is misdiagnosed

Chole bhature (FU1ZVLMbWjA, 13:14, Hindi auto transcript of 11,602 chars, 3 ingredient groups):
in the 2026-10-16 capture, `reasoning_tokens = 16000`, `output_tokens = 16000`, no visible output,
1 truncation, 141 s, INR 2.75. The pipeline stopped without escalating and returned Tier 0
`method_not_grounded` with the warning "Extraction output looked like a runaway generation after
truncating at 16000 tokens (repeated or missing steps)". That wording is wrong: nothing repeated; the
whole budget went on reasoning (`_is_runaway` returns True whenever `"steps"` is absent).

**Correction (investigation, 2026-10-16):** the capture ran `effort_ab --arms medium`, whose
`ARM_EFFORT["medium"]` is `None`, i.e. the provider default (medium). Production is `low`
(`normalize.py:32`), so this did **not** fail at the production setting. It did **not** reproduce:
chole reached a plan in 5 of 5 new attempts (minimal, low x2, medium, translate-first at low). At low,
reasoning was 192-512 tokens (3 of 3 low runs reached a plan, counting the translate-first run);
medium reproduced the large reasoning (6,912 tokens, 99.8 s) but finished. So this is a rare stochastic
exhaustion at medium (1 failure in 2 medium attempts overall), not a length or language limit. The
transcript is 11,602 chars (29,442 is its UTF-8 byte length).

- Evidence: `apps/api/tests/fixtures/import/known-wrong/chole-bhature.raw.json`;
  `notes/investigate-extraction-speed/REPORT.md` (T3).
- Competitor note: ReciMe imports this same video in ~10 s (owner recording, 2026-10-16), so it is
  achievable.
- Fix: (a) a truthful signal when `reasoning_tokens == output_tokens` and visible output is empty
  ("the model used its whole budget thinking"), instead of "repeated or missing steps"; (b) a guard so
  that no retry, escalation or config path can raise extraction effort above `low` (today effort is
  only `low` unless a caller passes `extraction_effort`; `None` means the provider default, medium).

### FGC-2 (P1): an LLM auth/infra failure (401) surfaces as `method_not_grounded`

With an invalid Anthropic key every repair failed and all five imports silently degraded to the linear
fallback; with an expired OpenAI key the extraction failed twice and the result was
`method_not_grounded` ("Extraction failed twice; treating as ungrounded (error: AuthenticationError
... 401 ...)"). An infrastructure error is reported as a verdict on the recipe. It should be a
"try again" infra error that is never cached, never saved, and never shown as "this isn't a recipe".
It also wasted INR 7.72 of captures that looked like valid results.

- Evidence: this session's first two attempts (no fixture; reproduce with an invalid key).

### FGC-3 (P2): an incomplete method is presented as a complete plan

Vanilla cupcakes (YP8a6ugKQ6Y): no captions, no blog, and the description has no method steps, only one
method line. The result was a clean 4-step plan (powder sugar, preheat, bake, "use oil instead") with
no step that makes the batter. Every step is grounded (nothing invented); the danger is omission. A
plan whose Bake step has no batter must be flagged or refused, not scheduled.

- Evidence: `known-wrong/vanilla-cupcakes.{raw,original}.json`.
- **Owner decision (2026-10-16): (b)**, fill the standard missing steps, each labelled "Added by ABC
  Cook, not in the video" (or "…not in the recipe"). Recorded verbatim in
  `docs/plans/decisions-2026-10-16-incomplete-method.md`. Competitor ref: Copymenu fills gaps silently;
  ReciMe turned the notes into steps.
- **Owned by** `docs/plans/fix-fgc-345-quality.md`, PR 2 (prompt v8 + `origin` field, measured A/B).
- **Status after PR 2 (2026-10-18):** decision (b) stands. The infrastructure is merged with
  `ABC_COOK_ADDED_STEPS` default OFF (`origin`, the guards, the labels, the draft scanner, prompt v8).
  v8 (low, strict) elicited 0 added steps in 15 B runs; the model's notes cite "never invent".
  Next attempt, before M5: rewrite the "never invent" passages (`v7.md:10-15`, `:63-67` and any
  others) around the exception instead of appending one, and start with cupcakes + kadhi at n=3
  (about ₹5), under the same D3 rule.
- Label styling: in cooking mode the added-step line uses the same grey style and slot as a doneness cue;
  revisit its prominence when the switch is turned on.

### FGC-4 (P2): notes and alternatives become steps

- Cupcakes: "Butter can be replaced with 1/2 cup vegetable oil" became a required hands-on step
  ("Use oil instead") scheduled after Bake. It is a substitution note; the alternative grounding failed
  because the cue is not a marker.
- Pumpkin pancakes: two alternative toppings became "Serve classic" then "Serve with chips", chained
  (the second depends on the first). The optional/alternative grounding failed on the cue "two different
  ways to eat these pancakes".
- Evidence: `known-wrong/vanilla-cupcakes.original.json`; `pumpkin-pancakes.original.json`.
- `pumpkin-pancakes` carries FGC-4 in `known_issues`.
- **Owned by** `docs/plans/fix-fgc-345-quality.md`: PR 1 widens the markers and judges cue
  ownership by token coverage (fixes cupcakes and pumpkin's first serving way); PR 2's prompt rule
  covers pumpkin's second way, whose cue carries no marker.
- **After PR 1 (priority inverted):** pumpkin's classic serving way is now an optional tip on "Cook
  pancakes", while "Serve with chips" stays a required node (total 24 to 23). PR 2's prompt rule
  (later serving ways attach to the first) is meant to fix it.
- **PR 2 result (2026-10-18): option M did not work.** In 6 pumpkin runs (v7 and v8, n=3 each), 0
  attached the later way to the first way, and "Serve with chips" stayed a required node in all 6.
  FGC-4 stays open (see FGC-39).

### FGC-5 (P2): "N minutes before serving" is not honoured

Kadhi pakora: the source says "10 minutes before serving add pakora to the kadi". The plan puts Add
pakoras at t=50 and Serve at t=53, so the pakoras sit in the kadhi about 3 minutes, not 10. A lead time
on a hands-on step is dropped (this is F1 in `followup-offset-not-duration.md`: no minimum-start-gap
modelling), now with a real instance. The honest fix is a product/scheduler decision.

- Evidence: `kadhi-pakora.original.json`. `kadhi-pakora` carries FGC-5.
- **Owner decision (2026-10-18): option (d)**, owned by `docs/plans/fix-fgc-345-quality.md` PR 1.
  `graph.py` inserts a source-stated "wait before serving" node (duration `extracted`) after a
  hands-on step whose lead phrase is anchored to serving. No schema or scheduler change. The lead is
  lost today in `_verify_duration`, which drops a lead on a hands-on step and records it nowhere.
- **Fixed in PR 1** (`fix/fgc-4-5-postprocess`, PPV 12): kadhi now has a "Wait before serving" node
  (10 min, `extracted`), Serve at 61, total 62. FGC-5 left `known_issues`.

### FGC-6 (P2): "half hour" (English) and Devanagari number words are not parsed

- Kadhi: "let it cook for half hour" has no number word, so the duration is not stated; the model's 30
  is rejected, then estimated 28-32 and clamped to 28 min under the window-host rule.
- Chole transcript: "पांच घंटे" (five hours) and "सेवन मिनट" (English "seven" in Devanagari) are not
  parsed, while the digit forms ("6 घंटे" = 360 min, "7 मिनट") are. This confirms F5 on real data.
  आधा and डेढ़ occur in the video only as quantities ("आधा चम्मच", "डेढ़ कप"), never as durations.
- Evidence: `kadhi-pakora.original.json`, `known-wrong/chole-bhature.raw.json`.
  `kadhi-pakora` carries FGC-6.

### FGC-7 (P3): no preheat when the source omits it; per-unit repetition is timed once

Croissant: the source says only "Bake at 190 for 20-25 min", so the plan goes Egg wash then Bake with no
preheat step; read literally the croissants go into a cold oven. And "Divide into 8 equal portions ...
take one piece ..." / "slice into 6 triangles ..." describe one of 8 / one of 6, so Form circle, Stack
layers and Shape croissants are timed once and hands-on (46 min) is understated.

- Evidence: `croissant.original.json`. `croissant` carries FGC-7.

### FGC-8 (R3 note): a stated yield is ignored and servings default to 4

Cupcakes: the description states a yield of 18-20 cupcakes; the plan says "Servings not stated in the
source; defaulted to 4." Also seen on pumpkin pancakes and croissant ("Servings not stated"), where
the source does give quantities but no count. Input for R3 (scaling).

### FGC-11 (P2): croissant at low states 55 min (x3) where the source says "1 hour"

In the extraction-speed smoke run, croissant at production `low` emitted `duration_min` 55 three times
(labelled `extracted`, `duration_stated`) for the rests the source gives as "1 hour", "one hour" and
"1 hour" (`croissant.original.json` source text). The golden and the `minimal` run have 60. This is a
stated-time violation: a number the source states was changed. It is not FGC-6: FGC-6 is about number
words the parser cannot read, and two of the three source phrases are the digit form "1 hour". n=1, so
whether it recurs at `low` is not known; it needs a repeat before a fix is chosen.

- Evidence: `notes/investigate-extraction-speed/REPORT.md` (T7, croissant minimal vs low).
- Root cause (PR-S3 plan, 2026-10-18), in two parts:
  - The model follows `v7.md`'s duration rule, which allows a "small min/max spread" around a
    stated number ("10 minutes" → min 9, typical 10, max 12). At low it gave 55/60/65.
  - `graph.py` `_verify_duration` keeps that floor, because it widens (`min(dmin, low)`) and
    never raises a min below the stated value.
  - Repair isn't involved.
  - The same widening sits in the frozen originals: kadhi 28/30/32, cupcakes 9/10/11, pizza
    4.5/5/6, 1.8/2/2.5 and 55/60/70. So it is not croissant- or low-specific.
  - The scheduler uses `duration_typical` (60), so no number on screen is expected to change.
    The ₹0 trace in PR-S3 confirms this before the item is regraded.
- Owned by PR-S3 (`docs/plans/pr-s3-strict-output.md`), fix F11-a: a generic stated floor in
  postprocess, keeping the max headroom.
- **Resolved by PR-S3 (F11-a).** `_verify_duration` now raises `duration_min` to the stated low
  end (capped at the typical) when exactly one grounded plain expression exists and the per-unit
  path does not fire; the max keeps its headroom. The ₹0 trace (model 55/60/65 → verify 55/60/65 →
  node 55/60/65 `extracted` → timeline 60 min) showed no number on screen: the scheduler never
  reads `duration_min`, and the web uses it only for the `~Nm` countdown when max − min > 15, which
  no changed node crosses. Before the fix it recurred at `low` in croissant 5/6 strict-on calls and 2/5
  strict-off calls (all calls through the replication run); with the floor it is 0 in every call. None of the 14 violating steps used hedged wording. Goldens are byte-identical
  after regen; fixture changes are `duration_min` only (cupcakes preheat 9→10; pizza 4→5 and
  55→60; dal makhni 1→2 and 28→30). Regraded P1 → P2 (no on-screen change).

### FGC-12 (P2): run-to-run noise at low is large and the quality comparisons are n=1

Same recipe, same settings, two runs: chole at `low` gave `total_min` 473 vs 909 and stated durations
[5, 360] vs [6, 10, 360, 360]; pizza at `low` differed in edges (recall 0.33, node recall 0.7). The
quality cells in the speed investigation are therefore n=1 and cannot certify "edges and stated
durations unchanged" for any effort level, including today's. Wanted before M5: `minimal` vs `low`
at n=3 on the corpus, scored on edges, stated durations and tier.

- Evidence: `notes/investigate-extraction-speed/REPORT.md` (T7).
- Owned by PR-S3 (`docs/plans/pr-s3-strict-output.md` § 8): minimal vs low at n=3 on kadhi and
  croissant; chole at n=2, with chole minimal only if those pass.
- **Measured by PR-S3** (`notes/pr-s3-strict-output/stop-a.md`, 24 calls). Noise at `low` is real:
  croissant strict-off edge agreement within the arm is 0.64–0.95 (mean 0.84, n=5). `minimal` at
  n=3 fails the floor on kadhi (degraded 2/3 vs clean 3/3 at low, repair-would-fire 2/3 vs 0/3,
  edge recall 0.43–0.58 vs 0.83–1.0) and is no worse on croissant; chole minimal was not run (it
  runs only if both pass), so `minimal` cannot ship and `low` stays.

### FGC-13 (P2): about 13% of full calls need an unparseable-response retry

2 of 15 full runs (croissant at minimal, pizza at low) returned unparseable output and were retried:
+18-24 s and about 2x the cost (pizza INR 1.43 vs 0.66). The cause is unknown because `raw_text` is only
kept on truncations (`openai.py` returns `ExtractResult(recipe=None, error=...)` with no text on a parse
failure). Fix: capture the raw text (and `finish_reason`) on a parse failure before changing anything.

- Evidence: `notes/investigate-extraction-speed/REPORT.md` (T2, rows with 2 calls).
- Owned by PR-S3 (`docs/plans/pr-s3-strict-output.md`). Strict structured output removes schema
  and format failures by construction; this is argued, not measured. One defensive retry stays,
  logged as a "strict contract violation".
- **Not reproduced by PR-S3.** 0 unparseable responses in 24 calls (strict on and off, `low` and
  `minimal`), so the 13% could not be measured or attributed. The adapter now WARNING-logs a parse
  failure under strict, and `normalize` already logs head and tail of any unparseable text, so the
  next occurrence will carry its cause. Strict ships on (FGC-28), so the next unparseable response will
  say why.

### FGC-14 (P1): acquisition budget (S1.5, after S1, before S2) — addressed by PR-S1.5

**Status (2026-10-17): addressed by PR-S1.5.** The plan is `docs/plans/pr-s1-5-acquisition-budget.md`:

- `acquired` is reported right after yt-dlp;
- affiliate and shop hosts are excluded before fetching, and `urlgeni.us` wrappers are unwrapped;
- a redirect onto an excluded host is refused before that host is fetched;
- each link gets 4 s and the whole stage 8 s;
- a cost and token line is logged per import.

The evidence below is kept as it was.

The description's blog links are probed one at a time (`acquire/pipeline.py` loops `find_candidate_links`
and calls `fetch_recipe` on each), and extraction waits for the loop. On the phone (PR-S1 measuring,
2026-10-17, invalid-key API, so no extraction cost) the `acquire` stage took:

| Video | acquire stage | `fetch_recipe` calls | ended "redirected to excluded host" |
|---|---|---|---|
| chole (FU1ZVLMbWjA) | 54-56 s (3 runs) | 13 | 10 |
| captions-manual-en (pxpJmXq2w7c) | 78-80 s (2 runs) | 29-32 | 25-26 |
| vanilla-cupcakes (YP8a6ugKQ6Y) | 12 s | 4 | 0 |
| kadhi, croissant, pumpkin, shorts | 2.6-5 s | few | n/a |

That is about 2.4-4 s per sequential fetch, with no cap on the number of links. The job reports
`acquired` and moves to extraction only when the whole stage returns, so the cook sees no description
for up to 79 s, and a real import would add that to its extraction time.

**Why this disagrees with the investigation's "about 3 s".** Two different things are being compared:

- The investigation's about 3.0-4.3 s (n=3) is **yt-dlp `extract_info` only** (REPORT T8, "Metadata
  preview from yt-dlp info"). It excludes the blog probing.
- REPORT T8 never measured a link-heavy description. The script ran 3 of 12 yt-dlp calls, stopped on an
  HTTP 503 from `amzn.to` at the first blog link of the 3rd video (pumpkin), and states "Chole's
  acquisition time is unmeasured". The one full row (pizza-dough) had 28 candidate links but hit a recipe
  on the 2nd, so its blog time was only 4.0 s.
- So the chole figure here (54 s) is the first measurement of a description whose links are all affiliate
  or shortener wrappers that never lead to a recipe: every one is fetched, redirected and only then
  rejected.

**Mechanism (from `acquire/blog.py`).** Shorteners are deliberately not excluded before fetching
(`find_candidate_links`: "resolve first; excluded-host check happens post-redirect"), and wrappers such as
`aip.urlgeni.us` are not in `_EXCLUDED_HOSTS` either, so each costs a full request (10 s timeout, up to 5
redirects) before the "redirected to excluded host" verdict.

Fix candidates (cheapest first; none changes the model's input for a recipe that has a blog hit):

1. **Report `acquired` right after yt-dlp**, before the blog loop, so the title and description show at
   about 3-4 s regardless of links. Needs a two-phase acquire callback; `import_pipeline.py` and the
   route's `acquired` wrapper are the touch points.
2. **Skip known affiliate, shortener-wrapper and shop hosts before fetching** (geniuslink, amzn.to,
   amzlink.to and similar), keeping the bit.ly/b.link/tinyurl resolve-first rule only where a recipe blog
   is plausible. Decide the list from the corpus, not by guess.
3. **A total blog-probe budget plus a per-link timeout** (for example stop probing after N links or T
   seconds, and a per-link timeout well under 10 s), so a link-heavy description cannot hold extraction
   for more than a few seconds.

Any of these changes `acquire/` (not covered by the `POSTPROCESS_VERSION` guard, per its docstring), but
(2) and (3) change which blog is found, so they need the corpus replay and a check that no recipe that
today finds its blog stops finding it.

- Evidence: the phone runs in `abc-cook-s1-shots/phone/timing-*.json` (outside the repo) and the API log
  lines `finished ... stages={'acquire': ...}`; the investigation is
  `notes/investigate-extraction-speed/REPORT.md` (T8).
- Cost: ₹0 to investigate.
- First deploy (M5): deploy the API before the web, and check `/health` `postprocess_version` matches the
  web's stamp before switching traffic.

### FGC-15 (S3): output-token spread per recipe at `low` (n=3)

Measure the output-token spread per recipe at `low` with n=3, not only `minimal` vs `low`. Croissant
ended degraded on 2026-10-17 at `low`, and repair didn't fix it, though it was clean in the
investigation. One run per recipe can't tell a typical result from an unlucky one.

- Evidence: the 2026-10-17 croissant import at `low` (degraded); `notes/investigate-extraction-speed/REPORT.md`.
- Owned by PR-S3 (`docs/plans/pr-s3-strict-output.md` § 8): n=3 at low for kadhi and croissant,
  n=2 for chole. Chole also cites the earlier low runs (total_min 473 vs 909).
- **Measured by PR-S3** (output tokens per call): croissant low strict-off 2826–4021 (n=5), strict-on
  2990–3805 (n=5, plus 3768 on the first call); croissant minimal 2327–2435; kadhi low 2714–3496
  (strict on), 3735 (off, n=1); kadhi minimal 2566–2758; chole low strict-on 4757–5545 (n=2);
  pumpkin low 2168. Explicit nulls under strict did not raise output. Cost per call ₹0.4–1.0.
  Croissant's repair-would-fire was 3/5 strict-off and 4/6 strict-on before PR-S3's two fixes and
  0 after: the cause was a label on the final step (FGC-29 is the non-final cousin).

### FGC-16 (R5 at the latest): "Plan simplified" visible without scrolling

Check that the "Plan simplified" notice is visible without scrolling at 360 × 697. Do this in R5 at
the latest.

### FGC-17 (M5): cold-start pre-warm

The first import on a fresh process spent 74 s in `extract`, a one-time cost of importing the
provider SDK. Pre-warm at startup, so the first cook after a deploy or a scale-up doesn't pay it.

### Competitor note: ReciMe web (black-box HAR, 2026-10-16)

- Fresh imports take 8.5-13.6 s server-side and 12.6-17.2 s to the recipe page.
- No cache (`cached: false` x3), no streaming: one blocking POST.
- Step output is about 230-420 tokens.
- Hindi ingredients came back with garbled Devanagari.
- Per-user duplicate detection: a repeat import returns HTTP 208.

### FGC-9: measurements on this corpus (no action)

- F7 (the `after|once` window swallowing a `for N` duration): **0 instances** across the four plans and
  the chole transcript. The corpus gives no evidence either way.
- fix-3 (`_drop_tasks_with_unclaimed_ancestors`): **0 dropped tasks**, **0 vanished windows** (F2) with
  the function replaced by identity in a scratch script.
- Long waits: croissant has 3 hands-free breaks of 60 min and its plan-ahead card reads "Start ~4 hr 45
  min before you want to eat" (elapsed 256-282 min). All recipes are one sitting. The chole overnight
  soak and dough-rest cases are not measurable without a chole plan (the video says 6 hours, not
  overnight).

### FGC-10: market scope and the next corpus round

Market scope (owner, 2026-10-16): India first, then US, UK and Europe; languages English and Hindi
first, other common ones later. What to track:

- **FGC-1 length vs language:** the next capture round needs one long English video to tell them apart.
- **Units:** sources use metric, US customary (cups, oz, degrees F) or both ("1 cup (200 g)"). Quantities
  and scaling keep the source's system and never silently convert. Input for R3 and R4.
- **Next corpus round:** a second Hindi video (after the FGC-1 fix) and one long English video. A
  European-language video comes later, once Europe is in scope.

### FGC-18 (before M5): YouTube caption 429 silently drops the transcript

Seen 2026-10-17 during the S1.5 bench: YouTube's caption endpoint answered 429, `transcript.fetch_segments`
retried (about 7 s in total), then gave up. The import continues with no transcript and the cook is not
told; the only trace is an `acquisition_warnings` entry that nothing shows. Every AFTER row with a caption
track lost its transcript this way.

Decide before M5 whether this should surface as degraded/unavailable (the cook is told the recipe was read
without the spoken method), or retry later. Related: live benches burn YouTube quota, and the 429 appeared
between two back-to-back bench runs. Prefer probe-only runs (no yt-dlp, no captions) for anything that does
not need YouTube.

### FGC-19 (PR-S2): a mid-stream extraction failure's spend is unreported

When a streamed extraction call stalls or drops mid-stream, no final usage chunk arrives. The call carries
`usage=None`, so `import cost:` under-reports that job. Decide whether to log the characters received as a
lower bound. Usage is never estimated (`CallUsage` rule).

### FGC-20 (PR-S2): "ingredients ≤ 15 s" misses when the probe stage hits its cap

Chole and captions-manual-en spend the full 10 s probe stage, so acquire takes ~14 s. Ingredients then land
at ~22 s even with streaming. Candidates:

- lever 9, parallel acquisition;
- start extraction before probing finishes when the description has no recipe-like link.

PR-S3 result (`minimal` effort, strict on): first ingredient from paste (6 s acquire + call) was
7.7–8.2 s on croissant and 8.3–9.6 s on kadhi, against 14–20 s at `low`. But `minimal` fails the
quality floor on kadhi (degraded 2/3, edge recall 0.43–0.58 vs 0.83–1.0 at low; see FGC-12), so
effort stays `low` and the remaining gap lands here. At `low` the first-ingredient wait today is
12–20 s from paste with strict on and 15–26 s with it off, and provider latency drifts by several
seconds between days.

### FGC-21 (PR-S2): the draft's step text can state a time the plan later changes

Draft steps are the model's step text, which can carry the source's own "fry 5 min". If verification changes
that duration (FGC-11-like), the draft and the validated plan disagree. Measure how often this happens on the
corpus.

### FGC-22 (S3): strict JSON output changes the stream

S3's strict output mode may change key order or chunking. Before S3 merges, re-verify:

- `DraftScanner`'s assumptions: `ingredients` before `steps`, and `text` first in a step;
- the replay texts.

Owned by PR-S3 (`docs/plans/pr-s3-strict-output.md` § 6). The scanner already ignores key order
within a step and ignores whitespace. Replay texts are `model_dump_json()` (every key, schema
order), so they are regenerated only if live strict output has a different key sequence.

- **Resolved by PR-S3.** In all 24 live raw texts (strict on and off) the top-level, ingredient and
  step keys equal schema order, `ingredients` precede `steps`, and `text` is first in every step;
  `DraftScanner` fed char-by-char and in the recorded chunking equals the final parse and was never
  `broken`. The replay texts need no regeneration. Two captured strict raw texts (kadhi, croissant)
  are committed as scanner fixtures under `tests/fixtures/stream/`.

### FGC-23 (PR-S2): a long reasoning silence ends as `unavailable`

At `low`, a reasoning silence longer than `STREAM_IDLE_TIMEOUT_S` (60 s) has never been measured (max ~16 s).
If one happened, the job would end as `unavailable`, not `incomplete`. Revisit if S3 or FGC-12 changes the
extraction effort.

Owned by PR-S3 (`docs/plans/pr-s3-strict-output.md` § 6). The bench records first-content
silence and the max inter-delta gap per call, with the first call on a new strict schema reported
separately. The guard test becomes ≥ 3 × the observed max.

- **Resolved by PR-S3.** Max first-content silence over 24 calls was 19.3 s (a strict-off croissant
  call), then 15.6 s, with strict-on at most 13.8 s; max inter-delta gap 0.3 s. The first strict
  call (a new schema) was 13.8 s, no slower than strict-off calls the same day, so no first-schema
  penalty showed. `STREAM_IDLE_TIMEOUT_S` stays 60 s. The guard test is `>= 3 * 19.3`: the STOP A
  decision said 15.6 s (the max of the first 19 calls), but the later replication call reached
  19.3 s, so the guard cites the real max. 3 × 19.3 = 57.9 s is under 60 s, but only just; revisit
  the bound if a silence over 20 s is ever seen.

### FGC-24 (M5): the "Your plan is ready" tap

PR-S2 hands off on a tap, not automatically. In M5, measure ready→tap time and abandonment on the reading
screen.

### FGC-25 (R3): the model's `qty` sometimes already contains the unit

In the frozen chole-bhature output, 23 of 36 ingredients have a `qty` that already ends with the unit
(`qty: "1 cup"`, `unit: "cup"`). Shown as `qty` then `unit` this read "1 cup cup" on the reading screen
(and, through `qty_text`, on the recipe page). PR-S2b hides the repeat at display time with `joinQtyUnit`
(`apps/web/src/lib/quantity.ts`). That is a mask, not a fix: `_parse_qty` and the stored `unit` still carry
the duplicate. Fix at the source in R3's `_parse_qty` work: strip a trailing unit from `qty` (or null `unit`)
when they repeat, and decide whether `qty_text` keeps the model's wording. Re-run the goldens when it lands.
Since FGC-42 the cooking-mode chips mask it too, through the same `joinQtyUnit` the tab uses.

### FGC-26 (docs): `DESIGN_SYSTEM.md` does not describe the Home reading screen

PR-S2b ships the import reading screen on the Home ground, but `docs/DESIGN_SYSTEM.md` has no section for it.
Add one covering:

- the reading screen: header (16:9 thumbnail frame, channel 13/400, title 22/30), and the two deviations from the
  spec: a 16:9 frame instead of the 4:3 card, and no platform badge yet (decide whether to add one), Ingredients, Steps, "About this video";
- the "Draft" pill beside the Ingredients and Steps headings, and when it shows;
- the sticky "Your plan is ready" button and the "Close" control;
- the A2 failure layouts (failure slot above the draft);
- pressed and focus states: there are no pressed styles on the reading screen, and focus is the browser's own
  `:focus-visible` ring (not suppressed; checked on "Your plan is ready", "Close" and "Try again").

Owner decision to record there: whether the ring should become a terracotta `:focus-visible` ring app-wide.

### FGC-27 (after S3): prompt v8, measured on its own

PR-S3 keeps the prompt byte-identical, so the strict on/off A/B isolates strict output. Deferred
here, to be measured as a separate model-facing change:

- remove the pasted JSON Schema when strict output carries it (about 3,000 prompt tokens);
- drop or tighten `v7.md`'s "small min/max spread" duration rule (the FGC-11 root cause on the
  model side);
- fix `v7.md`'s `duration_typical`, which should be `duration_typical_min`;
- any instruction found under PR-S3 amendment A2 that conflicts with all-required output. The one
  found is `v7.md:197`, "Leave `depends_on_previous` at its default; it is a legacy field": under
  strict the model must emit a value, and it emitted `false` on 25 of 175 steps (14%) vs 4 of 50
  (8%) strict-off; of the 11 strict-on steps with no explicit `depends_on_steps`, graph.py kept 3
  independent and forced 8 sequential.

**Not bundled with FGC-3/4 (2026-10-18).** `fix-fgc-345-quality.md` PR 2 ships prompt v8 with the
FGC-3/4 deltas only, so its A/B isolates them. These items become prompt v9, measured on their own.

### FGC-28 (PR-S3): strict structured output — resolved: ships on

PR-S3 built strict output (`ABC_COOK_STRICT_EXTRACTION`, a `response_format` with the strict
schema; the prompt is byte-identical) and measured it on 29 live calls (₹16.84). The owner's rule
was applied after PR-S3's two post-processing fixes, first on 24 calls (pumpkin failed at n=1 per
arm), then with pumpkin at n=3 per arm. Final numbers:

- a. croissant repair-would-fire, on 0/5 vs off 0/5 (n=5 each, excluding the first strict call): pass;
- b. croissant edge agreement: cross on×off 0.834 (25 pairs) vs within-off 0.842 (10 pairs), so
  0.834 ≥ 0.842 − 0.05: pass (within-on is lower, 0.728);
- c. stated-floor violations with F11-a on: 0 in both arms: pass;
- d. kadhi no worse (repair 0/3 vs 0/2; edge R/P 0.92/0.89 vs 0.69/0.74): pass; pumpkin no worse
  (n=3 per arm): repair-would-fire 1/3 on vs 2/3 off, floor violations 0 and 0, edge recall/precision
  1.0/0.87 on vs 0.87/0.77 off: pass. The earlier fail was one strict-off pumpkin run (the frozen
  run from the speed investigation, precision 0.75) against one strict-on run (0.60); pumpkin's
  per-call precision ranges 0.5–1.0 in both arms, so n=1 was noise.

Gain: first ingredient about 3–6 s earlier at `low` (croissant 10–14 s vs 15–20 s, kadhi 8–12 vs
15 s) and steps-complete 5–20 s earlier; +2,447 input tokens per call; no output increase; no
unparseable response in either arm. The kill switch is `ABC_COOK_STRICT_EXTRACTION=0` (or `false`,
`off`); off sends the request byte-for-byte as before. Evidence: `notes/pr-s3-strict-output/`
(`stop-a.md`, `produces-consumed.md`, `rescore.out.txt`, `results.md`).

### FGC-29 (PR-S3): a label produced at a non-final step that nothing consumes

Kadhi at `minimal` (calls 6-0 and 6-1) labels step 1 of 9 with `produces_component` and no later
step names it, and not every later node depends on it, so invariant 6 fires. `produces_consumed` is
in `REPAIRABLE_RULES`, so a Sonnet call is made, but `StepRepair` cannot clear a label (omitted
means unchanged, and only an empty-string replacement would drop it), so repair almost never
resolves it and the plan degrades to a linear chain. PR-S3 fixed only the final-step case (nothing
later can consume it). Consider a generic drop for a label no node consumes whose siblings carry no
dependency on it, or a repair hint that allows clearing the label. Record only; not changed.

### FGC-30 (FGC-3 PR 2): the Map view shows no "added" marker

Added steps are labelled on the Plan, in cooking mode and in the streamed draft. Before PR 2's code,
check whether `apps/web/src/map/` is reachable by users:
- if it is, PR 2 labels added steps there too, and this item closes;
- if it is dead code, this stays a follow-up. A Map marker is new visual grammar, so it needs a
  render checkpoint.

### FGC-31 (P3): lead times anchored to anything other than serving

FGC-5's fix covers a hands-on step's "N before serving / eating" only. "Take the butter out 1 hour
before baking" or "marinate 2 hours before cooking" on a hands-on step is still dropped as an
offset. This generalises F1 in `followup-offset-not-duration.md`.

### FGC-32 (P3): a tip that is not a step stays a required step

Cupcakes: "Powdering the sugar will make the creaming easy" is advice, but its wording carries no
optional/alternative marker, so it stays a required "Powder sugar" step. "Note:" / "Tip:" were
deliberately not added as markers: a "Note: soak overnight" demoted to a tip would drop a required
wait.

### FGC-33 (metric only): the incomplete-method gap check has false positives

The check flags an unattended step that consumes ≥ 2 non-staple raw ingredients no hands-on ancestor
touched. It fires on cupcakes but also on add-and-simmer shapes (`synthetic-two-windows` "simmer
stew": lentils + stock). It is a bench metric in FGC-3 PR 2, not user copy. Revisit before it is
ever surfaced to users.

### FGC-34 (FGC-3): when most of a method was added

The owner chose no cap on added steps (2026-10-18), so cupcakes can get more added steps than source
steps. Log the per-import added count. Consider a recipe-level line when added steps ≥ source steps.

### FGC-35 (P3): the stated-total tolerance compares against the serial sum

`build_graph` drops the source's stated total when the serial sum of typical durations is more than
40% off it. The cook's elapsed time is the honest comparison. Kadhi after FGC-5: the source says 45
min, the serial sum is 70 (dropped), the elapsed time is 62 (would pass the 40% rule). Fix later,
generic.

### FGC-36 (P2, scheduler): "immediately" / "just before serving" steps are not scheduled late

A finishing step whose text says "immediately" or "just before serving" should be scheduled as late as
possible before the sink. Kadhi's "Make tempering" ("immediately pour this tempering") sits in the
wait window at 51-53, then waits about 8 minutes for Serve at 61. It already started at 51 before
FGC-5's fix. Scheduler change, separate PR.

### FGC-37 (P3, web copy): the hands-off button on waits and rests

The cooking-mode button on a wait or rest step reads "I've started it". For a timed wait it should
read like "Start 10-min timer". Kadhi's "Wait before serving" is the instance.

### FGC-38 (P3, web): the step counter advances when a hands-off step starts

In cooking mode "Step N of M" counts finished plus running steps, so starting a hands-off step moves
the number on (Cook kadi: "Step 3 of 12" to "Step 4 of 12"; kadhi's wait: 10 to 11). It is the
existing live-count behaviour, not specific to the derived wait node. Decide whether a started step
should keep its own number.

### FGC-39 (P3, FGC-4 follow-up): a later serving way can stay required and chain

A later serving way whose cue is a grounded optional phrase but not in the attach target's own text
stays required and chains (borrowed-cue rule CP2 6.2b). Seen in the demoted-attach-target test
(`tests/test_added_steps.py`, documented as today's behaviour). Candidate fix: honour when the cue is
marker-bearing, grounded, `attach_to_step` points at an honoured step, and the cue equals or is
grounded in the target's `role_cue`. Separate ₹0 PR with a golden re-check; only if the FGC-3 PR 2
A/B shows it recurring.

**Recurring (PR 2 A/B, 2026-10-18):** 3 of 6 pumpkin runs (A2, B2, B3) hit it, each with the later
way attached to the cooking step rather than to the first way.

### FGC-40 (P2): cupcakes-style imports degrade on ingredients_consumed

A method with no mixing steps (the vanilla-cupcakes shape) degraded in 6 of 6 runs at `low` + strict,
both arms (7-9 `ingredients_consumed` violations each: the model lists ingredients no step consumes).
In production each such import pays a Sonnet repair call and, if that does not resolve it, falls back
to the linear plan. Before M5: check what the real repair returns (₹ and the resulting plan) on one run.

### FGC-41 (P2, measurement): prompt v8 was not neutral

The v8 A/B (n=3 per arm, `notes/fgc-345/summary.md`) showed, with no added step anywhere: kadhi
repair-would-fire 2/3 vs 0/3 (`produces_consumed`); cross-arm edge agreement below the within-A mean by
0.13 on croissant and 0.10 on pumpkin; `depends_on_previous=false` choices 9 to 17. Small n, so partly
noise, but v8 is off by default for this reason too. Any future prompt change re-measures all three.

### FGC-42 (P3, web): chips repeat a glued unit and print "to taste salt"

The F2 chips (`cooking-mode/quantity.ts`) join `qty_text`, `unit` and name without `joinQtyUnit`, so
a `qty_text` that already ends with its unit reads "1 cup cup chole" (the FGC-25 shape; 23 of 36 lines
in the frozen chole output). The to-taste special case fires only on `unit === 'to taste'`, so an
imported `qty_text` "to taste" reads "to taste salt" (pinned in `quantityLine.golden.json` for kadhi and
sabudana). R3 keeps factor-1 output byte-identical, so the fix is its own small PR. It must land
before or inside R4: at factor != 1 the chips would show "⅔ cup cup chole".

**Status (2026-10-19): done.** Plan: docs/plans/fgc-42-chip-quantity.md. The chips and the Ingredients tab
now build their amount text with one function, `quantityTrailing` (`lib/quantity.ts`). A bare "to taste"
puts the name first ("salt to taste"); a doubled unit is dropped. Three golden lines were hand-edited.
Web only: no API change, `POSTPROCESS_VERSION` stays 14.

### FGC-43 (R4 input): second amounts and package sizes are unscalable

11 corpus lines carry a second amount in `unit` ("Cup (200g)", "cups (190 g)" in cupcakes; "gms / ½ cup",
"ml / ¾ cup" in dal makhni), and 3 in `qty_text` ("5 tbsp (50g) for dough and …", "1 tbsp + 1 tsp",
"¼ cup or 45"). Package sizes (a measure unit followed by a container word: "15 oz can") are the same
case. R3's `parse_amount` marks all of them unscalable; they show the source text at any factor. R4
decides how an unscaled line is shown. 0 corpus g/ml lines are scalable (all dual-unit). R4 needs a
visible "not scaled" marker per line and should report the share of scalable lines per recipe.

### FGC-44 (P3, fixtures): chips print a legacy float where the tab prints a fraction

On hand goldens with no `qty_text`, chips use `String(qty)` ("1.5 cup water", maggi; "1.5 l", donuts)
while the Ingredients tab uses `formatQty` ("1 1/2 cup"). Production imports always carry `qty_text`, so
only fixtures show it. R3 keeps both fallbacks as they are.

Since FGC-42 the fix is one argument: `quantityPhrase` passes `formatNumber: legacyNumber` to
`quantityTrailing`. Dropping it switches the chips to `formatQty` and changes two golden entries (maggi
`boil_water`, donuts `heat_oil`).

### FGC-45 (FGC-6 addendum): Hindi number words as quantities are unscalable

आधा, डेढ़, सवा, ढाई (and Hinglish "paav", "sawa") as quantities are not parsed by R3's `parse_amount`: the
line is unscalable and shows its source text. The corpus has 0 such ingredient lines (the chole model
wrote digits). Parse them with FGC-6, which owns Hindi number words.

### FGC-46 (R4 input): hand goldens cannot demo scaling

Hand-authored goldens are loaded, not built, and most have no `qty_text` (sabudana has it), so their
`qty_amount` is null and `scaleQuantity` leaves them as written. R4 screenshots need a recipe built through `build_graph`
(an `ImportOriginal` fixture such as the widened-corpus recipes), not a hand golden.

### FGC-47 (P3, web): the Ingredients tab has no handful rule

The chips drop an amount the name already starts with ("A handful of fresh coriander leaves" with
`qty_text` "a handful" reads "a handful of fresh coriander leaves"). The tab has no such rule, so the same
line likely shows the amount twice: the name, then "a handful" in the trailing column. Evidence: a scan of
every ingredient in the 14 `__fixtures__/*.plan-response.json` for a lower-cased name that equals or starts
with its `qty_text` found 0 hits (the two API graph fixtures that say "handful" use `unit: "handful"`, not
the amount-in-name shape). Only the synthetic chip test reaches it. Not fixed in FGC-42; if it matters, pass
an `omitAmount` rule from `panelIngredientGroups` to `quantityTrailing`.
