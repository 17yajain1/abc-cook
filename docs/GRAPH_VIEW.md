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
- **Two fixed columns, not a lane count to reason about.** A mainline spine on the left
  and everything else on the right (`DESIGN_SYSTEM.md` § *The Map grammar*). Beyond what
  the right column can show without a time collision — a window's 4th+ member, or any
  card whose interval collides with what's already shown — the rest collapse into a quiet
  `+N more` text label under the relevant card: no box, no border, count-based and generic
  (never tuned to a specific recipe's member count).
- **Minimum node width 96px** and minimum tap target 44px. Both columns are fixed widths
  (190px mainline, 108px right) comfortably above the floor; a card only grows taller,
  never narrower.
- **No pan-and-zoom canvas as the primary interaction.** It feels like a diagramming
  tool, not a cooking tool. Fit-to-width, scroll vertically. Zoom can exist as a
  gesture; it must not be *required*.
- Whole graph should be comprehensible within **two screen heights** for a typical
  recipe. If it isn't, collapse stages by default.

---

## 4. Layout algorithm

Deterministic, computed from the plan — never hand-placed, never LLM-placed, and never
branching on which recipe it is (`M2.75 Map design handoff.md`; conflicts between it and
the implementation brief resolved in `DESIGN_SYSTEM.md` § *Resolved in M2.75, round 2*).

```
1. CLASSIFY. A task in a window's `assigned` is a window child. A window's
   `host_node_id` is seeded onto the mainline first, sorted (start_min, node_id) —
   so a host never loses its mainline slot (and its bracket) to a tie. Everything
   else is walked in (start_min, end_min asc, node_id) order against the mainline
   intervals reserved so far: no overlap -> mainline, reserve it; overlap -> an
   independent concurrent card. Pure interval math — no flag is ever set by hand.
2. COLUMNS. Mainline at x=20/w=190. Window children and independents share one
   right column at x=222/w=108, sorted (start_min, child-before-independent,
   rank_in_window, node_id). A window's members are tried first at each time
   slice; anything — member or independent — that would collide with what's
   already shown, or a window's 4th+ member, folds into a quiet `+N more` label
   under the relevant shown card instead of a third column.
3. TIME -> Y. One shared vertical map for both columns, built from every distinct
   start_min/end_min in the plan: each stretch is
   clamp(20*sqrt(Δmin) + 20, 44, 120) plus a 12px gap, then grown further wherever
   a card's own wrapped-label height needs more room than its duration gives it
   (text is never clipped or shrunk to fit — the card grows instead). No axis or
   ticks are drawn; this map only decides where things sit.
4. EDGES. One per depends_on pair where BOTH ends are mainline cards — never into
   or out of a window child or an independent, even when the underlying
   dependency is real. Adjacent mainline pair: a straight line. A pair with
   another mainline card between them: an elbow into the left gutter and back,
   merging onto the same final segment every edge into that target shares — one
   arrowhead per merge.
5. BRACKETS. One dashed mark per window whose host stayed mainline and has at
   least one shown member: a stem off the host's right edge, a spine, one tick
   with an arrowhead into each shown member. Independent-overlap cards get no
   connector of any kind — position beside the card they overlap is the only
   relationship shown.
```

Row = time is the single most important choice here. It is what makes the parallelism
*visible* rather than merely *stated*, and it's what nobody else in this space is
doing. The full mark set — card fill, exact geometry constants, fold and bracket
rendering — is `DESIGN_SYSTEM.md` § *The Map grammar*; this section owns the algorithm,
that one owns the marks.

## 5. Encoding — what carries meaning

Every visual property must encode something. If it decorates, cut it.

| Property | Encodes |
|---|---|
| Vertical position | When it happens |
| Vertical extent | How long it takes (sqrt-compressed) or how much label it carries, whichever is greater |
| Column (mainline vs right) | Mainline sequence vs window-child / independent-overlap — an interval-math fact, not an authored category |
| Card tint vs field fill | Attended work in its own stage vs a window child on the wait-window field colour |
| Solid arrow | A real `depends_on` pair between two mainline cards |
| Dashed bracket | One wait window, host to its shown members — never one line per member |
| No connector | An independent-overlap card: related only by sitting beside what it overlaps |
| A third card line | Attention, mainline cards only: `(low attention)` / `(hands off)` / nothing for hands-on |
| Quiet `+N more` text | A window's 4th+ member, or any right-column card that collided in time with what's already shown |
| Legend | The key for the above, kept compact — see below |

**Attended vs unattended is carried by fill, not by outline.** A window child runs on the
wait-window field colour regardless of its own stage; a mainline or independent card runs
on its stage tint. The field colour is shared with the Plan's own *Meanwhile, do these*
panel, so "while waiting" reads as one thing across both views
(`DESIGN_SYSTEM.md` § *The Map grammar*).

**Connectors carry meaning by weight, colour and dash pattern, and by which two things
they connect.** `DESIGN_SYSTEM.md` § *The Map grammar* is authoritative for the mark set:
a 1.5px ink line for a mainline dependency, a dashed `ink-3` bracket for a window. A
dependency line never touches a window-child or independent card, and an independent card
never gets a connector at all — the two-column classification carries that distinction, a
line doesn't have to. The five-second test in § 8 is still the actual bar, and the legend
must stay compact enough to clear it rather than becoming the explanation the graph itself
should carry.

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
- ~~What is the one moment of motion?~~ Cards sweep in top-to-bottom (delayed by their own
  `y`, in place of the axis this Map no longer draws), then connectors and fold labels
  fade in — not the merge. Built last, after the render checkpoints (`DESIGN_SYSTEM.md`
  § *Map entry animation (M2.75)*).

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
