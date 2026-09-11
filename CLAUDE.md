# ABC Cook — Project Instructions for Claude Code

## What this product is

ABC Cook turns any recipe into a **cooking plan**: a dependency graph the app schedules
for one cook with two hands, so the user always knows what to do *now* and what to do
*while something else is cooking*.

The one-sentence test for every feature:

> Does this help the user cook the dish faster or with less confusion than reading the
> recipe would?

If no, it does not ship in v1.

**We are not building** a recipe database, a social feed, a meal planner, a recipe
saver, or "an app that converts recipes into pretty grids." Those are all crowded.
See `docs/PRODUCT.md` for the competitive reasoning behind that.

Two differentiators, in this order:

1. **The visual cooking graph.** Competitors (ReciMe and similar) stop at "here are
   the ingredients, nicely organised." We start where they stop: we show how the dish
   is actually built and cooked. This is USP #1 and the only one in scope now.
2. **Ingredient ordering** via quick-commerce apps by pincode. Real, valuable, and
   deliberately parked — see `docs/PRODUCT.md` § Phase 3+.

Because USP #1 is *visual*, the quality of the graph view is not polish applied at the
end. It is the product. `docs/GRAPH_VIEW.md` is its spec.

## The moat, stated precisely

The moat is **the structured cooking graph plus the scheduler**, not the LLM and not
the visual style.

```
Recipe (any format)
   └─> [LLM, once per import] ──> CookingGraph JSON
                                      └─> [deterministic scheduler, no LLM] ──> CookingPlan
                                                                                   └─> renderers: Plan / Timeline / Step-by-step / Grid
```

Two rules that follow from this, and that you should treat as hard constraints:

1. **The LLM extracts; it never schedules and never renders.** Parallel-task
   suggestions, timings, and the "9 min prep fits in 12 min cooking" numbers are all
   computed in Python from the graph. An LLM asked to "suggest what to do while this
   cooks" will hallucinate plausible-but-wrong parallelism.
2. **Never generate the plan as an image.** Structured JSON → React renderer. Images
   can't be tapped, scaled, timed, or translated.

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite, mobile-first PWA | Continues the Figma Make export; no SSR needed until public recipe pages matter |
| Styling | Tailwind CSS | Tokens in `docs/DESIGN_SYSTEM.md` |
| Backend | Python 3.12 + FastAPI + Pydantic v2 | Owner's primary language |
| DB / auth / storage | Supabase (Postgres) | Free tier is enough for the MVP |
| LLM | One provider behind an adapter interface | Never call a provider SDK from route handlers |
| Deploy | Cloud Run (api, Mumbai region) + Vercel/Netlify (web) | |

Target device: **390 × 844**. Design for one thumb, in a kitchen, with wet hands and a
screen that may be timing out. Desktop is a scaled-up afterthought, not a separate design.

## Repo layout

```
abc-cook/
├── CLAUDE.md                  ← you are here
├── docs/
│   ├── PRODUCT.md             ← positioning, competitors, what we refuse to build
│   ├── COOKING_GRAPH.md       ← THE spec: schema + scheduler algorithm. Read before touching either.
│   ├── GRAPH_VIEW.md          ← how the graph is drawn on a phone. USP #1.
│   ├── DESIGN_SYSTEM.md       ← tokens, stage colors, component states
│   └── ROADMAP.md             ← milestones M0–M5 and their exit criteria
├── apps/
│   ├── web/                   ← React + Vite PWA
│   └── api/                   ← FastAPI
│       ├── abc_cook/
│       │   ├── schema/        ← Pydantic models = single source of truth
│       │   ├── extract/       ← LLM adapters + prompt + validation/repair loop
│       │   ├── schedule/      ← the scheduler. Pure functions. No I/O, no network.
│       │   └── api/           ← routes
│       └── tests/
│           └── fixtures/      ← golden recipes + expected plans
└── packages/schema/           ← TS types generated from the Pydantic JSON Schema
```

## Non-negotiable engineering rules

- **`abc_cook/schema/` is the single source of truth.** TS types are *generated* from
  Pydantic JSON Schema (`make types`). Never hand-write a TypeScript interface that
  mirrors a Pydantic model — they will drift.
- **`abc_cook/schedule/` is pure.** Deterministic functions, no network, no DB, no clock
  reads, no randomness. Same graph in, same plan out, every time. This is what makes
  it testable and what makes the product trustworthy.
- **Every LLM output is validated before use.** Parse → Pydantic → graph invariants
  (see `docs/COOKING_GRAPH.md` §5). On failure: one repair pass with the errors fed
  back, then fall back to a plain linear step list. **The app must never fail to show
  a recipe** just because the graph was malformed.
- **One LLM call per import.** Two only when the repair pass fires. If you find
  yourself adding a per-interaction LLM call, stop and ask — that is a cost and
  latency regression.
- **Every scheduler change runs the golden fixtures.** `pytest tests/test_schedule.py`.
  If a fixture's expected plan changes, that is a product decision, not a test fix —
  surface it rather than updating the expected file silently.
- **Timers survive backgrounding.** Store the absolute wall-clock end time, never a
  counting-down integer in React state. Phones sleep; kitchens are slow.
- **The frontend is a renderer of `CookingPlan`, nothing more.** It must never
  independently infer dependencies, durations, parallelism, savings, or scheduling
  decisions. Every number on screen — cooking time, parallel prep capacity, time saved
  — originates from the scheduler. If you see a duration in a `.tsx` file that isn't
  read from the plan JSON, that's a bug.
