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
table, in `docs/ROADMAP.md`, and in the `s1`–`s6` session notes at the repo root.

---

## A study proposes composition, never tokens

A design study is a rendered argument about **composition**. It is not a token source.
This has to be stated because it very nearly went the other way: the Direction 3 studies
in `docs/design/` carry their own `:root` block — a warmer paper, a `#241f19` brown-black
ink, a `#e7dcc3` field ground, a `#b23a1b` red, and no stage hue at all — and reading them
as the palette would have silently replaced four written decisions in this file with values
that were never argued anywhere.

| Artefact | Authority |
|---|---|
| **This document** | Rules and tokens. Authoritative. A value here changes only by an argued decision recorded here. |
| **A study** (`docs/design/*.html`) | **Composition only** — grouping, hierarchy, density, what sits where, what the marks are. Its token values are exploratory scaffolding and **never** override a written decision. |
| **The M2 baseline screenshot** | A quality floor. Not a reference to copy from and not a target to hit. See *The M2 baseline is a warmth floor*. |

So: adopt a study's **arrangement**; render it in **this file's** tokens. If a study's
composition genuinely cannot survive the written tokens, that is a finding to report and
a decision for the owner to make here — not a licence to drift toward the study's values
until the gap closes.

---

## Two layers: scheduler precision, and practical guidance

This is the governing principle for every number and every phrase the Plan puts on screen.

> **The UI must not display internal scheduler bookkeeping in a form the user can perceive
> as self-contradictory.**

Note carefully what this does *not* say. It is **not** "cooking time is approximate, so
displayed numbers need not reconcile." That phrasing is too broad — it would also excuse
the wait window telling you dough is cooking, which is a different failure the user can
see just as plainly. The real claim is narrower and firmer: **the internal scheduler
contract and the user-facing contract are different layers**, and scheduler-internal
quantities — safety margins, gating deltas, the `× 0.9` / `× 0.75` factors — must not
surface as visible inconsistencies.

- **Internally, the scheduler stays precise.** `duration_typical`, `capacity_min`,
  `used_min`, `slack_min` and the § 4.3 gating are not to be changed to make displayed
  numbers add up. That is a real constraint, not a preference: those figures exist so the
  app does not tell someone to do nine minutes of chopping inside a nine-minute simmer.
- **User-facing, durations and windows are practical guidance.** The screen's job is to
  help the cook decide what to do and when — not to expose the arithmetic that produced
  the advice. Small differences between what the scheduler computed and what the screen
  says are acceptable; a *visible contradiction* is not.
- Do not spend milestone-level effort making every displayed minute reconcile.

### The two known instances

Both are the same rule. They differ only in that one surfaces as arithmetic and the other
as language.

