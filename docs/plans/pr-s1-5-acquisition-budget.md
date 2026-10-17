# PR-S1.5: acquisition budget (FGC-14)

Status: plan approved 2026-10-17 with the owner's changes folded in. Branch
`feat/pr-s1-5-acquisition-budget`, worktree `C:\Users\ashya\Music\abc-cook-s1-5`, base origin/main
64068d5. Setup (steps 1–4) is this docs commit. Implementation starts at step 5.

Owner decisions folded in:

- No link ranking; description order is kept.
- 4 s per link and 8 s per stage, with no minimising from n=1. **Superseded 2026-10-17: 8 s per link and
  10 s per stage** (see Before/after results).
- One module-level bounded executor, with `abandoned=` in the probe log line.
- The BEFORE run fetches Amazon links, records their outcome and carries on.
- The 5 s pacing applies between acquisitions.
- The web check is a ₹0 run at 360 × 697.

## Context

Before extraction starts, `acquire/pipeline.py` probes every description link one at a time
(`for link in find_candidate_links(...)` → `fetch_recipe(link)`). Nothing caps the number of links,
and each fetch is a full `safe_fetch.fetch_html` call with a 10 s httpx timeout per operation and up
to 5 redirects. A link is rejected only *after* its final page has been fetched
(`fetch_recipe_page` → "redirected to excluded host").

Measured on the phone in S1:

- chole: 54 s, 13 fetches, 10 of them ending on an excluded host;
- captions-manual-en: 79 s, 29–32 fetches, 25–26 of them excluded;
- vanilla-cupcakes: 12 s, 4 `amzn.to` fetches.

The job only reports `acquired` after the whole stage returns, so the cook sees no description until
then, and extraction waits too.

What the corpus descriptions show (from the frozen `*.raw.json` fixtures on origin/main):

| Fixture | candidate links today | what they are | blog found today |
|---|---|---|---|
| chole (FU1ZVLMbWjA) | 13 | 2 `goo.gl`, 11 `aip.urlgeni.us/https://amzn.to/…` wrappers (one malformed: `aip.urlgeni.ushttps://…`) | none |
| captions-manual-en (pxpJmXq2w7c) | 32 | 26 `bit.ly` (3 duplicates), `goo.gl` ×2 (each listed twice), `amzn.to` | none |
| vanilla-cupcakes (YP8a6ugKQ6Y) | 4 | `amzn.to` ×4 | none |
| pumpkin (TYZNzCnNGwA) | 1 | `amzn.to` | none |
| pizza-dough (WM1XcYXix0Y) | 28 | `amzlink.to` ×25, `natashaskitchen.com` ×3 (all three are recipe pages) | natashaskitchen pizza-dough, 2nd link |
| blog-link-only / rasgulla (3Q4NBZaF29w) | ~6 | `bit.ly/2DbcxhJ` first, then `nehascookbook.com/` | via the first **bit.ly** (the shortener → blog case) |
| kadhi (Oa2s0dklrRo) | ~3 | `chefkunalkapur.com/recipe/kadi-pakoda/` first | chefkunalkapur, 1st link |
| croissant, captions-auto-hi, partial, useless | 0 | | none |

So the time goes to affiliate wrappers, Amazon links and shorteners that end on YouTube or Amazon.
None of those has ever produced a recipe in the corpus.

Outcome:

- `acquired` shows as soon as yt-dlp returns.
- The probe stage has a hard wall-clock cap.
- Every link that finds a blog today finds the same blog afterwards.
- No model-facing change and no `POSTPROCESS_VERSION` bump.

## Approach

### 1. Report `acquired` right after yt-dlp (before captions and before probing)

- `acquire/__init__.py`: add a frozen dataclass `SourceMetadata(title, channel, description)` and
  `MetadataCallback = Callable[[SourceMetadata], None]`. The acquire layer must not import
  `schema/api.py`; the route maps the dataclass to `AcquiredSource`.
