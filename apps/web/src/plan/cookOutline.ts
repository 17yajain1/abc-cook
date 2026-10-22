import type { Node, PlanSummary, ScheduledNode, WaitWindow } from '@abc-cook/schema'

import { attentionLine } from '@/lib/attention'
import { approxWaitPhrase, formatMinutes, formatRange } from '@/lib/duration'

/**
 * R2: the "How this cook goes" outline — stretch → wait → stretch … — built from
 * `PlanSummary.phases` (docs/plans/r2-recipe-header.md).
 *
 * Pure, no JSX. Every figure is read from the plan (`phases`, `elapsed_*`, `saved_min`)
 * and only formatted; nothing here adds, subtracts or compares cooking durations. The one
 * thing that reads a timestamp is the stretch *title* (decision 9) and the task-line
 * *order* (decision 8): both pick and order node labels by `scheduled[].start_min`, never
 * produce a figure. "Phase" and "session" are internal words and never appear in a string.
 *
 * Decision 8 note (docs/plans/fix-outline-meanwhile-prereqs.md): Meanwhile never lists a
 * prerequisite of a title node that is itself a window task. Such prerequisites are folded
 * into the title ahead of their consumer. This reads only `depends_on`; a title node that is
 * not a window task (the recipe's sink) is the main line and keeps its inputs under Meanwhile.
 */

export interface OutlineStretch {
  /** `Now` for the first stretch, `Then` for the rest. */
  tag: 'Now' | 'Then'
  /** `first label → last label`, or the single label. */
  title: string
  /** `35–50 min`, `~10 min`. `null` for a zero-length stretch (O2: never "~0 min"). */
  time: string | null
  /** Proportional share of the broken-axis bar: the stretch's own elapsed minutes. */
  barWeight: number
  /** `Meanwhile: A, B +1 more`, one per window with tasks in this stretch. */
  taskLines: string[]
}

export interface OutlineWait {
  /** The row under the preceding stretch: `Hands free for ~1 hr 45 min`. */
  text: string
  /** The label beneath the hatched gap in the bar: `~1 hr 45 min`. */
  barLabel: string
}

export interface PlanAheadCard {
  /** The upper end of the whole cook, in minutes (`summary.elapsed_high_min`): the card's bold line is
   * "Start now and it's ready around {now + this}", built at render with the clock (`readyAroundText`). */
  readyInMin: number
  /** The grey line: how many long breaks there are and how long the longest is. */
  detail: string
}

export interface CookOutline {
  stretches: OutlineStretch[]
  /** `waits[i]` sits between `stretches[i]` and `stretches[i + 1]`. */
  waits: OutlineWait[]
  /** `Saves 13 min`, or `null` when nothing was saved. */
  savedPill: string | null
  /** The plan-ahead card; `null` for a one-stretch recipe (decision 3). */
  card: PlanAheadCard | null
  /** The line under Start cooking (decision 12). */
  ctaSubline: string
}

export interface OutlineInput {
  summary: PlanSummary | null | undefined
  nodes: readonly Pick<Node, 'id' | 'label' | 'attention' | 'depends_on'>[]
  scheduled: readonly Pick<ScheduledNode, 'node_id' | 'start_min'>[]
  windows: readonly Pick<WaitWindow, 'host_node_id' | 'assigned'>[]
  savedMin: number
}

const MAX_LISTED_TASKS = 2

/** `formatRange`'s `about N min` collapse reads as `~N min` in the outline. */
function stretchTime(low: number, high: number): string {
  return formatRange(low, high).replace(/^about /, '~')
}

