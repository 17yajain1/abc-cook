# Follow-up plan: the outline's "Meanwhile" can list a prerequisite of the main line

**Status:** implemented 2026-10-15 on branch `fix/outline-meanwhile-prereqs`; see `docs/plans/fix-outline-meanwhile-prereqs.md` for the rule actually shipped (narrower than proposed here) and the fold decision. Originally written 2026-10-15 during PR-C and flagged as **potential wrong advice**.

## 1. Problem

The Plan header's "How this cook goes" outline (`apps/web/src/plan/cookOutline.ts`) can read:

> Now: Soak sabudana → Make chutney
> Meanwhile: Roast peanuts, Grind peanuts

In the sabudana golden, Make chutney depends on Roast peanuts (`depends_on = [roast]`, and it consumes the produced label `comp_roasted_peanuts`). So the line tells the cook to do Make chutney as the main line while Roast, which Make chutney needs first, is listed as something to do "meanwhile". A cook reading it top to bottom could start the chutney before the peanuts are roasted.

This is not the unclaimed-dependency case in `followup-window-unclaimed-dependency.md`: Roast, Grind and Make chutney are all claimed by the same wait window (ranks 0, 1, 2; Roast 5–10, Grind 10–15, chutney 15–18). It is a presentation problem in the outline, not a scheduling one. `plan.json` is correct; the outline's wording of it misleads.

PR-C does not change it. The outline reads only node labels and attention, the schedule, the windows and the summary, none of which move in PR-C, so main shows the same text.

## 2. Proposal to explore (generic, no recipe names)

1. **Never list a dependency of a main-line task under "Meanwhile".** If a window task is an ancestor of a task shown in the "Now" row, either drop it from "Meanwhile" or fold it into the main line before that task.
2. **Order by start time**, as PR-B4 does for the window card (`rank_in_window` follows the timeline). The outline's listed tasks should follow the same order, so a prerequisite always appears before its consumer.
3. **Keep the two-task cap** (`MAX_LISTED_TASKS`) but apply it after the prerequisite filter, so the cap never hides the one task the main line needs.

The check is graph-derived (ancestor test on `depends_on`), so it belongs with the plan data rather than being inferred in the component. If the outline needs the ancestor relation and `OutlineInput` does not carry it, that input grows a field populated from the plan response, not computed ad hoc in the renderer (CLAUDE.md: the frontend never infers dependencies).

## 3. Open items

- Whether the fix belongs in the outline derivation or in the summary the API already returns, so every renderer gets it.
- Which of the three behaviours reads best for sabudana: "Now: Roast peanuts → Grind peanuts → Make chutney" with nothing under "Meanwhile", or "Meanwhile" kept for tasks that really are independent.
- Check the other fixtures for the same shape before choosing wording.
