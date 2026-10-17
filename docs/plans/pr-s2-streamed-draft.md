# PR-S2: streamed draft, ingredients first, then steps (S2a server + S2b web)

Status: plan written 2026-10-17 (Opus, plan mode). Read from `origin/main` @ 1b47c70 (PR #63, S1.5,
merged). This checkout stays on `docs/sabudana-investigation-library`. One plan doc covers both PRs.
S2a is implemented first. S2b starts in its own worktree from origin/main **after S2a merges**, and
needs no new plan-mode session unless S2a changed the draft shape (§3.3).

## Amendments (owner, 2026-10-17)

These are folded into the sections they touch.

- **A1. Streaming kill switch.** The env var `ABC_COOK_STREAM_EXTRACTION` defaults to on.
  - Off: the OpenAI adapter sends today's non-streaming request (no `stream`, no `stream_options`,
    no watchdog), and `streams_text` is False.
  - So no draft is produced, and the web behaves like S1.
  - See §3.1.1, §3.1.3, §4 and §5.
- **A2. R4 changed.** A failed job keeps its draft.
  - The S1 failure message and "Try again" sit at the top, with the draft below them under its
    "Draft" label.
  - With no draft, the S1 failure layout is unchanged.
  - See R4, §3.2, the S2b tests, and screenshots 8–9 in §6.
- **A3. The live check at S2a HARD STOP A is pre-approved:** `stream_live_check.py`, 2 calls on
  the frozen kadhi-pakora and croissant raw transcripts.
  - Cap ₹5, stop at the first failure.
  - No acquisition, no YouTube, no repair.
  - Still STOP at HARD STOP A after it, and report the spend.
- **A4. Poll payload.** `GET /import/{id}` is not gzip-compressed on origin/main (`api/main.py`
  has no `GZipMiddleware`).
  - S2a adds `GZipMiddleware(minimum_size=1000)`, with a test.
  - HARD STOP A reports the compressed draft-bearing poll size for kadhi and chole-low.

## Context

Today a no-blog YouTube import shows the header (S1, ~0.5 s) and the description (S1.5, ~3–4 s),
then nothing until the whole validated plan arrives (~33–37 s). The owner decided on 2026-10-16
(`docs/plans/decisions-2026-10-16-ingredients-first.md`, on main) that the order is: ingredients
(~11–13 s), then steps one by one (~18 s onwards), then the plan, with timings, from the same single
extraction call, streamed. The draft is labelled and carries no durations, timers or start-time
advice.

Measured (REPORT T6, kadhi, n=1, `low`): first visible token 7.7 s into the call, `ingredients` key
8.1 s, first step complete 15.2 s, full output 25.8 s, ~121 tok/s.

## 1. Preconditions (Step 0): all pass

- `git fetch --prune` done. origin/main = 1b47c70 "Merge pull request #63 … feat/pr-s1-5-acquisition-budget".
- On origin/main: `SourceMetadata` + `MetadataCallback` (`extract/acquire/__init__.py:22`),
  `on_metadata` through `pipeline.acquire` → `youtube.fetch`, the `probe:` INFO line
  (`acquire/pipeline.py:171`), and the `import cost:` INFO line (`api/routes/import_.py:176`).
- `git worktree list`: no `abc-cook-s1-5`. `git branch --list feat/pr-s1-5-acquisition-budget`: empty.
- `docs/plans/decisions-2026-10-16-ingredients-first.md` is on main, so it doesn't need saving.
  Highest follow-up on main is FGC-18.

## 2. Owner decisions (2026-10-17) and the remaining recommendations

Decided by the owner in this session:

| # | Question | Decision |
|---|---|---|
| D1 | One page vs two | **A reading screen, then a tap.** The draft fills the import (reading) screen. When the validated plan arrives, a **sticky bottom button** "Your plan is ready" appears and can't be missed at 360×697. The draft stays readable, unchanged, until the tap, and the tap opens the recipe page. **No draft→final morphing list.** |
| D2 | Ground | **Every import-progress screen moves to the Home ground.** The Copy sheet, the reading screen and the recipe page are then all Home, so nothing flips at hand-off. Checkpoint screenshots must include the error/stall and retry states on the Home ground, with no Plan-paper leftovers. |
| D3 | Layout at 360×697 | **Ingredients go above the description.** Order: thumbnail, channel, title, Ingredients, Steps, then "About this video" (description, 2-line clamp + More). Before ingredients arrive, the Ingredients and Steps placeholders stay compact (2–3 static skeleton rows at most), so "About this video" shows on the first screen during the ~4–12 s wait. Ingredients arriving push it down, which is fine. The checkpoint includes a screenshot of the ~6 s state. |
| D4 | PR split | **S2a server, then S2b web.** S2a ships the replaying fake provider and a ₹0 harness that runs the real FastAPI app with a stand-in acquire, so S2b uses the same harness. S2a's HARD STOP A measures time-to-ingredients and time-to-first-step from the poll, with no web. |
| D5 | Ingredients component | The draft list uses **the same component the recipe page uses**, so R3/R4 reuse it and the hand-off looks continuous. |

Recommended here. These are the defaults; the owner can override them at plan review:

