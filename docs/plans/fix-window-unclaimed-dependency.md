# Fix: a window lists a task whose dependency the window did not claim

Spec: `docs/plans/followup-window-unclaimed-dependency.md` (origin/main 8481963).
All evidence below comes from the **real** origin/main scheduler and web code, run from a
`git archive` snapshot in the scratchpad. The repo was not touched.

## Context

§4.4 ownership walks the hands-on tasks that ran inside a host's interval and claims each one that passes
both gates: typical packing, and `duration_max ≤ capacity`. A task's cook-dependency can run
inside that same interval and still go unclaimed. It can fail either gate, or it can already
belong to another window. The window then lists the consumer and leaves out the dependency.
B4 (`rank_window_tasks`, merged) orders by `start_min`, so rank 0 is "the first **claimed**
task". The unclaimed dependency still runs before it. "Start with this" then names a task
the cook can't start yet.

## 1. The bug, concretely (the spec's graph, run for real)

| node | attention | typical / max | deps | timeline |
|---|---|---|---|---|
| host | unattended | 14 / 14 | — | 0–14 (capacity 12.6) |
| roast | hands_on | 5 / **13** | — | 0–5 |
| grind | hands_on | 5 / 5 | roast | 5–10 |
| chutney | hands_on | 3 / 3 | — | 10–13 |
| serve | hands_on | 1 / 1 | all | 14–15 |

`roast` fails the max gate (13 > 12.6), so `w1.assigned = [grind, chutney]` with grind at rank 0.

What the cook is told **today** (rendered through the real `derivePlan` and `deriveCookOutline`):
- **Plan card:** the stage rows are `host`, `roast`, `serve`. Under host there's a block, "Meanwhile, do these", that
  says **Start with this: grind**, then chutney.
- **Outline:** `Now: host → serve` · `Meanwhile: grind, chutney`. Roast appears nowhere in it.

This is wrong advice. At minute 0 the card tells the cook to grind peanuts that haven't been
roasted. Roast shows up only as a separate serial row, and nothing says it has to come first.

## 2. Reachability: proven, and wider than the spec says

These shapes go through `schedule()` on origin/main:

| shape | main: windows | why it's wrong |
|---|---|---|
| spec: dep fails the max gate | w1 `[grind, chutney]` | grind needs roast (0–5, unclaimed) |
| dep fails **typical packing**: host 14, big 9, dep 4, cons 1←dep | w1 `[big, cons]` | dep runs 9–13 *between* the two listed tasks |
| transitive: a(max fail) → b → c | w1 `[b, c]` | "Start with b", but a must run first |
| transitive via unattended: a(max fail) → soak → c | w1 `[c]` | same, through a soak |
| **cross-window**: host1 30 and host2 12 both at 0; dep 0–4, cons 4–9 ← dep, big 9–29 ← cons | w1(host1) `[cons, big]`, w2(host2) `[dep]` | host1's card says "Start with cons", but its dep is on another card |
| shared dep, unclaimed: dep(packing fail) → c1 → q → host2; c2 ← dep, q | w1 `[c1, q]`, w2 `[c2]` | w1 says "Start with c1", but dep runs 0–3 first |

None of the stored graphs has any of these shapes (§6), so a fix is warranted for a reachable case.

## 3. Where the fix goes: the scheduler, in §4.4 ownership

Rank can't fix this, because the dependency isn't in the list to rank. A renderer fix would
mean three renderers each inferring dependencies, which breaks the CLAUDE.md rule "frontend
never infers". The fix belongs in `apps/api/abc_cook/schedule/scheduler.py`, in the §4.4
loop, after packing and before `rank_window_tasks`.

**Rule:** a window keeps a task only if every **cook** ancestor (transitive `depends_on` with
`_occupies_cook`) that **started at or after the host's start** is also in this window's
`assigned`. The check runs to a fixpoint, because dropping one task can expose its consumers.

- A dropped task is taken out of `claimed` and `used`, so a later window can still claim it.
  It is checked under the same rule there.
