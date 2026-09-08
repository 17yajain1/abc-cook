# Design System

Derived from the Figma Make prototype and the Kadai Paneer storyboards. **When the
Figma Make export lands in `apps/web/`, reconcile these values against the real
`index.css` and treat the export as authoritative for exact hex codes.** The
*structure* below — what a token is for — is what should survive.

> **Status: provisional.** The token *structure* is sound. The values below were
> updated in M2 to the dark "spice cabinet" palette from the Figma Make prototype
> (`tED8srEMVSRjmWs13UfBOW`) — a deliberate move off the generic cream-and-green
> default, but **not** the considered design direction. That is still M2.5's job, done
> with the `frontend-design` skill and real screens on a real phone. When it lands,
> write the brief into the section directly below and re-derive these tokens from it.
>
> M2 kept the system font stack (the no-webfont rule below still holds) and deferred
> all typography decisions to M2.5.
>
> ## Design brief
>
> _(To be written. Should be ~10 lines: the subject and audience, a 4–6 value named
> palette, the typefaces and their roles, the layout concept, and the two or three
> principles that make this product's look its own. Everything below should then be
> re-derived from it rather than patched.)_

## Canvas

- Target: **390 × 844** (iPhone 14 class). Design here first.
- Safe area bottom: 34px. The primary CTA is fixed above it.
- Content gutter: 16px. Card radius: 16px. Card gap: 12px.
- Tap targets: **≥ 44 × 44**. Cooking happens with greasy fingers.

## Color

Dark ground, warm cream ink, saffron for anything the cook acts on. The live source of
truth is the `@theme` block in `apps/web/src/index.css`; this table is the intent.

```css
--color-ground:          #1C1109;   /* deep espresso — the page */
--color-surface:         #241708;   /* cards, task rows */
--color-surface-raised:  #2C1E0F;   /* pills, disabled CTA */
--color-line:            #3A2810;   /* hairline dividers */
--color-line-strong:     #6B4A1C;   /* card borders, connectors */

--color-ink:             #F5EDD8;   /* primary text */
--color-ink-muted:       #B8A888;   /* secondary text, meta */
--color-ink-dim:         #7A6650;   /* tertiary, timestamps */

--color-saffron:         #E8A020;   /* every primary CTA, active tab, ⚡ wait-window chrome */
--color-saffron-tint:    #3A2010;   /* saffron chip background */
--color-terracotta:      #C4521A;   /* heat / urgency accent (unused until M3) */

--color-verified:        #4CAF7D;   /* "this fits", completion */
--color-verified-tint:   #152C1E;

--color-window:          #211409;   /* wait-window body */
--color-window-head:     #2C1A0A;   /* wait-window header */
```

**Stage colors.** Each stage gets one hue from a fixed six, assigned by the stage's
**index** in `graph.stages` (`index % 6`), never by `Stage.color_key` — recipes have
arbitrary stages. Used as a short vertical accent bar on each task and the numbered
badge. Saffron is *not* in this ramp; it is reserved for CTAs and wait-window chrome.

```css
--stage-0: #F2B134;  --stage-1: #D4622A;  --stage-2: #7FB069;
--stage-3: #A78BFA;  --stage-4: #4EA8DE;  --stage-5: #DE7BA0;
```

A task the scheduler moved into another stage's wait window keeps **its own** stage's
colour inside that window block — that is how the eye reads it as borrowed work.

## Type

System stack (`-apple-system, "Segoe UI", Roboto, sans-serif`). No webfont — it costs
a render blocking round trip and this app is used on kitchen wifi.

| Role | Size / weight |
|---|---|
| Screen title | 24 / 700 |
| Recipe title | 22 / 700 |
| Stage label | 17 / 600 |
| Step instruction | 16 / 400, line-height 1.5 |
| Task label | 15 / 500 |
| Duration / meta | 13 / 500, `--text-muted` |
| Section eyebrow (`WHILE THIS COOKS`) | 12 / 700, letter-spacing 0.08em, uppercase |
| Timer digits | 44 / 300, tabular-nums |

`font-variant-numeric: tabular-nums` on every timer and duration, or the digits jitter
as they count down.

## Components and their states

### StageCard
`collapsed` · `expanded` · `active` · `complete` (M2 ships the first two; `active` /
`complete` are M3).

