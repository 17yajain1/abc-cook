# PR-B4: wait-window task order — implementation plan

## Context

`rank_in_window` can list a task before one it depends on. On sabudana-khichdi, the Plan
tab says **Start with this → Grind peanuts**, then Roast peanuts. Grind depends on Roast,
and the scheduler itself runs Roast at minute 5 and Grind at minute 10. A cook following the
card would grind unroasted peanuts. The owner decided on 2026-10-14
(`docs/plans/followup-window-task-order.md` on `feat/recipe-header-r2`) that the fix goes in
the scheduler, as its own PR with surfaced golden changes, merged **before R2 (#51)**.

**Rank rule (owner's choice, 2026-10-15): start order.** A window's tasks are ranked by
their scheduled `start_min`, with `node_id` breaking ties. The scheduler has already
computed these times.

## Setup (run after plan approval, before writing the doc)

1. Run `git fetch origin`. The local `origin/main` is stale at e8f1527. Remote main is
   20db764, the merge of PR #52, which is MERGED. Confirm with
   `git log origin/main --oneline --grep="unattended start inside a gap"`.
2. `git worktree add ../abc-cook-pr-b4 -b fix/window-task-order-b4 origin/main`
3. In `../abc-cook-pr-b4/apps/web`, run `npm ci`. Python commands use
   `PYTHONPATH=apps/api`. `make types` fails in worktrees, but this PR doesn't need it
   because the schema doesn't change.
4. Save this plan as `docs/plans/pr-b4-implementation.md` in the B4 worktree.
5. Write `docs/plans/followup-window-unclaimed-dependency.md`. It covers the shape, why
   "Start with" misleads, the reproducing graph from §3, and the direction: an ownership
   change, not a rank change. It is a plan only.
6. Record the R2 grep result in §7. **Stop. Don't commit.**

## 1. Root cause (exact code path)

- `apps/api/abc_cook/schedule/scheduler.py:294-320`: ownership walks the tasks that ran
  inside the host interval in §4.4 key order (`-duration_typical, node_id`) and appends the
  claimed ones to `window.assigned`.
- `scheduler.py:318` → `rank_window_tasks(graph, window)` (`schedule/ranking.py:9-30`)
  **re-sorts by the same key, `(-duration_typical, node_id)`**, without looking at
  `depends_on` or at the timeline.
- `scheduler.py:327-329` writes `rank_in_window = index in assigned`.
- On the web side, `derive.ts:347` maps `window.assigned` to `tasks` in that order, and
  `WaitWindowBlock.tsx` promotes `tasks[0]` as "Start with this".
- Sabudana has Grind (5 min, `step_coarsely_grind…`) and Roast (5 min, `step_dry_roast…`)
  tied on duration, so `node_id` decides: `step_c…` sorts before `step_d…`, and Grind ranks
  0.
- Why the timeline is right and the rank is wrong: §4.1.c applies the same key only to the
  tasks that are **ready**. Ranking applies it to all of them, ready or not.

## 2. The fix and why it is generic

`rank_window_tasks` returns `window.assigned` sorted by `(start_min, node_id)` from the
finished timeline. The signature becomes
`rank_window_tasks(window: WaitWindow, start_of: Mapping[str, float]) -> list[str]`, still
pure, and `scheduler.py:318` passes `{s.node_id: s.start_min for s in scheduled}`.

- **Why every dependency is respected.** A hands-on consumer starts at or after its
  dependency ends: `dep.start + dep.duration_typical`, and `duration_typical > 0` by
  invariant 7 (`extract/validate.py:258`). So any ancestor, direct or transitive, inside the
  window or outside it, has a strictly earlier `start_min`. No recipe names, node ids or
  fixture knowledge are involved.
- **What it fixes beyond the sorting bug.** Rank 0 is always a task that can actually start
  first. That holds when a task's blocker is outside the window (an unattended soak that
  ends mid-window), a freshness hold, a pan-chain gate, or station contention. A pure
  dependency sort would still say "Start with" a task that's waiting on an outside soak; a
  synthetic run confirmed this.
- **Unchanged:**
  - The §4.1.c pick key, so the timeline doesn't change and no `start_min`, `total_min` or
    `saved_min` moves.
  - §4.4 ownership walk order and both of its gates, so window membership,
    `used_min`/`slack_min`, and which window owns which task are all unchanged.
  - When no readiness constraint applies, start order equals the old key order, because the
    in-window pick used that same key. Ties on `start_min` can't happen for hands-on tasks
    (one cook), and `node_id` is kept as a deterministic tie-break anyway.
- **Docs:**
  - `ranking.py` docstring.
  - `COOKING_GRAPH.md` §4.4 step 3: "Same key" becomes "timeline order (`start_min`, then
    `node_id`); rank 0 is the first task the cook actually starts". Keep the "longest first"
    rationale under step 1 (pick order).
  - The `scheduler.py:285` comment.
  - The schema field text already says "in the order the cook should do them", so there's
    no schema edit and no `make types`.