- **No refill.** Capacity freed by a drop is not re-packed. That is the safe subset, and the
  window gets smaller, not wrong. Refill is a logged follow-up (F1).
- Unattended or periodic ancestors don't trigger a drop. They are waits, not cook actions, and B4's approved tests
  depend on this (`test_rank_zero_is_a_task_that_can_start_now_not_one_waiting_on_an_outside_soak`,
  `test_rank_respects_a_transitive_dependency_through_an_unclaimed_node`; both stay green). A
  hands-on ancestor *behind* a soak still triggers a drop, because the walk is transitive.
- A dependency that started before the host (fully before, or still in progress when the window opens) is fine.
  It's the step the cook is already on.
- A window left empty is already removed and renumbered by the existing code.

**Interaction with #55 and B4.** After the fix, B4's rank 0 is always a task with no
outstanding in-window cook prerequisite, so "Start with this" is true by construction. #55's
outline fold (prerequisites of a *title* window task folded into the title) still applies.
It just sees fewer such prerequisites. No web change is needed.

Implementation shape: precompute `ancestors: dict[str, frozenset[str]]` once per `schedule()`
call. Add a small pure helper `_drop_tasks_with_unclaimed_ancestors(window, host_start, …)`
next to the loop. Keep the existing §4.4 comment block and add a 3rd bullet for the rule.
Write mypy-strict type hints and a Google docstring.

## 4. The renderers, today vs after (spec example)

| renderer | today (main) | after fix |
|---|---|---|
| Plan tab window card (`derive.ts` → `WaitWindowBlock.tsx`) | rows: host, roast, serve. Block: **Start with this: grind**, then chutney | rows: host, roast, **grind**, serve. Block: chutney alone (one task, so no "Start with this" label) |
| "How this cook goes" (`cookOutline.ts`) | `Now: host → serve` · `Meanwhile: grind, chutney` | `Now: host → serve` · `Meanwhile: chutney` |
| Cooking mode | No "while this cooks" list exists: it walks `executionOrder` (timeline order), so it already says roast → grind → chutney. Window membership only sets grind's **stage label** (the host's stage) and the whisper's remaining-task count | Same step order. grind's stage label becomes its own stage, which is the same stage in this example |

Rollup (`stage_spans`) for the example: `windowed_work_min` 8 → 3 and `inline_work_min` 20 → 25. That is
consistent and comes from the scheduler.

## 5. Tests: synthetic shapes in `apps/api/tests/test_schedule.py`

Add a section `# --- A window never lists a task whose cook prerequisite it left out ---`.
Add a builder like `_rank_graph` that also takes `duration_max` (the existing one ties max to
typical); extend it with an optional 5th tuple element rather than writing a new helper.
The expected results below come from the prototype run:

1. **Dependency inside, claimed:** host 14; dep 5 → cons 5. Assigned `[dep, cons]`, no change.
2. **Dependency before the window:** dep and p both before the host; cons in the window. `[cons]` is kept.
3. **Dependency inside, unclaimed (the bug):** the spec graph gives `[chutney]`, and grind is
   inline. Packing-gate variant: `[big]`, and cons is dropped.
4. **Transitive:** a(max fail) → b → c drops both b and c (the window is gone). Via a soak:
   a → soak → c drops c.
5. **Dependency in another window** (cross-window shape above): one window remains, host2 with
   `[dep, cons]`, and big is inline.
6. **Two windows sharing a dependency:** (a) dep claimed in w1, with c2 in w2 after host2 starts:
   no change, `w1 [dep, c1, q]` and `w2 [c2]`. (b) dep unclaimed: w1 is emptied and
   removed, and the remaining window is `[c2]`.
7. **Dependency in progress when the window opens** (it started before the host): the consumer is kept.
8. **Golden invariant** (parametrised over `GOLDEN`, next to
   `test_window_rank_follows_dependencies_and_start_order_on_every_golden`): for every
   window, every cook ancestor of an assigned task with `start_min ≥ host.start_min` is itself in `assigned`.

## 6. Every stored plan or window consumer, and the prototype run over all of them

