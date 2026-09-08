# Session 3: M2 Implementation Summary — Plan renders on a phone

**Session Name:** s3 · M2 — Plan renders on a phone
**Date:** 2026-09-09
**Branch:** `feature/M2-plan-renderer` (cut from `main` at `0fbc27b`)
**Design source:** Figma Make prototype `tED8srEMVSRjmWs13UfBOW` (`CookingPlanScreen`)

---

## Outcome

**M2's build is done and verified in a browser at 390px.** `GET /recipes/{id}/plan`
serves a real scheduled plan from the fixtures (no LLM), and the web app renders the
Plan view: recipe header, stage cards, the `WaitWindowBlock`, capacity chips. Every
number on screen originates from the scheduler — nothing is computed in a `.tsx` file.

Checked by hand on all five fixtures:

| fixture | what it shows |
|---|---|
| `kadai-paneer` | Prep card holds only *Chop onion, Chop tomato*; the other three prep tasks appear under **Cook the base** as "while this cooks", header reads **"9 min prep · fits in 12 min"**, *Cube capsicum* marked "Start with this one". |
| `chicken-biryani` | Two wait-window blocks (under Rice, under Chicken), `Uses 2 burners` banner, empty **Prep** stage dropped — its tasks show inside the windows that borrowed them, tinted with the Prep colour. |
| `maggi-2min` | No windows, no saved-time line, honest note: "Nothing in this recipe cooks unattended". |
| `homemade-donuts` / `strawberry-shortcake` | Render; not walked screen-by-screen this session. |

**Still owed by the ROADMAP exit criterion:** the five-second test on a real person who
has never seen the product. That is the owner's to run.

`make lint` clean (ruff + mypy --strict + tsc + oxlint). `make test`: **89 API tests**
(43 M1 + 27 rollup + 19 route) **+ 11 web tests**, all green. **Golden plan fixtures
byte-unchanged.**

---

## Decisions locked

| # | Decision | Notes |
|---|---|---|
| 1 | **Dark "spice cabinet" palette, system fonts.** | Owner's call. Palette ported from the prototype into `apps/web/src/index.css` `@theme` + `DESIGN_SYSTEM.md`. No-webfont rule kept; typography deferred to M2.5. |
| 2 | **Stage rollups are a view, not part of `CookingPlan`.** New `StageSpan` model, computed by `abc_cook/schedule/rollup.py`, returned *alongside* the plan. | Folding them into `CookingPlan` would have rewritten all five golden fixtures. |
| 3 | **One endpoint, `{ graph, plan, stages }`.** | The renderer needs labels/instructions/ingredients, which live on the graph. No new mirror models; `make types` covers all three. |
| 4 | **Windowed nodes render inside the host stage's `WaitWindowBlock`, not their own stage's list**, tinted with their *home* stage's colour. | This relocation is the product's entire argument. See "the interleaving rule" below. |
| 5 | **A stage with zero inline tasks and zero hosted windows is dropped** from the plan. | Same principle as the scheduler dropping empty windows — no `~0 min` cards. Surfaced by `chicken-biryani`'s all-windowed Prep stage. |
| 6 | **Capacity *chips*, not stacked bars.** `🔥 N min cooking` / `✓ N min prep`. | Anything bar-shaped reads as progress pre-start. `DESIGN_SYSTEM.md` updated. |
| 7 | **Stage colour by `index % 6`**, `Stage.color_key` ignored by the renderer. | Resolves s2 open item #4. `color_key` is now dead — flag for removal at M4. |
| 8 | **No hero photo.** Gradient header. | Prototype's Unsplash URLs are demo data; real imagery arrives with import (M4). |
| 9 | **`Start Cooking` renders disabled** (`· coming in M3`). | A dead-end button is worse than an honest one. |

### The interleaving rule

The Figma frame draws stages as sequential numbered blocks; the real schedule
interleaves them. For `kadai-paneer`, `prep` spans t=0→19 while `cook_base` spans
t=3→22. A node renders exactly once:

- `window_id == null` → its own stage's task list.
- `window_id != null` → the `WaitWindowBlock` on the **host node's** stage, in its own
  stage's colour.

`StageSpan.inline_work_min` (work not absorbed into a window) drives the `~N min` pill,
so the pill always matches the tasks visible on that card.

---

## What was built

### Scheduler — `apps/api/abc_cook/`

- **`schema/plan.py`** — added `StageSpan` (`stage_id`, `start_min`, `end_min`,
  `elapsed_min`, `work_min`, `windowed_work_min`, `inline_work_min`, `node_ids`).
  Not added to `CookingPlan`.
- **`schedule/rollup.py`** (new) — `stage_spans(graph, plan) -> list[StageSpan]`, pure,
  in `graph.stages` order, empty stages omitted. `_round` to `windows.MINUTE_DP`.
- **`schema/api.py`** (new) — `RecipeSummary`, `RecipeListResponse`,
  `RecipePlanResponse { graph, plan, stages }`.
