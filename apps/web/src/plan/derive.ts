import type {
  CookingGraph,
  GraphProvenance,
  Ingredient,
  Node,
  NodeProvenance,
  PlanSummary,
  RecipePlanResponse,
  ScheduledNode,
  StageSpan,
} from '@abc-cook/schema'

import { executionOrder } from '@/cooking/model'
import type { ServingsSource } from '@/lib/servings'

/** `NodeProvenance.fields` values — extracted/inferred/defaulted, per `provenance.py`. */
export type ProvenanceSource = NonNullable<NodeProvenance['fields']>[string]

/**
 * Joins a scheduled plan to its graph into rows the Plan view can render directly.
 *
 * This is the ONLY place the plan and graph are combined, and it is deliberately
 * arithmetic-free: it groups, sorts, and looks values up by id, but every number it
 * emits is copied verbatim from the scheduler's output (CLAUDE.md — the frontend never
 * derives a duration, a capacity, or a saving). If you find yourself adding two minute
 * values here, the sum belongs in `abc_cook/schedule/` instead.
 */

/** One unit of work, ready to render. Numbers are display-only, straight from the graph. */
export interface RenderTask {
  nodeId: string
  label: string
  instruction: string
  durationTypical: number
  donenessCue: string | null
  attention: Node['attention']
  /** How `durationTypical` was arrived at, or `null` when no provenance was supplied. */
  durationProvenance: ProvenanceSource | null
  /** Position in `graph.stages` of the stage this task actually belongs to — always its
   * own true home stage, whether the task is inline in its own stage's card, absorbed
   * as a foreign row into a different card (`RenderStage.hasForeignRows`), or borrowed
   * into a wait window. Drives its tint: equal to the containing card's own `index` in
   * the ordinary case, different only for a foreign/borrowed row. */
  homeStageIndex: number
  /** `Node.tip`, verbatim. `null` when the graph gave none. */
  tip: string | null
}

/** A task the scheduler placed inside a wait window — borrowed from another stage. */
export interface RenderWindowTask extends RenderTask {
  /** 0 is the task the UI promotes as "start with this". */
  rankInWindow: number
}

/** The wait-window field, hanging off the stage its host node belongs to. */
export interface RenderWindow {
  id: string
  hostNodeId: string
  /** The host node's label — the field's subject line. */
  hostLabel: string
  /** The host's own duration — the big numeral. */
  hostDurationTypical: number
  /**
   * The host's `attention`. Drives the caption under the numeral (DESIGN_SYSTEM.md
   * § WaitWindowBlock): `unattended` → "hands off", `periodic` → "checking now and then".
   * A categorical lookup, not a computed value — same as `RenderTask.attention`.
   */
  hostAttention: Node['attention']
  /** The host's doneness cue, shown as the field's `until …` line. `null` when it has none. */
  hostDonenessCue: string | null
  usedMin: number
  slackMin: number
  capacityMin: number
  tasks: RenderWindowTask[]
}

/**
 * One card in the Plan, as it's actually drawn: a maximal run of consecutive inline
 * tasks sharing one `Node.stage`, in cooking order (plan §D) — plus any windows hosted
 * by a task in that run. Reading order is cooking order, so a stage whose inline work
 * is interrupted by another stage's inline work draws as more than one card — UNLESS
 * the interruption is a short one that resumes immediately, in which case it's folded
 * into this card instead as absorbed foreign rows (`hasForeignRows` — see
 * `groupIntoRuns`, the P1 #5 checkpoint finding: Kadai's own scheduler output
 * interleaves a genuine Cook Base task between two Prep tasks, and splitting on every
 * such interleave produced repeating 1/2/1/2 badges on an ordinary recipe). Tint and
 * badge stay `index`; the running numeral never repeats within `derivePlan`'s output
 * because both come from the same stage.
 */
