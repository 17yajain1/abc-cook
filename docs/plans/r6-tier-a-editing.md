# R6 — Tier A editing (ingredients and step text, no timing change)

**Status (2026-10-20): R6a implemented** (ingredient editing, branch `feat/r6-tier-a-editing`, not yet
merged). **R6b not started** (step text, "Which step uses it?", the A5 rename note). Follow-ups: FGC-54 to
FGC-59 in `docs/plans/followup-golden-corpus.md`.

## Owner answers and amendments

Owner answers and amendments, R6 plan (2026-10-19). These win over the plan body.

Answers
Q1: Yes, route (ii): post-schedule web overlay. Add a dated amendment line to
    fix-saved-recipe-staleness.md B5 and reword the RecipeEdit docstring. W0 still runs
    (i) vs (ii) per recipe as evidence.
Q2: Yes. Step anchor = expected text against node.instruction, index as tiebreak.
    Ingredient anchor = index into graph.ingredients. W0 verifies the 1:1 claim (A11).
Q3: Yes, editable like the rest.
Q4: No Edit entry point on unsaved views in R6. Log a follow-up (A12).
Q5: No lock. A cook may need to fix an amount mid-cook. Edits reach cooking mode on the
    next entry.
Q6: Drop `as_written` from the union. Amount = number/range or "to taste". Unit picker =
    the imported unit first (if outside the list), then the closed list, plus "No unit"
    (e.g. "2 eggs"). No free-text unit in R6.
Q7: Show the note only when the edited text contains a time phrase, using the SAME helper
    as R4's A4 step-note rule (one rule, not two).
Q8: Label stays as imported. W1 renders a stage card with the label plus edited text so
    I can see whether it reads wrong.
Q9: Report at W0 how ingredientGroups places rows. Linked: in that step's group if
    grouping does it naturally, else end of list. Unlinked: end of list.
Q10: Private. The public feed (H2) shows the imported plan.
Q11: R6a/R6b vertical, with orphan review moved into R6a (A3).
Q12: Render all three. U2 limited to the Ingredients tab plus one expanded stage card.

Amendments
A1. The editor always edits as-written amounts (factor 1), whatever servings_choice is.
    When the choice is not "as written", show one line in the editor; proposed copy
    "Amounts here are as written, for N servings." (batch variant: "Amounts here are as
    written."). Copy decided at W1. Test: edit at 2 of 4 servings, then the stored edit
    holds the as-written value and the view shows it scaled.
A2. Amount input: decimal entry plus fraction buttons 1/2 1/4 3/4 1/3 (rendered as ½ ¼ ¾ ⅓),
    and an optional second field for a range. qty_text is built with the same formatter
    scaleQuantity/R4 use (cooking fractions, never 0.33). Validation: low > 0, high > low,
    inline error copy rendered at W1.
A3. Orphan review with "Discard this change" ships in R6a. R6b = step-text editing plus
    "Which step uses it?" only.
A4. Tapping an "Edited" tag on the recipe page opens the editor at that item, where
    "Imported: …" and "Restore original" sit.
A5. Copy must not say "chip". It must be honest that step text doesn't change. Render
    candidates at W1, e.g. remove: "Used in 2 steps. It comes off their ingredient
    lists; the step text stays as written." Rename: "Step text still says the old name.
    Edit the step if you like." (R6b makes that actionable; in R6a decide whether to show
    it at all.)
A6. W0 inventory with file:line: every consumer of graph.ingredients, node.consumes,
    node.instruction and the whole payload, including metrics/analytics emits, any
    hash/fingerprint/equality check (conflict, staleness, dedup), the /reprocess request
    body, export/share. Prove the overlaid payload reaches none of storage, metrics or
    server. The guard test covers all of them, not just saveCurrent.
A7. W0 reports, per recipe with scalable == 0 (e.g. sabudana), the servings-control state
    after one amount edit. W1 renders that state. I decide then whether it's acceptable.
A8. setEdits write failure: copy "Couldn't save your change. Try again.", the editor stays
    open, input kept. Test it.
A9. No "Edited" markers in cooking mode, only the edited values.
A10. Test: a session started before an edit resumes with the overlaid payload (no
    conflict, same node ids, timers intact).
A11. W0 verifies "graph.ingredients index == original.recipe.ingredients index" on every
    fixture and corpus recipe. Any mismatch: report and STOP.
A12. Follow-ups (not R6): edit count as an M5 trust signal; "Save to edit" for unsaved
    views; kg / l / oz / lb in the unit list if testers ask.

Added after the W0 review (2026-10-20). These win over the body and over A6, A7 and N4.

A13. Servings gate reads the imported payload, never the overlaid one. Edits can't
     switch the servings control between gated and live. The gated state keeps the copy
     R4 shipped; no new wording. On a scalable recipe, edited amounts scale like any
     other line. Test: a gated fixture plus one amount edit stays gated; a live fixture
     plus one edit scales the edited line.
