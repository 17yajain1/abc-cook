# R4 — servings: the cook picks how many, every rendered quantity scales

## Owner amendments

Approved 2026-10-19. These win over everything below.

Answers
Q1: A (Ingredients-tab stepper from study frame 3). Still render B and C at W1 for comparison.
Q2: (iii) relative "Amounts ×1" stepper for defaulted servings — see A2 for the data model.
Q3: Yes: min 1, max max(2 × original, original + 4), step 1.
Q4: Yes, number not followed by a closed-list time/temperature word — see A4.
Q5: "for N servings" on the tab line; recipe-level line "K amounts are for N servings —
    scale them yourself." Chip marker per A3.
Q6: Not in R4 (cooking mode only).
Q7: Cookbook row unchanged.
Q8: Ingredients-tab sub-line + cooking-mode entry screen only.
Q9: Locked during an active session, "Cooking for N — finish to change".
Q10: Two PRs (R4a web-only, R4b persistence).
Q11: Top-level field in v2, no v3 — shape per A2.

Amendments
A1. Scalability gate. Compute per recipe: scalable = lines with qty_amount; numbered =
    lines whose amount text has a number. If scalable == 0 (hand goldens like kadai, any
    payload predating qty_amount, a saved recipe whose refresh failed), do NOT offer a
    working control: render it disabled with one line, proposed copy "Amounts in this recipe
    can't be scaled yet." (render it at W1; copy is a question). Report at W0, for every web
    fixture and corpus recipe, scalable/numbered and whether the control would be live.
A2. One data model for both modes. Canonical state is a factor, stored as
    { mode: 'servings', chosen: int, original: int } | { mode: 'batch', multiplier: number
    from the closed list ½,1,1½,2,3 }. Use the same union for App view state,
    CookingSession (additive optional field, missing → factor 1) and R4b's SavedRecipe field
    (Python model mirrors it). Reconcile on read: a servings choice whose original ≠
    payload servings, or a mode that no longer matches stated/defaulted, drops to null.
    Give every copy string a defaulted ('batch') variant: step note, times note, marker
    ("as written" instead of "for N servings"), recipe-level line, header meta, cooking
    entry, locked text. List them all in one table in the plan.