- `acquire/youtube.py` `fetch(url, *, on_metadata=None)`:
  - Call the callback right after `extract_info`, before `select_track`/`fetch_segments`.
  - Use the same `clean_placeholder_title(...)` and `channel or uploader` expressions as the returned
    `RawAcquisition`, so the early and final values are identical.
  - Compute both once, in locals, so the two can't drift.
- `acquire/pipeline.py` `acquire(url, *, on_metadata=None)`: pass the callback through to
  `fetch_youtube`. A pasted recipe-page URL has no early phase and does not call it.
- `api/routes/import_.py`:
  - Add an `AcquireFn` Protocol (`(url, /, *, on_metadata=None)`) as the dependency type.
  - `recording_acquire` passes an `_on_metadata` that sets `acquired` and immediately writes
    `JobState(status="acquiring", acquired=...)`.
  - The assignment after acquire returns stays as a fallback for an acquire_fn that never calls the
    callback (fakes, recipe pages).
  - The pasted-text lambda and the 18 test fakes in `test_api_import.py` get `**_kwargs`.
- **`import_pipeline.py` is not touched.** `run_import` still calls `acquire_fn(url)` with the route's
  single-argument closure.
- One test changes, because the behaviour changes on purpose (it is not a golden). In
  `test_acquired_is_set_right_after_acquire_and_kept_on_every_later_status`, the first recorded write
  becomes `acquiring` with `acquired` set, instead of `extracting`.

### 2. Spend less time on links that can't be a recipe (`acquire/blog.py`)

`find_candidate_links` becomes a pure function that returns a filtered list in description order:

1. **Clean**:
   - Strip trailing punctuation (as today) and zero-width characters (`\u200b-\u200d`, `\ufeff`).
     Kadhi's `chefkunalkapur.com/` homepage link has them.
   - Drop a candidate whose hostname fails a basic syntax check. This catches chole's
     `aip.urlgeni.ushttps:`.
2. **Unwrap** known pass-through wrappers. When the host is `urlgeni.us` (any subdomain) and the path
   embeds `http(s)://…`, judge the embedded URL instead. A geniuslink wrapper around a real blog is
   kept, and one around `amzn.to` is dropped.
3. **Exclude before fetching**:
   - Extend `_EXCLUDED_HOSTS` with what the corpus shows and the obvious siblings: `amzn.to`,
     `amzn.eu`, `a.co`, `amzlink.to`, `geni.us`, `flipkart.com`, `fkrt.it`, `linktr.ee`,
     `patreon.com`, `anchor.fm`, `spotify.com`, `threads.net`, `wa.me`, `t.me`,
     `creativecommons.org`, `free-stock-music.com`.
   - Amazon country domains (`amazon.*`) are matched by a label rule, not by listing every TLD.
   - The shortener set stays allowed: `bit.ly`, `b.link`, `tinyurl.com`, plus `goo.gl`. `goo.gl` is
     already fetched today; this makes it explicit.
4. **De-duplicate**, keeping the first occurrence (captions-manual-en repeats 3 links).
5. **No ranking** (owner decision). The remaining links keep description order, and in the corpus
   that already puts every winner first among what remains:
   - kadhi's recipe link is first;
   - pizza's `pizza-dough-recipe` becomes first once `amzlink.to` is excluded;
   - rasgulla's `bit.ly` stays ahead of `nehascookbook.com/`.

   If the live AFTER run shows any different winner, that is a STOP (see Quality floor).

### 3. Hard cap on the probe stage

- **`acquire/safe_fetch.py`**: `fetch_html` gains two optional keyword arguments. Their defaults leave
  the pasted recipe-page path (A1) exactly as it is.
  - `refuse_host: Callable[[str], bool] | None`:
    - Checked on every redirect hop, *before* that hop is requested.
    - A hit raises `FetchError("redirected to excluded host")`, the same reason string as today.
    - Effect: a `bit.ly` link to YouTube costs one 301 round trip instead of a full YouTube page
      load. Shorteners that lead to a blog still work.
  - `deadline: float | None` (a `time.monotonic()` value):
    - Checked before each hop and while streaming the body.
    - Each hop's httpx timeout is `min(timeout_s, remaining)`.
    - When it expires, the fetch raises `FetchError("link timeout")`.