**1. The wait-window arithmetic — a known issue, not a blocker.** `2 + 7 ≠ 12`. Chicken
Biryani's second window could render `2 min prep · fits in 12 min` above `Fits with 7 min
to spare`. The header's denominator was the host's raw `duration_typical` (12); the
footer's was `slack_min`, measured against the **gated** `capacity_min`
(`12 × 0.75 = 9`; `9 − 2 = 7`). The 3-minute difference is the § 4.3 safety margin, which
nothing in the product names.

This was an M2.5 sign-off blocker and **is downgraded to a recorded known issue.** The
Direction 3 composition happens to dissolve it: there is no "fits in N min" header and no
numeric "N min to spare" footer any more. The numeral is the host's real
`duration_typical` and the footer is qualitative, so no two numbers on screen contradict
each other. Recorded rather than fixed — nothing was changed in the scheduler, and
`window.capacity_min` remains available and unread.

If a future render path does pair the two quantities again, and `capacity_min` is already
in scope there, reading it instead of the raw duration is an acceptable one-line fix. Do
not add a field or a computation to produce it, and do not make it a task of its own.

**2. The wait window assumed its host was hot** — "while this cooks" over dough proving at
room temperature. Resolved in M2.5; see § WaitWindowBlock.

**Neither is a licence to hide a genuine semantic problem with copy.** The test is whether
the screen still tells the truth, not whether the contradiction became harder to notice.

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

### Grounded and authored — the quality bar

The Plan should feel **grounded in the kitchen: a printed cooking sheet resting on a
counter**, not a floating SaaS UI. And it should feel **authored** — as though someone
decided each thing on it — rather than assembled from a template.

This is a bar to clear, **not permission to invent decoration or alter the palette.**
The way to hit it is stronger structural decisions, not more marks: real hierarchy, real
density, weight and space doing the work that a border or a shadow would otherwise be
asked to do.

### Avoid generated-design tells

This document already bans several by name — tinted near-black standing in for true
black, tracked-out ALL-CAPS eyebrows, middle-dot meta strings, decorative emoji, uniform
radius-plus-soft-shadow on everything regardless of hierarchy. Each was argued locally.
They are all instances of one rule, and naming the category is what stops the next one:

> **A choice that appears because it is a default, rather than because something in the
> brief requires it, is a tell. Every visual decision must trace to a line in the brief.
> If it cannot, cut it — including defaults that arrive by omission, not only ornament
> that arrives by addition.**

Also in the category, and not otherwise enumerated: floating-card treatment, generic
iconography, arbitrary accent colours, pills used where a plain figure would do,
gradients, shadows, and UI added merely because empty space felt unfinished.

That last one is worth stating on its own. Empty space on this screen is usually correct
— on a plan whose whole subject is unoccupied time, it is frequently the content.

**One knowing exception, recorded rather than hidden.** Each stage sits on its own
18%-alpha tint ground, which is a card treatment and therefore on the list above. It is
kept because the stage list is the screen's armature: on plain paper the six stages read
as one undifferentiated column of rows, and rule-and-space hierarchy did not fix it in
the `4c` / `4d` pair. The ground is flat — no radius, no border, no shadow — so it is a
tinted region, not a floating object. It runs behind **everything the stage contains**:
the header, its task rows, and any wait-window panel nested inside it. A ground that
stops short of the stage's last piece of content turns the stage into a header chip and
promises an object the layout doesn't deliver.

### The M2 baseline is a warmth floor

`M2's Kadai Paneer screen is the minimum acceptable warmth and liveliness.` It is a
**floor, not a ceiling and not a target.** Several things visible in it are retired by
this document and must not be reproduced: decorative emoji and illustration, the `›`
between capacity chips, the middle-dot meta string, and the green CTA. Clearing those is
the starting point, not the finish line.

The obligation: **M2.5 must not read colder or less alive than that screen**, using
M2.5's vocabulary. This is not an aesthetic preference — it is the specific failure that
already cost a milestone, and the reason the Register section below exists at all.

At every render checkpoint, compare directly against it. **If the render is colder,
flatter or more sterile, that is a category A finding — a real regression, not
calibration to defer.** Report which property is carrying the loss (field ground
contrast, ink value, type size, density, spacing) and stop. Do not close the gap by
drifting toward a study's token values.

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
- **Stage identity is carried by a filled ordinal badge in the stage tint, the
  stage-title weight, and the stage's tinted ground** (§ Stage identity). The 3px lane
  rule is retired: with a badge and a tinted ground the stage's colour was already
  stated twice, and at 3px the lane read as a blob rather than a rule. The title itself
  still takes no hue.
- The Map's grammar — the minute axis, proportional bar heights, hollow-vs-filled marks,
  the connector language — **does not transfer to the Plan automatically.** Anything the
  Plan borrows from it is a deliberate, named decision, not a default.

### The locked composition — Direction 3, "Two Kinds of Minute"

Chosen in s6 after the first M2.5 pass (a straight application of the direction's full
austerity to the Plan) was rejected as colder and flatter than the M2 baseline it
replaced. The insight: **every minute is either a minute the dish needs your hands or a
minute it doesn't, and the screen is built out of that alternation.** Hands-on work is
plain rows on paper; a scheduler wait window becomes a full-bleed field — a *place*, not
a card — with the free time stated once, large.

Locked, and not reopened without a render that demonstrates a real contradiction:

- **The wait window is a panel nested inside its host's stage**, keyed to a scheduler
  window in `plan.windows` — **never to `attention`** (the zebra rule: a screen with
  many unattended stretches must not become a stripe of fields, and keying to real
  windows prevents it by construction). The host node stays an **ordinary task row** of
  its stage; the borrowed work sits in a panel directly beneath that row, inset 12px on
  both sides inside the stage's own tint ground, on `--color-field` with a 2px
  stage-tint edge down its leading side. Flat: no radius, no shadow. Height is
  content-driven, never proportional — a 60-minute window is not ten screens tall.

  **Why containment, and not a place.** Direction 3 drew the field as a full-bleed slab —
  "a place the plan steps onto" — and the composition was coherent on plain paper. Once
  stages became tinted grounds it stopped being coherent twice over: a full bleed was the
  only element on the screen ignoring the grid, and an inset sibling card read as a band
  butted *after* the stage rather than work happening *inside* it. Nesting is what the
  scheduler actually models — these tasks run within that host's duration — so nesting is
  what the screen should draw. The field stays the most saturated surface on screen
  (`--color-field` `#E7DCC3` against the 18% stage tints); that ranking is the point.

  **Orphan-absorb still applies.** When the panel is the stage's only content, it renders
  directly under the stage header with no inline row above it. The header is not absorbed
  into the panel any more — the stage ground already contains both.
- **The panel states the relationship in words, not a figure.** It is headed
  `Meanwhile, do these` (15/600 `ink`) with a second line derived from the host's
  `attention` — `checking the pan now and then` for `periodic`, `your hands are free`
  for `unattended` (13/400 `ink-2`). No display number anywhere in the panel.

  Two figures were tried and both failed for the same reason. The 44px numeral read as a
  poster number and spent display scale on the host's `duration_typical`, which the
  duration column already carries one row above. Replacing it with a stated line
  (`12 min free`) failed too: it restated that same duration a third time, and a bare
  quantity cannot say *why* the free time matters. **What the cook needs is not the size of
  the gap but what to put in it**, and containment plus a lead-in says that without a
  number at all.
- **The ranked first task** gets weight and a `Start with this` cue in `--color-signal`;
  the rest are secondary. Suppressed entirely on a single-task window — ranking a list of
  one is noise.
- **Orphan-absorb:** when a stage's only content is its hosted field (the host pulled out,
  nothing left inline), the field absorbs the stage header rather than leaving it stranded
  on paper above.
- **One field per scheduler window. No merging of adjacent windows, no cap-and-demote.**
  Those rules are untested logic; they are deferred to M2.75 with a real corpus.

What the composition **proposes but does not get to set**: token values. The Direction 3
studies render in a warmer palette of their own (`#241f19` ink, `#b23a1b` red, no stage
hue). Those are study scaffolding. The Plan is built in **this file's** tokens —
`#000000` ink, `--color-paper` / `--color-paper-sunk`, the six stage tints,
`--color-signal`. See § *A study proposes composition, never tokens*.

The **one** value the composition did carry across is the wait-window field surface: the
study's `#e7dcc3` became `--color-field`, because measured against the M2 warmth floor the
field on `--color-paper-sunk` was a category A regression and the study value is the
derived answer (§ *`--color-field`*). That is a deliberate, argued, single-token decision
recorded here — not the study palette leaking in.

The warmth-degree question the first draft of this section left open is **resolved**: the
answer is Direction 3's composition in the Design System's tokens, plus `--color-field`,
measured against the M2 baseline floor at every checkpoint. It is no longer an open tuning
dial.

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
--color-field:        #E7DCC3;   /* the wait-window field surface only — § WaitWindowBlock */

--color-ink:          #000000;   /* rules and primary type */
--color-ink-2:        #55534C;   /* instructions, doneness cues, secondary */
--color-ink-3:        #6E6B62;   /* durations, meta, the time ruler */
--color-rule:         #C9C5BB;   /* hairlines */

