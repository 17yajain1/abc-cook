# Owner amendments (2026-10-27)

These win over anything below that disagrees with them.

- **A1. U3 thumbnails.**
  - `mqdefault.jpg` for the small thumbs: Cookbook rows, Home tiles, the Continue strip and the import preview.
  - `hqdefault.jpg` for the done screen and the recipe page's large picture, in an `aspect-video object-cover` box. The crop removes hqdefault's letterbox and keeps 480 px of width.
  - Keep `max-h-[30vh]` on the done screen.
  - Update the tests that pin the thumbnail URL.
- **A2. Review stop.**
  - After typecheck, lint, the full test suite, and `vite build` + `vite preview` on 5173, stop.
  - Show screenshots at 360 × 588 and 390 × 844 of:
    - U1: both header Edit buttons, and the page after tapping each;
    - U3: the done screen;
    - U4: Continue cooking during an active cook;
    - U5: a Cookbook row with a 6-serving choice;
    - U6: the import sheet reopened clean, and a fresh error with the new copy.
  - Save them under `notes/cp5-1/`.
  - No commit until the owner replies OK.
- **A3. U2 hands-on steps.** Use the plan wording, "The plan uses the recipe's N min." No note under 1 min, and none for a step with no length.

---

# CP5.1 — PR 2 cooking mode: fixes and decisions from phone runs 1+2

## Context
Two phone runs (Android 10, Chrome 114, 360 × 588) turned up one timer bug (E1), three layout or copy
bugs (U3, U4, U6) and four owner decisions (U1, U2, U5, U9). Frontend only (`apps/web`). No API change
and no `POSTPROCESS_VERSION` bump. The 3a worktree is not touched.

## Setup checks: done, all pass
Clean tree, on `feat/pr2-cooking-mode`, HEAD = 4911179, origin/main = 263fbfb.

## Step 0: causes checked against the code
- **E1: confirmed.** `CookingModeScreen.tsx:97` keeps `now` in state with a 1 s tick. `runEngine` (l.147) never refreshes it. `engine.startNode` stamps `endsAt = now + dur` from a fresh `Date.now()`, so for up to 1 s `endsAt - staleNow > dur`, and `timeLeft`'s `Math.ceil` shows N+1. The readers that pass a raw `endsAt - now` are `timers.ts` (`runningTimers` l.99, `timerSheet` l.166), `stepPage.ts` l.81 and l.150, and `viewModel.ts` l.606 (the conflict line).
- **U3: confirmed.** `Thumbnail` (`CookingShell.tsx:506`) is `h-[300px]`. `thumbnailUrlFor` (`sourceKey.ts:147`) returns `hqdefault.jpg`. Every YouTube thumb goes through it: recipe page `RecipeThumbnail`, Cookbook `SavedRow`, Home `CookbookTile`, `ContinueStrip`, the instant import preview and the done screen.
- **U4: confirmed.** `PlanScreen.tsx:327` hard-codes "Start cooking".
- **U6: confirmed, with one detail.** The message comes from `api/client.ts:40/82` and is passed through as-is by `useImportJob.messageFor` (status 0). The sheet (`home/CopySheet.tsx:114`) shows any `phase.kind === 'error'`. `AppShell.openSheet` and `onUrlChange` never clear it, so it survives closing and reopening the sheet.
- **U1:** the Edit pill (`RecipeHeader.tsx:97`) shows whenever `editing` exists and edit mode is off. **No lock during a cook exists today**: the pill is not hidden or disabled by a session. Only the servings choice locks (Q9). So "follow the existing lock rule" means the header buttons use exactly the pill's visibility condition.
- **U2:** `STEP_TIME_NOTE` (`lib/stepNote.ts:50`) is used in cooking mode (`viewModel.ts:473`), the page's `StepRow.tsx:49` and the editor `StepEditorBody.tsx:80`. Only hands-off steps ever get a timer (`engine.startNode` rejects hands-on steps).
- **U5: confirmed.** `LibraryScreen.SavedRow` (l.126) calls `servingsLine(graph, import_meta)` and ignores `servings_choice`.
- **U9: mismatch found.** Cooking mode's `readyClock` (`copy.ts:25`) is correct: `Intl.DateTimeFormat(locale, {hour, minute})`, with no forced locale and no `hour12`. But the recipe page's "Start now and it's ready around 8:45 pm" (`lib/readyAround.ts:7` `clock()`) **hand-formats a forced 12-hour clock with lower-case am/pm**. That forces a format, so it gets the fix below. `endOfPage.ts`'s `en-GB` formats a date, not a clock time, and is out of scope.

