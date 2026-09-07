# Design System

Derived from the Figma Make prototype and the Kadai Paneer storyboards. **When the
Figma Make export lands in `apps/web/`, reconcile these values against the real
`index.css` and treat the export as authoritative for exact hex codes.** The
*structure* below — what a token is for — is what should survive.

> **Status: provisional.** The token *structure* is sound; the specific values are
> Figma Make's defaults and land on several recognised generated-design tells (see
> `GRAPH_VIEW.md` §6). Treat everything below as a working placeholder until a
> deliberate design direction has been set with the `frontend-design` skill. When it
> is, write the resulting brief into the section directly below this one so it doesn't
> get lost.
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

```css
--bg:            #FAF8F5;   /* warm off-white, not pure white */
--surface:       #FFFFFF;
--text:          #1A1A1A;
--text-muted:    #6B6B6B;
--border:        #E8E4DE;

--primary:       #16803C;   /* green — every primary CTA */
--primary-press: #10682F;
--timer-ring:    #16803C;
--timer-track:   #E4E9E5;

--accent:        #E8A33D;   /* saffron — parallel-task / "while this cooks" marker */
```

Stage colors. Each stage gets one hue, used as a tint background and a left accent so
the plan is scannable at a glance:

| Stage | Tint | Accent |
|---|---|---|
| Prep | `#FEF6E7` | `#E8A33D` |
| Cook Base | `#EAF2FD` | `#3B7DD8` |
| Add Veggies | `#F3ECFD` | `#8B5CF6` |
| Add Paneer / Combine | `#FDEDE8` | `#E2683C` |
| Finish | `#E9F5EC` | `#16803C` |

Stage colors are assigned by index from a fixed palette, not by stage name — recipes
have arbitrary stages. Keep the palette to six and cycle.

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
`collapsed` · `expanded` · `active` · `complete`

Collapsed shows: index badge, label, `~N min`, one-line summary, chevron.
Complete swaps the index badge for a green check and strikes nothing through — struck
text is hard to read at a glance.

### WaitWindowBlock — the signature component

Visually attached to its host stage card, not floating as a separate "tips" section.
That attachment is what makes the concept legible; it was the main fix from the design
review.

```
⚡ WHILE THIS COOKS            9 min prep · fits in 12 min
─────────────────────────────────────────────────────────
Start with
  🫑 Chop capsicum · 5 min                              ›
Also prepare
  ▫ Cube paneer · 2 min                                 ›
  ▫ Prepare kadai masala · 2 min                        ›
```

Rules:
- Header text is **capacity**, never consumption. `"9 min prep · fits in 12 min"`.
  Never `"9 of 12 min used"` — the user hasn't started.
- The first task is visually primary (`Start with`), the rest secondary
  (`Also prepare`). A flat list of three equal tasks makes the user ask "which one?"
- Tasks are rows with a chevron — they must read as tappable, not as recipe notes.

### CapacityBar
Two stacked bars: cooking time and parallel prep. **Must not look like a progress bar.**
Use a different treatment from any progress UI in the app — outlined vs filled, or
hatched fill. If a user reads it as progress before cooking starts, it's wrong.

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

## Under review — likely generated-design defaults

Present in the current tokens, kept for now so the app builds, but each should be an
explicit decision rather than an inherited default once the design brief exists:

- Warm cream background plus a green accent — the house style of every AI-designed
  wellness and recipe app.
- One border radius and one soft grey shadow on everything, regardless of hierarchy.
  Hierarchy should be visible without reading the text.
- Tracked-out ALL-CAPS eyebrow labels (`WHILE THIS COOKS`). Legible, but a strong tell.
- Meta strings joined with middle dots (`9 min prep · fits in 12 min`,
  `35 min · 4 servings`). Same.
- A `→` appended to button text (`Continue Cooking →`).

None of these is wrong in isolation. All five together is a template.
