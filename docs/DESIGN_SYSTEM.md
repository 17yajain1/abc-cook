# Design System

> **Status: the direction is chosen (M2.5).** Everything below is derived from the design
> brief in the next section. It replaces the provisional dark "spice cabinet" palette that
> M2 ported from the Figma Make prototype — that palette was inherited, not chosen, and
> M2.5 exists to spend that debt.
>
> The rule for this file from here on: **the brief is the source, the tokens are the
> derivation.** If a token can't be traced back to a line in the brief, it is decoration
> and should be cut rather than kept "for now."

---

## Design brief

**Subject.** One person, one dish, a phone propped against something in a home kitchen.
They already know how to cook — what they don't know is *when* to do what. Indian home
cooking is the centre of gravity; the engine is cuisine-agnostic.

**Concept — a cooking plan is a timetable.** Not a recipe card, not a feed: a schedule
with a measured time axis, parallel lanes, a mainline you must not wander off, and
junctions where work merges. Rail schedules solved this exact display problem — several
things moving at once, against one clock, where the reader needs *when* and *what's
concurrent* in a glance. We take that grammar because our content is the same shape,
not because it looks good.

**Three principles.**

1. **Time is measured, not labelled.** A duration that matters occupies space
   proportional to itself. A sixty-minute rise must dwarf a two-minute chop, because it
   does.
2. **One signal colour.** The critical path — the thing you cannot walk away from — is
   the only saturated mark on screen. Everything else is ink on paper.
3. **Absence has a shape.** Unattended work is drawn hollow. The empty space inside the
   mark *is* the room you have to do something else, and the parallel work is drawn
   running through it.

**Voice.** Printed, not rendered. Flat ink, true rules, tabular figures, no elevation.
A board tells you facts; it doesn't congratulate you.

### Register: the Map is an instrument, the Plan is a kitchen screen

Direction A's palette, light ground, type and radius rule transfer to **both** views. Its
*harshest* commitments — zero elevation anywhere, full-weight true black, minimal chroma,
"a board tells you facts" — were calibrated for the Map's instrument-panel register and
are **not** automatically inherited by the Plan view.

This has to be said explicitly because leaving it unsaid already cost a milestone. The
first M2.5 pass applied the full austerity to the Plan view by default and produced a
screen measurably colder and flatter than the M2 baseline it replaced — a regression on
the screen users see most, in service of a register that belongs to a screen that did not
exist yet. The Plan view took all of the direction's cost and none of its benefit, because
the benefit (a visible time axis, proportional bars, hollow-vs-filled) is the Map's.

The Map is read for ten seconds to understand a structure. The Plan is held for forty
minutes in a kitchen while something burns. Those are different jobs and they get
different amounts of austerity.

_(Mechanism pending — the specific concessions are being chosen with the owner and will
be written here. Until then, treat the Plan view's current tuning as unresolved rather
than as the standard.)_

---

## Canvas

- Target: **390 × 844** (iPhone 14 class). Design here first.
- Safe area bottom: 34px. The primary CTA is fixed above it.
- Content gutter: 16px. Card gap: 12px.
- Tap targets: **≥ 44 × 44**. Cooking happens with greasy fingers.
- A light ground is also the legible choice in a bright kitchen, which the previous dark
  ground was not. This is a happy coincidence, not the reason.

## Colour

Four core values — **paper, ink, rule, signal** — plus two recessed tints and a muted
stage family. Nothing else. The live source of truth is the `@theme` block in
`apps/web/src/index.css`; this table is the intent.

```css
--color-paper:        #EFEEEA;   /* the board */
--color-paper-sunk:   #E4E2DC;   /* time gutter, recessed bands, pressed rows */

--color-ink:          #000000;   /* rules and primary type */
--color-ink-2:        #55534C;   /* instructions, doneness cues, secondary */
--color-ink-3:        #6E6B62;   /* durations, meta, the time ruler */
--color-rule:         #C9C5BB;   /* hairlines */

--color-signal:       #C42F16;   /* critical path, the live thing, the primary CTA */
--color-signal-sunk:  #F5DED8;   /* signal fill behind a chip or an active row */
```

**Contrast, checked not assumed.** Against `--color-paper`: `ink-2` 6.5:1, `ink-3`
4.6:1, `signal` 4.8:1 — all clear AA for normal text, which matters more here than
usual because durations are 13px and get read at arm's length in bad light. Paper on
`signal` (the CTA) is 5.6:1. Every stage tint clears 3:1 as a non-text mark. `--color-rule`
is a printed hairline at 1.5:1 and is deliberately below that bar: nothing load-bearing
may depend on it alone, which is why structural edges are 2px `ink`.