export interface RenderStage {
  stageId: string
  label: string
  /** Index in `graph.stages`. Stage tint is `index % 6` — see index.css. */
  index: number
  /** Unique per card — the run's first task's node id. Stable across re-renders,
   * since scheduled order is deterministic; used for React `key`s and for the Plan's
   * per-card expansion state (`PlanScreen`), so two runs of the same `stageId` expand
   * independently. */
  key: string
  /** True for every run of `stageId` after the first. A repeated card's own ingredients
   * are never shown — they already appeared on the first card (§R1) — but its tasks
   * keep their own durations. */
  repeated: boolean
  /** `!repeated` — this card is the one place `ingredients` is drawn for `stageId`. */
  firstOfStage: boolean
  /** True when this card absorbed one or more short foreign-stage tasks
   * (`groupIntoRuns`). The card's own whole-stage duration figure would then be an
   * undercount of what's visibly inside it, so it's omitted — see `StageCard`. */
  hasForeignRows: boolean
  /** True when one or more of this card's OWN stage's tasks were instead absorbed as
   * a foreign row into a *different* card. Symmetric to `hasForeignRows`: this card's
   * whole-stage duration figure would then overstate what's visibly inside it (it's
   * missing whatever moved elsewhere), so it's omitted too. */
  rowsAbsorbedElsewhere: boolean
  span: StageSpan
  /** Nodes in this run the cook does inline, in scheduled order — including any
   * absorbed foreign rows (`hasForeignRows`), each still carrying its own true
   * `homeStageIndex` for the foreign-row tint cue (`StageCard`). */
  inlineTasks: RenderTask[]
  /** Wait windows whose host node is in this run, in scheduled order. */
  windows: RenderWindow[]
  /** Graph ingredients consumed by a node whose *home* stage (`Node.stage`) is this
   * one — independent of where the scheduler physically placed the node (inline vs.
   * borrowed into another stage's window, or absorbed as a foreign row into another
   * stage's card). Graph order, not consumption order; a `consumes` id that names a
   * component rather than an ingredient is silently absent, since it never matches an
   * `Ingredient.id`. Empty on a repeated card (`!firstOfStage`) — see `repeated`. */
  ingredients: Ingredient[]
}

/** M3.2: a sitting boundary long enough to leave the kitchen, placed between two
 * rendered stages. Only ever produced between stages — see `deriveWaitRows`. */
export interface RenderWaitRow {
  /** Render this row immediately after `RenderPlan.stages[afterStageIndex]`; `-1`
   * means before the first rendered stage. */
  afterStageIndex: number
  waitMin: number
  /** `Session.preceded_by_host_node_ids`, resolved to labels, in that order. Empty
   * when the gap has no single host (zero, or more than one). */
  hostLabels: string[]
}

export interface RenderIngredientGroup {
  /** `null` when the recipe gave no grouping. */
  group: string | null
  items: Ingredient[]
}

export interface RenderPlan {
  recipeId: string
  title: string
  servings: number
  /** False when `servings` is a default — not stated, or discarded by the PC5
   * guard (a yield count the model mistook for a people count). `true` when the
   * field is absent (a plan saved before it existed — every such recipe was
   * hand-authored and genuinely stated; CLAUDE.md backward-compatibility). Read
   * this before `servings` for display — see `lib/servings.ts`. */
  servingsStated: boolean
  /** The source's own stated yield, e.g. "14 rasgulla". `null` when not stated or
   * not grounded by a number in the source text. */
  yieldText: string | null
  /** `{ servings, servingsStated, yieldText }` above, pre-shaped for `servingsLine`
   * (`lib/servings.ts`) — the one place a presentation component is allowed to
   * touch `.servings`/`.servings_stated`/`.yield_text` is inside that function
   * itself; everywhere else reads this object (or the loose fields above) and
   * calls `servingsLine`, never the raw graph. A grep-style Vitest enforces this. */
  servingsSource: ServingsSource
  cuisine: string | null
  totalMin: number
  serialMin: number
  savedMin: number
  warnings: string[]
  /** Whether any node in the graph is `unattended` or `periodic` (A7) — a categorical
   * lookup, not a computed value; drives the zero-windows footer's wording. */
  hasUnattendedWork: boolean
  stages: RenderStage[]
  ingredientGroups: RenderIngredientGroup[]
  /** Recipe-level timing (M3.1/M3.2). `null` for a plan saved before `summary`
   * existed — `headerTiming` falls back to the plain total for that case. */
  summary: PlanSummary | null
  /** Sitting-boundary rows to interleave between `stages`, in `stages` order. */
  waitRows: RenderWaitRow[]
}

function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}

function stageIndexOf(graph: CookingGraph): Map<string, number> {
  return new Map(graph.stages.map((stage, index) => [stage.id, index]))
}

