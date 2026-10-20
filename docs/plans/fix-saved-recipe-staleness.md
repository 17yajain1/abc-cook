# Fix 4: saved-recipe staleness

**Status:** plan rev 2, 2026-10-16. PR 1 (server) merged as #58. PR 2 (web) implemented on `fix/saved-recipe-staleness-web` per `docs/plans/fix-saved-recipe-staleness-web.md`, pending device validation and review. Supersedes the proposal in
`docs/plans/followup-saved-recipe-staleness.md` (that proposal only re-ran `schedule()`; Step A shows that cannot fix v6/v7).
All references are to `origin/main` @ 4c04f20.

**Rev 2 changes (owner review 2026-10-16):**
1. Feed saves are refreshed by replacing them with the current feed entry, not by rescheduling. `GraphOriginal` is dropped.
2. Split into PR 1 (server) and PR 2 (web).
3. Three more PR 1 tests.
4. Request-size cap on `/recipes/reprocess`.
5. Definition of an active session, and what happens to a stale old session.
6. Commits renumbered.
7. Q1–Q10 answered.

## Context

A bump of `POSTPROCESS_VERSION` (now 8) invalidates only the server result cache. Saved recipes live in `localStorage` and keep the graph and plan they were saved with, for good. Versions 6 and 7 changed `extract/graph.py` (ingredient-id resolution D3, Hindi units D5, offset ≠ duration). Version 8 changed `schedule/scheduler.py`. So a sabudana saved before v6 still shows the false Temper ← chutney edge. That is wrong advice, not approximate timing.

Goal: a saved recipe either shows output from the current pipeline, or is clearly marked as possibly out of date. It is never deleted automatically, and refreshing never costs an LLM call.

**Governing rule:** the version stamp never claims more than the refresh redid.

---

## Step A: findings

### A1. What a SavedRecipe stores today

- Pydantic: `apps/api/abc_cook/schema/library.py:44-64` has `SavedRecipe {id, source_key, saved_at, updated_at, payload: RecipePlanResponse, import_meta: ImportMeta | null}`. `ImportMeta` (`:27-41`) is `{warnings, review_recommended, sources, provenance, degraded}`. `SavedLibrary` (`:67-71`) is `{version: Literal[1], recipes}`.
- `payload` is `RecipePlanResponse` = `{graph, plan, stages, summary}` (`schema/api.py:30-47`). That is derived output only. **Nothing stores the `NormalizedRecipe`, the source text, the raw title or the repair proposal.** Nothing records which post-processing version produced the entry.
- Storage: `apps/web/src/library/store.ts`, key `abc-cook:library:v1` (`:12`). It is read once (`:43`, `readLibrary` `:89-100`) and written whole on every `save` (`:102-110`, always `version: 1`). `save` dedupes by `canonicalSourceKey(payload.graph.source)` and replaces in place (`:58-81`).
- `isSavedLibraryShape` requires `version === 1` (`:148-150`). Any other version is salvaged to `abc-cook:library:v1:unreadable-<ts>`, and the app gets an empty library (`:94-97`). **There is no migration code anywhere.**
- Writers: `App.tsx:124` (`onImported`), `App.tsx:213` (`saveCurrent`), `feed/saveFromFeed.ts:35` (`library.save(payload, null)`).
- Readers: `App.tsx:84-96`, `App.tsx:173-183`, `shell/AppShell.tsx:68,96,106`, `home/CookbookTile.tsx`, `home/HomeScreen.tsx`, `home/continueCooking.ts:35`, `library/LibraryScreen.tsx:123`.
- Sessions: `cooking/engine.ts:83-92` `open()` reports a conflict when `planKey` **or** `graphId` differs. A library entry's planKey is `library:<id>` (`cooking-mode/planKey.ts:51-61`).

### A2. What the server needs to rebuild a graph and plan