--color-signal:       #C42F16;   /* critical path, the live thing, the primary CTA */
```

### `--color-field` — the wait-window surface

Added in the M2.5 implementation, and **the only palette change Direction 3 makes.** It
is deliberately warmer and deeper than `--color-paper-sunk`, and the reason is a measured
one.

The wait window is Direction 3's signature component and its job is to read, at a glance,
as *a distinct place the plan steps onto* — the room the free time buys you. On
`--color-paper-sunk` it did not: the ground shift from paper is ΔE ≈ 4.3 (ΔL\* 4.5%), and
with no border or shadow to lean on, the most important region of the screen became the
faintest. Measured against the M2 baseline warmth floor at the B2 checkpoint, that was a
category A regression — the signature component had inverted from the *most* present thing
on the screen to the *least*.

`--color-field` is `#E7DCC3` — **the field value from the Direction 3 study**, not a fresh
pick. Its distinction from paper is ΔE ≈ 13 (3× the old field), and that distinction is
carried by **warmth** (b\* +11) rather than by lightness alone: ΔL\* is 6.4%, a touch
under a 7% lightness reading, but the perceptual gap is well past any threshold because
the hue moves, not just the value. This is the point of principle 3 — absence has a
*shape*, and here the shape is a warm slab.

Constraints held: `--color-paper` is unchanged, ink stays true black, the six stage tints
are untouched, and the field gets **no border, gradient, shadow, or card treatment** —
the ground value does the whole job, which is the flat-printed grammar the brief asks for.

**Contrast cost, and how it is paid.** The warmer ground drops text contrast by ~0.5:1.
`ink-3` on `--color-field` is 3.9:1 — below AA for the 13px text it carries — so **inside
the field, secondary text steps up from `ink-3` to `ink-2`** (5.7:1). That is a contrast
fix, not a second emphasis level: the field's own small print is simply one step darker
than the same print on paper. `signal` on `--color-field` is 4.1:1, which is marginal for
the 12px `Start with this` cue; it is carried for M2.5 and listed as a calibration item.

**The same step-up applies to the stage grounds.** On an 18% stage tint, `ink-3` (13px
durations, secondary lines) measures 3.6–3.8:1 across the six tints and fails AA;
`ink-2` measures 5.2–5.4:1 and passes. So **inside a tinted stage ground, secondary text
is `ink-2`** — the same contrast fix as the field, not a second emphasis level. On plain
paper `ink-3` is unchanged.

`--color-signal-sunk` (`#F5DED8`) is **removed from `index.css`** in this same pass — it
never had a consumer, and the Direction 3 field is `--color-field`, not a signal tint. If
a real consumer appears later, add it back *with* the component that uses it.