- **No hardcoded demo numbers.** Kadai Paneer fixture values (`9 min`, `12 min`, three
  parallel tasks) exist for tests. Production UI consumes computed `CookingPlan` data.
  Claude Code will see these numbers in Figma screenshots — do not copy them into
  components.
- **"Can these two things happen at the same time?" is a scheduler question.** Not an
  LLM question, not a frontend question. The scheduler is the single owner of
  parallelism decisions.

## Conventions

- Python: `ruff` + `mypy --strict` on `abc_cook/schema` and `abc_cook/schedule`. Type hints
  everywhere. Google-style docstrings on public functions.
- TS: `strict: true`. No `any`. Components in `PascalCase.tsx`, hooks in `useThing.ts`.
- Commits: conventional commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`).
- Tests: pytest for the API, Vitest for web logic. UI is verified by hand on a phone —
  don't write brittle snapshot tests for the cooking screens.
- Secrets live in `.env` (gitignored). `.env.example` is committed and must stay current.

## Vocabulary — use these exact words

Mixing these up in code or copy is how the product gets muddy.

| Term | Meaning | User-facing? |
|---|---|---|
| **Cooking Graph** | The internal DAG of nodes and dependencies | No — internal only |
| **Cooking Plan** | The scheduled, renderable output the user sees | Yes |
| **Stage** | A named group of nodes: Prep, Cook Base, Add Veggies, Finish | Yes |
| **Node** | One unit of work in the graph | No |
| **Wait window** | An unattended interval that can host prep work | No |
| **Parallel task** | A prep node the scheduler placed inside a wait window | Yes — surfaced under the wait-window field; wording derives from the host's `attention` (`DESIGN_SYSTEM.md` § WaitWindowBlock), **not** a fixed "while this cooks" (that assumes heat the graph can't confirm) |
| **Station** | A contended resource: burner, oven, counter, sink | No |

## Product copy rules

Learned from the Figma iterations — these were real mistakes, don't reintroduce them:

- Before cooking starts, never show consumed/elapsed language. `"9 of 12 min used"` is
  wrong. `"9 min prep · fits in 12 min"` is right.
- Capacity bars are not progress bars. Style them differently or the user reads them as
  progress on a task they haven't begun.
- Parallel tasks are ranked, not a flat list. Always name a first task
  ("Start with: Chop capsicum · 5 min"), then the rest as secondary.
- Don't add UI to explain the concept. If the interaction needs a paragraph of
  explanation, the interaction is wrong. The aha moment should be
  *"oh — I can do those while the base cooks."*

## Design workflow

Two design inputs feed this repo. Keep them in their lanes.

**Figma (via the Figma MCP server).** The Figma Make prototype is the source of truth
for *layout, flow, and which screens exist*. When a frame is available, read it rather
than guessing at spacing and hierarchy.

Two things to know before reaching for it (established in M2.5):

- It is a Figma **Make** file (`figma.com/make/…`), not a Design file. The MCP's
  design-context tools read Design files by node id, so there are no frames to pull —
  the prototype is generated React running in a preview, and it gets read by looking at
  it. It carries Make's own "Version N" counter, and there is one design in the file;
  the `v1 → v4` versioning this file used to describe does not exist.
- **It covers the Plan view and the cooking screens only. There is no Map/graph frame.**
  The Map is greenfield and the `frontend-design` skill governs it entirely.

**The `frontend-design` skill.** Load it before any work on visual direction: palette,
typography, the graph view, or a screen's aesthetic identity. It is the counterweight
to Figma Make's output, which is fluent but converges on a generic look. Its list of
"AI-generated tells" is worth checking every design decision against.

Figma tells you *what goes where*. The design skill tells you *what it should look
like*. Where they conflict on aesthetics, the skill wins; where they conflict on flow
or information hierarchy, Figma wins — that hierarchy was arrived at through several
rounds of real critique.

Never regenerate a screen from scratch when a Figma frame for it exists. Port it, then
improve it.

## Working style for this repo

- Read `docs/COOKING_GRAPH.md` before any change to the schema, the extractor, or the
  scheduler. It is long on purpose.
- Plan before large changes: propose the file-level diff first, then implement.
- **Any milestone that changes ground colour or introduces new visual grammar needs a
  rendered screenshot at the checkpoint, not just a token table and a prose brief.**
  Learned in M2.5: the brief read correctly, the owner approved it on that basis, and the
  render didn't match it — a spur the doc described was never drawn, stage tints specified
  at 3px were invisible at true size, and the signal rail was the faintest mark on a screen
  where the doc called it the strongest. Prose and hex values cannot be reviewed for the
  thing that actually matters. Render one screen, screenshot it, and put it in front of the
  owner *before* implementing the rest.
- Related, and the reason the above is worth the round trip: **a principle written in
  `DESIGN_SYSTEM.md` that isn't visibly present in the render isn't done.** Before calling
  any visual work finished, walk the doc's principles and connector table one row at a
  time against the screenshot.
- Prefer small, reviewable commits. The owner is one person building this in evenings.
- The owner is a senior data scientist (Python, ML, production GenAI) and is newer to
  frontend. Explain frontend decisions; don't over-explain Python or model plumbing.
- When something is ambiguous, ask instead of inventing product behaviour. Inventing a
  cooking rule that's subtly wrong is worse than a missing feature — people are
  standing at a hot stove.
