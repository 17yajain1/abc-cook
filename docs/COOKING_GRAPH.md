# The Cooking Graph and the Scheduler

This is the core spec of the product. Everything else is a renderer.

Read this fully before changing `abc_cook/schema/`, `abc_cook/extract/`, or
`abc_cook/schedule/`.

---

## 1. Why a graph and not a step list

A recipe written as steps 1–12 hides the only information a cook actually needs while
standing at the stove: **which of these can happen at the same time, and which cannot.**

"Simmer 15 minutes" is not a step. It is fifteen minutes of the cook standing there
doing nothing, unless something tells them what else is ready to be done.

The graph makes that computable. A step list cannot.

---

## 2. Schema

Pydantic v2 models in `abc_cook/schema/`. This is the contract between the extractor, the
scheduler, and the UI.

### Ingredient

```python
class Ingredient(BaseModel):
    id: str                          # "ing_onion"
    name: str                        # "Onion"
    qty: float | None                # 2
    unit: str | None                 # "medium", "g", "tbsp"
    prep_note: str | None            # "finely chopped" — a hint that a prep node exists
    group: str | None                # "For the masala" / "For garnish"
    optional: bool = False
```

### Node

The unit of work. This is where all the intelligence lives.

```python
class Node(BaseModel):
    id: str                          # "cook_base"
    stage: str                       # "cook_base" — groups nodes for the Plan view
    label: str                       # "Cook the base"         (≤ 4 words, UI heading)
    instruction: str                 # full sentence(s) shown in step mode

    kind: Literal["prep", "active", "passive", "combine", "finish"]
    attention: Literal["hands_on", "periodic", "unattended"]

    duration_min: int                # optimistic, minutes
    duration_typical: int            # what the plan displays
    duration_max: int                # used for window-safety checks

    station: Literal["burner", "oven", "counter", "sink", "fridge", "none"]

    depends_on: list[str] = []       # node ids that must COMPLETE first
    consumes: list[str] = []         # ingredient ids and/or component ids
    produces: str | None = None      # component id, e.g. "comp_base"

    interruptible: bool              # can the cook drop this mid-way and come back?
    max_lead_min: int | None = None  # freshness ceiling — see §4.5
    doneness_cue: str | None = None  # "onions light golden, oil separating"
    tip: str | None = None
```

`kind` and `attention` are separate on purpose and both matter:

| | `hands_on` | `periodic` | `unattended` |
|---|---|---|---|
| **prep** | chop, measure, cube paneer | — | marinate, soak, rest dough |
| **active** | sauté, knead, fry | reduce a sauce, stir occasionally | — |
| **passive** | — | simmer with an occasional stir | bake, boil, first rise, dum |

- `attention` decides whether the node **occupies the cook**.
- `kind` decides how it **renders**.
- A node with `attention` of `unattended` or `periodic` is what **creates a wait
  window**.
  No unattended nodes → no parallelism → the product has nothing to offer for that
  recipe, and that is fine. Say so honestly rather than inventing filler tasks.

### Edge

Dependencies are stored on `Node.depends_on`. A denormalised edge list is derived for
rendering, never authored by the LLM.

```python
class Edge(BaseModel):
    src: str
    dst: str
    kind: Literal["sequence", "ingredient", "merge"]
```

### CookingGraph

```python
class CookingGraph(BaseModel):
    id: str
    title: str                       # "Kadai Paneer"
    servings: int
    cuisine: str | None
    source: SourceRef                # url / image / pasted text + imported_at
    ingredients: list[Ingredient]
    nodes: list[Node]
    stages: list[Stage]              # ordered; id, label, color_key
    stated_total_min: int | None     # what the original recipe claimed, for validation
```

### CookingPlan — the scheduler's output

```python
class ScheduledNode(BaseModel):
    node_id: str
    start_min: float
    end_min: float
    occupies_cook: bool
    window_id: str | None            # set if this ran inside someone else's wait window
    rank_in_window: int | None       # 0 = the "start with this" task

class WaitWindow(BaseModel):
    id: str
    host_node_id: str                # the unattended node whose duration creates it
    capacity_min: float              # usable minutes (reduced for `periodic` — §4.3)
    assigned: list[str]              # node ids, in the order to do them
    used_min: float
    slack_min: float

class CookingPlan(BaseModel):
    graph_id: str
    scheduled: list[ScheduledNode]
    windows: list[WaitWindow]
    total_min: float                 # makespan of the scheduled plan
    serial_min: float                # sum of all typical durations, one at a time
    saved_min: float                 # serial_min - total_min
    critical_path: list[str]
    warnings: list[str]
```

