# Plan: an offset is never a step's duration

**Status:** approved plan, not implemented. Written 2026-10-15 against `origin/main` @ 6968f4a.
**Spec:** `docs/plans/followup-offset-not-duration.md`. **Branch:** `fix/offset-not-duration`.
**Worktree:** `C:\Users\ashya\Music\abc-cook-offset-duration`.

## Context

`_duration_expressions` (`apps/api/abc_cook/extract/graph.py`) reads any number + unit as a
duration. "After one hour, mix the dough" contains "one hour", but that hour says *when* to
start the step, not how long the step takes. PR-C (D5) guards only Hindi units followed by
बाद/baad/पहले/pehle. English has no guard, and this blocks Hindi number words. Under the
principle "a missing time is acceptable; a wrong stated time is not", an offset must never
make a step's duration stated, and must never ground one.

## 1. Where offsets leak today (traced on origin/main)

Durations become "stated" (`duration_source = "extracted"`) in one place:
`_verify_duration` → `_resolve_duration`. Every path into it:

| # | Path | English offset gets through? Concrete example (today) |
|---|---|---|
| P1 | **Verifier promotion.** When exactly one plain grounded phrase is in the step text, `_verify_duration` sets `stated=True` and clamps typical into it, whatever the model claimed. | **Yes, the worst one.** English source "After one hour, mix the soaked sabudana once." with model 2/3/5 and `duration_stated=False` comes out as **stated (2, 60, 60)**. This is the "Stir once became a stated 60-min step" from the spec. |
| P2 | **Model claim passes through** when the step has ≥2 plain grounded phrases: no branch downgrades, and values are untouched if typical matches either one. | **Yes.** "After 10 minutes, simmer for 5 minutes." with model stated typical 10 stays stated 10, with no warning. The same happens for "Simmer for 30 min, stirring every 5 minutes" with model 5. |
| P3 | **Corpus-side grounding.** The corpus is parsed with the same function, so an offset in the source grounds a paraphrased step duration. | **Yes.** Source "After 5 minutes, flip." and step "Cook for 5 minutes, then flip." (stated) are grounded today. |
| P4 | **Per-side floor** uses the same plain list as its base. | Yes, indirectly. An offset can lower the floor base. |
| P5 | **Hindi guard scope.** `बाद`/`baad` is checked only after a *Hindi* unit. | **Yes for Hinglish:** "5 minute baad" (romanized caption) is parsed as a 5-min duration. |
| P6 | **Attention cue** (`_verify_attention`): any substring of the source is accepted, and numbers are never read. | Not a duration path. But "After one hour" is a valid substring, so it could make a hands-on step `unattended` and therefore a wait window. **Not fixed here.** Follow-up F3. |
| P7 | **`stated_total_min`** is a recipe-level LLM claim, only range-checked (invariant 8). | Not a step duration. "Rasmalai in 30 minutes" titles. **Out of scope.** Follow-up F4. |
| P8 | **Model numbers kept as estimate.** When `stated` is false, `_resolve_duration` keeps the model's own numbers as `inferred`. | No stated leak. A wait is never invented here, because windows come only from verified attention. A model 60 on a hands-on "After 1 hour, mix" would stay an *estimate* of 60. No fixture shows it (the real sabudana import gave no numbers, so it was defaulted 2/3/5). Follow-up F2. |
| — | `corroborate.py` (advisory, never writes durations), `provenance.py` (copies graph.py's decision), `validate.py` (ordering only), the prompt (unchanged; still one LLM call). | No. |

The fix closes P1–P5 at the parser, so all of them close together, because every path reads
`_duration_expressions`.

## 2. Patterns: one rule for English and Hindi

Each duration match gets a role, checked in this order:

1. **Offset (always dropped), by preceding words.** `after N`, `in N`, `within N`, `every N`
   (interval), `at N`, plus `after|once` + 1–3 words + N with no clause punctuation between
   ("after soaking for 1 hour", "once rested 1 hour"). An optional hedge may sit between the
   marker and N: about, around, approximately, approx., roughly, nearly, another, a further,
   some.
2. **Duration, by `for` framing.** `for N` (with an optional hedge) is a duration even when
   "before"/"after" follows: "Refrigerate for 2 hrs before serving" = 120 min,
   "Fry for 2 minutes before adding" = 2 min.
3. **Offset (always dropped), by following word**, for any unit and any language:
   `N later`, `N after`, `N into`, `N baad` / `N बाद`.
4. **Lead time (conditional)**, by following word: `N before` / `N pehle` / `N पहले`.
   Owner decision: this is a stated duration **only when** the step's *verified* attention
   is `unattended` or `periodic` **and** the phrase is in that step's own text. In that case
   the lead time is the wait itself (pizza: "Remove the dough 1 hour before using to let it
   relax"). On a hands-on step it is always an offset ("add garlic 2 minutes before the
   end"). A lead-time phrase in the corpus grounds **only** a lead-time phrase in the step,
   never a plain one. Without that rule, a neighbouring step's "1 hour before" could ground
   "rest 1 hour".
5. **Duration:** everything else, unchanged. That covers bare N, ranges N–M / N to M /
   N से M, `up to N` (ceiling, unchanged) and per-side.

Ambiguous cases fall on the safe side (offset): "in 3–4 min" ("milk curdles in 3–4 min"),
`at N`, and the `after/once …` window. The window is capped at 3 words because unpunctuated
auto-captions would otherwise reach a far-away "after". The scan showed rasgulla's "After 5
minutes flip … cook for 5 min" must keep its 5 min.

This replaces `_HINDI_OFFSET_MARKERS` / `_HINDI_OFFSET_RE` / `_DURATION_UNITS_HINDI`. Hindi
offsets now follow the same table as English: बाद/baad → offset (row 3), पहले/pehle → lead
time (row 4).

## 3. A step whose only evidence is an offset

- The offset is dropped. The step's text then has no usable duration phrase.
- A model claim of `duration_stated=True` is downgraded to an estimate. The warning reason
  becomes: *"but its only time phrase says when to start it, not how long it takes"*. Today's
  wording would wrongly say "no duration phrase".
- The model's own numbers stay `inferred`. If there are none, the kind default applies and
  the source is `defaulted`. The window-host clamp applies as today. **No wait is invented**:
  attention is untouched.
- **The previous step is not changed.** "After one hour, mix" implies a ~1 h rest *before*
  it. That is a minimum start gap, a scheduler-field and product decision
  (`COOKING_GRAPH.md` §4), and is logged as follow-up F1.

## 4. Implementation (graph.py only)

- `_DurationExpr`: add `lead: bool = False`.
- New closed lists, in the same style as `_CEILING_PHRASES`: `_OFFSET_PRECEDING_MARKERS`,
  `_OFFSET_HEDGES`, `_OFFSET_FOLLOWING_MARKERS` (later, after, into, baad, बाद) and
  `_LEAD_TIME_MARKERS` (before, pehle, पहले). Compiled into `_OFFSET_BEFORE_RE` /
  `_FOR_BEFORE_RE` / `_OFFSET_AFTER_RE` / `_LEAD_AFTER_RE`. Devanagari goes in via the Write
  tool, never a heredoc.
- `_duration_role(text, match) -> Literal["duration", "lead", "offset"]`, with the order from §2.
- `_duration_expressions`: skips `offset` and flags `lead`. Offsets are still never returned,
  so the existing बाद test stays unchanged.
- `_has_offset_phrase(text)`: used only to choose the warning reason.
- `_grounded_duration_expressions`: the corpus phrase must match `lead` (like `ceiling`).
- `_verify_duration(step, corpus, attention: Attention = "hands_on")` drops `lead` phrases
  unless `attention in ("unattended", "periodic")`. The default is the safe side.
  `build_graph` passes the already-verified `attentions[index]`.
- No schema, scheduler, prompt or web change.

## 5. Tests (synthetic, `tests/test_extract_graph.py`, new section "Offsets are not durations")

Parser (`_duration_expressions`):
- "After 1 hour, mix the dough." → [] (start of sentence); "Mix the dough after 1 hour." → [] (mid-sentence)
- "after one hour" → [] (word number); "After 10-15 minutes, stir." / "after 2 to 3 hours" → [] (ranges); "after about 10 minutes" → [] (hedge)
- "After 10 minutes, simmer for 5 minutes." → [5]
- "10 minutes later, add the peas." / "In 5 minutes it thickens." / "Stir every 5 minutes." → []
- "Simmer for 30 minutes, stirring every 5 minutes." → [30]
- "After soaking for 1 hour, drain." → []
- Known safe-side trade-off, pinned: unpunctuated "Once boiling simmer for 10 minutes" → [] (the after/once window wins over `for`, so it is an offset and not stated; see F7)
- "Refrigerate for 2 hours before serving." → [120, lead=False]; "Remove the dough 1 hour before using." → [60, lead=True]
- Unchanged: "Simmer for 5 minutes." → [5]; "Cook 3 to 4 minutes." → [3–4]; "up to 10 minutes" stays a ceiling
- Hindi: "1 घंटे बाद मिलाएं" → [] (existing, unchanged); "5 minute baad" → [] (new, P5); "5 मिनट पहले" / "1 ghanta pehle" → one `lead` phrase (**amended existing test**, because the owner's rule makes पहले a lead time, not an unconditional skip)

Verification (`_verify_duration`):
- Offset-only, model unstated 2/3/5, corpus has the offset → stays unstated, 2/3/5 unchanged (P1)
- Offset-only, model stated → unstated, with the new "when to start" warning
- "After 10 minutes, simmer for 5 minutes.", model stated typical 10 → typical 5, stated (P2)
- Step "Cook for 5 minutes." against corpus "After 5 minutes, flip." → not stated (P3)
- Lead time: unattended "Remove the dough 1 hour before using." → stated 60; hands-on "Add the garlic 2 minutes before the end." → not stated; Hindi equivalents of both (unattended "आटा 1 घंटे पहले निकाल लें" → stated; hands-on "लहसुन 2 मिनट पहले डालें" → not)
- Neighbour: unattended "Let the dough rest 1 hour." against a corpus whose only "1 hour" is "Remove the dough 1 hour before using." → not stated. Unattended "Let it rest." claiming stated 60 → not stated.
- `build_graph` test: a hands-on step 0 "Take the dough out 1 hour before baking." and an unattended step 1 "Let it rest." (stated 60). Neither node's provenance `duration` is `extracted`.
- Existing regressions pass unchanged: `test_hindi_offsets_never_ground_a_stated_duration` (all 3 rows) and `test_real_hindi_transcript_grounds_the_soak_and_nothing_it_shouldnt`.

## 6. Goldens and fixtures that read durations, provenance or warnings

Dry run, done in planning: the proposed rule was monkeypatched over origin/main in a scratch
copy and run over every fixture.

| Golden / fixture | Passes through graph.py? | Expected change |
|---|---|---|
| `tests/fixtures/*.graph.json` + `*.plan.json` (kadai-paneer, maggi-2min, chicken-biryani(+kitchen), homemade-donuts, strawberry-shortcake, synthetic-two-windows, synthetic-two-sittings, sabudana-khichdi). Read by test_schedule, test_summary, test_rollup, test_api_recipes, test_ingredient_group_golden | No. Static, loaded directly | None. Sabudana's "After one hour, mix…" node no longer *parses* a duration, but this file is never rebuilt |
| `import/pizza-dough.{normalized,raw}.json` → test_extract_replay, test_summary (1470 / 1430 / 60 / 55-70), test_extract_graph pinned edges | Yes | **None.** "1 hour before using" is lead time on a verified-unattended step and stays stated 60 |
| `import/dal-makhni-multibranch.{normalized.json,source_text.txt}` → test_extract_graph | Yes | None |
| `import/captions-*.raw.json` → real-Hindi-transcript test + 4 live tests | Yes (corpus) | None. The real-transcript test passes unchanged |
| `import/{blog-link-only,no-captions,full-method,partial-…,useless}.raw.json`, `recipe_pages/*.html` → acquire tests | No (acquisition only) | None. They contain offsets ("After 30 min…", "in 30 minutes") but are never replayed |
| `export_web_fixtures.py` → `apps/web/src/__fixtures__/*` (11 files; only pizza-dough and synthetic-defaulted-servings run build_graph) → select/engine/layout/PlanScreen/StageCard/derive/servings tests | Pizza and synthetic | None, byte-identical. The other 9 come from static graphs |
| `cooking-mode/quantityLine.golden.json` | Via fixtures | None |
| `fixtures/postprocess_versions.json` | — | **Append `"7": <hash>`** |
| `docs/investigations/*.json` | Captured, never regenerated | None (sabudana library re-verified: identical) |

Dry-run result: **zero output changes** in pizza, dal, synthetic-defaulted-servings and the
sabudana library re-verification. Full API suite under the rule: 1179 passed. The only
failures were the 5 live-LLM tests (no `OPENAI_API_KEY`) and the 2 intended पहले parse
amendments. Scan of all 82 duration phrases in 133 fixture texts: the rule removes the
rasgulla blog's "After N min" ×4, "in 3-4 min", "within 30 minutes", "Recipe in 30
minutes", dashi's "at around 5 minutes", the Hindi transcript's "4 मिनट बाद", and the
sabudana golden's "After one hour". None of these feeds a replayed step.

**If the implementation's dry run shows any change, STOP and report it before touching an
expected file.**

## 7. POSTPROCESS_VERSION

Yes. graph.py code changes, so `POSTPROCESS_VERSION` goes 6 → 7 in `extract/cache.py`. Run
`python tests/test_postprocess_version.py` and **append** `"7": "<printed hash>"` to
`tests/fixtures/postprocess_versions.json`. Never edit entries 1–6. The hash is known only
after the code is final.

## 8. Does this unblock Hindi number words? Yes (follow-up F5, not done here)

The role is decided on the match context, not on the number token. So once number words
are in `_DURATION_NUMBER_RE`, "एक घंटे बाद" is an offset (row 3) and "तीन से 4 मिनट" grounds
3–4. The follow-up needs:
1. Devanagari number words in `_DURATION_NUMBER_RE` and `_duration_number`, reusing
   `_HINDI_NUMBER_WORDS`.
2. Devanagari only at first. Romanized short forms (do, das, char, sat, tin, ek) collide with
   English words.
3. Boundary tests for matras.
4. Possibly the fraction words आधा / डेढ़ / ढाई (½, 1½, 2½ hours).
5. Its own POSTPROCESS bump.
6. The expected result: the sabudana "Cook … 3 to 4 minutes" step becomes stated on a real
   re-import, which is a reviewed golden change in that PR.

## 9. Follow-ups to log (append to `docs/plans/followup-offset-not-duration.md`, mark §3.1 done)

- F1: model an offset as a minimum start gap / the previous step's wait. Product and scheduler decision.
- F2: model-supplied numbers on an offset-only hands-on step stay an `inferred` estimate (for example a model 60 on "After 1 hour, mix"). Consider defaulting when the only number in the text is an offset.
- F3: `attention_cue` has no marker list, so an offset phrase can verify a step as unattended.
- F4: `stated_total_min` is never phrase-grounded ("in 30 minutes" titles).
- F5: Hindi number words (§8).
- F6: prompt guidance that offsets are not durations. That is a separate prompt version; it adds no LLM calls.
- F7: the after/once 3-word window can swallow a real "for N" duration in unpunctuated captions ("Once boiling simmer for 10 minutes"). Measure on the widened golden corpus and decide whether "for" directly before N should win.

## 10. Commits (small, conventional)

1. `docs(plans): offset is not a duration — implementation plan` (this file)
2. `fix(extract): an offset is never a step's stated duration` (graph.py + tests + the 2 amended पहले tests)
3. `chore(cache): POSTPROCESS_VERSION 7`
4. `docs(plans): mark offset follow-up §3.1 done, log F1–F7`

**STOP after commit 2's verification** (below) and report before commits 3–4 and any push.
Then branch → push → PR → owner merges. Never commit to main.

## Verification

- `PYTHONPATH=apps/api pytest apps/api/tests -q`. Expect everything to pass except the 5 live-LLM tests (no `OPENAI_API_KEY`).
- `ruff check apps/api` and `mypy --strict apps/api/abc_cook/schema apps/api/abc_cook/schedule` (graph.py is not under strict, but keep it typed).
- `PYTHONPATH=apps/api python apps/api/scripts/export_web_fixtures.py`, then `git status apps/web/src/__fixtures__`. Expect no diff. The script rewrites all 11 files; restore any unintended change and report it.
- `cd apps/web && npx vitest run`. Expect it green with fixtures unchanged.
- Re-run the dry-run comparison: old vs new `build_graph` over pizza, dal and synthetic, plus the sabudana library re-verify. Expect zero diff.
- `python apps/api/tests/test_postprocess_version.py` (after commit 3).

## Session notes for the implementer

`PYTHONPATH=apps/api` for pytest and scripts. Write non-ASCII (→, –, §, Devanagari) with the
Write/Edit tool, never heredocs; the planning dry run hit exactly this mangling.
`export_web_fixtures.py` rewrites all 11 fixtures: restore everything except intended ones.
The 5 live-LLM tests fail without `OPENAI_API_KEY`, which is expected.
The branch was created tracking `origin/main`. Push with
`git push -u origin fix/offset-not-duration` so it never pushes to main.
