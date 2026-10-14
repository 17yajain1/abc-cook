# R2 — recipe page header + plan-ahead card

Status: **approved 2026-10-14, not implemented.** Implement in a fresh session from this
file. Branch `feat/recipe-header-r2`, worktree `../abc-cook-r2`.
**Blocked on merge by PR-B3** (`docs/plans/pr-b3-unattended-start.md`): R2 may be built and
reviewed first, but it must not merge before PR-B3 does.

## 1. Context

The recipe-page study (`docs/design/recipe-page-study/`, frames `1-top-of-page` and
`5-one-sitting-recipe`) found that the most important fact about a multi-stretch recipe is
buried: a long hands-free wait means "start hours before you eat", but it sits inside a
stage card (study issues 3 and 9). PR #48 added `PlanSummary.phases` to carry that fact.
R2 is the first visible UI that reads it:

- a source line ("From YouTube ↗"),
- a **plan-ahead card** for recipes with more than one stretch,
- a **"How this cook goes"** outline: a broken-axis mini bar plus a repeating list
  stretch → wait → stretch …, with a "Saves N min" pill,
- a sub-line under **Start cooking**.

R1 (#45) already did the Home register, back button and compact sticky bar. Frame numbers
are illustrative; build in repo tokens (`docs/DESIGN_SYSTEM.md` § Register: Home); the study
proposes composition only.

Owner principle: **approximate timing is fine; wrong advice is not.**

## 2. Hard rules

- The frontend renders, never computes cooking figures. Stretches, waits and their
  durations come **only** from `PlanSummary.phases`, plus `summary.elapsed_min`,
  `summary.elapsed_high_min` and `plan.saved_min`. Nothing from `long_waits`; no
  arithmetic between plan values (no subtraction, no sums). Formatting (rounding,
  hostname → platform name) is fine.
- **One owner-directed exception:** stretch *titles* (labels only, never a figure) select
  nodes by their `scheduled[].start_min` (decision 9).
- Window tasks come only from `plan.windows[].assigned` (backend placement).
- Never the words "phase" or "session" in UI copy (tested).
- Wait wording derives from host `attention` (DESIGN_SYSTEM § WaitWindowBlock), never a
  fixed "while it cooks" and never a process verb ("soaks", "rises") — no field names the
  process.
- `summary` or `summary.phases` null (plans saved before POSTPROCESS_VERSION 3): render the
  header without the card, without the outline and without the CTA sub-line. No fallback
  math.
- No backend changes in R2. No goldens regenerated. No commit/push until the owner reviews.

## 3. Field inventory (as of 2026-10-14)

| Need | Field | R2 action |
|---|---|---|
| Source URL | `graph.source` = `{kind: 'url', value}` (sabudana, pizza: YouTube). Donuts, kadai, rajma are `kind: 'text'` | Add `sourceUrl: string \| null` to `RenderPlan`; hide the line when null |
| Veg mark | **None** on graph or plan (only `FeedItem.diet` in `feed/mock.ts`) | Hide |
| Servings | `RenderPlan.servingsSource` → `servingsLine` (`lib/servings.ts`) | Unchanged |
| saved_min | `plan.saved_min` → `RenderPlan.savedMin` | Pill "Saves N min" when > 0 |
| Tasks done during a wait | `plan.windows[].assigned` + `host_node_id` | Exists, but those tasks are scheduled **before** the hands-free gap (sabudana: 5–18 min; gap 18–125), so they belong to the preceding stretch — see decision 8 |
| Stretch title | none on `Phase` | First → last node label (decision 9) |
| Photo / creator handle | not captured by import | Not drawn, no placeholder |

## 4. Owner decisions (all binding)

1. **Source line.** If `graph.source.kind === 'url'`, show `From <Platform> ↗` linking to it
   (new tab, `rel="noopener noreferrer"`). Platform via `platformOfUrl`
   (`home/clipboard.ts`): YouTube / Instagram, else the bare hostname without `www.`. No URL
   → no line. No creator handle.
2. **Any number of phases.** "How this cook goes" is a repeating list stretch → wait →
   stretch …. Row tags: first stretch `Now`, later stretches `Then`; wait rows carry no
   text tag (a small hatched swatch in the tag column matches the bar).
3. **Plan-ahead card shows whenever `phases.length > 1`.** No extra frontend threshold.
4. **Mini bar = broken axis.** Stretch segments are proportional to each other
   (`flex-grow` = `phase.elapsed_min`, `min-width` 6px so a short stretch stays visible);
   every wait is a fixed-width (56px) hatched gap, labelled beneath with its duration
   (same phrase as the wait row). `aria-hidden` — the rows carry the text. A 1-phase recipe
   draws one solid segment and no gap.
5. **Start-ahead** = `startAheadPhrase(summary.elapsed_high_min)`: **ceil** to 15 min below
   600 min; **ceil** to a whole hour from 600 min. Displayed minutes are always ≥ input.
   (197 → "~3 hr 30 min", because 3 hr 15 = 195 < 197.)
6. **Wait duration** = `approxWaitPhrase(phase.preceded_by_wait_min)`: **floor** (never
   round a wait up): floor to **5 min below 120 min**; floor to 15 min from 120 min to below
   600 min; floor to a whole hour from 600 min. Displayed minutes are always ≤ input. No
   "tomorrow", "a day" or clock words. (Amended 2026-10-14: 15-min flooring hid 12 of
   donuts' 57 min and printed "~45 min" beside the Rise card's "~1 hr". 57 → "55 min".)
7. **Wait row text.** If the following phase has `starts_new_session` →
   `Come back ~N later`. Otherwise from the hosts' (`preceded_by_host_node_ids`) attention:
   any unattended → `Hands free for ~N`; only periodic → `Check now and then for ~N`; no
   hosts → `Wait ~N`. (Phase gaps exclude periodic nodes by definition, so in practice
   it's "Hands free".) **Wait rows never list tasks.**
8. **Task line under a stretch.** For each window, tasks = `window.assigned` ∩
   `phase.node_ids`, in the window's order; a task appears only under the stretch whose
   `node_ids` contain it (a window spanning two stretches splits). Exclude tasks already
   named in that stretch's title; omit the line if none remain. Lead by host attention:
   unattended → `Meanwhile:`; periodic → `While checking the pan now and then:` (from
   `attentionLine` in `plan/WaitWindowBlock.tsx`). **Never "hands free" on a stretch row.**
   **Order (amended 2026-10-14): `scheduled[].start_min` ascending, ties broken by
   `window.assigned` order.** `assigned` is rank order ("start with this"), not cooking
   order: in sabudana it lists Grind peanuts before Roast peanuts although Grind depends
   on Roast. Reading `start_min` is a read of plan timestamps, the same kind as decision 9's
   exception, not a computation.
   Show the first two labels, then `+N more`.
9. **Stretch title** = first → last label, joined with ` → `, among the phase's
   `node_ids` (in order) whose `scheduled` start lies within `[phase.start_min,
   phase.end_min]` inclusive; if none qualify, use all `node_ids`. One qualifying node →
   just its label. `line-clamp-2` with ellipsis at 390 px, never wrapping past two lines.
10. **Stretch time** = `formatRange(phase.elapsed_min, phase.elapsed_high_min)`
    (`lib/duration.ts`); its `about N min` collapse renders as `~N min`. A 1-phase recipe
    uses `summary.elapsed_min` / `summary.elapsed_high_min` (the plan's elapsed range).
11. **Plan-ahead card copy.**
    - 2 phases, second not a new session: `Plan ahead: ~W hands free in the middle` /
      `Start ~S before you want to eat.`
    - 2 phases, second starts a new session: `Plan ahead: come back ~W later` /
      `Start ~S before you want to eat.`
    - more than 2 phases and `summary.sessions.length` > 1 (O1): `Plan ahead: this cook
      spans N sittings` (N = `summary.sessions.length`) / `Start ~S before you want to eat.`
    - more than 2 phases in one sitting (added 2026-10-14): `Plan ahead: N hands-free breaks,
      the longest ~W` (N = number of waits, W = `approxWaitPhrase` of the longest
      `preceded_by_wait_min`, a selection not arithmetic) / `Start ~S before you want to eat.`
    (W = `approxWaitPhrase`, S = `startAheadPhrase`.)
12. **Start-cooking sub-line.**
    - 1 phase: `Start to finish in one go.`
    - 2 phases: `First <time>: <title>. The rest is ~W later.`
    - more than 2: `First <time>: <title>. Then <N−1> more stretches over ~S.`
13. **1-phase recipes** (kadai): no card, no wait row, no hatched gap (kadai's 12-min
    periodic wait must not appear). Outline still shows: heading, pill, one solid bar, one
    `Now` row with the plan's elapsed range and the task line (decision 8).
14. **Header timing.** When the card shows, drop `headerTiming`'s multi-sitting
    `Start about ... before you eat` secondary (the card replaces it). A single-sitting recipe
    keeps its range and its `~N min hands-on` secondary (sabudana `~60 min hands-on`, donuts
    `~40 min hands-on`; tested in `headerMeta.test.ts`). A multi-sitting recipe
    (`summary.sessions.length` > 1) shows **servings only** in the meta line, see O3.
15. **R1 saved sentence** ("This plan saves you …") is replaced by the pill whenever the
    outline shows; kept as is when `phases` is null.
16. **PR body follow-up note:** "Phase titles like 'Cook, finish and serve' would need
    backend-generated names (candidate for PR-D / prompt v8)."

### Open questions for the owner (raise at the Step 1 checkpoint, do not decide alone)

- **O1 — "N sittings" after PR-B3 (APPROVED 2026-10-14).** Pizza today: 3 phases = 3 sessions. After PR-B3 pizza
  has **4 phases but 3 sessions**, so "spans 4 sittings" would be wrong. Recommendation:
  N = `summary.sessions.length` (a read, not a computation), and use the >2 form only when
  that is > 1; otherwise fall back to the 2-phase form's wording. Needs approval.
- **O2 — zero-length stretch after PR-B3 (RESOLVED 2026-10-14: PR-B3 option a).** Pizza's
  "Remove the dough" stretch has `elapsed_min` 0 and stays 0 in the data. R2 omits the time
  for any stretch whose `elapsed_min` and `elapsed_high_min` are both 0 (no "~0 min"); tested
  with a cloned fixture.
- **O3 — header meta for multi-sitting recipes (APPROVED 2026-10-14: servings only).** Once
  decision 14 drops "Start about … before you eat", `headerTiming.primary` shows only the
  last sitting (pizza "30–50 min", rajma "50–60 min"), which reads as total time.

## 5. Exact copy per fixture

Meta line (servings + `headerTiming`) is R1's and not repeated except where decision 14
changes it.

### Sabudana — `sabudana-khichdi` (2 phases: 0–18, wait 107, 125–170; saved 13; YouTube)
- Source: `From YouTube ↗` → `https://www.youtube.com/watch?v=oHHFafPET90&t=9s`
- Card: **Plan ahead: ~1 hr 45 min hands free in the middle** / Start ~3 hr 30 min before
  you want to eat.
- `How this cook goes` · pill `Saves 13 min`
- Bar: ▬ 18 · ▨ `~1 hr 45 min` · ▬ 45
- `Now` **Soak sabudana → Make chutney** · 20–30 min · Meanwhile: Roast peanuts, Grind
  peanuts
- ▨ Hands free for ~1 hr 45 min
- `Then` **Stir once → Serve with chutney** · 45–70 min
- CTA sub-line: First 20–30 min: Soak sabudana → Make chutney. The rest is ~1 hr 45 min
  later.

### Donuts — `homemade-donuts` (2 phases: 0–21, wait 57, 78–138; frying gap not split; saved 15; no URL)
- No source line.
- Card: **Plan ahead: ~55 min hands free in the middle** / Start ~2 hr 45 min before you
  want to eat.
- Pill `Saves 15 min`; bar ▬ 21 · ▨ `~55 min` · ▬ 60
- `Now` **Bloom yeast → Grease tray** · 20–35 min *(no task line: Grease tray is the only
  window task and is already in the title)*
- ▨ Hands free for ~55 min
- `Then` **Roll and cut → Glaze donuts** · 60–75 min
- CTA sub-line: First 20–35 min: Bloom yeast → Grease tray. The rest is ~55 min later.

### Pizza — `pizza-dough` (current fixture: 3 phases = 3 sessions; saved 0 → no pill; YouTube)
- Source: `From YouTube ↗` → `https://youtu.be/WM1XcYXix0Y`
- Card: **Plan ahead: this cook spans 3 sittings** / Start ~25 hr before you want to eat.
- Header meta: servings only. The old "Start about a day before you eat" secondary and the
  last-sitting "30-50 min" are both dropped (decision 14, O3).
- Bar: ▬ 10 · ▨ `~4 hr 30 min` · ▬ 10 · ▨ `~19 hr` · ▬ 30
- `Now` **Small bowl stir together → Cover the bowl** · ~10 min
- ▨ Come back ~4 hr 30 min later
- `Then` **Transfer dough → Cover and refrigerate overnight** · ~10 min *(Remove the dough
  at 1370 and Place a pizza stone at 1430 fall outside 280–290, so decision 9 keeps them
  out of the title)*
- ▨ Come back ~19 hr later
- `Then` **Lightly flour a pizza → Transfer the pizza** · 30–50 min
- CTA sub-line: First ~10 min: Small bowl stir together → Cover the bowl. Then 2 more
  stretches over ~25 hr.
- ⚠ The "Come back ~19 hr later" row is wrong advice today (the dough must come out of the
  fridge ~70 min earlier). That is PR-B3's fix, not R2's. After PR-B3 the pizza fixture is
  regenerated and this copy changes (expected: 4 stretches, waits ~4 hr 30 min / ~18 hr /
  ~1 hr; see O1, O2). Unit tests pin whichever fixture is on the branch.

### Kadai — `kadai-paneer` (1 phase; saved 9; no URL)
- No source line, no card, no wait row, no hatched gap.
- Pill `Saves 9 min`; bar: one solid segment.
- `Now` **Chop onion → Finish** · 35–50 min · While checking the pan now and then: Cube
  capsicum, Cube paneer +1 more
- CTA sub-line: Start to finish in one go.

### Rajma — `synthetic-two-sittings` (2 phases: 0–3, wait 480, 483–535, second is a new session; saved 0; no URL)
- Card: **Plan ahead: come back ~8 hr later** / Start ~9 hr 15 min before you want to eat.
- No pill; bar ▬ 3 · ▨ `~8 hr` · ▬ 52
- `Now` **Rinse beans → Soak beans** · ~3 min
- ▨ Come back ~8 hr later
- `Then` **Saute and add beans → Serve** · 50–60 min
- CTA sub-line: First ~3 min: Rinse beans → Soak beans. The rest is ~8 hr later.

### `phases` null (or `summary` null)
- Header as R1: title, source line if URL, meta, R1's saved sentence if `savedMin > 0`,
  R1's `headerTiming` secondary unchanged. No card, no outline, no CTA sub-line.

## 6. Files

| File | Change |
|---|---|
| `apps/web/src/lib/duration.ts` | Add `approxWaitPhrase(min)` (floor, decision 6) and `startAheadPhrase(min)` (ceil, decision 5). Return the bare phrase ("1 hr 45 min"); callers add `~`. Formatting only |
| `apps/web/src/lib/source.ts` (new) | `sourceLink(url: string \| null)` → `{ name, href } \| null`; reuses `platformOfUrl` |
| `apps/web/src/plan/cookOutline.ts` (new, pure, no JSX) | `deriveCookOutline({ summary, nodes, scheduled, windows, savedMin })` → `CookOutline \| null` = `{ stretches: {tag, title, time, barWeight, taskLines[]}[], waits: {text, barLabel}[], savedPill, card, ctaSubline }`. Every user-facing string is built here |
| `apps/web/src/plan/derive.ts` | Add `sourceUrl` and `outline` to `RenderPlan`; call `deriveCookOutline` |
| `apps/web/src/plan/CookOutlineView.tsx` (new; not `CookOutline.tsx`, which collides with `cookOutline.ts` on case-insensitive filesystems) | Heading + pill, `MiniBar`, rows. Home tokens only (`home-ink`, `home-ink-2`, `home-rule`, `home-thumb`, `field`, terracotta text for tags); hatch = `repeating-linear-gradient` from tokens |
| `apps/web/src/plan/PlanAheadCard.tsx` (new, Step 2) | Card |
| `apps/web/src/plan/RecipeHeader.tsx` | Step 1: outline under meta, pill replaces saved sentence. Step 2: source line, card, drop duplicate secondary |
| `apps/web/src/plan/PlanScreen.tsx` (Step 2) | CTA sub-line under Start cooking |

Reuse: `formatRange`, `formatMinutes` (`lib/duration.ts`), `attentionLine`
(`plan/WaitWindowBlock.tsx`), `platformOfUrl` (`home/clipboard.ts`), `servingsLine`.

## 7. Tests (Vitest)

`apps/web/src/lib/duration.test.ts`
- `startAheadPhrase`: 195 → "3 hr 15 min", 196 → "3 hr 30 min", 197 → "3 hr 30 min",
  158 → "2 hr 45 min", 543 → "9 hr 15 min", 600 → "10 hr", 601 → "11 hr",
  1493 → "25 hr". Property: for every int 1..3000, displayed minutes ≥ input.
- `approxWaitPhrase`: 57 → "55 min", 59 → "55 min", 60 → "1 hr", 107 → "1 hr 45 min", 119 → "1 hr 55 min",
  270 → "4 hr 30 min", 480 → "8 hr", 1150 → "19 hr". Property: for every int 45..3000,
  displayed minutes ≤ input.

`apps/web/src/lib/source.test.ts` — youtube.com, youtu.be, m.youtube.com, instagram.com
reel, bare domain (`www.` stripped), null, invalid URL.

`apps/web/src/plan/cookOutline.test.ts`
- One test per fixture asserting the §5 strings exactly: sabudana, donuts (also: 2
  stretches, 1 wait — frying gap not split), pizza, kadai (1 stretch, 0 waits, no card),
  rajma.
- `summary: null` and `phases: null` → `null`.
- Across **every** `*.plan-response.json` fixture: no wait row has tasks; no string matches
  `/phase|session/i`; no stretch row contains "hands free"; every window task appears in
  exactly one stretch's task line or title.
- Task-line order: across every fixture, tasks within each task line are in non-decreasing
  `start_min` order (sabudana: Roast peanuts before Grind peanuts).
- Split case: a cloned sabudana fixture with one window task moved into phase 2's
  `node_ids` → it appears only under phase 2.
- Title exclusion: donuts phase 1 has no task line.

Run: `npm test` and `npm run lint` in `apps/web`; `npm run e2e` (overflow at 360–430 px).

## 8. Execution

**Step 1 — then STOP for owner review.**
1. `approxWaitPhrase` + tests.
2. `cookOutline.ts` for stretches, waits, task lines, pill (no card, no CTA yet) + tests.
3. `CookOutline.tsx`, wired into `RecipeHeader` under the meta line; pill replaces R1's
   saved sentence when the outline shows.
4. Screenshots at **390 px** wide for sabudana and pizza (also kadai if cheap): a scratchpad
   Playwright script that seeds `localStorage['abc-cook:library:v1']` with the fixtures (as
   `apps/web/e2e/overflow.spec.ts` does), opens each from Cookbook, and screenshots the top
   of the page. Check the body background is light (Dark Reader inverts local previews).
5. Walk DESIGN_SYSTEM § WaitWindowBlock and decisions 2, 4, 7–10, 13 row by row against the
   screenshots. Report, raise O1/O2, **STOP**.

**Step 2 (after approval):** `startAheadPhrase`, plan-ahead card, source line, header
secondary change (decision 14), CTA sub-line, their tests, screenshots again, STOP.

**PR (after owner review):** conventional commits; body written to a UTF-8 file, `gh pr
create --body-file <file>`, then read it back with `gh pr view`. Include decision 16's
note and "blocked on PR-B3". Never commit to main.

## 9. Environment notes

- Worktree `C:\Users\ashya\Music\abc-cook-r2` on `feat/recipe-header-r2`. Don't `cd` to the
  main checkout.
- Python: `PYTHONPATH=apps/api` (the editable install points at the main checkout).
- `make types` fails in worktrees (space in "ABC cook"); run its steps by hand if needed.
  R2 needs no schema change.
- Hard stop before regenerating any golden or web fixture.
- No commit/push until the owner reviews.

## 10. Verification

- `npm test`, `npm run lint` (tsc + oxlint), `npm run e2e` green.
- 390 px screenshots for every fixture in §5 match the copy exactly.
- `phases: null` renders R1's header unchanged (load an older saved recipe or strip
  `summary.phases` from a fixture in the screenshot script).
- Grep the diff: no duration in a `.tsx` that isn't read from the plan.

## 11. Addendum 2026-10-14 (Step 2 review)

- Multi-sitting recipes (pizza, rajma): meta line is servings only (O3). Cooking mode's header
  has the same last-sitting problem: `followup-cooking-mode-header-timing.md`.
- Donuts' outline says `~55 min` while the Rise card says `~1 hr`: accepted for R2,
  `followup-stage-card-rounding.md`.
- Window task order: PR-B4 (`followup-window-task-order.md`) must merge before R2, with PR-B3.
- `packages/schema/index.ts` was hand-regenerated (stale since PR #48); noted in the PR body.
- The overflow e2e test's timeout is raised to 60 s in its own commit.
