import type { CookingGraph, Node, RecipePlanResponse, ScheduledNode } from '@abc-cook/schema'

import { formatMinutes } from '@/lib/duration'

/**
 * `CookingPlan -> LayoutSpec`, the pure function `GRAPH_VIEW.md` §7 asks for.
 *
 * Geometry only. Every minute figure (`start_min`, `end_min`, `duration_typical`,
 * `capacity_min`, …) is copied verbatim from the plan and the graph — this file only
 * turns those figures into pixel positions. It never infers a dependency, a duration,
 * or a parallelism decision that the scheduler didn't already make (CLAUDE.md).
 *
 * `plan.critical_path` is used for exactly one thing: choosing which lane is lane 0.
 * It is not exposed as a user-facing category anywhere in the output — no label, no
 * legend entry, no flag on `MapCard` — per `DESIGN_SYSTEM.md` § *The Map grammar*.
 *
 * Mark set: `docs/DESIGN_SYSTEM.md` § *The Map grammar*. Algorithm: `docs/GRAPH_VIEW.md`
 * §4.
 */

const WIDTH = 390
const AXIS_X = 56
const LANE_X0 = 64
const LANE_RIGHT_MARGIN = 12
const LANE_GAP = 12
const MAX_LANES = 3
const CARD_INSET = 6
const ROW_MIN = 56
const ROW_MAX = 140
const ROW_K = 34
const TOP_PADDING = 16
const BOTTOM_PADDING = 16
const TICK_MIN_GAP = 14
const NOTE_MIN_CARD_H = 60
const CHAR_WIDTH_PX = 6.6 // at 13px, the card label's size

export interface MapLayout {
  width: typeof WIDTH
  height: number
  lanes: number
  axis: { x: number; y0: number; y1: number; ticks: { label: string; y: number }[] }
  cards: MapCard[]
  edges: MapEdge[]
  flows: MapFlow[]
  overflow: MapOverflowCard[]
  legend: { stages: { label: string; stageIndex: number }[]; hasParallel: boolean }
  /** `<desc>` text for the SVG, built from plan facts only. */
  description: string
}

export interface MapCard {
  nodeId: string
  label: string
  durationLabel: string
  /** `(low attention)` / `(hands off)` / `null` for hands-on. Dropped under 60px. */
  note: string | null
  x: number
  y: number
  w: number
  h: number
  lane: number
  stageIndex: number
  /** True iff the scheduler placed this node inside another node's wait window. */
  borrowed: boolean
  /** 1–2 lines, pre-fitted to `w` by a plain character-width estimate. */
  labelLines: string[]
}

/** One `depends_on` pair: an orthogonal elbow with an arrowhead at `to`. */
export interface MapEdge {
  from: string
  to: string
  d: string
}

/** One wait window's dashed flow: a bus off the host, one branch per borrowed card. */
export interface MapFlow {
  windowId: string
  busD: string
  branches: { to: string; d: string }[]
}

/** The `+N more` card absorbing nodes beyond `MAX_LANES`. */
export interface MapOverflowCard {
  fromMin: number
  toMin: number
  x: number
  y: number
  w: number
  h: number
  nodeIds: string[]
}

function byId<T extends { id: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}

function byNodeId(scheduled: readonly ScheduledNode[]): Map<string, ScheduledNode> {
  return new Map(scheduled.map((s) => [s.node_id, s]))
}

