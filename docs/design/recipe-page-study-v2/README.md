# Recipe page study v2 (2026-10-14)

Revision of `docs/design/recipe-page-study/` (2026-10-13). Made in Claude Design
(canvas); exported here as one self-contained interactive HTML bundle
(`recipe-page-redesign.html` — open it in a browser, it needs JS to unpack).
Live, editable canvas: https://claude.ai/artifact/9pdubbqNeoGoHw6HvPpau9

Same rule as v1: **a study proposes composition, never tokens**
(`docs/DESIGN_SYSTEM.md`). Build in the repo's tokens. Where this study and
DESIGN_SYSTEM.md disagree, ask.

## What's new in v2

Two critique frames, annotated against screenshots of the *current live app*
(not the proposal) — this is the "why" the v1 frames were answering, made
explicit:

### Today — what the screen does now (issues 1–7)

| # | Issue |
|---|---|
| 1 | Three layers of navigation (Plan/Ingredients, Plan/Map, Show full recipe, change recipe) before any cooking content |
| 2 | No photo, no source — can't tell which reel this came from or check it against the original |
| 3 | The most important fact is buried: a 2 hr soak means "start 3 hr before dinner," but it sits inside the Cook card |
| 4 | Walls of text — "You'll need" lists 19 names with duplicates (green chilli ×2, cumin ×2) |
| 5 | Map fails its own 5-second test — the soak is the tallest object, real parallel work is squeezed into "+2 more," brackets unexplained |
| 6 | Ingredients is read-only — no ticks, no servings, no way to get the missing items out |
| 7 | Feels like a second app — grey-green/black/red here vs. warm terracotta on Home |

### Today — from the walkthrough video (issues 8–14)

| # | Issue |
|---|---|
| 8 | **Keep this.** The collapsed overview (step chain + "Meanwhile:" line) is the clearest screen in the app — stays the default |
| 9 | The stage hides the wait: "Cook ~2 hr 33 min" includes the 2 hr soak; stove time is ~30 min. Group by sitting first, stage second |
| 10 | The header never shrinks — about a third of the screen is title/timings/tabs, even mid-scroll |
| 11 | No back button (only "change recipe"); a tapped stage keeps a stray focus box on its title |
| 12 | Check the schedule — "Temper spices" and "Cook potatoes" sit inside the 2 hr soak in the current build; that's not how the dish is cooked |
| 13 | Cooking mode is mostly empty — "Next: Soak 2 hours" doesn't say you can leave or what to do meanwhile; chip says "soaked sabudana" before it's soaked |
| 14 | **Keep this tone.** "Nothing is on the heat" is calm and true — the recipe page should sound like this |

Issues 9 and 12 are the direct design rationale for **PR-B (`PlanSummary.phases`)**:
the "Now → wait → Then" split this critique is asking for is exactly what phases
computes server-side, not something the frontend should infer from `scheduled`.

## The 5 proposed frames (same numbering as v1)

| Frame | Shows |
|---|---|
| `1 · Top of page — decide (Sabudana Khichdi)` | Same as v1 frame 1 |
| `2 · Plan tab, scrolled` | Same as v1 frame 2 |
| `3 · Ingredients tab` | Same as v1 frame 3 |
| `4 · End of page — source, your cooks, visibility` | Same as v1 frame 4 |
| `5 · Same layout, a one-sitting recipe` | Example recipe changed from Maki Sushi (v1) to **Aloo Gobi** (v2) |

## Do NOT copy from these frames

Same caveats as v1 — every number is illustrative (some already wrong after the
PR-A pan-chain fix and will be wrong again after PR-B phases), step text is
hand-written, `[@creator]`/`[Channel name]` are placeholders, and the
"Now / wait / Then" framing needs `PlanSummary.phases` (PR-B) — don't compute it
from `scheduled` or `long_waits` in the frontend.
