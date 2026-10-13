# Recipe page study (2026-10-13)

Owner-reviewed design study for the recipe page (the screen after import:
header, Plan tab, Ingredients tab, Start cooking). Made in Claude Design;
exported here as standalone HTML + 2x PNG at 390 px.

A study proposes composition, never tokens (`docs/DESIGN_SYSTEM.md`). Build in
the repo's tokens. Where this study and DESIGN_SYSTEM.md disagree, ask.

## Frames

| File | Shows |
|---|---|
| `1-top-of-page` | Above the fold: photo slot, title, source line, meta, plan-ahead card, "How this cook goes", Plan / Ingredients tabs, Start cooking |
| `2-plan-tab` | Plan tab scrolled: compact sticky header, stages grouped by sitting, "Meanwhile" panel inside the wait, ingredient chips, highlighted ingredients in steps |
| `3-ingredients-tab` | Tick-boxes, servings stepper, groups, "Copy the N missing items" |
| `4-end-of-page` | Your cooks (I cooked this, note), where it came from, Public recipe toggle, remove |
| `5-one-sitting-recipe` | Same layout for a recipe with no long wait (no plan-ahead card) |

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
