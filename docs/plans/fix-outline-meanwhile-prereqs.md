# Fix: outline "Meanwhile" lists prerequisites of the main line

**Status:** approved 2026-10-15. **Not implemented.** Branch `fix/outline-meanwhile-prereqs`, created from origin/main 1658ef9.

## Context

`apps/web/src/plan/cookOutline.ts` (origin/main 1658ef9) builds the "How this cook goes" outline. For sabudana it says:

> Now: Soak sabudana → Make chutney · Meanwhile: Roast peanuts, Grind peanuts

Make chutney `depends_on = [Roast peanuts]`. Read top to bottom, that line lets the cook start the chutney before the peanuts are roasted. That is wrong advice. `plan.json` is correct; only the outline's wording is wrong. Spec: `docs/plans/followup-outline-meanwhile-prereqs.md`.

Mechanism: the stretch title is `first → last` of the phase's in-footprint nodes. In sabudana P0, `last` is Make chutney, which is itself a window task (w1, rank 2). The other w1 tasks (Roast, Grind) fall through to "Meanwhile", including Roast, which Make chutney needs.

## 1. The rule: narrower than proposed, backed by evidence

**The proposed rule ("not an ancestor of the main task") is too broad.** I ran it over all 11 web fixtures. When the title's `last` node is the recipe's sink (Finish, Rest and serve, Assemble, Serve), every prep task is an ancestor of it, so the rule empties correct Meanwhile lines in 4 fixtures:

| Fixture | Title | Naive rule removes | Narrow rule removes |
|---|---|---|---|
| sabudana P0 | Soak sabudana → Make chutney | Roast peanuts | **Roast peanuts** |
| kadai | Chop onion → Finish | all 3 (Cube capsicum, Cube paneer, Make kadai masala) | none |
| chicken-biryani | Boil spiced water → Rest and serve | all 5 | none |
| strawberry-shortcake | Mix shortcake dough → Assemble | Hull and slice berries | none |
| synthetic-two-windows | Chop vegetables → Serve | all 5 | none |
| other 6 fixtures | — | no candidates | no candidates |

**Recommended rule:** a window task X is left out of a stretch's Meanwhile when X is a transitive `depends_on` ancestor of a **title node that is itself a window task** (assigned to any window).

Why this is the right line to draw:
- A title node that is not a window task (Finish, Serve) is the main line of the stretch. Doing its inputs "meanwhile" is exactly what the word means.
- A title node that is a window task is something the cook fits into the same wait as the Meanwhile tasks. Listing one of its prerequisites next to it as "meanwhile" reads as parallel, and that is the bug.
- It is generic: it uses only `depends_on`, `windows[].assigned` and the existing title choice. No recipe names or ids.

**PR-C same-burner guard edges are confirmed visible (check a).** `extract/graph.py::_explicit_dependencies` appends each guard edge to the step's `deps` set (graph.py:1243–1257, "uses the same {station} as earlier step …; added that dependency."). That set becomes `node.depends_on` at graph.py:1625. Nothing downstream rewrites `depends_on`: the only writers are in graph.py, and validate/repair do not mutate it. `import_pipeline.py` schedules that same `graph` object (line 472) and returns it in `ImportResult(graph=graph, plan=plan, …)` (line 486–490). The fixture route does the same (`routes/recipes.py:133`, `RecipePlanResponse(graph=graph, …)`). So the web app's `graph.nodes[].depends_on` is exactly the edge set the scheduler used, guard edges included, and the ancestor test sees them. No stop needed.

**Scheduler-only ordering.** The scheduler also enforces two kinds of ordering that are not in `depends_on`:
- the pan-chain gate (`schedule/scheduler.py::_pan_chain_gates`)
- station contention (burner capacity)

Neither is on the plan response, and neither is a prerequisite: no output flows between the nodes. They change *when* a task runs, not *what it needs*. The timeline already reflects them, and task lines are ordered by `start_min`. So the ancestor test uses `depends_on` only. See Follow-up 1.

**Where it lives.** It goes in `cookOutline.ts` (a pure derivation module, not a component). `OutlineInput.nodes` grows `'depends_on'`, which every caller already passes in through `graph.nodes`. The frontend reads the plan's own edges and infers nothing, which is the route the spec allows ("that input grows a field populated from the plan response"). Moving it to the API summary would need a schema change, type regen and a POSTPROCESS bump for a wording fix, so I rejected that.

## 2. Excluded prerequisites: fold them into the title (recommended)

