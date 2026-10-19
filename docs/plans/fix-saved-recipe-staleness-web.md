# Fix 4 PR 2 (web): saved-recipe staleness

**Status:** plan rev 1, approved 2026-10-16 with two clarifications: the quota retry also covers new entries, and device state 15 was added. Not implemented. The spec is `docs/plans/fix-saved-recipe-staleness.md` (rev 2, merged in #58), sections B3, B4, B4a, B5 and B6 plus the owner decisions. Every reference below is to `origin/main` @ be636f4.

## Context

PR 1 shipped the server side:
- `ImportResult.original` and `ImportResult.postprocess_version`
- `POST /recipes/reprocess`
- `ServerInfo` on `/health`
- the `SavedRecipe` v2 Pydantic model and the generated types
- the fixture stamp `__fixtures__/postprocess-version.json` (currently 9)

The web app still writes v1 (`library/store.ts:102-105`, the workaround), and it throws away `original` and `postprocess_version` on import (`useImportJob.ts:70-82`, `App.tsx:124`). As a result, every recipe saved today becomes needs_reimport later.

PR 2 makes a saved recipe either current or honestly marked. It never deletes anything automatically, and it never makes an LLM call without the user asking for it.

## Step A: findings against current main

**A1. Generated types are ready.**
- `packages/schema/index.ts` has `ImportOriginal` (:536, including `start_min`), `ReprocessRequest`/`ReprocessResponse` (:1099/:1112) and `ServerInfo` (:1183).
- `SavedRecipe` (:1145) gives `original`, `postprocess_version` and `edits` as optional fields.
- `SavedLibrary.version?: 2` (:1133).
- There is no hand-written TS mirror to add.

**A2. Session timestamp: there is no `updatedAt`.**
- `CookingSession.lastSeenAt` (`cooking/types.ts:21-22`) is the only "last seen" field.
- It is written only by:
  - `start` (`engine.ts:115`)
  - `leave` (`:277`)
  - `resume` (`:295`)
  - `touch` (`:302`)
- `touch` is dispatched only from the stale screen's Continue button (`viewModel.ts:552` → `CookingModeScreen.tsx:186-187`).
- **`markDone`, `startNode`, `skip`, `extend` and `acknowledge` never update it.** If "last update" meant `lastSeenAt` alone, a two-sitting cook started 25 h ago would read as ended even while a timer is still running.
- Fix: activity is the latest of:
  - `lastSeenAt`
  - `lastTransition?.at` (`types.ts:30`)
  - every node timestamp (`deferred.at`, `running.startedAt`/`endsAt`, `done.at`, `types.ts:46-50`)

  Any running node with `endsAt > now` counts as active. This matches the convention in `foreignIsStale` (`select.ts:312-320`). See Q2.

**A3. Ending a session emits no metric (confirmed).**
- `store.dispatch({type:'end'})` is `persist(engine.end())` (`cooking/store.ts:128-129`), and `engine.end()` returns `null` (`engine.ts:128-130`). No emit happens anywhere in that path.
- `SessionFinished` is emitted only by the wrappers `finishCooking` (`cooking-mode/finalizeSession.ts:44-52`) and `replaceSession` (`:58-69`), called from `CookingModeScreen.tsx:147,196`.
- `useSession.end` (`useSession.ts:80`) doesn't emit either.
- Caveat: the store holds **one session at most**, and `end` clears *whichever* session is stored. PR 2 therefore checks `planKey === library:<id>` before it dispatches.

**A4. The spec's "`import_meta === null` ⇔ feed save" is not true on main.** There are two feed save paths:
- The card's "Add to cookbook" → `saveFromFeed` → `save(payload, null)` (`feed/saveFromFeed.ts:35`). This path stores `import_meta: null`.
- Opening a feed recipe, then tapping the header Save → `openFeedRecipe` sets the origin `importMeta: NO_IMPORT_META` (`App.tsx:103-112`) → `saveCurrent` saves `prev.origin.importMeta` (`App.tsx:213`). This path stores a non-null `{warnings:[],…}` object.

Classified by `import_meta`, those header-saved feed entries would look like legacy imports and be offered Re-import on a fake URL. See Q1.

**A5. Other open paths.**
- Continue strip Resume and conflict "Go to" use `goToConflict` (`App.tsx:169-185`) and go **straight to cooking**. That only happens when a session exists, so it never refreshes. That is correct under B4a, and they stay unchanged.
- Only `openSaved` (`App.tsx:83-97`) gets the staleness path.

**A6. The loading view prints the id.**
- `{kind:'loading', recipeId}` renders `Scheduling {recipeId}…` (`App.tsx:225`). For a library open that would show a UUID.
- PR 2 adds a `label` field so it shows the title. See Q12.

**A7. Feed lookup.**
- `FeedSource` has only `filters`, `list` and `getPlan` (`feed/types.ts:40-45`). There is no lookup by source key, and nothing knows the bundle's version stamp.
- The mock's `ENTRIES` (`feed/mock.ts:57-70`) and `canonicalSourceKey(e.source)` (`:75`) already give the key.
- `loadFeedSource()` (`feed/source.ts:8-10`) is a lazy chunk, independent of `feedEnabled`. See Q11.

**A8. E2E entries.**
- `overflow.spec.ts:20-34` seeds a v1 library whose entries have **no `import_meta` key at all**, `source_key: fixture:<name>`, and no stamp.
- Under this plan they classify offline as feed-like with no match, so they get needs_reimport with no action and no network call (Q5). Every recipe page in the e2e run then shows one marker line, and the overflow checks cover it.
- Opening an entry first awaits the lazy feed chunk, so the "Back visible" wait in the spec may need nothing. Verify in the run.

## Step B: design

### B1. `library/store.ts` (B6 + save/refresh)

**Read: `readLibrary` accepts `version` 1 or 2.**
- Any other version, or an unparsable library, keeps the existing salvage-and-empty behaviour (`salvageUnreadable`, unchanged).
- Each entry that passes `isStructurallyValidRecipe` is normalised by a new pure `migrateEntry`:
  - `{...entry}` keeps unknown fields and leaves every v1 field byte-identical. A missing `import_meta` stays missing.
  - `postprocess_version`: kept when it is an integer, else `null`.
  - `edits`: kept verbatim when it is an array, else `[]` (B5).
  - `original`: kept when `isImportOriginalShape` passes, else `null`. A bad `original` never drops the entry.
- `isImportOriginalShape` is structural only:
  - plain-object `recipe` and `source`
  - `source.value` is a string
  - `source_text`, `raw_title` and `graph_id` are strings
  - `start_min` is a number

  The server does the real validation (a 422 is handled in B4).

**Write: `writeLibrary` writes `const body: SavedLibrary = { version: 2, recipes }`.**
- This reverts the PR 1 workaround at `store.ts:102-105`.
- The key stays `abc-cook:library:v1`.

**`save(payload, importMeta = null, extras?: { original?: ImportOriginal | null; postprocess_version?: number | null })`**
- New and replaced entries set `original = extras?.original ?? null` and `postprocess_version = extras?.postprocess_version ?? null`. A replace keeps `existing.edits ?? []`.
- If the write fails and `original` is non-null, the save **retries once with `original: null`**. This applies to new entries and replaced entries alike (owner clarification 1). The stamp is kept, because the payload really is that version's output. That entry becomes needs_reimport at the next bump.
- Only a failed retry returns `{ok:false}`.
- `SaveResult` ok gains `withoutOriginal: boolean` for tests. The UI does not show it.

**New `refresh(id, next: {payload, import_meta, postprocess_version})`**
- It replaces the derived copy in place.
- It keeps `id`, `source_key`, `saved_at`, `updated_at`, `original` and `edits`, so there is no Cookbook reorder (`list()` sorts by `updated_at`).
- It rejects with `{ok:false}`, writing nothing, when `canonicalSourceKey(next.payload.graph.source) !== source_key`.
- Feed replacement uses it too.

### B2. `library/staleness.ts` (B3), pure

```ts
export type Staleness = 'current' | 'refreshable' | 'feed_replaceable' | 'needs_reimport' | 'unknown'
export interface FeedMatch { postprocessVersion: number }          // payload fetched separately
stalenessOf(recipe: SavedRecipe, serverVersion: number | null,
            feedLookup: (sourceKey: string) => FeedMatch | null): Staleness
```

Rules, in order:
1. If the stamp is set, `serverVersion` is set and stamp ≥ server: `current` (Q4: never downgrade).
2. If `original` is set: `refreshable` when `serverVersion` is set, else `unknown`.
3. If `original` is null and `feedLookup(source_key)` matches:
   - `feed_replaceable` when `serverVersion` is set and the match's stamp equals it
   - `unknown` when `serverVersion` is null
   - otherwise `needs_reimport`
4. If `original` is null and there is no feed match: `needs_reimport`. A null stamp is stale by definition, and an older stamp with no original can't be refreshed. This is decided offline (Q5).

`feedOrigin(recipe, feedLookup)` = `import_meta == null || feedLookup(source_key) != null`. Q1 covers the header-saved feed entries.

`reimportable(recipe, feedOrigin)` = `!feedOrigin && source.kind === 'url'` (Q8).

`sessionBlocksRefresh(session, id, now)` (B4a):
- returns false when there is no session, or its `planKey !== library:<id>`
- otherwise blocks when `activityAt(session)` (A2) is under 24 h, or a timer is still running (`endsAt > now`)
- a finished session is handled per Q3

`ACTIVE_SESSION_MS = 24 h` lives here, as a named constant.

### B3. Client + server version

**`api/client.ts`**
- `getJson`/`postJson` take an optional `AbortSignal`. An abort maps to the existing `ApiError(0, …)`.
- Adds `fetchServerInfo(signal)` → `GET /health` as `ServerInfo`.
- Adds `reprocess(original, signal)` → `POST /recipes/reprocess` as `ReprocessResponse`.

**New `api/serverVersion.ts`: `createServerVersion(fetchInfo)`**
- `get(signal): Promise<number | null>` is lazy and fetches on the first call only.
- Only a success is memoised. A failure returns `null` and retries on the next open.
- `note(v)` updates the memo from import and reprocess responses.
- `App.tsx` holds one instance at module scope, the same pattern as `library` and `sessionStore`.

**Timeout:** one 3 s `AbortController` budget per open, covering `/health` + `/reprocess` together (Q6).

### B4. Import save (spec item 2)

- `useImportJob.ts`: `OnImported` gains a 4th argument, `extras: {original, postprocess_version}`. It comes from a new pure `importExtrasFrom(result)`, a sibling of `importMetaFrom` (`:173`).
- `App.onImported`:
  - calls `library.save(payload, importMeta, extras)`
  - calls `serverVersion.note(extras.postprocess_version)` when it is set
  - puts `extras` on the `import` origin, so the `saveCurrent` retry saves them too
- `PlanOrigin['import']` gains an optional `extras`. Existing `planKey.test.ts` literals still compile.
- A quota failure is handled inside `save` (B1) and never fails the save.
- For a feed origin (Q1), `openFeedRecipe` marks the origin `fromFeed: true`, and `saveCurrent` then saves `import_meta: null`, matching `saveFromFeed`.

### B5. Open path (B4 + B4a), `App.openSaved`

**Step 1: decide synchronously.**
- Get the recipe.
- If `sessionBlocksRefresh` → open the stored plan unchanged, with no marker (Q10).
- Otherwise: if the stamp is set and equals the memoised server version, open instantly.

**Step 2: anything else is async.**
- Set the view to `{kind:'loading', label: title}`, with a token so that a late response can never overwrite a newer view.
- Get the server version. For an entry with no `original`, also run the feed lookup, which lazy-loads the feed chunk and calls `findBySourceKey`.
- Then act on `stalenessOf`:

| Result | Action | Marker |
|---|---|---|
| current | open stored | none |
| refreshable | `reprocess(original)` within the 3 s budget; then `endSessionIfFor(id)`, then `library.refresh(...)`, then `serverVersion.note(...)`; a degrade is applied | none |
| feed_replaceable | the feed payload goes through `library.refresh` with `import_meta: null`, stamped from the fixture stamp; `endSessionIfFor(id)` first; no reprocess call | none |
| needs_reimport | open stored | "This plan may be out of date. Re-import for the latest version." + **Re-import** only if `reimportable` |
| unknown / timeout / 5xx / network | open stored, write nothing | "Couldn't check for updates. Showing your saved plan." |
| reprocess 422 | open stored, write nothing | needs_reimport marker (Q9) |

- **`endSessionIfFor(id)`** dispatches `{type:'end'}` only when the stored session's `planKey === library:<id>`. It never emits a metric (A3). It runs only after a successful reprocess, and before the write.
- The same helper runs in `onImported` whenever a save *replaces* an existing entry whose session doesn't block refresh. That is B4a's "re-import ends the stale session anyway". A blocking session is left alone, which keeps the current conflict behaviour.
- **Re-import** sets the view to `{kind:'import', initialUrl: graph.source.value}`. `ImportScreen` and `useImportJob` take an optional `initialUrl` as the starting `url` state, and the user taps "Get plan" (Q8). Saving dedups and replaces the entry, with `original` and the stamp, so the marker is gone.
- **Marker UI:**
  - The `View['plan']` gets `staleness?: {kind:'stale'|'unchecked', onReimport?}`.
  - `PlanScreen` renders it in the A6 status-line slot (`PlanScreen.tsx:16-21`), as one calm line plus an optional inline text button.
  - A pure `stalenessLineFor` holds the copy and has a test.
  - The `frontend-design` skill is loaded before the UI commit.

### B6. Feed (`feed/types.ts`, `feed/mock.ts`)

- `FeedSource.findBySourceKey(sourceKey): Promise<{payload, postprocessVersion} | null>` (Q11).
- The mock imports `@/__fixtures__/postprocess-version.json` and returns `structuredClone` + `graph.source` exactly as `getPlan` does (refactored into one helper).
- `getPlan` is unchanged. H2 implements the method server-side.

## Step C: tests, e2e and fixtures affected

| File | Change |
|---|---|
| `library/store.test.ts` | `:229-236` inverts: `version: 2` now loads, and a new `version: 99` case is salvaged. Adds the B6 migration set (3-entry v1 incl. meta set/null/minimal; v1 fields deep-equal; one save writes `version: 2` with all entries; v2 reread is the identity; unknown fields survive; bad `original` → null, entry kept; non-int stamp → null; non-array edits → []). Adds save extras, replace keeps edits, quota retry → `withoutOriginal`, for both a replaced entry and a **new** entry, both writes failing → `{ok:false}`, `refresh` keeps id/saved_at/updated_at/original/edits and rejects a source-key change. |
| `library/staleness.test.ts` (new) | Every `stalenessOf` row, stamp > server, offline cases, `feedOrigin`, `reimportable`, `sessionBlocksRefresh` (wrong planKey; < 24 h; > 24 h; running timer > 24 h after start; activity from `done.at` only; finished per Q3) |
| `api/serverVersion.test.ts` (new) | lazy, memoised, failure not memoised, `note` overrides, abort → null |
| `feed/feed.test.ts` | `findBySourceKey` hit/miss, stamp equals the JSON, payload source key equals the item's; `saveFromFeed` still saves null meta |
| `import/useImportJob` → `importExtrasFrom` test (new, pure) | done result → extras; missing → nulls |
| `plan/PlanScreen.test.ts` | `stalenessLineFor`, copy exact, both strings |
| `cooking-mode/planKey.test.ts`, `home/continueCooking.test.ts` | No edits expected; must still type-check (optional fields) |
| `e2e/overflow.spec.ts` | Keep the v1 literal on purpose (it is the e2e migration check). Add one assertion that a seeded entry shows the "may be out of date" line and **no** Re-import button. |
| Fixtures | None change. `postprocess-version.json` is only read. |

Generic logic only: no recipe names outside tests.

## Step D: commits (test-first), worktree `abc-cook-staleness-web`, branch `fix/saved-recipe-staleness-web`

1. `docs(plans): saved-recipe staleness PR 2 (web) — implementation plan`
2. `test(library): SavedLibrary v2 migration, save extras, quota fallback, refresh` (failing)
3. `feat(library): read v1|v2, write v2; save takes original + postprocess_version; refresh in place` (reverts the `store.ts:103` workaround)
4. `test(library): stalenessOf and active-session rule` (failing)
5. `feat(library): staleness.ts`
6. `test(api): server version memo + timeout` → `feat(api): fetchServerInfo, reprocess, serverVersion`
7. `test(feed)` → `feat(feed): findBySourceKey with the fixture version stamp`
8. `feat(import): save ImportResult.original and postprocess_version; feed header-save stores null meta`
9. `feat(app): open-path refresh, feed replacement, staleness markers, Re-import, stale-session end` (loads frontend-design; e2e assertion)
10. `docs: staleness marker in DESIGN_SYSTEM.md; mark the spec's PR 2 implemented`

Each commit runs `npm test`, `tsc -b`, and oxlint. Commit 9+ also runs `npm run e2e`.

### ── HARD STOP before push ──

Report test, tsc, lint and e2e output. Then you check each state below on the phone at 390 px (via adb/CDP per memory), with screenshots:

1. A current v2 import entry opens instantly: no marker, no `/reprocess` request.
2. A v2 entry with its stamp set to 8 in storage shows loading ≤ 3 s, then the refreshed plan with no marker. Storage shows stamp 9 and unchanged `updated_at`/`saved_at`/`id`, and the Cookbook order is the same.
3. A seeded legacy v1 import (url) shows the "may be out of date" line + Re-import. Re-import opens prefilled; after the import, the entry is replaced and the marker is gone.
4. A legacy text-source entry shows the marker with no Re-import (per Q8).
5. A feed save (card path, null stamp) with a current match is replaced silently, with no `/reprocess` request.
6. A feed save via the header Save behaves the same as state 5 (Q1).
7. A feed save with no current match shows the marker with **no** Re-import.
8. With the API stopped, a refreshable entry shows "Couldn't check for updates. Showing your saved plan." and localStorage is byte-identical before and after.
9. With the API slow (> 3 s, throttled), the result is the same as state 8. A late response doesn't change the view.
10. An unfinished session < 24 h on a stale entry: it opens unchanged with no refresh and no marker.
11. An unfinished session > 24 h: the entry refreshes, the session is gone, the Continue strip is gone, and `abc-cook:events:v1` is unchanged.
12. A refresh that degrades: the plan is applied and shows "Plan simplified…".
13. A quota-full import save: the save succeeds and the entry has `original: null`.
14. The marker line + button with the longest fixture title at 390 and 360 px: no overflow, and the button meets the tap-target size.
15. A cold first open after the API has been idle or restarted: report whether `/health` + `/reprocess` fit in the 3 s budget. This is a report only. If it often times out, log a follow-up, "warm `/health` when the Cookbook opens", and don't build it.

No push and no PR until you approve.

## Decisions (owner, 2026-10-16): Q1–Q13 approved as leaned (shown in **bold**)

1. **Header-saved feed entries (A4).** They store `NO_IMPORT_META`, not null. **Fix it forward:** feed origins save `import_meta: null`, and an entry counts as feed-origin when `import_meta == null` *or* the feed lookup matches its key. The rare leftover (header-saved, later removed from the feed) would offer Re-import on a fake URL, which is accepted for H1.
2. **Session "last update" (A2).** **Use the composite activity time** (`lastSeenAt` + `lastTransition.at` + node timestamps, and a running timer = active), not `lastSeenAt` alone.
3. **A finished-but-unconfirmed session** (sink done, "Finished cooking" never tapped). By the owner's definition it isn't active, so the refresh would end it and lose a countable completion. **While < 24 h, treat it as blocking; after that, end it silently** (the accepted O2 undercount).
4. **A stamp newer than the server** (a dev build pointed at an older API). **Treat it as current, and never downgrade.**
5. **Offline decision.** Entries with no `original` and no feed match go to needs_reimport without calling `/health`. **Yes:** a null stamp is stale by definition, and this keeps the e2e run deterministic.
6. **3 s budget.** **One budget per open, covering `/health` + `/reprocess`**, so the user never waits more than 3 s.
7. **Marker vs. the A6 status line.** **The staleness line takes the slot**, because the A6 line came from the stale pipeline. Once refreshed, A6 shows again.
8. **Re-import.** **Prefill the URL and let the user tap "Get plan"**, which avoids an auto-submit mount effect (P1 #6 §C5) and makes the LLM spend explicit. Text and image sources get the marker without Re-import in PR 2.
9. **Reprocess 422** (the stored `original` no longer validates). **Show the needs_reimport marker, write nothing**, rather than "Couldn't check" forever.
10. **During an active session.** **No marker and no Re-import**, because re-importing mid-cook would orphan the session.
11. **`FeedSource.findBySourceKey`**, a new contract method H2 must implement. **Yes**, rather than `list('all')` + scan.
12. **Loading copy.** **`Scheduling <title>…`** (the existing verb), instead of the UUID.
13. **Docs commit.** **Use a DESIGN_SYSTEM.md entry for the marker line**, plus a status line in the spec. No PRODUCT.md change.

## Setup (done on approval, 2026-10-16)

- `git worktree add C:\Users\ashya\Music\abc-cook-staleness-web -b fix/saved-recipe-staleness-web origin/main`
- This plan was saved here, uncommitted. It becomes commit 1.
- `npm ci` was run in `apps/web`.

## Rev 1 changes after review (2026-10-16)

Owner decisions after the first implementation and the browser check of states 1-15.

1. **Copy.** The stale line is "This plan may be out of date." always. The Re-import button follows only when the entry is reimportable. The offline line is unchanged. (Replaces the Q7-era two-sentence copy.)
2. **Placement.** The staleness line moves from the A6 status slot to directly under the recipe title (`RecipeHeader`, `StalenessNotice`), so it is visible without scrolling at 360px with the longest fixture title and a plan-ahead card. A6 stays in its slot and stays hidden while the staleness line shows. The button stays at least 44px tall. The old placement was below the fold in that case.
3. **Interpretation calls, accepted.**
   - `isImportOriginalShape` does not check `start_min`. The generated `ImportOriginal` has no such field (A1 of this plan said it did). Requiring it would have nulled every real `original`.
   - `stalenessOf` rule 4 returns `unknown` (not `needs_reimport`) for an entry with a stamp, no `original`, no feed match, **and** an unknown server version. A set stamp can't be judged without the server's version, and the old rule showed a false "out of date" line offline for a current plan. A null stamp with no `original` and no feed match is still `needs_reimport` without calling `/health`.
4. **Other additions during implementation:** `ServerVersion.peek()` (sync current-stamp check); `library/openSaved.ts` (the open-path decision, injected effects, unit-tested); `importExtrasFrom` in its own module; `client.ts` guards `window` so it imports under node tests.

## Follow-ups (not in this PR)

- (a) After deploy, measure `/health` + `/reprocess` on a real Cloud Run cold start. If it misses the 3 s budget often, warm `/health` when the Cookbook opens. The local loopback measurement (225 ms total) says nothing about Cloud Run.
- (b) Check the marker on iOS Safari.
- (c) Check a real quota-full device. The browser check simulated quota with a throwing `setItem`.
