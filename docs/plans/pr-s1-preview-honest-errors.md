# PR-S1: instant preview, honest errors, ingredients-first layout

Read from `origin/main` @ 120cc36 (PR #61 merged, fetched 2026-10-16). This checkout stays on
`docs/sabudana-investigation-library`. Sources: `notes/investigate-extraction-speed/REPORT.md`,
`docs/plans/investigate-extraction-speed.md`, `docs/plans/followup-golden-corpus.md` (FGC-1, 2, 11-13),
`docs/plans/decisions-2026-10-16-ingredients-first.md` (committed in this PR).

## Context

Today a YouTube link with no linked blog shows only a status word until the whole plan arrives,
about 20-48 s at production `low` (REPORT §Staged table). ReciMe shows nothing until about 13-17 s.
Copymenu shows title, photo and description in about 1 s. Three more problems:
- A repeat import of a saved recipe costs full price. ReciMe returns HTTP 208 for one.
- An auth or network failure is reported as "this isn't a recipe" (FGC-2).
- A budget used up on reasoning is reported as "repeated or missing steps" (FGC-1).
- About 13% of calls are retried after an unparseable response, and the cause can't be diagnosed
  because the text is thrown away (FGC-13).

S1 fixes all of this with **no model-facing change**. It also lays out the import screen that S2
will fill with streamed content.

Owner decisions this session (2026-10-16):
- Bump POSTPROCESS_VERSION 9 → 10. The guard hashes the code of `normalize.py`/`repair.py`/
  `import_pipeline.py`, not their output. Finished plans don't change.
- Repair infra failure: keep the linear fallback and flag it `repair_unavailable`. The existing
  "Plan simplified" notice (`PlanScreen.tsx:19`, keyed on `importMeta.degraded`) already shows,
  because that path ends in `"degraded"`. No new UI.
- FGC-1(b) is in S1: one named ceiling constant next to `EXTRACTION_EFFORT`, plus a route-level test.

Measured during planning (₹0): `https://www.youtube.com/oembed?url=…&format=json` returns
`Access-Control-Allow-Origin: <request origin>` for localhost and for a vercel.app origin. The
OPTIONS preflight also passes, `/shorts/` URLs work, and an unknown id gives a 400 that still
carries CORS headers. So **the browser calls oEmbed directly: no new API endpoint and no Cloud Run
cold-start cost**. Instagram's oEmbed needs auth (401), so Instagram keeps today's behaviour.

## Setup

This session runs setup once it is out of plan mode. Implementation runs in a fresh session from
the committed plan and starts at commit 2.
1. `git worktree add -b feat/pr-s1-preview-honest-errors C:\Users\ashya\Music\abc-cook-s1 origin/main`
   (120cc36). This checkout stays on `docs/sabudana-investigation-library`.
2. Use the Write tool, never a heredoc, to write two files:
   - this plan → `docs/plans/pr-s1-preview-honest-errors.md`
   - the owner's pasted decisions text, **verbatim** → `docs/plans/decisions-2026-10-16-ingredients-first.md`
3. Mojibake check: `git diff --check`, and grep the two files for `Ã|â€|Â`.
4. **Commit 1:** `docs(plans): PR-S1 plan + ingredients-first decisions`, on the branch, local only.
5. Show `git log -1 --stat` and the first lines of each file. **STOP.** No push, no code.

## Part A: API (deploy first)

### A1. Pin the model-facing bytes (test first, before any code change)
New `tests/test_model_facing_bytes.py` records sha256 values taken from origin/main:
- `system_prompt(load_prompt(), NormalizedRecipe)`
- `system_prompt(load_repair_prompt(), RepairProposal)`
- `NormalizedRecipe.model_json_schema()`
- `RepairProposal.model_json_schema()`
- `render_source_text(raw)` for each corpus `RawAcquisition`

It must stay green through every later commit. Adding `ImportResult.failure` or an
`ImportJobResponse.acquired` field can't touch these, because neither type is embedded in a
model-facing schema. The test proves that.

### A2. Classify errors where the provider call is made (FGC-2, FGC-13)
- `adapters/base.py`: `ExtractResult` gains `error_kind: Literal["infra", "request", "unparseable",
  "truncated"] | None`. `raw_text` is now kept on **unparseable** responses as well as truncations
  (update the docstring).
- `adapters/openai.py`:
  - Classify exceptions:
    - `infra`: `AuthenticationError`, `PermissionDeniedError`, `APIConnectionError` (which
      includes timeouts), `RateLimitError`, `InternalServerError`, and any `APIStatusError` ≥ 500.
    - `request`: any other 4xx (for example a context-length 400). It is handled as today.
  - `error` becomes `"<ClassName> (HTTP <status>)"`, with **no exception message**. OpenAI's 401
    message echoes a masked key, and today that string ends up in `ImportResult.warnings`, which
    the client receives.
- `adapters/anthropic.py`: the same classification, using Anthropic's matching classes.
- **Timeouts vs a legitimate long call.**
  - Both adapters use `base.request_timeout_s(max_tokens) = 60 + max_tokens / 50`, which assumes
    a 50 tok/s floor:
    - **380 s** at 16K and **700 s** at 32K.
    - With `MAX_RETRIES = 1`, the SDK retries a timed-out call once.
    - Anthropic streams above 21,333 tokens, under the same timeout.
  - Measured worst case for a legitimate call (REPORT time model: about 121 tok/s, about
    8.3 s per 1K output tokens): a full 32K escalation takes about **266 s**, plus about 8 s to
    the first token, so about **275 s**. The 700 s timeout leaves about 2.5× headroom. A
    legitimate 16K call takes about 133 s against 380 s.
  - **Rule chosen:** a timeout on any call, the escalation included, means throughput stayed
    under 50 tok/s. That is a degraded provider, not a recipe too long for its budget (an
    over-long recipe ends as a `length` truncation, which is a separate path). So a timeout maps
    to `infra` → `failure="unavailable"`.
  - A guard test pins the margin. If someone later lowers the timeout or raises the escalation
    cap so that a legitimate call could time out, the test fails and the rule has to be revisited
    (the alternative being that an escalation timeout maps to `incomplete`).
- `adapters/prompting.py`: add `parse_failure_reason(text, output_type) -> str`. It returns the
  JSONDecodeError message with its position, or the first 3 pydantic error locations. This only
  adds a function: `OUTPUT_FORMAT_INSTRUCTIONS` and `system_prompt` stay untouched, and A1 guards them.

### A3. Truthful terminal results (FGC-1a, FGC-2, FGC-13 logging)
- `schema/normalized.py`: add `ImportFailure = Literal["unavailable", "incomplete"]` and
  `ImportResult.failure: ImportFailure | None`. A result with a failure carries `status="failed"`,
  which already exists in `ImportStatus`. A web build from before this PR therefore shows
  `job.error` for it instead of polling forever, so the deploy order is safe.
- `normalize.py`:
  - `_reasoning_exhausted(result)`: true when the result is truncated and `raw_text.strip() == ""`.
    It is checked **before** `_is_runaway`, which isn't changed.
    - Outcome: stop, with no escalation (REPORT T3: rare, medium-only). The result is
      `failure="incomplete"`.
    - Server warning: "Extraction used its whole {N}-token budget on reasoning
      (reasoning_tokens={R}) and produced no visible output; stopping."
  - Any call whose `error_kind == "infra"` stops at once. No same-input retry: the SDK already
    retried once (`MAX_RETRIES`). The result is `failure="unavailable"`. This applies to the first
    call, the unparseable retry and the escalation.
  - Every unparseable call logs at **WARNING**. The API sets no logging config, so INFO from
    `abc_cook` is dropped on Cloud Run. The log line carries model, `stop_reason`/`finish_reason`,
    `output_tokens`, `reasoning_tokens`, text length, `parse_failure_reason`, and the first 2,000
    and last 500 characters of `raw_text`. It never includes request headers or the key.
  - Failure results are still returned through `NormalizeOutcome.tier0_result`, so
    `import_pipeline` passes them on unchanged.
  - Neither kind is cached (`is_cacheable` requires `done`) or saved (the web saves only `done`).
- `repair.py`: when the first repair call fails with `error_kind == "infra"`, skip the identical
  second call and add the warning `"repair_unavailable"` next to the existing `"degraded"`, with a
  WARNING log.
- `api/routes/import_.py` `_run_job`:
  - For a failed result, set `JobState.error` to a plain user sentence for each failure kind
    (older web builds show that sentence).
  - The last-resort `except` writes a fixed sentence and calls `_logger.exception`, instead of
    `str(exc)`.

### A4. Effort ceiling (FGC-1b)
- `normalize.py`:
  - Add `EXTRACTION_EFFORT_CEILING: EffortLevel = "low"` next to `EXTRACTION_EFFORT`, with a
    docstring saying S3 changes it deliberately, in one place.
  - The order is `minimal < low < medium < high < xhigh < max`. `None` means the provider
    default (medium), so it counts as above the ceiling.
  - `normalize()` raises `ValueError` when the effort is above the ceiling, unless
    `allow_effort_above_ceiling=True`.
- `import_pipeline.run_import` passes that flag through (default `False`).
  `scripts/effort_ab.py` (and any other bench script that passes `extraction_effort`) sets it.
- The route never passes an effort or the flag.

### A5. Acquisition metadata on job status (item 1, server half)
- `schema/api.py`: add `AcquiredSource {title, channel | None, description | None}` and
  `ImportJobResponse.acquired: AcquiredSource | None`.
- `routes/import_.py` `_run_job` wraps `acquire_fn`: it records the result's title, channel and
  description, then returns it unchanged. Every later `store.put` keeps the record, the same way
  `preview` is kept. Pasted text is skipped. **`import_pipeline.py` needs no change for this.**
  This also gives Instagram its caption early at no extra cost.
- This describes the yt-dlp description in the report's terms (about 3.0-4.3 s after submit,
  REPORT §Staged table).

