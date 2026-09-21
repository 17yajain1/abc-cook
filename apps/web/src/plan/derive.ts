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
  /** Position in `graph.stages` of the stage this task actually belongs to. Drives its tint. */
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

/** A stage as the Plan view lists it: its own inline work, plus any windows it hosts. */
export interface RenderStage {
  stageId: string
  label: string
  /** Index in `graph.stages`. Stage tint is `index % 6` — see index.css. */
  index: number
  span: StageSpan
  /** Nodes in this stage the cook does inline, in scheduled order. */
  inlineTasks: RenderTask[]
  /** Wait windows whose host node lives in this stage, earliest first. */
  windows: RenderWindow[]
  /** Graph ingredients consumed by a node whose *home* stage (`Node.stage`) is this
   * one — independent of where the scheduler physically placed the node (inline vs.
   * borrowed into another stage's window). Graph order, not consumption order; a
   * `consumes` id that names a component rather than an ingredient is silently
   * absent, since it never matches an `Ingredient.id`. */
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

  // Windows, keyed by the stage that hosts them. `window.assigned` is already in the
  // order the cook should work through — rank order — so it is not re-sorted.
  const windowsByHostStage = new Map<string, RenderWindow[]>()
  for (const window of plan.windows) {
    const host = nodes.get(window.host_node_id)!
    const rendered: RenderWindow = {
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
    }
    const bucket = windowsByHostStage.get(host.stage) ?? []
    bucket.push(rendered)
    windowsByHostStage.set(host.stage, bucket)
  }

  const scheduledInStageOrder = [...plan.scheduled].sort(
    (a, b) => a.start_min - b.start_min || a.node_id.localeCompare(b.node_id),
  )

  const renderStages: RenderStage[] = []
  graph.stages.forEach((stage, index) => {
    const span = spanByStage.get(stage.id)
    if (!span) return // stage has no nodes — nothing to draw

    const inlineTasks = scheduledInStageOrder
      .filter((entry) => {
        const node = nodes.get(entry.node_id)!
        return node.stage === stage.id && entry.window_id == null
      })
      .map((entry) => toTask(nodes.get(entry.node_id)!, index, provenance))

    const windows = (windowsByHostStage.get(stage.id) ?? []).sort((a, b) => {
      const aStart = scheduledByNode.get(a.hostNodeId)?.start_min ?? 0
      const bStart = scheduledByNode.get(b.hostNodeId)?.start_min ?? 0
      return aStart - bStart || a.id.localeCompare(b.id)
    })

    // A stage whose every task got slotted into another stage's wait window has no
    // presence of its own on the timeline — its tasks are already shown, tinted with
    // this stage's colour, inside those windows. Drop it rather than draw a "~0 min"
    // card with nothing in it. Same principle as the scheduler dropping empty windows.
    if (inlineTasks.length === 0 && windows.length === 0) return

    renderStages.push({
      stageId: stage.id,
      label: stage.label,
      index,
      span,
      inlineTasks,
      windows,
      ingredients: stageIngredients(graph, stage.id),
    })
  })

  const waitRows = deriveWaitRows(renderStages, nodes, payload.summary ?? null)

  return {
    recipeId: graph.id,
    title: graph.title,
    servings: graph.servings,
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
