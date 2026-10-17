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
- **Owner decision pending:** (a) flag "method incomplete", or (b) fill standard steps, labelled
  "added by ABC Cook, not in the source". Competitor ref: Copymenu fills gaps silently; ReciMe turned
  the notes into steps.

### FGC-4 (P2): notes and alternatives become steps

- Cupcakes: "Butter can be replaced with 1/2 cup vegetable oil" became a required hands-on step
  ("Use oil instead") scheduled after Bake. It is a substitution note; the alternative grounding failed
  because the cue is not a marker.
- Pumpkin pancakes: two alternative toppings became "Serve classic" then "Serve with chips", chained
  (the second depends on the first). The optional/alternative grounding failed on the cue "two different
  ways to eat these pancakes".
- Evidence: `known-wrong/vanilla-cupcakes.original.json`; `pumpkin-pancakes.original.json`.
- `pumpkin-pancakes` carries FGC-4 in `known_issues`.

### FGC-5 (P2): "N minutes before serving" is not honoured

Kadhi pakora: the source says "10 minutes before serving add pakora to the kadi". The plan puts Add
pakoras at t=50 and Serve at t=53, so the pakoras sit in the kadhi about 3 minutes, not 10. A lead time
on a hands-on step is dropped (this is F1 in `followup-offset-not-duration.md`: no minimum-start-gap
modelling), now with a real instance. The honest fix is a product/scheduler decision.

- Evidence: `kadhi-pakora.original.json`. `kadhi-pakora` carries FGC-5.

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

### FGC-12 (P2): run-to-run noise at low is large and the quality comparisons are n=1

Same recipe, same settings, two runs: chole at `low` gave `total_min` 473 vs 909 and stated durations
[5, 360] vs [6, 10, 360, 360]; pizza at `low` differed in edges (recall 0.33, node recall 0.7). The
quality cells in the speed investigation are therefore n=1 and cannot certify "edges and stated
durations unchanged" for any effort level, including today's. Wanted before M5: `minimal` vs `low`
at n=3 on the corpus, scored on edges, stated durations and tier.

- Evidence: `notes/investigate-extraction-speed/REPORT.md` (T7).

### FGC-13 (P2): about 13% of full calls need an unparseable-response retry

2 of 15 full runs (croissant at minimal, pizza at low) returned unparseable output and were retried:
+18-24 s and about 2x the cost (pizza INR 1.43 vs 0.66). The cause is unknown because `raw_text` is only
kept on truncations (`openai.py` returns `ExtractResult(recipe=None, error=...)` with no text on a parse
failure). Fix: capture the raw text (and `finish_reason`) on a parse failure before changing anything.

- Evidence: `notes/investigate-extraction-speed/REPORT.md` (T2, rows with 2 calls).

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
