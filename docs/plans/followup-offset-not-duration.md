# Follow-up plan: an "after N" offset is not a duration

**Status:** proposal, written 2026-10-15 during PR-C. **Not implemented.** Needs an owner decision before any code. Flagged as potential wrong advice, so it should land before M5.

## 1. Problem

`_duration_expressions` (`apps/api/abc_cook/extract/graph.py`) reads any "number + unit" as a duration. "After one hour, mix the soaked sabudana" contains "one hour", but that hour is a **start offset** (when to do the step), not how long the step takes. If the source states the same phrase, the step is marked `duration_stated` at 60 min, and the scheduler treats a 30-second stir as a stated 60-minute task.

This is latent today for English ("after one hour", "after 5 minutes"). PR-C adds a Hindi-side guard (`बाद` / `baad` / `पहले` / `pehle` immediately after a Hindi unit, see `_HINDI_OFFSET_MARKERS`) but leaves English untouched, because the step text is English and the dry runs showed no English fixture change.

## 2. Why Hindi number words wait on this

PR-C deliberately does **not** parse Hindi number words ("एक घंटे", "तीन से 4 मिनट"). The dry run with them turned on was wrong advice: "एक घंटे" grounded "After one hour, mix…" and turned Stir once into a stated 60-minute step. Number words are only safe once offsets are excluded for every language, and the English offset needs the same treatment.

Consequence until then: the sabudana "Cook … 3 to 4 minutes" step stays ungrounded against the real Hindi transcript ("तीन से 4 मिनट"). It is shown as an estimate, with the "not found in the source text" warning. That is the honest outcome.

## 3. Proposal

1. **DONE** (branch `fix/offset-not-duration`, `POSTPROCESS_VERSION` 7; see `fix-offset-not-duration.md`). The shipped rule covers English and Hindi in one table and keeps a conditional lead time for "N before" / "N पहले". Two small additions beyond that plan: a hands-on step whose only time phrase is a dropped lead time gets the "when to start it, not how long it takes" warning, and the hedge list includes `approx` without the period. Original proposal: **English offset guard.** In `_duration_expressions`, skip a match that is directly preceded by `after` / `before` / `in` (start-offset framing) or directly followed by `later` / `before` / `after`. Cases to pin with tests first: "After 1 hour, mix…" (offset), "Rest for 1 hour" (duration), "Cook for 5 minutes, then after 2 minutes add…" (one duration, one offset), "in 5 minutes" in both senses.
2. **Decide what an offset means for the plan.** An offset could become a minimum start gap (a scheduler field) rather than being dropped. Dropping it is the safe first step; modelling it is a separate decision (`docs/COOKING_GRAPH.md` §4).
3. **Then add Hindi number words** (`_HINDI_NUMBER_WORDS`) with tests: "तीन से 4 मिनट" grounds 3–4; "एक घंटे बाद" does not.

Every change here moves `graph.py`, so it bumps `POSTPROCESS_VERSION`.

## 3b. Follow-ups logged by the §3.1 fix

- **F1:** model an offset as a minimum start gap / the previous step's wait. Product and scheduler decision (`docs/COOKING_GRAPH.md` §4).
- **F2:** model-supplied numbers on an offset-only hands-on step stay an `inferred` estimate (for example a model 60 on "After 1 hour, mix"). Consider defaulting when the only number in the text is an offset.
- **F3:** `attention_cue` has no marker list, so an offset phrase can verify a step as unattended.
- **F4:** `stated_total_min` is never phrase-grounded ("in 30 minutes" titles).
- **F5:** Hindi number words (§3.3 above): Devanagari only at first, matra boundary tests, possibly आधा / डेढ़ / ढाई, its own POSTPROCESS bump. The sabudana "Cook … 3 to 4 minutes" step then becomes stated on a real re-import, a reviewed golden change.
- **F6:** prompt guidance that offsets are not durations. A separate prompt version; adds no LLM calls.
- **F7:** the `after`/`once` 3-word window can swallow a real "for N" duration in unpunctuated auto-captions ("Once boiling simmer for 10 minutes"). Measure on the widened golden corpus and decide whether "for" directly before N should win.

## 4. Open items

- How often do real sources carry English "after N" next to a stated duration? Count against the golden recipes before choosing how aggressive the guard should be.
- Whether an offset should surface to the cook at all (for example "wait 1 hour before this step"). That is a product question, not a parsing one.
