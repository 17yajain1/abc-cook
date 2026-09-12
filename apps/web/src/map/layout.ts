import type { CookingGraph, Node, RecipePlanResponse, ScheduledNode, WaitWindow } from '@abc-cook/schema'

import { formatMinutes } from '@/lib/duration'

/**
 * `CookingPlan -> LayoutSpec`, the pure function `GRAPH_VIEW.md` §7 asks for.
 *
 * Geometry only. Every minute figure (`start_min`, `end_min`, `duration_typical`) is
 * copied verbatim from the plan and the graph — this file only turns those figures
 * into pixel positions. Classification (mainline / window-child / independent-overlap)
 * is pure interval math over `start_min`/`end_min`/window membership — never a flag
 * authored per task, recipe, or fixture (CLAUDE.md, `M2.75 Map design handoff.md`).
 *
 * `plan.critical_path` is not read anywhere in this file. It is not a Map concept.
 *
 * Mark set: `docs/DESIGN_SYSTEM.md` § *The Map grammar*. Visual spec:
 * `M2.75 Map design handoff.md`. Four handoff conflicts and their resolutions
 * (hosts-seeded-first, two-columns-plus-fold, mainline-only dependency arrows, no
 * axis) are recorded in `docs/DESIGN_SYSTEM.md` § *Resolved in M2.75*.
 */

const WIDTH = 390
const MAIN_X = 20
const MAIN_W = 190
const RIGHT_X = 222
const RIGHT_W = 108
const SPINE_X = 216
const CARD_INSET = 6 // 12px between time-adjacent cards
const CHAR_W = 6.6
const LINE_H = 16
const H_MIN = 44
const H_MAX = 120
const NOTE_MIN_H = 60
const FOLD_LABEL_H = 18
const TOP_PADDING = 16
const BOTTOM_PADDING = 16

export type MapRole = 'mainline' | 'window-child' | 'independent'

export interface MapLayout {
  width: typeof WIDTH
  height: number
  cards: MapCard[]
  edges: MapEdge[]
  brackets: MapBracket[]
  folds: MapFold[]
  legend: { stages: { label: string; stageIndex: number }[]; hasParallel: boolean }
  /** `<desc>` text for the SVG, built from plan facts only. */
  description: string
}

export interface MapCard {
  nodeId: string
  label: string
  /** Word-wrapped, uncapped — a card grows to fit its label, it never clips one. */
  labelLines: string[]
  durationLabel: string
  /** `(low attention)` / `(hands off)` / `null`. Mainline-only, and only from 60px up. */
  note: string | null
  x: number
  y: number
  w: number
  h: number
  stageIndex: number
  role: MapRole
}

/** One `depends_on` pair where both ends are mainline cards. */
export interface MapEdge {
  from: string
  to: string
  d: string
}

/** One window's bracket: a stem off the host, a spine, and one tick per shown member. */
export interface MapBracket {
  windowId: string
  hostId: string
  stemD: string
  spineD: string
  ticks: { to: string; d: string }[]
}

/** A quiet `+N more` label absorbing right-column cards beyond a window's first 3
 * members, or beyond whatever the right column can show without a time collision. */
