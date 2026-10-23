import { isRejected, markDone, startNode } from '@/cooking/engine'
import { current } from '@/cooking/select'
import type { CookingModel, CookingSession } from '@/cooking/types'
import { attentionTag } from '@/lib/attention'

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
  /** "Up next", or "Meanwhile" (the recipe page's word) for a hands-off step's window task. */
  label: 'Up next' | 'Meanwhile'
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

/** The first not-done task of the wait window(s) `hostId` hosts, by `rankInWindow`. */
function meanwhileTask(model: CookingModel, session: CookingSession, hostId: string): string | null {
  const windowIds = new Set(model.windows.filter((w) => w.host_node_id === hostId).map((w) => w.id))
  if (windowIds.size === 0) return null
  const tasks = model.order
    .filter((id) => {
      const w = model.nodes[id].windowId
      return w != null && windowIds.has(w)
    })
    .sort((a, b) => (model.nodes[a].rankInWindow ?? 0) - (model.nodes[b].rankInWindow ?? 0))
  return tasks.find((id) => id !== hostId && session.nodes[id].state !== 'done') ?? null
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