A14. Added ingredients: render two variants at W1. (a) Added rows in their own group at
     the end of the Ingredients tab, heading proposed "Added by you". (b) Added rows at the
     very end with an "Added" tag and no heading. Show both on sabudana (mid-list
     ungrouped bucket) and kadhi. "You'll need" keeps linked adds as the last row of
     that stage.
A15. Unit picker: the imported unit verbatim first (no renaming: "teaspoon" stays
     "teaspoon", "cup (125 g)" stays as is), then the closed list (tsp, tbsp, cup, g, ml,
     pinch, piece, inch, clove), then "No unit". Shown once if it matches a list item
     case-insensitively. An imported unit "to taste" maps to the "to taste" amount mode,
     not a chip. W1 renders the picker for "teaspoon", "cup (125 g)" and a "to taste"
     Salt row.
A16. "Imported: ..." = exactly the string the unedited row renders at factor 1, from the
     same function the row uses (covers lines with qty but no qty_text).
A17. Tests added: an edited amount with qty_amount.rest '' scales by unit class from unit
     alone; "No unit" scales exactly like an imported unitless line; guards that
     openImported and openFeedRecipe keep origin.payload raw (no shared object with
     the overlaid view.payload).
A18. Follow-up for FGC-3: step anchors on "Added by ABC Cook" steps were not observable
     in W0 (no captures have added steps). FGC-3's PR must test an edit on an added step.

Added after the W1 review (2026-10-20). These win over the body, over B3 and over the W1 section.

A19. Pick U2 (edit mode in place). Entry: the "Edit" control on the Ingredients tab, and
     the A4 tap on an "Edited" tag enters edit mode with that row open. Add is the inline
     form at the end of the list (no U3 sheet). R6b will edit step text inside the
     expanded stage cards with the same pattern.
A20. A14 (a): added rows in their own "Added by you" group at the end of the Ingredients
     tab, as rendered in c-added-a-sab / c-added-a-kad.