export function deriveCookOutline(input: OutlineInput): CookOutline | null {
  const { summary } = input
  const phases = summary?.phases
  if (!summary || !phases || phases.length === 0) return null

  const nodeById = new Map(input.nodes.map((n) => [n.id, n]))
  const startOf = new Map(input.scheduled.map((s) => [s.node_id, s.start_min]))
  const windowTaskIds = new Set(input.windows.flatMap((w) => w.assigned))

  // Transitive `depends_on` ancestors, memoised. Graphs are DAGs; `visiting` guards a bad cycle.
  const ancestorCache = new Map<string, Set<string>>()
  const visiting = new Set<string>()
  const ancestorsOf = (id: string): Set<string> => {
    const cached = ancestorCache.get(id)
    if (cached) return cached
    const result = new Set<string>()
    if (visiting.has(id)) return result
    visiting.add(id)
    for (const dep of nodeById.get(id)?.depends_on ?? []) {
      result.add(dep)
      for (const up of ancestorsOf(dep)) result.add(up)
    }
    visiting.delete(id)
    ancestorCache.set(id, result)
    return result
  }

  // Waits first: a later phase without a stated gap can't be described honestly.
  const waits: OutlineWait[] = []
  for (const phase of phases.slice(1)) {
    if (phase.preceded_by_wait_min == null) return null
    const approx = `~${approxWaitPhrase(phase.preceded_by_wait_min)}`
    const hostAttentions = phase.preceded_by_host_node_ids.map((id) => nodeById.get(id)?.attention)
    let text: string
    if (phase.starts_new_session) text = `Come back ${approx} later`
    else if (hostAttentions.includes('unattended')) text = `Hands free for ${approx}`
    else if (hostAttentions.includes('periodic')) text = `Check now and then for ${approx}`
    else text = `Wait ${approx}`
    waits.push({ text, barLabel: approx })
  }

  const stretches: OutlineStretch[] = phases.map((phase, index) => {
    // Title (decision 9): nodes whose scheduled start lies inside the phase's attended
    // footprint; if none qualify, every node of the phase.
    const inside = phase.node_ids.filter((id) => {
      const start = startOf.get(id)
      return start != null && start >= phase.start_min && start <= phase.end_min
    })
    const titleIds = inside.length > 0 ? inside : phase.node_ids
    const first = titleIds[0]
    const last = titleIds[titleIds.length - 1]
    const labelOf = (id: string) => nodeById.get(id)?.label ?? id
    const members = new Set(phase.node_ids)

    // A window task in the title is fitted into the same wait as the Meanwhile tasks, so a
    // prerequisite of it listed "meanwhile" would read as parallel. Fold those into the title.
    const promotable = (of: string): string[] =>
      windowTaskIds.has(of)
        ? [...ancestorsOf(of)].filter(
            (id) => id !== first && id !== last && members.has(id) && windowTaskIds.has(id),
          )
        : []
    const byStart = (a: string, b: string) =>
      (startOf.get(a) ?? 0) - (startOf.get(b) ?? 0) ||
      phase.node_ids.indexOf(a) - phase.node_ids.indexOf(b)
    const before = promotable(first).sort(byStart)
    const mid = promotable(last)
      .filter((id) => !before.includes(id))
      .sort(byStart)
    const folded =
      first === last ? [...before, ...mid, first] : [...before, first, ...mid, last]
    const title = folded.map(labelOf).join(' → ')
    const inTitle = new Set(folded)

    // Task lines (decision 8): window tasks that belong to this stretch, in start order.
    const taskLines: string[] = []
    for (const window of input.windows) {
      const labels = window.assigned
        .map((id, order) => ({ id, order }))
        .filter(({ id }) => members.has(id) && !inTitle.has(id))
        .sort(
          (a, b) =>
            (startOf.get(a.id) ?? 0) - (startOf.get(b.id) ?? 0) || a.order - b.order,
        )
        .map(({ id }) => labelOf(id))
      if (labels.length === 0) continue
      const listed = labels.slice(0, MAX_LISTED_TASKS).join(', ')
      const more = labels.length > MAX_LISTED_TASKS ? ` +${labels.length - MAX_LISTED_TASKS} more` : ''
      const hostAttention = nodeById.get(window.host_node_id)?.attention
      const lead =
        hostAttention === 'periodic' ? `While ${attentionLine('periodic')}:` : 'Meanwhile:'
      taskLines.push(`${lead} ${listed}${more}`)
    }

    // A one-stretch recipe uses the plan's own elapsed range (decision 10).
    const single = phases.length === 1
    const low = single ? summary.elapsed_min : phase.elapsed_min
    const high = single ? summary.elapsed_high_min : phase.elapsed_high_min
    return {
      tag: index === 0 ? 'Now' : 'Then',
      title,
      // A zero-length stretch (an instant, e.g. "take the dough out") has no duration to state.
      time: low === 0 && high === 0 ? null : stretchTime(low, Math.max(high, low)),
      barWeight: low,
      taskLines,
    }
  })

  const first = stretches[0]
  // No step names here: they live in Steps. The first stretch's own range, "20–30 min" or "~3 min".
  const firstStretch = first.time ? `First stretch: about ${first.time.replace(/^~/, '')}.` : null

  let card: PlanAheadCard | null = null
  let ctaSubline = 'Start to finish in one go.'
  if (phases.length > 1) {
    // O1 (approved): the count of sittings is `summary.sessions.length`, a read. Phases
    // outnumber sittings once a stretch begins mid-gap, so the "spans N sittings" form is
    // only honest when there really is more than one sitting.
    // N breaks (a count) and the longest one (a selection among plan values, not arithmetic).
    let longest = 1
    phases.forEach((p, i) => {
      if (i > 0 && (p.preceded_by_wait_min ?? 0) > (phases[longest].preceded_by_wait_min ?? 0)) longest = i
    })
    const longestPhrase = `about ${approxWaitPhrase(phases[longest].preceded_by_wait_min ?? 0)}`
    card = {
      readyInMin: summary.elapsed_high_min,
      detail:
        waits.length === 1
          ? `You're free for most of it: one long break, ${longestPhrase}.`
          : `You're free for most of it: ${waits.length} long breaks, the longest ${longestPhrase}.`,
    }
    if (firstStretch) ctaSubline = firstStretch
  }

  return {
    stretches,
    waits,
    savedPill: input.savedMin > 0 ? `Saves ${formatMinutes(input.savedMin)}` : null,
    card,
    ctaSubline,
  }
}
