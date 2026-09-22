# Roadmap

Each milestone has an **exit criterion** — a thing you can actually check. Don't start
the next one until the current one passes. The failure mode for a solo evening project
is building six half-features.

---

## M0 — Scaffold  ·  ~1 evening

Repo, `apps/api` (FastAPI), `apps/web` (React + Vite + Tailwind, running locally), lint
and test wired, this docs folder committed. The web app is a blank scaffold at this stage.

**Exit:** `make dev` brings up both servers; web app is reachable on your phone over LAN
at http://<local-ip>:5173.

*Note: UI implementation (PlanView, StageCard, cooking screens) is M2. M0 and M1 are
infrastructure: the servers must work together, and the scheduler must be proven on golden
fixtures. Only then do you build the UI that depends on `CookingPlan`.*

---

## M1 — Schema and scheduler  ·  ~2–3 evenings

**No LLM, no UI, no network.** Pure Python.

Write the Pydantic models. Hand-author `kadai-paneer.graph.json` by typing out the
table in `COOKING_GRAPH.md` §3. Write the scheduler. Make the fixture produce the
expected plan. Then add the other four fixtures.

Do this first because it's the moat, it's the part you're best at, and every downstream
decision depends on the shape of `CookingPlan`.

**Exit:** `pytest` green on five golden fixtures — including `kadai-paneer` scheduling
to `total_min` 34 / `serial_min` 43 / `saved_min` 9, `maggi-2min` degrading quietly,
and `homemade-donuts` keeping the glaze out of the 60-minute rise window rather than
filling it (freshness).

---

## M2 — Plan renders on a phone  ·  ~3–4 evenings

`GET /recipes/{id}/plan` serves the scheduled plan. The web app renders it: stage
cards, expand/collapse, the WaitWindowBlock with real computed numbers, capacity bars.
Still no LLM — the fixtures are the data source.

Port the Figma frames rather than regenerating them. The layout and hierarchy in v4 are
good; keep them.

**Exit:** you open Kadai Paneer on your phone and someone who has never seen the
product understands, without being told, that the three tasks happen while the base
cooks. Test this on an actual person.

---

## M2.5 — Design direction  ·  ~1–2 evenings

Do this once, between M2 and M3, with the `frontend-design` skill loaded. Not before —
you need real screens on a real phone to react to. Not after — M3 will build a dozen
components on whatever direction exists at the time.

Produce a design brief (palette, type, layout concept, principles), write it into
`DESIGN_SYSTEM.md`, and apply it to the Plan view — the only view that exists at this
point. The Map itself is out of scope: it's greenfield, and `DESIGN_SYSTEM.md` § Register
explicitly defers its construction, and the direction's boldest commitments, to M2.75.

**Exit:** `DESIGN_SYSTEM.md`'s principles and stage-identity treatment are visibly present
in a rendered Plan screen at 390×844, checked row by row against the doc rather than
approved from a token table (`CLAUDE.md` § Working style). And: M2's five-second person
test, re-run against the M2.5 Plan, with the inert-CTA caveat in the script.

(The Map-vs-competitors comparison originally written here belongs to M2.75, once the Map
exists to compare against — moved there.)

---

## M2.75 — The Map view  ·  ~2–3 evenings

The graph itself, per `docs/GRAPH_VIEW.md`. Deterministic SVG layout, row = time,
two fixed columns (a mainline spine and everything else), classification by pure interval
math over plan facts, solid arrows for real mainline dependencies and one dashed bracket
per wait window, with a compact legend — direction set by the owner's approved
`M2.75 Map design handoff.md` and recorded in `DESIGN_SYSTEM.md` § *The Map grammar*. This
supersedes an earlier in-repo checkpoint built against the owner's own s9 mock
(`docs/design/renders/m275-direction-mock.png`, kept as history); the reversal is argued
in `DESIGN_SYSTEM.md` § *Resolved in M2.75, round 2*. It ships as a `Plan · Map` mode
switch inside the existing Cooking Plan tab, not a new top-level tab — Plan stays the
permanent default.

This is where the Plan view's building blocks get their second consumer, so it is also
where `src/components/global/` earns its place — the shared *components* the two views
turn out to need, alongside the feature-agnostic *functions* already in `src/lib/`. Not
before: with a single consumer, extracting a primitive is guesswork, and a wrong
abstraction is harder to undo than a duplicated component. Everything else stays
feature-first — `src/plan/` and `src/map/` own their own pieces, so a view can be
deleted by deleting a folder.