function cardsByNodeId(cards: readonly MapCard[]): Map<string, MapCard> {
  return new Map(cards.map((c) => [c.nodeId, c]))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/** Rounds geometry to 0.01px so accumulated sqrt/float arithmetic never leaves a card a
 * fraction of a pixel under a floor (44px tap target, 96px width) that its inputs
 * actually satisfy exactly. Purely cosmetic — no minute figure is touched. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Attention note text — a categorical lookup, never a computed or authored string. */
function attentionNote(attention: Node['attention']): string | null {
  if (attention === 'periodic') return '(low attention)'
  if (attention === 'unattended') return '(hands off)'
  return null
}

interface Axis {
  y0: number
  y1: number
  yOf: (min: number) => number
  ticks: { label: string; y: number }[]
}

/**
 * Breakpoints are every distinct `start_min`/`end_min` in the plan. Each consecutive
 * pair is one "stretch" — sqrt-compressed and clamped independently, so a long host
 * spanning several stretches (e.g. a 12-min cook broken up by a window's own
 * boundaries) accumulates several clamped segments rather than one giant one.
 */
function buildAxis(scheduled: readonly ScheduledNode[]): Axis {
  const times = new Set<number>()
  for (const s of scheduled) {
    times.add(s.start_min)
    times.add(s.end_min)
  }
  const sorted = [...times].sort((a, b) => a - b)

  const yByTime = new Map<number, number>()
  let y = TOP_PADDING
  yByTime.set(sorted[0] ?? 0, y)
  for (let i = 1; i < sorted.length; i++) {
    const dt = sorted[i] - sorted[i - 1]
    y += clamp(ROW_K * Math.sqrt(dt), ROW_MIN, ROW_MAX)
    yByTime.set(sorted[i], y)
  }

  const yOf = (min: number): number => round2(yByTime.get(min) ?? y)

  // Ticks at every breakpoint; if a label would land under 14px from the previous kept
  // one, drop it — the axis is compressed, so evenly-numbered ticks would otherwise sit
  // unevenly apart and read as a bug (GRAPH_VIEW.md §4).
  const ticks: { label: string; y: number }[] = []
  let lastKeptY = -Infinity
  for (const t of sorted) {
    const ty = yOf(t)
    if (ty - lastKeptY >= TICK_MIN_GAP) {
      ticks.push({ label: `${Math.round(t)} min`, y: ty })
      lastKeptY = ty
    }
  }

  return { y0: TOP_PADDING, y1: round2(y), yOf, ticks }
}

interface Interval {
  start: number
  end: number
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end
}

interface LaneAssignment {
  laneOf: Map<string, number>
  lanesUsed: number
  overflowIds: string[]
}

/**
 * Assigns each scheduled node a lane, in four passes so borrowed window content is
 * never bumped in favour of unrelated concurrent prep (the M2.75 checkpoint fixtures
 * — chicken-biryani in particular — force this ordering; see `layout.test.ts`):
 *
 *   A. Lane 0 = `plan.critical_path`. A layout input only — never drawn, never named.
 *   B. Every window's host node (unless already critical) — first-fit, lowest lane ≥ 1.
 *   C. Every non-critical borrowed task — fixed at `host.lane + 1`.
 *   D. Everything left over (plain concurrent nodes, no window, no critical role) —
 *      first-fit lowest lane ≥ 1 against everything already placed. This is the pool
 *      that overflows past `MAX_LANES`.
 */
function assignLanes(
  scheduled: readonly ScheduledNode[],
  criticalPath: readonly string[],
  windows: RecipePlanResponse['plan']['windows'],
): LaneAssignment {
  const byNode = byNodeId(scheduled)
  const criticalSet = new Set(criticalPath)
  const hostSet = new Set(windows.map((w) => w.host_node_id))
  const nonCriticalBorrowed = new Map<string, string>() // nodeId -> host_node_id
  for (const w of windows) {
    for (const nodeId of w.assigned) {
      if (!criticalSet.has(nodeId)) nonCriticalBorrowed.set(nodeId, w.host_node_id)
    }
  }

  const laneOf = new Map<string, number>()
  const laneIntervals: Interval[][] = [[], [], []]

  const intervalOf = (nodeId: string): Interval => {
    const s = byNode.get(nodeId)!
    return { start: s.start_min, end: s.end_min }
  }

  for (const nodeId of criticalSet) {
    laneOf.set(nodeId, 0)
    laneIntervals[0].push(intervalOf(nodeId))
  }

  const fits = (lane: number, interval: Interval): boolean =>
    laneIntervals[lane].every((iv) => !overlaps(iv, interval))

  const firstFit = (nodeId: string): boolean => {
    const interval = intervalOf(nodeId)
    for (let lane = 1; lane < MAX_LANES; lane++) {
      if (fits(lane, interval)) {
        laneOf.set(nodeId, lane)
        laneIntervals[lane].push(interval)
        return true
      }
    }
    return false
  }

  // B. Hosts, sorted (start_min, node_id) — deterministic, no other tie-break needed
  // since this pool never contains a rank_in_window value.
  const overflowIds: string[] = []
  const hosts = [...hostSet]
    .filter((id) => !criticalSet.has(id))
    .sort((a, b) => byNode.get(a)!.start_min - byNode.get(b)!.start_min || a.localeCompare(b))
  for (const id of hosts) {
    if (!firstFit(id)) overflowIds.push(id)
  }

  // C. Borrowed tasks at host.lane + 1, fixed — not first-fit. A borrowed task whose
  // slot would collide (defensive; not exercised by the current fixtures) or whose
  // host has no lane or sits in lane MAX_LANES - 1 falls back to overflow instead of
  // silently overlapping another card.
  for (const [nodeId, hostId] of nonCriticalBorrowed) {
    const hostLane = laneOf.get(hostId)
    const targetLane = hostLane === undefined ? undefined : hostLane + 1
    const interval = intervalOf(nodeId)
    if (targetLane !== undefined && targetLane < MAX_LANES && fits(targetLane, interval)) {
      laneOf.set(nodeId, targetLane)
      laneIntervals[targetLane].push(interval)
    } else {
      overflowIds.push(nodeId)
    }
  }

  // D. Everything else: not critical, not a host, not borrowed.
  const placedOrOverflowed = new Set([...laneOf.keys(), ...overflowIds])
  const rest = scheduled
    .filter((s) => !placedOrOverflowed.has(s.node_id))
    .sort((a, b) => a.start_min - b.start_min || a.node_id.localeCompare(b.node_id))
  for (const s of rest) {
    if (!firstFit(s.node_id)) overflowIds.push(s.node_id)
  }

  let lanesUsed = 1
  for (const lane of laneOf.values()) lanesUsed = Math.max(lanesUsed, lane + 1)
  if (overflowIds.length > 0) lanesUsed = MAX_LANES

  return { laneOf, lanesUsed, overflowIds }
}

function laneGeometry(lanesUsed: number): { width: number; xOf: (lane: number) => number } {
  const totalWidth = WIDTH - LANE_X0 - LANE_RIGHT_MARGIN - LANE_GAP * (lanesUsed - 1)
  const width = round2(totalWidth / lanesUsed)
  return { width, xOf: (lane) => round2(LANE_X0 + lane * (width + LANE_GAP)) }
}

/** Cuts a label to 1–2 lines by a plain character-width estimate — no DOM measurement. */
function fitLabel(label: string, cardWidth: number, cardHeight: number): string[] {
  const maxChars = Math.max(4, Math.floor((cardWidth - 12) / CHAR_WIDTH_PX))
  if (label.length <= maxChars) return [label]

  if (cardHeight < NOTE_MIN_CARD_H) return [truncate(label, maxChars)]

  const words = label.split(' ')
  let line1 = ''
  let i = 0
  while (i < words.length) {
    const attempt = line1 ? `${line1} ${words[i]}` : words[i]
    if (attempt.length > maxChars) break
    line1 = attempt
    i++
  }
  if (!line1) return [truncate(label, maxChars)] // one word longer than the card is wide
  const line2 = words.slice(i).join(' ')
  return line2 ? [line1, truncate(line2, maxChars)] : [line1]
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, Math.max(1, maxChars - 1))
  const lastSpace = cut.lastIndexOf(' ')
  return `${lastSpace > 2 ? cut.slice(0, lastSpace) : cut}…`
}

