# PR-B3 implementation plan: an unattended node's start ends a hands-free gap

**Status:** approved by the owner 2026-10-15. Implemented on this branch. Implement it in a fresh session, on branch `fix/unattended-start-b3` in the worktree `abc-cook-pr-b3`.

**Spec:** `docs/plans/pr-b3-unattended-start.md`. That file lives on R2's branch and PR #51, worktree `../abc-cook-r2`. **Do not add it to this branch**, to avoid a conflict. This file is the implementation plan and does not depend on that file being present. §3 below replaces the spec's "Risk" paragraph.

**Rules:**
- HARD STOP at step 4 (§8), before any golden, pin or web fixture changes.
- No commit and no push until the owner reviews.
- The PR body is written later to a UTF-8 file, sent with `gh pr create --body-file`, and read back afterwards.

---

## 1. Context

`apps/api/abc_cook/schedule/summary.py` splits the timeline into **sessions** and **phases** at gaps:
- **Sessions** split on the cook-occupied timeline: `hands_on` nodes, threshold `SESSION_BREAK_MIN` = 120.
- **Phases** split on the attended timeline: `hands_on` + `periodic` nodes, threshold `PHASE_BREAK_MIN` = 45.
- **`long_waits`** are occupied-timeline gaps where `LONG_WAIT_MIN` (45) ≤ gap < 120.

An `unattended` node counts as needing nobody, including at its start, and `_partition` attributes a node that starts inside a gap to the preceding stretch.

That is wrong for an unattended node that starts **later, inside the gap**: someone has to be there to start it. Pizza:

| Node | Attention | Scheduled | Needs the cook at its start? |
|---|---|---|---|
| Cover and refrigerate overnight | unattended | 290–1370 | yes, at 290 (on the stretch edge) |
| **Remove the dough** (1 hr before) | unattended | **1370**–1430 | **yes: take the dough out of the fridge** |
| **Place a pizza stone** (preheat) | unattended | **1430**–1440 | **yes: stone in, oven on** |
| Lightly flour a pizza peel | hands_on | 1440– | yes |

Today the summary says the gap runs 290 → 1440 (1150 min). R2 renders that as "Come back ~19 hr later". The cook comes back about 70 min after the dough should have left the fridge, and the oven is cold. CLAUDE.md § Principles: approximate timing is fine; wrong advice is not.

## 2. Owner decisions (settled; do not reopen)