**Exit:** the five-second test from `GRAPH_VIEW.md` §8, run on five people. Three of
five answer "what happens while the base is cooking?" correctly without being told
anything. **And** the exit comparison M2.5 deferred here now that the Map exists to
compare: put it next to a screenshot of ReciMe and of Chart My Recipes — if a stranger
can't tell which one is different, the direction hasn't landed.

---

## M3.1 — Recipe-level timing summary  ·  ~1 evening

Python only, no UI. `PlanSummary` (`abc_cook/schedule/summary.py`) — active/attended
minutes, the honest upper bound from a second scheduler run with every hands-on node
slowed to `duration_max`, and the timeline split into sittings and long waits — rides in
as an optional `RecipePlanResponse` sidecar field next to `stage_spans`, the same
discipline `StageSpan` already established. `CookingPlan`, the scheduler, and every
golden `*.plan.json` fixture stay untouched. See `docs/COOKING_GRAPH.md` §4.7.

**Exit:** `pytest` green with `PlanSummary` computed for all golden fixtures; the six
existing golden `.plan.json` files byte-identical (nothing rides anywhere but the sidecar).

---

## M3.1a — Per-sitting range and wait-row hosts  ·  ~1 evening

Adds `Session.elapsed_min`, `elapsed_high_min`, and `preceded_by_host_node_ids` so M3.2's
header range and wait row are lookups, never frontend arithmetic (`docs/COOKING_GRAPH.md`
§4.7). The high bound reuses the already-slowed timeline's occupied footprint for that
sitting's own nodes — not a re-clustering of it, which could produce a different sitting
count with nothing to pair against.

**Exit:** new golden `synthetic-two-sittings` fixture (rinse → soak 8 hr → cook) proves
the split is generic over any long unattended node, not tuned to pizza's dough rest; all
six pre-existing golden `.plan.json` files stay byte-identical.

---

## M3.2 — Plan overview and timing header  ·  ~2–3 evenings

Makes the Plan view overview-first. Every stage starts collapsed — rollup figure, task
chain, `Meanwhile:` line — with one control to expand or collapse every stage at once
(`Show full recipe` / `Show overview`, on the `Plan · Map` mode row). The recipe header
gains a range-plus-secondary timing line computed from `PlanSummary` (Option A —
`docs/DESIGN_SYSTEM.md` § *Resolved in M3.2*), and a `WaitRow` states a sitting-boundary
gap between two rendered stages. An expanded stage shows its hands-on/waiting split
(tilde on the hands-on half only), a `You'll need:` ingredient line, and each task's full
instruction with its tip when it has one — inline and inside a hosted wait window alike.
Every number here is a lookup on `PlanSummary` / `StageSpan` / the graph; nothing is
computed on the client (`CLAUDE.md`).

**Exit:** `vitest` and `lint` green; the collapsed and expanded states checked at 390×844
against `DESIGN_SYSTEM.md`'s StageCard and Resolved-in-M3.2 sections row by row, not
approved from a token table (`CLAUDE.md` § Working style) — Kadai's `Cook the base` and
Chicken Biryani's `Chicken` and `Rice` stages are the checkpoints that surfaced real
layout issues (a stage header collision on a long hands-on/waiting split) worth checking
again on any future change to the header row.

---

## M3.2b — Source-section stages and in-stage waits  ·  scope not yet estimated

Deferred out of M3.2: stages keyed to a recipe's own written sections rather than the
scheduler's inferred grouping, a wait row that can sit *inside* a stage rather than only
between two rendered stages, and pizza's `cook` stage — the one shipped case whose
rendered nodes span more than one sitting, which `deriveWaitRows` currently handles by
dropping the ambiguous wait row rather than guessing at a split. None of these are a
`derive.ts` or scheduler defect; they are product questions about what a "stage" should
mean once its rendered content can straddle a sitting boundary.

**Exit:** not yet written — scope this milestone properly before starting it, per
`CLAUDE.md` § Working style ("ask instead of inventing product behaviour").

---

## M3 — Cooking mode  ·  ~4–5 evenings