## 3. Edge cases

- **Transitive dependencies through a node outside the window** (A → unattended B → C):
  covered by the start-order argument above.
- **Dependencies across windows:** rank is per-window, and start order is globally
  consistent, so it can't contradict itself.
- **Ties:** not possible between hands-on tasks with positive duration. `node_id` is the
  deterministic fallback.
- **Zero durations:** invalid per invariant 7. The scheduler requires a validated graph (its
  docstring says so).
- **Cycles:** impossible, because the graph is validated acyclic (§5). Start order needs no
  graph walk, so cycles can't make it loop anyway.
- **Pre-existing gap, out of scope and flagged for the owner:** ownership can leave a
  dependency *unclaimed*. It can fail the capacity or `duration_max` gate, or be claimed by
  an earlier window. The window then lists only the consumer, and "Start with" names it while
  its unclaimed dependency is a serial step at that same moment. No current fixture does
  this. Fixing it means changing ownership, not rank. It is written up as a follow-up plan
  in `docs/plans/followup-window-unclaimed-dependency.md`, not implemented here.
  - **Reproduced in memory** against current code, and the same happens after B4.
  - The graph:
    - host: unattended, 14 min, capacity 12.6
    - `roast`: hands-on, 5 typical, **13 max**
    - `grind`: hands-on, 5 min, depends on `roast`
    - `chutney`: hands-on, 3 min
    - `serve`: depends on host, `grind` and `chutney`
  - The timeline: `roast` 0–5, then `grind` 5–10, then `chutney` 10–13.
  - `roast` fails the `duration_max` gate (13 > 12.6), so it stays unclaimed. The window
    becomes `[grind, chutney]` and "Start with this" names Grind, while Roast is a serial
    step during those same minutes.

## 4. Synthetic tests (pin first; they must FAIL on current code)

These go in `apps/api/tests/test_schedule.py`, in a new section "Rank follows the timeline
(PR-B4)". They reuse the `_gate_graph`/`_backfill_graph` helper style, with
`common`/`prep` dicts and a passive unattended host.

1. **Direct dependency.**
   - Graph: host unattended 30; `roast` hands-on 5; `grind` hands-on 6, depends on `roast`;
     `chutney` hands-on 3.
   - Today the rank is grind, roast, chutney. Expect `assigned == ["roast", "grind",
     "chutney"]`, with `roast.rank_in_window == 0`.
2. **Transitive dependency through an unclaimed unattended node.**
   - Graph: host unattended 30 (id sorts first); `a` hands-on 2; `b` unattended 3, depends
     on `a`; `c` hands-on 6, depends on `b`; `d` hands-on 4.
   - Expect `a` ranked before `c`. Today `c` is ranked 0.
3. **Blocker outside the window** (the case a dependency sort misses).
   - Graph: host `a_host` unattended 30; `x_soak` unattended 10; `y_long` hands-on 8,
     depends on `x_soak`; `z_mid` hands-on 3; `w_short` hands-on 2.
   - Today: `[y_long, z_mid, w_short]`. Expect `[z_mid, w_short, y_long]`. I already
     verified this in memory.
4. **Property test over every `GOLDEN` slug.** For each window:
   - (a) No task has a transitive ancestor ranked after it.
   - (b) `start_min` is non-decreasing along `assigned`.
   - (c) `rank_in_window` equals the index in `assigned`.

   Today this fails only on sabudana.