| # | Question | Recommendation | Why |
|---|---|---|---|
| R1 | Title at hand-off | The reading screen keeps the **raw source title** (oEmbed, then `acquired`) the whole time. The recipe page shows the plan title (`graph.title`) after the tap. | The hand-off is a page change (D1), so nothing switches in place. The reading screen is "what the source said" (thumbnail, channel, raw title, description), and the recipe page is ABC Cook's plan. No early `resolve_title` call and no header text change mid-read. |
| R2 | Stall timeouts | Watchdog **idle 60 s** (no stream chunk). The **per-call total deadline stays `request_timeout_s(max_tokens)`** (380 s at 16K, 700 s at 32K), now enforced on the wall clock. **`MAX_RETRIES = 1` is unchanged.** httpx `Timeout(connect=10, read=75, write=30, pool=10)` is a backstop. | See §3.1.4. The worst case for a stall goes from ~1,400 s to about 150 s before the stream starts, or the time streamed plus 60 s. |
| R3 | Draft on the identical retry or the escalation | **Fill, never replace.** Each section (ingredients; steps) comes from the first call that produced it. A later call only fills a section that is still empty, so the draft on screen never shrinks or rewrites. `import cost:` counts every call, as today. | Owner: no morphing list. A retry produces new wording, and swapping it in would rewrite rows under the cook's eyes. The validated plan is one tap away. |
| R4 | Draft on a failed job | **Amended (A2): keep the draft.** The S1 failure message and its actions ("Try again", or "Paste the recipe text" / "Try another link") sit at the top. The draft sits below them under its "Draft" label. With no draft, the S1 failure layout is unchanged. Home ground either way. | Owner decision. What was read is still worth reading, the same way a failed job already keeps `preview`. The label keeps it honest. |
| R5 | Transport | **The existing 1.2 s poll**, with a `draft` field on the job, like `acquired`. No SSE. | Polling adds ≤ 1.2 s (mean 0.6 s) to each milestone. The ingredients target (≤ 15 s) has ~2–3 s of slack for a typical acquire. SSE would save ~0.6 s and add a streaming connection on Cloud Run. |
| R6 | Blog preview present (YouTube + blog, pasted recipe page) | **The server always drafts. The web picks per section:** the preview's lines when that section is non-empty, otherwise the draft. | The source's own text beats the LLM's draft. Choosing per section still fills a section the blog page left empty. |

## 3. Design

### 3.1 S2a server

#### 3.1.1 Streaming in the OpenAI adapter (`extract/adapters/openai.py`)
- `extract(..., on_text: TextDeltaCallback | None = None)` **always streams**: `stream=True`,
  `stream_options={"include_usage": True}`. Everything else is byte-identical: `model`, `messages`
  (the same `system_prompt(prompt, output_type)` + `source_text`), `max_completion_tokens` and
  `reasoning_effort`. Bench scripts therefore use the same path.
- Deltas are accumulated in a list and joined into `text`. After that, the existing logic runs
  unchanged: `finish_reason == "length"` → truncated + `raw_text`; `parse(text)`; unparseable →
  `raw_text`.
- `finish_reason` comes from the last choice chunk that carries one. Usage comes from the final chunk
  (`choices == []`): cached tokens are subtracted as today, and so are `reasoning_tokens`. If no usage
  chunk arrives, `usage=None` with a WARNING. Usage is never estimated, which is the `CallUsage` rule.
  CallUsage gains an optional `first_content_ms: float | None = None`, for measurement only.
- `on_text(delta)` is called for each non-empty content delta. **If it raises, the adapter logs once
  at WARNING, stops calling it and keeps streaming.** A draft can never fail an import.
- Errors:
  - `openai.APIError` from `create` → the existing `_error_kind`.
  - Mid-stream `httpx.TransportError`/`TimeoutException`, or an `APIError` raised while iterating →
    `infra`.
  - Watchdog close → `infra`, with `error="StreamIdleTimeout"` or `"StreamDeadline"` (class-style
    names, no message, per `exception_summary`).
  - A mid-stream failure carries no usage (FGC-19).
- `streams_text` (a property) marks the adapter as able to take `on_text`. It is True only when
  streaming is on.
- **Kill switch (A1).**
  - `ABC_COOK_STREAM_EXTRACTION` is read once, at adapter construction. Off means `0`, `false` or
    `off`, case-insensitive; anything else, or unset, means on.
  - Off: `extract` sends exactly today's request: `create(model, messages, max_completion_tokens,
    reasoning_effort, timeout=request_timeout_s(max_tokens))`, with no `stream`, no
    `stream_options` and no watchdog.
  - Off: `streams_text` is False and `on_text` is ignored. `DraftingAdapter` then takes its plain
    path, so no draft is produced, and the web behaves like S1.
  - The non-streaming code is kept as it is today, not reimplemented.
  - Documented in `.env.example`.

#### 3.1.2 Watchdog (in `openai.py`, or a small private helper in `adapters/base.py`)
- Once `create(...)` returns the stream, one daemon thread per call wakes every 1 s.
  - If `now - last_chunk_at > idle_s` or `now > deadline`, it records the reason and calls
    `stream.close()`. The iterating thread then raises, and the adapter maps the recorded reason to
    `infra`.
  - The thread is joined/stopped in `finally`.
- `idle_s` and `deadline_s` are constructor overrides for tests. Defaults: `STREAM_IDLE_TIMEOUT_S` and
  `request_timeout_s(max_tokens)`.
- A chunk is any SSE event the SDK yields. The watchdog measures what we care about even if OpenAI
  sends SSE keep-alive comments, which the SDK filters, so httpx would never see a read timeout.

#### 3.1.3 Constants (`adapters/base.py`)
- `STREAM_IDLE_TIMEOUT_S = 60.0`. Its docstring holds the sizing below. `request_timeout_s` and
  `MAX_RETRIES` are unchanged.
- `TextDeltaCallback = Callable[[str], None]`.
- `STREAM_EXTRACTION_ENV = "ABC_COOK_STREAM_EXTRACTION"` and `stream_extraction_enabled() -> bool`
  (default True; A1).

#### 3.1.4 Sizing, from more than one measurement
- **Idle.**
  - The longest healthy silence is the reasoning wait before the first visible token. Measured at
    `low`:
    - kadhi 7.7 s with 960 reasoning tokens (T6);
    - reasoning across the T2 `low` calls ranges from 192 to 1,984 tokens (pizza's retry), which is
      ~1.6–16.4 s at 121 tok/s.
  - After the first token, chunks arrive about every 10 ms.
  - 60 s is 3.6× the worst estimate, and covers a provider 2–3× slower than measured.
  - A guard test pins `STREAM_IDLE_TIMEOUT_S >= 3 * 16.4`.
- **Total deadline.**
  - Healthy single calls at `low`/`minimal` take 13.8–38.2 s (T2, n=13 single-call rows).
  - A legitimate 16K output at the cap takes ~133 s + ~16 s to the first token. At half speed that is
    ~300 s, which is under 380 s.
  - The 32K escalation keeps S1's margin guard (`request_timeout_s(32K) >= 2 × (32K × 8.3/1000 + 8)`).
  - A slow-drip stream that is still producing keeps drafting visibly. The web's `slow` prompt fires
    at ~5 min.
- **`MAX_RETRIES = 1`.**
  - With streaming, the SDK retries only failures that happen before the response starts (connect,
    429, 5xx, a timeout before headers). It never retries a stall mid-stream, so the retry no longer
    doubles a stall.
  - Worst case before streaming starts: ≤ 2 × (10 s connect or 75 s read) ≈ 150 s. Worst case once
    streaming: the time streamed + 60 s. Today it is ~1,400 s (700 s × 2).
- Known side effect, accepted and logged as FGC-23: at `low` a reasoning silence over 60 s has never
  been seen. If one happened it would end as `unavailable`, not `incomplete`.

#### 3.1.5 Partial parser (`extract/draft.py`, new; not covered by the PPV guard)
- `DraftScanner`: an incremental character-level JSON scanner. `feed(delta) -> bool` returns
  "a milestone changed". Total work is O(n) over the response. It never parses the whole buffer
  more than once.
- It tracks string/escape state, a container stack and the current top-level key. A leading
  ```` ```json ```` fence is skipped.
