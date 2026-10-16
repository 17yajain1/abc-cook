# Known-wrong import evidence

These are real captures (2026-10-16, GPT-5-mini extraction at production effort, Sonnet repair)
whose output is **wrong**. They are kept as evidence for the follow-ups in
`docs/plans/followup-golden-corpus.md`. **They are not goldens**: no test replays them, no
`replay-expected.json` exists, and nothing pins their output. Do not "fix" a test by freezing them.

## `vanilla-cupcakes.raw.json` + `vanilla-cupcakes.original.json`

Source: YP8a6ugKQ6Y (The cookbook, 3:54). No captions, no blog; the description has an ingredient
list and one method line ("preheat 10 min ... 180 C for 20-25 min") but **no method steps**.

The pipeline returned a clean 4-step plan: powder sugar, preheat, bake, "use oil instead". Every
step is grounded in the description (nothing invented), but **no step makes the batter**, and the
butter-to-oil note is scheduled as a required hands-on step after Bake. Servings defaulted to 4
although the source states a yield of 18-20.

- FGC-3 (incomplete method presented as a complete plan)
- FGC-4 (notes/alternatives become steps)
- FGC-8 (stated yield ignored)

`.original.json` is the `ImportOriginal` taken from the capture's `result.json`; `reprocess()` of it
reproduced that result exactly.

## `chole-bhature.raw.json`

Source: FU1ZVLMbWjA (CookingShooking Hindi, 13:14). Auto `hi` Devanagari transcript (11,602 chars),
Roman-Hinglish ingredient list in three groups (chole / bhature / chole masala).

The extraction call returned nothing usable: **reasoning_tokens = 16000, output_tokens = 16000, no
visible output**, one truncation, 141 s, INR 2.75. The pipeline stopped without escalating and
returned Tier 0 (`method_not_grounded`) with the warning "Extraction output looked like a runaway
generation after truncating at 16000 tokens (repeated or missing steps)". The telemetry says the
whole output budget was spent on reasoning, not on repeated output. There is no `original` (Tier 0
has none), so there is only the raw acquisition.

- FGC-1 (reasoning exhausts the output budget on a long transcript; misdiagnosed)
- FGC-6 (Devanagari number words such as पांच, सेवन are not parsed)