- **`api/routes/recipes.py`** (new) — fixture loader (reads `tests/fixtures/`,
  **M2-only**, replaced by Supabase at M5), reads `<slug>.kitchen.json` for
  `burner_capacity`. `GET /recipes`, `GET /recipes/{id}/plan` (404 on unknown).
- **`api/main.py`** — router wired; added `allow_origin_regex` for private-LAN Vite
  origins when `APP_ENV=local`, so a phone on the same wifi works without hand-listing
  its IP.
- **Tests** — `test_rollup.py` (27, incl. hand-asserted `kadai-paneer` overlap),
  `test_api_recipes.py` (19, incl. golden-plan-parity through the route, the
  `uses 2 burners` sidecar check).

### `make types` — retired the stub

- **`scripts/export_schema.py`** — `models_json_schema([RecipePlanResponse,
  RecipeListResponse])` → `packages/schema/schema.json`, with a normalisation pass that
  strips the `title` *keyword* (not the property) and collapses `$ref`+sibling so the
  generator stops cloning `CookingGraph1`.
- **`scripts/export_web_fixtures.py`** — freezes three `RecipePlanResponse` payloads
  into `apps/web/src/plan/__fixtures__/` for the web unit tests (which have no Python).
- **`packages/schema/`** (new) — `json-schema-to-typescript` → `index.ts`, committed.
- **`Makefile`** — `types` runs all three steps; `install` also does
  `packages/schema`; forward-slash venv paths so it runs under cmd *or* Git Bash;
  `test` now also runs `npm test`; web `lint` now runs `tsc -b` too.

### Web — `apps/web/`

- **Toolchain (step 0):** `node_modules` was missing and Tailwind was mis-wired —
  lockfile pinned v4 but config was all v3. Fixed: `@tailwindcss/postcss`, `@import
  "tailwindcss"` + `@theme` in `index.css`, deleted `tailwind.config.js`.
  `tsconfig.app.json` gained `"strict": true` (was absent — CLAUDE.md requires it) and
  the `@abc-cook/schema` path alias. `vitest` pinned to `4.1.11` (3.x doesn't support
  Vite 8; `^4.1.11` tripped an npm arborist bug) with `.npmrc` `legacy-peer-deps=true`
  (`@vitejs/plugin-react@6` peer-requires Vite 8, others don't).
- **`src/api/client.ts`** — `fetchRecipes` / `fetchPlan`, base URL defaults to
  `http://<page-hostname>:8000` (the thing that makes phone testing work), `ApiError`
  carries status.
- **`src/plan/derive.ts`** — the *only* place graph + plan are joined. Groups, sorts,
  looks up by id; **adds/subtracts/scales no minute value**. Unit-tested against the
  frozen fixtures (11 tests).
- **`src/plan/`** — `RecipeHeader`, `PlanScreen` (tabs + warnings banner + disabled
  CTA), `StageCard` (collapse/expand, default expanded), `WaitWindowBlock` (the
  signature component), `IngredientsPanel`, `stageColor.ts`.
- **`src/App.tsx`** — recipe picker → loading → plan / error.
- **`.env.example`** (new) + `apps/api/.env.example` CORS note.

---

## Number provenance held

`kadai-paneer` on screen, and where each value comes from:

| UI | Source |
|---|---|
| "9 min prep" | `window.used_min` |
| "fits in 12 min" | `graph.nodes["cook_tomato_base"].duration_typical` |
| "saves you 9 min" | `plan.saved_min` |
| Prep `~5 min` | `stages[prep].inline_work_min` |
| "Start with this one" | `scheduled[id].rank_in_window == 0` |
| task `· 5 min` | `graph.nodes[id].duration_typical` |
| stage tint | stage index in `graph.stages`, `% 6` |
| "Uses 2 burners" | `plan.warnings` |

No prototype demo values (`8 min` prep, 3-task Cook Base, 7:32 timer) appear anywhere.

---

## Open items / deferred

1. **The five-second person test** (ROADMAP M2 exit) — not yet run.
2. **`Stage.color_key`** — now unused by the renderer. Remove at M4 or note it stays for
   a future purpose.
3. **Fixture loader reaches into `tests/`** — won't survive packaging. Replace at M5.
4. **`homemade-donuts` / `strawberry-shortcake`** — render but weren't walked
   screen-by-screen this session. Worth a look before the person test.
5. **Stage-pill semantics** (`inline_work_min`) — the plan predicted this would be the
   thing to reconsider on-device. It reads fine so far; watch it during the person test.
6. **`.npmrc legacy-peer-deps`** — a workaround for Vite-8-era peer ranges. Revisit when
   `@vitejs/plugin-react` / `vitest` catch up.
7. **M2.5 (design direction)** is next per ROADMAP — dark palette + ALL-CAPS eyebrow +
   middle-dot meta are all still "under review" in `DESIGN_SYSTEM.md`.

---

## Next: M2.5 — Design direction

Per `ROADMAP.md`: one evening with the `frontend-design` skill loaded, reacting to the
real screens this session produced. Write the brief into `DESIGN_SYSTEM.md`. Spend the
boldness on the Map view (M2.75); keep the Plan view quiet.
