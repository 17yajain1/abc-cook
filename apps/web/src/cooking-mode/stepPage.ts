import { isRejected, markDone, startNode } from '@/cooking/engine'
import { current } from '@/cooking/select'
import type { CookingModel, CookingSession } from '@/cooking/types'
import { attentionTag } from '@/lib/attention'
import { formatMinutes, roundMin } from '@/lib/duration'

import { timeLeft } from './copy'

/**
 * PR 2 CP2: the pieces of the step page that aren't the step itself: the progress ticks,
 * "Step N of M", Back and the Up next block. Every choice here reads the real engine and
 * selectors (`markDone`/`startNode` simulated on a copy, then `current()`); nothing here is
 * a new ordering rule. Up next and Back only ever *view* a step, never complete one.
 */

export type TickState = 'viewed' | 'done' | 'running' | 'todo'

export interface Tick {
  nodeId: string
  state: TickState
}

export interface UpNextView {
  /** "Up next", "Meanwhile" (the recipe page's word) for a hands-off step's window task, or
   * "When it's done" on a waiting screen (PR 2 CP4, owner answer 1). */
  label: 'Up next' | 'Meanwhile' | "When it's done"
  /** "Step N", the recipe-page number. */
  stepRef: string
  name: string
  /** `attentionTag()`: "Hands-off" / "Low attention", or `null` for a hands-on step. */
  tag: string | null
  text: string
  action: { kind: 'view'; nodeId: string }
}

/** The steps in recipe-page order (`stepNumbers`), or in execution order when the page
 * numbers are absent or don't cover every step. One order for the ticks, N, M and Back, so
 * they can never disagree. */
export function pageOrder(model: CookingModel, pageNumbers?: ReadonlyMap<string, number>): string[] {
  if (pageNumbers == null || !model.order.every((id) => pageNumbers.has(id))) return model.order
  return [...model.order].sort((a, b) => pageNumbers.get(a)! - pageNumbers.get(b)!)
}

/** One tick per page step. The viewed step wins over its own done or running state. */
export function ticks(session: CookingSession, order: string[], viewedId: string): Tick[] {
  return order.map((nodeId) => {
    const s = session.nodes[nodeId].state
    const state: TickState =
      nodeId === viewedId ? 'viewed' : s === 'done' ? 'done' : s === 'running' ? 'running' : 'todo'
    return { nodeId, state }
  })
}

/** PR 2 CP3: one row of the All steps sheet. */
export interface StepListRow {
  nodeId: string
  /** The recipe-page number. */
  n: number
  name: string
  state: TickState
  /** "You are here" (viewed), the time left (running), the step's length for a to-do
   * hands-off / low-attention step, else `null`. */
  right: string | null
  action: { kind: 'view'; nodeId: string }
}

/** The All steps sheet: every page step in page order. The viewed step wins over its own
 * done or running state, as on the ticks. Times only on timed steps (the design). */
export function stepList(
  model: CookingModel,
  session: CookingSession,
  now: number,
  order: string[],
  viewedId: string,
): StepListRow[] {
  return ticks(session, order, viewedId).map(({ nodeId, state }, i) => {
    const info = model.nodes[nodeId]
    const s = session.nodes[nodeId]
    let right: string | null = null
    if (state === 'viewed') right = 'You are here'
    else if (s.state === 'running') right = timeLeft(s.endsAt - now).text
    else if (state === 'todo' && !info.occupiesCook && roundMin(info.durationTypical) >= 1) {
      right = formatMinutes(info.durationTypical)
    }
    return { nodeId, n: i + 1, name: info.label, state, right, action: { kind: 'view', nodeId } }
  })
}

/** The page step before the viewed one, or `null` on page step 1. */
export function backTarget(order: string[], viewedId: string): string | null {
  const i = order.indexOf(viewedId)
  return i > 0 ? order[i - 1] : null
}

/** What the engine suggests next: `current()`, else the first not-started step in
 * execution order (the next thing that will need the cook once a wait ends). */
function suggestion(model: CookingModel, session: CookingSession): string | null {
  return (
    current(model, session) ??
    model.order.find((id) => {
      const s = session.nodes[id].state
      return s === 'pending' || s === 'deferred'
    }) ??
    null
  )
}

/** The tasks of the wait window(s) `hostId` hosts, by `rankInWindow` (the host itself never). */
function windowTasks(model: CookingModel, hostId: string): string[] {
  const windowIds = new Set(model.windows.filter((w) => w.host_node_id === hostId).map((w) => w.id))
  if (windowIds.size === 0) return []
  return model.order
    .filter((id) => {
      const w = model.nodes[id].windowId
      return id !== hostId && w != null && windowIds.has(w)
    })
    .sort((a, b) => (model.nodes[a].rankInWindow ?? 0) - (model.nodes[b].rankInWindow ?? 0))
}

/** The first not-done task of the wait window(s) `hostId` hosts, by `rankInWindow`. */
function meanwhileTask(model: CookingModel, session: CookingSession, hostId: string): string | null {
  return windowTasks(model, hostId).find((id) => session.nodes[id].state !== 'done') ?? null
}