- **`acquire/pipeline.py`**: a new `probe_links(candidates, *, link_timeout_s, budget_s, fetch=...)`.
  - It returns `ProbeReport(recipe, final_url, entries[(url, outcome, seconds)], stopped)`, where
    `stopped` is `"found"`, `"exhausted"` or `"budget"`.
  - It probes one link at a time, in description order.
  - Each link's deadline is `min(now + link_timeout_s, stage_deadline)`, so the stage cap is hard.
  - Each link is submitted to **one module-level bounded `ThreadPoolExecutor`** (small
    `max_workers`, e.g. 4, shared by all jobs; never a pool per call) and awaited with
    `future.result(timeout=remaining)`. That bounds the one thing httpx timeouts can't: a blocking
    `getaddrinfo` in `resolve_host`.
  - It logs one INFO line per acquire:
    `probe: candidates=… excluded=… probed=… abandoned=… stopped=… found=<host|none> elapsed=…`.
- **Abandoned threads may finish after the stage ends.**
  - A link abandoned at its deadline is not killed. Its worker thread runs until its own httpx and
    DNS timeouts expire, which can be after the probe stage, or even the whole import, has ended.
    Its result is discarded.
  - Because the executor is bounded, stragglers can briefly occupy workers. A new submission then
    waits in the queue, and that wait counts against the stage budget, so the cap still holds.
  - `abandoned=` in the probe line makes this visible.
- **Numbers (owner decision, revised 2026-10-17 after the AFTER bench): 8.0 s per link, 10.0 s per stage.**
  The first decision was 4.0 / 8.0; it lost the rasgulla blog, whose fetch takes 2.5-3.3 s and up to 6.8 s.
  - No minimising from n=1 data.
  - Raise the per-link value only if the AFTER run shows a fetch that found a blog taking more than
    about 2.5 s. Report that at STOP A rather than changing it silently.
  - Worst-case acquire after the change is yt-dlp + captions + 8 s.
  - `acquired` depends only on yt-dlp (REPORT T8: 2.97–4.25 s), so "≤ ~4.5 s" is set by yt-dlp, not
    by this PR. Any URL over 4.5 s gets reported, not tuned here.
- **Bounded parallel probing: not worth it here.**
  - After pre-exclusion, unwrapping and refusal at each redirect, the corpus leaves at most 2 probes
    for chole and none for vanilla or pumpkin. Pizza, kadhi and rasgulla each find their blog on the
    first link probed.
  - Only captions-manual-en still has ~28 shorteners. All of them are `bit.ly`/`goo.gl`, so a
    one-request-per-host rule would make them sequential anyway, and none has ever led to a recipe.
  - Parallelism would add an ordering rule (accept a later link's hit only once every earlier link
    has failed), plus the bursts of simultaneous requests that tripped T8.
  - Revisit only if the AFTER run shows the budget cutting off a link that found a blog before.

### 4. Cost and token log line, and confirming INFO reaches the log

- **The logging config already exists.** `api/main.py` has had `_configure_logging()` since fb52732:
  `abc_cook` at INFO with a StreamHandler.
  - The FGC-14 evidence quotes those `finished … stages=` lines from the local API log, so S1's
    "the API sets no logging config" is out of date.
  - Verify it once under the real launch: `make api` / `uvicorn abc_cook.api.main:app`, with
    `--env-file`.
  - Pin it with a test: after `create_app()`, `abc_cook`'s effective level is INFO, it has a handler,
    and no line is duplicated through root.
