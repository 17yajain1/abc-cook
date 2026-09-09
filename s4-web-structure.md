# Session 4: Web Structure — the folders M2.75 and M3 will need

**Session Name:** s4 · Web structure (between M2 and M2.5)
**Date:** 2026-09-09
**Branches:** `chore/web-structure` (PR #4) and `docs/roadmap-structure-notes` (PR #5),
both cut from `main` at `4e282a0` and merged (`2f11672`, `ba5b1d2`)
**Commits:** `d263614`, `0fe53b5`, `8b1801a`, `d565da7`

---

## Outcome

**No milestone advanced, and that was the point.** M2 shipped a Plan view that was the
web app's only feature folder, so `apps/web/src/` had no shared layer and no import
convention. M2.75 (Map view) and M3 (cooking mode) both add sibling feature folders, and
both would otherwise have had to invent one under deadline. This session put the shared
layer in place while there was still exactly one consumer to move, and wrote down — in
`ROADMAP.md`, not in a chat log — which folders are deliberately *not* being created
yet, and what has to become true before they are.

It also fixed a real bug that had shipped silently in M2: `derive.ts` was a binary file
as far as git was concerned.

`make lint` clean. **89 API tests + 20 web tests** green (web was 11 at the end of M2;
this session added 9). No behaviour changed anywhere — every test that existed before
still asserts the same thing.

---

## What was fixed: `derive.ts` was binary to git

`groupIngredients` keyed its `Map` with a literal `0x00` byte as the "no group"
sentinel. Git's binary heuristic trips on any NUL in the first 8000 bytes of a file, and
this one sat at offset 3317 — so the densest logic file in the web app had **no diffs,
no blame and no grep**, and had landed that way in PR #3. `git show` on the fix still
prints `Bin 6842 -> 7029 bytes` for exactly this reason: the pre-image was binary.

`null` is a valid `Map` key under SameValueZero, so ungrouped ingredients bucket under
it directly and the sentinel was never needed. The file now contains zero NUL bytes and
diffs normally.

The uncomfortable part: **ingredient grouping had no test coverage at all**, which is
why a change to its key type could go unnoticed. Three cases added, chosen because the
fixtures already exercise the awkward paths — Maggi's ingredients are entirely
ungrouped, and Kadai Paneer's "For the base" group is *non-contiguous* in the source
list.

---

## What was built

### `@/` path alias (`0fe53b5`)

`@/foo` resolves to `apps/web/src/foo`. With sibling feature folders arriving in M2.75
and M3, and shared code moving up a level, relative imports were about to grow `../..`
chains that break whenever a file moves.

Declared **twice on purpose**: `paths` in `tsconfig.app.json` resolves the types,
`resolve.alias` in `vite.config.ts` resolves the bundle. They read separate config and
neither infers the other, so they have to be kept in step by hand — both files carry a
comment saying so. Verified against `tsc -b` and `vite build`, not just the dev server.

No `baseUrl` — deprecated in TS 7; paths are relative to the tsconfig.

### `src/lib/` — feature-agnostic pure functions (`8b1801a`)

**`duration.ts`.** Three components were rounding minutes independently:
`RecipeHeader.formatMinutes`, `WaitWindowBlock.round`, and a bare `Math.round` inside
`StageCard`'s JSX. Same input domain, three implementations — free to drift into
displaying the same scheduler value two different ways *on the same screen*. Now one
`roundMin` / `formatMinutes` pair, with a docstring stating the rule that matters:
**these format, they never compute.** Adding two minute values together belongs in
`abc_cook/schedule/` (CLAUDE.md — the frontend never derives a duration, a capacity or a
saving).

**`stageColor.ts`** moved out of `plan/`. Stage tints are a design-system concern (the
`--stage-N` tokens in `DESIGN_SYSTEM.md`), not a Plan-view one, and the Map view will
colour the same stages by the same rule. It was only ever in `plan/` because `plan/` was
the sole feature folder.

**No barrel `index.ts`.** A barrel makes the bundler pull a whole folder to resolve one
import — it costs Vite cold start and HMR, and invites import cycles. Imports name the
module: `@/lib/duration`.

`src/lib/` is deliberately **not** a component library. See below.

### `ROADMAP.md` structure notes (`d565da7`)

23 lines recording *when* three folders earn their place, and why each waits:

- **`src/components/global/` → M2.75.** The Map view is the first *second consumer* of
  the Plan view's pieces. Extracting a primitive from a single caller is guesswork, and
  a wrong abstraction is harder to undo than a duplicated component. Everything else
  stays feature-first: `src/plan/` and `src/map/` own their own pieces, so a view can be
  deleted by deleting a folder.
- **`src/store/` → M3.** A live cooking session (current stage, running timers, what's
  been marked done) is the first genuinely global state in the app. A view union in one
  `useState` in `App.tsx` has been enough until now, and a store before there was state
  to put in it would have been ceremony. Zustand over React context — an unmemoised
  context value re-renders every consumer, which with a timer ticking means the whole
  tree once a second on a phone. Its `persist` middleware is the natural home for
  wall-clock end times (never a counting-down integer — CLAUDE.md).
- **`src/hooks/` → M3.** `useTimer`, `useWakeLock`. Keeps components presentational and
  makes the timer arithmetic testable without rendering anything, which matters because
  a timer bug surfaces an hour into a real dinner.

Prompted by a colleague's folder scheme from a shipped React Native app — `components /
hooks / lib / schema / constants / store / types`. Took the parts that fit; **left out
`schema/` and `types/`**, which for this repo would mean hand-written duplicates of what
`make types` generates from Pydantic — precisely the drift CLAUDE.md forbids.

---

## Decisions locked

| Decision | Reason |
|---|---|
| Shared *functions* now, shared *components* at M2.75 | The functions already had three callers; the components have one and no evidence yet |
| Alias declared in both tsconfig and vite | They resolve separately; there is no single source for this one |
| No barrel files | The bundler pulls the folder to resolve one import — cold start, HMR, cycles |
| Feature-first stays the default | A view should be deletable by deleting its folder |
| No `schema/` or `types/` folder in web, ever | Generated from Pydantic by `make types`; a hand-written mirror is the drift CLAUDE.md forbids |
| Structure decisions live in `ROADMAP.md` | So the timing survives the gap between sessions, and nothing gets built early "because the structure said so" |

---

## Open items / deferred

Carried from M2, still open:

1. **The five-second person test** (ROADMAP M2 exit) — not yet run. The owner's to run.
2. **`homemade-donuts` / `strawberry-shortcake`** — render, but were never walked
   screen-by-screen. Worth a look before the person test.
3. **`Stage.color_key`** — unused by the renderer; `stageColor` assigns by position in
   `graph.stages` instead. Remove at M4, or write down why it stays.
4. **Fixture loader reaches into `tests/`** — won't survive packaging. Replace at M5.
5. **Stage-pill semantics** (`inline_work_min`) — reads fine so far; watch it during the
   person test.
6. **`.npmrc legacy-peer-deps`** — a Vite-8-era peer-range workaround. Revisit when
   `@vitejs/plugin-react` / `vitest` catch up.

New from this session:

7. **The alias is declared in two files and nothing enforces that they agree.** If they
   drift, `tsc` and the bundle disagree about what `@/x` means — a failure that presents
   as a caching bug. Worth a lint rule if it ever actually bites.

---

## Next: M2.5 — Design direction

Unchanged by this session, and now the only thing standing between here and the Map
view. Per `ROADMAP.md`: one or two evenings with the `frontend-design` skill loaded,
reacting to real screens on a real phone. Write the ~10-line brief into the empty
`## Design brief` section of `DESIGN_SYSTEM.md`, then **re-derive** the tokens from it
rather than patching them — the dark "spice cabinet" palette, the ALL-CAPS eyebrow and
the middle-dot meta are all still marked provisional, lifted from the Figma Make
prototype rather than chosen.

Spend the boldness on the Map view. Keep the Plan view quiet.
