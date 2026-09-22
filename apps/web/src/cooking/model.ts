import type { RecipePlanResponse } from '@abc-cook/schema'

import type { CookingModel, CookingNodeInfo } from './types'

/**
 * Joins a scheduled plan to its graph into the lookups the session engine and
 * selectors need. The only place a `CookingSession`'s cooking-mode reads happen against
 * plan/graph data (plan §D `CookingModel`) — mirrors `plan/derive.ts`'s own discipline:
 * lookups, comparisons and one stable sort, no minute arithmetic. If you find yourself
 * summing two durations here, it belongs in `abc_cook/schedule/` instead (CLAUDE.md).
 *
 * `plan.scheduled` itself is never mutated or re-sorted in place — `order` is a
 * derivation held on the model, not written back (plan §K1).
 */
export function deriveCookingModel(payload: RecipePlanResponse): CookingModel {
  const { graph, plan } = payload

  const stageLabelOf = new Map(graph.stages.map((stage) => [stage.id, stage.label]))
  const scheduledByNode = new Map(plan.scheduled.map((entry) => [entry.node_id, entry]))

  const consumersOf = new Map<string, string[]>()
  for (const node of graph.nodes) {
    for (const dep of node.depends_on ?? []) {
      const list = consumersOf.get(dep)
      if (list) list.push(node.id)
      else consumersOf.set(dep, [node.id])
    }
  }

  const nodes: Record<string, CookingNodeInfo> = {}
  for (const node of graph.nodes) {
    const scheduled = scheduledByNode.get(node.id)
    if (!scheduled) continue // every graph node is scheduled by construction (§5 invariant)

    nodes[node.id] = {
      id: node.id,
      label: node.label,
      instruction: node.instruction,
      tip: node.tip ?? null,
      attention: node.attention,
      kind: node.kind,
      occupiesCook: scheduled.occupies_cook,
      interruptible: node.interruptible,
      dependsOn: node.depends_on ?? [],
      consumers: consumersOf.get(node.id) ?? [],
      consumes: node.consumes ?? [],
      isSink: node.kind === 'finish',
      durationMin: node.duration_min,
      durationTypical: node.duration_typical,
      durationMax: node.duration_max,
      donenessCue: node.doneness_cue ?? null,
      stageId: node.stage,
      stageLabel: stageLabelOf.get(node.stage) ?? node.stage,
      windowId: scheduled.window_id ?? null,
      rankInWindow: scheduled.rank_in_window ?? null,
      startMin: scheduled.start_min,
      endMin: scheduled.end_min,
    }
  }

  // Execution order (§C1/§F1/§K1): `plan.scheduled` re-keyed by
  // `(start_min, occupies_cook ? 1 : 0, node_id)`. This restores the scheduler's own
  // tick order — it places every ready hands-off node before starting one hands-on node
  // at the same minute (`scheduler.py` steps (b) then (c)) — which the final
  // `sort(key=(start_min, node_id))` serialisation discards. `plan.scheduled` itself is
  // untouched; this is a derived reading of it.
  const order = [...plan.scheduled]
    .sort((a, b) => {
      if (a.start_min !== b.start_min) return a.start_min - b.start_min
      const aRank = a.occupies_cook ? 1 : 0
      const bRank = b.occupies_cook ? 1 : 0
      if (aRank !== bRank) return aRank - bRank
      return a.node_id.localeCompare(b.node_id)
    })
    .map((entry) => entry.node_id)

  const sinkId = Object.values(nodes).find((n) => n.isSink)?.id
  if (sinkId == null) {
    throw new Error(`CookingGraph ${graph.id} has no kind: 'finish' node (§5 invariant)`)
  }

  const sessions = payload.summary?.sessions ?? []
  const sittingOf: Record<string, number> = {}
  sessions.forEach((session, index) => {
    for (const nodeId of session.node_ids) sittingOf[nodeId] = index
  })

  return {
    graphId: graph.id,
    order,
    nodes,
    sinkId,
    windows: plan.windows,
    sessions,
    sittingOf,
    warnings: plan.warnings ?? [],
    savedMin: plan.saved_min,
    totalMin: plan.total_min,
  }
}