**Contrast, checked not assumed.** Against `--color-paper`: `ink-2` 6.5:1, `ink-3`
4.6:1, `signal` 4.8:1 — all clear AA for normal text, which matters more here than
usual because durations are 13px and get read at arm's length in bad light. Paper on
`signal` (the CTA) is 5.6:1. Against `--color-field`: `ink` 15:1, `ink-2` 5.7:1 (the
field's body and secondary text), `signal` 4.1:1 (marginal, 12px only). Every stage tint
clears 3:1 as a non-text mark. `--color-rule` is a printed hairline at 1.5:1 and is
deliberately below that bar: nothing load-bearing may depend on it alone, which is why
structural edges are 2px `ink`.

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

- **Plan view — a 22px filled circular badge in the stage tint**, ordinal in `paper`,
  at the head of the stage. Identity is not a margin note on this view: the stage list
  is the screen's armature and the badge is what makes it one.
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
legibility at 12–13px on a screen with steam on it. Section and stage labels are sentence
case at weight 600: `Cooking plan`, `Ingredients`, `Prep`, `Cook the base`, `Finish`.

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
- The wait window's old capacity line (`9 min prep · fits in 12 min`) is gone entirely in
  Direction 3 — replaced by the subject line, the numeral and the caption (§
  WaitWindowBlock). The `·`-string retirement stands; there is simply no longer a line to
  re-punctuate.

**The copy *principles* in `CLAUDE.md` § "Product copy rules" are untouched and still
govern:** capacity never consumption, ranked never flat, no UI to explain the concept.
The specific `9 of 12` / `9 min prep · fits in 12 min` examples there illustrate those
principles; Direction 3 satisfies all three by other means.

## Arrows and chevrons

Resolved: **an arrow is permitted only where it encodes a dependency. Never as
affordance, never as ornament.**

| Where | M2 | M2.5 |
|---|---|---|
| Between capacity chips | `›` | n/a — the chips themselves are retired (§ WaitWindowBlock) |
| End of a window task row | `›` | removed — see below |
| Recipe picker rows | `›` | removed; the recipe's total time takes the duration column |
| Collapsed stage summary | `Chop onion → Chop tomato` | **kept.** Here `→` means "then", and a collapsed card has no vertical axis to carry it. |
| Map connectors | — | no arrowheads. On a time axis, down is later. An arrowhead is redundant. |

Removing the row chevron takes an affordance away, and `DESIGN_SYSTEM.md` has always
said window tasks "must read as tappable, not as recipe notes." The replacement is a
full-width hit area, a pressed state one ground-step down from the row's own surface
(`paper-sunk` for a row on paper; for a row inside the wait-window field, a step *below*
`--color-field`, not `paper-sunk`, which is lighter than the field), and the duration
column reading as a control column. **This is the one decision here most likely to be
wrong.** The exact pressed value inside the field is a Phase C implementation detail.

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

M2 drew this badge too, and drew it wrong: the number came from render position
(`position={i + 1}`) while the colour came from the graph index (`stage.index`), so on
Chicken Biryani stage ① was drawn in stage-1's tint and the two counters could never be
read together. **Both must derive from the same ordered stage list.** The badge returns;
the defect does not.

**Stages open expanded** (M2.5 decision — previously an unrecorded `defaultExpanded`
prop in `PlanScreen.tsx`). The collapsed state stays specified and reachable; it is not
the default. Resolves § Authority conflict 7.

A stage that hosts a wait window states its free minutes as a **second value in the
duration column when the stage is collapsed** — `12 free` then `~17 min`, two aligned
values, no middle dot (the `·`-string retirement in § Metadata and punctuation applies
here too). **Not when it is expanded:** the panel below is then visible and its rows
carry the same information, so the figure is a second statement of one fact. The rule is
general — *state free time where the detail is not visible, and never twice on one
screen.*

It is set in `ink-2`, never in the stage tint: the tints clear 3:1 as **non-text marks**
only, and measured as 13px text on their own 18% ground they run 3.2–4.1:1.

### WaitWindowBlock — the signature component

Attached to its host stage, not floating as a separate "tips" section — that attachment
is what makes the concept legible and it does not change. In Direction 3 the block is a
**full-bleed field on `--color-field`** (§ *`--color-field`* has the derivation and the
contrast handling): it runs to the device edges while its content stays on the 16px page
margin, so the ground changes but the text alignment does not. No border, no radius, no
shadow — a slab, a different surface, a place the plan steps onto for a while. Secondary
text inside it is `ink-2`, one step darker than the same print on paper, so it clears AA
against the warmer ground.

```
                                              ← field bleeds to device edge
  Cook tomato base
  until oil pools at the edges, masala pulls away

  12
  minutes, checking now and then

  Cube capsicum                          5 min
  Start with this
  ──────────────────────────────────────────
  Cube paneer                            2 min
  ──────────────────────────────────────────
  Make kadai masala                      2 min

  Just enough — start as soon as the base is on
                                              →
```

Top to bottom:

- **Subject line** — the host node's `label`, verbatim (`Cook tomato base`). 15/600
  `ink-2`. This is where the host's identity lives, so the numeral caption below does not
  have to carry it.
- **Doneness cue** — the host's `doneness_cue` where it has one, `until …`, 13/400
  `ink-2`. Omitted when the host has none (`soak_rice` has `doneness_cue: null`).
- **The numeral** — the host's `duration_typical`, 44/600 tabular, `ink`. Digits only.
  The one large figure on the Plan. Not `--color-signal` — nothing in the field is signal
  except the `Start with this` cue.
- **The caption** — see *The wait-window caption* below. 13/400 `ink-2`.
- **Ranked tasks** — each a full-width row, name 15/500 left, `duration_typical` in the
  right-aligned tabular column. Led by a 3px bar in the task's **home-stage** tint
  **only when the window holds tasks from more than one home stage.** In both shipped
  fixtures every task in a window comes from one stage, so the bar was one colour
  repeated, carrying no information and failing this document's own "remove it and lose
  nothing" test. Drawn conditionally, the mark means something when it appears. (The
  panel's own 2px leading edge is the *stage's* tint and is a different mark — it says
  "this work sits inside this stage's host", not "this task came from elsewhere.") Rows
  are `≥ 44px` and separated by a `1px --color-rule` hairline.