interface Anchor {
  x: number
  y: number
  w: number
  h: number
}

/** An orthogonal elbow that shares its final vertical segment with every other edge
 * into the same target — which is what makes a merge of several dependencies draw as
 * a single arrowhead (GRAPH_VIEW.md §4, "merge points"). */
function edgePath(from: Anchor, to: Anchor): string {
  const sx = from.x + from.w / 2
  const sy = from.y + from.h
  const ex = to.x + to.w / 2
  const ey = to.y
  const bendY = Math.min(ey - CARD_INSET, sy)
  if (sx === ex) return `M ${sx} ${sy} L ${ex} ${ey}`
  return `M ${sx} ${sy} L ${sx} ${bendY} L ${ex} ${bendY} L ${ex} ${ey}`
}

export function layoutMap(payload: RecipePlanResponse): MapLayout {
  const { graph, plan } = payload
  const nodes = byId(graph.nodes)
  const stageIndexById = new Map(graph.stages.map((stage, index) => [stage.id, index]))
  const scheduled = plan.scheduled

  const axis = buildAxis(scheduled)
  const { laneOf, lanesUsed, overflowIds } = assignLanes(scheduled, plan.critical_path, plan.windows)
  const { width: laneWidth, xOf: laneX } = laneGeometry(lanesUsed)

  const borrowedSet = new Set(plan.windows.flatMap((w) => w.assigned))

  const cards: MapCard[] = []
  for (const s of scheduled) {
    const lane = laneOf.get(s.node_id)
    if (lane === undefined) continue // absorbed into an overflow card, below
    const node = nodes.get(s.node_id)!
    const y = round2(axis.yOf(s.start_min) + CARD_INSET)
    const h = round2(axis.yOf(s.end_min) - axis.yOf(s.start_min) - 2 * CARD_INSET)
    const x = laneX(lane)
    const note = h >= NOTE_MIN_CARD_H ? attentionNote(node.attention) : null
    cards.push({
      nodeId: s.node_id,
      label: node.label,
      durationLabel: formatMinutes(node.duration_typical),
      note,
      x,
      y,
      w: laneWidth,
      h,
      lane,
      stageIndex: stageIndexById.get(node.stage) ?? 0,
      borrowed: borrowedSet.has(s.node_id),
      labelLines: fitLabel(node.label, laneWidth, h),
    })
  }
  const cardsById = cardsByNodeId(cards)

  // Overflow: group nodes whose scheduled intervals overlap into one `+N more` card
  // each, in the last lane, spanning the group's combined interval.
  const byNode = byNodeId(scheduled)
  const sortedOverflow = [...overflowIds].sort(
    (a, b) => byNode.get(a)!.start_min - byNode.get(b)!.start_min || a.localeCompare(b),
  )
  const overflowGroups: { fromMin: number; toMin: number; nodeIds: string[] }[] = []
  for (const id of sortedOverflow) {
    const s = byNode.get(id)!
    const current = overflowGroups[overflowGroups.length - 1]
    if (current && s.start_min < current.toMin) {
      current.toMin = Math.max(current.toMin, s.end_min)
      current.nodeIds.push(id)
    } else {
      overflowGroups.push({ fromMin: s.start_min, toMin: s.end_min, nodeIds: [id] })
    }
  }
  const overflowLane = MAX_LANES - 1
  const overflow: MapOverflowCard[] = overflowGroups.map((group) => ({
    fromMin: group.fromMin,
    toMin: group.toMin,
    x: laneX(overflowLane),
    y: round2(axis.yOf(group.fromMin) + CARD_INSET),
    w: laneWidth,
    h: round2(axis.yOf(group.toMin) - axis.yOf(group.fromMin) - 2 * CARD_INSET),
    nodeIds: group.nodeIds,
  }))
  const overflowCardOf = new Map<string, MapOverflowCard>()
  for (const card of overflow) {
    for (const nodeId of card.nodeIds) overflowCardOf.set(nodeId, card)
  }

  const anchorOf = (nodeId: string): Anchor | undefined =>
    cardsById.get(nodeId) ?? overflowCardOf.get(nodeId)

  // One edge per depends_on pair, including where one end is an overflow card —
  // dependencies still have to read even when a node is grouped away.
  const edges: MapEdge[] = []
  for (const node of graph.nodes) {
    for (const depId of node.depends_on ?? []) {
      const from = anchorOf(depId)
      const to = anchorOf(node.id)
      if (!from || !to) continue
      edges.push({ from: depId, to: node.id, d: edgePath(from, to) })
    }
  }

  // One flow per window, one branch per borrowed card actually drawn in host.lane + 1
  // — never for a borrowed task that stayed in lane 0 for being critical too.
  const flows: MapFlow[] = []
  for (const w of plan.windows) {
    const host = cardsById.get(w.host_node_id)
    if (!host) continue
    const branchCards = w.assigned
      .map((id) => cardsById.get(id))
      .filter((c): c is MapCard => c !== undefined && c.lane === host.lane + 1)
    if (branchCards.length === 0) continue
    const busX = host.x + host.w + 8
    const busTop = host.y + 12
    const busBottom = Math.max(...branchCards.map((c) => c.y + c.h / 2))
    flows.push({
      windowId: w.id,
      busD: `M ${busX} ${busTop} L ${busX} ${busBottom}`,
      branches: branchCards.map((c) => ({
        to: c.nodeId,
        d: `M ${busX} ${c.y + c.h / 2} L ${c.x} ${c.y + c.h / 2}`,
      })),
    })
  }

  const usedStageIndexes = new Set(cards.map((c) => c.stageIndex))
  const legend = {
    stages: graph.stages
      .map((stage, index) => ({ label: stage.label, stageIndex: index }))
      .filter((s) => usedStageIndexes.has(s.stageIndex)),
    hasParallel: plan.windows.length > 0,
  }

  const description = buildDescription(graph, payload.plan)

  return {
    width: WIDTH,
    height: axis.y1 + BOTTOM_PADDING,
    lanes: lanesUsed,
    axis: { x: AXIS_X, y0: axis.y0, y1: axis.y1, ticks: axis.ticks },
    cards,
    edges,
    flows,
    overflow,
    legend,
    description,
  }
}

function buildDescription(graph: CookingGraph, plan: RecipePlanResponse['plan']): string {
  const taskCount = plan.scheduled.length
  const totalLabel = formatMinutes(plan.total_min)
  const parallelCount = plan.windows.reduce((n, w) => n + w.assigned.length, 0)
  const parallelClause =
    parallelCount > 0
      ? ` ${parallelCount} of those can be done while another task cooks unattended.`
      : ' Every task runs one after another.'
  return `A time-scaled map of ${graph.title}: ${taskCount} tasks over ${totalLabel}.${parallelClause}`
}
