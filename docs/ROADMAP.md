# Roadmap

Each milestone has an **exit criterion** — a thing you can actually check. Don't start
the next one until the current one passes. The failure mode for a solo evening project
is building six half-features.

---

## M0 — Scaffold  ·  ~1 evening

Repo, `apps/api` (FastAPI), `apps/web` (the Figma Make export, running locally), lint
and test wired, `.env.example`, this docs folder committed.

**Exit:** `make dev` brings up both; the Figma prototype renders on your phone over
local network.

---

## M1 — Schema and scheduler  ·  ~2–3 evenings

**No LLM, no UI, no network.** Pure Python.

Write the Pydantic models. Hand-author `kadai-paneer.graph.json` by typing out the
table in `COOKING_GRAPH.md` §3. Write the scheduler. Make the fixture produce the
expected plan. Then add the other four fixtures.

Do this first because it's the moat, it's the part you're best at, and every downstream
decision depends on the shape of `CookingPlan`.

**Exit:** `pytest` green on five golden fixtures, including `maggi-2min` degrading
quietly and `homemade-donuts` filling a 60-minute rise window without violating any
freshness limit.

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
`DESIGN_SYSTEM.md`, and apply it. Spend the boldness on the Map view; keep everything
else quiet.

**Exit:** put your app's Map view next to a screenshot of ReciMe and of Chart My
Recipes. If a stranger can't tell which one is different, you haven't found a direction
yet — you've found the default.

---

## M2.75 — The Map view  ·  ~2–3 evenings

The graph itself, per `docs/GRAPH_VIEW.md`. Deterministic SVG layout, row = time,
critical path as the leftmost continuous lane, solid vs dashed connectors legible
without a legend.

**Exit:** the five-second test from `GRAPH_VIEW.md` §8, run on five people. Three of
five answer "what happens while the base is cooking?" correctly without being told
anything.

---

## M3 — Cooking mode  ·  ~4–5 evenings

The interaction that proves the thesis:

```
Start Cooking → Cook Base timer → "While this cooks" → Chop capsicum
→ Mark complete → back to the running timer → timer ends → next stage
```

Timers that survive backgrounding, screen wake lock, pause/resume, skip.

**Exit:** you cook one real dish end to end using only the app. Not a click-through —
an actual dinner. Write down every moment you got confused or had to look away.

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