/** PR 2 CP4: one row of the waiting screen's "Meanwhile, do these" block. */
export interface MeanwhileRow {
  nodeId: string
  /** The recipe-page number. */
  n: number
  name: string
  state: 'done' | 'running' | 'todo'
  /** "Done", the time left of a running task, or `null` for one still to do. */
  right: string | null
  /** A row views its task (P2: the cook can go anywhere). */
  action: { kind: 'view'; nodeId: string }
}

/** PR 2 CP4: every task of the windows `hostId` hosts (the recipe page's Meanwhile block),
 * by `rankInWindow`, each with its state. `[]` when the step hosts no window. */
export function meanwhileRows(
  model: CookingModel,
  session: CookingSession,
  now: number,
  hostId: string,
  order: string[],
): MeanwhileRow[] {
  return windowTasks(model, hostId).map((nodeId) => {
    const s = session.nodes[nodeId]
    const state: MeanwhileRow['state'] = s.state === 'done' ? 'done' : s.state === 'running' ? 'running' : 'todo'
    const right = s.state === 'done' ? 'Done' : s.state === 'running' ? timeLeft(s.endsAt - now).text : null
    return { nodeId, n: order.indexOf(nodeId) + 1, name: model.nodes[nodeId].label, state, right, action: { kind: 'view', nodeId } }
  })
}

/** PR 2 CP4: the waiting screen's "When it's done" block: the step's first not-done consumer
 * in execution order; with none, the suggestion after a simulated Done; nothing for the
 * finish step. Navigation only, never the step itself. */
export function waitingNext(
  model: CookingModel,
  session: CookingSession,
  now: number,
  hostId: string,
  order: string[],
): UpNextView | null {
  const info = model.nodes[hostId]
  if (info.isSink) return null
  let nextId = model.order.find((id) => info.consumers.includes(id) && session.nodes[id].state !== 'done') ?? null
  if (nextId == null) {
    const simulated = markDone(session, model, hostId, now)
    if (isRejected(simulated)) return null
    nextId = suggestion(model, simulated)
  }
  if (nextId == null || nextId === hostId) return null
  return upNextFor(model, nextId, "When it's done", order)
}

function upNextFor(model: CookingModel, nextId: string, label: UpNextView['label'], order: string[]): UpNextView {
  const next = model.nodes[nextId]
  return {
    label,
    stepRef: `Step ${order.indexOf(nextId) + 1}`,
    name: next.label,
    tag: attentionTag(next.attention),
    text: next.instruction,
    action: { kind: 'view', nodeId: nextId },
  }
}

/** A control at the foot of the All steps sheet: it either dispatches `action`, or moves
 * the foot to (`confirm: true`) or from (`confirm: false`) the confirm. */
export type EndCookButton = { label: string; action: { kind: 'endAndExit' } } | { label: string; confirm: boolean }

/** PR 2 CP4: "End this cook" at the foot of All steps, in place of the old leaving screen's
 * "End the cook and clear the timers". Two taps: the first only swaps the foot for the
 * confirm (no browser dialog); "End cook" ends the session and leaves; "Keep cooking"
 * dispatches nothing and goes back to the list. */
export function endCookFoot(confirming: boolean): { prompt: string | null; buttons: EndCookButton[] } {
  if (!confirming) return { prompt: null, buttons: [{ label: 'End this cook', confirm: true }] }
  return {
    prompt: 'End this cook? Running timers will stop.',
    buttons: [
      { label: 'End cook', action: { kind: 'endAndExit' } },
      { label: 'Keep cooking', confirm: false },
    ],
  }
}

/**
 * The Up next block for the viewed step (CP2 plan, "Up next"):
 * - the finish step: none;
 * - a done step: the suggestion;
 * - a hands-off step, pending or running: "Meanwhile" and the first not-done task of the
 *   window it hosts, if there is one;
 * - otherwise: the viewed step's own primary (Done, or the timer start for a pending
 *   hands-off step) run on a copy of the session, then the suggestion.
 * Never the viewed step itself.
 */
export function upNext(
  model: CookingModel,
  session: CookingSession,
  now: number,
  viewedId: string,
  order: string[],
): UpNextView | null {
  const info = model.nodes[viewedId]
  if (info.isSink) return null
  const state = session.nodes[viewedId].state

  let label: UpNextView['label'] = 'Up next'
  let nextId: string | null
  if (state === 'done') {
    nextId = suggestion(model, session)
  } else {
    const task = !info.occupiesCook && (state === 'pending' || state === 'running') ? meanwhileTask(model, session, viewedId) : null
    if (task != null) {
      label = 'Meanwhile'
      nextId = task
    } else {
      const simulated =
        !info.occupiesCook && state === 'pending'
          ? startNode(session, model, viewedId, now)
          : markDone(session, model, viewedId, now)
      if (isRejected(simulated)) return null
      nextId = suggestion(model, simulated)
    }
  }
  if (nextId == null || nextId === viewedId) return null
  return upNextFor(model, nextId, label, order)
}