- Post-processing input is `NormalizedRecipe` + `render_source_text(raw)` + `raw.title` + the blog `name` + `SourceRef` + `graph_id` (`extract/import_pipeline.py:375-405`). The chain is `resolve_title` → `build_graph` → `validate` → (if violations) `repair_or_degrade` → `schedule`/`stage_spans`/`summarize`/`compute_provenance`/`corroborate` (`:385-498`).
- `repair_or_degrade` is an LLM call (Sonnet) (`extract/repair.py:287-394`). Its `RepairProposal` is merged into the recipe (`_merge_repair` `:184-234`), then `build_graph` runs again (`:373`). The proposal is never returned or stored.
- The result cache stores only the final `ImportResult` (`extract/cache.py:46-56`), keyed by `cache_identity(source_key, PipelineFingerprint)` (`:319-328`, which includes `postprocess_version` and `result_schema_sha256`). It has no normalized or raw stage. A bump misses everything, and the 7-day TTL deletes entries anyway (`:143-146`). Text sources are never cached (`:84-93`).
- **Conclusion:** today, re-processing needs a full re-import (acquire + LLM, about 2 min). It becomes free only once the post-processing inputs are kept with the saved entry. The offline replay pattern already exists (`scripts/export_web_fixtures.py:55-94`, `tests/test_extract_replay.py`). **The sabudana already saved can only be fixed by one user-initiated re-import.**

### A3. How the web app learns POSTPROCESS_VERSION

It doesn't. `GET /health` returns `{status, version: "0.1.0"}` (`api/routes/health.py`). No response carries it.

### A4. Everything that reads SavedRecipe / SavedLibrary

- Python: `schema/library.py`, `schema/__init__.py:18,52,71-72`, `scripts/export_schema.py:23,43` (a TS root), `tests/test_schema.py:138-195`.
- Generated TS: `packages/schema/index.ts:738` (ImportMeta), `:825` (SavedLibrary), `:841` (SavedRecipe).
- Web tests: `library/store.test.ts` (`:229-236` asserts that `version: 2` = unreadable, which PR 2 inverts), `cooking-mode/planKey.test.ts:46-172`, `feed/feed.test.ts:92-104`, `home/continueCooking.test.ts:17` (a literal `SavedRecipe`).
- E2E: `apps/web/e2e/overflow.spec.ts:47` writes a v1 library literal.
- Goldens and web fixtures do not read SavedRecipe.
- **`export_web_fixtures.py` count:** 8 `SLUGS` (`:32-41`) + 1 `IMPORT_REPLAYS` (`:47`) + 1 synthetic = **10 `plan-response.json`, all with a graph**. Plus **1 `synthetic-defaulted-servings.import-warnings.json`, which has no graph**. 11 files, 10 graphs.
- `make types` (`Makefile:58-61`) also re-runs `export_web_fixtures.py`.

### A5. Where feed graphs come from (rev 2)

