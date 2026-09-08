# Session 2: M1 Implementation Summary — Schema and Scheduler

**Session Name:** s2-M1 implementation · Schema and scheduler
**Date:** 2026-09-08
**Branch:** `feature/M1-scheduler` → merged to `main` (PR #2, merge commit `0fbc27b`)
**Commits:** `8020364` → `b895b39` (9 commits)

---

## Outcome

**M1 is complete and merged to `main`.** The deterministic scheduler — `CookingGraph`
in, `CookingPlan` out, pure Python, no LLM — is implemented and green on all five golden
fixtures. `pytest -m "not llm"`: **43 passed**. `ruff` + `mypy --strict` (on
`abc_cook/schema` and `abc_cook/schedule`): clean.

The M0 scaffold had already written the Pydantic schema models and stubbed the
`abc_cook/schedule/` modules with `NotImplementedError`. This session filled them in and
wrote the fixtures.

---

## How the work was done

A tight propose → review → approve loop. For each fixture: surface every ambiguity in
`docs/COOKING_GRAPH.md` first, get an explicit decision, *then* write the golden
`plan.json`. Golden fixtures are compared with exact equality — "if a fixture's expected
plan changes, that is a product decision, not a test fix."

---

## Spec decisions locked (`docs/COOKING_GRAPH.md`)

The worked example and §4 were internally contradictory in several places. Resolved:

| # | Decision | Where |
|---|---|---|
| 1 | `cook_tomato_base` (Kadai Paneer) is **12 min** typical, not 7 — the timeline, window capacity, `total_min`, and the design copy all already assumed 12. Serial baseline is now 43, `saved_min` 9. | §3 |
| 2 | Periodic wait-window 3-min single-task cap applies **only to non-`interruptible` tasks**; interruptible tasks may use full `capacity_min`. | §4.3 |
| 3 | Window **packing** (running sum of `duration_typical` ≤ `capacity_min`) and the **`duration_max` gate** are separate; a window claims a task only if it passes both. A task failing either is left for a later, roomier window. First-fit: the walk does **not** stop at the first packing overflow — a smaller later task may backfill. | §4.4 |
| 4 | Within-window order is strictly `duration_typical` desc, then `node_id` asc — used for both the in-window pick order (feeds §4.1.c) and `rank_in_window`. No "unblocks downstream work first" special case. | §4.4 |
| 5 | `duration_max` is an **eligibility gate during assignment**, not a post-hoc "overrun" warning. The old "drop it and schedule serially, warn" wording was removed. | §4.4 / §4.5 |
| 6 | **`burner_capacity`** is scheduler **configuration**, not graph data: `schedule(graph, *, burner_capacity: int = 1)`. The recipe graph never knows how many burners exist. `chicken-biryani` runs at 2, carried in a `<slug>.kitchen.json` sidecar. A future `KitchenConfig` — not a scatter of kwargs. | §4.6 (new) |
| 7 | Station contention → one deterministic `"uses N burners"` note at peak simultaneous count, emitted even when `burner_capacity` permitted the overlap. Nodes that only touch at a boundary don't overlap. | §4.5 |
| 8 | Empty wait windows are **dropped** from `plan.windows`; survivors renumbered `w1…wN` in `(host start, host id)` order. Never surface an empty window or invent filler. | §4.3 |
| 9 | **Freshness (F3):** a node with `max_lead_min` set is **withheld from scheduling** until it is its (single) consumer's last outstanding dependency, then runs just-in-time. Warning only if resource contention still pushes the consumer past the lead. **M1 scope: single-consumer only**; multi-consumer freshness scheduling deferred. | §4.1 / §4.4 / §4.5 |
| 10 | Plan minute fields rounded to `0.01` (`windows.MINUTE_DP`) so the `× 0.9` capacity factor doesn't break exact golden comparison. **Recipe durations were never tuned to satisfy window arithmetic.** | §4.3 |
| 11 | `total_min` (scheduled makespan) ≠ `critical_path` (longest dependency chain). The makespan can exceed the critical path via the single cook, station contention, or a freshness delay — none of which are added to `critical_path`. | §4.1 |

---

## Scheduler implementation (`apps/api/abc_cook/schedule/`)

- **`levels.py`** — `compute_levels` (longest `duration_typical`-weighted path to a sink)
  and `critical_path` (trace from the highest-level node, ties broken by `node_id`).
- **`scheduler.py`** — the §4.1 greedy list-scheduler loop:
  - step (b): start every ready `unattended`/`periodic` node with station room, as early
    as deps allow (§4.2). These don't occupy the cook.
  - step (c): if the cook is free and the node isn't freshness-withheld, start one
    ready `hands_on` node — by `(-level, cooking-before-prep, -duration_typical, id)`
    normally, or strictly `(-duration_typical, id)` while a wait window is open.
  - step (d): advance to the next completion.
  - stations: concurrency count against `capacity_of.get(station, 1)` (`burner` →
    `burner_capacity`, `none` → unbounded). No timestamp bookkeeping.
  - freshness: `freshness_ready(node)` — withheld unless it has `max_lead_min`, exactly
    one consumer, and some non-freshness dep of that consumer is not yet `done`.
  - post-timeline: derive windows, walk them in host order, single-claim by the two
    gates, first-fit, rank, drop empties, renumber.
- **`windows.py`** — `capacity_for` (`duration_typical × {0.9, 0.75}`, rounded),
  `derive_windows`, `MINUTE_DP = 2`.
- **`ranking.py`** — `rank_window_tasks` (`-duration_typical`, `node_id`).
- **`safety.py`** — `check_plan` → `plan.warnings`: `_freshness_notes` (lead violation
  per consumer, covers withheld JIT tasks), `_station_notes` (`"uses N Xs"` sweep-line
  peak), non-`interruptible` > 3 min in a periodic window.

---

## Golden fixtures (`apps/api/tests/fixtures/`, `docs/COOKING_GRAPH.md` §7)

Each is `<slug>.graph.json` + `<slug>.plan.json` (+ `chicken-biryani.kitchen.json`).

| fixture | nodes | total | serial | saved | windows | warnings | what it proves |
|---|--:|--:|--:|--:|--:|---|---|
| `kadai-paneer` | 10 | 34 | 43 | 9 | 1 | — | canonical branch → merge, one `periodic` window packed to capacity |
| `maggi-2min` | 4 | 7 | 7 | 0 | 0 | — | nothing to parallelise; plan stays quiet, empty windows dropped |
| `chicken-biryani` | 15 | 66 | 112 | 46 | 2 | `uses 2 burners` | two chains, `burner_capacity=2`, `duration_max` gate rehomes `slice_onions` from the 5.4-min boil window to the 18-min soak window, multi-window single-claim ownership |
| `homemade-donuts` | 11 | 138 | 153 | 15 | 1 | — | 60-min rise → 54-min-capacity window left with 51 min slack; `make_glaze` withheld and run JIT (t=127) rather than stuffed into the window; `heat_oil` depends on `shape_and_cut` so it doesn't preheat 100 min early |
| `strawberry-shortcake` | 8 | 47 | 72 | 25 | 1 | — | two freshness-constrained nodes (`whip_cream` lead 10, `slice_garnish_berries` lead 15) → one consumer; each waits only on the consumer's *non-fresh* deps, so no deadlock; both withheld then placed back-to-back before assembly; makespan − critical path (47 − 40 = 7) is exactly those two serial fresh tasks |

`chicken-biryani` and `homemade-donuts` each also surfaced a genuinely new scheduler
mechanism during their review (the `duration_max` gate; the F3 freshness delay).
`strawberry-shortcake` and `maggi-2min` needed no new rules.

---

## Test suite (`apps/api/tests/test_schedule.py`, ~500 lines)

- Parametrized over `GOLDEN` (all five): `schedule() == expected_plan` (exact),
  `serial_minutes`, determinism (`schedule(g) == schedule(g)`), plan-JSON round-trip,
  fixture well-formedness, internal consistency (arithmetic identities via
  `pytest.approx` for the rounding quantum).
- Focused synthetic-graph tests:
  - `duration_max` gate rejects then a roomier window claims (no warning).
  - Window backfills a smaller task after a capacity miss (locks first-fit vs
    stop-at-first-miss — the only test that distinguishes them).
  - `chicken-biryani`: max gate + `"uses 2 burners"`.
  - Freshness: not-scheduled-early / runs-JIT / within-lead-limit (donuts).
  - Freshness warning fires when a higher-priority task delays the consumer past the
    lead (synthetic).
  - Two fresh nodes / one consumer: both held then placed back-to-back (shortcake).

---

## Other changes

- **`.gitattributes`** (`1d1a181`) — pins all text files, fixtures especially, to LF so
  golden byte-comparison is stable on Linux CI / Cloud Run. `git ls-files --eol`
  confirmed the index was already LF-clean; this makes it durable.
- **`docs/ROADMAP.md`** M1 exit criterion corrected: `homemade-donuts` *keeps the glaze
  out of* the 60-minute rise window rather than *filling* it (freshness). Surfaced as a
  spec-vs-fixture wording mismatch, changed with approval.
- **Dev env** — created `apps/api/.venv` on Python 3.12 via `uv` and installed
  `.[dev]`; `make lint` / `make test` targets now runnable. The earlier
  `tests/test_health.py` collection error was a stale *system* Python
  (`fastapi`/`starlette` mismatch), not a repo problem — it passes in the clean venv.

---

## Commit history

| hash | message |
|---|---|
| `8020364` | docs: lock M1 scheduler decisions for the Kadai Paneer golden fixture |
| `771618a` | test: add kadai-paneer.graph.json golden fixture input |
| `1d1a181` | chore: add .gitattributes to pin text files to LF |
| `a572769` | test: add kadai-paneer golden plan + failing scheduler suite |
| `99d5b13` | feat: implement the M1 scheduler; kadai-paneer golden fixture green |
| `db01364` | test: add maggi-2min golden fixture; drop empty wait windows |
| `d7385d7` | feat: chicken-biryani fixture; burner_capacity config + duration_max window gate |
| `4579a12` | feat: homemade-donuts fixture; freshness-aware scheduling (F3) |
| `b895b39` | Implement M1 cooking graph scheduler (strawberry-shortcake + roadmap fix) |
| `0fbc27b` | Merge pull request #2 from 17yajain1/feature/M1-scheduler |

PR: https://github.com/17yajain1/abc-cook/pull/2 (merged). Local `feature/M1-scheduler`
deleted; `origin/feature/M1-scheduler` still exists.

---

## Open items / deferred

1. **Walk-continuation after a *typical*-capacity miss** — the spec now states first-fit
   explicitly and a regression test locks it. No fixture exercises the FFD-vs-prefix
   edge in a golden plan, but the synthetic test does.
2. **Multi-consumer freshness scheduling** — explicitly deferred in §4.5. A fresh node
   with 0 or >1 consumers currently schedules with no delay; the post-hoc lead warning
   still fires per consumer.
3. **`freshness_ready` deadlock guard** — the single-consumer scope prevents the known
   `F → D → C` + `F → C` self-block; the `max_iterations` cap turns any surprise into a
   `RuntimeError` rather than a hang. Not deliberately tested.
4. **`color_key` on `Stage`** — fixtures use name-like keys (`"prep"`, `"cook_base"`);
   `DESIGN_SYSTEM.md` says stage colours are assigned by *index*. Cosmetic, resolve at
   M2.
5. **`origin/feature/M0-scaffold` and `origin/feature/M1-scheduler`** remote branches
   still exist — delete when convenient.

---

## Next: M2 — Plan renders on a phone

Per `ROADMAP.md`: `GET /recipes/{id}/plan` serves a scheduled plan (fixtures are the
data source, still no LLM); the web app renders it — stage cards, expand/collapse,
`WaitWindowBlock` with real computed numbers, capacity bars. Port the Figma v4 frames
rather than regenerating them. Exit: someone who's never seen the product opens Kadai
Paneer on a phone and understands, without being told, that the three tasks happen
while the base cooks.
