## PR-S3: strict structured output (on by default), two post-processing fixes, measurements

Plan: `docs/plans/pr-s3-strict-output.md` (the "STOP A decisions" and "Results" sections win over the plan body).

### What changes

- **Strict structured output, on by default.** The extraction request gains a `response_format` with the strict schema (`strict_json_schema`, pinned to the SDK's own transform by a parity test). The prompt and the pasted schema are untouched. `ABC_COOK_STRICT_EXTRACTION=0` (or `false`/`off`) turns it off, and off is **byte-identical** to the pre-PR request in both the stream and blocking paths (dump diffs in `notes/pr-s3-strict-output/request-dumps/`; a test pins it). Over 29 live calls it brings the first ingredient about 3–6 s earlier at `low`, +2,447 input tokens per call, no output increase, no unparseable response in either arm.
- **Final-step label drop (`graph.py`).** A label on the last step can never be consumed and repair cannot fix it, so it cost a wasted Sonnet call and a linear degrade. It is now dropped with a WARNING. Croissant repair-would-fire went from 3/5 (strict off) and 4/6 (strict on) calls to 0.
- **Stated floor (F11-a, `graph.py`).** A time the source states is the least that step takes: `duration_min` is raised to the stated low end, capped at the typical. The max keeps its headroom. Goldens are byte-identical after regen; fixture changes are `duration_min` only (cupcakes preheat 9→10; pizza 4→5 and 55→60; dal makhni 1→2 and 28→30), each raised to the phrase stated in its own text. No on-screen number changes (the scheduler never reads `duration_min`; the web uses it only for the `~Nm` countdown when max − min > 15, which nothing crosses).
  - The kadhi golden's 28/30/32 did not change because the floor needs exactly one grounded plain duration expression in the step's own text, and that step says "let it cook for half hour", which `_duration_expressions` does not parse (FGC-6). With no grounded expression the branch does not fire, and the claim is treated as an estimate (provenance `inferred`), so the model's 28 stays.
- **Request errors.** A non-infra 4xx (a rejected request) now ends `failed/unavailable` with a WARNING and no retry. Before, it ended as `method_not_grounded`. 429 and 5xx stay infra.
- **Refusals.** New `ImportFailure = "refused"` (no retry, never Tier 0), with the web copy "We couldn't read this recipe." and "Paste the recipe text, or try another link." Reachable with strict on.

### The strict default and how it was decided

The owner's rule: strict ships on only if, after both fixes, (a) croissant repair-would-fire on ≤ off, (b) cross on×off edge agreement ≥ within-off − 0.05, (c) zero stated-floor violations in either arm, (d) kadhi and pumpkin no worse. Result: a 0/5 vs 0/5; b 0.834 vs 0.842; c 0 and 0; d kadhi repair 0/3 vs 0/2 with edge R/P 0.92/0.89 vs 0.69/0.74, pumpkin (n=3 per arm) repair 1/3 vs 2/3 with edge R/P 1.0/0.87 vs 0.87/0.77. All pass. An earlier n=1 pumpkin comparison had failed on precision (0.60 vs 0.75), which is why the default briefly shipped off; n=3 showed that was noise. See FGC-28.

### Decisions recorded

- Effort stays `low`: `minimal` gets the first ingredient 8–10 s from paste but fails the quality floor on kadhi (FGC-12, FGC-20).
- `STREAM_IDLE_TIMEOUT_S` stays 60 s; the guard test is 3 × 19.3 s, the highest silence seen. The margin is thin (57.9 s vs 60 s): revisit if a silence over 20 s is ever observed (FGC-23).
- `POSTPROCESS_VERSION` 10 → 11 (one new history entry; its hash was refreshed as this PR's commits landed).

### Spend

₹16.84 over 29 live calls (rows 1–9 ₹11.76, croissant replication ₹3.01, pumpkin check ₹2.07). Repair was never called (Anthropic key invalid in the bench process).

### Follow-ups

FGC-29 (a non-final label nothing consumes), FGC-27 (prompt v8: the pasted schema, the duration-spread rule, `v7.md:197`), FGC-20 (the remaining first-ingredient gap), FGC-13 (the 13% unparseable rate did not reproduce).

### Test plan

- [x] `pytest apps/api -m "not llm and not network"`: 1545 passed, 14 deselected (baseline 1489)
- [x] `ruff` on changed files, `mypy --strict` on `schema/` and `schedule/`
- [x] `tsc -b` and Vitest in `apps/web` (1072 passed)
- [x] `stream_draft_bench.py` (₹0 replay) re-run
- [ ] Not run: any device or deploy check (out of scope)

The raw per-call JSON for the live runs is not committed; `notes/pr-s3-strict-output/results.md` has the tables.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