A3. Chip marker is visual, not text. quantityPhrases keeps returning the exact phrase
    string (React key and quantityLine golden unchanged at every factor's marker state).
    Add a parallel structured output (e.g. chips: {text, unscaled}[] in the view model) and
    mark unscaled chips with a visual treatment plus an accessible label (e.g. aria-label
    "… — amount for N servings"). Render 2 marker treatments at W1; recommend one.
A4. Step-note number rule: a time/temperature phrase is a number or range (10-15, 10–15,
    10 to 15, 1½, 1 1/2) directly followed by a closed-list word (min, mins, minute(s), hr,
    hrs, hour(s), sec(s), second(s), °, °C, °F, degree(s), मिनट, घंटा, घंटे, सेकंड). The
    step gets the note if any number remains outside those phrases. Unit tests for each
    form, plus "350°F", "2 eggs", "Wait 10 min", "cook 10-15 min then add 2 cups". Report
    per fixture how many steps get the note under this rule.
A5. Accessibility: stepper buttons ≥ 44 px targets with aria-labels ("Fewer servings",
    "More servings"), the value announced via aria-live="polite", disabled states exposed.
    The locked and gated (A1) states explain themselves in visible text, not tooltip only.
A6. W1 renders must include: A/B/C at original; A at ×½ and ×2 (times note); defaulted
    'batch' variant; locked; gated (A1, on kadai); 2 chip-marker treatments; tab marker line
    (croissant real data + the labelled synthetic kadhi copy); header meta before/after.
    STOP at W1 for my pick before tests and code.
A7. R4a gap: between R4a and R4b merges, a saved recipe's choice resets on reopen. Say so in
    R4a's PR body. Keep the gap short.
    Status: closed by R4b (docs/plans/r4b-servings-persist.md).

### W1 decisions (2026-10-19)

Made after the W1 renders (`notes/r4/w1/`). They win over the body and over A1–A7.

- W1-1 Control: A (Ingredients-tab stepper, study frame 3).
- W1-2 Gated: no stepper at all. Only the line "Amounts in this recipe can't be scaled yet." in the
  control's slot.
- W1-3 Chip marker: a dashed outline at ink-2 (#55534c) plus the aria-label from the copy table. The
  phrase string is unchanged.
- W1-4 Singular when K = 1: "1 amount is for N servings — scale it yourself." and
  "1 amount is as written — scale it yourself."
- W1-5 The A4 time/temperature list gains ˚ (U+02DA) and º (U+00BA), with a test for "550˚F" and "550ºF".
  (pizza-dough uses U+02DA; without it two of its steps got the note for a temperature.)
- W1-6 "Reset to N" sits on the sub-line's own row, not a row of its own.
- W1-7 Follow-ups, record only: FGC-48 and FGC-49 in `followup-golden-corpus.md`. R4a's PR body notes that
  step notes are frequent on chole-bhature (13 of 16 steps) by design.
- W1-8 The A4 step-note rule checks the step's label as well as its instruction. The "Next: …" preview
  line stays as written.
- F1 (before the docs commit) When the factor is 2 or more, the times note ("Times are for N servings. A
  bigger batch can take longer.", batch variant in the copy table) shows once per session, on the first
  step screen of a session started from the plan, in the step note's slot and style. The entry screen
  keeps carrying it for the resume and conflict path.

### Copy table (A2): every string, servings mode vs defaulted 'batch' mode
N = original servings, C = chosen servings, ×M = batch multiplier shown as ×½ ×1 ×1½ ×2 ×3, K = count
of numbered-but-unscaled lines. The batch variants are proposals: W1 renders them and the owner may amend them.

| Where | Servings mode (`stated`) | Batch mode (defaulted) | Shown when |
|---|---|---|---|
| Stepper label | Servings | Amounts | always (live control) |
| Stepper value | C | ×M | always |
| Stepper sub-line | Times stay the same | Times stay the same | factor < 2 |
| Times note (replaces sub-line; cooking entry screen) | Times are for N servings. A bigger batch can take longer. | Times are for the recipe as written. A bigger batch can take longer. | factor ≥ 2 |
| Reset | Reset to N | Reset to ×1 | factor ≠ 1 |
| Stepper aria-labels | Fewer servings / More servings | Smaller batch / Larger batch | always |
| Tab marker line | for N servings | as written | factor ≠ 1, line unscaled + numbered |
| Chip aria-label (A3) | ‹phrase› — amount for N servings | ‹phrase› — amount as written | same |
| Recipe-level line (tab) | K amounts are for N servings — scale them yourself. | K amounts are as written — scale them yourself. | factor ≠ 1, K > 0 |
| Step-text note (cooking task screens) | Amounts in this step's text are for N servings. | Amounts in this step's text are for the recipe as written. | factor ≠ 1, A4 rule |
| Header meta | C servings · recipe serves N | Amounts ×M | factor ≠ 1 (else today's `servingsLine`) |
| Cooking entry screen | For C servings | Amounts ×M | factor ≠ 1 |
| Cooking step meta | Step n of T · for C servings | Step n of T · amounts ×M | factor ≠ 1 |
| Locked (active session) | Cooking for C — finish to change | Cooking at ×M — finish to change | session active for this plan |
| Gated (A1) | Amounts in this recipe can't be scaled yet. | same | scalable == 0 |

A payload from before `qty_amount` and a failed refresh both land in Gated. The Cookbook row is unchanged (Q7).

## Context
R3 shipped `Ingredient.qty_amount` + `scaleQuantity(ingredient, factor)`; FGC-42 (PR #70) routed
the tab and the chips through one `quantityTrailing`. Every render path already takes `factor`, and
every caller passes nothing (factor 1). R4 adds the control, one factor per open recipe, the
"not scaled" marker (FGC-43), the two notes from Decision 1, and persistence of the chosen servings.
Times, durations, schedule, stage cards and step text never change. Web-mostly, ₹0, PPV stays 14.
Read from `origin/main` @ `23265fc`.

---

## Step 0 — inventory (origin/main @ 23265fc)

### a. Servings data
- `schema/graph.py:57-71`: `servings: int`, `servings_stated: bool = True` (default True so legacy saved
  recipes read as stated), `yield_text: str | None`. Mirrored on `RecipeSummary` `schema/api.py:26-28`,
  filled at `api/routes/recipes.py:108-110`.
- Set in `extract/graph.py:2181-2184`. First `_verify_yield` (:346) keeps the yield only if its number is in the
  source. Then `_resolve_servings` (:437-462) requires the claim to be grounded (`_verify_servings` :408) and to pass PC5
  (not an echoed yield count). Otherwise it returns **`(4, False)`** plus `SERVINGS_DEFAULTED_WARNING` (:329).
- Web reads it via `lib/servings.ts:53 servingsLine` (stated && no legacy warning → "N servings").
- Web fixtures (13 plan-responses):

| Fixture | built? | servings | stated | yield | lines | text-bearing | scalable (`qty_amount`) | no amount | steps | steps w/ number |
|---|---|---|---|---|---|---|---|---|---|---|
| kadhi-pakora | built (original) | 4 | ✔ | – | 30 | 30 | **28** | 0 | 12 | 1 (time only) |
| pizza-dough | built (normalized) | 8 | ✔ | – | 5 | 5 | **5** | 0 | 14 | 11 |
| pumpkin-pancakes | built | 4 | ✘ | – | 17 | 12 | 11 (15 oz can ✘) | 5 | 6 | 4 |
| croissant | built | 4 | ✘ | – | 8 | 7 | 6 (butter "5 tbsp (50g)…" ✘) | 1 | 18 | 9 |
| synthetic-defaulted-servings | built | 4 | ✘ | – | 1 | 1 | 1 | 0 | 1 | 0 |
| kadai-paneer | hand | 3 | ✔ | – | 8 | 7 | 0 | 1 | 10 | 0 |
| sabudana-khichdi | hand (has qty_text) | 4 | ✔ | – | 19 | 17 | 0 | 2 | 15 | 4 |
| chicken-biryani | hand | 4 | ✔ | – | 15 | 14 | 0 | 1 | 14 | 2 |
| homemade-donuts | hand | 12 | ✔ | – | 10 | 10 | 0 | 0 | 11 | 2 |
| maggi-2min | hand | 1 | ✔ | – | 3 | 3 | 0 | 0 | 4 | 1 |
| strawberry-shortcake | hand | 6 | ✔ | – | 10 | 10 | 0 | 0 | 8 | 1 |
| synthetic-two-sittings / -two-windows | hand | 4 | ✔ | – | 5 / 10 | all | 0 | 0 | 6 / 12 | 0 |

  Defaulted: 2 of the 4 real built recipes (croissant, pumpkin), so the import path often defaults.
  Every hand golden is stated. **No fixture has `yield_text`.** Corpus replay
  goldens (`tests/fixtures/import/*.replay-expected.json`) carry nodes/windows/totals only — no servings.
  The per-recipe corpus servings and scalable table for the non-web corpus (cupcakes, dal makhni, chole)
  needs a `reprocess`/`build_graph` run (₹0). Plan mode can't run it, so it is **W0 deliverable #1**
  in implementation. Known totals (r3 plan B): ≈109 of 140 text-bearing corpus lines scalable; FGC-43:
  11 + 3 second-amount lines; 0 corpus g/ml lines scalable.

### b. Where servings shows today
- Recipe header meta row `plan/RecipeHeader.tsx:57,87-89` (`servingsLine(plan.servingsSource, importMeta)`).
- Cookbook rows `library/LibraryScreen.tsx:96` (summary) and `:126` (saved payload).
- Plan tab body, Ingredients tab, cooking mode: **nowhere**.

### c. Quantity renders (all accept `factor`, no caller passes one)
| Render | Function | Caller passing nothing | Path a factor would travel |
|---|---|---|---|
| Ingredients tab | `plan/ingredientGroups.ts:24 panelIngredientGroups(groups, factor=1)` → `lib/quantity.ts:77 quantityTrailing` | `plan/IngredientsPanel.tsx:13` ← `PlanScreen.tsx:180` | App view state → `PlanScreen` prop → `IngredientsPanel` prop |
| Cooking chips | `cooking-mode/quantity.ts:18 quantityPhrases(node, ids, factor=1)` | `cooking-mode/viewModel.ts:423` (`buildCookingView` has no factor param, :385) | session → `CookingModeScreen` → `buildCookingView` option → `quantityPhrases` |
| `quantityLine` | `cooking-mode/quantity.ts:42` | no production caller (golden test only) | same as chips |
| Draft (S2) | `import/draftView.ts` | not routed by design (never scales) | – |
| Plan "You'll need" | `StageCard.tsx:156` names only | – | unchanged |

`quantityTrailing` returns only a string and drops `scaleQuantity`'s `scaled` flag (`lib/quantity.ts:86`).
The marker therefore needs one new sibling function that exposes the flag.

### d. Saved-recipe storage — would a new top-level field survive?
| Path | Code | Survives? |
|---|---|---|
| Read + migrate | `library/store.ts:154-176 readLibrary/migrateEntry` (spreads `...entry`) | ✔ (passes through; needs a shape check) |
| Save / Update saved copy / Re-import / auto-save on import | `store.ts:80-125 save` — existing entry spreads `...existing` | ✔ (but payload may change servings → must reconcile) |
| Feed card "Add to cookbook" | `feed/saveFromFeed.ts:35` → `save(payload, null)` | new entry: none; existing: ✔ |
| Silent refresh (reprocess / PPV bump) | `library/openSaved.ts:108-136` → `store.ts:127-150 refresh` (spreads `...existing`) | ✔ (+ reconcile) |
| Feed replacement | `openSaved.ts:105-114` → `refresh` | ✔ (+ reconcile) |
| Re-import dedup | `import/duplicate.ts` → `save` by `source_key` | ✔ |
| Write body | `store.ts:193` writes `{version: 2, recipes}` | ✔ |
| Python model | `schema/library.py SavedRecipe` (v2: `original`, `postprocess_version`, `edits`) | needs the field + `make types` |

Refresh is skipped while a session is active for that entry (`staleness.ts:92 sessionBlocksRefresh`).

### e. Unsaved recipes
App view `{kind:'plan', origin}` (`App.tsx:70-91`) covers three unsaved cases: a fixture (`origin.kind 'server'`), an import before save
(`'import'`) and a feed recipe (`'import', fromFeed`). None of them has a store row. The chosen servings must therefore live in **App
view state** and travel into the session. It is written to the library only when that recipe is saved.

### f. Cooking sessions
`cooking/types.ts:14-40 CookingSession` v1: `planKey`, `graphId`, timestamps, `nodes`, `lastTransition`,
`recipeTitle?`, `totalMin?` — **no servings**. One stored session (`cooking/store.ts:13` `abc-cook:session:v1`).
`CookingModeScreen.tsx:71` builds `ingredients` from `payload.graph`; `buildCookingView` (:118, :261).
Today cooking mode never reads a servings value, so a change mid-session would not reach it. A Home
"Continue" (`AppShell.tsx:64`) after a reload would also lose any in-memory choice.

### g. Scalable share / FGC-46
Table above. **Best demo: `kadhi-pakora`** (built, stated 4, 28/30 scalable, Indian, long tab, chips).
`pizza-dough` (stated 8, 5/5 scalable, 11 numbered steps) is the step-text-note demo.
**Gap:** no *stated* built fixture has a numbered-but-unscalable line. The marker exists only on
croissant ("5 tbsp (50g)…") and pumpkin ("15 oz can"), both **defaulted**. With Q2's batch mode,
croissant shows the marker on real data ("as written"). Servings mode is shown on a render-only copy
of kadhi with one `qty_amount` nulled, labelled "synthetic" in the screenshot (A6).

### h. Step text with numbers
The counts are in the table above. Numbers are digits, U+00BC–00BE, U+2150–215E and Devanagari U+0966–096F. Many are times or
temperatures, not amounts: kadhi's only one is "Wait 10 min" (an added step); about 3 of pizza's 11 are
time-only; croissant has 4 of 9. The definition is A4.

### Figma
The Figma Make prototype covers Plan + cooking screens only and has **no servings control** (CLAUDE.md;
no frame). The owner-reviewed **recipe-page study frame 3** (`docs/design/recipe-page-study/3-ingredients-tab.png`)
does have one: a "Servings / Times stay the same" label on the left and a pill `− 4 +` stepper on the right, at the top of the
Ingredients tab. That is the port source for option A.

---

## 1. Servings control (A chosen, Q1; B and C still rendered at W1 for comparison)
| | A. Stepper on the Ingredients tab (study frame 3) | B. Stepper in the header meta row | C. Tappable "4 servings" → sheet |
|---|---|---|---|
| Placement | top of Ingredients tab, above groups | replaces the servings text in `RecipeHeader` meta | header meta text gets a chevron; bottom sheet with number chips |
| Shape | label "Servings" + sub-line; pill `− N +`, ≥ 44 px targets | inline `− 4 servings +` | chips 1…max, current filled |
| Min / max / step | 1 / max(2 × original, original + 4) / 1 (Q3); batch mode: ½, 1, 1½, 2, 3 (A2) | same | same |
| Reset | "Reset to N" text button appears under the pill when ≠ original | "Reset" link after the stepper | "Original (N)" chip |
| 390 px | fits (study frame) | crowds the meta row with the time; wraps | fits; one extra tap |

**A** (Q1): the owner already reviewed it, amounts are read on that tab, and the header stays a masthead.
When the choice differs from the original, the header meta follows the copy table ("C servings · recipe serves N" / "Amounts ×M").

States of the control:
- **Live:** servings mode when `stated`, or batch mode when defaulted (A2).
- **Locked:** during an active session for this plan (Q9). The stepper is disabled, with visible text from the copy table.
- **Gated (A1):** when the recipe has `scalable == 0` lines with `qty_amount` (hand goldens such as kadai, a payload from before `qty_amount`, or a saved recipe whose refresh failed). The control is rendered disabled with one visible line, "Amounts in this recipe can't be scaled yet." That copy is still a question for the owner. No factor ≠ 1 can be chosen.
- **Accessibility (A5):** targets are ≥ 44 px, the buttons carry aria-labels, the value is in `aria-live="polite"`, and disabled is exposed.

Load `frontend-design` before W1. Build in the tokens from `DESIGN_SYSTEM.md`; the study proposes composition, not tokens.

## 2. Unknown / defaulted servings (Q2: batch mode)
`stated = servings_stated && !legacyDefaulted` (factored out of `servingsLine` as `servingsStated()`).
Defaulted recipes get the relative batch stepper "Amounts ×1" with the steps ½, 1, 1½, 2, 3 and no people count (A2 `mode: 'batch'`).
The A1 gate applies first.

## 3. Factor plumbing (one source per open recipe)
- `lib/servings.ts` holds the A2 union:
  `type ServingsChoice = { mode: 'servings'; chosen: number; original: number } | { mode: 'batch'; multiplier: 0.5 | 1 | 1.5 | 2 | 3 }`.
  - `choiceFactor(choice | null)` returns `chosen / original` or `multiplier`, and **missing/null → 1**. It uses floats with no rounding; R3 rounds per line.
  - `reconcileChoice(choice, payload, stated)` returns null when either:
    - it is servings mode and `original ≠ payload.graph.servings`, or
    - the mode no longer matches stated/defaulted.

    It also clamps `chosen` into the Q3 bounds and returns null for a multiplier that is not on the list.
  - `scalability(ingredients)` returns `{ scalable, numbered }` for the A1 gate.
- The App plan view gains `servingsChoice: ServingsChoice | null`. In R4a it starts as null. In R4b it starts as the saved choice, reconciled.
- `PlanScreen` gets the props `servingsChoice`, `onServingsChoiceChange` and `servingsLocked`. The factor goes to `IngredientsPanel`.
- `startCooking` (`App.tsx:237`) stores the choice on the session (§7).
- `CookingModeScreen` takes the factor from `choiceFactor(session.servingsChoice)` and passes `buildCookingView(..., { factor, choice })`, which calls `quantityPhrases(n, ingredients, factor)`.
- Nothing else reads the choice: no change to the `derive.ts` durations, the scheduler, the stage cards or the step text.

## 4. "Not scaled" marker (FGC-43)
- New `lib/quantity.ts quantityTrailingScaled(item, factor) → { text, unscaled: boolean }`;
  `quantityTrailing` becomes its `.text` (byte-identical). `unscaled = factor !== 1 && !scaled &&
  hasNumber(amountText)`. `hasNumber` uses the same character class as §h. "to taste", "a pinch" and null are never marked.
- **Tab:** `IngredientListItem.note?: string` adds a second line under the amount, 12 px ink-2. It reads
  **"for N servings"** (N = original), or **"as written"** in batch mode.
  When K > 0, a recipe-level line sits under the stepper: **"K amounts are for N servings — scale them yourself."**
  (Q5; batch variant in the copy table).
- **Chips (A3), visual and not text:** `quantityPhrases` keeps returning the exact phrase string. The React key,
  `quantityLine` and `quantityLine.golden.json` are unchanged at every factor and marker state.
  - A parallel structured output is added: `CookingView.chipItems: { text: string; unscaled: boolean }[]`, built alongside `chips` from `quantityTrailingScaled`.
  - An unscaled chip gets a visual treatment plus an aria-label: "‹phrase› — amount for N servings", or "‹phrase› — amount as written" in batch mode.
  - Two treatments are rendered at W1 (for example a dashed border vs a small corner mark), with a recommendation.
- Hindi number words (FGC-45) contain no digit, so they are never marked. This is a residual, owned by FGC-6.

## 5. Notes (Decision 1 copy verbatim)
- **"Amounts in this step's text are for N servings."**
  - Shown when factor ≠ 1 and `stepHasAmountNumber` (A4) is true.
  - Only on the cooking-mode task and handsoff_pending screens, as the new `CookingView.servingsNote`. It sits under the instruction and before the chips, styled like `addedNote`.
  - Not on the Plan's stage cards in R4 (Q6).
- **A4 rule:** a time/temperature phrase is a number or range (10-15, 10–15, 10 to 15, 1½, 1 1/2) directly followed by a closed-list word: min, mins, minute(s), hr, hrs, hour(s), sec(s), second(s), °, °C, °F, degree(s), मिनट, घंटा, घंटे, सेकंड. The step gets the note when any number remains outside those phrases.
  Numbers are digits, vulgar fractions or Devanagari digits. W0 reports how many steps per fixture get the note under this rule.
- **"Times are for N servings. A bigger batch can take longer."**
  - Shown when factor ≥ 2.
  - It replaces the stepper's sub-line on the Ingredients tab and also shows on the cooking-mode entry screen (`buildEntryView`). Nowhere else (Q8).
- All batch-mode variants are in the copy table under Owner amendments.

## 6. Persistence
- **Field:** `SavedRecipe.servings_choice: ServingsChoice | None = None`, top level (Q11). The shape is the A2 union.
  Python mirrors it as a discriminated union on `mode`:
  - `ServingsByCount { mode: Literal['servings'], chosen: int ≥ 1, original: int ≥ 1 }`
  - `ServingsByBatch { mode: Literal['batch'], multiplier: Literal[0.5, 1, 1.5, 2, 3] }`

  It does not go in `edits`. `edits` are R6 patches over the *original import*, anchored by index. The servings choice is a view choice about the derived payload and must not be replayed or orphaned.
- **Reconcile (A2)** on every read and after `save`/`refresh`, using the same `reconcileChoice` as the view.
  The choice drops to `null` (factor 1) when either:
  - it is servings mode and `original ≠ payload.graph.servings`, or
  - the mode no longer matches stated/defaulted.

  `chosen` is clamped into the Q3 bounds.
- **Writer:** a new `library.setServingsChoice(id, choice | null)`. It does **not** bump `updated_at`, so the Cookbook order doesn't move.
  The `save()` branch for an existing entry already spreads the field. A new entry takes it from the view's choice.
- **Version:** an **additive optional field in v2** (no v3). `migrateEntry` validates the shape; a bad value becomes `null`.
  Python `library.py` plus `make types` (`npm ci` in `packages/schema`, then `make types PY=python`).
- **No model-facing bytes change:** `SavedRecipe` is reachable from neither the extraction `response_format` nor the cache `result_type`.
  Proved by 12/12 request dumps and an unchanged `result_schema_sha256`.

## 7. Cooking mode
- **Session field:** `CookingSession.servingsChoice?: ServingsChoice | null`, the A2 union. It is additive and v1 stays; missing or null gives factor 1. `startIfNone` sets it. It is read back for "Continue" after a reload.
- **When factor ≠ 1:** the step meta and the entry screen follow the copy table ("Step n of T · for C servings" / "For C servings", or the batch variants).
- **Locked during an active session for this plan (Q9),** reusing the `sessionBlocksRefresh` rule:
  - The stepper renders disabled with the visible text "Cooking for C — finish to change" (batch: "Cooking at ×M — finish to change").
  - Reason: some amounts are already measured, and a change mid-cook would mix two batch sizes on one stove.
  - Finishing or ending the session unlocks it.

## 8. PR split: two (Q10)
- **R4a (web only):** the control (live, locked and gated), factor plumbing, the marker, the notes, and the session `servingsChoice`.
  - The choice lives in view and session state only.
  - **A7:** between the R4a and R4b merges, a saved recipe's choice resets on reopen. R4a's PR body says so. Keep the gap short.
  - Proves: factor-1 identity and the render.
- **R4b:** `ServingsChoice` (Python + generated types), the store's read/write/reconcile, and survival tests.
  - Proves: the storage contract, without UI noise.

## 9. Tests first (Vitest unless noted)
- **`choiceFactor` / `reconcileChoice`:**
  - Factors 4/3, 2/3, 1/2 and 3, plus each batch multiplier; null gives 1.
  - The Q3 bounds.
  - Drop on an original mismatch and on a mode mismatch.
  - No new rounding: the factor is passed raw; assert the result equals `scaleQuantity(item, chosen/original)`.
- **A1 gate:** `scalability` on every fixture. Kadai is gated; kadhi, pizza and croissant are live.
- **A4:** one unit test for each number and range form, plus "350°F", "2 eggs", "Wait 10 min" and "cook 10-15 min then add 2 cups".
- **A3:** `quantityPhrases` strings are identical at every factor and marker state, and `chipItems[i].text === chips[i]`.
- **A5:** the aria-labels, `aria-live`, and the disabled attributes on the locked and gated states.
- **Identity:** for every fixture and every ingredient at factor 1, `quantityTrailingScaled.text === quantityTrailing` and equals the old frozen formatter. `quantityLine.golden.json` is byte-unchanged.
- **Marker:** a scaled line, an unscalable line with a number, "to taste", null, and factor 1 (never marked).
- **Notes:** none at factor 1; a step note at factor ≠ 1 when the text has a number; time-only text per A4; factor 1.99 vs 2.
- **Control:** min/max disabling, reset, locked with an active session, the batch variant, the gated state.
- **Persistence (R4b):**
  - An old entry with no field gives factor 1; a malformed one gives null.
  - The choice survives `save` replace, `refresh` (reprocess and feed) and Re-import dedup.
  - It is dropped when the payload's servings or the stated/defaulted mode changes.
  - `setServingsChoice` keeps `updated_at`.
  - pytest: `SavedRecipe` round-trip with and without the field.

## 10. Proofs (HARD STOP A)
- 12/12 request dumps `cmp` base vs head (4 stream × strict, ADDED_STEPS off/on/unset).
- Replay and schedule goldens show no diff.
- PPV stays 14. STOP if anything wants a bump; nothing should, since there is no extract or schedule change.
- pytest and vitest counts before and after.
- `tsc`, `npm run lint` (tsc + oxlint), and ruff/mypy on the schema.

## 11. Screenshots (390×844, Playwright headless Chromium, t1b harness)
On kadhi-pakora:
- The tab at original (before/after), ×½ (4→2), and ×2 with the times note.
- The tab marker line on croissant (real data, batch mode) and on the labelled synthetic kadhi copy.
- A chip-marker treatment as picked at W1.
- A cooking step with scaled chips and the step-text note (pizza-dough).
- The locked control, the gated control (kadai, A1), and the header meta before/after.

The Cookbook row is unchanged (Q7), so it needs no screenshot.

## 12. Setup (this session after approval; then STOP)
1. `git worktree add -b feat/r4-servings C:\Users\ashya\Music\abc-cook-r4 origin/main`.
2. Write this plan to `docs/plans/r4-servings.md` (Owner amendments at top).
3. `followup-golden-corpus.md`: mark FGC-43 / FGC-46 "R4 plan: docs/plans/r4-servings.md".
4. `git diff --check`; mojibake grep (`Ã|â€|Â|U+FFFD`) on both files. Write/Edit only for non-ASCII.
5. One commit `docs(plans): R4 servings plan` (explicit paths). Report `git worktree list`,
   `git log -1 --stat`, first 10 lines. **STOP.**

## 13. Implementation (fresh session in the worktree, auto mode)
1. **W0 reports (keys=invalid, built with reprocess/build):**
   - The corpus servings table.
   - The A1 scalable/numbered counts and live-or-gated for every web fixture and corpus recipe.
   - The A4 per-fixture note counts.
2. **HARD STOP W1:** the full A6 render list; wait for the owner's pick.
3. Tests (red).
4. Code.
5. **HARD STOP A:** §10 proofs and §11 screenshots.
6. Docs commit (FGC status).
7. **HARD STOP B:** squash; exact file list; `HEAD^{tree}` equal; mojibake scan of the full diff; harness still untracked.
8. Push and `gh pr create --body-file`.
9. The owner merges.
10. Cleanup, only after `gh pr view --json state` says MERGED, copying the `notes/` evidence to the main checkout first.

R4b repeats HARD STOP A and B as its own PR.

Carried rules:
- `OPENAI_API_KEY=invalid LLM_API_KEY=invalid` (₹0).
- Frozen transcripts only. No YouTube, no deploy, no phone runs.
- An absolute PYTHONPATH on every Bash call.
- No heredocs or `\u` escapes for non-ASCII.
- Stage explicit `git add` paths only.
- Restore CRLF fixtures if touched.
- Never `ruff format .`.
- Stop only your own PIDs; port 9222 is the owner's.

## Owner questions (all answered 2026-10-19; see Owner amendments)
1. **Control:** answered Q1. A, with B and C still rendered at W1.
2. **Defaulted servings:** answered Q2 + A2. The batch union.
3. **Bounds:** answered Q3. As proposed.
4. **What "has a number" means for the step note:** answered Q4 + A4. The exact phrase rule and its tests.
5. **Marker copy:** answered Q5 + A3. "for N servings" on the tab line; the chip marker is visual with an aria-label, not text.
6. **Step-text note on the Plan's stage cards:** answered Q6. Not in R4.
7. **Cookbook row:** answered Q7. Unchanged.
8. **Times note placement:** answered Q8. The Ingredients-tab sub-line and the cooking entry screen only.
9. **Locked during an active session:** answered Q9. Yes.
10. **PR split:** answered Q10 + A7. Two PRs, and the gap is stated in R4a's PR body.
11. **Persistence field:** answered Q11 + A2. Top-level `servings_choice` (the A2 union) in v2.

Still open, decided at W1:
- The A1 gated copy.
- Which chip-marker treatment to use (A3).
- The batch-mode copy variants in the copy table.

## Critical files
- `apps/web/src/lib/`: `servings.ts`, `quantity.ts`
- `apps/web/src/plan/`: `ingredientGroups.ts`, `IngredientsPanel.tsx`, `IngredientList.tsx`, `PlanScreen.tsx`, `RecipeHeader.tsx`
- `apps/web/src/cooking-mode/`: `viewModel.ts`, `quantity.ts`, `CookingModeScreen.tsx`, `CookingShell.tsx`, `startCooking.ts`
- `apps/web/src/cooking/types.ts` and `apps/web/src/App.tsx`
- R4b only: `apps/web/src/library/store.ts`, `apps/api/abc_cook/schema/library.py`, and the generated `packages/schema/*`
