# Golden corpus: widen with 5 real replay fixtures

## Context

Today exactly one real import is replayed offline end to end: pizza-dough. Its captured
`RawAcquisition` and `NormalizedRecipe` go through `build_graph → validate → schedule →
stage_spans` with no LLM call. Several open follow-ups are waiting on "measure on the widened
golden corpus". These are F7 (the after/once window swallowing "for N",
`docs/plans/followup-offset-not-duration.md:33`) and F2 (a whole window disappearing under the
closure rule, `docs/plans/followup-window-unclaimed-dependency.md:67`). The corpus also has no
long baking recipe, no quick breakfast and no Hindi multi-group recipe with an overnight soak.

Goal: capture 5 real recipes once (one live import each), let the owner review what they
produce, then freeze the approved ones as replay goldens. This PR changes nothing in
`extract/` or `schedule/`. Any bug it exposes gets logged, not fixed here.

## Step A findings (origin/main @ 7aeacca)

### A1. How pizza-dough became a replay
- **No dedicated capture script.** It was a one-off re-run of `run_import` +
  `build_default_adapter()` with a recording adapter, written to the scratchpad
  (`docs/cooking-plan-investigation.md:32`, ₹1.87, one GPT-5-mini call). It was copied into
  fixtures in bdecd5c (M2.13 Phase A).
- **Reusable tool today:** `apps/api/scripts/effort_ab.py`. Its `RecordingAdapter` (:70-81)
  keeps every extraction's `NormalizedRecipe`. `load_input` (:135-150) acquires a URL once
  and writes `<name>.raw.json`. `one_run` (:213-217) writes `<run>.call{i}.normalized.json`
  and `<run>.result.json`. Budget cap is `--budget-inr` (:363), with a ₹3.5 reserve per run (:84).
- Files: `apps/api/tests/fixtures/import/pizza-dough.raw.json` and `pizza-dough.normalized.json`.
- `apps/api/scripts/export_web_fixtures.py`:
  - :48 `IMPORT_REPLAYS = ["pizza-dough"]`.
  - :57-96 `replay_import()` runs `render_source_text → build_graph` and raises if the result degraded.
  - :84 **hard-codes pizza's URL** as `SourceRef.value` for every replay.
  - :169-170 writes `<slug>.plan-response.json` with `capacity=1`.
- `apps/api/tests/test_extract_replay.py` holds hand-written property assertions:
  - :41 14 steps, all `depends_on_previous`
  - :50 every label falls back to `_label`
  - :64 a single chain: one source, one sink
  - :86 the sink is `finish`/unattended
  - :98 8 produces claims: 2 kept, 6 dropped with a warning
  - :118 `validate()==[]`, `windows==[]`, `saved_min==0`
  - :139 per-stage hands-on/unattended/inline minutes (5/5/10, 30/1429/1459, 0/1/1) and the
    preheat duration marked inferred
  - :171 graph.title vs source_title
  - :28 SOURCE is also hard-coded to pizza.
- Pizza is also read by `test_summary.py:496-512`, `test_reprocess.py:215`,
  `test_extract_graph.py:1591`, `test_extract_title.py:33`, and `viewModel.test.ts:11` plus
  `feed/mock.ts:16` on the web side.

### A2. What would gain entries
- **API:** a new replay test module, plus the new raw/normalized files. Not
  `test_extract_normalized_schema.py:63`: that parametrize is for *pre-CP2 legacy* captures, and
  new v7 captures carry `depends_on_steps`. Not `test_schedule.py` `GOLDEN` either: those are
  hand-authored graph+plan pairs, a different kind of golden.
- **Web, only if exported:** adding a slug to `IMPORT_REPLAYS` adds a `__fixtures__/*.plan-response.json`, and two suites pick it up automatically:
  - `cooking-mode/quantity.test.ts:98-111` asserts `quantityLine.golden.json` has a key for
    **every** plan-response file and every node in it. Each new fixture needs a golden entry,
    the same documented exception sabudana got (:92-95).
  - `plan/cookOutline.test.ts:141-175` holds invariants over **all** fixtures: the outline is
    non-null, no "phase/session" wording, no "hands free" inside stretches, and checks on
    window-assigned nodes. If a new fixture fails one of these, that is a bug to log, so that
    recipe can't be exported in this PR.