## Changes

**E1: timer N+1**
- `cooking-mode/timers.ts`: add an exported `leftMs(s: running NodeState, now)` = `Math.min(s.endsAt - now, s.endsAt - s.startedAt)`. `endsAt - startedAt` equals the planned length plus `extendedMs`, by the engine's invariant at `engine.ts:311`. Use it in `runningTimers` and `timerSheet`, and in both `stepPage.ts` sites. Clamp `timerSheet`'s `fraction` the same way. The conflict line (`viewModel.ts:606`) only has `endsAt`; add `startedAt` to `conflictTimer`'s return and clamp there too.
- `CookingModeScreen.tsx` `runEngine`: call `setNow(Date.now())` after `fn()`. This covers start, extend, done, undo and every other action.
- Test (`timers.test.ts`): start a 3-min timer at T and read the sheet, the rail and All steps at `now = T - 900` (a stale `now`). Each must say "3 min left", not "4". An extended timer is clamped to its planned length plus 5 min.

**U3: done screen**
- `CookingShell.tsx` `Thumbnail`: change `h-[300px]` to `aspect-video max-h-[30vh] w-full object-cover`. The picture is at most 16:9 and at most 30% of the screen (176 px at 588).
- **(Owner change 1)** `sourceKey.ts` `thumbnailUrlFor(sourceKey, size: 'small' | 'large' = 'small')`:
  - `small` returns `mqdefault.jpg` (16:9, no bars), for the Cookbook rows, the Home `CookbookTile`, `ContinueStrip` and the instant import preview.
  - `large` keeps `hqdefault.jpg`, for the done screen (`recipeThumbnail` in `viewModel.ts`) and the recipe page's `RecipeThumbnail`. The page's box is already `aspect-video object-cover`; the done screen gets the same.
  - hqdefault's bars are exactly the extra height of 4:3 over 16:9, so the 16:9 cover crop removes them and keeps 480 px of width. On the done screen `max-h-[30vh]` only makes the box wider than 16:9, which crops a little more.
  - Update the tests that pin a size (`sourceKey`, `instantPreview`, plus any of `importView`, `CookingShell`, `viewModel` that change).
- Title: keep 40 px. Check at 360 × 588 with the longest fixture title. If "All N steps, in X min." is still below the fold, step the done title down to the stale screen's 34 px under 380 px wide, and report it.

**U4: Continue cooking**
- New pure `cookCtaLabel(session, planKey, now)` in `cooking-mode/startCooking.ts`. It returns "Continue cooking" when `session?.planKey === planKey` and `foreignLifecycle(session, now)` (`cooking/select.ts:345`) is `active` or `stale`, the same rule Home's Continue strip uses (`home/continueCooking.ts:39`). Otherwise it returns "Start cooking".
- `App.tsx` `PlanRoute` computes it from the `session`/`now` it already reads and passes `startLabel` to `PlanScreen`. `PlanScreen` renders `startLabel` in place of the literal. The tap still goes through `startIfNone`, which already resumes an existing session.
- Test: no session, a session for another plan, active, stale, finished, and unknown (no `totalMin`).

**U6: import sheet error**
- `useImportJob.ts`: export a pure `clearError(phase)` (`error` becomes `entry`; every other phase is returned unchanged). Add `clearError()` and make `setUrl` clear an error, so a changed link clears it.
- `AppShell.openSheet` calls `job.clearError()`. `messageFor`, status 0: return "We couldn't reach ABC Cook. Check your connection and try again." and `console.warn('[import]', err.message)`, so the technical detail stays in the console. The 422 API sentence is unchanged. `LibraryScreen`'s own `messageFor` (l.164) gets the same status-0 mapping if it passes `err.message` through.
- Test: `clearError` on `error` / `polling` / `paste`; `messageFor(new ApiError(0, …))` returns the user copy and never contains `localhost`.