function toTask(
  node: Node,
  homeStageIndex: number,
  provenance: GraphProvenance | null,
): RenderTask {
  return {
    nodeId: node.id,
    label: node.label,
    instruction: node.instruction,
    durationTypical: node.duration_typical,
    donenessCue: node.doneness_cue ?? null,
    attention: node.attention,
    durationProvenance: provenance?.nodes?.[node.id]?.fields?.duration ?? null,
    homeStageIndex,
    tip: node.tip ?? null,
  }
}

/** Graph ingredients a stage's own nodes (by `Node.stage`, not rendered placement)
 * consume, in `graph.ingredients` order (§ `RenderStage.ingredients`). */
function stageIngredients(graph: CookingGraph, stageId: string): Ingredient[] {
  const consumed = new Set(
    graph.nodes.filter((n) => n.stage === stageId).flatMap((n) => n.consumes ?? []),
  )
  return graph.ingredients.filter((ingredient) => consumed.has(ingredient.id))
}

/** How many consecutive tasks of a different stage may sit inside an otherwise
 * single-stage run before the interleave counts as a real phase change rather than a
 * short detour that resumes immediately (plan §D checkpoint finding). This is a tuned
 * safety bound, not a derived constant: every fixture measured at the checkpoint only
 * ever produced a 1-2 task detour before the interleaved stage gave up and moved on
 * for good, or resumed on the very next or second-next task — so 2 absorbs every real
 * case seen so far. It is deliberately not larger: the adversarial regression below
 * shows why a longer cap would let a card's own badge stop describing most of what's
 * actually inside it (three foreign tasks swallowed into a two-task "Prep" card reads
 * as "Prep" while being mostly Cook Base).
 */
const FOREIGN_ABSORPTION_CAP = 2

interface Run {
  stageId: string
  nodeIds: string[]
  /** Node ids in this run whose true home stage isn't `stageId` — a short interleave
   * absorbed in place rather than given its own card. */
  foreignNodeIds: Set<string>
}

/**
 * Groups an ordered, inline-only sequence of node ids into cards ("runs", plan §D),
 * applying the short-interleave rule (checkpoint decision, approved 2026-09-28): a card
 * opens on its first task's stage ("dominant") and keeps accumulating same-stage
 * tasks; when a different stage's task appears, its maximal run of foreign tasks is
 * folded into the current card — instead of closing it — only when that run is at
 * most `FOREIGN_ABSORPTION_CAP` tasks long AND the dominant stage resumes immediately
 * after it. Otherwise the card closes there and a new one opens at the first foreign
 * task. Never reorders `inlineOrder` — only decides where to draw card boundaries over
 * it — so flattening every returned run's `nodeIds` back to one sequence always
 * reproduces `inlineOrder` exactly.
 *
 * Exported for direct testing: the adversarial (`A,B,B,B,A,C`) and alternating
 * (`A,B,A,B,A`) regressions build a `stageOf` lookup by hand rather than a full
 * `RecipePlanResponse` fixture.
 */
export function groupIntoRuns(
  inlineOrder: readonly string[],
  stageOf: (nodeId: string) => string,
): Run[] {
  const runs: Run[] = []
  let i = 0
  while (i < inlineOrder.length) {
    const stageId = stageOf(inlineOrder[i])
    const nodeIds = [inlineOrder[i]]
    const foreignNodeIds = new Set<string>()
    i++

    while (i < inlineOrder.length) {
      if (stageOf(inlineOrder[i]) === stageId) {
        nodeIds.push(inlineOrder[i])
        i++
        continue
      }
      let j = i
      while (j < inlineOrder.length && stageOf(inlineOrder[j]) !== stageId) j++
      const resumes = j < inlineOrder.length // stageOf(inlineOrder[j]) === stageId, by the loop above
      const foreignLength = j - i
      if (resumes && foreignLength <= FOREIGN_ABSORPTION_CAP) {
        for (let k = i; k < j; k++) {
          nodeIds.push(inlineOrder[k])
          foreignNodeIds.add(inlineOrder[k])
        }
        i = j
      } else {
        break
      }
    }
    runs.push({ stageId, nodeIds, foreignNodeIds })
  }
  return runs
}