- **Feed:** `feed/mock.ts:12-19,58` imports named fixtures explicitly, so it is **unaffected**
  unless we add ENTRIES. I agree with your lean: corpus only, not the feed.
- `POSTPROCESS_VERSION` (9) is not bumped. Nothing in `extract/` or `schedule/` changes.
  `postprocess-version.json` is rewritten with the same value.

### A3. Links, captions, sources (yt-dlp metadata, no LLM)
| # | Link | Actual dish (title) | Captions picked by `select_track` (`transcript.py:97-144`) | Other grounding |
|---|---|---|---|---|
| 1 | YP8a6ugKQ6Y | Vanilla cupcakes ✔ (The cookbook, 3:54) | **None.** No manual or auto tracks, language unset | Description: ingredients, yield 18–20, notes, one method line ("preheat 10 min… 180 C for 20–25 min"). **No method steps.** |
| 2 | TYZNzCnNGwA | Pumpkin pancakes ✔ (This Crazy Kitchen, 4:18) | auto `en-orig`, English | Description: ingredients only |
| 3 | Oa2s0dklrRo | **Kadhi Pakora**, not croissant ✘ (Kunal Kapur, 6:21) | manual `en`, English | Description: KADI / PAKORA / TEMPERING groups, plus a link to chefkunalkapur.com/recipe/kadi-pakoda/ (blog leg, same site as dal-makhni) |
| 4 | OzdqThvpMko | **Croissant**, not kadi pakoda ✘ (Liza's Delicious recipes, 8:03) | manual `en`. ~55 manual tracks, so likely a no-voice video with uploader-written subtitles | Description: ingredients plus "Bake 190°C 20–25 min" |
| 5 | FU1ZVLMbWjA | Chole Bhature ✔ (CookingShooking Hindi, 13:14) | auto `hi-orig`, Devanagari ASR | Description: Roman-Hinglish ingredients in 3 groups (chole / bhature / chole masala) |

- **Links 3 and 4 are swapped** relative to your list. The dishes are right; only the order is wrong.
- **Kadhi pakora is not Hindi input.** Captions are manual English and the blog is English.
  Only chole bhature exercises Hindi ASR. The "aadha ghanta / dedh ghanta / tak" measurement
  can only land there.
- **Cupcakes has no method source.** With no captions, no blog and no method in the
  description, the import will most likely return Tier 0 (`no_recipe_found` via
  `normalize().tier0_result`, `import_pipeline.py:349-360`) or a thin 1–2 step plan. A Tier-0
  result has no steps to replay, so it can't be a replay golden. See Q1.
- Current Hindi duration handling: `graph.py:633` (ghanta/घंटा units), `:641` (pehle/पहले lead
  markers). Nothing handles आधा/aadha, डेढ़/dedh or तक/tak. These are measured, not fixed.

## Step B — plan

### B0. Setup (on approval)
- `git worktree add C:\Users\ashya\Music\abc-cook-corpus -b test/golden-corpus-widen origin/main`
- Save this plan to `docs/plans/golden-corpus-widen.md`, then run `npm ci` in `apps/web`.
- Show `git worktree list` and the first 10 lines of the plan. **STOP.**

### B1. Capture (live spend) → HARD STOP
- Command, run from the worktree with `--env-file` / `.env` loaded:
  `python apps/api/scripts/effort_ab.py --out <scratch>/corpus-capture --arms medium --n 1 --budget-inr 20 --workers 2 <5 URLs>`.
  `medium` is the production effort. It reuses the existing script, so no new capture code.
- **LLM calls:** 5 extraction calls (GPT-5-mini), plus at most 1 Sonnet repair per recipe
  that fails validation. Worst case is 10 calls.
- **Cost:** about ₹2–2.5 per recipe, ₹3–3.5 if repair fires (measured, `effort_ab.py:84-88`).
  Expect ₹10–13 for all five, capped hard at ₹20. Chole (13 min of Hindi ASR) is the most
  likely to cost more.
- Outputs stay in the scratchpad (`<slug>.raw.json`, `…call0.normalized.json`,
  `call1` if repaired, `result.json`, `results.json`). **Nothing is written into the worktree.**
- **Replay fixture = the NormalizedRecipe that produced the shipped graph.** That is call0 if
  no repair ran, otherwise the repair output. Whether repair fired is recorded in the report.
- The offline replay must reproduce `result.json`'s graph/plan exactly. If it doesn't, that
  is flagged.
- **HARD STOP** after capture. Report the tier, cost, repair and degraded status per recipe.

### B2. Review report (offline, ₹0) → HARD STOP
- `<scratch>/corpus-review.md`, one section per recipe, in prose and tables, not JSON:
  - Steps in cooking order: label, duration with stated vs estimated (provenance), attention, station.
  - Dependency edges in plain words ("Fry pakoras needs: batter rested, oil hot").
  - Meanwhile windows: the host, then "Start with: …", then the rest, with capacity and slack.
  - Outline lines from `deriveCookOutline`: stretches, waits, the plan-ahead card ("Start ~X
    before you eat"), and the CTA subline. Produced by a throwaway Vitest spec over
    scratch-exported plan-responses. It is deleted afterwards, never committed.
  - Warnings, degraded status and `review_recommended`.
  - **Possible wrong advice** flagged per recipe, for example parallelism that isn't safe,
    an overnight soak placed wrongly, or a fried step inside a window.
- Cross-cutting measurements, from a scratch script that imports production functions read-only:
  - **F7:** every step or source sentence that matches `after|once` within 3 words before
    `for N`. For each, show what the duration became (stated or estimated) and what the
    source says.
  - **fix-3 drops:** re-schedule each graph with `_drop_tasks_with_unclaimed_ancestors`
    replaced in memory (monkeypatched, inside the scratch script only) by identity, then diff
    the windows. Report each dropped task, and flag any window that vanished entirely (F2).
  - **Long waits:** each session break, the sitting count, and how "Start ~X before you
    eat" reads. Focus on the chole overnight soak, the bhature dough rest and the croissant
    chills, folds and proofs.
  - **Hindi** (chole): occurrences of आधा/aadha, डेढ़/dedh, घंटा, तक/tak, पहले and Hindi
    number words in the captions, and what each became.
- **HARD STOP** for owner review.

### B3. Freeze (after review; approved recipes only)
Commits on `test/golden-corpus-widen`:
1. `docs(plans): golden corpus widen plan`. This is the plan file only. It may be folded
   into B0's state; it is committed here.
2. `test(fixtures): capture <approved slugs> import replays`. Adds the `<slug>.raw.json` and
   `<slug>.normalized.json` pairs to `tests/fixtures/import/`. Slugs: `vanilla-cupcakes`,
   `pumpkin-pancakes`, `kadhi-pakora`, `croissant`, `chole-bhature`.
3. `test(extract): replay the widened corpus offline`. New
   `apps/api/tests/test_corpus_replay.py`, parametrized over the slugs:
   - build → `validate()==[]` → schedule → stage_spans → summarize.
   - Compare against a frozen `<slug>.replay-expected.json`: node labels and edges, each
     node's duration plus stated/inferred, windows with their assigned order, totals and
     sessions. On a diff, the test fails with a readable message that this is a product
     decision (same rule as `test_schedule.py`).
   - Plus 1–3 named assertions per recipe for the specific advice the owner approved.
4. *(If Q3 = yes)* `test(web): export approved replays as web fixtures`:
   - `export_web_fixtures.py`: `IMPORT_REPLAYS` becomes `{slug: source_url}` so each replay
     carries its own URL. Pizza keeps its current youtu.be value, so its fixture stays
     byte-identical. Verified by `git diff`.
   - Re-export, add the `quantityLine.golden.json` entries (documented exception, like
     sabudana), and add `cookOutline.test.ts` cases pinning each recipe's reviewed outline lines.
   - A recipe that breaks an existing all-fixtures invariant stays API-only and gets logged.
5. `docs(plans): log corpus follow-ups`. Every wrong output and the F7/F2/Hindi measurements
   go into `docs/plans/followup-golden-corpus.md`. A recipe whose output is wrong is not
   frozen as a golden. It is recorded there instead, with its scratch raw/normalized path.
- **HARD STOP before push.** Push and PR only on approval. Never to main.

### Verification
- `pytest apps/api/tests` (all of it, including `test_extract_replay.py`, `test_schedule.py`,
  `test_postprocess_version.py`, `test_web_fixture_stamp.py`).
- `ruff` and `mypy --strict` as usual.
- `npx vitest run` in apps/web.
- `git diff origin/main -- apps/api/abc_cook` must be empty.
- The pizza plan-response must be byte-identical.
- Each commit is checked in a clean worktree (staging lesson).

## Owner decisions (2026-10-16) — these override anything above that conflicts

1. **Cupcakes:** spend the call. The report states whether it refused (Tier 0) or produced
   steps. If it produced steps, flag every step not grounded in the description as possible
   invented advice. No 6th video.
2. **Slugs by actual dish:** `kadhi-pakora` = Oa2s0dklrRo, `croissant` = OzdqThvpMko.
3. **Export approved recipes to web `__fixtures__`** (B3 commit 4 is in). The feed is untouched.
4. **Snapshot + named assertions.** No auto-update flag. Regeneration happens only through a
   documented script/command (`PYTHONPATH=apps/api python apps/api/scripts/<regen script>`,
   documented in the test module docstring). The failure message says a diff is a product
   decision, not a test fix.
5. **Single stop:** capture, then build the ₹0 review report, then HARD STOP. If capture
   fails or would exceed the ₹20 cap, stop immediately and report. This replaces the
   separate B1/B2 stops above.
6. **Fixture form changed:** the replay fixture is the `ImportOriginal` from each
   `result.json`'s `original` field (`schema/normalized.py:385`). It carries the pre-repair
   `recipe`, the applied `repair`, `source_text` and `raw_title`. Saved as
   `tests/fixtures/import/<slug>.original.json`, plus `<slug>.raw.json` for reference.
   - The corpus test replays through `extract/postprocess.py::reprocess(original)`, the
     production refresh path, which takes no adapter and makes no LLM call.
   - The replay must equal `result.json`'s graph/plan exactly. The frozen snapshot is then
     taken from that output.
   - This replaces the "call0 or repair output NormalizedRecipe" rule in B1 and the
     `<slug>.normalized.json` naming in B3 commit 2.
   - `export_web_fixtures.py` gains an `ImportOriginal` replay path for these slugs. Pizza
     keeps its `build_graph` path and stays byte-identical.
   - **Guard:** after the *first* capture, check that `result.json` contains `original`. If
     it is missing (because the effort_ab path bypasses it), STOP and report before
     capturing anything else. To make that check possible, captures run one URL at a time
     (`--workers 1`, first URL alone).
7. **Every script runs with `PYTHONPATH=apps/api`.**

## Owner decisions after the B1/B2 review (2026-10-16)

Capture result: pumpkin (repaired), cupcakes, kadhi, croissant produced plans; chole hit Tier 0 (reasoning
16000 = output 16000). Total spend INR 9.09 (plus INR 7.72 discarded from a first run with an invalid
Anthropic key).

- **Frozen goldens (B3):** `kadhi-pakora`, `croissant`, `pumpkin-pancakes`. Fixture = `<slug>.original.json`
  + `<slug>.raw.json`. Each `<slug>.replay-expected.json` carries `known_issues` (follow-up ids) so a fix that
  changes a flagged node is an expected diff. Named assertions pin only advice that is right.
- **Known-wrong, no golden, no web export:** `known-wrong/vanilla-cupcakes.{raw,original}.json`,
  `known-wrong/chole-bhature.raw.json`, and a README stating what each shows.
- **Web export** of the three goldens, with `quantityLine` golden entries and `cookOutline` cases; pizza stays
  byte-identical. A recipe that breaks an all-fixtures invariant stays API-only and is logged.
- **Follow-ups:** `docs/plans/followup-golden-corpus.md`, numbered FGC-n with priority.