### A6. POSTPROCESS bump and types
- `cache.py`: `POSTPROCESS_VERSION = 10`. Append `"10": <hash>` to
  `fixtures/postprocess_versions.json`, never editing an old entry. The history note says the bump
  is code-only (failure classification, effort ceiling) and that no `done` result changes.
- Goldens stay byte-identical: `test_corpus_replay`, `test_schedule` and the replay fixtures pass
  with no regeneration.
- `make types` regenerates `packages/schema`, which picks up `failure` and `acquired`.

## Part B: web (deploy after the API)

### B1. Ingredients-first import view (item 6)
The layout is ported from `RecipePreview.tsx`, never regenerated.
- `import/importView.ts` (pure, Vitest): `importViewFor(...)` returns this model:
  ```
  { header: { title|null, channel|null, thumbnailUrl|null, description|null } | null,
    ingredients: { kind: 'pending' } | { kind: 'lines', lines: string[] },
    method:      { kind: 'pending' } | { kind: 'sections', sections: PreviewSection[] },
    status: ImportStatus }
  ```
  - S2 adds `{ kind: 'items', groups: RenderIngredientGroup[] }` and a `steps` variant, plus a
    "Draft" label. It extends the union; it doesn't replace the view.
  - Precedence:
    - header title: oEmbed, then `acquired`, then `preview`.
    - thumbnail: ytimg, which comes from the video id.
    - lines: `preview` (blog JSON-LD source text).
