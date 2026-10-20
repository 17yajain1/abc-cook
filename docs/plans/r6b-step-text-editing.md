# R6b — step-text editing, "Which step uses it?", the A5 rename note

**Status (2026-10-20): implemented, awaiting PR.** Branch `feat/r6b-step-text-editing`, worktree
`C:\Users\ashya\Music\abc-cook-r6b`, from `origin/main` @ `f2413f2` (R6a merged in #74). W0, W1, HARD STOP A and A2
are closed.

Baselines and finals (web only, Rs 0, `git diff f2413f2..HEAD -- apps/api packages` empty):
- vitest 2007 passed / 74 files -> 2268 passed / 81 files;
- pytest `-m "not llm and not network"` 1960 passed, unchanged;
- B10/B16 time-phrase reach 22 of 133 editable steps (W0 numeric-only: 17);
- B11 rename-note reach 114 of 149 consumed ingredients (W0 strict: 99).

Inherited and binding (not copied, see `docs/plans/r6-tier-a-editing.md`): Q7, Q8, A1, A3, A9, A13, A14/A20,
A19, A21, A22, A24, A29, A30, N1, N3, N9. R6 A/N numbers keep their meaning. R6b amendments are B1..Bn.

## Owner answers and amendments

Owner answers and amendments, R6b plan (2026-10-20). These win over the plan body.
R6 amendments keep their numbers (A1-A33, N1-N10); new R6b amendments are B1..Bn.

Answers
Q1: Yes, D2. Add a dated amendment line to the R6 plan's anchor section: R6b replaces the
    k-th-duplicate rule with D2. The RecipeEdit docstring ("index as a tiebreak") still
    holds, so no API change.
Q2: Yes. The serving-wait node is not editable and is not offered in the picker. Its lead
    step stays editable.
Q3: Yes, (a). The add stays, unlinked, and the link is listed as its own orphan. W1 renders
    the link-orphan line with two button labels, "Discard this change" and "Remove the
    link", because the ingredient itself stays. I pick at W1.
Q4: (b): the editor plus the page under the edited step. 4b: keep Q7 literal. W1 renders a
    typo fix on a timed step so I can judge the noise.
Q5: Yes, (a). W1 renders (a), (b) and (c).
Q6: Yes.
Q7: Yes, D9, with B4.
Q8: Yes. Error copy decided at W1 (candidates "Enter the step." / "Keep the step to 1000
    characters.").
Q9: Yes, with "None" as the FIRST option (it is the default).
Q10: Yes, fix it in R6b, with a test using a real-shaped id (ing_user_s_choice). Call it out
    in the PR body as an R6a fix.
Q11: Yes. Commit the synthetic added-step payload and its dropped variant as web fixtures.
    LF check (git ls-files --eol).
Q12: Yes, log FGC-60.

Amendments
B1. Numbering: R6 A/N numbers keep their meaning. R6b amendments are B1..Bn.
B2. parseEdit validates set_step_text (trimmed, 1..1000 code points) but never rewrites it.
    A stored edit is applied verbatim, and a malformed one is ignored (kept, not counted).
    Normalisation (trim, collapse whitespace) happens only in commitStep. Test: a stored
    text with an internal double space round-trips and applies byte-identical.
B3. Cooking-mode time note (Risk 1 is wrong-advice territory). W0 item 8 also reports how
    many edited-step cases would show it. W1 renders the cooking-mode task screen for an
    edited step with a time phrase in two variants:
    (i) bare, A9 as is;
    (ii) the same note line "Timers stay as planned. Changing times comes later." with no
         "Edited" mark.
    I lean (ii) and decide at W1.
B4. Rename note. "Old name" matches EITHER the imported name OR the name before this Save,
    because step text holds the imported name unless the cook edited it. "Edit the step"
    (when exactly one step matches) goes through guard('tab'), then enters Plan-tab edit
    mode with that step open and scrolled into view (the A4 pattern). If the guard is
    blocked, it stays put.
B5. W1 also renders a COLLAPSED stage card that holds an edited step, to show whether
    anything signals the edit. No new marker unless I ask for one.
B6. W1 picker frames are headless Chromium, not the iOS wheel. Add "native select on a
    real iPhone" to the cooking-mode-check list before M5. It does not block W1.
B7. The docs commit updates FGC-59's text for the hook rename (useIngredientEditing.ts ->
    useRecipeEditing.ts).
B8. STOP after W0. W0 must not run into W1; I review W0 before any render. STOP after W1
    for my picks. These stops are part of the plan body, not only the workflow summary.

Added after the W0 review (2026-10-20). These win over the body.
B9. Keep D2 (C2/C3). The plan states the measured behaviour instead of "a twin is never
    guessed": with two identical step texts plus an upstream change, D2 can apply an edit
    to the surviving twin or to an inserted copy (W0 item 3). In real data only croissant
    has a duplicate pair. Tests pin the measured outcomes (survivor re-target,
    copy-before, unrelated-step-dropped orphan) so the behaviour is deliberate, not
    accidental. Log FGC-61: an optional expected.label on StepAnchor (labels never
    change, Q8), only if a mis-target is ever reported. It is backward compatible, so
    deferring costs nothing. No schema change in R6b.
B10. textHasTimePhrase also catches times written in words (C1): a closed list of number
    words directly before a time-only word, word-bounded and case-insensitive.
    English: a, an, one to twelve, fifteen, twenty, thirty, forty-five, half, a few,
      a couple of, and "half an hour".
    Hindi: एक दो तीन चार पांच पाँच छह सात आठ नौ दस पंद्रह बीस तीस चालीस आधा आधे डेढ़ ढाई साढ़े.
    TIME_PHRASE (the R4 rule) stays byte-identical: word phrases have no digits, so the R4
    amount note never needed them. The time-word vocabulary stays shared (one list of time
    words). Tests:
    - true for all five W0 misses ("one hour", "Ten minutes before serving", "half hour",
      "about a minute a side", plus the fifth from the report) and for "दस मिनट";
    - false for "one onion", "2 minced garlic", "350°F", "180 degrees";
    - repeated calls give the same answer.
    HARD STOP A reports the new count over the 133 editable steps (was 17).
B11. Rename note matching (W0 item 5) also accepts the name's head before the first "("
    or "," and a simple plural (+s, +es) of the full name or the head. It stays
    word-bounded and case-insensitive, and still only checks steps whose consumes hold
    that ingredient. HARD STOP A reports the reach (W0: 99 strict, about 114 with these).
B12. FGC-58 fixtures (C4): commit the kadhi-based set (added, dropped-same-text,
    dropped-time) WITH their provenance, in the shape the app reads
    (import_meta.provenance), loaded the same way as existing fixtures. LF line endings.
    The committed added-step fixture is what W1 and HARD STOP A use for the
    "Added by ABC Cook" frames.
B13. W1 renders, driven by the W0 data:
    - Hindi: Devanagari typed over an English step, once with "दस मिनट" (the time note
      shows) and once with no time;
    - sabudana "After one hour..." edited (a words-only time; the note shows under B10);
    - typo-fix noise on pizza-dough (a timed step) and on a step with no time;
    - Q8 label frames: sabudana "Soak 2 hours" and pizza-dough "Measure 3 1/3 cups" with
      edited text, as written and at another servings choice (R4 note plus the A1 line);
    - kadhi's serving-wait node with no edit affordance; its lead step editable;
    - an "Added by ABC Cook" step edited (B12 fixture);
    - picker duplicate-label disambiguation on a synthetic payload (not committed).
    W1 may use scratchpad prototypes of B10/B11 to render. The real code is test-first,
    after my picks.
B14. Log for FGC-3 (append to FGC-58's entry): adding a step to pumpkin's original took
    it to degraded; a step-count change in the original breaks the stored repair replay
    (15 of 58 W0 runs). Not R6b work; FGC-3's PR must look at both.
B15. Non-ASCII in any file, notes included, goes through Write/Edit only. The W0 \u slip
    must not repeat.

Added after the W1 review (2026-10-20). These win over the body.
W1 picks
a. Q5: (a). One Edit control on the Plan tab, sharing one edit session; every stage
   expands; a pencil per editable step; the editor opens in the row (s1-a1..a3).
b. Q3: the link-orphan button reads "Remove the link" (s2-link-remove, s2-both-remove).
c. B3: (ii). In cooking mode an edited step whose text has a time phrase shows
   "Timers stay as planned. Changing times comes later." (s3-ii). No "Edited" mark.
d. Q8 copy approved: "Enter the step." / "Keep the step to 1000 characters."
e. 4b: keep Q7 literal (S5).
f. B5: the quiet "Edited" word on a collapsed stage card that holds an edited step
   (s6-cand), next to the stage time. Any edited step in that stage counts, window tasks
   included; ingredient edits do not. The word is not its own tap target; the card header
   behaves as today.

B16. "second" (W1 finding): number words count before "seconds" (plural) only with a
    number word of two or more ("thirty seconds"). "a second" and "one second" are not
    time phrases. Digits ("1 second") are unchanged. Test: "add a second layer" is false.
B17. Step-orphan card: show the imported text and "Your change" in FULL, with no clamp,
    so the cook can see what differs (S2 cut both before the difference).
B18. Picker order = the order rows appear on the Plan tab: a window's tasks come right
    after their host, as in "Meanwhile, do these" (s10-kad-list put them at the end of
    the stage). One test pins kadhi's order against the rendered page order.
B19. Shipped components win over W1 prototypes. The picker goes into the Add form R6a
    shipped (A19: inline at the end of the list), not a bottom sheet; the orphan review
    uses R6a's shipped title and copy (A22). Report at HARD STOP A what R6a shipped for
    both, with file:line.
B20. Amount hint (s8-pizza-cook: the text says 4 cups, the chip 6⅔). After a step-text
    Save, when the amount numbers outside time phrases differ from the imported text's
    (same textHasAmountNumber vocabulary, one rule) AND the step's consumes holds at
    least one ingredient, show under the saved step: "Ingredient amounts don't change
    with the step. Edit the ingredient if you like." No link. Copy approved at HARD
    STOP A. Tests: a changed amount shows it; a changed time only does not; a step with
    no ingredients does not.
B21. Cooking-mode note (ii) uses the doneness-cue line style (s3-ii rendered it
    smaller). When the R4 amount note and the time note both apply, HARD STOP A shows
    one frame with both.
B22. Q8 accepted as rendered (S8): the label matches the timer and (ii) explains it.
    Log FGC-62: when times become editable, numbers in the label move with them.

Added after HARD STOP A (2026-10-20). These win over the body.
B23. B20 copy approved: "Ingredient amounts don't change with the step. Edit the
    ingredient if you like."
B24. Link-orphan card heading (b1): the quoted step text is clamped to 2 lines with an
    ellipsis: Kasuri methi: was on "Add the kadi mixture to the pan, stir…". The step
    card above it keeps B17's full text, because that card is where the comparison
    happens.
B25. The open step editor uses the full row width: no column reserved for the pencil
    while the editor is open (a3, e1 at 360 wrapped at about 25 characters).
B26. Cooking mode carries the B20 condition too (k2: the text says 4 cups for 8, the
    chip says 6⅔ for 16). When B20's condition holds, the cooking-mode task screen shows
    "Ingredient amounts don't change with the step." (no edit clause), in the cue-line
    style, directly after the time note when both apply. One helper decides it for the
    page and for cooking mode. No "Edited" mark (A9). Tests: shown for g1's case; not for
    a time-only change; not for a step with no ingredients.

---

The body below has been reconciled with the answers and amendments above.

## Context
R6a (#74) lets a cook fix ingredient lines over the imported plan, as a web overlay applied after the
schedule. The schema already carries `set_step_text` and `AddValue.step` (`schema/library.py:51-61,123-141,
179-184`), but the overlay ignores step edits (`recipeEdits.ts:118-120,188-191`). A wrong step ("add 4 tbsp
salt") is the same trust problem as a wrong amount. R6b makes step text editable, lets an added ingredient
name the step that uses it, and ships the A5 rename note, which A21 held back until a step could be edited.
Web only. Timing never moves.

Read from `origin/main` @ `f2413f2`. PPV 14, unchanged. ₹0.

## Where the inventory changes the brief
1. **R6a treats any id that starts with `ing_user_` as an added row** (`ingredientEditor.ts:247`,
   `recipeEdits.ts:285`, `EditableIngredientList.tsx:78`). Real ids are `ing_<first 3 slug words>`
   (`graph.py:1756`, `_slugify` `:139-141`), so an imported "User's choice greens" becomes `ing_user_s_choice`.
   On such a row, Save goes to `rewriteAdded`, finds no add edit and returns `ctx.edits` (`:335-338`); Remove
   goes to `removeRow`'s add branch and changes nothing (`recipeEdits.ts:301-302`). Either way the edit is
   lost silently, which breaks A24. A synthetic `ing_user_<uuid>` cannot equal a real id: a UUID has `-`, and
   a slug has only `[a-z0-9_]`. The `edit_<ts>_<rand>` fallback has more parts than 3 words plus a `_N`
   suffix. **But the prefix test can still misfire.**
   - Fix (Q10): test membership in `overlay.added`.
   - Test with `ing_user_s_choice`.
   - The PR body calls it out as an R6a fix.
   - W0 counts real ids with that prefix.
2. **The R6 plan's k-th-match rule can re-target silently.** "k = duplicates before `index`", counted in the
   *current* payload, picks the wrong twin when steps before it are dropped. Replaced by D2 (Q1).
3. **`textHasTimePhrase` does not exist on main.** `stepNote.ts` exports only `textHasAmountNumber` and
   `stepNeedsAmountNote` (`:26,34`). `TIME_WORDS` mixes time and degree words (`:21`), and `TIME_PHRASE` is
   a shared `giu` regex (`:23`) (item 12).
4. **There is no share, export or search over step text** (no `navigator.share`, no export in
   `apps/web/src`). The A6 consumer list for `instruction` is short (I2).

## Step I — inventory (origin/main @ f2413f2)

### I1. What renders step text, and whether it can be edited

| Thing | Where it comes from | Rendered at | Editable in R6b |
|---|---|---|---|
| Normal step | `Node.instruction = step.text` (`graph.py:1948`) | `StageCard.tsx:235-237` (TaskRow) | **Yes** |
| Step inside a wait window (parallel task) | a normal node, placed by the scheduler | `WaitWindowBlock.tsx:114-116` | **Yes** (the same op; it renders in the window) |
| Window host | a normal node: its TaskRow sits above the field | `StageCard.tsx:118-127` | **Yes**. The field itself (host label, numeral, "until …") is not instruction text: no |
| Finish / sink step (`kind: 'finish'`) | the last required step | TaskRow | **Yes** |
| "Added by ABC Cook" step (FGC-3) | a node with provenance `origin: 'added'` (`derive.ts:222`) | TaskRow plus `addedLabel` | **Yes** (FGC-58 tests). `addedLabel` stays |
| Serving-wait lead step (the hands-on step whose text gave the wait) | a normal node (`graph.py:2126-2129`) | TaskRow | **Yes**. Editing its text never removes the wait node. The time note covers this |
| Serving-wait node `step_wait_before_serving*` | generated text, `'Wait {d}, then serve. The recipe adds "{label}" …'` (`graph.py:2137-2156`) | TaskRow | **No (Q2)**, and not offered in the picker. The text is ABC Cook's statement of a scheduled wait. Its only content is the time, which R6b cannot change. Its generated wording can change with a PPV bump |
| Tip (optional/alternative step attached via `attach_to_step`) | `Node.tip` (`graph.py:1980-1986`) | `StageCard.tsx:249-254`; cooking `model.ts:65` | **No (Q12).** `set_step_text` writes `instruction` only. A tip is another field on another node, and has no op. FGC-60 logged |
| Linear-fallback plan | nodes from the same builder | TaskRow | **Yes**, same rules |

The collapsed card shows labels only (`StageCard.tsx:41,98-105`), and a label never changes (Q8). So no
collapsed card renders instruction text.

### I2. Every read of `node.instruction` (web)
- `plan/derive.ts:215`: `toTask` copies it into `RenderTask.instruction` (`:37`). This feeds:
  - `StageCard.tsx:235-237` (expanded only);
  - `WaitWindowBlock.tsx:114-116`.
- `cooking/model.ts:64`, which feeds `cooking-mode/viewModel.ts`:
  - `:452`: task-screen title;
  - `:460`: the R4 note, `stepNeedsAmountNote(n.label, n.instruction)`;
  - `:507`: wait screen via `splitCopy` when there is no cue;
  - `:535-536`: handover;
  - `:582`: sitting_resume;
  - `:589`: sitting_break.
- The "Next: …" preview (`viewModel.ts:328-345,469-470`) names the next node's label, not its instruction.
  W0 confirms this from the full function body.
- The outline (`plan/cookOutline.ts`) has no `instruction` hit (`git grep` on `origin/main`).
- The R4 step note is the `viewModel.ts:460` line above. It is computed on the overlaid (edited) text.
- Server side: `step.text` makes the node id (`graph.py:1809`), kind, stage, duration and the serving-wait
  node. That is why edits never go through `/reprocess` (R6 contradiction 1).
- Keys and equality:
  - the session conflict check is `planKey` + `graphId` only (`cooking/engine.ts:87`). `graphId` is
    `graph.id`, which the overlay never touches;
  - the source key and the duplicate check read no instruction (R6a W0 §A6,
    `notes/r6/w0/report.md:224`).
  - W0 re-greps to confirm nothing hashes `instruction`.
- Share, export and search: none exist.

### I3. Step anchors
- Schema: `StepAnchor {index ≥ 0 (position in payload.graph.nodes), expected.text}` (`library.py:51-61`).
- No resolver exists yet. `parseEdit` returns null for `set_step_text` (`recipeEdits.ts:118-120`).
- `EditContext.payload` is the raw payload (`ingredientEditor.ts:33-40`; `App.tsx:529` passes
  `view.rawPayload`). R6b builds every step anchor from `ctx.payload`, never from the overlay, so:
  - a `set_step_text` on a step that already has one replaces it in place (`upsertEdit` matches op + index,
    `recipeEdits.ts:269-271`). The new anchor is the same raw index and raw text, so the anchor keeps the
    **imported** text;
  - an add linked to an edited step anchors to the raw text too.
  - Tests assert both.
- Server text handling: `instruction=step.text` verbatim. W0 checks whether `step.text` arrives trimmed or
  NFC-normalised, and whether `reprocess(original)` reproduces `instruction` byte for byte.
- Duplicate texts, known so far: croissant has 1 duplicate pair (R6a W0 §2/§4). No other fixture or corpus
  recipe has one. W0 recounts per recipe and lists Devanagari/Hinglish steps.

### I4. Refresh paths
They are unchanged from R6 §A2. The overlay re-applies at every open, so a step edit follows the same
"applied or orphaned" rule as an ingredient edit. Anchors use text, not node ids, so a PPV bump that renames
node ids does not orphan an unchanged step.

### I5. The orphan review today
- `set_step_text` is `ignored`: not counted, not listed (`recipeEdits.ts:188-191`).
- `add_ingredient.step` is never read. `parseEdit` keeps name, amount and unit (`:110-117`), so an R6b link
  stored today shows as an unlinked add on R6a code. Nothing breaks.
- `Orphan` and `orphanNowLine` are ingredient-shaped (`:29-38,344-346`).

### I6. Entry and exits
- Edit lives in `IngredientsPanel` only. There is one `useIngredientEditing` per `PlanScreen`
  (`PlanScreen.tsx:112`).
- Exits:
  - back: `:120`;
  - Start cooking: `:121`;
  - a tab switch: `:155-160`;
  - each goes through `edit.guard` → `leave` (`ingredientEditor.ts:400-411`).
- Stage expansion is `expandedStages` (`PlanScreen.tsx:129-130`). Collapsing is not guarded today.
- Scroll-into-view: the `blocked` counter (`useIngredientEditing.ts:42-44`).

### I7. Consumers of `consumes` (for the synthetic id)
- `cooking-mode/quantity.ts:43-46`: `ing_user_*` passes the `ing_` filter → a chip.
- `cooking/model.ts:72`.
- `plan/derive.ts:228-232` (`stageIngredients` → "You'll need"). Adds are appended after the imported rows
  (`recipeEdits.ts:221`), so a linked add is the stage's **last** "You'll need" row with no extra code (A14).
- `recipeEdits.ts:309-311` (`stepUsage` → the remove warning; an added row keeps its confirm anyway, N9).
- `ingredientGroups.ts` does not read `consumes`.
- The scheduler, sessions and timers read the stored plan, never `consumes` from the overlay.

### I8. Shared helpers to reuse
- `asWrittenLine` (`ingredientEditor.ts:162`).
- `EditedTag` is private in `EditableIngredientList.tsx:49-59`. It moves to `plan/EditedTag.tsx`.
- `Label`, `ErrorLine` and `LinkButton` are private in `IngredientEditorBody.tsx:13-59`. They move to
  `plan/editorParts.tsx`.
- `upsertEdit`, `restoreEdit`, `discardEdit`, `newEditId` (`recipeEdits.ts`).
- `leave`, `isDirty`, `EDITOR_COPY` (`ingredientEditor.ts`).
- `executionOrder` (`cooking/model`, already used by `derive.ts:13`).

## Step D — design

### D1. Overlay (`library/recipeEdits.ts`)
- `parseEdit` learns two things:
  - `set_step_text {anchor: StepAnchor, text}`, **validated, never rewritten** (B2):
    - the trimmed length must be 1..1000 code points, or the edit is `ignored` (kept, not counted);
    - a valid one is applied verbatim;
    - normalisation lives only in `commitStep` (D3);
  - `add_ingredient.value.step`: a valid `StepAnchor` or null. A malformed `step` makes the whole add
    `ignored`. That is the same rule as a malformed amount, so nothing is guessed.
- `resolveStep(nodes, anchor)` (D2) gives a node index or null. It never resolves to a non-editable node
  (I1), and such a node is not offered in the editor or the picker.
- Applied step edits:
  - patch `out.graph.nodes[i].instruction` only;
  - never `label`, `id`, `depends_on`, durations, `consumes` (apart from the add), `tip`, the plan,
    the stages or the summary.
- Linked add, resolved:
  - `ing_user_<editId>` is appended to that node's `consumes` in the clone;
  - the add is unchanged in `graph.ingredients`.
- `OverlayResult` gains:
  - `editedSteps: ReadonlySet<nodeId>`;
  - `importedSteps: ReadonlyMap<nodeId, string>` (raw instruction, for "Imported: ...");
  - `linkedSteps: ReadonlyMap<addRowId, nodeId>`, for the picker prefill.
  - Orphans gain a `kind` (`'ingredient' | 'step' | 'link'`).
- Status and count: see D5.

### D2. Resolve rule (approved, Q1: replaces the R6 k-th-duplicate rule)
1. Candidates = nodes whose `instruction === expected.text` exactly. No trim, no NFC: both sides come from the
   same server pipeline. W0 proves that holds over a refresh.
2. No candidate → orphan.
3. Exactly one candidate → it, wherever it moved.
4. Several candidates → the one at `anchor.index` if it is a candidate, else **orphan**. There is no k-th
   counting.

Measured behaviour (W0 item 3, B9). With two identical texts plus an upstream change, D2 can still apply the
edit to an identical-text sibling:
- the edited twin's text changes or the step is dropped: the surviving twin is then the only candidate, so
  the edit applies to it (4 of 4 croissant runs);
- an identical copy inserted just before the target takes the old index, which is a candidate, so the edit
  applies to the copy (9 of 10 targets);
- a duplicated step whose index shifts, with no copy at the old slot (an unrelated step dropped before it, or
  a copy inserted at the start), orphans.

Only croissant has a duplicate pair (1 of 14 distinct recipes). The re-target lands on a step that reads the
same, so the cook sees no wrong text. Tests pin these outcomes so the behaviour is deliberate (B9). FGC-61
(optional `expected.label` on `StepAnchor`) is the fix if a mis-target is ever reported.

### D3. Step editor (pure, `library/stepEditor.ts`, no DOM)
- `StepFieldState {target: {kind:'step', nodeId}, text, errors, initial}`.
- `EditSession` gains `step: StepFieldState | null`. At most one of `open`, `add` and `step` is set.
- `leave` (one door, A24) commits an open step field the same way it commits a row:
  - valid → write;
  - invalid → stay open with the error;
  - write fails → A8.
- New `LeaveKind` `'collapse'`: collapsing the card that holds the open step, or "Show overview".
- `commitStep(ctx, f, deps)`:
  - normalise: trim, then collapse every whitespace run (newlines included) to one space. The page renders
    the text as one paragraph anyway;
  - empty → `stepEmpty` error;
  - more than 1000 code points (`[...s].length`, which matches Pydantic's `len`) → `stepTooLong` error.
    There is no `maxLength`, because a silently truncated paste loses words;
  - equal to the normalised **raw** text → no edit (an existing one is deleted, as Restore does);
  - otherwise upsert `set_step_text` with the raw anchor.
- Restore original = `restoreEdit(id)`.

### D4. Time note (N1, Q7)
- `stepNote.ts`:
  - split `TIME_WORDS` into `TIME_ONLY_WORDS` (`mins?|minutes?|hrs?|hours?|secs?|seconds?|मिनट|घंटा|घंटे|सेकंड`)
    plus `DEGREE_WORDS` (`degrees?`);
  - `TIME_PHRASE` is rebuilt from both, so the pattern source is unchanged;
  - `textHasTimePhrase(text)` builds `new RegExp(\`${RANGE}\\s*${TIME_ONLY_WORDS}(?![\\p{L}\\p{M}])\`, 'iu')`
    per call (no `g` flag), with no degree signs. B10 adds a second alternative: a closed list of number
    words directly before a time-only word (word-bounded, case-insensitive; English and Hindi lists in B10).
    `TIME_PHRASE` itself is untouched.
- Shown (Q4 (b); 4b: Q7 literal, so any time phrase counts, even after a typo fix):
  - live in the open step editor, under the field;
  - and on the page under an edited step whose overlaid text has a time phrase.
- Cooking mode: **(ii), picked at W1 (B3, B21)**: the task screen shows "Timers stay as planned. Changing
  times comes later." for an edited step whose text has a time phrase, in the doneness-cue line style, with no
  "Edited" mark. `viewModel` gets a `timesNote` slot fed by `textHasTimePhrase` on edited nodes only
  (`overlay.editedSteps` passed through the cooking model).
- B16: a number word counts before the plural "seconds" only when it is two or more.
- Tests:
  - true for "10 min", "1½ hours", "10-15 मिनट", and the B10 word forms ("one hour", "Ten minutes before
    serving", "half hour", "about a minute a side", "दस मिनट");
  - false for "350°F", "180 degrees", "2 minced garlic", "one onion";
  - two calls in a row give the same answer;
  - every existing `stepNote.test.ts` case unchanged.
  - `stepNeedsAmountNote` output stays byte-identical: TIME_PHRASE source equality is asserted.

### D5. Orphans (the R6a review, extended)
- Step orphan, as rendered at W1:
  - line 1: the imported text, in full (B17, no clamp);
  - "Your change: {text}", in full;
  - one honest line, proposed "This step changed in the imported recipe, or is gone.";
  - "Discard this change" deletes the edit.
  - There is no "now says" line: the node at the old index may be an unrelated step.
- Linked add whose step orphaned: **(a) (Q3).**
  - The add still applies, unlinked: it shows in "Added by you", but not on any step and not in "You'll
    need".
  - The link is listed as its own orphan: "{name}: was on "{step label or text}"" plus the honest line.
  - The button rewrites the add with `step: null`. It never deletes the ingredient.
  - Its label is "Remove the link" (W1 pick b). A step orphan keeps "Discard this change".
- The notice count = orphaned step edits + orphaned links + ingredient orphans. `orphanNoticeLine` is
  unchanged.

### D6. Plan-tab entry ((a), Q5; W1 pick a)
- One "Edit" control on the Plan tab, the same component and placement as the Ingredients tab's.
- It shares one `EditSession` (one hook, renamed `useRecipeEditing`; the old file name goes away. No
  case-only rename).
- Edit mode on the Plan tab:
  - **expands every stage**, like "Show full recipe". On Done, the expansion stays where it is;
  - every editable step row in a card or a window shows a tappable affordance. Tapping it opens the step
    editor in place, inside that row: a textarea at 16 px, so iOS does not zoom on focus, auto-growing,
    then Save · Restore original;
  - "Imported: …" shows when the step is edited;
  - the A1 line shows when needed (D7);
  - the time note shows when needed.
- An "Edited" tag (`plan/EditedTag.tsx`) on an edited step row in view mode. Tapping it enters edit mode with
  that step open and scrolls it into view (A4 pattern).
- Exits:
  - Done, a tab switch, Start cooking and back go through `guard` (unchanged);
  - collapsing that card or "Show overview" goes through `guard('collapse')`;
  - when an exit is blocked, `blocked` bumps and the open step scrolls into view (A32).
- A tab switch leaves edit mode, as in R6a.
- Collapsed cards (W1 pick f): a quiet "Edited" word next to the stage time when any step in the stage
  (window tasks included) is edited. Ingredient edits do not count. It is not a tap target; the header
  behaves as today.

### D7. Servings and step text (item 7; approved, Q6)
- Step text is never scaled. R4 shows a note instead. So the text a cook types is stored as typed, and the
  rule is that the cook writes amounts **as written**, consistent with A1.
- The step editor shows the A1 line from `asWrittenLine(choice)` verbatim when the choice is not as
  written, so there is one copy for both editors.
- The R4 note (`viewModel.ts:460`) then runs on the edited text, and stays true.

### D8. Step picker (item 8)
- On the Add form, and on an added row's editor:
  - label "Which step uses it? (optional)";
  - a native `<select>`: the phone's own picker, accessible, no popup code, Devanagari rendered by the OS
    font;
  - **"None" first**, and the default (Q9);
  - then an `<optgroup>` per stage (the stage label, in plan order);
  - options = editable steps in the order their rows appear on the Plan tab (B18: a window's tasks right after
    their host). The serving-wait node and tips are never listed (Q2);
  - it sits inline at the end of the Add form R6a shipped, not in a bottom sheet (B19);
  - option text = step label. Where two labels repeat, " · " plus the first ~40 graphemes of the current
    (overlaid) instruction, cut with `Intl.Segmenter` so a Devanagari conjunct is never split.
- Picking a step writes `AddValue.step = stepAnchor(raw payload, node)`.
- Editing an existing add pre-selects its linked step through `linkedSteps`. An orphaned link pre-selects
  "None".
- `rewriteAdded` takes the picked step instead of always keeping the old one (`ingredientEditor.ts:341`).
- Linking imported ingredients stays out of scope.
- B6: the W1 frames are headless Chromium. "Native select on a real iPhone" goes on the cooking-mode-check
  list before M5. It does not block W1.

### D9. Rename note (A5/A21; approved, Q7 + B4)
- Shown after a rename Save, under the saved row while edit mode stays on.
- It shows only when some node whose `consumes` holds that ingredient id has overlaid text containing the
  **old name**. Old name (B4) = EITHER the imported name OR the name before this Save. Step text holds the
  imported name unless the cook edited it.
- Matching (B11: the name is the full name or its head before the first "(" or ",", each also with a simple
  plural +s/+es; only steps whose `consumes` hold the ingredient are checked):
  - case-insensitive (`toLocaleLowerCase('en')`; Devanagari has no case);
  - Unicode word bounds `(?<![\p{L}\p{M}\p{N}])…(?![\p{L}\p{M}\p{N}])`, so "oil" never matches "boil";
  - the name is regex-escaped.
- When exactly one step matches, "Edit the step" is a link (B4):
  - it goes through `guard('tab')`;
  - then it enters Plan-tab edit mode with that step open and scrolled into view (the A4 pattern);
  - if the guard is blocked, it stays put (the open row keeps its error and scrolls into view).
- It goes away:
  - when edit mode ends;
  - when another row opens;
  - when no consuming step contains the old name any more.
- The remove-warning copy is unchanged (A27).

### D10. Cooking mode (item 11)
- The overlaid payload already feeds cooking mode (R6a). With R6b:
  - the edited instruction shows with no "Edited" marks (A9). The time-note line is B3's W1 decision (D4);
  - a linked add's chip shows in that step's list, because `consumes` holds the id
    (`quantity.ts:43-46`).
- A session started before an edit resumes with the same node ids, `graphId` and `endsAt` (N3 test, extended
  to a step edit plus a linked add).

### D11. Guards (hard rules)
Deep-equal before and after, on every web fixture plus the FGC-58 synthetic:
- the plan, stages, summary and `graph.stages`;
- node ids, `depends_on`, durations, `label`, `tip`, `kind`, `attention`.

Only two things differ, each tied to an edit:
- `instruction` on an edited node;
- `consumes` on a linked node.

The R6a A6 guard tests (`editsStore.test.ts:167-200`, `editsOpen.test.ts:138-149,262-300`) extend to a
`set_step_text` plus a linked add. No edited text and no `ing_user_` id may reach:
- a stored payload;
- the `/reprocess` body;
- metrics;
- a stored session;
- `planKey` or `graphId`.

Plus a session test with endsAt identical.

## W0 — data report only. STOP after W0 (B8). W0 must not run into W1; the owner reviews W0 before any render.
Prototype in the scratchpad (not committed). Frozen data only. Output to `notes/r6b/w0/report.md`.
1. For every web fixture (13) and every corpus recipe (4, via `reprocess()`), per recipe:
   - node count;
   - editable / non-editable per I1 (wait node, tips);
   - duplicate `instruction` groups (sizes);
   - Devanagari or Hinglish steps (any `\p{sc=Devanagari}`; Latin Hindi words);
   - leading or trailing whitespace, internal double spaces or newlines;
   - NFC ≠ NFD.
2. Reprocess determinism: on the 4 corpus recipes, whether `reprocess(original)` gives byte-identical
   `instruction`s twice, and against the committed web fixture where one exists.
3. Refresh survival on the 4 corpus recipes. One `set_step_text` and one linked add per recipe (generic
   target: the first editable node with a consumer). Then:
   - (a) `reprocess(original)` → applied;
   - (b) mutated originals: step text changed, step dropped, a duplicate inserted before it, an unrelated
     step dropped before a duplicated step (croissant). Report applied or orphan under D2 and under the R6
     k-th rule, side by side.
4. FGC-58: a synthetic original (built from a corpus original in code, with one step marked
   `origin: 'added'` that passes `_prepare_added_steps`), run through `reprocess()`. Then:
   - resolve;
   - refresh;
   - a variant that makes it dropped (a generic drop reason, e.g. an ungrounded time, `graph.py:1572`) →
     orphan.
   - Save the payload pair as candidate web fixtures in `notes/r6b/w0/out/` (committed only after W1).
5. Rename note reach: for every consumed ingredient, whether its full name appears (D9 matching) in the text
   of a step that consumes it. Count per recipe. This tells whether the note ever fires.
6. Real ingredient ids starting `ing_user_`, on all data (inventory 1).
7. Confirm `nextPreview` reads only `label`; re-grep that nothing keys, hashes or compares `instruction`
   (A6); confirm `textHasTimePhrase` is absent on main (it is, `stepNote.ts:26,34`).
8. `textHasTimePhrase` reach, by prototype:
   - the share of steps per recipe that would show the time note if edited unchanged (the typo-fix case);
   - B3: of the edited-step cases in items 3 and 4, how many would show the cooking-mode note.
9. The W0 test edits use D2 and B2 (verbatim apply). A stored text with an internal double space is
   applied byte-identical.

Then **STOP** for the owner. Do not start W1.

## W1 — option renders in the real app. STOP after W1 for the owner's picks (B8).
- The render harness (`notes/render-harness-r6/` copied to `notes/render-harness-r6b/`) runs on
  Playwright's own headless Chromium, never port 9222. Stop only your own PIDs.
- Contact sheets at 390 and 360, `notes/r6b/w1/`:
  - the Plan-tab entry options (a), (b), (c);
  - the step editor open, with "Imported:" and Restore;
  - the time note on and off, plus a typo fix on a timed step (4b noise);
  - B3: the cooking-mode task screen for an edited step with a time phrase, (i) bare and (ii) with the
    note line and no "Edited" mark;
  - B5: a collapsed stage card holding an edited step;
  - the Q8 label plus edited text;
  - a Hindi step edited;
  - the step picker on sabudana and kadhi, with "None" first (closed, and an open native select frame;
    headless Chromium, B6);
  - a linked add's chip in cooking mode, and its "You'll need" row;
  - the rename note, and the B4 "Edit the step" landing on the open step;
  - the step-orphan review lines;
  - a link orphan with both labels ("Discard this change" / "Remove the link");
  - the A1 line in the step editor;
  - the empty-text and too-long errors (copy candidates "Enter the step." / "Keep the step to 1000
    characters.", Q8);
  - collapse blocked by invalid input.

Then **STOP** for the owner's picks. Do not write tests or code before them.

## After the picks
1. `test:` red tests:
   - `recipeEdits.test.ts`:
     - resolve D2, overlay guards D11, orphans D5, FGC-58 on the committed fixtures;
     - B2: a stored double-space text round-trips and applies byte-identical; a malformed one is ignored
       and kept;
   - `stepEditor.test.ts`: normalisation only at commit;
   - `stepNote.test.ts`;
   - `ingredientEditor.test.ts`:
     - leave with a step open, and `'collapse'`;
     - the picker writes `step`, with "None" first;
     - the `overlay.added` fix with a real-shaped `ing_user_s_choice` (Q10);
     - B4: the blocked "Edit the step" stays put;
   - `editsOpen` / `editsStore` guard extensions;
   - the session test.
2. `feat(web)`: overlay for step text plus linked adds, `textHasTimePhrase`, the `overlay.added` fix, and the
   FGC-58 fixtures (LF, `git ls-files --eol`).
3. `feat(web)`: step editor state plus the shared session/hook.
4. `feat(web)`: the Plan-tab UI, Edited tags on steps, the picker, the rename note, the orphan review lines.
5. **HARD STOP A**:
   - proofs (below);
   - real-app frames: an edit → Save → Edited tag → Restore; a Hindi step; a linked add in "You'll need"
     and in cooking mode; an A24 exit with an invalid step (blocked + scrolled);
   - kadhi cooking mode with an edited step plus a linked add, no marks.
6. **A2** (owner fixes, if any).
7. `docs:`
   - DESIGN_SYSTEM "Edited" on steps, the picker and the notes;
   - this plan's status;
   - FGC-57 done (its "planned" status and the R6 plan's D2 anchor amendment line were set at setup, Q1);
   - FGC-58 tested on the web side;
   - FGC-59 text updated for the hook rename `useIngredientEditing.ts` → `useRecipeEditing.ts` (B7);
   - FGC-60 (tips not editable) logged (Q12);
   - "native select on a real iPhone" added to the cooking-mode-check list before M5 (B6).
8. **HARD STOP B**:
   - squash;
   - the exact file list;
   - a full-diff mojibake scan (Ã, â€, Â, U+FFFD);
   - `git ls-files --eol` LF;
   - `git status --short`;
   - PR body in `notes/r6b/pr-body.md`, pasted to chat. It calls out the `ing_user_` prefix fix as an R6a
     fix (Q10).
9. Push and PR only on the owner's word. Cleanup only after `gh pr view` says MERGED, after copying
   `notes/r6b/` and the harness to the main checkout.

## Proofs (HARD STOP A)
- ₹0: `git diff <base>..HEAD -- apps/api packages` is empty. If the work turns out to need a schema change,
  STOP and ask. None is expected: the op and `AddValue.step` exist.
- `vitest run` and pytest `-m "not llm and not network"`, base vs head with deltas. Baselines measured at
  setup (see Setup).
- `npm run lint` (`tsc -b && oxlint`).
- `stepNote` existing tests are unchanged, and the `TIME_PHRASE` source is equal.
- `quantityLine.golden.json` is unchanged. `__fixtures__` has `git diff --exit-code`, except new
  FGC-58 fixtures.
- `git status --short` at every stop.

## Critical files
- New:
  - `apps/web/src/library/stepEditor.ts` (+ test);
  - `plan/StepEditorBody.tsx`;
  - `plan/EditedTag.tsx`;
  - `plan/editorParts.tsx`;
  - `plan/useRecipeEditing.ts` (replaces `useIngredientEditing.ts`);
  - FGC-58 fixtures (Q11).
- Changed:
  - `library/recipeEdits.ts`;
  - `library/ingredientEditor.ts`;
  - `lib/stepNote.ts`;
  - `plan/{PlanScreen,StageCard,WaitWindowBlock,derive,EditableIngredientList,IngredientEditorBody,OrphanReview}.tsx/ts`;
  - `App.tsx`, only if `editing` needs the step parts.
- Docs:
  - `docs/plans/r6b-step-text-editing.md` (this file);
  - `docs/plans/r6-tier-a-editing.md` (status line, D2 anchor amendment);
  - `docs/plans/followup-golden-corpus.md` (FGC-57, FGC-58, FGC-59, FGC-60);
  - `docs/DESIGN_SYSTEM.md` (at the docs commit).

## Setup (done in the planning session)
- Worktree from `origin/main` @ `f2413f2`, upstream unset, `npm ci` in `apps/web`.
- This file, the R6 status line and D2 amendment, and FGC-57's status, in one docs commit.
- Baselines: see the setup report (recorded here at the first STOP).

## Carried rules
- Non-ASCII through Write/Edit only, never heredocs or `\u` escapes. A full-diff mojibake scan at HARD
  STOP B.
- Stage explicit paths only. `git status --short` at every stop.
- `/notes/` is excluded from git: copy `notes/r6b/` and the harness to the main checkout before removing the
  worktree.
- `make` doesn't run in a worktree. `json2ts` runs from the main install (not expected to be needed).
- No two file names that differ only by case.
- No jsdom: pure helpers plus real-browser frames. `npm run lint` = `tsc -b && oxlint`.
- Frozen data only. No YouTube, no deploy, no phone runs.
- Absolute PYTHONPATH. Never run `ruff format .`. Stop only your own PIDs.
- Every fix is generic: no recipe names in logic, only in tests.

## Risks
1. **Contradiction between text and timer (wrong-advice territory).** "Cook 15 min" edited over a 10-min
   node keeps a 10-min timer. The page note covers the plan (Q4 (b)). Cooking mode is B3's W1 decision:
   (i) bare, or (ii) the note line. W0 item 8 sizes how often it applies.
2. **Duplicate-step behaviour (D2, B9).** Croissant-style twins can re-target to an identical sibling, or
   orphan when their index shifts with no copy at the old slot. Rare (1 of 14 distinct recipes), measured
   in W0 and pinned by tests. FGC-61 if a mis-target is ever reported.
3. **The time note fires on a typo fix.** W0: a numeric time phrase is in 17 of 133 steps (13%), and B10
   adds words-only times. W1 renders a typo fix on a timed and an untimed step so the owner can judge the noise.
4. **The rename note may rarely fire** if step text uses short names ("ginger" vs "Fresh ginger root").
   W0 item 5: 99 of 149 consumed ingredients match strictly; B11 widens it (about 114).
5. **Native `<select>` on iOS** shows a wheel that truncates long options. Labels are short, but duplicates
   carry text. W1 shows only headless Chromium (B6). The real-iPhone check is on the pre-M5 list.
6. **One shared edit hook across tabs** widens the R6a hook, which has no DOM test (FGC-59). Its rules stay
   in pure functions. Real-browser frames carry the wiring.
7. **The `overlay.added` fix touches R6a code paths.** A regression risk on remove and restore. Covered by the
   existing tests plus a new real-id-`ing_user_` case.

## Questions (answered 2026-10-20; see "Owner answers and amendments" at the top)

Kept for the record. The answers above win. The W1 items (Q3 label, B3, Q8 copy, Q5, 4b, B5) are all
decided in "W1 picks".

1. **Step resolve rule.** D2: exact text, a unique match anywhere, duplicates only at the exact index, else
   orphan. Kept after W0 (B9): D2 can still land on an identical-text twin or copy; the tests pin it.
2. **The serving-wait node (`step_wait_before_serving`) editable?** Recommended no: generated timing text,
   unstable across PPV. The lead step stays editable.
3. **A linked add whose step orphaned.** Recommended (a): the add stays (unlinked), plus a link-orphan line
   whose button unlinks it.
4. **Time note placement**: (a) in the editor only; (b) the editor plus the page under the edited step.
   Recommended (b), because the page row shows the old duration beside new text.
   4b. Keep Q7 literal (any time phrase), not "only when the time phrases differ from the imported text"?
   Recommended literal Q7.
5. **Plan-tab entry.** Recommended (a): one Edit control on the Plan tab sharing one edit session. Entering
   edit mode expands all stages, and a tab switch leaves edit mode as in R6a. W1 renders (a), (b) and (c).
6. **Servings and step text.** Recommended: the cook writes amounts as written, and the step editor shows
   the A1 line verbatim (`asWrittenLine`). The R4 note then runs on the edited text.
7. **Rename note.** Recommended D9:
   - only when a consuming step's text has the old name (case-insensitive, word-bounded,
     Devanagari-safe);
   - under the saved row;
   - "Edit the step" a link only when exactly one step matches;
   - the remove warning unchanged.
8. **Step text normalisation.** Recommended: trim plus collapse whitespace runs (newlines included) to one
   space, at commit only (B2). Text equal to the imported text (normalised) stores no edit and deletes an
   existing one. Error copy at W1; no hard `maxLength`.
9. **Picker form.** Recommended a native `<select>`:
   - stage `<optgroup>`s, in plan order;
   - the label, disambiguated with the start of the text only on duplicate labels;
   - "None" first and the default (Q9);
   - editable on an added row afterwards.
10. **The `ing_user_` prefix bug** in R6a (inventory 1). Recommended fixing it in R6b (membership in
    `overlay.added`, plus a test), because R6b's linked adds use the same paths and it breaks A24.
11. **FGC-58 fixtures.** Recommended committing the W0-generated synthetic added-step payload, plus its
    dropped variant, as web fixtures (web-only, ₹0). The API side's test of `reprocess` on an added step
    stays with the FGC-3 PR.
12. **Tips.** Not editable in R6b. Recommended logging FGC-60 ("edit a tip / optional step") rather than
    adding an op.
