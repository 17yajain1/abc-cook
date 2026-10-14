# Recipe page study (2026-10-13)

Owner-reviewed design study for the recipe page (the screen after import:
header, Plan tab, Ingredients tab, Start cooking). Made in Claude Design;
exported here as standalone HTML + 2x PNG at 390 px.

Live canvas (source of truth, editable; needs a claude.ai login):
https://claude.ai/artifact/9pdubbqNeoGoHw6HvPpau9 — the files here are a
snapshot of it for anyone, or any tool, that can't open the link.

A study proposes composition, never tokens (`docs/DESIGN_SYSTEM.md`). Build in
the repo's tokens. Where this study and DESIGN_SYSTEM.md disagree, ask.

## Frames

| File | Shows |
|---|---|
| `0a-today-screen` (PNG only) | Critique of the **current** app (not a proposal): Plan, Ingredients and Map tabs annotated with issues 1–7 |
| `0b-today-walkthrough` (PNG only) | Critique of the **current** app from the walkthrough video: collapsed overview, Cooking mode, Leaving screen, issues 8–14 |
| `1-top-of-page` | Above the fold: photo slot, title, source line, meta, plan-ahead card, "How this cook goes", Plan / Ingredients tabs, Start cooking |
| `2-plan-tab` | Plan tab scrolled: compact sticky header, stages grouped by sitting, "Meanwhile" panel inside the wait, ingredient chips, highlighted ingredients in steps |
| `3-ingredients-tab` | Tick-boxes, servings stepper, groups, "Copy the N missing items" |
| `4-end-of-page` | Your cooks (I cooked this, note), where it came from, Public recipe toggle, remove |
| `5-one-sitting-recipe` | Same layout for a recipe with no long wait (no plan-ahead card) |

## What the critique frames found (the "why" behind frames 1–5)

| # | Issue in the current app |
|---|---|
| 1 | Three layers of navigation (Plan/Ingredients, Plan/Map, Show full recipe, change recipe) before any cooking content |
| 2 | No photo, no source: you can't tell which reel it came from or check the original |
| 3 | The most important fact is buried: a 2 hr soak means "start 3 hr before dinner", but it sits inside the Cook card |
| 4 | Walls of text: "You'll need" lists 19 names, with duplicates (green chilli ×2, cumin ×2). Part extraction, part layout |
| 5 | Map fails its own 5-second test: the soak is the tallest object, the real parallel work is squeezed into "+2 more" |
| 6 | Ingredients is read-only: no ticks, no servings, no way to get the missing items out |
| 7 | Feels like a second app: grey-green/black/red here, warm terracotta on Home |
| 8 | **Keep:** the collapsed overview (step chain + "Meanwhile:" line) is the clearest screen; it stays the default |
| 9 | The stage hides the wait: "Cook ~2 hr 33 min" includes the soak; stove time is ~30 min. Group by sitting first, stage second |
| 10 | The header never shrinks: about a third of the screen, on every tab, even mid-scroll |
| 11 | No back button (only "change recipe"); a tapped stage keeps a focus box on its title |
| 12 | Check the schedule: tempering and potatoes sat inside the soak (fixed by PR #46, the pan-chain rule) |
| 13 | Cooking mode is mostly empty: "Next: Soak 2 hours" doesn't say you can leave or what to do meanwhile |
| 14 | **Keep this tone:** "Nothing is on the heat" is calm and true; the recipe page should sound like this |

Issues 3 and 9 are why `PlanSummary.phases` exists (PR #48). Issue 4's
duplicates are an extraction problem (PR-C, D3), not a layout one.

## Decisions this study carries

- The recipe page moves from the Plan register to the **Home register** look
  (ground, ink, terracotta, radius, Archivo). Cooking mode is out of scope.
- **Map mode is removed** from the recipe page. One tab row: `Plan · Ingredients N`.
  `GRAPH_VIEW.md` and `DESIGN_SYSTEM.md` must be updated to record this.
- Back button; header shrinks to a compact sticky bar on scroll.
- Stages stay collapsed by default (the current overview with step chain and
  "Meanwhile:" line is kept as the collapsed state).

## Do NOT copy from these frames

- **Every number** (2 hr 40 min, ~60 min hands-on, saves 23 min, 5 min, 14
  ingredients, step durations). They are illustrative and some are already
  wrong: after the pan-chain fix (investigation 2026-10-13, PR-A) Sabudana
  saves 13 min, not 23. Every cooking figure comes from the plan JSON.
- The step text and instructions in frame 2 are hand-written examples.
- `[@creator]`, `[Channel name]` and `[n]` are placeholders; source thumbnail
  and creator handle are not captured by import yet.
- "Now / 2 hr / Then" and the plan-ahead card need `PlanSummary.phases`
  (PR-B). Do not build them by computing from `scheduled` or `long_waits`
  in the frontend.