- `import/ImportDraft.tsx` replaces `RecipePreview.tsx` (both of its call sites are ported):
  - Header: same masthead type and position as `RecipeHeader` (30 px bold), so the hand-off to
    the plan screen doesn't jump. A 16:9 thumbnail and a channel line sit above it.
  - The description is clamped to 4 lines with "More".
  - "Ingredients", then "Method": each is either a quiet one-line placeholder or the
    source lines.
  - The status line stays the existing `STATUS_COPY` / `PreviewFooter`.
- Rules for this view:
  - No durations, timers or start-time advice, and no skeleton shimmer.
  - The draft and the plan share the ingredient row's **visual component**, not its data type.
    - New `plan/IngredientRow.tsx` is presentational. It takes `{ primary: ReactNode,
      trailing?: ReactNode, group?: string }` and owns the hairline, padding, type and the
      right-aligned tabular trailing column.
    - `IngredientsPanel` maps its structured items (name plus formatted qty/unit) onto it.
    - The draft maps raw source strings onto it (whole line as `primary`, no `trailing`, no parsing).
    - R3 (chips) and R4 (servings) restyle one component that both screens render. The draft
      never gains a structured-item type in S1.
- The thumbnail `onError` hides the image. The `naturalWidth === 120` gray placeholder that
  ytimg serves for a bad id is treated as an error.
- Load the `frontend-design` skill before this commit.

### B2. Instant YouTube preview (item 1, client half)
- `import/instantPreview.ts` (pure): `instantPreviewFor(url)` returns
  `{ thumbnailUrl, oembedUrl } | null`. It reuses `youtubeVideoId` and `thumbnailUrlFor` from
  `library/sourceKey.ts`, and the oEmbed URL is built from `watch?v=<id>`.
- `api/oembed.ts`: `fetchOEmbed(oembedUrl, signal)` with a 2.5 s abort. It reads `title` and
  `author_name`, and returns `null` on any failure; an embedding-disabled video gets a 401, and
  `acquired` fills the gap later.