The first draft of this palette used `#8A877E` for `ink-3` (3.1:1) and `#D8371B` for
signal (4.0:1). Both failed. Recorded because the failure mode is silent — they look
fine on a bright desk monitor.

**True black, deliberately.** Tinted near-black (`#111`, `#0B0B0B`) standing in for black
is a recognised generated-design tell. A printed schedule uses black ink; so do we.

**Signal is rationed.** If more than one thing on a screen is `--color-signal`, one of
them is wrong. It marks the critical path and the single primary action, nothing else.

Precisely: signal is the only **fully saturated** mark. The stage tints below are
colour, but they are low-chroma and mid-value by construction and none of them is red,
so signal still wins on a screen full of them. The original wording — "the only
saturated mark" — was written before the Map study proved that stage identity has to be
carried by fill rather than by a hairline, and it would have forbidden the thing that
made the Map legible. **A screen with no signal on it at all is the failure this rule
was meant to prevent, and rationing it into absence is the same mistake as spending it
everywhere.**

**Retired from the M2 palette, and why:**

- `--color-verified` (green) — a second accent dilutes principle 2. "All this prep fits
  inside the 12 min cook" is a *fact*, not an achievement, and is now set in `ink-2` on
  `paper-sunk`. M3 will need an affirmative completion mark; that is M3's decision to
  make, and it should not resurrect a general-purpose green.
- `--color-terracotta` (heat/urgency, never used) — signal covers it.
- `--color-saffron` and its three tints — replaced by signal. The old ramp's `--stage-0`
  (`#f2b134`) was visually indistinguishable from saffron (`#e8a020`) on screen, so the
  documented reservation ("saffron is not in the stage ramp") existed only in prose.

### Stage identity

Not six loud hues. On a schedule, a line is identified by **the lane it runs in and its
label**; colour is a quiet code, not the message. The M2 ramp mixed two spice tones with
Tailwind's violet-400 and a generic sky blue — two palettes wearing one coat.

Re-derived: six tints at roughly equal value (L\* ≈ 45) and low chroma, none of them red.
They read as coded lines on an understated map and none of them competes with signal.

```css
--stage-0: #6E7B52;  --stage-1: #7A6A4F;  --stage-2: #4F6B72;
--stage-3: #6B5F72;  --stage-4: #7A6558;  --stage-5: #5E6B5E;
```

Assignment is unchanged: by the stage's **index** in `graph.stages` (`index % 6`), never
by `Stage.color_key` — recipes have arbitrary stages.

**The treatment differs by view, and that is deliberate.**

- **Plan view — a 3px lane rule.** Never a filled badge or a dot. The Plan view is the
  quiet one; identity is a margin note there.
- **Map view — the bar's fill.** A node bar is filled with its own stage tint. Tried as a
  3px strip on the bar's top edge first, and at true size it vanished: a 3px line on a
  152px bar reads as a rendering artifact, not as identity. The bar has area, so the area
  is what should carry the colour.

The Map's fill treatment is why the saturation rule above is stated in terms of *fully*
saturated marks.

A task the scheduler moved into another stage's wait window keeps **its own** stage's
tint inside that window — that is how the eye reads it as borrowed work.

## Type

**Archivo**, variable, self-hosted. One family; the **width axis** carries the signage
voice, so no second face is needed. Weight and width do the work that a display serif
would otherwise do.

Loading — the M2 no-webfont rule is kept in *intent* and relaxed in *mechanism*. It was
written against a Google Fonts `<link>`, which is a render-blocking round trip to a third
party on kitchen wifi. Instead:

- one `.woff2` under `apps/web/public/fonts/`, subset to Latin basic + digits +
  punctuation actually used;
- `<link rel="preload">` from our own origin, `font-display: optional`;
- **budget ≤ 55KB.** If the two-axis variable file exceeds it, drop the width axis and
  ship two static cuts (Regular, Expanded SemiBold) instead. Say which was shipped.

**Shipped: the two-axis variable font, 49KB** (`public/fonts/archivo-var-subset.woff2`).
The upstream latin file is 88KB and busts the budget; clamping the axes to the range the
scale below actually uses (`wght` 300–700, `wdth` 88–112) and cutting the charset to what
the product renders brings it to 50,192 bytes with both axes intact, so the width axis
survives. Reproducible via `apps/web/scripts/subset-font.py`, which is a one-off asset
build and deliberately **not** wired into `make` — the output is committed so the normal
build needs neither Python nor network. Archivo is SIL OFL 1.1; the licence ships beside
the font.

