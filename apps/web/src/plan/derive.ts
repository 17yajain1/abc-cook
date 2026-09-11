import type {
  CookingGraph,
  Ingredient,
  Node,
  RecipePlanResponse,
  ScheduledNode,
  StageSpan,
} from '@abc-cook/schema'

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
  /** Position in `graph.stages` of the stage this task actually belongs to. Drives its tint. */
  homeStageIndex: number
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
  stages: RenderStage[]
  ingredientGroups: RenderIngredientGroup[]
}

function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}

function stageIndexOf(graph: CookingGraph): Map<string, number> {
  return new Map(graph.stages.map((stage, index) => [stage.id, index]))
}

function toTask(node: Node, homeStageIndex: number): RenderTask {
  return {
    nodeId: node.id,
    label: node.label,
    instruction: node.instruction,
    durationTypical: node.duration_typical,
    donenessCue: node.doneness_cue ?? null,
    attention: node.attention,
    homeStageIndex,
  }
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

export function derivePlan(payload: RecipePlanResponse): RenderPlan {
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
          ...toTask(node, homeIndexOf(nodeId)),
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
      .map((entry) => toTask(nodes.get(entry.node_id)!, index))

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
    })
  })

  return {
    recipeId: graph.id,
    title: graph.title,
    servings: graph.servings,
    cuisine: graph.cuisine ?? null,
    totalMin: plan.total_min,
    serialMin: plan.serial_min,
    savedMin: plan.saved_min,
    warnings: plan.warnings ?? [],
    stages: renderStages,
    ingredientGroups: groupIngredients(graph.ingredients),
  }
}