- `useImportJob.ts`:
  - `submit()` sets the instant header synchronously, before the `startImport` network call.
  - oEmbed runs in parallel with `POST /import`, under the existing token.
  - The polling phase carries `instant`, `acquired` and `preview`.
- Timing marks: `performance.mark` at submit, thumbnail `onload`, oEmbed title, first poll with
  `acquired`, and plan. Then one `console.info('[import-timing]', {...})`.

### B3. Same-user duplicate pre-check (item 2)
- `library/sourceKey.ts`: export `canonicalUrlSourceKey(url)`. `canonicalSourceKey` calls it, so
  there is still one definition; the existing vector tests must still pass. It returns null when
  `new URL` fails, so a fallback key never matches.
- `import/duplicate.ts` (pure): `savedMatchFor(url, findBySource)`. URL submits only; pasted text
  is out of scope.
- `useImportJob(onImported, { initialUrl, findSaved, onDuplicate, skipDuplicateCheck })`
  - `submit()` order is fixed: **(1) duplicate check → (2) instant header → (3) `startImport`**
    (today's `useImportJob.ts:128`).
  - On a match it calls `onDuplicate(saved)` and returns before any `setPhase`. The phase stays
    `entry`, so a duplicate never flashes the draft screen, and nothing is fetched (no oEmbed, no
    `POST /import`).
  - The order lives in a pure `submitPlan(url, { findSaved, skipDuplicateCheck })`, which returns
    `{ kind: 'duplicate', saved } | { kind: 'import', instant }`. The hook only executes it, which
    keeps the order testable without jsdom.
- `App.tsx` / `AppShell.tsx`:
  - `onDuplicate` calls `openSaved(id, { alreadySaved: true })`. That is the existing open path,
    so the staleness check, free reprocess and stale marker all apply unchanged.
  - `alreadySaved` is set **only** on this duplicate path. Opening from the Cookbook, the feed or a
    conflict "Go to" never passes it.
  - `View.import` gains `skipDuplicateCheck`, which both the stale **Re-import** action and the
    new **Import again** action set. Without it, Re-import would loop back to the saved copy.
  - As today, the field is prefilled and the user taps "Get the plan". No spend starts on mount.
- **Import again replaces the saved entry; it never adds a second one.**
  - It uses exactly the path the stale-marker Re-import uses today:
    `setView({ kind: 'import', initialUrl: <saved source value>, skipDuplicateCheck: true })`.
  - Then `onImported` → `library.save`, which already de-duplicates by `canonicalSourceKey` and
    keeps `existing.id` (`store.ts` `build`/`replaceIn`). The result is `replaced: true` with the
    same id, and the existing `endSessionIfFor` rule applies.
  - No new save path.
- `plan/RecipeHeader.tsx`: a quiet line, "Already in your Cookbook · Import again". It is hidden
  when the stale marker already offers Re-import, so one action never shows twice.
- The server's `fresh` flag stays as it is (the cache is off in production).

### B4. Failure copy (items 3, 4)
- `useImportJob.ts`: a `failed` job with `result.failure` gets the phase
  `{ kind: 'failed', failure, url }`. Copy below is a draft and gets fixed at the render checkpoint.
- `unavailable`: "We couldn't reach our recipe reader. Try again in a minute."
  - Primary button: **Try again** resubmits the same URL. It keeps `skipDuplicateCheck`, and a
    retry is fine because nothing was saved.
- `incomplete`: "We couldn't finish reading this recipe."
  - Primary: **Paste the recipe text**. Secondary: **Try another link**.
  - There is no "try again": the same input would most likely fail the same way.
- Neither kind uses `NotGroundedResult` or `notGroundedCopy`. A `failed` job with no `failure`
  keeps today's error path.

## Tests (written before the code in each commit; `pytest -m "not llm and not network"`, Vitest)

API:
- `test_model_facing_bytes.py`: the A1 hashes, recorded first.
- `test_extract_adapters.py`, timeout rule:
  - `APITimeoutError` (OpenAI) or Anthropic's timeout on the **escalation** call →
    `error_kind="infra"` → `failure="unavailable"`.
  - Margin guard: `request_timeout_s(ESCALATED_MAX_TOKENS) >= 2 * (ESCALATED_MAX_TOKENS * 8.3 / 1000 + 8)`,
    and the same check for `MAX_TOKENS`. The test docstring points at the A2 rule.
- `test_extract_adapters.py`, using fake SDK clients:
  - each infra class → `error_kind="infra"`; a 400 → `"request"`.
  - the `error` string has no exception message and no key; seed a fake key such as
    `sk-test-SECRET` and check it is absent.
  - an unparseable response keeps `raw_text`.
- `test_extract_normalize.py`:
  - chole-shaped empty truncation (`reasoning_tokens == output_tokens`, `raw_text ""`) gives
    `failure="incomplete"`, makes **1 call** (no escalation) and never says "runaway".
  - a real repeat-loop truncation is still runaway (regression test).
  - infra on the first call, on the retry and on the escalation each give `unavailable`, with no
    further calls.
  - an unparseable response logs at WARNING with the head and tail of the text, `stop_reason`,
    `output_tokens`, `reasoning_tokens` and the reason, and without the key (`caplog`).
  - an effort above the ceiling raises; `None` raises; the bench flag allows it.
  - `minimal` and `low` pass.
- `test_extract_repair.py`: infra on repair → 1 call (not 2), warnings include `"degraded"` and
  `"repair_unavailable"`.
- `test_api_import.py`:
  - a 401 fake adapter → job `failed`, `result.failure == "unavailable"`, a user sentence in
    `error`, not stored in the cache.
  - an empty truncation → `incomplete`.
  - `acquired` is set from the first poll after acquire, kept on later statuses, and absent for
    pasted text.
  - the last-resort exception gives the fixed sentence.
  - **Route ceiling test:** a recording fake adapter goes through `POST /import` for the clean,
    unparseable-retry, escalation and repair paths. Every extraction call's `effort` is at or
    below `EXTRACTION_EFFORT_CEILING`, and the request body can't set an effort (unknown fields
    are ignored, never forwarded).