The interaction that proves the thesis. Corrected here from an earlier draft of this
milestone (M3.3's design contract, 2026-09-22): Cooking Mode is **node-driven, not
stage-driven** — the unit the app tracks and shows is a graph node, not a stage, because
a stage can straddle a wait window or a sitting boundary in ways a single "current stage"
pointer can't represent. And there is **no pause** — a pause that cannot pause a pan is a
screen that lies about the stove. The app instead supports `leave`/`resume` (the cook
stepping away and coming back) and reports a stale reopen (gone long enough that nothing
should be trusted silently) rather than ever resuming across a long gap without asking.

```
Start Cooking → cook_tomato_base timer starts → chop_capsicum (fits the wait window)
→ mark done → timer expires → handover → next node
```

Timers survive backgrounding: every running node stores an absolute wall-clock end time,
never a counting-down integer (`CLAUDE.md`).

One structural piece lands here, and deliberately not earlier, and deliberately not as
`src/store/` + `src/hooks/` + Zustand (an earlier draft of this milestone assumed both):

**`apps/web/src/cooking/`** — a pure session reducer (`engine.ts`) over a persisted
`CookingSession`, a storage-backed store (`store.ts`, the same injectable-storage
pattern as `library/store.ts`) and a `useSyncExternalStore` binding (`useSession.ts`).
No new dependency: `useSyncExternalStore` already gives selector-level subscription
without Zustand or a memoised context value, and the reducer is exactly as testable
either way. A feature-first folder, not `src/store/`/`src/hooks/`, so the whole feature
is deletable by deleting one directory.

Split into:

- **M3.3 — Session core.** The reducer, store and derivations: execution order, the
  handover/holding predicate, wait subject, away-class (`sitting_break`/`long_wait`/
  `wait`), stale/finished lifecycle, skip/undo. No screen — `Start Cooking` stays inert.
  Every number the UI will eventually show (remaining time, parallel-task ranking,
  handover reason) is computed here, never in a component (`CLAUDE.md`).
- **M3.4 — Cooking screens.** Wires M3.3's model to the shells and states in the
  Cooking Mode UX direction: the calm `task` screen (including the explicit start tap
  a hands-off node needs before its timer exists — auto-starting one would hide a real
  instruction like "rinse and soak"), the handover screen, the what's-cooking sheet, the
  whisper, wake lock, and `useNow`. `Start Cooking` becomes functional.
- **M3.5 — Session polish.** The undo affordance (M3.3 ships the engine capability;
  M3.5 gives it a control), `Continue cooking` on the Plan view, and (only if a real
  dinner asks for it) `StageCard` active/complete marks.

**M3.2b** (source-section stages, in-stage waits) is deferred and unscoped independently
of this split — it can land before or after M3.3–M3.5; nothing in the session core
depends on it.

**Exit (M3.5):** you cook one real dish end to end using only the app. Not a
click-through — an actual dinner. Write down every moment you got confused or had to
look away.

---

## M4 — Import  ·  ~3–4 evenings

Extraction adapter, versioned prompt, Pydantic validation, invariant checks, the repair
pass, graceful degradation to a linear step list. Image upload and pasted text.

Build a small eval harness: 20 recipes (mix of Indian and Western, blog and Instagram
screenshot), report invariant pass rate, node count distribution, mean cost and latency
per import.

**Exit:** ≥ 80% of the 20 produce a schedulable graph on the first pass; 100% produce
*something* usable after the repair pass or degradation. Mean cost under ₹2.

---

## M5 — Ship to ten people  ·  ~2 evenings

Deploy. Supabase persistence. A crude usage log: imports, plans opened, cooking sessions
started, cooking sessions *finished*, parallel tasks completed.

**Exit:** ten people who aren't you have imported a recipe. Three have finished a
cooking session. That last number is the only one that matters — the honest question
this milestone answers is whether anyone actually cooks with a phone in this mode, or
whether the plan is admired and then abandoned at the stove.

---

## Later, in rough priority order

1. URL import (Schema.org recipe JSON first, no LLM; LLM only on failure)
2. Servings scaling and unit conversion (pure functions on the graph)
3. Ask-while-cooking ("can I use tofu instead of paneer?")
4. Voice / hands-free step advance
5. YouTube and Instagram import
6. Printable IKEA-style sheet — a renderer of the same graph, cheap and very shareable
7. Ingredient shopping (`PRODUCT.md` § Phase 3+)

---

## What would tell you to stop

Worth writing down now, while you're not attached to the answer:

- People import recipes but never start cooking mode → the plan is a nice picture, not
  a tool. The whole thesis is wrong.
- People start cooking mode but ignore the parallel tasks → the scheduling insight
  isn't valuable enough to change behaviour at the stove.
- Extraction quality plateaus below ~70% on real Instagram screenshots → the input side
  is harder than the output side and the roadmap inverts.
