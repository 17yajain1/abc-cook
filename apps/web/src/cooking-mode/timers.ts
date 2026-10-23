import { ADD_TIME_MS } from '@/cooking/constants'
import { running } from '@/cooking/select'
import type { CookingModel, CookingSession } from '@/cooking/types'

import { localClock, timeLeft } from './copy'
import type { ActionDescriptor } from './viewModel'

/** A sheet button: its text and what it dispatches. */
export interface SheetButton {
  label: string
  action: ActionDescriptor
}

/**
 * PR 2 CP3: the running-timer rail (V2Running), the timer sheet (V2TimerSheet) and its
 * Timers list. Every figure is read off the session's own `startedAt`/`endsAt` against
 * `now`: nothing here times anything or decides what runs.
 */

/** Owner answer 1: at most two rails; with a third timer the second becomes the summary
 * rail, "N more timers" (CP3.1). */
export const MAX_RAILS = 2

export interface TimerRow {
  nodeId: string
  name: string
  /** "Step N", the recipe-page number. */
  stepRef: string
  /** `timeLeft().text`: "52 min left", "1 hr 12 min left", "Time's up". */
  left: string
}

export type RailView =
  | { kind: 'timer'; nodeId: string; name: string; left: string; aria: string }
  | { kind: 'more'; count: number; text: string; aria: string }

export interface TimerSheetView {
  nodeId: string
  name: string
  stepRef: string
  /** "Go to step N" (`view`), or `null` when the cook is already on that step. */
  goTo: SheetButton | null
  big: string
  unit: string | null
  /** "Ready around 1:42 PM" in the device locale's clock; `null` once the time is up. */
  readyAt: string | null
  /** How far through its time the timer is, 0..1, for the thin bar. */
  fraction: number
  /** "Add 5 min"; `null` once the time is up (CP4's banner owns that case). */
  add: SheetButton | null
  stop: SheetButton
  done: SheetButton
}

function endsAt(session: CookingSession, id: string): number {
  const s = session.nodes[id]
  return s.state === 'running' ? s.endsAt : Number.POSITIVE_INFINITY
}

/** Every running timer, soonest end first (ties in execution order), periodic ones included. */
export function runningTimers(model: CookingModel, session: CookingSession, now: number, order: string[]): TimerRow[] {
  return running(model, session)
    .map((id, i) => ({ id, i }))
    .sort((a, b) => endsAt(session, a.id) - endsAt(session, b.id) || a.i - b.i)
    .map(({ id }) => ({
      nodeId: id,
      name: model.nodes[id].label,
      stepRef: `Step ${order.indexOf(id) + 1}`,
      left: timeLeft(endsAt(session, id) - now).text,
    }))
}

/** The rails under the top bar: one per timer up to `MAX_RAILS`; with more timers than
 * that, the soonest and then "N more timers". The viewed step's own timer is included. */
export function rails(model: CookingModel, session: CookingSession, now: number, order: string[]): RailView[] {
  const rows = runningTimers(model, session, now, order)
  const asRail = (r: TimerRow): RailView => ({
    kind: 'timer',
    nodeId: r.nodeId,
    name: r.name,
    left: r.left,
    aria: `${r.name}, ${r.left}. Open timer`,
  })
  if (rows.length <= MAX_RAILS) return rows.map(asRail)
  const more = rows.length - 1
  return [asRail(rows[0]), { kind: 'more', count: more, text: `${more} more timers`, aria: `${more} more timers. Show all timers` }]
}

/** One timer's sheet, or `null` when `nodeId` isn't running (the sheet then closes).
 * `viewedId` is the step on screen; `locale` is for tests (default: the device's). */
export function timerSheet(
  model: CookingModel,
  session: CookingSession,
  now: number,
  nodeId: string,
  order: string[],
  viewedId: string | null,
  locale?: string,
): TimerSheetView | null {
  const s = session.nodes[nodeId]
  if (s.state !== 'running') return null
  const left = timeLeft(s.endsAt - now)
  const up = s.endsAt <= now
  const stepRef = `Step ${order.indexOf(nodeId) + 1}`
  const span = s.endsAt - s.startedAt
  return {
    nodeId,
    name: model.nodes[nodeId].label,
    stepRef,
    goTo: viewedId === nodeId ? null : { label: `Go to ${stepRef.toLowerCase()}`, action: { kind: 'view', nodeId } },
    big: left.big,
    unit: left.unit,
    readyAt: up ? null : `Ready around ${localClock(now, s.endsAt, locale)}`,
    fraction: span > 0 ? Math.min(1, Math.max(0, (now - s.startedAt) / span)) : 1,
    add: up ? null : { label: 'Add 5 min', action: { kind: 'extend', nodeId, ms: ADD_TIME_MS } },
    stop: { label: 'Stop timer', action: { kind: 'stopNode', nodeId } },
    done: { label: "It's done", action: { kind: 'markDone', nodeId } },
  }
}