- `test_postprocess_version.py` (version 10 entry), `test_corpus_replay.py`, `test_schedule.py`:
  unchanged expected files.

Web (Vitest, pure modules only, no jsdom):
- `instantPreview.test.ts`: watch, shorts, youtu.be and embed URLs; a non-YouTube URL → null;
  the oEmbed URL is encoded.
- `oembed.test.ts`: response parsing; 401/400/abort → null (fake fetch).
- `importView.test.ts`: header precedence; `pending` vs `lines`; no duration fields exist on
  the model.
- `duplicate.test.ts`, `sourceKey.vectors.test.ts`: a saved YouTube entry matches the watch,
  shorts, youtu.be and `si=` share-link forms of the same id; a blog URL with `utm_` matches; an
  unparseable URL never matches.
- `duplicate.test.ts`, submit order:
  - `submitPlan` on a saved URL returns `duplicate` with **no `instant` header**.
  - A fake `startImport` and a fake `fetchOEmbed` both see 0 calls.
  - The recorded phase sequence is `[]`: no `polling` phase, so no draft flash.
  - `skipDuplicateCheck: true` on the same URL returns `import`, with the instant header.
- `importAgain.test.ts` (with `createLibrary` on in-memory `StorageLike`):
  1. Save a payload for a YouTube URL.
  2. Run the Import-again path: `submitPlan` with `skipDuplicateCheck`, then `library.save` of a
     fresh payload for the same source. Run it once with the prefilled value, and once with a
     youtu.be form of the same id.
  3. Expect: Cookbook count unchanged (1), same `id`, `replaced: true`, `updated_at` advanced.
- `importPhase.test.ts`: the decision is extracted from `useImportJob`'s `poll` handler into a
  pure `phaseFor(job)`.
  - `failed` + `unavailable` / `incomplete` → `failed` phase.
  - `method_not_grounded` is unchanged.
  - `failed` with no failure → today's error path.
- `staleness` / `PlanScreen` notice test: `importMeta` with warnings `["degraded",
  "repair_unavailable"]` → "Plan simplified" line (owner ask: confirm the existing notice fires).

Before each commit: a mojibake grep over the diff (`Ã|â€|Â`) and `git diff --check`. Non-ASCII
content is written with Write/Edit only.

## Commits (small; conventional)
1. `docs(plans): PR-S1 plan + ingredients-first decisions`. Made in the **setup session** (see
   Setup); the implementation session starts at commit 2.
2. `test(extract): pin model-facing prompt and schema bytes`
3. `fix(extract): classify provider errors and keep unparseable text (FGC-2, FGC-13)`: adapters, prompting
4. `fix(extract): truthful failed results and effort ceiling (FGC-1, FGC-2)`: normalize, repair, schema, route error text, PPV 10, types
5. `feat(api): expose acquisition metadata on import status`: route and `schema/api.py`, types

   **STOP 1:** API tests green, a clean-worktree run, and a report.