`saved_min` is the number the whole product is arguing for. Put it on screen:
*"This plan saves you 13 minutes."*

---

## 3. Worked example — Kadai Paneer

The graph (abridged — `typical` column only; the full `duration_min / typical / max`
triples, ingredients, and `consumes`/`produces` live in
`apps/api/tests/fixtures/kadai-paneer.graph.json`):

| id | kind | attention | typical | station | depends_on |
|---|---|---|---|---|---|
| `chop_onion` | prep | hands_on | 3 | counter | — |
| `chop_tomato` | prep | hands_on | 2 | counter | — |
| `saute_onion` | active | hands_on | 5 | burner | `chop_onion` |
| `cook_tomato_base` | passive | periodic | 12 | burner | `saute_onion`, `chop_tomato` |
| `chop_capsicum` | prep | hands_on | 5 | counter | — |
| `cube_paneer` | prep | hands_on | 2 | counter | — |
| `make_kadai_masala` | prep | hands_on | 2 | counter | — |
| `add_veggies` | active | hands_on | 5 | burner | `cook_tomato_base`, `chop_capsicum`, `make_kadai_masala` |
| `add_paneer` | active | hands_on | 5 | burner | `add_veggies`, `cube_paneer` |
| `finish` | finish | hands_on | 2 | burner | `add_paneer` |

Serial baseline (sum of `duration_typical`): 3+2+5+12+5+2+2+5+5+2 = **43 min**.

Scheduled:

```
t=0    chop_onion        (cook busy 0–3)
t=3    saute_onion       (cook busy 3–8, burner)
t=8    chop_tomato       (cook busy 8–10)   ← must precede the base
t=10   cook_tomato_base  (burner 10–22, periodic → cook mostly free)
       ┌─ WINDOW w1, capacity 12 × 0.75 = 9.0 min usable
       │  t=10  chop_capsicum      5 min   rank 0  ← "start with this"
       │  t=15  cube_paneer        2 min   rank 1
       │  t=17  make_kadai_masala  2 min   rank 2
       └─ used 9.0, slack 0.0
t=22   add_veggies       (cook busy 22–27)
t=27   add_paneer        (cook busy 27–32)
t=32   finish            (cook busy 32–34)

total_min = 34    serial_min = 43    saved_min = 9
```

Note that the UI copy from the design — **"9 min prep · fits in 12 min"** — falls
straight out of `used_min` and the host node's duration. It is not written by an LLM
and not hardcoded. That is the point.

> The example above assumes the cook chops tomato before starting the base. A different
> ordering (chop tomato inside the window) is invalid because `cook_tomato_base`
> depends on it. The scheduler enforces this; a human writing "while this cooks, chop
> the tomatoes" would not catch it. This class of bug is exactly what we're selling.

---

## 4. The scheduler

`abc_cook/schedule/`. Pure functions. No I/O.

This is resource-constrained project scheduling with one renewable resource of
capacity 1 (**the cook**) plus contended stations. RCPSP is NP-hard in general, but
recipes have 8–30 nodes, so a **greedy list scheduler with good priority rules** is
both fast and good enough. Do not reach for an ILP solver.

### The one rule that governs all scheduler logic

**`attention` determines whether the cook is occupied. `kind` does not.**

```
hands_on   → cook is occupied for the entire duration
periodic   → cook is intermittently occupied (must return every few minutes)
unattended → cook is free
```

Every scheduler decision about "is the cook free?" or "does this create a wait window?"
must check `attention`, never `kind`. The `kind` field (`prep`, `active`, `passive`,
`combine`, `finish`) determines how the node *renders* and how the extractor
*classifies* work — it has no effect on scheduling.

If you find yourself writing `if node.kind == "passive"` in the scheduler, stop — you
almost certainly mean `if node.attention in ("unattended", "periodic")`. This is the
single most likely source of subtle bugs in this codebase.

### 4.1 The list scheduler — the global stage

This stage places **every** node on the timeline. It is distinct from §4.4: §4.1 runs
the clock and answers *"when does each node run?"*; §4.4 runs afterwards on the finished
timeline and only answers *"which window owns this prep task, and how does the UI order
them?"*. Never let logic from one leak into the other.