function groupIngredients(ingredients: readonly Ingredient[]): RenderIngredientGroup[] {
  const groups: RenderIngredientGroup[] = []
  // `null` is a valid Map key under SameValueZero, so ungrouped ingredients collect
  // under it directly. The previous sentinel was a literal NUL byte, which made git
  // treat this whole file as binary — no diffs, no blame, no grep.
  const seen = new Map<string | null, RenderIngredientGroup>()
  for (const item of ingredients) {
    const key = item.group ?? null
    let bucket = seen.get(key)
    if (!bucket) {
      bucket = { group: key, items: [] }
      seen.set(key, bucket)
      groups.push(bucket)
    }
    bucket.items.push(item)
  }
  return groups
}

export function derivePlan(
  payload: RecipePlanResponse,
  provenance: GraphProvenance | null = null,
): RenderPlan {
  const { graph, plan, stages } = payload

  const nodes = byId(graph.nodes)
  const stageIndex = stageIndexOf(graph)
  const scheduledByNode = new Map<string, ScheduledNode>(
    plan.scheduled.map((entry) => [entry.node_id, entry]),
  )
  const spanByStage = new Map(stages.map((span) => [span.stage_id, span]))

  const homeIndexOf = (nodeId: string): number =>
    stageIndex.get(nodes.get(nodeId)!.stage) ?? 0

  // Rendered windows, keyed by the node that hosts them — which run a window attaches
  // to is decided below by where its host lands, not by `Node.stage`. `window.assigned`
  // is already in the order the cook should work through — rank order — so it is not
  // re-sorted.
  const windowByHostNodeId = new Map<string, RenderWindow>()
  for (const window of plan.windows) {
    const host = nodes.get(window.host_node_id)!
    windowByHostNodeId.set(window.host_node_id, {
      id: window.id,
      hostNodeId: window.host_node_id,
      hostLabel: host.label,
      hostDurationTypical: host.duration_typical,
      hostAttention: host.attention,
      hostDonenessCue: host.doneness_cue ?? null,
      usedMin: window.used_min,
      slackMin: window.slack_min,
      capacityMin: window.capacity_min,
      tasks: window.assigned.map((nodeId) => {
        const node = nodes.get(nodeId)!
        return {
          ...toTask(node, homeIndexOf(nodeId), provenance),
          rankInWindow: scheduledByNode.get(nodeId)?.rank_in_window ?? 0,
        }
      }),
    })
  }

  // The Plan reads in cooking order (plan §D): walk `executionOrder`, keep only the
  // inline tasks (a window-assigned node is drawn under its host's window block, not
  // as its own row), and group them into cards via the short-interleave rule
  // (`groupIntoRuns`). On every golden fixture this produces exactly one card per
  // stage, in cooking order — a short real interleave (Kadai's `saute_onion` between
  // two Prep tasks) is absorbed as a foreign row rather than splitting the card.
  const inlineOrder = executionOrder(plan.scheduled).filter(
    (nodeId) => scheduledByNode.get(nodeId)?.window_id == null,
  )
  const runs = groupIntoRuns(inlineOrder, (nodeId) => nodes.get(nodeId)!.stage)

  // A node absorbed as a foreign row in one run's card is, by construction, not a
  // dominant member of any run — so this only ever flags a *different* run: the one
  // whose own `stageId` equals that node's true home stage (`rowsAbsorbedElsewhere`).
  const stagesWithNodesAbsorbedElsewhere = new Set(
    runs.flatMap((run) => [...run.foreignNodeIds].map((nodeId) => nodes.get(nodeId)!.stage)),
  )

  const stageById = byId(graph.stages)
  const seenStageIds = new Set<string>()
  const renderStages: RenderStage[] = runs.map((run) => {
    const stage = stageById.get(run.stageId)!
    const index = stageIndex.get(run.stageId) ?? 0
    const firstOfStage = !seenStageIds.has(run.stageId)
    seenStageIds.add(run.stageId)

    return {
      stageId: run.stageId,
      label: stage.label,
      index,
      key: run.nodeIds[0],
      repeated: !firstOfStage,
      firstOfStage,
      hasForeignRows: run.foreignNodeIds.size > 0,
      rowsAbsorbedElsewhere: stagesWithNodesAbsorbedElsewhere.has(run.stageId),
      // A run's stage always has at least this run's own nodes, so it always has a
      // span — unlike the graph-stage sweep this replaced, which had to guard against
      // a stage with no nodes at all.
      span: spanByStage.get(run.stageId)!,
      inlineTasks: run.nodeIds.map((nodeId) =>
        toTask(nodes.get(nodeId)!, homeIndexOf(nodeId), provenance),
      ),
      windows: run.nodeIds
        .map((nodeId) => windowByHostNodeId.get(nodeId))
        .filter((w): w is RenderWindow => w != null),
      ingredients: firstOfStage ? stageIngredients(graph, run.stageId) : [],
    }
  })

  const waitRows = deriveWaitRows(renderStages, nodes, payload.summary ?? null)

  return {
    recipeId: graph.id,
    title: graph.title,
    servings: graph.servings,
    servingsStated: graph.servings_stated ?? true,
    yieldText: graph.yield_text ?? null,
    servingsSource: {
      servings: graph.servings,
      servings_stated: graph.servings_stated ?? true,
      yield_text: graph.yield_text ?? null,
    },
    cuisine: graph.cuisine ?? null,
    totalMin: plan.total_min,
    serialMin: plan.serial_min,
    savedMin: plan.saved_min,
    warnings: plan.warnings ?? [],
    hasUnattendedWork: graph.nodes.some(
      (node) => node.attention === 'unattended' || node.attention === 'periodic',
    ),
    stages: renderStages,
    ingredientGroups: groupIngredients(graph.ingredients),
    summary: payload.summary ?? null,
    waitRows,
  }
}

