import type { CookingGraph, ScheduledNode, WaitWindow } from '@abc-cook/schema'

import { attentionLine } from '@/lib/attention'

/**
 * D5, "How this cook goes": the geometry of the two-lane picture, and the words that go with it.
 *
 * Geometry only. Every minute comes from the scheduler's `scheduled[].start_min/end_min` and its
 * `windows`; this module turns them into 0..1 positions along the plan's `total_min` so a renderer can
 * draw them, and decides nothing about what can happen in parallel. That is the scheduler's call, and it is
 * already made: a window exists only where it put work.
 */

export interface LaneBar {
  /** The node id (a step), or the window id (a meanwhile block). */
  id: string
  /** 0..1 along `plan.total_min`. */
  from: number
  to: number
  kind: 'step' | 'meanwhile' | 'host'
  /** A host bar's step name; a step bar's too (for a tooltip). */
  label: string
  /** Position of the step's stage in `graph.stages`: the bar's tint. For a meanwhile block, its first task's. */
  stageIndex: number
}

export interface CookLanes {
  /** The top lane, "You": the steps that keep the cook busy, and one outlined block per window for the
   * meanwhile tasks, in time order. */
  you: LaneBar[]
  /** The second lane: the host steps of the windows. Rows only when two hosts overlap in time. */
  hosts: LaneBar[][]
}

interface LaneInput {
  graph: Pick<CookingGraph, 'nodes' | 'stages'>
  scheduled: readonly ScheduledNode[]
  windows: readonly WaitWindow[]
  totalMin: number
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n))

/**
 * The two lanes, or `null` when the scheduler placed no work in any window (nothing to say: step names are
 * then shown once, in the steps). Pure: same plan in, same lanes out.
 */
export function deriveCookLanes({ graph, scheduled, windows, totalMin }: LaneInput): CookLanes | null {
  const used = windows.filter((w) => w.assigned.length > 0)
  if (used.length === 0 || !(totalMin > 0)) return null

  const nodes = new Map(graph.nodes.map((n) => [n.id, n]))
  const stageIndex = new Map(graph.stages.map((s, i) => [s.id, i]))
  const stageOf = (nodeId: string): number => stageIndex.get(nodes.get(nodeId)?.stage ?? '') ?? 0
  const byNode = new Map(scheduled.map((s) => [s.node_id, s]))
  const at = (min: number): number => clamp01(min / totalMin)

  const you: LaneBar[] = []
  // Steps the cook is busy with, outside any window. A window's tasks are drawn as one block instead.
  for (const s of scheduled) {
    if (!s.occupies_cook || s.window_id != null) continue
    you.push({
      id: s.node_id,
      from: at(s.start_min),
      to: at(s.end_min),
      kind: 'step',
      label: nodes.get(s.node_id)?.label ?? s.node_id,
      stageIndex: stageOf(s.node_id),
    })
  }

  const hostBars: LaneBar[] = []
  for (const w of used) {
    const tasks = w.assigned.flatMap((id) => (byNode.has(id) ? [byNode.get(id)!] : []))
    if (tasks.length > 0) {
      you.push({
        id: w.id,
        from: at(Math.min(...tasks.map((t) => t.start_min))),
        to: at(Math.max(...tasks.map((t) => t.end_min))),
        kind: 'meanwhile',
        label: tasks.map((t) => nodes.get(t.node_id)?.label ?? t.node_id).join(', '),
        stageIndex: stageOf(tasks[0].node_id),
      })
    }
    const host = byNode.get(w.host_node_id)
    if (host) {
      hostBars.push({
        id: w.host_node_id,
        from: at(host.start_min),
        to: at(host.end_min),
        kind: 'host',
        label: nodes.get(w.host_node_id)?.label ?? w.host_node_id,
        stageIndex: stageOf(w.host_node_id),
      })
    }
  }

  you.sort((a, b) => a.from - b.from || a.to - b.to)
  hostBars.sort((a, b) => a.from - b.from || a.to - b.to)
  // Hosts that overlap in time go on their own row, so no bar is drawn over another.
  const hosts: LaneBar[][] = []
  for (const bar of hostBars) {
    const row = hosts.find((r) => r[r.length - 1].to <= bar.from)
    if (row) row.push(bar)
    else hosts.push([bar])
  }
  return { you, hosts }
}

/** "A", "A and B", "A, B and C". */
export function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join('')
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

/**
 * The short line after the sentence, from the host's `attention` alone: "Your hands are free." for an
 * unattended host, "Checking the pan now and then." for a periodic one, nothing for a hands-on one. The
 * graph can't say whether anything is on a heat, so nothing here names a stove.
 */
export function hostAttentionSentence(attention: 'hands_on' | 'periodic' | 'unattended'): string | null {
  if (attention === 'hands_on') return null
  const line = attentionLine(attention)
  return `${line.charAt(0).toUpperCase()}${line.slice(1)}.`
}