5. **Existing tests that still pass unchanged:**
   - `test_window_backfills…`: `prep_a` 0-14 and `prep_c` 28-29, so the order is the same.
   - `test_duration_max_gate…`
   - `test_api_recipes.py:103`: kadai `chop_capsicum` is rank 0.
   - `derive.test.ts:122`: kadai ranks `[0, 1, 2]` with Cube capsicum first.

## 5. Predicted golden and fixture changes

I scanned all 11 web fixtures, and re-ran all 8 API goldens plus the pizza replay and the
defaulted-servings graph in memory against current code (B3 included).

| Fixture | Windows | Order change? |
|---|---|---|
| chicken-biryani | w1 slice_onions, chop_mint_coriander, mix_marinade, soak_saffron · w2 drain_rice | no |
| homemade-donuts | w1 grease_pan | no |
| kadai-paneer | w1 chop_capsicum, cube_paneer, make_kadai_masala | no |
| maggi-2min, pizza-dough, synthetic-two-sittings, synthetic-defaulted-servings | none | no |
| strawberry-shortcake | w1 hull_and_slice_berries | no |
| synthetic-two-windows | w1 dice_potatoes, crush_spice_blend, mince_garlic_ginger, rinse_rice · w2 chop_fresh_herbs | no |
| **sabudana-khichdi** | w1 **before:** Grind (5@10), Roast (5@5), Chutney (3@15) → **after:** Roast, Grind, Chutney | **yes (the expected fix)** |

The only expected change is on sabudana, in both
`apps/api/tests/fixtures/sabudana-khichdi.plan.json` and
`apps/web/src/__fixtures__/sabudana-khichdi.plan-response.json`:
- `windows[0].assigned` is reordered.
- `rank_in_window` changes for two nodes: Roast 1→0, Grind 0→1. Chutney stays 2.

Nothing else should move: no timings, phases, summary or stages. **Any other diff is
unexpected and gets surfaced, not accepted.** Chicken-biryani w2's `drain_rice` waits on
`parboil_rice` at window open, but it is the only task in that window, so the rank is
unaffected.

## 6. POSTPROCESS_VERSION

Yes, it must bump. `schedule/*.py` is hashed by `tests/test_postprocess_version.py`.
- Change `extract/cache.py:208` from `POSTPROCESS_VERSION = 4` to `5`.
- Append `"5": "<hash>"` to `tests/fixtures/postprocess_versions.json`, never editing
  entries 1–4. The hash comes from running `python tests/test_postprocess_version.py`
  after the code is final, so it can't be predicted now.
- Side note: saved recipes in localStorage keep their old ranks. That is the same class of
  problem as `docs/plans/followup-saved-recipe-staleness.md`; this PR doesn't fix it.

## 7. Impact on R2 (draft PR #51)

- **`cookOutline.ts` / `cookOutline.test.ts`: no change.** The outline reorders by
  `start_min` (decision 8), not by `assigned`.
  - The expected `'Meanwhile: Roast peanuts, Grind peanuts'` (test line 37) already matches.
  - "orders each task line by start_min" (line 178) is unaffected.
  - The "split a window across stretches" test (line 197) uses node ids and filters by
    phase, so it is unaffected.
- **Fixed once R2 rebases onto B4:** `WaitWindowBlock.tsx` ("Start with this", `tasks[0]`)
  and the Stage card "Meanwhile:" via `meanwhileLabels` (`derive.ts`
  `window.assigned` order). Sabudana then shows Roast, Grind, Chutney, the same order as the
  outline, so the two-orders-on-one-screen conflict goes away.
- **R2 action after B4 merges:** rebase, pick up the regenerated sabudana web fixture, and
  re-run `cookOutline.test.ts`. No R2 test edits are expected.
- **Map** (`map/layout.ts:199-251`): `rankOf` is only a tie-break after `start_min`, plus
  "last shown member = max rank". For sabudana, Chutney is rank 2 both before and after, so
  I expect no Map change. Verify with `layout.test.ts`.