`font-display: optional` means a cold first load may render in the fallback and swap on
the next visit. That is the correct trade for a PWA: zero layout shift, zero blocking.
Fallback stack stays `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.

**Scale** — 12 / 13 / 15 / 18 / 22 / 30, a ~1.2 ratio off a 15px base.

| Role | Size / weight / width |
|---|---|
| Recipe title | 30 / 600 / wdth 88 — condensed, like a destination on a board |
| Screen title (picker) | 22 / 600 / wdth 100 |
| Stage label | 18 / 600 / wdth 112 — expanded; this is the signage voice |
| Primary CTA | 18 / 600 / wdth 106 |
| Task label | 15 / 500 / wdth 100 |
| Instruction | 15 / 400 / wdth 100, line-height 1.5 |
| Doneness cue | 13 / 400 / wdth 100, `ink-2`, **not italic** |
| Duration, meta | 13 / 500 / wdth 100, tabular, `ink-3` |
| Section label | 13 / 600 / wdth 100, **sentence case** |
| Time ruler | 12 / 500 / wdth 100, tabular, `ink-3` |
| Timer digits (M3) | 44 / 300 / wdth 88, tabular |

`font-variant-numeric: tabular-nums` on every duration, clock value and timer, or the
digits jitter. Line length stays under 80 characters — the 390px column at a 16px gutter
gives ~55 at 15px.

**No tracked-out ALL-CAPS anywhere.** It is a generated-design tell and it costs
legibility at 12–13px on a screen with steam on it. Section labels are sentence case at
weight 600: `While this cooks`, `Dough`, `Frying`, `Glaze`.

## Radius and elevation

Both were open items ("one border radius and one soft shadow on everything, regardless of
hierarchy"). Resolved as a rule rather than a value:

> **Radius encodes whether a thing is a measurement or a control.**

| Kind | Radius | Why |
|---|---|---|
| Bars, the time gutter, recessed bands | `0` | Their edges mean something. Rounding a measured extent falsifies the measurement. |
| Controls — chips, the CTA, pressable rows | `2px` | A printed-form corner. You touch it, so it softens; barely. |
| Stage badge / dot, where one survives | `50%` | It is a point on a line, not a box. |

**Shadow: none, anywhere.** Depth is expressed by ground value (`paper-sunk` recesses)
and by rule weight. There is no elevation model and adding one would contradict the
brief's "printed, not rendered."

Rule weights are the hierarchy: `1px --color-rule` hairline for list separation, `2px
--color-ink` for a structural edge, `3px --color-signal` for the mainline.

## Metadata and punctuation

The middle-dot meta string (`9 min prep · fits in 12 min`, `3 servings · 34 min`) was an
open item and is a generated-design tell. Retired — and replaced by the device this
design system already owns: **a column.**

- Durations move out of the running text into a **right-aligned tabular duration
  column**. That removes most dots for free and makes the numbers scannable down the
  page, which is the whole point of a timetable.
- Meta pairs become aligned fields separated by space and value contrast, not
  punctuation: `3 servings` `34 min total`.
- Capacity keeps its meaning and loses its dot: `9 min prep` in `ink`, `fits in 12 min`
  in `ink-3`.

**The copy rules in `CLAUDE.md` are untouched by this.** Capacity never consumption;
ranked never flat; "9 min prep / fits in 12 min" survives verbatim minus the separator.
Only punctuation and alignment change.

## Arrows and chevrons

Resolved: **an arrow is permitted only where it encodes a dependency. Never as
affordance, never as ornament.**

| Where | M2 | M2.5 |
|---|---|---|
| Between capacity chips | `›` | removed — they're a measured relationship, not a sequence |
| End of a window task row | `›` | removed — see below |
| Recipe picker rows | `›` | removed; the recipe's total time takes the duration column |
| Collapsed stage summary | `Chop onion → Chop tomato` | **kept.** Here `→` means "then", and a collapsed card has no vertical axis to carry it. |
| Map connectors | — | no arrowheads. On a time axis, down is later. An arrowhead is redundant. |

Removing the row chevron takes an affordance away, and `DESIGN_SYSTEM.md` has always
said window tasks "must read as tappable, not as recipe notes." The replacement is a
full-width hit area, a `paper-sunk` pressed state, and the duration column reading as a
control column. **This is the one decision here most likely to be wrong**, and it is
falsifiable: if the M2 person test shows people don't read the rows as tappable, the
glyph comes back — as a `+`, or as a visible control.

## Connector language — for the Map (M2.75)

Established now so M2.75 doesn't invent it under deadline. `GRAPH_VIEW.md` §5 requires
these to be legible **without a legend**; that is the constraint they're designed against.

| Meaning | Mark |
|---|---|
| Critical path | The **leftmost lane**, a continuous **6px `signal`** rail with no gaps, running the full height — including stretches where the mainline is *blocked* and no work sits on it. It must be the strongest mark on the screen. At 3px it was not: it read as a hairline weaker than the surrounding ink. |
| Attended work | A bar **filled** with its stage tint, label in `paper`. Fill means "you are here, doing this". |
| Unattended work | The bar drawn **hollow** — `paper` fill, 1.5px `ink` outline. An unattended *host* is drawn **wide**, spanning the lanes its window frees, and the borrowed work is drawn **inside it**. |
| Parallel work | A **spur** — 1.5px `ink-3`, leaving the mainline where the window opens, running down *through* the hollow stretch, rejoining where it closes. Short 1px ticks hang the borrowed tasks off it. **Curved, never right-angled**: a rail spur curves away, and an orthogonal jog is flowchart notation. |
| Simultaneity | Shared vertical position, plus containment inside the hollow host. |
| Merge / junction | The host bar's **top edge overdrawn at 3px `ink`** — that edge is where the mainline and the merging branch both arrive, and §4.5 says the junction is the densest moment in the graph. |
| Dependency (general) | The rail simply **continues**. No arrowhead: the time axis already says which way is later. |

Adjacent bars are inset 1px top and bottom so a `paper` gutter always separates them.
Without it, two neighbouring bars sharing a stage tint (`add_paneer` and `finish`) fuse
into one block and the schedule loses a boundary that means something.

**No dashes.** Solid-vs-dashed was precisely the distinction that needed the legend
`GRAPH_VIEW.md` §5 complains about. Weight, colour and lane position carry it instead.

The hollow-unattended mark is the load-bearing one: a hollow bar is literally empty
space, and the parallel spur is drawn *running through it*. You can see the free time and
you can see what has been placed in it. That is the entire product in one mark.

## Is a node a card?

**No. A node is a bar on a time axis** — height ∝ duration (sqrt-scaled, clamped 56–140px
per `GRAPH_VIEW.md` §4.4), minimum width 96px, minimum tap target 44px per §3.

**But that grammar belongs to the Map, not the Plan.** `GRAPH_VIEW.md` §2 gives the Plan
view a different job — scannability, one thumb, calm — and §6 says to spend the boldness
on the Map and nowhere else. So the Plan view inherits the palette, the type, the radius
rule, the rule-weight hierarchy and the duration column, and **does not become a Gantt
chart.** Its stages stay rows.

## Components and their states

### StageCard
`collapsed` · `expanded` · `active` · `complete` (M2 ships the first two; `active` /
`complete` are M3).

Collapsed shows: the stage rail, label, `~N min`, a one-line task summary. Expanded shows
the task rows and any wait-window block this stage hosts.

`~N min` is the stage's **inline** work — `StageSpan.inline_work_min`, the tasks still on
this card after the scheduler moved others into a window. A stage whose tasks *all* got
moved is dropped from the plan entirely (its tasks show in the windows that borrowed
them), the same way the scheduler drops empty wait windows.

**The stage rail stays ordinal** (M2.5 decision). The alternative considered was putting
the stage's `StageSpan.start_min` there instead. Rejected, and the reasoning is worth
keeping: **ordinal answers "where am I in the recipe?", the time axis answers "when does
this happen?", and those are two different jobs.** Duplicating temporal information into
the stage rail would blur both. The time axis is the Map's, and it stays there.

The treatment changes even though the content doesn't. M2 drew a filled circular badge in
the stage's tint — a coloured counter that competed with the label beside it. It is now
**quiet and structural**: the ordinal set in `ink-3` at 13/500 tabular, no fill, no
circle, sitting at the top of the stage's 3px lane rule. The rail carries the stage tint;
the number does not.

This also dissolves a real M2 defect rather than restyling it. The badge *number* came
from render position (`position={i + 1}`) while the badge *colour* came from the graph
index (`stage.index`), so on Chicken Biryani stage ① was drawn in stage-1's tint and the
two counters could never be read together. With the number in neutral ink and the tint on
the rail, they no longer claim to agree.

### WaitWindowBlock — the signature component

Visually attached to its host stage card, not floating as a separate "tips" section. That
attachment is what makes the concept legible; it was the main fix from the design review
and it does not change.

```
While this cooks
9 min prep   fits in 12 min
──────────────────────────────────────────
[ 12 min cooking ]   [ 9 min prep ]
──────────────────────────────────────────
▎ Cube capsicum                      5 min
  Start with this one