A21. A5 rename note ships in R6b only. The remove warning ships in R6a as rendered.
A22. Copy approved: A1 lines ("Amounts here are as written, for N servings." / batch
     "Amounts here are as written."), errors ("Enter an amount above 0." / "The second
     number must be bigger."). Orphan review: title "Changes that couldn't be applied"
     (matches the notice); body and per-item lines as rendered ("Your change: ..." /
     "The imported recipe now says: ..." / "Discard this change"). No "apply anyway".
A23. Amount field behaviour: a fraction button sets the fractional part: empty -> "½",
     "1" -> "1½", "1½" + ¼ -> "1¼" (replaces, never adds). Typed decimals are accepted;
     after commit the value is shown via the shared formatter. Prefill: an imported line
     with qty_amount is prefilled formatted ("1½", never raw "1 1/2"); a line without
     qty_amount opens with an empty field and "Imported: ..." showing the original. Tests
     for each case.
A24. No edit is lost silently. Each open row commits with its own control. When a dirty
     row is open and the cook taps edit-mode Done, switches tab, taps Start cooking or
     goes back: valid input commits; invalid input keeps the row open with its inline
     error. Test each path as a pure state transition. Edit-mode Done stays reachable on
     kadhi's 30-row list (show it at HARD STOP A).
A25. HARD STOP A also shows cooking mode on kadhi with one edited amount and one removed
     ingredient: chips show the edited value, the removed one is gone, no "Edited"
     markers (A9).

Added after HARD STOP A (2026-10-20). These win over the body and over A5, A15, A23 and A24
where they differ.

A26. Restore a removed ingredient: in edit mode, removed rows appear in a "Removed by
     you" group at the end of the list (name + imported amount, muted), each with
     "Restore original" (deletes the remove edit). With restore available, removing an
     ingredient that no step uses happens without the Remove/Keep confirm; the confirm
     stays only when a step uses it. Real-browser frames: remove -> group -> restore.
A27. Remove warning plural: n = 1 -> "Used in 1 step. It comes off that step's ingredient
     list; the step text stays as written." n > 1 -> "Used in N steps. It comes off their
     ingredient lists; the step text stays as written."
A28. formatAmount snaps only exact cooking-fraction equivalents (.5, .25, .75, .33/.333,
     .67/.667, and whole numbers); anything else is shown as typed, up to 2 decimals.
     Tests: "12" g -> "12 g", "1.2" -> "1.2", "0.33" -> "⅓", "2.5" -> "2½", "1.25" -> "1¼".
     scaleQuantity stays untouched.
A29. The open row's commit button reads "Save"; the edit-mode toolbar button stays
     "Done".
A30. Copy: name errors "Enter a name." / "Keep the name to 80 characters." approved.
     Orphan review, when the imported recipe has no line at that position: "The imported
     recipe no longer has this ingredient." "Imported:" name and amount on separate lines
     approved.
A31. A name-only edit on a line with no amount commits without touching the amount
     (test). A unit change with an empty amount stays blocked with "Enter an amount above
     0."
A32. Real-browser frames for the A24 exits not yet shown: switch tab with a dirty valid
     row (commits), back with a dirty invalid row (blocked, stays open with its error).
     When Start cooking or a tab switch is blocked, the open row scrolls into view.
A33. Explain a09: why the Butter "cup (125 g)" line opens with an empty amount (expected:
     no qty_amount on that line), and show its "Imported: ..." line in the frame.

STOP after W0. W0 must not run into W1. I review W0 before any render.

Approved 2026-10-19 with the amendments above.

### Implementer notes (2026-10-19)

- **N1. Time note (Q7).**
  - `lib/stepNote.ts:17-23` keeps `TIME_PHRASE` private, and it also matches temperatures
    (`°`, `degrees`).
  - R6 exports `textHasTimePhrase(text)` from `stepNote.ts`. It is built from the same
    `NUMBER` / `RANGE` constants and a time-only word list: min, hr, sec and the Hindi मिनट, घंटा,
    घंटे, सेकंड. No degrees, no degree signs. `TIME_WORDS` is split into time words plus
    degree words, so both rules share one vocabulary.
  - `TIME_PHRASE` has the `g` flag. The new helper builds a fresh `RegExp` per call (or uses
    `String.prototype.search`), never `.test()` on a shared global instance (its `lastIndex`
    would carry over).
- **N2. `qty_text` formatter (A2).**
  - `lib/scaleQuantity.ts` formats with private `FORMATTERS` / `snap`.
  - R6 exports the formatter it already uses for one amount, so the editor writes ½, never 0.5
    or 0.33. It is not copied.
  - Base `scaleQuantity` output must stay byte-identical: `quantityLine.golden.json`
    unchanged.
- **N3. Session test (A10).**
  - Pure: a stored session plus `engine.open` against `deriveCookingModel(applyEdits(payload,
    edits))`.
  - Asserts: no conflict, node ids equal, `running` `endsAt` unchanged.
- **N4. Servings gate (A7).** An edited amount carries a `qty_amount`, so `scalability().scalable`
  can go from 0 to 1 and `servingsGate` from `gated` to `live`. W0 measures this per recipe; W1
  renders it.
- **N6. Effect of A13 (2026-10-20).** N4 and A7 no longer apply: an edited amount cannot flip
  `servingsControlKind` from `gated` to `servings`. The gate (`servingsControlKind`,
  `panelServings`, `startChoiceFor`) is computed from the imported payload's ingredients, so the
  overlay needs to supply it separately from the payload that feeds the rows. On a recipe that is
  already scalable, an edited amount carries a `qty_amount` and scales like any other line. On a
  gated recipe the edited line stays as written. W0 measured the flip (report section 6) and it is
  moot now.
- **N7. W0 facts the amendments rest on (2026-10-20).** `notes/r6/w0/report.md` (untracked): A11
  held on 4 of 4 recipes with an `original`; the 9 other web fixtures have none (A18). A mid-list
  ungrouped bucket exists in sabudana and strawberry-shortcake (A14). Unit strings seen include
  `teaspoon`, `cup (125 g)` and `to taste` (A15). 59 of 141 web-fixture lines have `qty` and no
  `qty_text` (A16).
- **N8. R6a scope after W1 (2026-10-20).** U2 in place (A19), "Added by you" group (A20), no rename
  note (A21), no step editing and no step picker (R6b). The Add form at the end of the list takes
  name, amount and unit only, and creates an `add_ingredient` with `step: null`. The editor is a
  pure state machine (`library/ingredientEditor.ts`) so A23 and A24 test without a DOM. The gate
  for the servings control is computed from the imported payload (A13), so `App` keeps the raw
  payload beside the overlaid one.
- **N9. Added rows keep the confirm (2026-10-20).** A26 drops the Remove/Keep confirm for an imported
  ingredient no step uses, because "Restore original" can bring it back. Deleting a row the cook
  *added* removes its `add_ingredient` edit for good, so it cannot be restored; that remove keeps the
  confirm.
- **N10. Deviations from the plan as written (R6a).**
  - Commit list: the plan had five code commits. Actual: red tests, schema union plus `make types`,
    overlay plus `setEdits` plus the formatter plus the imported-payload gate, the editor state machine,
    then the UI and open-path wiring (one commit, because they share `PlanScreen`), a fix, and a second
    round of red tests and fixes after HARD STOP A. The branch is squashed at HARD STOP B.
  - N2 (export the scaler's formatter) is superseded by A28: `formatAmount`, `snapAmount` and
    `formatAmountRange` share the scaler's fraction table but never round a typed number to a coarser
    measure. `scaleQuantity` and `quantityLine.golden.json` are unchanged.
  - The editing hook (`plan/useIngredientEditing.ts`) has no DOM test (no jsdom in this repo). Its rules
    are the pure functions in `library/ingredientEditor.ts`, tested as state transitions; the wiring was
    checked in the real app (HARD STOP A and A2 frames).
- **N5. Docs.**
  - A dated amendment line under `fix-saved-recipe-staleness.md` B5: route (ii), the overlay is
    applied after schedule, anchors as Q2.
  - The `RecipeEdit` docstring in `schema/library.py` is reworded to match.

---

## Context
The owner approved Tier A editing as R6, before M5 (decisions-2026-10-15, Decision 2): a tester
who can't fix "4 tbsp" to "1 tbsp" stops trusting the plan. Decision 3 says edits are stored as a
patch over the imported original, so a POSTPROCESS bump or a refresh replays them and never
overwrites them. `SavedRecipe.edits` and a placeholder `RecipeEdit` exist (staleness B5), and
nothing writes them yet.

Read from `origin/main` @ `8d87408` (R5 merged, #73). PPV = 14 (`extract/cache.py:212`). ₹0.
Worktree `C:\Users\ashya\Music\abc-cook-r6`, branch `feat/r6-tier-a-editing`.

## Where the inventory contradicted the brief and earlier docs
1. **B5's `payload = postprocess(apply(edits, original))` breaks "no timing change".**
   `build_graph` derives structure and timing from exactly the fields Tier A edits:
   - step text → node id (`graph.py:1809`), kind and stage (`:1866-1867`), verified duration
     (`_verify_duration` `:913-949`), the serving-wait node (`:2126`);
   - ingredient name → ingredient id (`:1756`), step resolution (`:1070-1144`) and the
     independence edges (`:1184-1244`, `:1913-1921`);
   - an added ingredient with no step → invariant 5 (`validate.py:191-206`) → the replayed
     proposal can't fix it → a linear degrade of the whole plan (`repair.py:333-348`);
   - removing an ingredient that an added step consumes drops that step (`graph.py:1567-1571`).

   Resolved by Q1: route (ii).
2. **Steps are not 1:1 with nodes.** Optional steps become tips (`:1800-1802`, `:1982-1989`),
   added steps can be dropped (`:1749`), and a serving-wait node can be inserted
   (`:2126-2171`). Ingredients are 1:1 in order (`:1755-1781`). Resolved by Q2.
3. Entries with no `original` have no `ImportOriginal` index space. Resolved by Q3: they are
   editable through the `graph.ingredients` index.
4. "Hindi units (D5)" is about duration units for grounding only. No Hindi ingredient unit is
   normalised (pr-c-ingredients-hindi-units.md:29-31).
5. 12 of 13 web fixtures carry a unit outside the closed list (`cups`, `l`, `large`, `medium`,
   `handful`, `whole`, `nos`, `no`, `cake`, `sachet`, `oz can`). Resolved by Q6.
6. Test baseline: re-measured at setup (below).

## Step A — inventory (origin/main @ 8d87408)

### A1. The edits slot
- `schema/library.py:33-47`: `RecipeEdit {id, created_at, op: str, anchor: JsonValue, value:
  JsonValue}`.
- `SavedRecipe.edits = []` (`:121-124`). Exported at `schema/__init__.py:21-22,84`. Tested at
  `tests/test_schema.py:254`.
- Generated: `packages/schema/index.ts:1144,1275`; `schema.json:1537,1734`.
- Web code passes edits through and never reads them:
  - `store.ts:116` (replace keeps them), `:129` (new entry `[]`);
  - `refresh` via `...existing` (`:158-164`);
  - `migrateEntry` keeps the array verbatim (`:227`); v1→v2 runs through it (`:215`).
- Not model-facing:
  - nothing in `extract/` imports `library` (the only hit is the docstring in
    `extract/source_key.py:1`);
  - the cache `result_type` is `ImportResult` (`cache.py:270,342`);
  - `library.py` is not PPV-watched.

### A2. Refresh paths
`refresh` (`store.ts:151-171`) keeps `edits` and writes a payload derived from the unedited
original. Under route (ii):

| Path | Code | Edited recipe |
|---|---|---|
| Silent refresh (3 s) | `openSaved.ts:116-135` → `POST /recipes/reprocess` (`recipes.py:186-240`) | new payload, edits re-applied at open; mismatch → orphan |
| Budget / offline / 5xx | `openSaved.ts:121-126` | stored payload plus overlay |
| Active session (B4a) | `openSavedNow` `:48`, `staleness.ts:112-115` | overlay on the stored payload; node ids untouched |
| Feed replacement | `openSaved.ts:105-114` | re-applied by index and expected value |
| Re-import | `save` replace keeps edits (`store.ts:108-118`) | re-applied; shifted lines → orphans |
| Duplicate-URL open | `import/duplicate.ts` → `openSaved` | overlay applied |
| Header Save | `App.saveCurrent` writes `prev.origin.payload` (`App.tsx:345-361`) | stays raw (guard test) |

### A3. Postprocess
Quantity and unit only feed `Ingredient.{qty, qty_text, qty_amount, unit}` (`graph.py:1773-1776`).
Name, step text, add and remove all reach structure (see contradiction 1).

### A4. Quantities
- Server side:
  - `_parse_qty` (`graph.py:245-283`);
  - `qty_text` verbatim;
  - `qty_amount = parse_amount` (`extract/quantity.py:91`; `QtyAmount` at
    `schema/ingredient.py:6-26`).
- Web side:
  - `scaleQuantity` reads `qty_text`, `qty_amount` and `unit` (`lib/scaleQuantity.ts:146-163`);
  - `quantityTrailingScaled` (`lib/quantity.ts:82-96`) feeds the Ingredients tab
    (`plan/ingredientGroups.ts:28-47`) and the step ingredient list
    (`cooking-mode/quantity.ts:34-81`);
  - the scalability gate is `lib/servings.ts:163-186`.
- An edited amount comes from structured input, so the web builds `qty_amount = {low, high?,
  prefix:'', rest:''}` directly. Nothing parses text, and no port of `parse_amount` is needed.

### A5. Step ingredient lists
- `node.consumes` → an `ing_*` id → the row (`cooking-mode/quantity.ts:43-49`). Missing ids and
  ids that aren't `ing_*` are skipped (`:44-46`).
- "You'll need" = ingredients filtered by the stage's `consumes` (`plan/derive.ts:227-232`).
- The web reads `consumes` for display only: quantity.ts:43, `cooking/model.ts:72`,
  derive.ts:230.
- Effect of each edit:
  - **Rename:** the id is unchanged, so the new name shows everywhere.
  - **Remove:** the overlay drops the row, so it leaves both lists.
  - **Add with a step:** `ing_user_<editId>` is appended to that node's `consumes` in the overlay
    copy only.
- "A step uses it" = some `node.consumes` holds the id.

### A6. Render sites (all read `payload.graph`)
- Ingredients tab: `IngredientsPanel` → `IngredientList` → `IngredientRow`.
- Step text: `StageCard.tsx:235-237`, `WaitWindowBlock.tsx:114-116` (via `derive.ts:215`).
- "You'll need": `StageCard.tsx:159-170`.
- Cooking mode: `viewModel.ts:452,460,507,535-536,582,589` (via `cooking/model.ts:64`).
- The overlay is applied once at open (`App.tsx:136-167`, `goToConflict` `:309-316`,
  `openImported` `:236-246`).
- The full consumer inventory (A6 amendment) is a W0 deliverable.

### A7. Locks
`servingsLocked` (`staleness.ts:101-104`), `cookOnRecipe` (`plan/endOfPage.ts:89-96`), B4a 24 h
(`staleness.ts:23`). No lock for edits (Q5): node ids and durations never change.

### A8. No `original` / unsaved
- Feed, legacy and `withoutOriginal` entries are editable (Q3).
- Unsaved views have no entry point (Q4): `server:` fixtures, an unsaved feed plan, a failed
  auto-save; `persistTargetId` → null.

### A9. Units
The picker order is:
1. the imported unit, verbatim, if outside the list;
2. `tsp tbsp cup g ml pinch piece inch clove`;
3. "No unit".

"To taste" is an amount mode. No free-text unit and no conversion. `UNIT_CLASSES` already scales
`kg`, `l`, `katori` and similar when they are imported.

### A10. Design references
- `docs/design/recipe-page-study/` frames 0a–5: **no editing frame and no Figma for editing.**
- Frame 4 has no Edit affordance.
- Frame 3's tick-boxes reserve a row tap for ticking.

### A11. Baseline and harness
- Store, openSaved and quantity tests, plus `test_schema.py:254`.
- Harness: `notes/render-harness-r5/` (main checkout, untracked).
- Counts: see Setup.

## Step B — design

### B1. Route (ii): web overlay after schedule (Q1)
- `applyEdits(payload, edits) → {payload, statuses}` in a new `library/recipeEdits.ts`. It is pure
  and never mutates its input.
- It changes only:
  - `Ingredient.{name, qty, qty_text, qty_amount, unit}`;
  - ingredient rows removed or added;
  - `ing_user_*` appended to an overlay node's `consumes`;
  - `node.instruction`.
- It never touches `plan`, `stages`, `summary`, durations, `depends_on`, ids or `label` (Q8).
- The overlaid payload goes into `view.payload` and `view.plan` only. `SavedRecipe.payload` stays
  the server-derived copy.

### B2. The op union (Pydantic `schema/library.py`, then `make types`)
Discriminated on `op`. Every member has `id` and `created_at`.

```
IngredientAnchor = {index: int ≥ 0, expected: {name: str, qty_text: str|null, unit: str|null}}
StepAnchor       = {index: int ≥ 0, expected: {text: str}}
Amount           = {kind:'number', low: float > 0, high: float|null (> low)} | {kind:'to_taste'}

set_ingredient_name    {anchor: IngredientAnchor, value: {name: str (1..80, trimmed)}}
set_ingredient_amount  {anchor: IngredientAnchor, value: {amount: Amount, unit: str|null}}
remove_ingredient      {anchor: IngredientAnchor}
add_ingredient         {value: {name, amount: Amount|null, unit: str|null, step: StepAnchor|null}}
set_step_text          {anchor: StepAnchor, value: {text: str (1..1000, trimmed)}}
```

`unit: null` = "No unit". `to_taste` stores `unit: null`.

**Anchors (Q2).**
- Ingredient `index` = position in `payload.graph.ingredients`. This equals the original index
  whenever an original exists; W0 verifies it (A11).
- A step anchor resolves to the node whose `instruction` equals `expected.text`. With duplicates,
  the k-th match, where k is the number of duplicates before `index`. Not found → orphan.

**One edit per target.**
- A new `set_*` replaces the same op on the same anchor, in place.
- **Restore original = delete the edit.**
- `remove_ingredient` deletes that row's `set_*` edits; Restore on it deletes the remove.
- An added row is edited by rewriting its `add_ingredient`, and removed by deleting it.

**Orphans.**
- Computed at apply time, never stored, never dropped and never force-applied.
- Unknown or malformed items are `ignored`: kept verbatim, not counted.
- The only user-initiated drop is "Discard this change" in the orphan review (R6a, A3).

**Schema.**
- `SavedLibrary` stays v2; `migrateEntry` is unchanged (it keeps `edits` verbatim). No PPV bump.
- After `make types`: restore any CRLF-only fixture rewrites, convert the generated files to LF,
  and check `git ls-files --eol`.

### B3. UI options (W1 renders all three; the owner picks)
- **U1. Edit recipe screen (lean).**
  - Entry: "Edit recipe" in the header area and in "Where this came from".
  - Full screen, Home register. Ingredients get structured rows plus "Add ingredient". Steps get a
    text area each (R6b).
  - Done / Cancel.
- **U2. Edit mode in place.** An "Edit" toggle on the Ingredients tab, plus one expanded stage card
  (Q12: limited to these).
- **U3. Per-item sheet.** A pencil per row or step in an Edit state opens a bottom sheet: amount
  input, unit chips, Remove, Restore original.

**Common to all options.**
- Edited rows and steps carry an "Edited" tag (13 px, `text-home-ink-2`). Tapping it opens the
  editor at that item (A4), where "Imported: …" and "Restore original" sit.
- No markers in cooking mode, only the edited values (A9).
- **Amount input (A2):**
  - decimal entry plus fraction buttons ½ ¼ ¾ ⅓;
  - an optional second field for a range;
  - a "To taste" mode;
  - inline errors when low ≤ 0 or high ≤ low.
- The editor works at factor 1 (A1). When the choice isn't as written, it shows one line (copy
  table).
- **Remove warning (A5):** only when a step's `consumes` holds the id. No "chip" wording anywhere.
- **Time note (Q7, N1):** shown under an edited step only when the new text has a time phrase.
- **Write failure (A8):** inline error; the editor stays open and the input is kept.
- W1 also renders:
  - a stage card with the imported label next to edited text (Q8);
  - the servings control after an amount edit on a `scalable == 0` recipe (A7).

### B4. Split (Q11, A3)
- **R6a:**
  - schema union (`make types` once), `recipeEdits.ts`, store `setEdits`, overlay at every open
    path;
  - "Edited" markers (tap → editor);
  - orphan notice **and** orphan review with "Discard this change";
  - ingredient editor: name, amount, unit, remove with warning, add **without** a step link.

  Alone: nothing is broken; step text is not editable and adds carry no step link.
- **R6b:** step-text editing (with the N1 time note) and "Which step uses it?" on add. Needs R6a.

## Copy table (candidates; final at W1)
| Where | Text |
|---|---|
| Entry point | Edit recipe |
| Marker | Edited |
| Under the field | Imported: {original} |
| Restore | Restore original |
| Factor ≠ 1 (A1) | Amounts here are as written, for {N} servings. / batch: Amounts here are as written. |
| Amount errors (A2) | rendered at W1 (low > 0; the second number must be bigger) |
| Unit picker | {imported unit} · tsp · tbsp · cup · g · ml · pinch · piece · inch · clove · No unit |
| Amount mode | To taste |
| Remove warning (used) | Used in {n} step(s). It comes off their ingredient lists; the step text stays as written. |
| Remove buttons | Remove · Keep |
| Rename hint (A5, R6a: show or not, decided at W1) | Step text still says the old name. Edit the step if you like. |
| Add | Add ingredient |
| Step picker (R6b) | Which step uses it? (optional) · None |
| Orphan notice | 1 of your changes couldn't be applied. / {n} of your changes couldn't be applied. |
| Orphan review | Discard this change |
| Write failure (A8) | Couldn't save your change. Try again. |
| Step time note (R6b) | Timers stay as planned. Changing times comes later. |

## Critical files
- **API:**
  - `apps/api/abc_cook/schema/{library,__init__}.py`, `apps/api/tests/test_schema.py`;
  - `packages/schema/{schema.json,index.ts}` (generated).
- **New web modules:**
  - `apps/web/src/library/recipeEdits.ts` (+ test): `applyEdits`, `upsertEdit`, `restoreEdit`,
    `discardEdit`, `stepUsage`, `amountFields`;
  - `apps/web/src/library/store.ts` (+ test): `setEdits`.
- **Shared helpers, extended:**
  - `apps/web/src/lib/scaleQuantity.ts`: export the one-amount formatter (N2);
  - `apps/web/src/lib/stepNote.ts`: `textHasTimePhrase` (N1, R6b).
- **App.tsx:** overlay at `show`, the library branch of `goToConflict` and `openImported`;
  `origin.payload` stays raw.
- **UI:**
  - the editor component(s) of the picked option;
  - `ingredientGroups.ts` / `IngredientList` (`edited` flag);
  - `StageCard` / `WaitWindowBlock` (marker);
  - an orphan notice and review.
- **Reuse:** `persistTargetId` (`servingsPersist.ts`), `quantityTrailingScaled`, `joinQtyUnit`,
  `choiceFactor`, `servingsCopy`.
- **Naming:** no two file names differing only by case.

## Commit list
R6a:
1. `test:` red tests.
2. `feat(schema): RecipeEdit op union` + `make types` (LF fixups).
3. `feat(web): applyEdits overlay + store setEdits`.
4. `feat(web): apply edits on open; Edited markers; orphan notice and review`.
5. `feat(web): ingredient editor (name, amount, unit, remove, add)`.
6. **HARD STOP A.**
7. `docs:` B5 amendment line, plan status, DESIGN_SYSTEM "Edited".
8. **HARD STOP B:** squash.

R6b: the same shape for step text and "Which step uses it?".

## Tests (red first; no jsdom)
**`recipeEdits.test.ts`:**
- every op applies;
- **plan, stages, summary, node ids, durations and `depends_on` are deep-equal before and after,
  on every web fixture**;
- anchor mismatch → orphaned, kept, that item renders as imported;
- duplicate step text → k-th match; unknown or malformed → ignored and kept;
- remove → gone from step lists and "You'll need"; add with a step → that node only; add
  without → none;
- amount builder:
  - number, range and to taste;
  - `qty_text` uses the cooking-fraction formatter (½, never 0.5 or 0.33; N2);
  - an imported unit outside the list is kept; "No unit" gives `unit: null`;
  - an edited amount scales through `scaleQuantity` and flips the scalability gate (A7, N4);
- `upsertEdit` replaces in place; restore deletes; remove clears that row's `set_*`; discard
  deletes an orphan.

**Store, servings, guard and session tests:**
- **A1:** an edit made at 2 of 4 servings stores the as-written value; the view at factor 0.5
  shows it scaled.
- **`store.test.ts`:**
  - `setEdits` keeps `updated_at`, `saved_at` and the order;
  - **A8:** a throwing storage → `{ok:false}` with "Couldn't save your change. Try again.", the
    list unchanged, the editor model keeps its input;
  - replace and refresh keep edits verbatim;
  - a shifted line after a refresh → 1 orphan.
- **`openSaved.test.ts`:** reprocess refresh, feed replacement and active-session open each give an
  overlaid view with the right orphan count.
- **Guard (A6):** no `ing_user_` id and no edited value in:
  - any stored payload (save, refresh, `setServingsChoice`, `setEdits`);
  - the `/recipes/reprocess` body;
  - metrics emits;
  - any key, hash or equality check (source key, plan key, `graphId`) found in W0.
- **A10:** a session started before an edit resumes against the overlaid payload, with no conflict,
  the same node ids and `endsAt` unchanged (N3).
- **R6b `stepNote.test.ts`:** `textHasTimePhrase` is true for times (incl. Hindi) and false for
  "350°F" and "180 degrees". Repeated calls give the same answer (no `lastIndex` carry-over).
  `stepNeedsAmountNote` is unchanged.
- **pytest `test_schema.py`:**
  - round-trip of each op;
  - rejects a bad anchor, an empty name, low ≤ 0, high ≤ low, an unknown op and `as_written`;
  - a v2 library with `edits: []` validates.
- `quantityLine.golden.json` unchanged.

## Proofs (HARD STOP A)
- ₹0: request dumps (`scripts/dump_extraction_request.py`) `cmp` base vs head;
  `test_model_facing_bytes` green; `result_schema_sha256` unchanged.
- `git grep` shows nothing in `extract/` imports `library`.
- Report only the dump labels that actually ran.
- PPV 14; `test_postprocess_version` green.
- `make types` diff limited to the union; `__fixtures__` `git diff --exit-code`.
- pytest `-m "not llm and not network"` and `vitest run`, base vs head with deltas.
- `npm run lint` (tsc -b && oxlint), `ruff check` (never `ruff format .`), `mypy --strict` on
  schema and schedule.
- Renders at 390 and 360 plus contact sheets. `git status --short`.

## W0 — data report. **STOP after W0.** W0 must not run into W1.
For each of the 13 web fixtures and each corpus recipe (`tests/fixtures/import/*.original.json`,
run through `reprocess()` on frozen data), report:
- ingredient count;
- `qty_amount` / `qty_text` coverage;
- units outside the closed list;
- step→ingredient links;
- whether `original` exists;
- the step↔node mapping (optional, added or dropped steps; serving-wait nodes; duplicate texts);
- **A11:** `graph.ingredients[i]` ↔ `original.recipe.ingredients[i]` (name, `qty_text`, unit).
  **Any mismatch: report and STOP**;
- **evidence for Q1:** for each edit kind, (i) apply to `original` then `reprocess()`, vs (ii)
  `applyEdits` on the payload (a prototype in the scratchpad, not committed). Diff node ids, edges,
  durations, stages, summary and tier;
- **A7:** for each recipe with `scalable == 0`, the `servingsGate` state before and after one amount
  edit;
- **Q9:** how `groupIngredients` / `ingredientGroups.ts` place and order rows;
- **A6:** every consumer of `graph.ingredients`, `node.consumes`, `node.instruction` and the whole
  payload, with file:line:
  - storage writes;
  - the `/recipes/reprocess` body (`openSaved.ts:120`);
  - metrics (`metrics/outbox.ts`, `finalizeSession`, `emitCompletion` `App.tsx:50`);
  - source key, plan key, the `graphId` check in `engine.open`, conflict resolve, staleness,
    duplicate check;
  - export and share.

  Proof that the overlaid payload reaches none of storage, metrics or server.

Output: `notes/r6/w0/report.md` (untracked). Then STOP for the owner.

## W1 — option renders. STOP for the owner's pick.
- U1, U2 (the Ingredients tab plus one expanded stage card) and U3, on kadhi-pakora and sabudana.
- States:
  - ingredient edit, the amount input with fractions, a range and its errors;
  - unit picker (outside unit, No unit);
  - the factor ≠ 1 line;
  - remove warning;
  - rename hint;
  - "Edited" on the page;
  - orphan notice and review;
  - write failure;
  - the A7 servings state;
  - the Q8 label stage card.
- Output: `notes/r6/w1/contact-sheet-390.png` and `-360.png`, made with Playwright's own headless
  Chromium. Stop only your own PIDs; port 9222 is the owner's.

## After the pick
1. Tests red.
2. Code.
3. HARD STOP A.
4. Docs commit.
5. HARD STOP B:
   - squash;
   - exact file list;
   - full-diff mojibake scan (Ã, â€, Â, U+FFFD);
   - `git ls-files --eol` LF.
6. `git push -u origin feat/r6-tier-a-editing` + `gh pr create --body-file`.
7. Cleanup only after `gh pr view` says MERGED, copying `notes/` evidence to the main checkout
   first.

## Setup (done in the planning session)
Worktree from `origin/main` @ `8d87408`, upstream unset. This file. `git diff --check` plus a
mojibake grep. One docs commit. Baseline counts:

- pytest `-m "not llm and not network"`: 1931 passed, 14 deselected (base `8d87408`).
- vitest run: 1805 passed, 68 files (base `8d87408`).

## Carried rules
- Non-ASCII via Write/Edit only (never heredocs or `\u`).
- Explicit `git add` paths; `git status --short` at every stop.
- Absolute PYTHONPATH on every Bash call; `OPENAI_API_KEY=invalid LLM_API_KEY=invalid`
  in-process.
- Frozen data only. No deploy, no phone, no YouTube.
- Harness untracked.
- Never `ruff format .`.