- Cooking mode stores `rankInWindow` (`cooking/model.ts:76`) but doesn't order by it.
- **Read-only check, 2026-10-15:** `git grep -n -i -e "grind" -e "roast"
  feat/recipe-header-r2 -- apps/web/src`, excluding `__fixtures__`.
  **No test pins Grind before Roast.**
  - `cookOutline.test.ts:37` pins `Meanwhile: Roast peanuts, Grind peanuts`, which is
    already the correct order. It is start_min-ordered, so it's unaffected.
  - `cookOutline.test.ts:200-205` moves Roast into phase 2, giving one task per stretch:
    `['Meanwhile: Grind peanuts']` and then `['Meanwhile: Roast peanuts']`. This tests
    stretch membership, not within-window order. It reads only phases and
    `window.assigned` as a set, so it's unaffected.
  - `cooking-mode/quantityLine.golden.json:69-75` is keyed by node id, so order doesn't
    matter.
  - Raw hits in fixtures: `kadai-paneer.plan-response.json` (2, unrelated text) and
    `sabudana-khichdi.plan-response.json` (36). The sabudana fixture is regenerated by B4
    and picked up when R2 rebases.

## 8. Implementation steps

1. Add synthetic tests 1–4 and run `PYTHONPATH=apps/api pytest
   apps/api/tests/test_schedule.py`. Expect tests 1–3 to fail, and test 4 to fail on
   sabudana only. The sabudana golden equality test still passes at this point.
2. Change `ranking.py` and `scheduler.py:318`, then run ruff and `mypy --strict` on
   `abc_cook/schedule`.
3. Run pytest on `test_schedule.py`. Tests 1–4 should pass, and
   `test_schedule_matches_golden_plan[sabudana-khichdi]` should now **fail**, as expected.
   Record that diff exactly.
4. Update the docs: the `ranking.py` docstring, the comment at `scheduler.py:285`, and
   `COOKING_GRAPH.md` §4.4 step 3.
5. Bump `POSTPROCESS_VERSION` to 5 and append the hash.
6. **HARD STOP.** Report the exact sabudana golden diff from step 3, plus a dry-run
   comparison of every fixture. Use a scratch script that writes to the scratchpad, not to
   `__fixtures__`. Wait for owner approval before touching any golden or fixture file.
7. *(After approval)* Regenerate the sabudana `.plan.json` and run
   `python apps/api/scripts/export_web_fixtures.py`. `git diff --stat` must show only the
   two sabudana files.
8. Run the full checks:
   - `pytest apps/api/tests`
   - `npm run test` in `apps/web` (Vitest: `derive`, `StageCard`, `layout`), plus typecheck
     and lint
   - A 390 px render of the sabudana Plan tab, showing "Start with this → Roast peanuts"
     (watch for Dark Reader)
9. Make small conventional commits, in this order:
   1. `docs(schedule):` adds `docs/plans/pr-b4-implementation.md` and
      `docs/plans/followup-window-unclaimed-dependency.md`.
   2. `test(schedule):` adds the synthetic and property tests, which fail at this commit.
   3. `fix(schedule):` changes `ranking.py`, `scheduler.py`, **`COOKING_GRAPH.md`
      §4.4**, the `POSTPROCESS_VERSION` bump, and the sabudana `.plan.json`.
   4. `test(web):` regenerates the sabudana web fixture.

   **`COOKING_GRAPH.md` goes into the fix commit, not the docs commit.** §4.4 is the spec
   the code implements, so the rule change and its spec change belong together. The docs
   commit carries only planning files. After that, push and open the PR. That's for later;
   this session stops after saving the plan.

## Critical files

- `apps/api/abc_cook/schedule/ranking.py` (the fix)
- `apps/api/abc_cook/schedule/scheduler.py:285,318` (call site, comment)
- `apps/api/tests/test_schedule.py` (new tests)
- `docs/COOKING_GRAPH.md` §4.4
- `apps/api/abc_cook/extract/cache.py:208` and
  `apps/api/tests/fixtures/postprocess_versions.json`
- After the stop: `apps/api/tests/fixtures/sabudana-khichdi.plan.json` and
  `apps/web/src/__fixtures__/sabudana-khichdi.plan-response.json`