- **First-task emphasis** — the first row's name goes to weight 600 and gets a
  `Start with this` cue in `--color-signal` beneath it. **Suppressed entirely when the
  window has one task** — ranking a list of one is noise. (Closes the M2 open item
  "`Start with this one` on a single-task window ranks a list of one".)
- **The footer** — one qualitative line, `ink-2`, switched on `window.slack_min`. It
  states **no second number**, which is what keeps the block free of the `2 + 7 ≠ 12`
  contradiction. Wording is category B (calibration) — it has to read correctly for both
  a 0-slack window and a 51-minute one; see *Still open*.

**Orphan-absorb.** When a stage's only content is its hosted field — the host was pulled
into the field as its subject, and no inline task is left — the field **absorbs the stage
header** rather than leaving `Rise` stranded on paper above an empty stage. The stage
title renders on the field ground; the ordinal stays in the gutter on paper. When the
stage still has an inline task before the field (Kadai's `Sauté onion`), the header stays
on paper and the field follows normally.

**One field per scheduler window.** No merging of adjacent windows, no cap-and-demote of
a fourth. Both are untested layout logic and are deferred to M2.75 against a real corpus.

**A task row is titled by its task; the doneness cue is always its second line.** Cue,
label, duration — that order does not vary, on inline rows and on the panel's subject
line alike.

Leading with the cue was tried (`6a`, `7a`) on the argument that the cue is the valuable
information — a cook cannot guess `until oil pooling at the edges, masala pulling away
from the pan`, but can guess `Cook tomato base`. The argument was right about **value**
and wrong about **order**: a cue has no fixed length or shape, so a list of cue-led rows
gives the eye no anchor to scan, and on a 390px column the cue wraps and pushes the
label down out of the row's first line. The cue keeps its prominence through contrast
and position within the row, not by taking the title.

**Retired from the M2 / s5 version:** the `While this cooks` eyebrow; the `9 min prep ·
fits in 12 min` capacity line; the two capacity chips (`12 min cooking` / `9 min prep`);
the numeric `Fits with N min to spare` footer; the 🔥 ✓ ⚡ emoji. The chips carried a
known magnitude problem (75%-full and 5%-full rendered identically) that the single
numeral sidesteps — the numeral is the *duration*, and the caption plus footer carry how
full it is in words.

#### The wait-window caption

The line under the numeral. It appears on **every** wait window in the product, so it has
to be true for every host without exception.

It **derives from the host's `attention`** — the field `COOKING_GRAPH.md` § 4.2
designates as the single authority on whether the cook is free:

| host `attention` | caption | reads |
|---|---|---|
| `unattended` | `minutes hands off` | the cook is free for the whole interval |
| `periodic` | `minutes, checking now and then` | the cook must return every couple of minutes (`× 0.75` gating already assumes this) |

**The caption is deliberately process-neutral. It asserts only involvement, never
temperature or process** — because the graph cannot support a temperature claim.
`while this cooks`, `while this rests`, `while this proves` are all retired: each is a
statement the graph has no field to back.

**`station` was checked across all five fixtures and rejected as a heat discriminator:**

| fixture · host | `attention` | `station` | actually hot? |
|---|---|---|---|
| homemade-donuts · `first_rise` | unattended | `none` | no (dough, room temp) |
| chicken-biryani · `soak_rice` | unattended | `none` | no (cold water) |
| strawberry-shortcake · `bake_shortcakes` | unattended | `oven` | yes |
| kadai-paneer · `cook_tomato_base` | periodic | `burner` | yes |
| chicken-biryani · `cook_chicken` | periodic | `burner` | yes |

`station: "none"` conflates "cold rest" with "unstated", and `unattended` spans both a
hot oven bake and a room-temperature rise. There is no sound heat signal in the schema,
so the copy does not attempt one.

This needs **no `CookingGraph` schema change.** `attention` is already on `Node`;
`derive.ts` already carries `attention` through for borrowed tasks; the host's `attention`
is the same kind of categorical lookup. If deriving the caption ever turns out to need a
schema change, that is a product decision — stop and raise it, do not make it.

`CLAUDE.md` § Vocabulary is updated to match: the **Parallel task** row no longer mandates
`while this cooks` as the user-facing phrase, and points here.

### PrimaryCTA (M2.5)
Full-width, fixed above the safe area, 52px tall, `--color-signal`, radius 2px; exactly
one on screen at a time. Unchanged from M2 in structure.

**In M2.5 it is signal red and inert.** The label is `Start Cooking`; tapping does
nothing, because cooking mode is M3. This is deliberate — a grey disabled button was
tried in s5 and left the Plan with *no* signal mark at all, which was a measurable step
down from the M2 baseline (whose CTA is a full, live bar). The screen needs its one
signal element. The person-test script must carry an explicit caveat: **the most
prominent element on screen doing nothing may pull a tester's attention to the dead
button and away from the hierarchy under test** — feedback caused by the inert CTA is not
evidence the hierarchy is wrong.

## Future Milestone Reference (M2.75/M3) — not part of M2.5 implementation

A future session must not build anything in this block as part of M2.5.

### StageCard `active` / `complete` states (M3)

`active` is the stage currently being cooked; `complete` is a finished stage. Their
visual treatment is not specified yet — it waits on M3's cooking-mode design, and on the
completion-mark decision the colour section defers to M3 (a completion mark must not
resurrect a general-purpose green).

### Timer digits and timer behaviour (M3)

- **Timer digits.** Type scale row: 44 / 300 / wdth 88, tabular. Shares a size with the
  wait-window numeral and nothing else — see § Type.
- **Timer · ParallelTaskDetail.** Unchanged from M2 in structure. **Store the absolute
  end timestamp, not a countdown integer** — recompute remaining on every render and on
  `visibilitychange`. Phones sleep. (This storage rule is a `CLAUDE.md` non-negotiable and
  applies whenever the timer is built.)

### Authored wait phrase (M2.75/M3) — the caption's upgrade path

The `attention`-derived caption (§ WaitWindowBlock) is the *smallest correct* contract,
not the *best possible* one. The better version, deferred on scope rather than rejected on
merit:

> A nullable `Node.wait_phrase: str | None`, authored by the extractor at import, giving
> the window a per-recipe voice — `while the dough rises`, `while the rendang simmers`,
> `while the shortcakes bake`. `attention` describes involvement, not process; a phrase
> written against the actual dish is warmer and more specific than anything derivable from
> the schema, and the Direction 3 studies were drawn with exactly this copy.

Two questions it must answer that M2.5's version does not have to:

1. **The fallback.** What the caption reads when `wait_phrase` is null — the
   `attention`-derived line is the natural floor, so this upgrade is additive, not a
   replacement.
2. **Non-authored imports.** Link-extracted (Schema.org) and search-derived recipes
   arrive without authored prose. Either the extractor synthesises a phrase from the host
   label, or those recipes fall back to (1). This is a `M4` import-pipeline decision, not
   a rendering one.

Cost when picked up: schema field + all five golden graph fixtures + the extraction
prompt + likely a new invariant. Not an M2.5 convenience.

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
| Typography | Archivo variable, self-hosted, ≤55KB, `font-display: optional`. Six-step scale plus one 44px figure. |
| Stage identity | Kept, but re-derived as six equal-value low-chroma tints applied as a 3px lane rule. Never red. |
| Is a node a card | No — a bar on a time axis. Map grammar only; the Plan view stays rows. |
| Stage rail | Stays **ordinal**, not start time. Ordinal is "where am I", the time axis is "when" — separate jobs. Treatment goes quiet: neutral ink number, tint moves to the lane rule. |
| `→` on button text | Dropped in M2; stays dropped. |
| Plan-view composition | **Direction 3, "Two Kinds of Minute"** (§ Register). The wait window is a full-bleed field with one large numeral; hands-on work is plain rows. Locked. |
| Plan-view warmth degree | No longer an open dial. Direction 3's composition in this file's tokens, held to the M2 baseline floor at every render checkpoint. |
| Wait window "assumes its host is hot" | Caption derives from `attention`, process-neutral (§ WaitWindowBlock). `station` checked across fixtures and rejected. |
| `2 + 7 ≠ 12` arithmetic | Downgraded from blocker to known issue (§ Two layers). Direction 3's composition removes both offending lines; nothing changed in the scheduler. |
| `Start with this` on a single-task window | Rank cue suppressed when the window has one task (§ WaitWindowBlock). |
| Capacity chips carry no magnitude | Chips retired. The single numeral is the duration; fullness is carried by the caption and footer in words. |
| Wait-window field surface too faint | `--color-field` (`#E7DCC3`, the study's field value) replaces `--color-paper-sunk` for the field — ΔE 13 from paper vs 4.3. The only palette change Direction 3 makes. In-field secondary text steps `ink-3` → `ink-2` for AA. See § *`--color-field`*. |
| `--color-signal-sunk` | Removed. Dropped from `index.css` in the M2.5 implementation pass. |
| `GRAPH_VIEW.md` §5 dashed connectors | Contradiction resolved — §5 updated to defer connector grammar to this file's *Connector language* block. No dashes. |

## Still open — classified A (product contract) / B (design calibration) / C (implementation detail)

| # | Item | Class | Note |
|---|---|---|---|
| 1 | **Do wait-window rows read as tappable without a chevron?** | B | Falsifiable at the person test (§ Arrows and chevrons has the pass condition). If it fails, a `+` or a visible control returns — not the `›`. |
| 2 | **Wait-window footer wording.** One line must read correctly for a 0-slack window and a 51-minute one. | B | Provisional in the studies (`Just enough — start as soon as the base is on` / `Nothing else to do until the dough doubles`). Calibrate against both rendered. |
| 3 | **Field-qualification threshold — which windows earn the full-bleed field.** | B | s6 explored `capacity_min ≥ 8`, `used_min ≥ 3`; both are guesses. The field-vs-inline "cliff" (two recipes 2 min apart look very different) is the real question. Calibrate against a real corpus in M2.75; the fix may be "field always, prominence scales". |
| 4 | **Non-windowed unattended time has no visual mark** — a 25-min proof and a 3-min chop render the same. | B/C | Deliberate for now; the tan edge marks that once distinguished them "implied a system that wasn't there". Revisit if the person test shows it matters. |
| 5 | **Multi-window recipes put more than one 44px numeral on screen.** | B | Reads better than feared (different stages, different scroll positions). Restate the principle as "one large number *per window*". No fixture has this; a stress study does. |
| 5a | **The 44px numeral is not duration-scaled — `12`, `20` and `60` get identical weight.** | B | The large numeral is Direction 3's focal treatment for the wait window and stays; the open question is only whether 44px gives a *short* wait disproportionate presence. Test with real people across short and long waits (12 / 20 / 60 min). **Do not solve with duration-dependent typography** — if it needs adjusting, adjust the single scale value. |
| 5b | **`signal` on `--color-field` is 4.1:1** — marginal for the 12px `Start with this` cue. | C | Carried for M2.5. Fix if the person test shows it: bump the cue to 13px, or darken the field-local signal use. Not a token change. |
| 5c | **Pressed state for a task row inside the field.** | C | `paper-sunk` is *lighter* than `--color-field`, so the row's pressed state can't be the on-paper one. Needs a step below `--color-field`. Phase C detail. |
| 6 | **`Stage.color_key`** — unused by the renderer; `stageColor` assigns by position in `graph.stages`. | C | Remove at M4 or write down why it stays. |
| 7 | **The Plan view has no time dimension.** | A (settled) | By design — the bar grammar is the Map's. Revisit only if the M2.75 person test says the Plan needs it too. |
| 8 | **Authored `wait_phrase`** — the caption's better version. | A (deferred) | Scope, not merit. See § *Authored wait phrase*. |
| 9 | **`CookingGraph` cannot express "hot" vs "passive rest".** | A (deferred) | The caption is process-neutral because of this. A real heat field is an M4 schema decision if it is ever wanted; nothing in M2.5–M3 needs it. |