- **The log line goes in the route**, via `run_import(on_telemetry=...)`. It does not go in
  `import_pipeline.py`, which would trip the AST guard. `_run_job` logs at INFO:
  `import cost: graph_id=… tier=… cache_hit=… cost_inr=<x.xx|unpriced> input_tokens=…
  output_tokens=… reasoning_tokens=… calls=[model:in/out …]`.
  - It uses `ImportTelemetry.cost_inr` and `CallUsage.input_tokens/output_tokens`.
  - It logs no URL beyond what is already logged, and no keys.
- **Repair is included.**
  - `ImportTelemetry.cost_inr` is `total_cost_inr(self.total_calls)`, and `total_calls` is
    `[*extraction_calls, *repair_calls]` (`import_pipeline.py` on origin/main). The token totals in
    the line use the same `total_calls`.
  - A test pins it: a fake adapter whose first graph fails validation, so repair fires. The logged
    `cost_inr` and token totals then equal the sum over the extraction and repair calls, and `calls=`
    lists both models.

## Model-facing changes and POSTPROCESS_VERSION

- **The system prompt, schemas and pinned `render_source_text` bytes are unchanged.**
  `test_model_facing_bytes.py` runs on frozen `RawAcquisition` fixtures and doesn't touch acquire, so
  it must stay green unchanged.
- **Live extraction input changes for a URL only if its `blog_recipe` changes.** Expected: no case.
  - The before/after table lists every URL's blog winner.
  - Every difference is listed in the report and is a STOP: a product decision, not something to
    tune silently.
- **No `POSTPROCESS_VERSION` bump.**
  - The guard hashes graph, validate, repair, normalize, title, corroborate, provenance,
    import_pipeline, postprocess and `schedule/`.
  - This PR touches only `acquire/*`, `api/routes/import_.py`, tests and scripts.
    `import_pipeline.py` stays byte-identical.
  - `test_postprocess_version.py` must stay green without a new entry.
  - If implementation finds it *must* touch `import_pipeline.py`, stop and ask first. That means a
    bump from 10 to 11, and every cached plan goes stale.

## Quality floor: live measurement (₹0, acquisition only)

- **Script:** `apps/api/scripts/acquire_probe_bench.py` runs `acquire()` only. It constructs no adapter
  and reads no LLM key.
- **URLs, 10 in total:**
  - the 7: kadhi, croissant, pumpkin, vanilla, chole, captions-manual-en, pizza-dough;
  - plus 3 link-heavy extras: blog-link-only/rasgulla (the only shortener → blog case), full-method
    (nishamadhulika homepage) and captions-auto-en-long (wayoframen).
- **Reps:** 1 BEFORE + 1 AFTER per URL, so 2 per URL in total.
- **Pacing:**
  - At least 5 s between acquisitions (owner decision). Inside a run, links are fetched as the
    product fetches them.
  - Never more than one request in flight to the same host.
- **Stops:**
  - Any 429 stops the run.
  - A bot or captcha page, or a 503, from a **non-Amazon** host stops the run.
  - In the BEFORE run, a 503 or bot page from an Amazon-family host is recorded as that link's outcome
    and the run continues (owner decision).
  - No retries.
- **BEFORE** runs in this worktree **before any code change** (base = origin/main). It wraps
  `pipeline.fetch_recipe` to time each link.
- **AFTER** reads `ProbeReport` plus the time to `on_metadata`.
- **Output:** `notes/pr-s1-5-acquisition/{before,after}.json`, plus this table, filled in below:

  | URL | yt-dlp s | acquired at s (after) | probed before → after | abandoned (after) | probe stage s before → after | slowest blog fetch s | blog before | blog after | same? |
  |---|---|---|---|---|---|---|---|---|---|

  The pass condition is "same?" = yes on every row that found a blog before.

## Offline tests (fake HTTP, no network)

These go in `tests/test_acquire.py`, `tests/test_safe_fetch.py`, `tests/test_acquire_pipeline.py`
and `tests/test_api_import.py`. They reuse the existing patterns: `_FakeYDL` with a monkeypatched
`yt_dlp.YoutubeDL`, the `resolve`/`transport` injection on `fetch_html` (httpx `MockTransport`), and
`fetch_recipe_page(fetch=...)`.

