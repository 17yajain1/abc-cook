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

## Authority and conflict resolution

`CLAUDE.md` § "Repo layout" is the map of which document owns which decision:

| Document | Owns |
|---|---|
| `CLAUDE.md` | Non-negotiable engineering rules, vocabulary, working style. The meta-document. |
| `docs/PRODUCT.md` | Positioning, competitors, what the product refuses to be. |
| `docs/COOKING_GRAPH.md` | The schema and the scheduler algorithm — what the graph *is* and how `CookingPlan` is computed. |
| `docs/GRAPH_VIEW.md` | How the graph is *drawn* on a phone: layout constraints, the encoding table, the five-second test. |
| `docs/DESIGN_SYSTEM.md` | This file. Tokens, palette, typography, stage colour, component states, visual grammar. |
| `docs/ROADMAP.md` | Milestone scope and exit criteria. |

Two conflict rules already exist and are unchanged:

- **Figma Make vs the `frontend-design` skill** (`CLAUDE.md` § "Design workflow"): where
  they conflict on *aesthetics*, the skill wins; where they conflict on *flow or
  information hierarchy*, Figma wins.
- **A fixture's expected plan** (`CLAUDE.md`): if a scheduler change moves a golden
  fixture's output, that is a product decision to surface, not a test to update.

**The general rule: if two project documents conflict, do not silently pick one.** State
the conflict, name both documents and both claims, and ask the owner to decide. Inventing
a resolution — or quietly following whichever document was read last — is the failure this
section exists to prevent.

There is no `DECISIONS.md`. Decision history lives in this file's *Resolved in M2.5*
table, in `docs/ROADMAP.md`, and in the `s1`–`s5` session notes at the repo root.

---

## M2.5 sign-off blocker — the wait-window arithmetic is unresolved

**M2.5 is not fully signed off until this is resolved.** It is a scheduler /
product-contract problem, not a visual-copy problem, and **it must not be fixed by
editing UI copy to conceal it.**

`WaitWindowBlock` can render a header and a footer that do not add up. Chicken Biryani's
second window:

```
2 min prep   fits in 12 min
...
Fits with 7 min to spare
```

2 + 7 ≠ 12.

**Why the two lines derive from different capacity concepts:**

- The header's "fits in **12** min" is the host node's raw `duration_typical`.
  `COOKING_GRAPH.md` § 3 blesses exactly this: *"the UI copy … falls straight out of
  `used_min` and the host node's duration."*
- The footer's "**7** min to spare" is `window.slack_min` = `capacity_min − used_min`,
  and `capacity_min` is the **gated** figure — `duration_typical × 0.75` for a `periodic`
  host, `× 0.9` for `unattended` (`COOKING_GRAPH.md` § 4.3). Here: `12 × 0.75 = 9`;
  `9 − 2 = 7`.

So the header's denominator is 12 and the footer's is 9. The 3-minute difference is the
§ 4.3 safety margin, and nothing in the product names it.

**What the existing documents settle, and what they don't:**

- `COOKING_GRAPH.md` § 3 and § 4.3 define every primitive precisely —
  `duration_typical`, `capacity_min` and its `× 0.9` / `× 0.75` gating, `used_min`,
  `slack_min`.
- **No document defines how one UI view should present the header and footer together so
  they reconcile.** The footer copy ("Fits with N min to spare") is this file's own
  `WaitWindowBlock` spec (§ WaitWindowBlock), and it pairs a capacity-relative number
  with a duration-relative one in the same block.

Citing where the primitives are defined is **not** the same as applying a fix. Resolving
the arithmetic is a product decision with scheduler and golden-fixture consequences, and
this documentation pass does not make it. Options a future session must **not** choose
unilaterally include: put capacity (not raw duration) in the header; add the safety
margin as an explicit third line; drop the "to spare" footer; change what `slack_min` is
measured against in the scheduler.

The example above is left **unreconciled on purpose** in this document.

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

**Frozen structural grammar for M2.5 — not open for reinterpretation:**

- The Plan view stays a **vertical, stage-row** experience. It does **not** become a
  Gantt chart and it does **not** acquire a time axis.
- It inherits, from the direction: the **palette**, the **typography**, the **radius
  rule**, the **rule-weight hierarchy**, and the **right-aligned tabular duration
  column**.
- **Wait windows stay attached to their host stage** (§ WaitWindowBlock), never floating
  as a separate "tips" section.