▎ Cube paneer                        2 min
▎ Make kadai masala                  2 min
──────────────────────────────────────────
All this prep fits inside the 12 min cook
```

The `▎` is the borrowed task's own stage tint, as a 3px lane rule. Footer switches on
`window.slack_min`: `0` → "All this prep fits inside the N min cook"; otherwise "Fits
with N min to spare" — set in `ink-2` on `paper-sunk`, no green.

Rules, unchanged from M2 except in punctuation:
- Header text is **capacity**, never consumption. Never `"9 of 12 min used"` — the user
  hasn't started.
- The first task is visually primary (`Start with this one`), the rest secondary. A flat
  list of three equal tasks makes the user ask "which one?"
- Emoji (🔥 ✓ ⚡) are removed. They were the only icons in the product and read as
  decoration in a system that is otherwise flat ink.

### Capacity chips
Two chips inside the wait-window block: `12 min cooking` and `9 min prep`, both fed from
the plan (`host.duration_typical` and `window.used_min`). Chips, not bars — anything
bar-shaped reads as progress on a screen shown *before* cooking starts, which is the one
thing this component must not do.

Known limitation, unchanged in M2.5: the chips carry no magnitude, so a window at 75%
used (Kadai Paneer, 9 in 12) and one at 5% (Donuts, 3 in 60) render identically. Fixing
that means finding a non-bar way to show fullness. Deferred, listed below.

### Timer · ParallelTaskDetail · PrimaryCTA
Unchanged from M2 in structure. PrimaryCTA is full-width, fixed above the safe area, 52px
tall, `--color-signal`, radius 2px; exactly one on screen at a time.

**Store the absolute end timestamp, not a countdown integer.** Recompute remaining on
every render and on `visibilitychange`. Phones sleep.

## Motion

- Stage expand/collapse: 200ms ease-out height + opacity.
- **The one orchestrated moment (Map, M2.75):** on open, the time ruler draws down and
  the critical rail extends top to bottom in a single ~700ms sweep; the parallel spurs
  fade in after it lands. Once, on entry. Nothing else on the Map animates.
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
- Dashed-vs-solid connectors needing a key at the bottom of the Map.
- A second accent colour alongside signal.

## Resolved in M2.5

| Open item | Resolution |
|---|---|
| Ground and accent | Paper/ink/signal. Light ground, true black, one rationed red. |
| Radius and shadow | Radius encodes measurement vs control (0 / 2px / 50%). No shadow, ever. |
| ALL-CAPS eyebrows | Retired. Sentence case at 13/600. |
| Middle-dot meta | Retired. Replaced by a right-aligned tabular duration column. |
| Chevrons and arrows | Arrows only where they encode a dependency. All affordance glyphs removed. |
| Typography | Archivo variable, self-hosted, ≤55KB, `font-display: optional`. Six-step scale. |
| Stage identity | Kept, but re-derived as six equal-value low-chroma tints applied as a 3px lane rule. Never red. |
| Is a node a card | No — a bar on a time axis. Map grammar only; the Plan view stays rows. |
| Stage rail | Stays **ordinal**, not start time. Ordinal is "where am I", the time axis is "when" — separate jobs. Treatment goes quiet: neutral ink number, tint moves to the lane rule. |
| `→` on button text | Dropped in M2; stays dropped. |

## Still open

1. **The wait window's numbers don't reconcile.** Chicken Biryani's second window reads
   `2 min prep`, `fits in 12 min`, `Fits with 7 min to spare` — and 2 + 7 ≠ 12. The
   header's denominator is the host's `duration_typical`; the footer's slack is
   `window.slack_min`, measured against the window's actual capacity after gating. Both
   are honestly the scheduler's; they just can't sit next to each other. **A product and
   scheduler-semantics decision, deliberately not touched in M2.5.**
2. **The wait window assumes its host is hot.** Homemade Donuts renders "while this
   cooks" and "60 min cooking" over dough proving at room temperature. Copy tied to
   scheduler semantics, not a design fix.
3. **`Start with this one` on a single-task window** (Chicken Biryani's second) ranks a
   list of one.
4. **Capacity chips carry no magnitude** — 9-in-12 and 3-in-60 look identical.
5. **Do rows still read as tappable without a chevron?** Falsifiable at the M2 person
   test.
6. **`Stage.color_key`** — still unused by the renderer; `stageColor` assigns by position
   in `graph.stages`. Remove at M4 or write down why it stays.
7. **The Plan view still has no time dimension.** By design — the bar grammar is the
   Map's. Revisit only if the M2.75 person test suggests the Plan needs it too.
