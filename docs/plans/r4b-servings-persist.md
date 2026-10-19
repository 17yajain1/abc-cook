# R4b — persist the chosen servings per saved recipe

## Owner amendments

Approved 2026-10-19. These win over everything below.

Answers
Q1: Yes — float + closed-set validator + JSON-schema enum, TypeAliasType "ServingsChoice",
    generated TS replaces the hand-written union; no payload/bounds checks in Python. Test
    that JS-written `1` and `2` (ints) validate as batch multipliers.
Q2: setServingsChoice.
Q3: Yes — write through to the entry the source key resolves to (same rule as planKeyFor).
Q4: Yes — the open view's choice wins on Save / Update saved copy; auto-save and the feed card
    keep the existing value; reconcile after either.
Q5: Silent; the view keeps the choice.
Q6: Kadhi refreshed to a different stated count (4 → 5): shows 5 as written, factor 1, no
    Reset. My brief's "shows the original 4" was wrong. Cover the stated → defaulted case in
    tests only, not a render.

Amendments
A1. Write cost: each stepper tap rewrites the whole library. At HARD STOP A, report the
    serialized library size and the setServingsChoice write time for a realistic library
    (seed 20 entries from the built fixtures with `original` populated), median of 10 taps.
    If a single write is over ~16 ms, debounce persistence (~300 ms, trailing; flush on
    leave / visibilitychange) and say so; the view updates immediately either way. Don't
    debounce if it isn't needed.
A2. make types runs export_web_fixtures.py: restore any fixture it rewrites only by line
    endings (git checkout), and prove __fixtures__ byte-identical with git diff --exit-code.
A3. Remove the R4a comment "until R4b: resets on reopen" and any test or PR-body text that
    asserts the reset; the A7 status line in r4-servings.md says "closed by R4b (#PR)".

Note (owner, 2026-10-19): the A7 status line carries no PR number:
'Status: closed by R4b (docs/plans/r4b-servings-persist.md).' No follow-up commit.

