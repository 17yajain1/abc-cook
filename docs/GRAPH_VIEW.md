# The Graph View

USP #1. This is the screen the product is judged on.

`COOKING_GRAPH.md` defines what the graph *is*. This file defines how it is *drawn*,
and the constraints that make a graph legible on a 390px screen.

---

## 1. What this screen has to do

ReciMe and the other importers end at a clean ingredient list. That is genuinely useful
and it is where they stop. Our claim starts one step later:

> **A recipe isn't a list. It's a structure — things get made, then combined, then
> cooked. Show me the structure and I'll cook better.**

So the graph view has one job, and it is not "look impressive":

> A person who has never seen the app should look at this screen for **five seconds**
> and understand how the dish is built — what merges into what, and which parts happen
> at the same time.

Everything below is in service of that five seconds. (An earlier draft of this rule said
a legend means the screen failed. The M2.75 direction keeps a compact legend — see
`DESIGN_SYSTEM.md` § *The Map grammar* and § *Resolved in M2.75* — because the mock reads
clearly with one; the five-second test itself is still the bar a legend must clear, not a
reason to omit one.)

---

## 2. Three views, one graph

Do not try to make one view do all three jobs. This was already learned the hard way
during the Figma iterations: a desktop-style horizontal node graph does not survive
contact with a phone.

| View | When | What it optimises for |
|---|---|---|
| **Plan** (vertical stages) | Default. Before and during cooking. | Scannability, one thumb, calm |
| **Map** (the actual graph) | On demand — a `Plan · Map` mode switch inside the Cooking Plan tab | Comprehension of structure. The "oh, I see" view. |
| **Step** | While cooking | One instruction. Nothing else. |

The Plan view is what people use. **The Map view is what makes them understand the
product** — it is the screenshot that gets shared, the thing in the app store listing,
the reason someone tells a friend. It earns its complexity by being optional.

The old rule still holds: *the graph is the map; step-by-step is the execution layer.*
The refinement is that the map deserves to be beautiful, because it is doing the
persuading.

---

## 3. Constraints that come from the phone

390px wide, one thumb, kitchen lighting, possibly a wet screen.

- **Vertical flow, always.** Time runs down the screen. Parallelism runs across.
  Never the other way round — horizontal scrolling to follow a recipe is a failure.
- **Maximum 3 parallel lanes.** Real recipes rarely exceed 2. Beyond 3, collapse the
  extras into an overflow card rather than shrinking the columns: one `+N more` card in
  the last lane, spanning the interval the overlapping nodes share, `paper-sunk` fill and
  a dashed `ink-3` stroke to mark it as a summary rather than a task — inert until a later
  milestone gives it a tap (`DESIGN_SYSTEM.md` § *The Map grammar*, "Overflow").
- **Minimum node width 96px** and minimum tap target 44px. If the layout algorithm
  wants to go below either, it must reduce lanes instead.
- **No pan-and-zoom canvas as the primary interaction.** It feels like a diagramming
  tool, not a cooking tool. Fit-to-width, scroll vertically. Zoom can exist as a
  gesture; it must not be *required*.
- Whole graph should be comprehensible within **two screen heights** for a typical
  recipe. If it isn't, collapse stages by default.

---

## 4. Layout algorithm

Deterministic, computed from the graph — never hand-placed, never LLM-placed.

```
1. AXIS. Breakpoints are every distinct start_min/end_min in the plan.
   Segment height = clamp(34·sqrt(Δmin), 56, 140), accumulated top to bottom
   with 16px top padding. Sqrt, not linear, so a 60-minute rise dwarfs a
   2-minute chop without pushing everything else off screen. Ticks are drawn
   at every breakpoint, not at fixed 5-minute intervals — the axis is
   compressed, so evenly numbered ticks would sit unevenly apart and read as
   a bug. If two tick labels would land under 14px apart, the later one is
   omitted (the mark stays; only the redundant label goes).
2. LANES, left to right:
   a. Lane 0 = every node in plan.critical_path. This is a layout input
      only — it decides which column is leftmost. Nothing about it is drawn
      or named on screen (DESIGN_SYSTEM.md § The Map grammar).
   b. A window's borrowed tasks go in host.lane + 1, each occupying its own
      scheduled interval. A borrowed task that is also on the critical path
      stays in lane 0.
   c. Everything else is first-fit into the lowest free lane ≥ 1, ordered by
      (start_min, hosts-first, rank_in_window, node_id).
   d. Maximum 3 lanes. A node with no free lane ≤ 2 joins the overflow card
      for its interval (§ 3) instead of a fourth column.
3. EDGES. One per depends_on pair: an orthogonal elbow from the source's
   bottom edge into the target's top edge, arrowhead at the target. Edges
   converging on one target share their final vertical segment, so a merge
   point draws as a single arrowhead — that shared segment is the merge.
4. FLOWS. One per wait window: a dashed bus leaves the host card's right
   edge and branches once per borrowed task into its left edge. Drawn only
   from plan.windows — never inferred from a node's attention value.
```

Row = time is the single most important choice here. It is what makes the parallelism
*visible* rather than merely *stated*, and it's what nobody else in this space is
doing. The full mark set — card fill, stroke, text, and exact geometry constants — is
`DESIGN_SYSTEM.md` § *The Map grammar*; this section owns the algorithm, that one owns
the marks.