/**
 * Sitting-boundary wait rows (M3.2), placed between two *rendered* stages.
 *
 * A boundary before `sessions[k]` (its `preceded_by_wait_min` is set) gets a row only
 * when every rendered stage falls entirely before or entirely at-or-after session `k` —
 * using each stage's *rendered* membership (`inlineTasks` plus `windows`' borrowed
 * tasks), not `Node.stage`, since a windowed task is drawn under its host stage. A
 * stage whose rendered nodes span the boundary (pizza's `cook` stage runs through
 * every sitting) makes the boundary ambiguous; the whole row is dropped rather than
 * guessed at.
 */
function deriveWaitRows(
  stages: readonly RenderStage[],
  nodes: Map<string, Node>,
  summary: PlanSummary | null,
): RenderWaitRow[] {
  if (!summary || summary.sessions.length < 2) return []

  const sessionOf = new Map<string, number>()
  summary.sessions.forEach((session, index) => {
    for (const nodeId of session.node_ids) sessionOf.set(nodeId, index)
  })

  const renderedIdsOf = (stage: RenderStage): string[] => [
    ...stage.inlineTasks.map((t) => t.nodeId),
    ...stage.windows.flatMap((w) => w.tasks.map((t) => t.nodeId)),
  ]
  const stageSessions = stages.map((stage) =>
    renderedIdsOf(stage)
      .map((id) => sessionOf.get(id))
      .filter((s): s is number => s != null),
  )

  const rows: RenderWaitRow[] = []
  for (let k = 1; k < summary.sessions.length; k++) {
    const session = summary.sessions[k]
    if (session.preceded_by_wait_min == null) continue

    type Side = 'before' | 'after' | 'straddle' | 'unknown'
    const sideOf = (sessions: number[]): Side => {
      if (sessions.length === 0) return 'unknown'
      const before = sessions.some((s) => s < k)
      const after = sessions.some((s) => s >= k)
      if (before && after) return 'straddle'
      return before ? 'before' : 'after'
    }
    const sides = stageSessions.map(sideOf)
    if (sides.some((side) => side === 'straddle' || side === 'unknown')) continue

    // A clean boundary is every 'before' stage followed by every 'after' stage, with
    // no interleaving — anything else is exactly as ambiguous as a straddling stage.
    let splitIndex = -1
    let seenAfter = false
    let ambiguous = false
    sides.forEach((side, i) => {
      if (side === 'after') {
        if (!seenAfter) splitIndex = i - 1
        seenAfter = true
      } else if (seenAfter) {
        ambiguous = true
      }
    })
    if (ambiguous || !seenAfter) continue

    rows.push({
      afterStageIndex: splitIndex,
      waitMin: session.preceded_by_wait_min,
      hostLabels: session.preceded_by_host_node_ids.map((id) => nodes.get(id)?.label ?? id),
    })
  }
  return rows
}