```
1. Validate the graph (§5). Reject or repair before scheduling.
2. Compute for each node its `level` = longest path from the node to any sink,
   using duration_typical as edge weight. This is the classic critical-path rank.
3. t = 0; running = {}; done = {}
4. Loop until all nodes are done:
     a. ready = nodes whose depends_on ⊆ done, not started
     b. Start every ready node whose `attention` is `unattended` or `periodic` and
        whose station has capacity (§4.6). Do this FIRST — see §4.2. These nodes
        do not occupy the cook.
     c. If the cook is free, start ONE ready `hands_on` node whose station has
        capacity and that is not being withheld for freshness (§4.5). Choose it:
          — while a wait window is open (some unattended/periodic node is running):
            by the §4.4 key — longest `duration_typical` first, then `node_id`.
            The cook is filling time; critical-path rank does not apply here.
          — otherwise: highest `level` (critical path first), then a cooking node
            (`active` / `combine` / `finish`) before `prep`, then longest
            `duration_typical`, then `node_id`.
     d. Advance t to the next completion event; move finished nodes to done.
5. Derive wait windows (§4.3) from the resulting timeline.
6. Assign each window's tasks and rank them (§4.4); drop empty windows and
   renumber; run the safety checks (§4.5).
```

**Trade-off this accepts.** Inside an open window the cook takes the *longest* ready
prep, not the one that unblocks the most downstream work. On `chicken-biryani` this
starts a 3-minute marinade mix after two longer chops, delaying the chicken chain and
making the plan ~7 min longer than its critical path (66 vs 59). Deliberate: the rule
stays generic and predictable instead of growing recipe-specific priority special
cases.

**`total_min` is the scheduled makespan, not the graph's critical path.** The critical
path is the longest *dependency* chain (`plan.critical_path`, weighted by
`duration_typical`). The makespan can exceed it whenever a resource forces off-path
work to run in series — the single cook (biryani, above), a contended station, or a
**freshness delay** (§4.5), where a fresh task is deliberately held back and run
just-in-time. None of these delays are added to `critical_path`; the two numbers
answer different questions and are not expected to match.

### 4.2 The one heuristic that matters

**Start unattended work as early as its dependencies allow, before doing any prep the
cook could do later.**

This is the entire difference between a good cooking plan and a bad one. Put the rice
on, *then* chop the coriander. A naive topological order will happily have the cook
chop for eight minutes while the pot sits cold, and the plan will be correct but
useless.

If you change one thing in the scheduler and the fixtures regress, it is almost
certainly this.

### 4.3 Deriving wait windows

A window exists for every interval where:

- at least one node with `attention == "unattended"` or `attention == "periodic"` is
  running, **and**
- the cook is not required by that node.

Usable capacity:

| host `attention` | capacity | max single task |
|---|---|---|
| `unattended` | `duration_typical × 0.9` | no cap |
| `periodic` | `duration_typical × 0.75` | `interruptible` task: up to `capacity_min` · non-`interruptible` task: 3 min |

The multipliers are safety margin: the user is a human in a kitchen, not a CPU. Never
pack a window to 100%. A plan that tells someone to do nine minutes of chopping inside
a nine-minute simmer will burn the base, and they will not trust the app again.

The `0.75` factor already encodes "the cook must return every couple of minutes", so an
`interruptible` task — chopping, measuring, anything you can set down mid-stroke to go
stir — may use the window up to its full `capacity_min`. §3's 5-minute `chop_capsicum`
inside a 9-minute capacity is deliberately fine. The separate 3-minute ceiling applies
only to non-`interruptible` tasks, which must complete in one uninterrupted run.

`capacity_min`, `used_min`, and `slack_min` are rounded to `0.01` min: the `× 0.9`
factor is not exactly representable in binary and golden-plan comparison is exact.
Two-decimal minutes is finer than any kitchen needs.

A window whose assigned list ends up empty is **dropped** from `plan.windows`; the
survivors are renumbered `w1…wN` in `(host start, host id)` order. An empty window is
dead time, not a "while this cooks" opportunity — never surface one (`maggi-2min` is
the case that exercises this).

### 4.4 Windowed prep — ownership, order, and rank (the post-timeline stage)

This runs on the finished timeline from §4.1. **It never moves a node in time.** One
ordering key throughout — `duration_typical` descending, then `node_id` ascending:

