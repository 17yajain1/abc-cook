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

### FGC-1 (P1): a long Hindi transcript exhausts the output budget on reasoning, returns Tier 0, and is misdiagnosed

Chole bhature (FU1ZVLMbWjA, 13:14, Hindi auto transcript of 11,602 chars, 3 ingredient groups):
`reasoning_tokens = 16000`, `output_tokens = 16000`, no visible output, 1 truncation, 141 s,
INR 2.75. The pipeline stopped without escalating and returned Tier 0 `method_not_grounded` with the
warning "Extraction output looked like a runaway generation after truncating at 16000 tokens (repeated
or missing steps)". That wording is wrong: nothing repeated; the whole budget went on reasoning. The
recipe the product most needs to handle (long, non-English, multi-group) gets no plan at all.

- Evidence: `apps/api/tests/fixtures/import/known-wrong/chole-bhature.raw.json`.
- Competitor note: ReciMe imports this same video in ~10 s (owner recording, 2026-10-16), so it is
  achievable.
- To decide: is the failure length or language? It needs one long English video in the next capture
  round (see FGC-10). Options to evaluate then: a larger budget or lower reasoning effort for long
  sources, and a truthful warning when `reasoning_tokens == output_tokens`.

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