## 5. Encoding — what carries meaning

Every visual property must encode something. If it decorates, cut it.

| Property | Encodes |
|---|---|
| Vertical position | When it happens |
| Vertical extent | How long it takes |
| Horizontal lane | Which parallel thread |
| Card tint vs field fill | Attended work in its own stage vs work borrowed into a wait window |
| Solid arrow | A dependency |
| Dashed arrow | A wait-window assignment — "you can do this while that happens" |
| A third card line | Attention: `(low attention)` / `(hands off)` / nothing for hands-on |
| Legend | The key for the above, kept compact — see below |

**Attended vs unattended is carried by fill, not by outline.** A node the scheduler
placed in a stage runs on its own stage tint; a node it borrowed into a window runs on the
wait-window field colour. The field colour is shared with the Plan's own *Meanwhile, do
these* panel, so "while waiting" reads as one thing across both views
(`DESIGN_SYSTEM.md` § *The Map grammar*).

**Connectors carry meaning by weight, colour and dash pattern.** `DESIGN_SYSTEM.md` §
*The Map grammar* is authoritative for the mark set: a 1px ink line with an orthogonal
elbow and an arrowhead for a dependency, a 1px dashed `ink-2` line for a wait-window
assignment. Solid-vs-dashed was rejected in an earlier direction as "the distinction that
needs a key" — that objection held only while the Map had no legend. This direction has
one (§ *Resolved in M2.75*), so the objection no longer applies; the five-second test in
§ 8 is still the actual bar, and the legend must stay compact enough to clear it rather
than becoming the explanation the graph itself should carry.

---

## 6. Design direction — read this before styling anything

Load the `frontend-design` skill first. Then know what you're working against.

The current Figma Make output is competent and generic. Specifically, it lands on
several of the recognised generated-design defaults: warm cream background, identical
rounded cards with the same radius and the same soft grey shadow regardless of
hierarchy, tracked-out ALL-CAPS eyebrow labels, meta strings joined with middle dots,
a green accent that could belong to any wellness app. It looks like every AI-designed
recipe app, because it is one.

That's fine as a starting point and it should not be thrown away — the *information
hierarchy* in those frames was hard-won and is good. But the visual identity is unclaimed
territory, and for a product whose entire pitch is "we're the visual one," shipping the
default look is a real competitive problem.

Where to spend the boldness: **the Map view and nowhere else.** One memorable thing.
The Plan view, the Step view, and the timers should be quiet, disciplined, and
unremarkable — a person cooking does not want personality from their timer. The Map is
where the product gets a face.

Questions worth answering deliberately rather than defaulting — **answered for M2.75 by
the owner's mock**, `docs/design/renders/m275-direction-mock.png` (s9):

- ~~What does the connector between nodes actually look like?~~ A solid orthogonal arrow
  for a dependency, a dashed one for a wait-window assignment. `DESIGN_SYSTEM.md` §
  *The Map grammar*.
- ~~Is a node a card at all?~~ Yes — a rounded, stage-tinted card on a time axis, not a
  measured bar. (An earlier direction answered "no" and built the connector language
  around a bar grammar; that grammar was drawn in
  `docs/design/map-study-kadai-paneer.html` and never shipped. Reversed in M2.75 — see
  `DESIGN_SYSTEM.md` § *Resolved in M2.75*.)
- ~~What is the typographic voice?~~ Unchanged from the rest of the app — Archivo
  variable, the same type scale as the Plan view (`DESIGN_SYSTEM.md` § Type).
- ~~What is the one moment of motion?~~ The time axis scales in on entry, then cards and
  arrows fade in — not the merge. Built last, after the render checkpoints (§ Motion).

The brief is written into `DESIGN_SYSTEM.md` § *The Map grammar*, so it survives past the
session that produced it.

---

## 7. Implementation notes

- **SVG, not a graph library.** D3-force, React Flow, and friends are built for
  interactive node-editing canvases — draggable nodes, arbitrary layouts, pan/zoom
  chrome. Our layout is deterministic and fully computed in step 4. Pulling in a graph
  library means fighting its assumptions and shipping ~100KB to draw twenty rectangles.
  Hand-rolled SVG with computed coordinates is less code and gives complete control
  over the marks, which is exactly where the design value is.
- Layout computation is a **pure function**: `CookingPlan → LayoutSpec` (nodes with
  x/y/w/h, connectors with paths). Testable, and it keeps geometry out of the
  components.
- The rendered graph must be **screenshot-able**. People will share it. Make sure it
  looks right cropped to a square and readable at 2x downscale.
- Accessibility: the Map view needs a text-equivalent linearisation, which we get for
  free — it's the Plan view. Make sure a screen reader gets that instead.
- `prefers-reduced-motion` disables the entry animation (§ 6; `DESIGN_SYSTEM.md` § Motion).

---

## 8. How to know it's working

Not a metric — a test you can run on a person, which is the only thing that counts here.

Hand someone the Map view for a dish they know, say nothing, and ask: **"what happens
while the base is cooking?"**

If they answer correctly in under five seconds without you explaining anything, the
graph view works. If they ask what any mark means — a card, a solid or dashed arrow, the
attention note, an entry in the legend — it doesn't yet.

Run this on five people before writing another line of graph code. It costs an evening
and it is worth more than another Figma iteration.