- `feed/source.ts:8-10` is the only source chooser. H1 returns `import('./mock').createMockFeedSource()`. There is no server feed yet (H2).
- `feed/mock.ts:12-19` imports **8 bundled web fixtures** from `@/__fixtures__/*.plan-response.json`, the files `export_web_fixtures.py` writes. `ENTRIES` (`:57-70`) pairs each with a **fake** `SourceRef` (`yt()`/`ig()`/`web()`, `:53-55`, fake video ids and `recipes.example.test`).
- `getPlan` (`:93-99`) returns `structuredClone(fixture)` with `graph.source` overwritten, so a feed save's `source_key` = `canonicalSourceKey(fake source)` = `FeedItem.sourceKey` (`:75`).
- `saveFromFeed.ts:33-35` saves that payload with `import_meta: null`. **`import_meta === null` ⇔ feed save**: server-origin recipes (`openRecipe`, `App.tsx:64`) can't be saved, because `saveControlFor` returns `undefined` for `server` (`App.tsx:296`).
- **Provenance of those graphs:** 7 come from hand-authored `tests/fixtures/*.graph.json` (scheduled by the scheduler at export time). 1 (`pizza-dough`) is a **pipeline replay through `build_graph`** (`export_web_fixtures.py:55-94`). So feed payloads are pipeline output, as current as the last fixture export. Re-scheduling the stored graph would be wrong for the replayed one (its `graph.py` output can be stale), and claiming "current" after a reschedule would break the stamp rule.
- **Consequence:**
  - A stale feed save is refreshed by **replacing its payload with the current feed entry of the same `source_key`** (same `getPlan`), keeping `id`/`saved_at`/`updated_at`. This is web-only (PR 2).
  - If no current entry has that key, the save is marked **needs_reimport**. (For the H1 mock the fake URLs can't actually re-import; the marker still shows, and that is honest.)
  - **No saved graph is truly hand-authored, so `GraphOriginal` is dropped.**
  - To stamp a replacement honestly, the bundle must know which version its fixtures came from. `export_web_fixtures.py` writes `__fixtures__/postprocess-version.json` = `{"postprocess_version": N}`, and a Python guard test fails when it is ≠ `POSTPROCESS_VERSION`, which forces the export on every bump. A replacement is applied only when that stamp equals the server's version. Otherwise needs_reimport.
- **This changes PR 1's scope** vs rev 1:
  - **Removed:** `GraphOriginal` and the reschedule-only branch of `/recipes/reprocess`.
  - **Added:** the fixture version stamp file + its guard test (in the regen commit).
  Per your instruction, setup is held until you confirm.

---

## Step B: plan

### B1. Data model (Pydantic first; TS generated), PR 1

```
ImportOriginal                         # immutable after save; everything post-processing reads
  recipe: NormalizedRecipe             # the extraction model's own output (pre-repair)
  repair: RepairProposal | None        # the stored Sonnet proposal, replayed without a call
  source_text: str                     # render_source_text(raw)
  raw_title: str | None
  blog_name: str | None
  source: SourceRef                    # keeps imported_at, so source_key never changes
  graph_id: str                        # kept: session graphId stays stable across a refresh
  acquisition_warnings: list[str]
  sources: list[ImportSource]

SavedRecipe (v2) = v1 fields unchanged (payload, import_meta stay top-level = the derived copy)
  + original: ImportOriginal | None    # None = feed save or legacy import
  + postprocess_version: int | None    # version that produced payload; None = unknown = stale
  + edits: list[RecipeEdit] = []       # reserved for R6, always [] now (see B5)
SavedLibrary.version: Literal[2]

RecipeEdit (placeholder envelope, R6 fills the op union)
  id: str; created_at: datetime; op: str; anchor: JsonValue; value: JsonValue
```

- `ImportResult` gains `original: ImportOriginal | None` and `postprocess_version: int | None`. Both are set on `status="done"`. This is additive, and it changes `result_schema_sha256`, so the cache misses once.
- `RecipePlanResponse` stays frozen and unchanged.
- `schema/api.py` gets:
  - `ReprocessRequest {original: ImportOriginal}`
  - `ReprocessResponse {payload: RecipePlanResponse, import_meta: ImportMeta, postprocess_version: int}`
  - `ServerInfo {status, version, postprocess_version}`. `/health` returns `ServerInfo`; it moves into `schema/` so TS is generated.
- New TS roots in `export_schema.py`: `ReprocessRequest`, `ReprocessResponse`, `ServerInfo`.

### B2. Server: one pure post-process function, two callers, PR 1

- Extract `run_import`'s body after normalization (`import_pipeline.py:378-498`) into `extract/postprocess.py: postprocess(original, *, repair_fn) -> (ImportResult, tier)`.
  - `run_import` passes a `repair_fn` that may call the LLM.
  - `reprocess()` passes a **replay-only** `repair_fn`. If violations exist and `original.repair` is set, it merges the stored proposal (`_merge_repair`) and rebuilds. If there is no stored proposal, or it no longer fixes the violations, the result is the deterministic linear degrade.
  - `reprocess()` takes **no adapter parameter**, so an LLM call is structurally impossible.
- `repair_or_degrade` additionally returns the `RepairProposal` it applied, so it can be stored.
- Route `POST /recipes/reprocess` in `api/routes/recipes.py`. Pure CPU, no I/O.
- **Request-size cap: 512 KiB on the body.**
  - It is checked on `Content-Length` before parsing; a missing length gets a read-limited stream. Over the cap → 413.
  - Then Pydantic validation (422 on a bad shape), plus field caps: `source_text` ≤ 100 000 chars, `recipe.steps` ≤ 200, `recipe.ingredients` ≤ 300.
  - Reasoning: the largest real input is bounded by `TRANSCRIPT_CHAR_CAP = 24 000` (`acquire/transcript.py:24`) + description + blog text + the normalized recipe, well under 200 KiB. 512 KiB leaves headroom and refuses abuse. The checkpoint reports measured sizes for the 5 largest local imports.
- `postprocess.py` is added to `_EXTRACT_MODULES` in `test_postprocess_version.py`. The refactor changes the hash, so a **bump 8→9 is needed (behaviour-neutral, cache-only). HARD STOP before it.**

**PR 1 tests** (synthetic `NormalizedRecipe`s built in the test file, no recipe names in logic):

- **Equivalence:** for the captured replay inputs, `reprocess(original)` deep-equals `run_import`'s result with a fake acquire and adapter.
- **Stored repair applied:** a synthetic recipe whose `build_graph` violates a repairable rule, plus a stored `RepairProposal` that fixes it. The result is tier `repaired`, and the graph equals the cold path's repaired graph.
- **Stored repair no longer fixes it:** the same recipe with a proposal that leaves the violation in place. The result is tier `degraded` (linear fallback), with a `degraded` warning and no raise.
- **No LLM ever:** the route and `reprocess()` are exercised with a fake adapter **injected into the app's adapter dependency** that raises on any call. Across clean / repaired / degraded inputs, nothing raises and the adapter is never touched.
- **Route limits:** an oversize body → 413, a malformed body → 422, and a valid body → 200 with `postprocess_version == POSTPROCESS_VERSION`.
- **`/health`** returns `postprocess_version`.
- **Fixture stamp guard** (in the regen commit): `apps/web/src/__fixtures__/postprocess-version.json` equals `POSTPROCESS_VERSION`.

### B3. Staleness detection, PR 2

- The stamp is `SavedRecipe.postprocess_version`. It is written on import save (from `ImportResult`), on refresh (from `ReprocessResponse`), and on feed replacement (from the fixture stamp file).
- The current version comes from `GET /health` → `ServerInfo.postprocess_version`. It is fetched lazily on the first saved-recipe open, memoised for the app session, and also updated from import and reprocess responses.
- Compared **on open** only. There is no startup network call and no Cookbook reordering.
- Pure `stalenessOf(recipe, serverVersion, feedLookup) -> "current" | "refreshable" | "feed_replaceable" | "needs_reimport" | "unknown"` in `library/staleness.ts`, unit tested.

### B4. What happens when stale: (c) mixed, PR 2

| State | Behaviour |
|---|---|
| refreshable (`original` set) | Silent refresh on open. Call `/recipes/reprocess` with a **3 s timeout**, showing the existing `loading` view. On success, replace `payload`/`import_meta`/stamp in place (same `id`, `saved_at`, `updated_at`, `graph_id`). |
| feed_replaceable (`original == null`, `import_meta == null`, current feed has the `source_key`, fixture stamp == server) | Replace the payload with the current feed entry in place (same `id`/`saved_at`/`updated_at`). Stamp = fixture stamp. No network call. |
| needs_reimport (legacy import, or a feed save with no current match) | Show the stored plan with **"This plan may be out of date. Re-import for the latest version."** The Re-import action runs the existing import flow on `graph.source`, and dedup replaces the entry. User-initiated (one LLM call, about 2 min). |
| refresh failed (offline, 5xx, timeout) or server version unknown | Show the stored plan with **"Couldn't check for updates. Showing your saved plan."** Nothing is written or deleted. Retry on the next open. |
| degrade on refresh (Q5) | Apply it. The linear fallback is safe, and a stale false edge is not. |
| active session on `library:<id>` | No refresh. See B4a. |

**B4a. Active session (PR 2).**
- *Active* = the stored session's `planKey === library:<id>`, it is not finished/ended, and its last update (`updatedAt`/last action timestamp, per `cooking/types.ts`) is **within 24 h**. While active, the entry opens unchanged and is never refreshed.
- An unfinished session **older than 24 h is treated as ended** and the refresh is allowed.
- After the refresh, the old session is never resumed against the new graph. Two cases:
  - `graph_id` is preserved (reprocess), so `engine.open()` would see `planKey` and `graphId` both match. On a successful refresh, PR 2 therefore **ends the stale session first** (`sessionStore` `end`, which emits no completion event) and then writes the new payload.
  - A feed replacement or re-import changes `graph.id`, so `engine.open()` already reports `conflict`. PR 2 ends the stale (>24 h) session anyway, for consistency.
- Net effect: the user sees a fresh plan and a fresh "Start cooking", never a half-session against shifted nodes.
- To confirm in PR 2 planning: the exact session timestamp field, and that `end` doesn't emit a `SessionFinished` metric.

### B5. Edits slot (owner decision 3), storage-ready only

- `original` is immutable. `payload`/`import_meta` are always *derived* = `postprocess(apply(edits, original))`. `edits` is stored separately.
- Edits will target **the original** (`NormalizedRecipe` ingredient and step indices plus expected values), not graph nodes. Node ids are derived (`graph.py:1508-1518`) and can change on reprocess.
- Each edit carries an **anchor** (index + expected current value). An edit whose anchor no longer matches after a reprocess or re-import is **kept and marked orphaned, never dropped and never force-applied**. The user sees "1 of your changes couldn't be applied". Edits on entries without `original` wait for R6.
- Now: `edits: list[RecipeEdit] = []`, the placeholder envelope in B1. Readers preserve items verbatim, and nothing writes them.
- **Amended 2026-10-20 (R6, owner Q1 and Q2; `docs/plans/r6-tier-a-editing.md`):** the first bullet's
  `postprocess(apply(edits, original))` is not used. Edits are applied as a web overlay **after** the
  schedule, to the stored payload and never to `original`, so node ids, edges and durations cannot move
  (measured: applying an edit to the original and reprocessing degraded the plan on every added ingredient,
  and changed durations when a step's existing time was edited). `payload` stays the server-derived copy;
  the overlay goes into the view only. Anchors follow Q2: an ingredient edit is an index into
  `payload.graph.ingredients` plus the expected line (this equals the original's index, verified on every
  fixture and corpus recipe with an `original`); a step edit (R6b) is the expected text against
  `node.instruction`, with the index as the tiebreak. The orphan rule above is unchanged.

### B6. SavedLibrary v1 → v2 migration (web `store.ts`), PR 2

- `readLibrary` accepts `version 1 | 2`. A v1 entry becomes `postprocess_version: null`, `edits: []`, `original: null`, with every v1 field byte-identical. Feed vs legacy is distinguished at open time by `import_meta === null` (A5), not stored.
- The first successful write stores `version: 2`. The key stays `abc-cook:library:v1`. Versions > 2 keep salvage-and-empty. A bad `original` becomes `null`, never a dropped entry.
- Tests (synthetic entries):
  - A v1 library with 3 entries (import-meta set, null, minimal) loads all 3 with expected defaults.
  - v1 fields deep-equal the input.
  - After one `save`, storage holds `version: 2` with all entries.
  - Re-reading v2 is the identity.
  - Unknown extra fields survive.
  - `version: 99` is salvaged; this replaces `:229-236`.
- Python models v2 only (Q6).

### B7. Two PRs, renumbered commits

**PR 1: server** (branch `fix/saved-recipe-staleness`, worktree `abc-cook-saved-staleness`)

1. `docs(plans): saved-recipe staleness — implementation plan`, which also marks `followup-saved-recipe-staleness.md` as superseded.
2. `test(api): reprocess — equivalence, stored repair, repair-no-longer-fixes, no-LLM, route limits` (failing).
3. `refactor(extract): post-process as one pure function; repair returns its proposal` (`postprocess.py`, `import_pipeline.py`, `repair.py`). The guard test goes red; no bump here.
4. `feat(api): ImportOriginal on ImportResult; POST /recipes/reprocess with size cap; ServerInfo on /health`.
5. `feat(schema): SavedRecipe v2 (original, postprocess_version, edits)` (Pydantic only).

**── HARD STOP ──** Report:
- pytest / ruff / mypy results
- the guard test's red diff
- the proposed bump history line
- measured request sizes for the largest local imports

Don't run `make types`, touch fixtures or goldens, bump the version, or push. Wait for approval.

After approval:

6. `chore(cache): POSTPROCESS_VERSION 9`.
7. `chore(types): regenerate; stamp web fixtures with POSTPROCESS_VERSION`. `export_web_fixtures.py` writes `postprocess-version.json`, plus a guard test. The diff should be `packages/schema` + the new stamp file only. The 10 plan-response fixtures must come out byte-identical; if not, stop.

Push and open PR 1 on approval. PR 1 changes nothing user-visible.

**Between merges:**
- After PR 1 merges and before PR 2, `App.tsx:124` saves only `(payload, importMeta)` and drops `ImportResult.original`/`postprocess_version`. **Every recipe saved in that gap becomes needs_reimport after PR 2.** That's acceptable for a short gap; keep it short.
- `/import` responses also grow by `original` (about tens of KB).

**PR 2: web**, planned in a new worktree from `main` after PR 1 merges. It is not planned in detail here. Expected commits:
1. Plan file.
2. Migration tests (failing).
3. v2 migration in `store.ts`, with `save` taking `original`/`postprocess_version`.
4. `library/staleness.ts` + tests.
5. Client `fetchServerInfo` / `reprocess`.
6. Open-path refresh, feed replacement, B4a session handling, marker copy.
7. Device check at 390 px for all states.
8. Docs.

### B8. Verification

- **PR 1:** full `pytest` (goldens in `test_schedule.py` unchanged), `ruff`, `mypy --strict`, a manual `curl` of `/recipes/reprocess` with a saved `ImportOriginal`, and the 413/422 paths.
- **PR 2:**
  - `npm test`, `tsc`, e2e `overflow.spec.ts` (v1 literal still loads).
  - Phone, with a seeded v1 library: a legacy import shows the marker; a feed save is replaced in place; a v2 import entry refreshes silently.
  - API down → the stored plan with the "Couldn't check" line.
  - An active session (<24 h) → no refresh. A >24 h session → refresh, and the old session is ended.

## On approval (only these, then stop)

Held, because A5 changes PR 1's scope. Once you confirm:
- Run `git worktree add C:\Users\ashya\Music\abc-cook-saved-staleness -b fix/saved-recipe-staleness origin/main`.
- Save this plan as `docs/plans/fix-saved-recipe-staleness.md` there (uncommitted).
- Run `npm ci` in `apps/web`.
- Show `git worktree list` and the first 10 lines of the plan file.

## Decisions (owner, 2026-10-16)

1. Legacy entries: a marker + one-tap Re-import, never automatic.
2. Storage size: accept it. Measure at the checkpoint. On quota failure, save without `original` (→ needs_reimport) rather than failing the save.
3. Shape: `payload`/`import_meta` stay top-level, with `original`/`postprocess_version`/`edits` as siblings.
4. `edits`: `list[RecipeEdit]` placeholder envelope now.
5. A degrade on reprocess is applied.
6. Python models v2 only; migration lives in `store.ts`.
7. Copy: "This plan may be out of date. Re-import for the latest version." / "Couldn't check for updates. Showing your saved plan."
8. Refresh timeout: 3 s.
9. Public feed (H2): follow-up note in `docs/PRODUCT.md` § Public recipes; not built.
10. Mark the old follow-up spec superseded in commit 1.
