# PR-B3 — an unattended node's start ends a hands-free gap

Status: **proposed 2026-10-14, not implemented.** Found while planning R2
(`docs/plans/r2-recipe-header.md`). **Must merge before R2 merges.** Scheduler/summary
change → golden updates are a product decision; surface every expected-value change,
never update an expected file silently.

## 1. Problem

`schedule/summary.py` splits the timeline into sessions and phases at gaps where no
`hands_on` (sessions) or no `hands_on`/`periodic` (phases) node is running. An
`unattended` node is treated as needing nobody — including at its **start**. `_partition`
attributes a node that starts inside a gap to the *preceding* stretch ("starting the wait
is the last thing the cook did in that stretch").

That is true for a node that starts the moment the previous step ends (cover the bowl →
rise). It is false for an unattended node that starts **later, inside the gap**: someone
has to be there to start it. Pizza:

| Node | Attention | Scheduled | Needs the cook at its start? |
|---|---|---|---|
| Cover and refrigerate overnight | unattended | 290–1370 | yes, but at 290 (inside the stretch) |
| **Remove the dough** (1 hr before) | unattended | **1370**–1430 | **yes — take dough out of the fridge** |
| **Place a pizza stone** (preheat) | unattended | **1430**–1440 | **yes — put the stone in, turn the oven on** |
| Lightly flour a pizza | hands_on | 1440– | yes (stretch 3 starts here) |

Today's summary says the gap is 290 → 1440 (1150 min) and phase 3 starts at 1440. R2 would
render that as **"Come back ~19 hr later"**, so a cook following the plan returns ~70 min
after they should have taken the dough out, and the oven is cold. Wrong advice, not
approximate timing. Today's Plan tab and Cooking mode inherit the same session split.

## 2. Affected fixtures (read-only scan, 2026-10-14)

Scanned every `apps/web/src/__fixtures__/*.plan-response.json` for any scheduled node whose
`start_min` falls strictly inside a phase gap, a session gap, or a `long_waits` interval.

| Fixture | Phases / sessions / long_waits | Starts inside a gap |
|---|---|---|
| chicken-biryani | 1 / 1 / 0 | — |
| homemade-donuts | 2 / 1 / 1 (21–78) | none |
| kadai-paneer | 1 / 1 / 0 | — |
| maggi-2min | 1 / 1 / 0 | — |
| **pizza-dough** | 3 / 3 / 0 | **Remove the dough @1370, Place a pizza stone @1430** — inside both the phase gap and the session gap 290–1440 |
| sabudana-khichdi | 2 / 1 / 1 (18–125) | none (Soak 2 hours starts at 5, inside stretch 1) |
| strawberry-shortcake | 1 / 1 / 0 | — |
| synthetic-defaulted-servings | 1 / 1 / 0 | — |
| synthetic-two-sittings (rajma) | 2 / 2 / 0 | none (Soak beans starts inside stretch 1) |
| synthetic-two-windows | 1 / 1 / 0 | — |

Only pizza is affected. API side: pizza's graph comes from
`apps/api/tests/fixtures/import/pizza-dough.normalized.json` (built in `test_summary.py`
by `_pizza_graph()`); there is no `pizza-dough.plan.json` golden.

## 3. Proposed rule

> **An unattended node's start ends a hands-free gap.** When an `unattended` node starts
> strictly inside a gap, its start instant counts as attended (and cook-occupied) time
> for both the phase and the session partition. The node is attributed to the stretch
> that its start creates, not to the preceding one.

Applied to both partitions so the existing invariant
`test_every_session_boundary_is_a_phase_boundary` still holds. Nodes starting exactly at
a stretch edge (Cover the bowl @10, Cover and refrigerate @290) are unaffected: they
start inside or on the edge of a stretch, not inside a gap.

Implementation sketch (`schedule/summary.py`): before `_partition`, add a zero-length
interval `[start, start]` for each unattended node whose start lies inside the merged
attended/occupied intervals' gaps; `_cluster_index` then attributes it naturally. Pure,
deterministic, no new inputs.

### Open question for the owner (decide before implementing)

- **Footprint of the start instant.** Zero-length gives pizza a stretch with
  `elapsed_min` 0 ("Remove the dough"), which R2 would print as "~0 min" (R2 O2). Options:
  (a) zero-length, R2 hides the time for a 0-length stretch; (b) a nominal 1-min attended
  footprint; (c) zero-length but merge it into the following stretch when the gap between
  them is < `PHASE_BREAK_MIN` (doesn't help pizza: the gap is 60 min).
- **Alternative fix upstream:** extraction could emit "Remove the dough" as a 1-min
  `hands_on` step followed by an unattended rest (prompt change, PR-D / prompt v8). The
  summary rule is still needed as a guard for graphs that keep the unattended form.
- **Risk:** a chain of unattended nodes where the second genuinely needs no hand (e.g.
  "rest" auto-following "bake" with no action) would gain a spurious attended point. It
  only changes output when both resulting gaps are ≥ the threshold. No current fixture
  has that shape.

## 4. Expected fixture changes (pizza only; exact numbers come from the implementation)

| Field | Today | Expected after PR-B3 |
|---|---|---|
| `phases` spans | (0,10) (280,290) (1440,1470) | (0,10) (280,290) **(1370,1370)** **(1430,1470)** |
| `phases[].preceded_by_wait_min` | None, 270, 1150 | None, 270, **1080**, **60** |
| `phases[].starts_new_session` | F, T, T | F, T, T, **F** |
| `phases[].preceded_by_host_node_ids` | …, [cover_bowl], [refrigerate, remove, stone] | …, [cover_bowl], **[refrigerate]**, **[remove]** |
| `sessions` spans | (0,10) (280,290) (1440,1470) | (0,10) (280,290) **(1370,1470)** |
| `sessions[2].preceded_by_wait_min` | 1150 | **1080** |
| `sessions[2].elapsed_min` / `elapsed_high_min` | 30 / 46 | **100 / ~116** (to be confirmed) |
| `long_waits` | [] | **[1370–1430, 60 min, host: Remove the dough]** |
| `plan.*` (scheduled, total 1470, elapsed_high 1493, saved 0) | — | **unchanged** (summary only) |

User-visible consequences to review:
- Pizza header range (last sitting) goes from "30–50 min" to roughly "1 hr 40 min – 2 hr":
  the last sitting now honestly includes the dough's hour on the counter.
- R2 copy for pizza becomes: Come back ~4 hr 30 min later / Come back ~18 hr later /
  "Remove the dough" stretch / Hands free for ~1 hr / last stretch. R2 O1 (sittings = 3,
  not 4) must be settled.
- All other fixtures: no change expected; `test_summary.py` asserts this for every slug.

Files expected to change:
- `apps/api/abc_cook/schedule/summary.py` — the rule.
- `apps/api/abc_cook/extract/cache.py` — bump `POSTPROCESS_VERSION` 3 → 4 and append a
  history entry (`tests/fixtures/postprocess_versions.json`; never edit an old entry).
- `apps/api/tests/test_summary.py` — pizza pins (`test_pizza_is_a_three_sitting_recipe`,
  `test_pizza_phases_equal_sessions`) updated **only after owner approval of §4**; new
  tests: an unattended start inside a gap splits it; a start on a stretch edge does not;
  rule applies to both partitions.
- `apps/web/src/__fixtures__/pizza-dough.plan-response.json` — regenerated (hard stop for
  owner approval first).
- `docs/COOKING_GRAPH.md` — document the rule next to `PHASE_BREAK_MIN` /
  `SESSION_BREAK_MIN`.

## 5. Verification

- `PYTHONPATH=apps/api pytest apps/api/tests/test_schedule.py apps/api/tests/test_summary.py apps/api/tests/test_postprocess_version.py`
- `ruff` + `mypy --strict apps/api/abc_cook/schedule`
- Web `npm test` (cooking-mode / plan tests that read the pizza fixture).
- Re-run the §2 scan: no unattended start strictly inside any gap in any fixture.

## Decision recorded 2026-10-14 (R2 owner review): footprint of the start instant

Option (a): zero-length stays zero in the data. R2 omits the time for a stretch whose
`elapsed_min` and `elapsed_high_min` are both 0. Also: PR-B3 and PR-B4
(`followup-window-task-order.md`) must both merge before R2.