1. **Pick order (feeds §4.1.c).** While a wait window is open, the list scheduler
   chooses the cook's next `hands_on` task by this key — nothing else.

2. **Ownership.** Walk windows in `(host start, host id)` order. For each window, take
   the still-unclaimed `hands_on` nodes that ran fully inside its host's interval, in
   key order, and claim each one that passes **both** gates:

   - **Typical-duration packing:** `used_typical + task.duration_typical ≤ capacity_min`,
     where `used_typical` is the running sum of what this window has already claimed.
   - **Maximum-duration safety eligibility:** `task.duration_max ≤ capacity_min`.

   A task that fails **either** gate is not claimed by this window and stays available
   for later, roomier windows. A task claimed by an earlier window is never offered to
   a later one — **one task, one window**. A task that no window can safely hold is
   simply a serial step; that is normal, not a warning.

   The walk does **not** stop at the first task that overflows `capacity_min`; it
   continues, and a smaller task later in the key order may take the room the
   overflowing one could not use (first-fit). The fixed key order keeps this
   deterministic.

   The two gates are different questions. Packing keeps the *expected* workload inside
   the window. The safety gate keeps out a task whose *worst case* would blow the
   window — `chicken-biryani`'s `slice_onions` (typical 4, max 6) packs into the
   5.4-min boil window but is not safe there, so it drops through to the 18-min soak
   window, where both gates pass.

3. **Rank.** `rank_in_window` 0 is the task the UI promotes as *"Start with this."*
   Same key.

Why "longest first": the longest task is the one most at risk of not fitting, and
"start with the big one" is the right instinct at the stove.

Freshness is not an input here. A task with `max_lead_min` set never reaches an early
window in the first place — §4.5 withholds it from scheduling until it is its
consumer's last outstanding dependency, so it runs just before the consumer, long
after any earlier window has closed.

### 4.5 Safety checks — emit into `plan.warnings`

- **Worst-case window fit** is not a check here. `duration_max` is an *eligibility
  gate during assignment* (§4.4): a window never claims a task whose `duration_max`
  exceeds its `capacity_min`, so there is nothing to drop or warn about after the fact.
  A prep task that fits no window by that gate is just a serial step.
- **Freshness** (`max_lead_min`): whipped cream, a cut avocado, a tempered spice lose
  their point if they sit. A node with `max_lead_min` set is **withheld from
  scheduling** — step (c) will not start it — until it is the *last* thing its consumer
  is waiting on: every other dependency of that consumer that is not itself
  freshness-constrained is `done`. It then runs just-in-time, right before the
  consumer, and is structurally incapable of landing in an earlier wait window.

  If resource contention still makes the consumer start more than `max_lead_min` after
  the fresh node finishes — a higher-priority task grabbed the cook in between — that
  is a real problem the scheduler could not prevent: emit a warning naming the node,
  the consumer, and the actual lead.

  **M1 scope:** the withholding rule is defined only for the canonical case — a
  freshness-constrained node with a **single consumer**. A fresh node with zero or
  several consumers is scheduled normally (no delay); the post-hoc lead warning still
  fires for every consumer. Multi-consumer freshness scheduling — which consumer to
  time against — is **deferred until explicitly specified**.
- **Station contention**: the scheduler may run up to `burner_capacity` (§4.6) burner
  nodes at once; every other station is capacity 1. Whenever the finished timeline has
  two or more nodes sharing a station at any instant, emit one note per station:
  `"uses N burners"`, where N is the peak simultaneous count. This fires **even when
  the overlap was allowed by configuration** — a plan that assumes two free rings must
  say so, because plenty of kitchens don't have them. (Nodes that merely touch at a
  boundary — one ends exactly as the next starts — do not overlap.)
- **Non-interruptible task over 3 min in a `periodic` window**: reject the assignment
  (§4.3). A non-interruptible task of 3 min or less may stay.
- **No windows found**: not a warning, a fact. The UI shows a plain step-by-step plan
  and says nothing about parallelism. Never fabricate filler tasks like "clean your
  countertop" to fill a window — the design mockups did this and it cheapens the
  feature.

### 4.6 Kitchen configuration

`schedule(graph, *, burner_capacity: int = 1)`. **The recipe graph does not know how
many burners the kitchen has.** A `station == "burner"` node only declares that it
needs a ring; how many rings exist is a property of the cook's kitchen, passed in
separately:

- Default `burner_capacity = 1` — burner nodes are serialised.
- `burner_capacity = 2` — the scheduler may overlap burner nodes two-deep. It still
  never overlaps two `hands_on` burner nodes: the single cook can't work two pans.

Where the value comes from in production — an API parameter, a saved kitchen profile —
is deferred past M1. For now it is a keyword argument defaulting to 1, and a golden
fixture that needs a non-default value carries it alongside its graph
(`<slug>.kitchen.json`).

Do not add burner counts, oven counts, or other kitchen inventory to the schema. When
a second contended resource genuinely needs configuring, revisit this as one small
`KitchenConfig`, not a scatter of keyword arguments.

---

## 5. Graph invariants — validate every extraction

Run in `abc_cook/extract/validate.py`. These are hard gates, not warnings.

1. All `depends_on` ids exist.
2. The graph is **acyclic** (topological sort succeeds).
3. Exactly one sink node, and it is `kind == "finish"`.
4. No orphans: every node is reachable from some source and reaches the sink.
5. Every non-optional ingredient is consumed by ≥ 1 node.
6. Every `produces` component id is consumed by ≥ 1 downstream node.
7. `duration_min ≤ duration_typical ≤ duration_max`, all > 0.
8. If `stated_total_min` is present, `|serial_min − stated_total_min| ≤ 0.4 ×
   stated_total_min`. A big gap means the model invented or dropped work.
9. `attention == "unattended"` implies `kind in {"passive", "prep"}`.
10. Every `stage` referenced by a node exists in `stages`.

**On failure:** one repair pass — send the model its own output plus the specific
violated invariants, ask for a corrected graph. If it fails again, degrade to a linear
`kind: "active"` chain from the raw steps and set `plan.warnings = ["degraded"]`. The
user still gets a usable recipe. They never see a stack trace.

---

## 6. The extraction prompt

Lives in `abc_cook/extract/prompts/`, versioned (`v1.md`, `v2.md`). Never inline a prompt
in Python.

Non-obvious things it must be told, all learned from how recipes are actually written:

- Split a written step into multiple nodes when the attention type changes. *"Sauté the
  onions for 5 minutes, then add tomatoes and simmer 10"* is two nodes, and the second
  is what makes the recipe worth scheduling.
- Infer prep nodes from ingredient `prep_note`s. "2 onions, finely chopped" implies a
  `chop_onion` prep node even if no step mentions chopping. Indian recipes assume this
  constantly.
- Preheating the oven is an `unattended` node with no dependencies — it is often the
  single best window in a baking recipe and recipes almost never surface it as one.
- Marinating, soaking dal, resting dough, cooling: `prep` + `unattended`. These create
  the largest windows.
- `duration_max` should be honest, not optimistic. It is what the safety checks use.
- Never invent a duration for "cook until golden" — set a plausible typical from the
  cuisine, widen `duration_min`/`duration_max`, and always fill `doneness_cue`.

Model choice sits behind `abc_cook/extract/adapters/`. Start with a cheap
vision-capable model, escalate only on repair. Budget roughly ₹0.5–₹2 per import;
if a change pushes that up, it needs a reason.

---

## 7. Test strategy

`tests/fixtures/` holds golden recipes as `<slug>.graph.json` +
`<slug>.plan.json`. Start with these five, chosen because each breaks a different
assumption:

| Fixture | What it tests |
|---|---|
| `kadai-paneer` | The canonical case. Branch → merge, one `periodic` window. |
| `homemade-donuts` | A 60-minute `unattended` rise. Huge window, freshness limits. |
| `chicken-biryani` | Two independent chains (rice, chicken) merging at layering. Runs at `burner_capacity=2`; plan emits `uses 2 burners`. Multiple overlapping windows, single-claim ownership. |
| `maggi-2min` | Nothing to parallelise. Plan must degrade gracefully and stay quiet. |
| `strawberry-shortcake` | `max_lead_min` matters — whipped cream and cut fruit can't be done early. |

Two test layers:

- **Scheduler tests** (`test_schedule.py`): fixed graph in, plan compared to the golden
  plan. Fast, deterministic, run on every commit.
- **Extraction tests** (`test_extract.py`): real recipe text/images in, assert the graph
  *invariants* hold and node count is within a range. Never assert exact LLM output —
  that test will fail forever. These hit the network, so mark them `@pytest.mark.llm`
  and keep them out of the default run.
