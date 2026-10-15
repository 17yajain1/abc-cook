# Follow-up plan: an "after N" offset is not a duration

**Status:** proposal, written 2026-10-15 during PR-C. **Not implemented.** Needs an owner decision before any code. Flagged as potential wrong advice, so it should land before M5.

## 1. Problem

`_duration_expressions` (`apps/api/abc_cook/extract/graph.py`) reads any "number + unit" as a duration. "After one hour, mix the soaked sabudana" contains "one hour", but that hour is a **start offset** (when to do the step), not how long the step takes. If the source states the same phrase, the step is marked `duration_stated` at 60 min, and the scheduler treats a 30-second stir as a stated 60-minute task.

This is latent today for English ("after one hour", "after 5 minutes"). PR-C adds a Hindi-side guard (`बाद` / `baad` / `पहले` / `pehle` immediately after a Hindi unit, see `_HINDI_OFFSET_MARKERS`) but leaves English untouched, because the step text is English and the dry runs showed no English fixture change.

## 2. Why Hindi number words wait on this

PR-C deliberately does **not** parse Hindi number words ("एक घंटे", "तीन से 4 मिनट"). The dry run with them turned on was wrong advice: "एक घंटे" grounded "After one hour, mix…" and turned Stir once into a stated 60-minute step. Number words are only safe once offsets are excluded for every language, and the English offset needs the same treatment.

Consequence until then: the sabudana "Cook … 3 to 4 minutes" step stays ungrounded against the real Hindi transcript ("तीन से 4 मिनट"). It is shown as an estimate, with the "not found in the source text" warning. That is the honest outcome.

## 3. Proposal

1. **English offset guard.** In `_duration_expressions`, skip a match that is directly preceded by `after` / `before` / `in` (start-offset framing) or directly followed by `later` / `before` / `after`. Cases to pin with tests first: "After 1 hour, mix…" (offset), "Rest for 1 hour" (duration), "Cook for 5 minutes, then after 2 minutes add…" (one duration, one offset), "in 5 minutes" in both senses.
2. **Decide what an offset means for the plan.** An offset could become a minimum start gap (a scheduler field) rather than being dropped. Dropping it is the safe first step; modelling it is a separate decision (`docs/COOKING_GRAPH.md` §4).
3. **Then add Hindi number words** (`_HINDI_NUMBER_WORDS`) with tests: "तीन से 4 मिनट" grounds 3–4; "एक घंटे बाद" does not.

Every change here moves `graph.py`, so it bumps `POSTPROCESS_VERSION`.

## 4. Open items

- How often do real sources carry English "after N" next to a stated duration? Count against the golden recipes before choosing how aggressive the guard should be.
- Whether an offset should surface to the cook at all (for example "wait 1 hour before this step"). That is a product question, not a parsing one.