- Milestones:
  - **ingredients:** when the top-level `ingredients` array closes:
    - `json.loads` the slice;
    - `NormalizedIngredient.model_validate` each item, skipping invalid items;
    - `[]` means complete and empty;
    - a missing or unclosed array means `None`.
  - **steps:** inside the top-level `steps` array, each element object's `"text"` string, once its
    closing quote arrives:
    - decoded with `json.loads('"' + raw + '"')`, which handles `\uXXXX` and surrogate pairs;
    - a step with no `text` is skipped;
    - `steps_complete` is set when the array closes.
- Nothing else is read, so no durations, attention, offsets, servings or totals can reach the draft.
  Duplicate top-level keys: the first wins.
- Any structural impossibility sets `broken=True`. The scanner stops advancing but keeps every
  milestone already reached. `feed` never raises, and the caller wraps it anyway.
- Caps, to keep the payload bounded: 80 ingredients, 80 steps, 1,000 characters per step text (clipped).

#### 3.1.6 Draft schema (`schema/api.py`, contract)
```python
class DraftStep(BaseModel):
    text: str  # the model's step text, as streamed; never a duration field

class StreamedDraft(BaseModel):
    """Unvalidated, streamed from the extraction call; labelled a draft on screen. No durations,
    timers, offsets, totals or servings, by construction."""
    ingredients: list[NormalizedIngredient] | None  # None until the array is complete
    steps: list[DraftStep] = []                      # each once its `text` has closed
    steps_complete: bool = False
    calls: int = 1                                   # extraction calls started so far (retry/escalation visible)

ImportJobResponse.draft: StreamedDraft | None  # kept on every later status, like `preview`
```
- `NormalizedIngredient` is reused, not mirrored. It is already in the generated types.
- The model-facing schemas are untouched: `NormalizedRecipe` doesn't embed these, and the pinned
  hashes in `test_model_facing_bytes.py` prove it.
- `make types` regenerates `packages/schema`.
- Deploy order, as a fact for M5 rather than a step: deploy the API before the web. In either order
  nothing breaks: an old web ignores `draft`, and a new web without `draft` behaves like S1.

#### 3.1.7 Drafting wrapper (`extract/adapters/drafting.py`, new)
- `DraftingAdapter(inner, on_draft: Callable[[StreamedDraft], None])` implements `LLMAdapter`.
- On an `extract` call with `output_type is NormalizedRecipe` and `getattr(inner, "streams_text", False)`:
  1. It starts a fresh `DraftScanner` and increments `calls`.
  2. It passes `on_text`.
  3. It merges milestones into the job's draft with **fill-never-replace (R3)**.
  4. It calls `on_draft` on each change.