- **Fold (recommended):** "Now: Soak sabudana → Roast peanuts → Make chutney · Meanwhile: Grind peanuts"
- **Drop:** "Now: Soak sabudana → Make chutney · Meanwhile: Grind peanuts"

Why drop loses:
1. Roast peanuts disappears from the outline. That breaks the existing invariant test ("shows every window task in exactly one stretch").
2. "Meanwhile: Grind peanuts" would then point at a task whose own prerequisite (Roast) appears nowhere. That is a new kind of misleading line.

Fold keeps every task visible and puts the prerequisite before its consumer.

Correction to the brief's example: "Now: Roast peanuts → Grind peanuts → Make chutney" is not what either rule produces. Grind is **not** an ancestor of Make chutney (chutney depends only on Roast), so Grind stays under Meanwhile.

Fold mechanics, run only when something is promoted, so the other fixtures' titles are untouched:
- `titleIds = [...promotedBefore, first, ...promotedMid, last]`.
- `promotedBefore` holds the ancestors of `first` only. Each group is sorted by `start_min`, then by phase order.
- `first === last` with promotions gives `[...promoted, first]`.
- The title joins all labels with ` → `.
- `ctaSubline` reuses `title`, so for sabudana it becomes "First 20–30 min: Soak sabudana → Roast peanuts → Make chutney. The rest is ~1 hr 45 min later."
- Promoted ids are added to `inTitle`, so they leave the Meanwhile candidate list.

## 3. Ordering

This needs no logic change. Task lines already sort by `start_min`, tie-broken by `assigned` order. The scheduler writes `assigned` as `rank_window_tasks` output (`start_min`, then `node_id`; `scheduler.py:320`). The outline tie-break is therefore identical to B4's window card. One synthetic test pins the tie-break.

## 4. MAX_LISTED_TASKS

The cap applies **after** filtering, as the spec says. It falls out of the code: the filter runs inside the existing `.filter()`, before `.slice(0, MAX_LISTED_TASKS)`, and `+N more` counts the post-filter list. When filtering leaves 0 tasks, the existing `if (labels.length === 0) continue` emits no line at all: no "Meanwhile:" label and no empty list. A test covers this.

## 5. Synthetic rule tests

These go in `cookOutline.test.ts`, in a new `describe('deriveCookOutline — Meanwhile never lists a prerequisite of the title')`. A new builder, `syntheticStretch(...)`, takes invented ids/labels, a window, `depends_on` and starts.
1. **Chain prerequisite:** window [A, B, C], C is title-last, C ← A. A folds into the title ("S → A → C"), B stays under Meanwhile.
2. **Transitive prerequisite:** C ← B ← A, all in the window. Title "S → A → B → C", no task line.
3. **Truly parallel:** C has no window-task ancestors. Output is unchanged ("S → C", "Meanwhile: A, B").
4. **Main-line sink is exempt:** title-last is a non-window sink that depends on every window task. Meanwhile is unchanged. This is the regression guard for the naive rule.
5. **Mixed:** one ancestor plus two independent tasks. The ancestor folds, the others list in start order.
6. **All filtered:** every candidate is an ancestor. No task line.
7. **More than MAX candidates:** 1 ancestor plus 4 independent. Output is "Meanwhile: X, Y +2 more"; the cap counts post-filter.
8. **Tie-break:** two tasks with equal `start_min` list in `assigned` order.
9. **Dependent Meanwhile pair:** A → B (B depends on A), neither an ancestor of any title node, title-last is a window task with no window-task ancestors. Result: "Meanwhile: A, B", and the test asserts A is listed before B.

The existing `synthetic()` helper gets `depends_on: []` on its nodes.

## 6. Every golden/fixture that reads outline output

Readers of `deriveCookOutline` (from grep on origin/main):
- `apps/web/src/plan/cookOutline.test.ts`
  - per-fixture expectations: sabudana, donuts ×2, pizza, kadai, synthetic-two-sittings
  - every-fixture invariants over all 11 `src/__fixtures__/*.plan-response.json`
  - the window-split clone test
  - the O1/O2 synthetic tests
- `apps/web/src/plan/headerMeta.test.ts`: reads only `outline.card != null`.
- Production callers: `derive.ts:439`, then `RecipeHeader.tsx`, `CookOutlineView.tsx`, `PlanScreen.tsx` (ctaSubline). No snapshot tests.
- **API:** no golden, replay or `plan.json` reads the outline; it is web-only. `test_summary.py:730` only mentions it in a comment. `test_extract_replay.py` and `test_ingredient_group_golden.py` don't touch it.