- **Rule:** an `unattended` node that starts strictly inside a gap makes its start instant attended, in **both** the phase and the session partition. `test_every_session_boundary_is_a_phase_boundary` must keep passing.
- **Footprint:** zero length (option a). R2 omits the time for a stretch whose `elapsed_min` and `elapsed_high_min` are both 0.
- **Stretch edges:** a node starting exactly at a stretch edge is unaffected. Examples: Cover the bowl @10, Cover and refrigerate @290.
- **POSTPROCESS_VERSION** bumps 3 → 4.
- **Merge order:** PR-B3 (and PR-B4) merge before R2 (PR #51).

## 3. Code change: `apps/api/abc_cook/schedule/summary.py` only

1. **New helper**
   ```python
   def _hand_started_ids(nodes: dict[str, Node], by_start: list[ScheduledNode],
                         occupied: list[list[float]]) -> set[str]:
   ```
   - Returns every `unattended` node whose `start_min` lies strictly inside an interior gap of the merged cook-occupied intervals: `occupied[i][1] < start < occupied[i+1][0]`.
   - Leading and trailing time is ignored, because the outer edges already widen to `0`/`total_min`.
   - **One set serves both partitions.** Occupied is a subset of attended, so a start inside an attended gap is always inside an occupied gap. A start inside a periodic run merges into that run on the attended timeline and changes nothing there.
   - Because the same points enter both partitions, every session boundary stays a phase boundary.
2. **`summarize()`:**
   - `start_points = [(s.start_min, s.start_min) for s in by_start if s.node_id in hand_started]`
   - `occupied = _merge(<hands_on intervals> + start_points)`. `idle_gaps`, and therefore `long_waits`, come from this augmented list.
   - `attended = _merge(<attended intervals> + start_points)`.
   - Both `_partition` calls get `start_only_ids=hand_started`.
3. **`_partition(..., start_only_ids: set[str])`:**
   - The slow-timeline footprint also counts `start_only_ids` nodes, as the zero-length `(slow.start_min, slow.start_min)`. Every other node is counted as before.
   - This step gives pizza's last sitting `elapsed_high_min` 116 rather than a clamped 100.
   - It also gives the (1370,1370) phase 0/0 rather than 0/60.
4. **Docstrings:**
   - `_cluster_index`: a hand-started node belongs to the stretch its own start creates. A wait that starts on a stretch edge still belongs to the stretch that began it.
   - Module/`summarize` docstrings: one sentence naming the rule.

There is no schema change, so `make types` and TS regeneration are not needed.

A working prototype of exactly this logic was run in the planning session; its results are in §4–§5. Re-derive the code from this description; the prototype is not in the repo.

## 4. "Only pizza changes": run results (planning session, 2026-10-15)

I ran the prototype over every `apps/api/tests/fixtures/*.graph.json` plus the pizza import replay (`_pizza_graph()`), comparing `sessions`, `phases`, `long_waits` and the top-level numbers field by field:

| Fixture | Hand-started nodes found | Summary |
|---|---|---|
| chicken-biryani, homemade-donuts, kadai-paneer, maggi-2min, sabudana-khichdi, synthetic-two-sittings, synthetic-two-windows | none | unchanged |
| **strawberry-shortcake** | `cool_shortcakes` @24, inside the occupied gap 11→34 (23 min, below every threshold) | **unchanged** |
| **pizza-dough** | `step_remove_the_dough_1_hour_before` @1370, `step_place_a_pizza_stone_or_inverted` @1430 | changed (§6) |

**Why the rest cannot change:** a point inside a gap shorter than the threshold cannot change clustering, because both halves are smaller still. Output changes only when the gap holding the point is at least the threshold. The spec's fixture scan missed shortcake because it only checked phase and session gaps. Shortcake qualifies, but it is harmless; a test pins it (§5).

**Web export:** I ran the real `apps/api/scripts/export_web_fixtures.py` into scratch, once with the old `summarize` and once with the new.
- Every committed web fixture matches the old export in content; only line endings differ (see §9).
- With the new `summarize`, only `pizza-dough.plan-response.json` differs, and only inside `summary`.
- `graph`, `plan` and `stages` are identical.

**API goldens:** no `apps/api/tests/fixtures/*.plan.json` carries `summary`, `sessions` or `phases`, and `plan.*` is unchanged. Confirm in step 3 that `test_schedule.py` stays green.

## 5. Risk shapes (replaces the spec's §3 "Risk" paragraph)

The spec claimed a spurious point "only changes output when both resulting gaps are ≥ the threshold". **That is wrong.** Any hand-started point inside a gap of at least the threshold changes the output, in one of three shapes. "Spurious" means the second node of an unattended chain that genuinely needs no hand.

I confirmed each shape on synthetic chains (`hands_on`/`unattended` minutes, phase T = 45):

| Shape | Chain | Before | After |
|---|---|---|---|
| **Split** (both halves ≥ T) | a5 → bake60 → rest60 → b5 | phases (0,5) (125,130); 2 sessions (120-min break); no long_waits | phases (0,5) **(65,65)** (125,130); **1 session (0,130)**; long_waits 5–65 [bake], 65–125 [rest] |
| **Erase** (both halves < T) | a5 → bake30 → rest30 → b5 | phases (0,5) (65,70); long_wait 5–65 [bake, rest] | **one phase (0,70); no long_wait** |
| **Shift** (one half each side of T) | e.g. a5 → bake30 → rest60 → b5 | break 5–95 | the earlier stretch extends to the point (35); the break becomes 35–95 |

Each shape has a different consequence:
- **Erase** removes a "you can leave" callout.
- **Split** can merge two sittings into one.
- **Shift** shortens a stated wait.

In every case the plan errs toward "be here". That is imprecise in the safe direction, so it is consistent with § Principles. No current fixture has these shapes; pizza is a true positive, not a spurious one.

The upstream mitigation is unchanged: extraction emitting "Remove the dough" as a short `hands_on` step (PR-D / prompt v8). The summary rule stays as a guard.

## 6. Every expected-value change (before → after)

### 6a. API pins in `apps/api/tests/test_summary.py` (pizza)

These stay unchanged: `plan.total_min` 1470, `summary.elapsed_high_min` 1493, `active_min` 35.

| Field | Before | After |
|---|---|---|
| sessions spans | (0,10) (280,290) (1440,1470) | (0,10) (280,290) **(1370,1470)** |
| sessions active_min | 5, 10, 20 | 5, 10, 20 |
| sessions preceded_by_wait_min | None, 270, 1150 | None, 270, **1080** |
| sessions (elapsed, elapsed_high) | (10,12) (10,15) (30,46) | (10,12) (10,15) **(100,116)** |
| sessions[2] preceded_by_host_node_ids | [refrigerate, remove, stone] | **[refrigerate]** |
| sessions[1] node_ids | transfer, refrigerate, remove, stone | transfer, refrigerate |
| sessions[2] node_ids | flour … transfer_pizza (6) | **remove, stone,** flour … transfer_pizza (8) |
| long_waits | [] | **[{1370, 1430, idle 60, [remove]}]** |
| phases spans | (0,10) (280,290) (1440,1470) | (0,10) (280,290) **(1370,1370) (1430,1470)** |
| phases preceded_by_wait_min | None, 270, 1150 | None, 270, **1080, 60** |
| phases starts_new_session | F, T, T | F, T, T, **F** |
| phases (elapsed, elapsed_high) | (10,12) (10,15) (30,46) | (10,12) (10,15) **(0,0) (40,56)** |
| phases active_min | 5, 10, 20 | 5, 10, **0, 20** |
| phases hosts [2] / [3] | [refrigerate, remove, stone] | **[refrigerate] / [remove]** |
| phases node_ids [2] / [3] | flour … (6) | **[remove] / [stone, flour … (6)]** |

The full node ids are `step_remove_the_dough_1_hour_before`, `step_place_a_pizza_stone_or_inverted` and `step_cover_and_refrigerate_overnight_18_hours`.

API golden `*.plan.json` files: **no change**.

### 6b. Web fixture `apps/web/src/__fixtures__/pizza-dough.plan-response.json`

The same `summary.sessions`, `summary.phases` and `summary.long_waits` changes as 6a, and nothing else: about +41 / −22 lines, all inside `summary`.

### 6c. Web test expectation on main

From a Vitest run against the new fixture: 652/653 pass, and one expectation changes.

| Test | Before | After |
|---|---|---|
| `apps/web/src/lib/duration.test.ts` › headerTiming — every shipped fixture › pizza-dough, `primary` | `'30–50 min'` | `'1 hr 40 min – 2 hr'` |
| same, `secondary` | `'Start about a day before you eat'` | unchanged |

Everything else passes unchanged, including:
- `select.test.ts` row 30 (nextRequiredAt 1370);
- the `viewModel.test.ts` pizza sitting_break tests;
- the `derive.test.ts` "no wait row for pizza" test.

The new header range honestly includes the dough's hour on the counter.

## 7. Tests (`apps/api/tests/test_summary.py`)

### Existing pins (change only after the HARD STOP is cleared)

- `test_pizza_is_a_three_sitting_recipe`: update to 6a. The name still holds: 3 sittings.
- `test_pizza_phases_equal_sessions` becomes `test_pizza_phases_refine_sessions`, because pizza now has 4 phases and 3 sessions. It asserts:
  - phase spans `[(0,10),(280,290),(1370,1370),(1430,1470)]`;
  - `starts_new_session == [F,T,T,F]`;
  - the (1370,1370) phase has `elapsed_min == elapsed_high_min == 0` (the contract R2's hide rule relies on).

### New tests

All use a generic `_chain_graph(spec: list[tuple[str, str, int]])` helper next to `_gap_graph`, built the same way: linear deps, `station` counter for hands_on and none otherwise.

- `test_pizza_unattended_starts_end_the_overnight_gap`:
  - sessions/phases `preceded_by_wait_min` 1080 then 60;
  - hosts `[refrigerate]` and `[remove]`;
  - `long_waits == [1370–1430, 60, [remove]]`;
  - `remove` and `stone` are not in sitting 2's `node_ids`.

  Add this after the HARD STOP, together with the pin updates.
- `test_unattended_start_on_a_stretch_edge_is_unaffected`:
  - chain a5 → rise60 → b5 → bake60 → c5;
  - phases (0,5) (65,70) (130,135), with `rise` in phase 1 and `bake` in phase 2;
  - long_waits 5–65 [rise] and 70–130 [bake];
  - one session (0,135).
- `test_unattended_start_inside_a_gap_applies_to_both_partitions`:
  - chain a5 → chill1080 → out60 → b5;
  - sessions (0,5) (1085,1150);
  - phases (0,5) (1085,1085) (1145,1150), where the 1085 phase has `starts_new_session=True` and the 1145 phase has False;
  - long_wait 1085–1145 [out].
- `test_spurious_start_point_splits_a_long_gap`: §5 Split, with exact values from the table. The docstring names it as the accepted risk.
- `test_spurious_start_point_can_erase_a_phase_break`: §5 Erase.
- `test_start_inside_a_short_gap_changes_nothing`: strawberry-shortcake. `cool_shortcakes` starts inside a 23-min gap; its phases are one (0, total), there are no long_waits, and there is one session.

`test_every_session_boundary_is_a_phase_boundary` and `test_phases_cover_every_node_once_and_are_ordered` must stay green unchanged.

## 8. Execution order

1. **Code.** Edit `summary.py` per §3. Bump `POSTPROCESS_VERSION` (§10).
2. **Tests.** Add the five new tests that need no fixture or pin change: edge, both-partitions, Split, Erase, shortcake.
3. **Run:**
   - `PYTHONPATH=apps/api pytest apps/api/tests/test_schedule.py apps/api/tests/test_summary.py apps/api/tests/test_postprocess_version.py`. The expected failures are **exactly** `test_pizza_is_a_three_sitting_recipe` and `test_pizza_phases_equal_sessions`.
   - `ruff check apps/api` and `mypy --strict apps/api/abc_cook/schedule`.
4. **HARD STOP.** Show the owner:
   - (a) the real pytest failure output for the two pizza pins;
   - (b) a `git diff --no-index` of the committed pizza web fixture against a scratch export from the implemented code, written to the scratchpad and not to `apps/web`;
   - (c) a side-by-side against §6.

   Do not touch pins, fixtures, `duration.test.ts` or docs until the owner approves.
5. **After approval:**
   - Update the two pizza pins and add the pizza test (§7).
   - Regenerate the web fixture (§9 line endings). Update the `duration.test.ts` pizza row (6c).
   - Update the docs (§11).
6. **Verify** (§12) and run the saved-recipe trace (§13). Report the R2 follow-up list (§14). **Stop for owner review.** No commit and no push.

## 9. Environment notes

- **Python:** always `PYTHONPATH=apps/api`. The editable install points at main's checkout, not this worktree.
- **`make types`** fails in worktrees. It isn't needed here (no schema change).
- **`npm ci` in `apps/web` of this worktree is pre-approved.** The worktree has no `node_modules`. Planning ran Vitest in a scratch copy with a junction to the main checkout's `node_modules`. Don't repeat that; use `npm ci`.
- **Web fixture line endings.**
  - `.gitattributes` sets `* text=auto eol=lf` and `*.json text eol=lf`.
  - The index holds the fixtures as LF (`git ls-files --eol` → `i/lf w/lf attr/text eol=lf`).
  - `core.autocrlf=true` in this checkout.
  - `export_web_fixtures.py` writes through Python `write_text`, which emits CRLF on Windows, and it **rewrites all 11 fixture files**.

  Git normalizes CRLF→LF on add, so content-identical files should not show as modified. Still, after regenerating:
  - run `git status` and `git diff --stat`. Only `pizza-dough.plan-response.json` may appear.
  - If any other fixture shows up, restore it with `git checkout -- <file>`.
  - Confirm `git diff` for pizza shows only `summary` hunks, with no whole-file line-ending churn.
  - Confirm `git diff --cached` after `git add` stays summary-only, and `git ls-files --eol` still says `i/lf`.
- **The scratchpad** is for every throwaway export or diff. Never write experiments into `apps/`.
- **Junction hazard:** if you ever junction `node_modules` into scratch, remove it with `cmd /c rmdir`. Never use a recursive delete; it would follow into the main checkout.

## 10. POSTPROCESS_VERSION: 3 → 4

The bump is required for two reasons:
- `tests/test_postprocess_version.py` hashes every `schedule/*.py`, so it fails until the bump.
- It does real work: `extract/import_pipeline.py` (~l.493) stores `summarize()` output in the cached `ImportResult`. Without the bump, a cached pizza import keeps serving the 1150-min gap.

Steps:
1. In `apps/api/abc_cook/extract/cache.py`, set `POSTPROCESS_VERSION = 4`.
2. Run `PYTHONPATH=apps/api python apps/api/tests/test_postprocess_version.py` to print the new hash.
3. **Append** `"4": "<hash>"` to `apps/api/tests/fixtures/postprocess_versions.json`. Never edit or reorder entries 1–3.
4. Re-run the test.

The bump invalidates only the server result cache. Plans already saved on a device are §13.

## 11. Docs: `docs/COOKING_GRAPH.md` §4

In the Session/Phase section, after the Phase "Node attribution" bullet, add one paragraph covering:
- **The rule:** an `unattended` node starting strictly inside a gap makes its start instant attended for both partitions.
- **The footprint:** zero length, so a stretch can have `elapsed_min` 0.
- **The edge exemption.**
- **Attribution:** the node belongs to the stretch its start creates.
- **The pizza example:** 290→1440 becomes 290→1370 (sitting break) plus 1370→1430 (long wait).
- **The §5 risk shapes**, in one or two sentences.

The existing sentence "on every current fixture each session boundary is also a phase boundary" stays true; keep it.

Nothing goes into `docs/plans/pr-b3-unattended-start.md`. That file is R2's, and the owner will reconcile it.

## 12. Verification

- The pytest trio, `ruff`, and `mypy --strict apps/api/abc_cook/schedule`.
- Full `PYTHONPATH=apps/api pytest apps/api/tests`, to catch replay or cache tests touching the summary.
- `cd apps/web && npm ci && npx vitest run`: all green, with only the 6c expectation changed.
- **Re-scan all web fixtures.** No `unattended` node may start strictly inside any phase gap, session gap or `long_waits` interval. A start inside a sub-threshold occupied gap, like shortcake's, is allowed.
- `git status`: only the planned files changed. Those are `summary.py`, `cache.py`, `postprocess_versions.json`, `test_summary.py`, `pizza-dough.plan-response.json`, `duration.test.ts`, `COOKING_GRAPH.md` and this file.

## 13. Saved recipes: trace during implementation (report, propose, don't implement)

Trace saved-recipe storage end to end:
- `apps/web/src/library/`, plus whatever it persists: localStorage/IndexedDB shape and server rows, if any;
- what is stored on save;
- what is read on reopen, for both the Plan tab and Cooking mode.

Report whether a pizza saved **before** this change still shows the old `summary` (the 1150-min gap) after deploy.
- If it does, **propose** a fix without implementing it. Options include: store the graph and recompute the plan and summary on open; a version stamp on the saved payload that triggers a refetch; or a server re-summarise endpoint.
- Also state whether re-importing the same URL is enough. Consider that the cache bump forces a fresh post-process, and whether re-import replaces the saved entry or creates a duplicate (source-key dedup).

Planning found no `summary` reference in `apps/web/src/library/*.ts` (non-test), but did not trace further. Don't take that as the answer.

## 14. R2 (PR #51) follow-up: pins that move after this merges

From reading R2's branch (`../abc-cook-r2`, HEAD 566fb1e). R2 must rebase on PR-B3, and these will then need updating. Verify by running R2's Vitest after the rebase; the list below is what reading suggests, not a run.

| File | Test | Why it moves |
|---|---|---|
| `apps/web/src/plan/cookOutline.test.ts` | `'pizza'` | Stretches go 3 → 4, adding a zero-length "Remove the dough" stretch with `time` null and a last stretch with a new range. Waits go `['Come back ~4 hr 30 min later','Come back ~19 hr later']` → roughly `['… ~4 hr 30 min …','… ~18 hr …', <~1 hr long-wait copy>]`, and `barLabel`s change to match. `ctaSubline` "Then 2 more stretches" becomes 3. The card title "spans 3 sittings" should hold; check the card body "~25 hr". |
| same | `'O2: a zero-length stretch has no time'` | It mutates `phases[1]` to zero length by hand. Pizza's `phases[2]` is now naturally zero length, so this test can assert on the real fixture. It still passes as written, but should be simplified. |
| same | `'O1: N sittings is summary.sessions.length …'` | It hand-builds "four stretches in three sittings" by splitting `phases[2]`. That is now the real fixture's shape: `phases[2]` is the single-node zero-length stretch, so `slice(3)` empties it and `phases.length` becomes 5, and the `toBe(4)` fails. Rewrite it on the natural fixture. The one-sitting branch's "the longest ~19 hr" becomes ~18 hr. |
| `apps/web/src/plan/headerMeta.test.ts` | multi-sitting pizza cases | Probably unchanged: it asserts null/non-null and `/^Start about/`. Confirm. |
| `apps/web/src/lib/duration.test.ts` | headerTiming pizza row | The same change as 6c (`'1 hr 40 min – 2 hr'`). R2's added `[1150, '19 hr']` row is a pure-number `approxWaitPhrase` case and is unaffected. |
| `apps/api/tests/test_summary.py` | `test_pizza_phases_equal_sessions` (if R2 carries it) | Superseded by `test_pizza_phases_refine_sessions` here. Take PR-B3's version in the rebase. |

R2 open item O1 ("sittings = 3, not 4") must be settled against the new shape: 4 phases in 3 sessions.
