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

If they need a legend, a tooltip, or a paragraph, the screen has failed. Everything
below is in service of that five seconds.

---

## 2. Three views, one graph

Do not try to make one view do all three jobs. This was already learned the hard way
during the Figma iterations: a desktop-style horizontal node graph does not survive
contact with a phone.

| View | When | What it optimises for |
|---|---|---|
| **Plan** (vertical stages) | Default. Before and during cooking. | Scannability, one thumb, calm |
| **Map** (the actual graph) | On demand — a tab, or pinch/expand from Plan | Comprehension of structure. The "oh, I see" view. |
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
  extras into a "+2 more" affordance rather than shrinking the columns.
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
1. Assign each node a ROW = its earliest start time from the scheduler
   (not its topological depth — time is the vertical axis, and using depth
   makes a 60-minute rise look the same height as a 2-minute chop).
2. Group nodes sharing a row into LANES, left to right, stable-sorted by
   the node's rank within its wait window (rank 0 leftmost — the main thread).
3. The main thread — the critical path — is ALWAYS the leftmost lane and
   always vertically continuous. The eye should be able to run straight down
   it without jumping.
4. Row height ∝ duration, clamped: min 56px, max 140px. A 60-minute rise
   should visibly dwarf a 2-minute chop, but not push everything else off screen.
   Use sqrt scaling, not linear, or one long bake ruins the layout.
5. Merge points: where lanes converge, draw them meeting at a single node.
   The merge is the most information-dense moment in the graph — give it room.
```

Row = time is the single most important choice here. It is what makes the parallelism
*visible* rather than merely *stated*, and it's what nobody else in this space is
doing.

## 5. Encoding — what carries meaning

Every visual property must encode something. If it decorates, cut it.

| Property | Encodes |
|---|---|
| Vertical position | When it happens |
| Vertical extent | How long it takes |
| Horizontal lane | Which parallel thread |
| Solid connector | Hard dependency — must finish before the next starts |
| Dashed connector | "Can be done during" — the parallel relationship |
| Stage tint | Which stage the node belongs to |
| Fill vs outline | Attended vs unattended work |

That last one is the one to get right. **Unattended nodes should look different at a
glance** — they're the whole reason the parallel lanes exist. An outline or hatched
treatment for "this is cooking without you" reads instantly; a small clock icon does
not.

Solid vs dashed connectors is the other load-bearing distinction, and it should be
legible without the legend that the current mockups include. If you need to explain
"→ must happen next / ⇢ can be done in parallel" in a key at the bottom, the strokes
aren't doing their job yet.

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

Questions worth answering deliberately rather than defaulting:

- What does the connector between nodes actually look like? This is the most
  characteristic mark in the whole product and currently it's a generic arrow.
- Is a node a card at all? Cards are the default. A recipe graph could be built from
  bars, rules, or blocks on a time axis instead — closer to a score, a Gantt, or a
  train timetable than to a SaaS dashboard.
- What is the typographic voice? A single family with a real type scale will do more
  for distinctiveness than any color decision.
- What is the one moment of motion? Probably the merge — lanes converging as a stage
  completes. One orchestrated moment, not a fade-and-slide on every card.

Whatever direction is chosen, write it down as a short design brief and put it in
`DESIGN_SYSTEM.md`, so it survives past the session that produced it.

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
- `prefers-reduced-motion` disables the merge animation.

---

## 8. How to know it's working

Not a metric — a test you can run on a person, which is the only thing that counts here.

Hand someone the Map view for a dish they know, say nothing, and ask: **"what happens
while the base is cooking?"**

If they answer correctly in under five seconds without you explaining anything, the
graph view works. If they ask "what do the dotted lines mean?", it doesn't yet.

Run this on five people before writing another line of graph code. It costs an evening
and it is worth more than another Figma iteration.