Expected changes:
- **Changes, hard stop:** the `sabudana` case in `cookOutline.test.ts`. Title becomes "Soak sabudana → Roast peanuts → Make chutney", taskLines becomes `['Meanwhile: Grind peanuts']`, and ctaSubline changes as above. This is the intended fix, and the only fixture where a title node is a window task with window-task ancestors in the stretch.
- **Unchanged:** kadai, biryani, shortcake, two-windows (narrow rule removes nothing); donuts (Grease tray is a window title node with no in-stretch window ancestors); pizza, maggi, two-sittings, defaulted-servings (no windows). The window-split clone test is unchanged: with Roast moved to P1, Make chutney's ancestor is no longer a P0 candidate, so P0 = "Meanwhile: Grind peanuts" and P1 = "Meanwhile: Roast peanuts". headerMeta is unchanged.
- The invariants ("every window task shown once", "ordered by start") still hold, because the title now has 3 labels and the check uses `title.split(' → ')`.

**Reverse case (check c).** I looked across all 11 fixtures for Meanwhile tasks that are transitive `depends_on` **descendants** of a window-task title node. There are only two window-task title nodes (donuts P0 "Grease tray", sabudana P0 "Make chutney"), and neither has a descendant among its stretch's Meanwhile candidates. **None found**, as expected, so there is no follow-up.

**Hard stop for owner review:** the sabudana test diff plus a 390 px screenshot of the sabudana recipe header, to check that a three-label title wraps acceptably.

## 7. POSTPROCESS_VERSION

**No bump.** The change is confined to `apps/web/src/plan/`. Nothing in `extract/{graph,validate,repair,normalize,title,corroborate,provenance,import_pipeline}.py` or `schedule/` changes, and the cached plan JSON is identical. `test_postprocess_version.py` hashes only those API files.

## Files

- `apps/web/src/plan/cookOutline.ts`:
  - add `'depends_on'` to `OutlineInput.nodes`
  - an `ancestorsOf` helper that memoises a DFS over `depends_on ?? []`
  - a set of window-task ids
  - promotion and fold in the title block
  - extend `inTitle`
  - update the module docstring (decision 8 note: Meanwhile never lists a prerequisite of a window-task title node)
- `apps/web/src/plan/cookOutline.test.ts`: the sabudana expectation (at the hard stop), the new synthetic suite, `depends_on: []` in `synthetic()`.
- `docs/plans/fix-outline-meanwhile-prereqs.md`: this plan (first commit).
- `docs/plans/followup-outline-meanwhile-prereqs.md`: status → implemented, with a pointer to this plan.

## Follow-ups

1. **Pan-chain gate / station contention wording.** Check whether a gated burner title node with a gate member listed under Meanwhile ever reads misleadingly. Not seen in current fixtures.
2. **Long fold titles.** No cap now. If a real fixture folds 3+ prerequisites into a title, check the 390 px wrap and decide on a cap. (Today the maximum is 1 promoted label, in sabudana.)

## Implementation notes (next session)

- Worktree: `C:\Users\ashya\Music\abc-cook-outline-meanwhile`, branch `fix/outline-meanwhile-prereqs`.
- `npm ci` in `apps/web`.
- Commit 1 is this plan file (`docs: plan outline Meanwhile prerequisite fix`).
- Write non-ASCII (→, –, §) with the Write tool, never heredocs.
- Then code plus synthetic tests, with the sabudana expectation left failing.
- **STOP** with the diff plus a 390 px screenshot.
- After owner OK, update the sabudana expectation and commit `fix(plan): never list a title task's prerequisite under Meanwhile`.
- Push the branch and open a PR; never commit to main.

## Verification

- `cd apps/web && npx vitest run src/plan` passes: all fixture invariants plus the 9 synthetic cases. Only the sabudana case changes.
- `npx tsc --noEmit` and lint pass (strict, no `any`).
- `pytest apps/api/tests/test_postprocess_version.py` is untouched and still green (sanity).
- At 390 × 844, open the sabudana fixture's Plan screen: the outline reads "Now: Soak sabudana → Roast peanuts → Make chutney / Meanwhile: Grind peanuts", the CTA subline matches, and kadai still shows its "While checking the pan…" line. Screenshot for the owner (watch for Dark Reader inverting localhost).