- Anything else (repair's `RepairProposal`, or a fake without `streams_text`) passes through untouched.
- Exceptions from the scanner or from `on_draft` are swallowed, with one WARNING per call.
- One INFO line per extraction call:
  `draft: graph_id=… call=… first_content_s=… ingredients_s=… first_step_s=… steps=… complete=… broken=…`.
- `RoutingAdapter.extract` gains `on_text=None` and forwards it only when it is set and the target
  has `streams_text`. `RoutingAdapter.streams_text` is True.

#### 3.1.8 Route (`api/routes/import_.py`)
- `_run_job` wraps `adapter` in `DraftingAdapter(adapter, on_draft)`.
- Draft writes:
  - `on_draft` sets a nonlocal `draft` and writes `JobState(status=<current status>, preview, acquired, draft)`;
  - `on_status` and every terminal write carry `draft` too;
  - `JobState` gains `draft`, and `get_import` returns it.
- **`normalize.py` and `import_pipeline.py` are not touched** (no PPV bump), and nor is any other
  guarded module.
- Store writes: ≤ ~2 + steps (≤ 80) per job, all from the job thread.

#### 3.1.8a Poll compression (A4, `api/main.py`)
- `GZipMiddleware(minimum_size=1000)` is added in `create_app()`.
- It compresses every JSON response over ~1 KB when the client sends `Accept-Encoding: gzip`, as
  browsers do. The poll is the reason; plan responses benefit too.
- No contract change.

#### 3.1.9 No-draft paths: confirmed
- Library pre-check hit: web only, no job. Unaffected.
- Result-cache hit: `run_import` returns before acquire, so no extraction runs and `draft` stays `None`.
- `POST /recipes/reprocess`: no LLM call. Unaffected.
- A pasted recipe page (A1) and YouTube with a blog: `preview` is set as today, the draft also
  streams, and the web chooses per section (R6).
- Pasted text: no `acquired` and no header. The draft streams. In S2b the reading screen shows
  Ingredients/Steps with no header (today it shows only a centred status word).

#### 3.1.10 ₹0 harness (`abc_cook/devtools/replay.py`, new, never imported by `abc_cook.api`)
- `ReplayStreamingAdapter(script)`, with `streams_text = True`.
  - For each `NormalizedRecipe` call it replays text in ~8-character chunks:
    - a pre-content delay of `reasoning_tokens / 121` s when known, else 7.7 s (T6);
    - then characters at a rate calibrated so kadhi's replay matches T6 (visible 25.8 − 7.7 = 18.1 s);
    - `speed` is a multiplier for tests.
  - Each call is scripted as `ok | invalid_json | truncated | stall_after(n_chars) | infra`.
  - For `RepairProposal` it returns the fixture's stored `original.repair` after a stated delay, or
    an error when there is none.
  - It returns realistic `CallUsage`.
- Replay text: `ImportOriginal.recipe.model_dump_json()`. That is compact JSON in schema order,
  the format the prompt asks for.
  - Sources: `kadhi-pakora`, `croissant` and `pumpkin-pancakes` `.original.json`, and
    `known-wrong/vanilla-cupcakes.original.json`.
  - A long Hindi-source case: copy
    `notes/investigate-extraction-speed/raw/chole-bhature__low__0.normalized.json` (on main) into
    `tests/fixtures/stream/chole-bhature.low.normalized.json`, provided it validates as `NormalizedRecipe`.
- `fixture_acquire(raw, metadata_at_s=3.5, done_at_s=6.0)`: sleeps, calls `on_metadata`, sleeps,
  returns the frozen `RawAcquisition`. The defaults come from S1.5 (`acquired` at 3.2–4.5 s, kadhi
  acquire ~6 s). No yt-dlp, no captions, no network.
- `create_replay_app(fixture, script, ...)`: `create_app()` with `dependency_overrides` for
  `get_acquire`, `get_adapter` and `get_result_cache → None`.
- `apps/api/scripts/replay_server.py --fixture kadhi-pakora --script ok --port 8765`: runs uvicorn.
  It sets `CORS_ORIGINS` to include the Vite port S2b uses. It reads no key.
- `apps/api/scripts/stream_draft_bench.py`:
  - starts the replay app in a uvicorn thread (TestClient runs background tasks synchronously, so
    it can't poll);
  - POSTs, then polls at 1.2 s like the web;
  - records the first poll that shows `acquired`, ingredients, the first step, `steps_complete` and
    `done`;
  - n=3 per fixture × 5 fixtures, plus the retry and stall scripts;
  - writes `notes/pr-s2-streamed-draft/replay.json` and a table.

### 3.2 S2b web (Home register; load the `frontend-design` skill first)

- **Ground.** Every branch of `ImportProgress` moves to Home tokens:
  - `ImportDraft`, `Centered`, `FailureBody`, `NoRecipeResult`, `PasteScreen`, `NotGroundedResult`;
  - `ImportProgress` and `AppShell` set `useHomeSurface(true)` while a progress phase shows;
  - the entry form in `ImportScreen` (opened from the Cookbook) keeps its own register;
  - primary buttons use the Home primary (terracotta pill, sentence case, `DESIGN_SYSTEM.md:1443`),
    not `signal`;
  - a grep check that no `bg-paper`, `text-ink`, `border-rule` or `bg-signal` is left in the
    progress branches.
- **Shared ingredients component (D5).**
  - New `plan/IngredientList.tsx` (presentational, grouped). Props:
    `{ groups: { key, heading: string | null, items: { key, primary: ReactNode, trailing?: ReactNode }[] }[] }`,
    built on `IngredientRow`.
  - `IngredientsPanel` becomes a mapping onto it, with no visual change: before/after screenshots
    of the recipe page's Ingredients tab must be identical.
  - The draft maps `NormalizedIngredient` with a pure `draftIngredientGroups(ingredients)` in
    `import/draftView.ts`, moved from `ImportScreen.groupIngredients`:
    - `primary = name`;
    - `trailing = [qty, unit]` joined, verbatim (no `formatQty`, no parsing).
  - `NotGroundedResult` uses it too.
  - R3/R4 restyle `IngredientList`/`IngredientRow` once, and both screens change.
- **View model** (`import/importView.ts`, pure). It extends the union, never replaces it:
  - the view model is also built for `failed` and `error` phases from that phase's last `draft`
    (A2). `Phase.failed` / `Phase.error` gain `draft: StreamedDraft | null`, carried over from the
    last poll;
  - `ingredients: … | { kind: 'items', groups, draft: boolean }`;
  - `method: … | { kind: 'steps', steps: string[], complete: boolean, draft: boolean }`;
  - section precedence: preview lines if non-empty, else draft, else `pending` (R6);
  - `footerFor(view, status, ready)` gives a truthful line, keyed only on server state:
    - no ingredients yet: "Reading the ingredients…";
    - ingredients, steps open: "Reading the steps…";
    - otherwise: "Building your cooking plan…";
    - the blog case keeps `PreviewFooter`.
- **Layout (D3).**
  - Order: header (thumbnail, channel, title) → Ingredients → Steps → "About this video"
    (2-line clamp + More).
  - `Pending` becomes 2–3 static skeleton rows (`--color-home-skeleton-*`), with **no shimmer**.
  - A small "Draft" label beside the Ingredients and Steps headings, only while the content is
    the draft. Its copy is fixed at W1.
  - The draft list is append-only, so nothing reorders while streaming (R3).
- **Ready and hand-off (D1).**
  - `Phase` gains `{ kind: 'ready', instant, acquired, preview, draft, finished }`. It keeps the last
    view inputs, so the draft stays readable.
  - A pure `handOffFor(shownReadable)`:
    - `'tap'` when the reading screen showed preview lines or draft ingredients/steps;
    - otherwise `'auto'`, as today. Examples: a cache hit, or a done job with nothing streamed.
  - **Save at done, open at tap.**
    - `App.onImported` splits into `saveImported(payload, importMeta, extras) → SaveState` (library
      save, server-version note, session end) and `openImported(plan, …, saveState)` (`setView`).
    - The hook calls save on `done` and open on the tap (or immediately on `'auto'`).
    - A finished import lands in the Cookbook straight away, as today, even if the cook leaves before
      tapping.
  - The sticky footer becomes a full-width primary button "Your plan is ready":
    - ≥ 48 px tall, `role="status"` / `aria-live="polite"`;
    - pinned at the bottom at 360×697;
    - it carries no timing numbers.
  - The top control reads "Close" once the job is ready, because the recipe is already saved.
- **Failed with a draft (A2).**
  - `ImportDraft` renders, top to bottom: the header, the `failure` slot (the S1 `FailureBody`:
    message plus "Try again" or "Paste the recipe text" / "Try another link"), then the draft
    Ingredients and Steps under their "Draft" label, then "About this video".
  - Sections the draft never filled are dropped (`none`), not shown as skeletons.
  - With no draft, the S1 failure layout is unchanged, on the Home ground.
  - The same applies to `error` with a preview or a draft.
- **Timing marks.** `ingredients`, `firstStep`, `ready` and `open` are added to `importTiming` and
  `[import-timing]`.

### 3.3 What S2b relies on from S2a (frozen once S2a merges)
- `ImportJobResponse.draft: StreamedDraft | None`, with `ingredients | None`, `steps[].text`,
  `steps_complete` and `calls`.
- The harness command line.

If S2a changes any of these, S2b goes back to plan mode first.

## 4. Files touched

**S2a**
- `extract/adapters/base.py`: `STREAM_IDLE_TIMEOUT_S`, `TextDeltaCallback`, `CallUsage.first_content_ms`.
- `extract/adapters/openai.py`: streaming, watchdog, mid-stream error mapping.
- `extract/adapters/routing.py`: forwards `on_text`.
- `extract/adapters/drafting.py` (new): wrapper, fill-never-replace, draft log line.
- `extract/draft.py` (new): `DraftScanner`.
- `schema/api.py`: `DraftStep`, `StreamedDraft`, `ImportJobResponse.draft`.
- `api/routes/import_.py`: wraps the adapter; `JobState.draft`.
- `api/main.py`: `GZipMiddleware` (A4).
- `apps/api/.env.example`: documents `ABC_COOK_STREAM_EXTRACTION` (A1).
- `devtools/__init__.py`, `devtools/replay.py` (new): the harness.
- `scripts/replay_server.py`, `scripts/stream_draft_bench.py` (new).
- `packages/schema/*`: generated.
- Tests (§5). `tests/fixtures/stream/chole-bhature.low.normalized.json`.
- `docs/plans/pr-s2-streamed-draft.md`: results tables.
- `notes/pr-s2-streamed-draft/replay.json`: force-added.

**Not touched:** `normalize.py`, `import_pipeline.py`, `graph.py`, `repair.py`, `postprocess.py`,
`schedule/`, `cache.py` (PPV stays 10), prompts, `schema/normalized.py`, `anthropic.py`.

**S2b**
- `import/importView.ts`, `import/draftView.ts` (new), `import/phase.ts`, `import/useImportJob.ts`,
  `import/ImportDraft.tsx`, `import/ImportScreen.tsx`, `import/importTiming.ts`.
- `plan/IngredientList.tsx` (new), `plan/IngredientsPanel.tsx`.
- `shell/AppShell.tsx`, `App.tsx` (save/open split).
- An e2e spec under the existing Playwright setup: `e2e/import-draft.spec.ts`, 360×697, screenshots.

## 5. Tests (written before the code in each commit; `pytest -m "not llm and not network"`, Vitest)

**S2a**
- `test_stream_draft_scanner.py`:
  - **Every truncation boundary:** feed each replay text (5 fixtures plus the synthetic Hindi text)
    one character at a time, and snapshot after every character. Checks:
    - it never raises;
    - ingredients are `None` until the array closes, then equal the final;
    - steps are always a prefix of the final list;
    - at full length the draft equals what `parse(text)` yields (ingredients and step texts).
  - **Chunking invariance:** seeded random chunk sizes give the same milestone sequence, including
    splits inside `\uXXXX`, inside surrogate pairs and inside escapes.
  - **Invalid JSON:**
    - a garbage prefix, a code fence, an early `]`, unbalanced braces and a truncated escape;
    - milestones reached before the break are kept, and `broken` is set.
  - **Devanagari/Hindi:**
    - raw Devanagari, `\u0915`-style escapes and emoji;
    - names with quotes and backslashes.
  - **Empty and missing:**
    - `"ingredients":[]` → `[]`; a missing key → `None`;
    - an invalid item is skipped and the others are kept;
    - a step with no `text` is skipped;
    - `text` not first in the step still works;
    - duplicate top-level keys: the first wins;
    - caps.
  - **The draft never carries times:**
    - the `StreamedDraft` JSON schema, walked recursively, has no property matching
      `/min|duration|time|offset|lead|serv|total|timer|start/i`;
    - a draft scanned from text full of `duration_*` fields carries none of them.
- `test_drafting_adapter.py`:
  - fill-never-replace across two calls, both with call 1 complete and with call 1 empty;
  - `calls` counts up;
  - an `on_draft` exception doesn't change the final result;
  - the repair output type passes through with no `on_text`;
  - an inner adapter without `streams_text` gets the plain call.
- `test_extract_adapters.py`, OpenAI streaming with a fake SDK client:
  - request kwargs carry `stream=True` and `include_usage`, and `model`, `messages`, `effort` and
    `max_completion_tokens` are **identical to the pre-S2 call** (messages compared byte for byte);
  - joined deltas equal `text`;
  - usage comes from the final chunk (cached and reasoning tokens);
  - `length` → truncated with `raw_text`;
  - unparseable → `raw_text`;
  - no usage chunk → `usage=None` + a WARNING;
  - idle (the fake sleeps longer than `idle_s=0.2`) → `infra`/`StreamIdleTimeout`;
  - deadline → `StreamDeadline`;
  - a mid-stream `httpx.ReadError` → `infra`;
  - an `on_text` that raises → the call still completes;
  - the watchdog thread is gone after return.
  - Guard: `STREAM_IDLE_TIMEOUT_S >= 3 * 16.4`, with a docstring citing T2/T6. S1's margin guard is
    unchanged.
- `test_api_import.py`, with `ReplayStreamingAdapter` at speed 50× and a recording store:
  - write order: `acquiring`+acquired → ingredients → steps 1..n → `steps_complete` → `validating` → `done`;
  - `draft` is kept on later writes;
  - **unparseable retry** (`[invalid_json, ok]`):
    - the draft is frozen from call 1;
    - `calls == 2`;
    - the `import cost:` line lists 2 extraction calls;
    - the result equals the clean run's;
  - **stall** through the real `OpenAIAdapter`, using a fake client whose stream stops →
    `failed`/`unavailable`, with the sentence in `error`, not cached;
  - **escalation** (`[truncated, ok]`): the draft keeps call 1's steps, and `calls == 2`;
  - cache hit: `draft` is `None`, single `done`;
  - pasted text: `draft` present, `acquired` absent;
  - recipe page (preview): both present;
  - **equivalence:** for the same text, the streaming route's `ImportResult` equals the non-streaming
    fake's, apart from the job id and `imported_at`.
- **Kill switch (A1):**
  - `test_extract_adapters.py`: with `ABC_COOK_STREAM_EXTRACTION=0` (monkeypatched), the fake
    client sees **exactly the pre-S2 request kwargs**: no `stream`, no `stream_options`,
    `timeout=request_timeout_s(max_tokens)`. `streams_text` is False, and no watchdog thread starts.
  - `test_api_import.py`: with streaming off, the route gives `draft is None` on every write, and
    the `ImportResult` is identical to the streaming-on run for the same text (apart from the job id
    and `imported_at`).
  - The default (unset) is on.
- **Gzip (A4)**, `test_api_gzip.py`:
  - a poll response carrying a full kadhi draft, requested with `Accept-Encoding: gzip`, comes back
    with `Content-Encoding: gzip` and decodes to the same JSON;
  - a response under 1 KB is not compressed.
- `test_devtools_isolation.py`: no module under `abc_cook/api` imports `abc_cook.devtools`.
- Unchanged and green:
  - `test_model_facing_bytes.py`, which is the byte-identical prompt/schema dump proof;
  - `test_postprocess_version.py`, with no new entry;
  - `test_corpus_replay.py` (`reprocess(original) == snapshot`);
  - `test_schedule.py`.
- The full suite with `-m "not llm and not network"`. `ruff check` on touched files only.
  `mypy --strict abc_cook/schema abc_cook/schedule`.

**S2b** (Vitest, pure modules, no jsdom):
- `importView.test.ts`:
  - per-section precedence (preview > draft > pending);
  - the `draft` flags;
  - the model has no duration-like keys.
- `footerFor` copy table.
- `handOffFor`: tap vs auto.
- `phaseFor` → `ready`.
- `draftView.test.ts`:
  - group order;
  - verbatim trailing (`"1/2" "cup"` → `"1/2 cup"`, nothing parsed);
  - no group → a single ungrouped bucket.
- `IngredientsPanel` mapping: the items equal those before the change.
- `importTiming` marks.
- Failed with a draft (A2):
  - `failed` + draft → the view has the failure and the draft sections (`draft: true`);
  - `failed` without a draft → identical to the S1 model (sections `none`);
  - `phaseFor` carries the last draft into `failed`/`error`.
- Save-at-done/open-at-tap order, with fakes: save is called once at done and open once at the tap.
  Cancel after ready → no open, and the saved entry stays.

## 6. Measurements (₹0, replay)

S2a HARD STOP A (poll-observed, no web):

| target | today (S1/S1.5) | measured (replay, median/max of n=3) | met? |
|---|---|---|---|
| ingredients ≤ 15 s after paste | at the plan, ~33–37 s (no blog) | | |
| first step ~18–20 s | at the plan | | |
| full plan ≤ 40 s typical | ~33–37 s | | |

- One row per fixture: kadhi, croissant, pumpkin, vanilla, chole-low, plus the retry and stall scripts.
- The stand-in acquire is 6 s (3.5 s `acquired`). The rows are re-stated for a 14 s acquire (the
  chole probe hitting its 10 s cap) as arithmetic, flagged as FGC-20.
- The calibration is n=1 (T6), so the table says so.
- Payload (A4): the raw and gzip byte sizes of the largest draft-bearing poll for kadhi and
  chole-low.

S2b HARD STOP W1 / A: headless Playwright, 360×697, against `replay_server.py` + Vite. Screenshots:

1. ~6 s state: header, compact skeletons, "About this video" visible
2. acquired + description
3. ingredients draft
4. steps filling
5. ready, with the sticky button
6. the recipe page after the tap (hand-off)
7. the final recipe page's Ingredients tab, compared with the pre-S2 render
8. stall → `unavailable` on the Home ground, **with a draft** (failure at the top, the draft below
   under its label) **and without one** (S1 layout)
9. Try again after `unavailable`, from both 8a and 8b
10. the unparseable retry (frozen draft)
11. pasted-text draft
12. blog preview + ready

Before trusting any capture, check that `body`'s computed background is the Home ground. Walk
`DESIGN_SYSTEM.md` § Register: Home row by row against them.

## 7. Risks, and what we will not do

Risks:
- **A mid-stream failure's spend is unreported.** No usage chunk arrives, so `import cost:`
  under-reports (FGC-19).
- **The draft's step text is the model's**, lightly normalized. It can contain the source's own
  "fry 5 min", but never as a structured duration. If verification later changes a duration
  (FGC-11-like), the draft text and the plan can disagree (FGC-21).
- **The replay calibration is kadhi T6, n=1.** Real per-recipe timings need the optional live check
  or M5 phone runs.
- **Long descriptions** (chole) still make acquire ~14 s, so ingredients land at ~22 s (FGC-20,
  lever 9).
- **The watchdog closes the stream from another thread.** A test proves the close unblocks
  iteration with the real SDK `Stream` over an httpx `MockTransport`.
- **The ready tap adds one tap before the plan.** M5 should watch time-to-tap and abandonment
  (FGC-24).
- **The poll payload grows** by ≤ ~25 KB, about 30 polls per import.

What we will not do:
- No SSE, no second LLM call, no strict JSON (S3) and no change to the prompt, schema, model,
  effort or token budgets.
- No change to `normalize.py`/`import_pipeline.py`, no PPV bump and no golden regeneration.
- No morphing or merging of the draft into the final.
- No durations or timers in the draft.
- No title resolution in the draft.
- No deploy, no phone runs, no live YouTube.

If anything forces a model-facing change, a PPV bump or a golden change: **STOP and ask.**

## 8. Follow-ups for `docs/plans/followup-golden-corpus.md` (FGC-18 is the highest today)

- **FGC-19:** a mid-stream extraction failure has no usage chunk, so its spend is missing from
  `import cost:`. Decide whether to log characters received as a lower bound.
- **FGC-20:** the "ingredients ≤ 15 s" target misses when the probe stage hits its 10 s cap
  (chole, captions-manual-en: ~22 s). Lever 9, parallel acquisition, or start extraction before
  probing finishes when the description has no recipe-like link.
- **FGC-21:** the draft's step text can state a time that verification later changes. Measure how
  often the draft text and the validated plan's durations disagree on the corpus.
- **FGC-22:** S3, strict JSON output, changes the stream. Re-verify `DraftScanner` (key order,
  `text` first in a step) and the replay texts before S3 merges.
- **FGC-23:** at `low`, a reasoning silence over `STREAM_IDLE_TIMEOUT_S` (60 s) would end as
  `unavailable`, not `incomplete`. Revisit if S3 or FGC-12 changes the effort.
- **FGC-24 (M5):** the ready tap. Measure ready→tap time and abandonment on the reading screen.

## 9. Setup (this session, after leaving plan mode; plan mode can't create worktrees)

1. `cd "C:\Users\ashya\Music\ABC cook"`; `git fetch --prune`.
2. `git worktree add -b feat/pr-s2a-streamed-draft C:\Users\ashya\Music\abc-cook-s2a origin/main`.
3. Write this plan, with the Write tool, to `C:\Users\ashya\Music\abc-cook-s2a\docs\plans\pr-s2-streamed-draft.md`.
   The decision doc is already on main.
4. Append FGC-19..24 (§8) to `docs/plans/followup-golden-corpus.md`, after re-checking that FGC-18
   is the highest.
5. `git diff --check`; grep both files for `Ã|â€|Â|\uFFFD`.
6. One commit: `docs(plans): PR-S2 streamed draft plan (S2a/S2b) + FGC-19..24`, local only, with
   the Co-Authored-By line.
7. Report `git worktree list`, `git log -1 --stat` in the worktree, and the first 10 lines of
   the plan doc read back from the worktree. Save a memory entry for PR-S2. **STOP.**

## 10. Implementation (fresh Sonnet session in the worktree, auto mode; this doc is the source of truth)

**S2a**, in `C:\Users\ashya\Music\abc-cook-s2a`:
1. `test(extract): partial-draft scanner tests`, then `feat(extract): incremental draft scanner`
   (`extract/draft.py`).
2. `feat(extract): stream the OpenAI extraction call with an idle/deadline watchdog`: base, openai,
   routing, adapter tests.
3. `feat(api): streamed draft on the import job`: drafting wrapper, schema, route, `make types`,
   route tests.
4. `feat(api): ₹0 replay harness and draft bench`: devtools, scripts, isolation test.
5. Run the bench. Docs commit with the §6 table and `replay.json`.

**HARD STOP A (S2a).** Report:
- test counts;
- the target table (target → today → measured → met);
- the retry and stall rows;
- the gzip payload sizes (A4);
- spend.

The live check is **pre-approved (A3)** and runs before this STOP: `scripts/stream_live_check.py`
runs `normalize()` through `DraftingAdapter(build_default_adapter())` on the frozen
`kadhi-pakora.raw.json` and `croissant.raw.json`.
  - No acquisition, no YouTube, no repair.
  - 2 calls, ~₹1.3, **cap ₹5**, stop at the first failure.
  - It confirms the real chunk shapes (usage chunk, `finish_reason`, `reasoning_tokens`) and the
    T6-like timings.
  - Keys load with python-dotenv from the main checkout's `apps/api/.env` (`LLM_API_KEY`) and are
    never printed.

**HARD STOP B (S2a), before push.** Report:
- the final diff summary;
- the byte-identical proof (`test_model_facing_bytes.py` green, the hashes unchanged in its file);
- `test_postprocess_version.py` green with no new entry;
- goldens unchanged (`git diff origin/main -- apps/api/tests/fixtures` empty);
- test counts;
- a PR body draft in `notes/pr-s2a-body.md`, pushed later with `gh pr create --body-file`.

The owner merges. No deploy.

**S2b**, after S2a merges:
- `git fetch`, then `git worktree add -b feat/pr-s2b-reading-screen C:\Users\ashya\Music\abc-cook-s2b origin/main`,
  then `npm ci` in `apps/web`.
- Load `frontend-design`.
1. `refactor(web): shared IngredientList for the recipe page and the import screen` (recipe page
   pixel-identical).
2. `feat(web): reading screen on the Home ground with the streamed draft` (layout D3, skeletons,
   draft label, footer copy).
   - **HARD STOP W1:** render screenshots 1–4 (§6) via the harness, then STOP for owner approval
     before the rest (CLAUDE.md render-first rule).
3. `feat(web): save at done, open on "Your plan is ready"` (ready phase, App split, sticky button).
4. `feat(web): failure, paste and no-recipe screens on the Home ground`.
   - **HARD STOP A (S2b):** all 12 screenshots and the design-system walk.
   - **HARD STOP B (S2b):** before push: diff summary, test counts, PR body draft.

## 11. Lessons the implementer must follow

- Paths with spaces: `cd "C:\Users\ashya\Music\ABC cook"`.
  - Worktrees go in `C:\Users\ashya\Music\abc-cook-<name>`, from `origin/main` after `git fetch`.
  - Run `npm ci` in `apps/web`.
- Worktree Python:
  - `PYTHONPATH=apps/api`.
  - There is no `.env` in worktrees. Load keys with python-dotenv from the main checkout's
    `apps/api/.env`, and never print or copy them. The key is `LLM_API_KEY`.
- ₹0 runs use an invalid `LLM_API_KEY` in that process only.
- `make types` in a worktree: `npm ci` in `packages/schema`, then `make types PY=python`, with an
  absolute PYTHONPATH.
- Never `ruff format .`.
- `export_web_fixtures.py` rewrites fixtures with CRLF. Restore content-identical ones with
  `git checkout`.
- Non-ASCII goes through Write/Edit only, never heredocs. Run the mojibake grep (`Ã`, `â€`, `Â`,
  U+FFFD) before every commit.
- `api/main.py` already sets INFO logging for `abc_cook` (`_configure_logging`).
- Don't size timeouts from a single run; slow cases vary 2–3×.
- `notes/` is gitignored. Bench JSON can be force-added (precedent:
  `notes/investigate-extraction-speed/b0.json`).
- Repair can double the cost. 5 live-LLM tests fail without a key, so use
  `-m "not llm and not network"`.
- Test-first commits are red, so the PR is squash-merged.
- No deploy steps.
- No phone runs, because of the Cookbook risk. If the owner later wants one, back up and restore
  the Cookbook first.
- No live YouTube. If one is ever approved: ≤ 2 URLs, ≥ 5 s apart, stop on the first 429.
- The headless Playwright/CDP driver uses its own browser or tab. Port 9222 is the owner's. Don't
  kill all node processes: stop only the PIDs you started.
- Never commit to main. Branch → push → PR → the owner approves and merges.

## S2a results (replay, INR 0), 2026-10-17

`scripts/stream_draft_bench.py`, real FastAPI app + replay adapter + stand-in acquire (metadata at
3.5 s, acquire returns at 6.0 s), polled at 1.2 s. n=3 per clean fixture. Median / max in seconds
since the POST. Raw rows: `notes/pr-s2-streamed-draft/replay.json`.

**The replay pace is calibrated from ONE measured run (REPORT T6, kadhi, n=1).** Every fixture
streams at kadhi's characters per second. These are timings of the plumbing at that pace, not
measurements of any recipe.

| fixture | ingredients (target <= 15) | first step (target ~18-20) | steps done | full plan (target <= 40) | status |
|---|---|---|---|---|---|
| kadhi-pakora | 19.3 / 19.4 NOT met | 19.3 / 19.4 met | 31.4 / 31.5 | 32.7 / 32.7 met | done |
| croissant | 15.7 / 15.7 NOT met (0.7 s over) | 15.7 / 15.7 met | 31.4 / 31.4 | 33.8 / 33.8 met | done |
| pumpkin-pancakes | 16.9 / 16.9 NOT met | 16.9 / 16.9 met | 24.1 / 24.2 | 32.6 / 32.6 met (includes the stand-in 8 s repair) | done |
| vanilla-cupcakes | 15.7 / 15.7 NOT met (0.7 s over) | 15.7 / 15.7 met | 19.3 / 20.5 | 20.5 / 20.6 met | done |
| chole-bhature-low | 20.5 / 20.6 NOT met | 20.5 / 20.6 about | 38.6 / 38.7 | 48.5 / 48.5 NOT met (degraded, stand-in repair absent) | done (degraded) |
| kadhi, `invalid_json,ok` (retry) | 19.3 | 19.3 | n/a (call 1 cut) | 53.2 | done, draft frozen from call 1, `calls` = 2 |
| kadhi, `stall_after:3000` | 19.3 | 19.3 | n/a | failed at 79.7 | failed `unavailable`, draft kept |

Today (S1/S1.5, no blog): nothing readable until the plan, ~33-37 s.

Findings:

- **Ingredients miss the 15 s target in every replay.** The ingredient list closes 9.2-13.7 s into
  the extraction call (kadhi 12.3 s, 30 items), and the call starts after the 6 s acquire. The
  target holds only measured from the start of the call, not from paste. The scanner publishes
  the list when its array closes (section 3.1.5), so a 30-item list is visible at ~19 s.
- If the first ingredient should appear earlier, the draft would have to publish items as they
  close (first item at ~8.2 s in the call). That changes `StreamedDraft.ingredients` from
  `None`-until-complete to append-only, which S2b relies on (section 3.3). Not done; owner decision.
- With a 14 s acquire (the chole probe at its 10 s cap, FGC-20), add 8 s to every figure above:
  kadhi ingredients ~27 s, chole ~28.5 s. Arithmetic, not a run.
- The first step arrives in the same poll as the ingredients (it closes within ~0.3 s of them).
- Stall: failure shows at 79.7 s = 6 s acquire + 7.7 s to first token + ~5 s streamed + the 60 s idle bound.

Poll payload (A4), largest in-flight draft-bearing poll, gzip as sent / raw JSON:

| fixture | poll gzip / raw | draft alone gzip / raw |
|---|---|---|
| kadhi-pakora | 3,103 / 9,923 | 1,123 / 4,096 |
| chole-bhature-low | 2,971 / 9,349 | 2,035 / 6,868 |

(The terminal poll also carries the whole plan.)