6. `feat(web): ingredients-first import view with instant YouTube header`

   **STOP 2:** render at 390 × 844 on the phone and send screenshots. The states come from
   fixture/mock job responses (a dev-only fixture route or a mocked `pollImport`, ₹0, no real
   imports and no LLM). States:
   - instant header only
   - header + description
   - blog preview lines
   - unavailable
   - incomplete

   Then walk `DESIGN_SYSTEM.md` row by row against them, before the other web commits. Check
   Dark Reader before trusting any localhost capture.
7. `feat(web): open the saved recipe instead of re-importing`
8. `feat(web): truthful failure screens`

   **STOP 3** before push and PR. Deploy the API (Cloud Run) before the web (Vercel).

## Measuring on a real phone (adb + CDP, per the phone-testing memory)
- Setup: API with `--env-file`, Vite on 5174, Chrome on the phone driven through CDP. Read
  `[import-timing]` from `Runtime.consoleAPICalled` and the requests from `Network`.
- **Preview timing (₹0 for the header part):** submit the 6 corpus YouTube links plus one
  `/shorts/` link, cold, on Wi-Fi and on mobile data. Record submit → thumbnail painted, submit →
  title, and submit → description (`acquired`). Report the median and max for each.
  - Targets: thumbnail and title within about 1 s at the median, at most 3 s worst case.
  - The description should land at about 3-4.3 s (the report's yt-dlp number).
- **Submit → plan:** needs real imports. Ask before spending: proposed at most 3 imports, about
  ₹2-3 in total. The expected time doesn't change (about 33-37 s); this only confirms there's no
  regression.
- **Duplicate:** with recipes saved, paste the same video as watch, shorts and share links.
  Expect the plan in under 300 ms, **zero `POST /import`** in Network, and the stale marker's
  Re-import still starting one import. ₹0.
- **Failures (₹0):**
  - Run the local API with a bad `OPENAI_API_KEY`. Expect the "try again" screen, the Cookbook
    count unchanged, and no cache entry.
  - With a bad `ANTHROPIC_API_KEY` plus a recipe whose repair fires (offline fake, or a cached
    raw), expect "Plan simplified" and `repair_unavailable` in the server log.
  - `incomplete` is checked offline only (the chole raw fixture shape).

## Risks
- **The bump to 10 makes every saved recipe reprocess once** (free, no LLM). Older entries
  without an original show the stale marker. Owner accepted.
- **oEmbed blocked** by an ad-blocker or a privacy browser: the thumbnail still shows (it comes
  from ytimg) and `acquired` fills the title later. The client now tells YouTube about the link.
  That's acceptable: the user pasted a YouTube link.
- **Header text switches** between oEmbed and `acquired`: both are YouTube's raw title, so they
  should match. When oEmbed has already set the title, the client never replaces it.
- **A duplicate match on a degraded or old saved entry** opens that entry. The user has Import
  again or Re-import, so they're never stuck.
- **An older web build during the deploy window** sees `failed` with a server sentence. That's
  acceptable, and better than polling until the ~5-minute timeout.
- **`ImportTelemetry.tier` is labelled `tier0`** for failure results in benches. The bench reader
  should key on `result.failure`. Noted, not changed.
- **A stalled escalation can run about 1,400 s before `unavailable`.** That is 700 s, retried once
  by the SDK. The web's `slow` prompt fires at about 5 min, so the user is asked to keep waiting
  long before then. Noted, not changed in S1. Any change to timeouts or retries is a separate
  decision.
- **The effort ceiling can break bench scripts** that pass `None`/`medium` without the flag. They
  fail loudly with a `ValueError`; the scripts are updated in commit 4.

## Out of scope
- S2: streaming the extraction call, draft ingredients and steps, the "Draft" label, and the
  one-page vs two-page decision.
- S3: strict JSON output, FGC-11 (croissant 55 vs "1 hour"), FGC-12 (minimal vs low, n=3), and
  the FGC-13 *fix* (S1 only captures the text).
- Cross-user persistent cache (after M5). Output-size reduction (lever 4).
- Instagram and blog thumbnails (cheap follow-up: add yt-dlp `thumbnail` to `RawAcquisition`).
- Duplicate check for pasted text.
- Parallel acquisition (lever 9).
- Any change to the prompt, the schema field docstrings, the model, the effort value or the token
  budgets.