1. **Budget exhausted.**
   - Setup: 10 slow links (the fake fetch sleeps 0.15 s each) and a 0.5 s budget.
   - Expect: `stopped="budget"`, only a few links started, no recipe, and elapsed under the budget
     plus a small epsilon.
2. **Per-link timeout.**
   - Setup: link 1 hangs for 2 s, the per-link limit is 0.2 s, and link 2 has a Recipe.
   - Expect: link 1 is abandoned as "link timeout", link 2's Recipe is found, and the total is under
     0.6 s.
   - Also: a deadline test on `fetch_html` with a slow `MockTransport` body.
3. **Excluded host never fetched.**
   - Setup: `amzn.to`, `amazon.in/shop`, `amzlink.to`, `geni.us`, `aip.urlgeni.us/https://amzn.to/…`
     and the malformed `aip.urlgeni.ushttps://…`.
   - Expect: the recording fetch is never called.
   - Unwrap counter-case: `aip.urlgeni.us/https://blog.example/recipe/x` → the blog URL is fetched.
4. **Shortener within budget.**
   - `bit.ly` → 301 → a blog with Recipe JSON-LD: found.
   - `bit.ly` → 301 → `youtube.com`: refused at the redirect, and the transport records that YouTube
     was **never requested**.
5. **`acquired` reported before probing.**
   - Pipeline: a shared event log shows `on_metadata` firing before the caption fetch and before the
     first probe call.
   - Route: `_RecordingStore` sees an `acquiring` write with `acquired` set before `extracting`.
