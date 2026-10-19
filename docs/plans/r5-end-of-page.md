# R5 — end of the recipe page

Branch `feat/r5-end-of-page`, worktree `C:\Users\ashya\Music\abc-cook-r5`, from `origin/main` @ `c852129`
(PR #72, R4b). All citations below are `origin/main` @ `c852129`.

## Owner amendments

Owner amendments — approved 2026-10-19. These win over everything in the plan.

Answers
Q0: Show the block only when it has something the header lacks: a copied date (saved
    entry) or a paste. An unsaved URL import shows no block.
Q1: B0, defer cook history to after M5.
Q2: Yes, "Took …" never ships in any version.
Q3: Decide manual "I cooked this" together with D1–D6, not in R5.
Q4: D0, omit Public until H2. No render needed.
Q5: Omit the creator in R5 (see A4).
Q6: W-b, paste only, expanded in place, capped height with "Show all", as proposed.
Q7: T2, no thumbnail.
Q8: E1 inline confirm. Remove ends an open cook on that recipe and the confirm line
    says so. After remove, go to the Cookbook tab.
Q9: See A2.
Q10: Yes, record R2's "↗" as a documented exception. R5 adds no new ↗ (O2).
Q11: Yes, "never deleted automatically".
Q12: F1 if W0 shows the line below the fold at 360×697; otherwise F2.
Q13: "copied 12 Oct", with the year when it isn't the current year. Reuse an existing
     formatter if W0 finds one.
Tabs: end blocks on the Plan tab only.
Copy table: approved as proposed.

Amendments
A1. Remove availability depends on whether a saved entry exists for the plan on
    screen, not on origin.kind === 'library'. At W0, report with file:line whether a
    fresh import is auto-saved, and which id the page holds in that case. Remove must
    work right after an import that was auto-saved. No entry → no Remove, no date.
A2. Destructive colour: the "Remove from Cookbook" text button is ink, not red. Red
    appears only on the confirm's "Remove" button, via a new token home-destructive in
    home/tokens.css, recorded in DESIGN_SYSTEM.md as separate from the non-veg mark.
    Report the label-on-fill contrast (≥ 4.5:1).
A3. The docs commit records these decisions on main, in ROADMAP.md or a decisions note
    under docs/plans/ (your pick, say which):
    - cook history = minimal Option B, after M5; D1–D6 still open;
      feat/cooking-history-foundation is stale: redo, don't rebase
    - "Took …" never ships
    - manual "I cooked this" is decided with D1–D6
    - the Public toggle is omitted until H2
A4. Add two follow-ups to followup-golden-corpus.md:
    FGC-51 (H2 prerequisite, backend): carry the acquisition channel into
      ImportOriginal as a trustworthy creator field. PRODUCT.md:121-122 requires
      attribution before a recipe can be listed. Not R5.
    FGC-52 (P3, idea): "what we read" for URL imports (W-c). The grounding text can be
      tens of KB, and transcripts are not "as written". Revisit after M5.
A5. FGC-16: keep the existing exclusivity with the staleness line. At W0, report
    whether any fixture or scenario would hit both at once.
A6. The render harness stays untracked, never staged; check git status --short at
    every stop.

Note 2026-10-19 (after W0/W1; owner picks, additive, the amendments above are unchanged)
N1. Picks: F1 (status line under the title, in the staleness slot, exclusivity kept),
    idle Remove is ink with an underline, "Show all" cap 11rem.
N2. A1 gap, included in R5: a cook started on an unsaved import is keyed
    `import:<graphId>`; if the person then taps Save, `library:<id>` no longer matches.
    One pure helper in `endOfPage.ts` decides "the cook on this recipe": the stored
    session's planKey equals `library:<entryId>` OR `import:<graph.id>`. The confirm line
    and the remove wiring both use it. Files: `endOfPage.ts`, `App.tsx` only (+ tests).
    Anything more to end an `import:` session → STOP.
N3. A5: exclusivity stays. FGC-53 (P3, web) is added to followup-golden-corpus.md in the
    docs commit.
N4. Q13: `copiedDate(iso, now, timeZone?)`: en-GB day + short month, the year when it
    is not `now`'s year, in the device's local zone (an explicit `timeZone` for tests).
N5. Added to the file list: `apps/web/src/shell/AppShell.tsx` (an exported
    `rememberTab` so Remove lands on the Cookbook tab) and `apps/web/src/library/store.ts`
    `remove(id)`. The copy table has no string for a saved entry whose source is not a
    link and which has no paste (a hand-authored recipe): it uses "Copied 12 Oct".
    Remove failing on a full/blocked write shows "Couldn't remove it. Try again."
N6. Updated expected file list (what the commit actually touches): the "Files to change"
    list above, with these differences. The view is `apps/web/src/plan/EndOfPageSection.tsx`
    (`EndOfPage.tsx` collides with `endOfPage.ts` on case-insensitive filesystems);
    `apps/web/src/plan/RecipeHeader.tsx` (the F1 slot) and `apps/web/src/shell/AppShell.tsx`
    (not `src/AppShell.tsx`) are touched; `apps/web/src/plan/PlanScreen.test.ts` has the F1 tests;
    `apps/web/src/library/openSaved.ts` is the comment only. Not touched: `apps/web/src/history/**`,
    `apps/api/**`, `packages/schema/**`, `apps/web/src/__fixtures__/**`.
    Added to the copy table: | Platform line, saved entry with no link and no paste | "Copied {12 Oct}" |

---

## Context

R5 has no written scope on main beyond a slot in the order of work
(`docs/plans/decisions-2026-10-15-servings-edit.md:41`: "R4 (servings UI) → R5 → R6 (Tier A editing)
→ M5"). Its content is study frame 4 (`docs/design/recipe-page-study/4-end-of-page.html`, README:23)
plus FGC-16 (`docs/plans/followup-golden-corpus.md:284-287`).

**R5 is:** a "Where this came from" block (copied date and/or the paste), "Remove from Cookbook" with an
inline confirm, and FGC-16. Web only: no schema change, no API change, `POSTPROCESS_VERSION` stays 14.

**R5 is not:** Your cooks (after M5, Q1), "Took …" (never, Q2), "I cooked this" (with D1–D6, Q3), the
Public toggle (H2, Q4), the creator (FGC-51), a thumbnail (Q7), "Open the original" at the end (the
header already has it, O2), "what we read" for URL imports (FGC-52), the faded context card (frame
only).

Every number in the frame is illustrative (README:58-66).

## Step 0 — inventory (origin/main @ c852129)

a. **Render order.** `PlanScreen` (`apps/web/src/plan/PlanScreen.tsx:67`), one scroll area
   `pb-[calc(14rem+var(--safe-bottom))]` (`:166`): `RecipeHeader` (`:168`; inside, `RecipeHeader.tsx:71-117`:
   back/Save, title, staleness, already-saved, "From X ↗", cuisine, meta, `PlanAheadCard`,
   `CookOutlineView`) → status line (`:178`) → tabs (`:180-182`) → warnings (`:184-190`) → tab content.
   Plan tab ends with the `savedMin === 0` paragraph (`:212-217`) or the last `StageCard`/`WaitRow`
   (`:199-210`). Ingredients tab ends with the last `IngredientRow` (`IngredientsPanel.tsx:53-55`).
   Absolute bottom bar (`:249-265`): `pt-4`, 52 px pill, optional 2-line `ctaSubline`,
   `pb-[max(24px,var(--safe-bottom))]`.
b. **FGC-16 slot.** `statusLineFor` (`PlanScreen.tsx:20-25`) returns "Plan simplified — steps run one after
   another." when `importMeta.degraded`; rendered at `:178` below the whole header, hidden while a staleness
   line shows. No web fixture is degraded (`apps/api/scripts/export_web_fixtures.py:134-136`). Precedent for
   moving it: the staleness line moved under the title (`docs/DESIGN_SYSTEM.md:1467`).
c. **Data per element.**
   - Platform: `graph.source` `{kind, value, imported_at}` (`apps/api/abc_cook/schema/graph.py:22-27`);
     `sourceLink` → "YouTube" / "Instagram" / hostname (`apps/web/src/lib/source.ts:7-21`). No platform
     field; reel vs post is unknowable.
   - Copied date: `SavedRecipe.saved_at`, set on first save, never changed (`schema/library.py:92`).
   - Paste: `ImportOriginal.source_text` where `original.source.kind === 'text'`
     (`schema/normalized.py:402-422`). Stored as `SavedRecipe.original` (`library/store.ts:103-130`,
     dropped if the write fails, `:133-134`); on an import origin it is `origin.extras.original`
     (`cooking-mode/planKey.ts:41-42`). For URL imports `source_text` is grounding text, not "as written"
     (FGC-52).
   - Hand-authored fixtures have `graph.source.kind === 'text'` with value "Hand-authored from …": never
     key the paste on `graph.source`.
d. **Library store.** `Library` = `list/get/findBySource/save/refresh/setServingsChoice`
   (`library/store.ts:48-67`). No remove, and no UI removes anything.
e. **Sessions.** One persisted session (`cooking/store.ts:15`), keyed `library:<id>` / `import:<graphId>` /
   `server:` (`cooking/types.ts:16-48`, `cooking-mode/planKey.ts:59-70`). `endSessionIfFor(id)` ends a
   `library:<id>` session without a metric (`App.tsx:56-58`, used at `:221-223`). A session left on a
   removed id would hide the Continue strip (`home/continueCooking.ts:40`) and "Go to"
   (`conflictResolve.ts:36-38`) while still blocking a new cook (`viewModel.ts:627`).
f. **Date formatter.** W0 looks for an existing one (Q13) and reports it, with file:line, or "none".
g. **DESIGN_SYSTEM.md vs the frame.**
   1. `#B3261E` is the non-veg mark, "a graphic … not text" (`:308`, `:1428`), and no destructive token
      exists. Resolved by A2.
   2. There is no switch component (`:299`). Moot: there is no Public toggle (Q4).
   3. ↗ is "permitted only where it encodes a dependency" (`:773-774`). R2 shipped "From X ↗" unrecorded.
      Resolved by Q10.
   4. There is no outlined pill variant. The confirm buttons are drawn at W1.
   5. Peach fallback type (`:330`). Moot: no thumbnail (Q7).
   6. `opacity: 0.55` context card. Not built.
   7. Drift: `:1386` says "Finished cooking" goes to the Library, but the code goes Home (`App.tsx:406`).
      Noted, not fixed.
h. **A1, which entry the page holds.**
   - A fresh import is auto-saved before the page opens. `saveImported` → `library.save` (`App.tsx:214-224`),
     then `openImported` sets `origin: {kind: 'import', …}` (`App.tsx:228-239`; comment `:236`).
   - The page holds no id. The entry is found by source key through
     `persistTargetId(origin, findBySource)` (`library/servingsPersist.ts:15-24`): `library` → `origin.id`;
     `import` → `findBySource(canonicalSourceKey(graph.source))?.id`; `server` → null. This is the same rule
     as `planKeyFor` (`planKey.ts:59-70`).
   - A failed save, or a feed open before Save, finds no entry. W0 re-verifies this.

## §1 "Where this came from" — Plan tab only, after the last stage / `savedMin` line

- `entryId = persistTargetId(origin, findBySource)`; `entry = entryId ? library.get(entryId) : undefined`.
  This reuses the rule; it is never a third copy (A1).
- `original = entry?.original ?? (origin.kind === 'import' ? origin.extras?.original : null) ?? null`.
- `paste = original?.source.kind === 'text' ? original.source_text : null`.
- **Show the block iff `entry` (a copied date) or `paste`** (Q0). An unsaved URL import shows nothing. A
  server fixture shows nothing.
- Platform line (copy table):
  - URL with an entry: "{YouTube | Instagram | hostname} · copied {date}"
  - paste with an entry: "Pasted text · copied {date}"
  - paste without an entry: "Pasted text"
- No thumbnail (Q7), no creator (Q5), no "Open the original" (O2), no ↗.
- Date: "12 Oct"; "12 Oct 2025" when not the current year (Q13). `now` is passed in, never read in render.

## §2 As written (W-b) — the paste only, expanded in place

- "Show the recipe as written" / "Hide the recipe as written" toggles the paste in place:
  `whitespace-pre-wrap`, Home body type, capped height, then "Show all" (Q6). There is no new screen.
- Absent whenever `paste` is null, including every fixture and every URL import.

## §3 Remove from Cookbook — iff an entry exists (A1)

- "Remove from Cookbook" is an ink text button with a 44 px target (A2).
- Tapping it expands into an inline confirm:
  - Line: "Remove this recipe from your Cookbook? To get it back you'd copy it again."
  - Plus "Your cook in progress ends too." iff the stored session's `planKey === library:<entryId>`.
  - Buttons: "Remove" (fill `home-destructive`, label `home-ground`) and "Keep it".
  - No modal and no browser dialog.
- On "Remove":
  1. `library.remove(entryId)`
  2. `endSessionIfFor(entryId)`
  3. go to the Cookbook tab (AppShell).
- Works on an `import` origin right after auto-save (A1). No entry means no Remove and no date.
- After removal, opening the removed id hits the existing missing path (`App.tsx:137-139`).

## §4 FGC-16

- W0 measures the status line's bottom against the 697 px fold, minus the bottom bar, with `degraded`
  injected (harness test data only).
- **F1** if it is below the fold: render the status line under the title, in the same slot as the staleness
  line, keeping the exclusivity (A5).
- **F2** otherwise: no code change. FGC-16 is closed with the measurement.

## §5 Docs (the docs commit before HARD STOP B)

- `docs/DESIGN_SYSTEM.md`:
  - the `home-destructive` token, separate from the non-veg mark, with its contrast (A2)
  - R2's "↗" as a documented exception to `:773-774` (Q10)
  - the end-of-page block and the inline-confirm pattern
  - the Finished-cooking destination drift, noted
- `docs/plans/decisions-2026-10-19-r5-end-of-page.md` (A3, **decisions note chosen**; it follows the existing
  `decisions-2026-10-1x-*.md` notes):
  - cook history = minimal Option B after M5, D1–D6 open
  - `feat/cooking-history-foundation` is stale: redo, don't rebase
  - "Took …" never ships
  - "I cooked this" is decided with D1–D6
  - Public is omitted until H2
- `docs/ROADMAP.md`: one pointer line to the decisions note.
- `docs/plans/followup-golden-corpus.md`: FGC-16 closed with the W0 measurement (FGC-51 and FGC-52 are added
  in the plan commit).
- `docs/plans/fix-saved-recipe-staleness.md:20`, `docs/plans/fix-saved-recipe-staleness-web.md:16` and the
  `apps/web/src/library/openSaved.ts:15` comment: "never deleted automatically" (Q11).

## Files to change (expected)

```
apps/web/src/library/store.ts              remove(id)
apps/web/src/library/store.test.ts
apps/web/src/plan/endOfPage.ts             pure: endOfPageFor(entry, original, now) -> {platformLine, paste} | null;
                                           copiedDate(iso, now); removeConfirmLine(session, entryId)
apps/web/src/plan/endOfPage.test.ts
apps/web/src/plan/EndOfPage.tsx            view only: block, as-written, remove + confirm
apps/web/src/plan/PlanScreen.tsx           render EndOfPage on the Plan tab; F1 if chosen
apps/web/src/plan/PlanScreen.test.ts       status-line placement (F1 only)
apps/web/src/App.tsx                       entry via persistTargetId; onRemove -> remove, endSessionIfFor, Cookbook tab
apps/web/src/AppShell.tsx                  only if needed to open on the Cookbook tab
apps/web/src/library/openSaved.ts          comment only (Q11)
apps/web/src/home/tokens.css               home-destructive (A2)
docs/DESIGN_SYSTEM.md
docs/ROADMAP.md
docs/plans/decisions-2026-10-19-r5-end-of-page.md
docs/plans/followup-golden-corpus.md
docs/plans/fix-saved-recipe-staleness.md
docs/plans/fix-saved-recipe-staleness-web.md
docs/plans/r5-end-of-page.md
```

Not touched: `apps/api/**`, `packages/schema/**`, `apps/web/src/__fixtures__/**`, `apps/web/src/history/**`.
Anything outside this list → STOP.

## Tests — red first, generic

Use synthetic recipes. Fixture names appear only in fixture loading.

- **`store.remove`**
  - removes by id
  - an unknown id is a no-op
  - `list` and `findBySource` no longer return it
  - survives a reload
  - other entries are byte-identical
- **`endOfPageFor`**
  - saved URL → platform + date, no paste
  - unsaved URL → null (Q0)
  - saved paste → date + paste
  - unsaved paste (`extras.original`) → paste, no date
  - `original` null with a text `graph.source` ("hand-authored") → no paste
  - server origin → null
- **`copiedDate`**: current year → "12 Oct"; other year → with the year (Q13).
- **Remove availability** (`persistTargetId` path)
  - an auto-saved import origin finds the entry (A1)
  - a failed save → none
  - server → none
- **`removeConfirmLine`**: a matching session adds the cook line; a non-matching one does not.
- **Wiring (pure helper)**: remove with a matching session ends it; a non-matching session is untouched.
- **Copy**: no "phase", "session" or "Library" in new strings.
- **F1 only**: the status line precedes the outline, and is still absent while staleness shows (A5).
- No snapshot tests.

## W0 — data report → STOP

- Per render fixture: platform, entry? / `saved_at`, `original`?, `original.source.kind`, paste length,
  block shown?, Remove shown?
- A1: the auto-save path and the entry id, with file:line, re-verified.
- A2: the measured `home-destructive` / `home-ground` contrast (≥ 4.5:1). Pre-computed ≈ 6.1:1.
- A5: does any fixture or scenario hit degraded and staleness at once? File:line for each path that sets
  each.
- Q13: the formatter found, or "none".
- FGC-16: the y of the status line at 360×697 (degraded injected) against the fold minus the measured bar
  height; the same at 390×844.
- The bar height measured; the clearance below the last content.
- `git status --short` (A6).

## W1 — renders → STOP for owner pick

- Use the real `PlanScreen` at 390×844 and 360×697, in Playwright's own headless Chromium: DSF 2, light,
  `<meta name="darkreader-lock">`, and a body-background check before trusting a shot.
- Harness: copy `notes/render-harness-r4/` (main checkout) into `apps/web` as **untracked**
  (`vite.render-r5.config.ts`, `render-r5.html`, `src/__render_r5__/end.tsx`). Keep `cacheDir` and the
  output out of the repo. Never staged (A6). Not a project dependency.
- Render set:

| # | Scene | Covers |
|---|---|---|
| 1 | kadhi-pakora, saved, corpus original | stated servings, Hindi title, URL line + date |
| 2 | croissant, saved | defaulted servings, long waits, end after a long plan |
| 3 | sabudana-khichdi, saved | Hindi source, no original |
| 4 | kadai-paneer, saved | gated hand golden: date only, no paste, no junk source |
| 5 | synthetic-defaulted-servings + synthetic text original, saved and unsaved | pasted text, no URL; as-written closed / open / "Show all" |
| 6 | kadhi as an auto-saved import origin vs a failed save | Remove works right after import (A1) vs no block, no Remove (Q0) |
| 7 | kadhi + croissant with `degraded` | FGC-16, F1 vs F2 |

- Remove states on #1: idle / confirm / confirm with a cook in progress.
- Output: contact sheet + `shoot-log.json` → `notes/r5/w1` (main checkout).
- **Fixture gap:** no real pasted-text import or Instagram recipe exists in the corpus; #5 is synthetic.

## Implementation: tests red → code → HARD STOP A

- **Proofs**
  - FGC-16 measured at 360×697, before and after.
  - Screenshots of the chosen options.
  - Walk the DESIGN_SYSTEM rows (Step 0 g, §5) against the render.
- **₹0**
  - `dump_extraction_request.py` base vs head, 12/12 `cmp`: 4 stream × strict, with ADDED_STEPS off, on, and
    unset (the unset case via an untracked wrapper).
  - `OPENAI_API_KEY` and `LLM_API_KEY` set invalid in-process.
- **Suites:** `pytest -m "not llm and not network"` and `npx vitest run`, with the same commands at base and
  head. The R4b baseline from the brief (pytest 1931, vitest 1769) is re-measured at base. Deltas listed.
- **Unchanged:** `POSTPROCESS_VERSION` 14; golden diff empty; `export_web_fixtures.py` diff empty (then
  `git checkout` the fixtures, CRLF); `make types` diff empty.
- **Static checks:** `tsc -b`, `npm run lint` (= `tsc -b && oxlint`), `ruff check`, `mypy --strict` on
  `abc_cook/schema` and `abc_cook/schedule`.
- `git status --short`: harness untracked (A6).
- Any unexpected change → STOP.

## Docs commit → HARD STOP B (squash)

1. `git rev-parse HEAD^{tree}`
2. `git reset --soft origin/main`
3. Make one commit.
4. Confirm the tree is equal.
5. `git show --stat HEAD` = the expected file list.
6. Mojibake scan (Ã, â€, Â, U+FFFD) of the full diff.
7. `git ls-files --eol`: LF for every touched file.
8. `git status --short`: harness untracked.

Then `git push -u origin feat/r5-end-of-page` and `gh pr create --body-file`.

## Setup

- Worktree from `origin/main` (done in the plan commit).
- `npm ci` in `apps/web` (and in `packages/schema` only if `make types` is run for the diff proof).
- Absolute `PYTHONPATH=C:\Users\ashya\Music\abc-cook-r5\apps\api` on every Bash call.

## Carried rules

- **Copy and rendering**
  - The frontend renders and never computes cooking figures. R5 shows none.
  - Never the words "phase" or "session" in UI copy.
  - "Cookbook", never "Library".
  - Generic logic: recipe names only in tests.
  - Home register tokens (`apps/web/src/home/tokens.css`).
  - Source units are never converted.
- **Writing and staging**
  - Non-ASCII only via Write/Edit, never heredocs.
  - Never `git add -A` or `.`. Stage explicit paths, then `git status --short`.
  - The repo is `* text=auto eol=lf`. `make types` and `export_web_fixtures.py` write CRLF: `git checkout`
    the fixtures and convert generated files back to LF.
  - Never `ruff format .`.
- **Runs**
  - ₹0 only. Frozen data: no YouTube, no live LLM, no deploy, no phone runs.
  - Stop only your own PIDs. Port 9222 belongs to the owner.
- **Cleanup**
  - Only after `gh pr view feat/r5-end-of-page --json state` = MERGED.
  - Copy notes/evidence and the harness files to the main checkout first.

## Copy table (approved)

| Where | String |
|---|---|
| Block heading | "Where this came from" |
| Platform line, URL | "{YouTube \| Instagram \| hostname} · copied {12 Oct}" |
| Platform line, paste | "Pasted text · copied {12 Oct}" |
| Platform line, unsaved | "Pasted text" (an unsaved URL import shows no block, Q0) |
| As written, closed | "Show the recipe as written" |
| As written, open | "Hide the recipe as written" |
| As written, long | "Show all" |
| Remove | "Remove from Cookbook" |
| Confirm line | "Remove this recipe from your Cookbook? To get it back you'd copy it again." |
| Confirm line, cook in progress | "…Your cook in progress ends too." |
| Confirm buttons | "Remove" / "Keep it" |
| FGC-16 (unchanged text) | "Plan simplified — steps run one after another." |

## Risks

- **`source_text` size.** The paste is capped in height.
- **Remove loses `original`.** That is why the confirm exists.
- **Orphan session.** A session left on a removed id is avoided by `endSessionIfFor`, which is tested.
- **F1 changes the R1/R2 header order.** The owner sees it at W1.
- **No real paste or Instagram fixture.** Real-device confirmation is deferred.
- **Leftover folder.** `C:\Users\ashya\Music\abc-cook-r4` is an empty, unregistered folder left from R4,
  for the owner.