**U1: section Edit buttons**
- `IngredientsPanel` heading row and the Steps `<h2>` row in `PlanScreen`: add a quiet text button, "Edit" (`text-[14px] font-semibold text-home-ink-2`, a 44 px hit area via the `after:` inset pattern). Render it only when `editPill && !editMode`, which is the pill's own condition.
- On tap: `edit.enter()`, then after two `requestAnimationFrame`s (the `seeWhich` pattern) set `scrollRef.scrollTop` so that `[data-anchor="need"|"steps"]` sits just below the compact bar and the sticky EditToolbar (their measured heights). The top-right pill is unchanged.

**U2: timer note wording (owner chose "plan wording")**
- `lib/stepNote.ts`: replace `STEP_TIME_NOTE` with `stepTimeNote(durationMin, occupiesCook): string | null`:
  - hands-off: "The timer uses the recipe's 30 min."
  - hands-on: "The plan uses the recipe's 5 min."
  - `null` when `roundMin(min) < 1`.
  - The length is `formatMinutes(roundMin(min))`, the same number `timerLength` names.
- Cooking mode (`viewModel.ts:473`) uses `n.durationTypical` and `n.occupiesCook`.
- The page needs `occupiesCook` on `RenderTask`. Copy it in `derive.ts` from the plan's `ScheduledNode.occupies_cook`, as `cooking/model.ts:68` does. It is never inferred from `attention`.
- `StepInstruction` passes the note into `StepEditorBody` as a new `timeNote` prop. The editor stays text-only and does not change the timer.
- Update the tests that pin the old string (`stepNoteTime.test.ts:158`, `stepEditNotes.test.ts`).

**U5: Cookbook servings**
- `lib/servings.ts`: add `savedServingsLine(graph, importMeta, choice)`. It runs `reconcileChoice` first.
  - Servings mode with `chosen ≠ original`: "6 servings" (or "1 serving"). The yield text is dropped because it describes the original batch.
  - Batch mode with a factor other than 1: `servingsCopy(choice).headerMeta` ("Amounts ×2").
  - Otherwise: the existing `servingsLine`.
- `SavedRow` uses it with `recipe.servings_choice`. Tests cover each branch, plus a stale choice (different `original`) that falls back.

**U9: clock format**
- `lib/readyAround.ts` `clock()`: use `Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' })` with spaces turned into no-break spaces (as in `readyClock`). Add an optional `locale` param for tests, and update the `readyAround` tests to pass `'en-US'` (output "8:45 PM"). The 5-minute rounding and day naming are unchanged.

## Verification
1. `npm run typecheck`, `npm run lint`, and the full `npx vitest run` from `apps/web`. The CP4 memory says never run the full suite with the harness synced; check that first.
2. `vite build` and `vite preview` (not dev), on port 5173 because of CORS. Chrome via the claude-in-chrome tools at 360 × 588 and 390 × 844. Check the body background first, because Dark Reader inverts localhost pages. Screens:
   - the done screen (U3): picture without bars, summary line visible without scrolling;
   - the recipe page with the section Edit buttons and "Continue cooking" during an active cook (U1, U4);
   - the import sheet after a failed attempt with the API stopped: reopened clean, and with a fresh error the friendly copy shows (U6);
   - Cookbook rows with a saved 6-serving choice (U5).
3. **(Owner change 2) HARD STOP for review before the commit.** Show screenshots at 360 × 588 and 390 × 844 of:
   - U1: the recipe page with both section Edit buttons, plus the page after tapping each, scrolled to that section below the bar and the EditToolbar;
   - U3: the done screen, picture without bars, summary line visible;
   - U4: "Continue cooking" during an active cook;
   - U5: a Cookbook row with a saved 6-serving choice;
   - U6: the import sheet reopened clean after a failed attempt, and a fresh error with the new copy.

   Wait for the owner's OK.
4. After the OK, make one commit on `feat/pr2-cooking-mode`: `fix(web): CP5.1 timer N+1, done-screen picture, Continue cooking, import error, section Edit, timer-note copy, Cookbook servings, locale clock`, ending with the Co-Authored-By line. This follows the CP4.1 subject style, with the "CP5.1" tag as asked. No push, no merge. Report the hash and a 5-line summary.