- The Map's grammar — the minute axis, proportional bar heights, hollow-vs-filled marks,
  the connector language — **does not transfer to the Plan automatically.** Anything the
  Plan borrows from it is a deliberate, named decision, not a default.

**Still unresolved — and it is the only thing unresolved here:** the exact degree of
visual warmth, softness and austerity the Plan view carries — surface tone, whether any
element sits proud of the page, body-text weight. This is a **visual-tuning question**,
chosen with the owner against a rendered screen (`CLAUDE.md` § "Working style"). It is
**not** licence to change the Plan view's information architecture, re-order its
hierarchy, or introduce a different layout model. Until the tuning is chosen, treat the
Plan view's current *rendered* tuning as provisional rather than as the standard — but the
structural grammar above it is fixed.

---

## Canvas

- Target: **390 × 844** (iPhone 14 class). Design here first.
- Safe area bottom: 34px. The primary CTA is fixed above it.
- Content gutter: 16px. Card gap: 12px.
- Tap targets: **≥ 44 × 44**. Cooking happens with greasy fingers.
- A light ground is also the legible choice in a bright kitchen, which the previous dark
  ground was not. This is a happy coincidence, not the reason.

## Colour

Four core values — **paper, ink, rule, signal** — plus one recessed tint and a muted
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
```

`--color-signal-sunk` (`#F5DED8`, "signal fill behind a chip or an active row") was in
this set and is **removed from the M2.5 token set**: it has no consumer. Nothing in
`apps/web/src` references it, and the M2.5 `WaitWindowBlock` chips are `ink`-outlined and
`ink`-filled, not signal-tinted. It still exists in `apps/web/src/index.css` — drop it
there the next time that file is edited; this documentation pass does not touch tokens. If
a real M2.5 consumer appears, add the token back *together with* the component that uses
it, not before.

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

**Signal is rationed — and the rule is about priority, not count.**

> Signal is reserved for the **highest-priority constraint or action on the current
> screen**. It may appear on more than one visual element at once **only when those
> elements represent the same underlying priority**. It is never used for emphasis,
> category, selection, or generic interactivity.

Earlier phrasings pulled in two directions — "if more than one thing is signal, one is
wrong" versus "a screen with no signal is a failure." Both were trying to say the same
thing badly. The priority rule resolves it. On the Map, the critical-path rail and a
live-now marker (M3) are the *same* priority — "the thing you cannot walk away from" — so
signal on both is correct. On the Plan, the primary CTA is that priority and is the only
signal mark. A screen legitimately carries no signal when nothing on it is that kind of
priority; a screen carrying signal on two *different* priorities has diluted it.

Signal is still the only **fully saturated** mark. The stage tints are colour, but
low-chroma and mid-value by construction and none is red, so signal wins on a screen full
of them — which is what lets stage identity be carried by fill on the Map (§ Stage
identity) without competing. (The earlier "the only *saturated* mark" wording predated the
Map study and would have forbidden that fill.)

**Worked example — the three colour roles on one Plan screen:**

| Role | Token | How often | Why it is not a general accent |
|---|---|---|---|
| Highest-priority action | `--color-signal` | **Once** — the `Start Cooking` CTA | It is *the* action of the screen; nothing else competes for that slot |
| Category code | a stage tint | Once per stage, as a 3px lane rule | Low-chroma, never saturated — reads as "which stage" without claiming "what matters most" |
| Everything else | `ink` / `ink-2` / `ink-3` | Everywhere | Rules, type, the duration column, the recessed wait-window band. No hue. |

The saved-time line ("saves you 9 min") stays **ink, not signal**, even though it is the
product's own pitch — colouring it would put signal on a second priority and turn it into
an accent. That restraint is the rule working.

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

**Accessibility validation — required before M2.75 ships stage colour as a Map fill.**

The six tints must be checked under:

- **protanopia** (red-blind)
- **deuteranopia** (green-blind)
- **tritanopia** (blue-blind)
- **greyscale** (full desaturation — covers monochrome output and the harshest low-light case)

The pass condition is **not** "the tints stay distinguishable under every simulation." It
is that **stage colour is never the sole carrier of stage or task identity.** Lane
position and the stage label are always present on both views — Plan: the ordinal and
label at the head of the lane rule; Map: the lane the bar runs in, plus its label. Colour
is redundant by design, so a tint collision under one simulation is a legibility note, not
a blocker.