## Context
R4a (PR #71, merged as `064ba20` on top of `23265fc`) shipped the servings control, the factor
plumbing and the session's `servingsChoice`. A saved recipe's choice still resets on reopen (R4
A7). R4b implements `docs/plans/r4-servings.md` §6 (with A2, the W1 decisions and the copy table
as decided there) and closes A7. ₹0, PPV stays 14, no new UI. Read from `origin/main` @ `064ba20`.

---

## Step 0 — inventory (origin/main @ 064ba20)

### a. The choice model (`apps/web/src/lib/servings.ts`)
- `BATCH_LADDER = [0.5, 1, 1.5, 2, 3]` (:76); `BatchMultiplier` (:77).
- `ServingsChoice` (:85-87) is a hand-written union. R4b replaces it with the generated type (Q1).
- `servingsStated` (:91): the schema flag minus the legacy-warning default.
- `choiceFactor` (:98-102): null/absent → 1; a non-finite factor → 1.
- `servingsBounds` (:105): min 1, max `max(2N, N+4)`. `stepChoice` (:110).
- `parseChoice` (:132-140): shape check only. A bad `chosen` or an off-list multiplier → null.
- `reconcileChoice(choice, source, importMeta)` (:149-161): batch drops when the recipe is stated;
  servings drops when it is defaulted or `original ≠ servings`; `chosen` is clamped.
- `originalChoice` (:192).

### b. View state and session (`apps/web/src/App.tsx`)
- Plan view `servingsChoice?` (:93), with the R4a comment "until R4b: … resets on reopen" (:91-92).
- No open path sets it: `openSaved.show` (:141-167), `openFeedRecipe` (:185), `openImported`
  (:227), `goToConflict`'s library `planView` (:285-292).
- `setServingsChoice` (:257-259) writes the view only.
- `startCooking` → `startChoiceFor` (:447-453) reconciles, returns null when gated or at factor 1,
  and passes it to `startIfNone` (`cooking-mode/startCooking.ts:21,25`). The session stores it at
  `engine.start` (`cooking/store.ts:120,129`; `cooking/types.ts:47`; parsed with `parseChoice`).
- `PlanRoute` (:426-439): while `servingsLocked`, the page shows `session.servingsChoice`.
- `ServingsControl.resetTarget` (`plan/ServingsControl.tsx:20-22`) returns the original choice,
  not null. R4b normalises factor 1 → null at the write.

### c. Lock rule (`apps/web/src/library/staleness.ts`)
- `servingsLocked(session, planKey, now)` (:101-104) via `sessionIsActive` (:88-93): a running
  timer, or activity within 24 h; a finished session unlocks.

### d. Saved-recipe writers and readers
| Path | Code | Today |
|---|---|---|
| Save (new) | `library/store.ts:97-107` | no field |
| Save (replace: Update saved copy, re-import auto-save) | `store.ts:86-96` spreads `...existing` | survives, unreconciled |
| Refresh (reprocess, feed replacement) | `store.ts:127-146` spreads `...existing` | survives, unreconciled |
| Read | `readLibrary` (:154-165) → `migrateEntry` (:170-177) | passes through, unchecked |
| Write | `writeLibrary` (:193-201), `{version: 2}` | — |
| Silent refresh | `library/openSaved.ts:116-135` → `refresh` | — |
| Feed replacement | `openSaved.ts:105-114` → `refresh` (`import_meta: null`) | — |
| Feed card "Add to cookbook" | `feed/saveFromFeed.ts:28-36` → `save(payload, null)` | no view |
| Header Save (incl. a feed recipe opened as a plan) | `App.saveCurrent` (:321-333) | — |
| Duplicate URL | `import/duplicate.ts:31-40` → `onDuplicate` → `openSaved` (`App.tsx:343`) | read path |
| Re-import / Import again | `skipDuplicateCheck` → `saveImported` (:212-225) → `save` replace | — |
| Import auto-save | `saveImported` at job completion, **before** any plan view exists; `openImported` then opens `origin: 'import'`, which `planKeyFor` (`cooking-mode/planKey.ts:65-68`) resolves to `library:<id>` | — |

### e. Python and generated types
- `schema/library.py:50-89` `SavedRecipe` (v2), `:92-103` `SavedLibrary` (`version: Literal[2]`);
  exported at `schema/__init__.py:21,84-85`.
- `scripts/export_schema.py:41-50`: `SavedLibrary` is a root and pulls in `SavedRecipe`.
- `make types` (Makefile :58-61): `export_schema.py` → `packages/schema/schema.json`;
  `npm run build` → `packages/schema/index.ts` (`SavedRecipe` at :1266); `export_web_fixtures.py`.
- Not model-facing: the cache `result_type` is `ImportResult` (`extract/cache.py:270,342`);
  nothing in `extract/` imports `library`. PPV = 14 (`cache.py:212`).

### f. Existing tests and harness
- `library/store.test.ts` (migration :303-398, refresh :480-540); `tests/test_schema.py:145-180`.
- `scripts/dump_extraction_request.py` (12 request dumps).
- Render harness `notes/render-harness-r4/` in the main checkout (untracked).

---

## 1. Field (Python → generated types)
In `schema/library.py`:
- `ServingsByCount { mode: Literal['servings'], chosen: int ≥ 1, original: int ≥ 1 }`.
- `ServingsByBatch { mode: Literal['batch'], multiplier: float }`: an `AfterValidator` restricts it to
  `BATCH_MULTIPLIERS = (0.5, 1.0, 1.5, 2.0, 3.0)`, and `json_schema_extra={"enum": [...]}` makes
  the generated TS `0.5 | 1 | 1.5 | 2 | 3`. (`Literal[0.5, …]` is rejected by `mypy --strict`.)
- `ServingsChoice = TypeAliasType("ServingsChoice", Annotated[ServingsByCount | ServingsByBatch,
  Field(discriminator="mode")])`, so it gets its own named `$def`.
- `SavedRecipe.servings_choice: ServingsChoice | None = None`, top level, additive in v2
  (`SavedLibrary.version` stays `Literal[2]`). Not in `edits`.
- No payload or bounds checks in Python: reconcile is web-side.
- Export the three names from `schema/__init__.py`. No new root in `export_schema.py`.
- Web: `lib/servings.ts` deletes its hand-written union and re-exports the generated
  `ServingsChoice`; `BatchMultiplier = ServingsByBatch['multiplier']`; `BATCH_LADDER` stays the
  runtime list, checked with `satisfies readonly BatchMultiplier[]`.
- Expected `make types` diff: `schema.json` (three `$defs` + the property) and `index.ts`
  (`ServingsChoice`, `ServingsByCount`, `ServingsByBatch`, the field). Nothing else.

## 2. Read
`migrateEntry` adds `servings_choice: reconcileChoice(entry.servings_choice, entry.payload.graph,
entry.import_meta)`. `parseChoice` runs inside it: malformed → null; original ≠ servings → null;
stated ↔ defaulted mismatch → null; `chosen` clamped. The entry is never dropped. An absent field
reads as `null` in memory; storage is rewritten only on the next write.

## 3. Write
- `Library.setServingsChoice(id, choice | null): RefreshResult`: normalises factor 1 → null,
  reconciles against the entry's payload, writes. Leaves `updated_at` and everything else alone.
  Unknown id or failed write → `{ok:false}`, list unchanged.
- New pure module `library/servingsPersist.ts`:
  - `persistTargetId(origin, findBySource)`: `library` → its id; `import` → the id saved under its
    source key (Q3, same rule as `planKeyFor`); `server` → null.
  - `toStored(choice)`: factor 1 → null (stepping back to the original and "Reset to N" both write null).
  - `shouldPersist(locked, id)`: no write while locked.
- `App.setServingsChoice`: update the view (unchanged), then, in the event handler (not inside
  the `setView` updater), write through when `shouldPersist(servingsLocked(…, Date.now()), id)`.
  A failed write is silent; the view keeps the choice (Q5).
- `SaveExtras.servings_choice?: ServingsChoice | null`. In `save()`: `undefined` keeps the existing
  value (null for a new entry); a provided value wins (Q4); reconcile against the new payload after
  either.
  - `saveCurrent` (Save / Update saved copy, incl. feed-as-plan) passes `toStored(prev.servingsChoice)`.
  - `saveImported` (auto-save) and `saveFromFeed` (card) pass nothing.
- A1: if the write-cost measurement at HARD STOP A shows a single write over ~16 ms, persistence
  is debounced (~300 ms trailing, flushed on leave / `visibilitychange`); otherwise not.

## 4. Survival
| Path | Mechanism |
|---|---|
| Save replace | `...existing` or the provided value → `reconcileChoice(…, payload.graph, importMeta)` |
| Silent refresh (reprocess / PPV bump) | `refresh` `...existing` → reconcile against `next.payload`, `next.import_meta` |
| Feed replacement | same `refresh`, `import_meta: null` |
| Re-import dedup | duplicate path = `openSaved` (read, §2); Import again = `saveImported` → save replace |

`openSaved.ts` needs no code change.

## 5. Open order
- `openSaved.show` and `goToConflict`'s library `planView` set `servingsChoice:
  recipe.servings_choice ?? null` (already reconciled).
- `openImported` sets it from `library.findBySource(...)?.servings_choice ?? null`.
- Fixture and feed opens stay null.
- An active session for that plan keeps winning in `PlanRoute`, and the stepper is locked (no write).
- A session started later copies the view's choice via `startChoiceFor` (unchanged).
- A3: delete the "until R4b: resets on reopen" comment (:91-92) and any test or text asserting the reset.

## 6. Tests first (red before code)
- `store.test.ts`:
  - old entry with no field → `servings_choice` null, factor 1;
  - malformed (string, `{mode:'batch', multiplier: 4}`, `chosen: 0`, unknown mode) → null, entry
    kept, every other field deep-equal;
  - read reconcile drops on an `original` mismatch, on stated → defaulted (incl. the legacy
    warning) and defaulted → stated; clamps `chosen`;
  - `setServingsChoice` keeps `updated_at`, `saved_at` and `list()` order; factor 1 writes null;
    persists across reload; unknown id / failed write leave the list unchanged;
  - `save` replace: extras undefined keeps the value, provided wins; new entry takes provided or null;
  - replace and refresh drop the value when servings change (4 → 5) and when the mode changes.
- `openSaved.test.ts`: the reprocess refresh and the feed replacement each keep + reconcile.
- `servingsPersist.test.ts`: `persistTargetId` (library, saved import, unsaved import, server);
  `toStored` (reset, factor 1); `shouldPersist` (locked → no write).
- `servingsChoice.test.ts`: the generated type accepts both shapes; `BATCH_LADDER` satisfies it.
- pytest `test_schema.py`: `SavedRecipe` round-trip with and without the field, both modes;
  rejects multiplier 0.7 and 4, `chosen: 0`, an unknown mode; accepts JS-written ints `1` and `2`
  as batch multipliers (Q1) and `1.0`; a v2 library JSON without the field validates.

## 7. Proofs (HARD STOP A)
- 12/12 request dumps `cmp` base vs head (`dump_extraction_request.py`; 4 stream × strict,
  ADDED_STEPS off/on/unset).
- `test_model_facing_bytes` green; `result_schema_sha256` unchanged (docstrings not model-facing).
- PPV 14; `test_postprocess_version` green, no history entry.
- `make types` diff limited to §1's list. A2: any fixture `export_web_fixtures.py` rewrites only by
  line endings is restored with `git checkout`; `git diff --exit-code` on `__fixtures__`.
- `pytest -m "not llm and not network"` and `vitest run` counts base vs head, deltas listed.
- `tsc`; `npm run lint`; `ruff check`; `mypy --strict` on `abc_cook/schema` and `abc_cook/schedule`.
- A1: serialized library size and median `setServingsChoice` write time over 10 taps on a
  20-entry library seeded from the built fixtures with `original` populated; the debounce decision.

## 8. Screens (no new UI)
One proof render pair, new entry `reopen.tsx` in `notes/render-harness-r4/` (main checkout, untracked):
1. Real `createLibrary` on fake storage, saved kadhi (stated 4) with `{servings, chosen 6, original 4}`,
   reopened through `openSavedNow` → view → `PlanScreen`: stepper 6, header "6 servings · recipe
   serves 4", scaled amounts.
2. Same entry after `refresh` with a payload stated 5 (Q6): shows 5 as written, factor 1, no Reset.
Stated → defaulted is covered in tests only.

## 9. Setup (done in the planning session)
Worktree `C:\Users\ashya\Music\abc-cook-r4b`, branch `feat/r4b-servings-persist` from
`origin/main` (upstream unset); this file; A7 status line in `r4-servings.md`; `git diff --check`
+ mojibake grep; one docs commit with explicit paths; report; STOP.

## 10. Implementation (fresh session in the worktree, auto mode)
1. Tests (red).
2. Code: `library.py` → `make types` (`npm ci` in `packages/schema`, then `make types PY=python`)
   → `servings.ts` → `store.ts` → `servingsPersist.ts` → `App.tsx`.
3. **HARD STOP A:** §7 proofs + §8 pair.
4. Docs commit.
5. **HARD STOP B:** squash; exact file list; `HEAD^{tree}` equal; mojibake scan of the full diff;
   `git ls-files --eol` LF for every touched file; harness untracked.
6. Push (`-u origin feat/r4b-servings-persist`) + `gh pr create --body-file`. No follow-up commit:
   the A7 status line carries the plan path, not a PR number.
7. The owner merges.
8. Cleanup only after `gh pr view --json state` says MERGED, copying `notes/` evidence to the main
   checkout first.

Expected files: `apps/api/abc_cook/schema/{library,__init__}.py`, `apps/api/tests/test_schema.py`,
`packages/schema/{schema.json,index.ts}`, `apps/web/src/lib/servings.ts`,
`apps/web/src/lib/servingsChoice.test.ts`,
`apps/web/src/library/{store,store.test,openSaved.test,servingsPersist,servingsPersist.test}.ts`,
`apps/web/src/App.tsx`, `docs/plans/r4b-servings-persist.md`, `docs/plans/r4-servings.md`.

Carried rules: `OPENAI_API_KEY=invalid LLM_API_KEY=invalid` in-process; frozen data only; no
YouTube/deploy/phone; absolute PYTHONPATH on every Bash call; Write/Edit only for non-ASCII
(never heredocs); keep LF; explicit `git add` paths; restore CRLF fixtures only if git says they
were CRLF; never `ruff format .`; stop own PIDs only; port 9222 is the owner's.