Collapsed shows: index badge (in the stage colour), label, `~N min`, one-line task
summary, chevron. Expanded shows the task rows and any wait-window block this stage
hosts. Complete will swap the index badge for a green check and strike nothing through —
struck text is hard to read at a glance.

`~N min` is the stage's **inline** work — `StageSpan.inline_work_min`, the tasks still on
this card after the scheduler moved others into a window. A stage whose tasks *all* got
moved is dropped from the plan entirely (its tasks show in the windows that borrowed
them), the same way the scheduler drops empty wait windows.

### WaitWindowBlock — the signature component

Visually attached to its host stage card, not floating as a separate "tips" section.
That attachment is what makes the concept legible; it was the main fix from the design
review.

```
⚡ WHILE THIS COOKS
9 min prep · fits in 12 min
────────────────────────────────────────────
[ 🔥 12 min cooking ]  ›  [ ✓ 9 min prep ]
────────────────────────────────────────────
▎ Cube capsicum                            ›
  Start with this one · 5 min
▎ Cube paneer · 2 min                      ›
▎ Make kadai masala · 2 min                ›
────────────────────────────────────────────
All this prep fits inside the 12 min cook
```

The `▎` is the borrowed task's own stage colour. Footer switches on `window.slack_min`:
`0` → "All this prep fits inside the N min cook"; otherwise "Fits with N min to spare".

Rules:
- Header text is **capacity**, never consumption. `"9 min prep · fits in 12 min"`.
  Never `"9 of 12 min used"` — the user hasn't started.
- The first task is visually primary (`Start with this one`), the rest secondary
  (`Also prepare`). A flat list of three equal tasks makes the user ask "which one?"
- Tasks are rows with a chevron — they must read as tappable, not as recipe notes.

### Capacity chips
Two chips side by side inside the wait-window block: `🔥 N min cooking` and
`✓ N min prep`, both fed from the plan (`host.duration_typical` and `window.used_min`).
This replaces the earlier "two stacked bars" sketch — M2 found that anything bar-shaped
reads as progress on a screen shown before cooking starts, which is the one thing the
component must not do (see the rejected list below). Chips can't be misread that way.
Left number is the cook time, right number is the prep that fits inside it.

### Timer
Circular ring, remaining time in the center, `Pause` and `Skip (I'll do this later)`.
Persists in a compact header bar when the user opens a parallel task, so the main cook
never disappears from view.

**Store the absolute end timestamp, not a countdown integer.** Recompute remaining on
every render and on `visibilitychange`. Phones sleep.

### ParallelTaskDetail
Full-screen focus view: running-timer header, task title, image, instruction, optional
tip, `Mark Complete`, `Back to Cooking`. One task, nothing else.

### PrimaryCTA
Full-width, fixed above the safe area, 52px tall, `--primary`. There is exactly one on
screen at a time.

## Motion

- Stage expand/collapse: 200ms ease-out height + opacity.
- Task complete: check draws in 150ms, row settles. No confetti during cooking — save
  celebration for the final `finish` node.
- Respect `prefers-reduced-motion`.

## Things the design review already rejected

Documented so they don't come back:

- Progress-styled bars on a screen shown before cooking starts.
- Consumed/elapsed language pre-start (`"9 of 12 min used"`).
- Three equally weighted parallel tasks with no recommended first.
- Desktop-style horizontal cooking graph on mobile.
- Adding more UI to explain the concept. Past a point, more explanation makes the
  interface worse.

## Under review — for M2.5

Each of these should be an explicit decision, not an inherited default. Status after M2:

- ~~Warm cream background plus a green accent~~ — **resolved in M2**: moved to the dark
  espresso/saffron palette. Whether *that* is the right direction is M2.5's call.
- One border radius and one soft shadow on everything, regardless of hierarchy.
  Hierarchy should be visible without reading the text. **Still open.**
- Tracked-out ALL-CAPS eyebrow labels (`WHILE THIS COOKS`). Legible, but a strong tell.
  M2 kept it; **still open.**
- Meta strings joined with middle dots (`9 min prep · fits in 12 min`,
  `3 servings`). M2 kept it; **still open.**
- The `→` appended to button text — **dropped in M2** (the disabled CTA reads
  `Start Cooking · coming in M3`).

M2.5 owns the rest. Do it with the `frontend-design` skill, spending the boldness on
the Map view (M2.75) and keeping the Plan view quiet.