Consumers found: `tests/fixtures/*.plan.json` (8 goldens, `test_schedule.py`), `test_summary.py`,
`test_rollup.py`, `test_extract_replay.py` (dal-makhni, pizza-dough replays), `test_recipe_page.py`,
web `src/__fixtures__/*.plan-response.json` (11, read by `derive.test.ts`, `cookOutline.test.ts`,
`StageCard.test.ts`, `WaitWindowBlock.test.ts`, `cooking/*.test.ts`, `viewModel.test.ts`,
`map/layout.test.ts`), `docs/investigations/{pizza-dough…import_result, sabudana…library}.json`.

Prototype results (the rule patched into a scratch copy of origin/main):
- **Full API suite:** main 5 failed / 1209 passed; proto 6 failed / 1208 passed. The 5 are the
  expected live-LLM tests. The single extra failure is `test_postprocess_version`, which is expected (see §7).
  **All 8 goldens, summary, rollup, replay and recipe-page tests are unchanged.**
- **`export_web_fixtures.py` run under main and under proto:** all 11 files byte-identical.
- **Sweep of every graph stored anywhere in the repo** (20 graphs: goldens, web fixtures, investigation exports),
  each at burner capacity 1 and 2, so 40 schedules: windows identical.

**Expected: no change. Observed: no change.** If the implementation session sees any change,
that is a hard stop.

## 7. POSTPROCESS_VERSION: 7 → 8

This is required. `schedule/` output changes for affected graphs, so cached plans built under 7
could still carry the misleading window. The prototype tripped `test_postprocess_version`.
Bump the value in `extract/cache.py`, append a history entry (never edit an old one), and add the `"8"`
hash to `tests/fixtures/postprocess_versions.json` as that test instructs.

## Commits (branch `fix/window-unclaimed-dependency`, worktree `C:\Users\ashya\Music\abc-cook-window-dep`)

1. `docs(plans): window unclaimed dependency — implementation plan`: this plan, saved as
   `docs/plans/fix-window-unclaimed-dependency.md`.
2. `test(schedule): window never lists a task missing its cook prerequisite`: shapes 1–8.
   The bug shapes are red at this commit.
3. `fix(schedule): a window drops a task whose in-window cook prerequisite it did not claim`.
   Then run the full suite, the web fixture export, and the 40-schedule sweep. **STOP if any golden, fixture or replay changes.**
4. `chore(cache): POSTPROCESS_VERSION 8`.
5. `docs: COOKING_GRAPH §4.4 ownership rule; mark the follow-up spec done, log F1 (refill after drop)`.

Then push and open a PR. Per memory, no merge to main without the owner.

## Verification

- `PYTHONPATH=apps/api pytest apps/api/tests` → only the 5 live-LLM failures (no `OPENAI_API_KEY`).
- `ruff` plus `mypy --strict abc_cook/schedule`.
- `PYTHONPATH=apps/api python apps/api/scripts/export_web_fixtures.py`, then `git diff --stat` must
  be empty apart from CRLF (restore all 11 files afterwards).
- `npm ci && npx vitest run` in `apps/web` → green, with no web source change.
- Re-run the sweep script (schedule every graph in the repo at burner capacity 1 and 2, diff the windows
  against origin/main). Re-create it from this plan's §6 description.

## Implementation-session notes

PYTHONPATH=apps/api for pytest and scripts. `npm ci` in apps/web. The first commit is the plan file.
Write non-ASCII text with the Write tool, never with heredocs. `export_web_fixtures.py` rewrites all 11 fixtures (CRLF on
Windows), so restore everything except intended changes; none are intended here. 5 live-LLM tests fail without
OPENAI_API_KEY, which is expected.

## Logged follow-ups

- **F1:** refill a window's capacity after a drop (re-pack with the dropped tasks excluded). Not needed for
  safety.
- **F2:** if a recipe ever shows a whole window disappearing because of this rule, look at whether the
  dependency's gate could be relaxed safely (for example, claiming it with a warning). That is rejected for now
  because the gates exist so the advice stays safe.