6. **Recipe blog still found first.**
   - Setup: the frozen descriptions of blog-link-only, kadhi and pizza-dough, run through
     `find_candidate_links` + `probe_links`. The fake fetch serves Recipe JSON-LD for today's winner
     *and* for later competing recipe links (pizza's two sauce pages).
   - Expect: the winner is the first hit in today's sequential order.
7. **Cost line with repair fired** (see §4). The logged `cost_inr` and token totals include the
   repair call. Also covers the extraction-only case and the unpriced case (`cost_inr=unpriced`).
8. **Small checks:**
   - de-duplication;
   - zero-width stripping;
   - description order kept after filtering;
   - `abandoned=` counted in the probe line (from the per-link timeout test).

Commands:

- `pytest`: the full API suite, including `test_model_facing_bytes.py`,
  `test_postprocess_version.py` and `test_corpus_replay.py`.
- `ruff check` on touched files only. Never `ruff format` on the tree.
- `mypy --strict abc_cook/schema abc_cook/schedule`.
- No schema change, so `make types` is not needed. If it ever is, use an absolute `PYTHONPATH`.

## Steps

**Setup (done in this docs commit):**

1. Worktree `C:\Users\ashya\Music\abc-cook-s1-5` on `feat/pr-s1-5-acquisition-budget`, from origin/main.
2. This plan saved to `docs/plans/pr-s1-5-acquisition-budget.md`.
3. In `docs/plans/followup-golden-corpus.md`:
   - FGC-14 is marked as addressed by PR-S1.5.
   - FGC-15/16/17 are added. Before adding them, checked that the doc used FGC-1…14 and nothing
     higher.
4. One docs commit, then STOP.

**Implementation (from this file):**

5. Commit the bench script, then run BEFORE (unchanged code) → `before.json`.
6. Commit A, `feat(api): report acquired right after yt-dlp`: §1 and test 5.
7. Commit B, `feat(api): bound the description-link probe`: §2, §3 and tests 1–4, 6, 8.
8. Commit C, `feat(api): log import cost and tokens per job`: §4, test 7 and the logging test.
9. Run AFTER → `after.json`.
   - The constants stay 4 s / 8 s unless a fetch that found a blog took over ~2.5 s. If so, propose a
     change; don't make it.
   - Docs commit with the before/after table.
10. **HARD STOP A.** Report:
    - the test output and the clean-worktree pytest run;
    - the before/after table;
    - every case where the blog changed (expected: none);
    - whether **the web renders `acquired` while the status is still `acquiring`**.

    It should already render: on origin/main, `phase.ts` builds
    `{kind: 'polling', status, preview, acquired}` for any non-terminal status, and `importView.ts`
    reads `acquired` without checking the status. How to verify:
    - Make it a **₹0 run**: the local API with an invalid `OPENAI_API_KEY` set in that process only.
      **No paid import in this PR.**
    - Check that the description is visible while the status line still says "Getting the recipe…".
    - Take a screenshot at **360 × 697**.
    - If it runs on the phone: back up the Cookbook first, restore it byte-identical afterwards, and
      verify the keys.
    - The CDP driver opens and closes its own tab. Port 9222 is the owner's own browser: never touch
      existing tabs.
    - If it does not render, report it. A web fix is outside this PR's API scope unless approved.
11. **HARD STOP B** before push or PR. No deploy steps: nothing is deployed until M5.

Lessons that apply:

- Use an absolute `PYTHONPATH` for `make types`.
- Never `ruff format` the whole tree.
- Use Write or Edit, not the shell, for any file with non-ASCII.
- Never print keys. The bench never loads an LLM key; the API runs with `--env-file`.

## Before/after results

Measured 2026-10-17 with `apps/api/scripts/acquire_probe_bench.py` (INR 0, no LLM key read), one
BEFORE run on origin/main code and one AFTER run on this branch, 8 s between acquisitions. Raw rows:
`notes/pr-s1-5-acquisition/{before,after}.json`. No 429, bot page or non-Amazon 503 was seen by the
bench itself.

| URL | yt-dlp s (before / after) | acquired at s (after) | probed before -> after | abandoned (after) | probe stage s before -> after | slowest blog fetch s (before / after) | blog before | blog after | same? | probe-only re-run (8/10) |
|---|---|---|---|---|---|---|---|---|---|---|
| kadhi-pakora | 2.4 / 3.8 | 4.2 | 1 -> 1 | 0 | 1.7 -> 1.8 | 1.7 / 1.8 | chefkunalkapur.com/recipe/kadi-pakoda | chefkunalkapur.com/recipe/kadi-pakoda | yes | 2.0 s, found, chefkunalkapur.com/recipe/kadi-pakoda |
| croissant | 2.9 / 3.1 | 3.2 | 0 -> 0 | 0 | 0.0 -> 0.0 | - / - | none | none | yes (none) | 0.0 s, exhausted, none |
| pumpkin-pancakes | 3.0 / 4.1 | 4.3 | 1 -> 0 | 0 | 2.8 -> 0.0 | - / - | none | none | yes (none) | 0.0 s, exhausted, none |
| vanilla-cupcakes | 3.3 / 3.6 | 3.8 | 4 -> 0 | 0 | 13.3 -> 0.0 | - / - | none | none | yes (none) | 0.0 s, exhausted, none |
| chole-bhature | 2.7 / 3.3 | 3.5 | 13 -> 2 | 2 | 60.4 -> 8.0 | - / - | none | none | yes (none) | 10.0 s, exhausted, none |
| captions-manual-en | 2.8 / 4.0 | 4.1 | 29 -> 2 | 2 | 96.3 -> 8.0 | - / - | none | none | yes (none) | 10.0 s, budget, none |
| pizza-dough | 3.4 / 4.3 | 4.5 | 2 -> 1 | 0 | 4.2 -> 1.9 | 1.8 / 1.9 | natashaskitchen.com/pizza-dough-recipe | natashaskitchen.com/pizza-dough-recipe | yes | 1.7 s, found, natashaskitchen.com/pizza-dough-recipe |
| blog-link-only | 3.1 / 3.6 | 3.7 | 1 -> 2 | 2 | 2.5 -> 8.0 | 2.5 / - | nehascookbook.com/rasgulla-recipe-spongy-rasgu | none | **NO** | 3.1 s, found, nehascookbook.com/rasgulla-recipe-spon<br>2.5 s, found, nehascookbook.com/rasgulla-recipe-spon<br>6.8 s, found, nehascookbook.com/rasgulla-recipe-spon |
| full-method | 2.7 / 3.4 | 3.6 | 1 -> 1 | 0 | 2.0 -> 2.2 | 2.0 / 2.2 | chefkunalkapur.com/recipe/dal-makhni | chefkunalkapur.com/recipe/dal-makhni | yes | 2.0 s, found, chefkunalkapur.com/recipe/dal-makhni |
| captions-auto-en-long | 3.1 / 4.2 | 4.3 | 3 -> 1 | 0 | 7.4 -> 2.7 | - / - | none | none | yes (none) | 4.5 s, exhausted, none |

**Result of the first AFTER run (4 s / 8 s): not a pass.** One row that found a blog before did not find it after: blog-link-only
(rasgulla). The `bit.ly` link took 2.5 s in the BEFORE run, and both links timed out at the 4 s per-link
cap in the AFTER run (`bit.ly`, then the `nehascookbook.com` homepage; stage = budget). A follow-up
diagnostic fetch outside the bench (two requests, 6 s apart, unbounded) put the same `bit.ly` -> blog fetch
at 3.3 s and the homepage at 6.2 s. nehascookbook.com serves ~480-650 KB pages slowly, so a 4 s per-link
cap sits right on its normal latency. This is the "blog-finding fetch took more than ~2.5 s" case; the
constants are unchanged pending the owner's decision.

Other findings from the same runs:

- `acquired` at 3.2-4.5 s on every URL, set by yt-dlp (3.1-4.3 s), as planned.
- chole 60.4 -> 8.0 s, captions-manual-en 96.3 -> 8.0 s, vanilla 13.3 -> 0 s. In both budget cases the two
  `goo.gl` links consumed the stage (dead host: ConnectTimeout), so 2 workers were abandoned each.
- YouTube's caption endpoint began answering **429** between the two runs: every AFTER row has
  `has_transcript=False` (BEFORE: True for all 9 with a track) and ~7 s of caption retry time. A direct,
  single `httpx.get` of kadhi's caption URL confirmed 429. This is the existing transient-failure path in
  `transcript.py`, unrelated to this change, but it means the AFTER run's `total_s` is not comparable
  to BEFORE's, and no further YouTube traffic was generated after seeing it.

### Revised caps and probe-only re-run (8 s per link, 10 s per stage)

Owner decision 2026-10-17: per-link 8.0 s, stage 10.0 s (`pipeline.LINK_TIMEOUT_S` / `PROBE_BUDGET_S`).
The last column of the table above is a probe-only re-run (`apps/api/scripts/probe_only_rerun.py`): each
row's links from `before.json`, filtered by `find_candidate_links`, through `probe_links` at the new caps.
No yt-dlp, no captions, so **no YouTube traffic**. Rasgulla ran 3 times, at least 8 s apart; nothing else
repeated; no retries; no stop condition fired.

- **Rasgulla found nehascookbook.com in all 3 runs** (3.1 s, 2.5 s, 6.8 s). Run 3 shows the site's
  spread: 6.8 s would have failed at the old 4 s cap and passes at 8 s.
- Every row that found a blog before finds the same blog (kadhi, pizza-dough, full-method, rasgulla).
- chole and captions-manual-en still end at the stage cap (10 s), where the two dead `goo.gl` links
  consume it, down from 60 s and 96 s.

**Caveat on the AFTER columns above.** `has_transcript` (True -> False on every row with a track) and the
~7 s excess in `total_s` come from YouTube answering the caption endpoint with 429 between the two runs,
not from this change (FGC-18). Only the probe columns, `acquired at` and the blog outcomes are
comparable. The 4 s / 8 s table above is kept as the record of that run.