export interface MapFold {
  anchorNodeId: string
  nodeIds: string[]
  text: string
  x: number
  y: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Attention note text — a categorical lookup, never a computed or authored string. */
function attentionNote(attention: Node['attention']): string | null {
  if (attention === 'periodic') return '(low attention)'
  if (attention === 'unattended') return '(hands off)'
  return null
}

interface Interval {
  start: number
  end: number
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end
}

interface Classification {
  roleOf: Map<string, MapRole>
}

/**
 * Pure interval-math classification (`M2.75 Map design handoff.md` § Classification,
 * Decision 1 in `docs/DESIGN_SYSTEM.md` § Resolved in M2.75).
 *
 * A window's host is seeded onto the mainline first — before the general walk — so a
 * host never loses its mainline slot (and therefore its bracket) to an earlier-ticking
 * non-window task it happens to tie with at the same minute. Everything else is then
 * walked in `start_min` order against the reserved mainline intervals: a candidate that
 * overlaps none of them is mainline; one that overlaps any of them is an independent
 * concurrent card. Window members are decided first and never enter this walk at all.
 */
function classify(scheduled: readonly ScheduledNode[], windows: readonly WaitWindow[]): Classification {
  const byId = new Map(scheduled.map((s) => [s.node_id, s]))
  const memberIds = new Set(windows.flatMap((w) => w.assigned))
  const hostIds = new Set(windows.map((w) => w.host_node_id))

  const roleOf = new Map<string, MapRole>()
  for (const id of memberIds) roleOf.set(id, 'window-child')

  const reserved: Interval[] = []
  const sortedHosts = [...hostIds].sort(
    (a, b) => byId.get(a)!.start_min - byId.get(b)!.start_min || a.localeCompare(b),
  )
  for (const id of sortedHosts) {
    const s = byId.get(id)!
    const interval = { start: s.start_min, end: s.end_min }
    if (reserved.some((r) => overlaps(r, interval))) {
      // Two window hosts overlapping in time — no fixture exercises this. The
      // later-starting host (by this sort) is demoted; its own window still renders
      // its members as window children, it just draws no bracket (see `layoutMap`).
      roleOf.set(id, 'independent')
    } else {
      roleOf.set(id, 'mainline')
      reserved.push(interval)
    }
  }

  // Tie-break on a shared start_min is `end_min` ASCENDING: the shorter task keeps the
  // mainline spine moving and the longer one reads as the side task. Verified against
  // homemade-donuts, whose heat_oil (88->100) and proof_donuts (88->113) tie exactly —
  // heat_oil must stay mainline and proof_donuts must read as independent even though
  // proof_donuts sits on the scheduler's critical_path, which this file never reads.
  const rest = scheduled
    .filter((s) => !memberIds.has(s.node_id) && !hostIds.has(s.node_id))
    .sort(
      (a, b) =>
        a.start_min - b.start_min || a.end_min - b.end_min || a.node_id.localeCompare(b.node_id),
    )
  for (const s of rest) {
    const interval = { start: s.start_min, end: s.end_min }
    if (reserved.some((r) => overlaps(r, interval))) {
      roleOf.set(s.node_id, 'independent')
    } else {
      roleOf.set(s.node_id, 'mainline')
      reserved.push(interval)
    }
  }

  return { roleOf }
}

interface RightColumn {
  shown: Set<string>
  /** nodeId of a folded card -> nodeIds folded under it, already resolved past the
   * "a member's anchor is its own window's last shown member" redirect. */
  foldGroups: Map<string, string[]>
}

/**
 * Right-column occupancy and the generic fold rule (Decision 2, `DESIGN_SYSTEM.md` §
 * Resolved in M2.75). One column, so a window's 4th+ member folds (`assigned.length >
 * 3`) and so does any card — member or independent — whose interval collides with
 * whatever the column is already showing. A folded card's label lands under its own
 * window's last shown member when it (or whatever it collided with) belongs to one;
 * a folded independent that collided with another independent keeps that independent
 * as its anchor.
 */
function computeRightColumn(
  scheduled: readonly ScheduledNode[],
  windows: readonly WaitWindow[],
  roleOf: Map<string, MapRole>,
): RightColumn {
  const windowOf = new Map<string, string>()
  const rankOf = new Map<string, number>()
  for (const w of windows) {
    w.assigned.forEach((id, i) => {
      windowOf.set(id, w.id)
      rankOf.set(id, i)
    })
  }

  const candidates = scheduled.filter((s) => {
    const role = roleOf.get(s.node_id)
    return role === 'window-child' || role === 'independent'
  })
  const sorted = [...candidates].sort((a, b) => {
    if (a.start_min !== b.start_min) return a.start_min - b.start_min
    const aMember = windowOf.has(a.node_id)
    const bMember = windowOf.has(b.node_id)
    if (aMember !== bMember) return aMember ? -1 : 1
    const rankDiff = (rankOf.get(a.node_id) ?? 0) - (rankOf.get(b.node_id) ?? 0)
    if (rankDiff !== 0) return rankDiff
    return a.node_id.localeCompare(b.node_id)
  })

  const shown = new Set<string>()
  const rawAnchorOf = new Map<string, string>() // independents folded by collision only
  const shownCountByWindow = new Map<string, number>()
  let colEnd = -Infinity
  let lastShownId: string | null = null

  for (const s of sorted) {
    const windowId = windowOf.get(s.node_id)
    const isMember = windowId !== undefined
    const windowShownCount = isMember ? (shownCountByWindow.get(windowId) ?? 0) : 0
    const overflowsWindow = isMember && windowShownCount >= 3
    if (!overflowsWindow && s.start_min >= colEnd) {
      shown.add(s.node_id)
      colEnd = s.end_min
      lastShownId = s.node_id
      if (isMember) shownCountByWindow.set(windowId, windowShownCount + 1)
    } else if (!isMember) {
      rawAnchorOf.set(s.node_id, lastShownId!)
    }
    // A folded member needs no raw anchor recorded — it always redirects to its own
    // window's last shown member, resolved below.
  }

  const lastShownMemberOfWindow = new Map<string, string>()
  for (const nodeId of shown) {
    const windowId = windowOf.get(nodeId)
    if (windowId === undefined) continue
    const prev = lastShownMemberOfWindow.get(windowId)
    if (prev === undefined || rankOf.get(nodeId)! > rankOf.get(prev)!) {
      lastShownMemberOfWindow.set(windowId, nodeId)
    }
  }

  const finalAnchorOf = (nodeId: string): string => {
    const windowId = windowOf.get(nodeId)
    if (windowId !== undefined) return lastShownMemberOfWindow.get(windowId)!
    const raw = rawAnchorOf.get(nodeId)!
    const rawWindowId = windowOf.get(raw)
    return rawWindowId !== undefined ? lastShownMemberOfWindow.get(rawWindowId)! : raw
  }

  const byId = new Map(scheduled.map((s) => [s.node_id, s]))
  const foldGroups = new Map<string, string[]>()
  for (const s of candidates) {
    if (shown.has(s.node_id)) continue
    const anchor = finalAnchorOf(s.node_id)
    const list = foldGroups.get(anchor) ?? []
    list.push(s.node_id)
    foldGroups.set(anchor, list)
  }
  for (const list of foldGroups.values()) {
    list.sort((a, b) => byId.get(a)!.start_min - byId.get(b)!.start_min || a.localeCompare(b))
  }

  return { shown, foldGroups }
}

/** Greedy word-wrap at `charsPerLine`, uncapped. A single word longer than the line
 * stays whole on its own line — the handoff forbids clipping or shrinking type. */
function wrapLabel(label: string, charsPerLine: number): string[] {
  const words = label.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const attempt = current ? `${current} ${word}` : word
    if (attempt.length <= charsPerLine || !current) {
      current = attempt
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current) lines.push(current)
  return lines
}

function textFitHeight(lines: number): number {
  return lines * LINE_H + 34
}

function durationHeight(minutes: number): number {
  return clamp(20 * Math.sqrt(minutes) + 20, H_MIN, H_MAX)
}

interface PendingCard {
  nodeId: string
  role: MapRole
  start: number
  end: number
  labelLines: string[]
  requiredH: number
}

interface TimeMap {
  yOf: (min: number) => number
  height: number
}

/**
 * Builds the shared vertical timeline every card — mainline or right column — is
 * placed against, then grows individual stretches so no card is shorter than its own
 * text-fit or duration-derived floor (`M2.75 Map design handoff.md` § Geometry).
 *
 * There is one axis for the whole map (`DESIGN_SYSTEM.md` § Resolved in M2.75,
 * Decision 4 drops the drawn axis and ticks, not the underlying time scale) so that
 * Plan and Map agree on when things happen — a window's members are placed beside
 * their host at the same y a mainline card at that minute would use.
 *
 * A fold label is a zero-duration row inserted right after its anchor's `end_min`:
 * everything scheduled from that minute on shifts down by `FOLD_LABEL_H`, keeping the
 * label's own vertical slot honest without lying about when anything runs.
 */
function buildTimeMap(
  scheduled: readonly ScheduledNode[],
  pending: readonly PendingCard[],
  foldAnchorEndMin: readonly number[],
): TimeMap & { labelTopOf: Map<number, number[]> } {
  const times = new Set<number>()
  for (const s of scheduled) {
    times.add(s.start_min)
    times.add(s.end_min)
  }
  const breakpoints = [...times].sort((a, b) => a - b)
  const indexOf = new Map(breakpoints.map((t, i) => [t, i]))

  const stretch: number[] = new Array(breakpoints.length).fill(0)
  for (let i = 1; i < breakpoints.length; i++) {
    stretch[i] = durationHeight(breakpoints[i] - breakpoints[i - 1]) + 2 * CARD_INSET
  }

  const gapCountAt = new Map<number, number>()
  for (const t of foldAnchorEndMin) gapCountAt.set(t, (gapCountAt.get(t) ?? 0) + 1)

  const computeY = (): number[] => {
    const y = new Array<number>(breakpoints.length)
    y[0] = TOP_PADDING
    for (let i = 1; i < breakpoints.length; i++) {
      y[i] = y[i - 1] + stretch[i] + FOLD_LABEL_H * (gapCountAt.get(breakpoints[i]) ?? 0)
    }
    return y
  }

  let y = computeY()

  const byEndAsc = [...pending].sort(
    (a, b) => a.end - b.end || b.start - a.start || a.nodeId.localeCompare(b.nodeId),
  )
  for (const card of byEndAsc) {
    const endIndex = indexOf.get(card.end)!
    const startIndex = indexOf.get(card.start)!
    const currentH = y[endIndex] - y[startIndex] - 2 * CARD_INSET
    if (currentH < card.requiredH) {
      stretch[endIndex] += card.requiredH - currentH
      y = computeY()
    }
  }

  const labelTopOf = new Map<number, number[]>() // breakpoint index -> [top of each stacked label]
  for (let i = 1; i < breakpoints.length; i++) {
    const count = gapCountAt.get(breakpoints[i]) ?? 0
    if (count === 0) continue
    const rawTop = y[i] - FOLD_LABEL_H * count // y[i] already includes this breakpoint's own gaps
    labelTopOf.set(
      breakpoints[i],
      Array.from({ length: count }, (_, k) => rawTop + k * FOLD_LABEL_H),
    )
  }

  const yOf = (min: number): number => round2(y[indexOf.get(min)!])
  return { yOf, height: round2(y[y.length - 1]), labelTopOf }
}

interface Anchor {
  x: number
  y: number
  w: number
  h: number
}

/** Adjacent mainline pair: a straight line down the shared mainline centre. A pair
 * with another mainline card between them jogs left into the gutter to pass it,
 * merging back onto the same final segment every edge into that target shares — one
 * arrowhead per merge (`M2.75 Map design handoff.md` § Connectors). */
function edgePath(from: Anchor, to: Anchor, adjacent: boolean): string {
  const cx = MAIN_X + MAIN_W / 2
  const sy = from.y + from.h
  const ey = to.y
  if (adjacent) return `M ${cx} ${sy} L ${cx} ${ey}`
  return `M 32 ${sy} L 32 ${sy + 6} L 10 ${sy + 6} L 10 ${ey - 6} L ${cx} ${ey - 6} L ${cx} ${ey}`
}

export function layoutMap(payload: RecipePlanResponse): MapLayout {
  const { graph, plan } = payload
  const nodes = new Map(graph.nodes.map((n) => [n.id, n]))
  const stageIndexById = new Map(graph.stages.map((stage, index) => [stage.id, index]))
  const scheduled = plan.scheduled

  const { roleOf } = classify(scheduled, plan.windows)
  const { shown, foldGroups } = computeRightColumn(scheduled, plan.windows, roleOf)

  const visible = scheduled.filter((s) => {
    const role = roleOf.get(s.node_id)!
    return role === 'mainline' || shown.has(s.node_id)
  })

  const charsPerLine = (w: number): number => Math.max(4, Math.floor((w - 24) / CHAR_W))
  const pending: PendingCard[] = visible.map((s) => {
    const role = roleOf.get(s.node_id)!
    const node = nodes.get(s.node_id)!
    const w = role === 'mainline' ? MAIN_W : RIGHT_W
    const labelLines = wrapLabel(node.label, charsPerLine(w))
    const requiredH = Math.max(
      H_MIN,
      durationHeight(s.end_min - s.start_min),
      textFitHeight(labelLines.length),
    )
    return { nodeId: s.node_id, role, start: s.start_min, end: s.end_min, labelLines, requiredH }
  })
  const pendingById = new Map(pending.map((p) => [p.nodeId, p]))

  const byId = new Map(scheduled.map((s) => [s.node_id, s]))
  const foldAnchorEndMin = [...foldGroups.keys()].map((anchor) => byId.get(anchor)!.end_min)
  const { yOf, height, labelTopOf } = buildTimeMap(scheduled, pending, foldAnchorEndMin)

  const cards: MapCard[] = pending.map((p) => {
    const node = nodes.get(p.nodeId)!
    const y = round2(yOf(p.start) + CARD_INSET)
    const h = round2(yOf(p.end) - yOf(p.start) - 2 * CARD_INSET)
    const note = p.role === 'mainline' && h >= NOTE_MIN_H ? attentionNote(node.attention) : null
    return {
      nodeId: p.nodeId,
      label: node.label,
      labelLines: p.labelLines,
      durationLabel: formatMinutes(node.duration_typical),
      note,
      x: p.role === 'mainline' ? MAIN_X : RIGHT_X,
      y,
      w: p.role === 'mainline' ? MAIN_W : RIGHT_W,
      h,
      stageIndex: stageIndexById.get(node.stage) ?? 0,
      role: p.role,
    }
  })
  const cardsById = new Map(cards.map((c) => [c.nodeId, c]))

  // Folds: one quiet label per merged group, positioned in the stacked slot reserved
  // for it right after its anchor's end_min.
  const labelSlotCursor = new Map<number, number>()
  const folds: MapFold[] = [...foldGroups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([anchorId, nodeIds]) => {
      const anchorEnd = byId.get(anchorId)!.end_min
      const slots = labelTopOf.get(anchorEnd) ?? [yOf(anchorEnd)]
      const slotIndex = labelSlotCursor.get(anchorEnd) ?? 0
      labelSlotCursor.set(anchorEnd, slotIndex + 1)
      const top = slots[slotIndex] ?? slots[0]
      return {
        anchorNodeId: anchorId,
        nodeIds,
        text: `+${nodeIds.length} more`,
        x: RIGHT_X + RIGHT_W / 2,
        y: round2(top + FOLD_LABEL_H / 2),
      }
    })

  // Edges: mainline -> mainline `depends_on` pairs only (Decision 3). "Adjacent" means
  // no other mainline card sits between the two in the mainline's own time order.
  const mainlineOrder = cards
    .filter((c) => c.role === 'mainline')
    .sort((a, b) => byId.get(a.nodeId)!.start_min - byId.get(b.nodeId)!.start_min)
    .map((c) => c.nodeId)
  const mainlineIndex = new Map(mainlineOrder.map((id, i) => [id, i]))

  const edges: MapEdge[] = []
  for (const node of graph.nodes) {
    if (!cardsById.get(node.id) || pendingById.get(node.id)?.role !== 'mainline') continue
    for (const depId of node.depends_on ?? []) {
      if (pendingById.get(depId)?.role !== 'mainline') continue
      const from = cardsById.get(depId)
      const to = cardsById.get(node.id)
      if (!from || !to) continue
      const adjacent = mainlineIndex.get(node.id)! === mainlineIndex.get(depId)! + 1
      edges.push({ from: depId, to: node.id, d: edgePath(from, to, adjacent) })
    }
  }

  // Brackets: one per window whose host stayed mainline and has at least one shown
  // member. Independent-overlap cards get no connector at all.
  const brackets: MapBracket[] = []
  for (const w of plan.windows) {
    const host = cardsById.get(w.host_node_id)
    if (!host || pendingById.get(w.host_node_id)?.role !== 'mainline') continue
    const shownMembers = w.assigned.filter((id) => shown.has(id)).map((id) => cardsById.get(id)!)
    if (shownMembers.length === 0) continue
    const hostRightX = host.x + host.w
    const firstCy = shownMembers[0].y + shownMembers[0].h / 2
    const lastCy = shownMembers[shownMembers.length - 1].y + shownMembers[shownMembers.length - 1].h / 2
    const stemY = clamp(firstCy, host.y + 12, host.y + host.h - 12)
    brackets.push({
      windowId: w.id,
      hostId: w.host_node_id,
      stemD: `M ${hostRightX} ${stemY} L ${SPINE_X} ${stemY}`,
      spineD: `M ${SPINE_X} ${Math.min(stemY, firstCy)} L ${SPINE_X} ${lastCy}`,
      ticks: shownMembers.map((m) => {
        const cy = m.y + m.h / 2
        return { to: m.nodeId, d: `M ${SPINE_X} ${cy} L ${RIGHT_X} ${cy}` }
      }),
    })
  }

  const usedStageIndexes = new Set(cards.map((c) => c.stageIndex))
  const legend = {
    stages: graph.stages
      .map((stage, index) => ({ label: stage.label, stageIndex: index }))
      .filter((s) => usedStageIndexes.has(s.stageIndex)),
    // The dashed key is the bracket's key. An independent-overlap card draws no
    // bracket, so it must never be what makes this true (CP2, "Fix hasParallel").
    // Independent-overlap cards get no legend entry of their own — their position and
    // lack of a bracket are the whole signal, per the approved grammar.
    hasParallel: plan.windows.length > 0,
  }

  return {
    width: WIDTH,
    height: round2(height + BOTTOM_PADDING),
    cards,
    edges,
    brackets,
    folds,
    legend,
    description: buildDescription(graph, plan),
  }
}

function buildDescription(graph: CookingGraph, plan: RecipePlanResponse['plan']): string {
  const taskCount = plan.scheduled.length
  const totalLabel = formatMinutes(plan.total_min)
  const windowedCount = plan.windows.reduce((n, w) => n + w.assigned.length, 0)
  const parallelClause =
    windowedCount > 0
      ? ` ${windowedCount} of those can be done while another task cooks unattended.`
      : ' Every task runs one after another.'
  return `A time-scaled map of ${graph.title}: ${taskCount} tasks over ${totalLabel}.${parallelClause}`
}