**Do not raise the tints' saturation pre-emptively.** Increase chroma only if the
validation shows a real problem that lane position and labels do not already cover — and
if it does, that is a deliberate change made against the signal-rationing rule above, not
a quiet bump.

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

**Latin-script scope is an M2.5 decision, not a permanent assumption.** The subset is
Latin basic + digits + the punctuation the product renders, because M2.5's fixtures and
UI copy are Latin-script. This is *not* a claim that Devanagari or other Indic-script
recipe content will never be needed — the product's centre of gravity is Indian home
cooking, and localised recipe text is plausible. Indic-script and localised typography
should be revisited **before** any regional-language content is introduced; a
Devanagari-capable face or a script-aware font stack is a separate asset decision at that
point. M2.5 ships the Latin subset unchanged.

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
--color-ink` for a structural edge. (The Map's critical-path rail is `6px --color-signal`
— specified in the *Connector language* block below, and not an M2.5 mark. An earlier
draft of this line said `3px` for "the mainline"; the Map study proved 3px read as a
hairline weaker than the surrounding ink, which is why the connector block says 6px.)

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
control column. **This is the one decision here most likely to be wrong.**

**The test, stated so it can be failed:** during the person test (`GRAPH_VIEW.md` § 8 and
the M2 exit test), if **fewer than 4 of 5 participants independently identify a
wait-window task row as tappable without being prompted**, restore an explicit affordance
— a `+`, or a visible control, *not* the `›` chevron. Until that test runs and fails, the
chevron stays removed.

## Future Milestone Reference (M2.75/M3) — not part of M2.5 implementation

### Connector language — for the Map (M2.75)

Established now so M2.75 doesn't invent it under deadline. `GRAPH_VIEW.md` §5 requires
these to be legible **without a legend**; that is the constraint they're designed against.
A future session must not read this block as instruction to build the Map now.

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

**M2.5 states: `collapsed` and `expanded`.** The `active` and `complete` states are M3 —
see the *Future Milestone Reference* blocks below.

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

> **The header ("fits in N min") and this footer ("N min to spare") can fail to add up.**
> They are measured against different quantities. See the sign-off blocker at the top of
> this document. Do not reword either line to hide the discrepancy — the resolution is a
> scheduler / product-contract decision.

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

### PrimaryCTA (M2.5)
Full-width, fixed above the safe area, 52px tall, `--color-signal`, radius 2px; exactly
one on screen at a time. Unchanged from M2 in structure.

## Future Milestone Reference (M2.75/M3) — not part of M2.5 implementation

A future session must not build anything in this block as part of M2.5.

### StageCard `active` / `complete` states (M3)

`active` is the stage currently being cooked; `complete` is a finished stage. Their
visual treatment is not specified yet — it waits on M3's cooking-mode design, and on the
completion-mark decision the colour section defers to M3 (a completion mark must not
resurrect a general-purpose green).

### Timer digits and timer behaviour (M3)

- **Timer digits.** Type scale row: 44 / 300 / wdth 88, tabular. The one place the scale
  goes large.
- **Timer · ParallelTaskDetail.** Unchanged from M2 in structure. **Store the absolute
  end timestamp, not a countdown integer** — recompute remaining on every render and on
  `visibilitychange`. Phones sleep. (This storage rule is a `CLAUDE.md` non-negotiable and
  applies whenever the timer is built.)

## Motion

**M2.5 scope:**

- Stage expand/collapse: 200ms ease-out height + opacity.
- Respect `prefers-reduced-motion` — this is not optional and applies to every milestone.

## Future Milestone Reference (M2.75/M3) — not part of M2.5 implementation

### Map entry animation and cooking-mode motion

- **The one orchestrated moment (Map, M2.75):** on open, the time ruler draws down and
  the critical rail extends top to bottom in a single ~700ms sweep; the parallel spurs
  fade in after it lands. Once, on entry. Nothing else on the Map animates.
- **Task complete (M3):** check draws in 150ms, row settles. No confetti during cooking —
  save celebration for the final `finish` node.

A future session must not build either of these as part of M2.5.

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

1. **The wait window's numbers don't reconcile (2 + 7 ≠ 12).** This is an **M2.5 sign-off
   blocker** — see the *M2.5 sign-off blocker* section at the top of this document. Not
   restated here.
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
