import { ADD_TIME_MS } from '@/cooking/constants'
import { running } from '@/cooking/select'
import type { CookingModel, CookingSession } from '@/cooking/types'

import { endedAgo, readyClock, timeLeft } from './copy'
import type { ActionDescriptor } from './viewModel'

/** A sheet button: its text and what it dispatches. */
export interface SheetButton {
  label: string
  action: ActionDescriptor
}

/**
 * PR 2 CP3: the running-timer rail (V2Running), the timer sheet (V2TimerSheet) and its
 * Timers list; PR 2 CP4: the timer-end banner (V2Banner) that takes a rail's place once its
 * timer ends. Every figure is read off the session's own `startedAt`/`endsAt` against
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

/** PR 2 CP4 (V2Banner): an ended timer. "‹name› is ready", "Timer ended 4 min ago", and its
 * own "+5 min" (from now) and "Done". */
export interface BannerView {
  kind: 'banner'
  nodeId: string
  title: string
  line: string
  add: SheetButton
  done: SheetButton
}

/** One strip under the top bar: a banner, a timer rail or the "N more timers" rail. */
export type StripView = BannerView | RailView

/** At most two banners; any further ended timer folds into the strip below them. */
export const MAX_BANNERS = 2

export interface TimerSheetView {
  nodeId: string
  name: string
  stepRef: string
  /** "Go to step N" (`view`), or `null` when the cook is already on that step. */
  goTo: SheetButton | null
  big: string
  unit: string | null
  /** "Ready around 1:42 PM" (`readyClock`, the time first); `null` once the time is up. */
  readyAt: string | null
  /** PR 2 CP4: the time is up (`endsAt <= now`). */
  ended: boolean
  /** How far through its time the timer is, 0..1, for the thin bar. */
  fraction: number
  /** "Add 5 min": offered on an expired timer too since CP4, where it means 5 min from now. */
  add: SheetButton
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

function asRail(r: TimerRow): RailView {
  return { kind: 'timer', nodeId: r.nodeId, name: r.name, left: r.left, aria: `${r.name}, ${r.left}. Open timer` }
}

function moreRail(count: number): RailView {
  return { kind: 'more', count, text: `${count} more timers`, aria: `${count} more timers. Show all timers` }
}

/**
 * The strips under the top bar (CP3 rails, CP4 banners). `hideId`, when given, is left out
 * entirely: a timer's own waiting screen shows it there instead (no duplicate).
 * - No timer has ended: CP3's rails, one per timer up to `MAX_RAILS`; with more, the soonest
 *   and then "N more timers".
 * - Some have: every ended timer (running, `endsAt <= now`) is a banner, the one that ended
 *   first on top (ties in execution order), at most `MAX_BANNERS`. Everything else (the
 *   timers still running, and any further ended one) folds into one strip below: its rail
 *   when it's one timer, "N more timers" when it's several. So at most three strips.
 */
export function strips(
  model: CookingModel,
  session: CookingSession,
  now: number,
  order: string[],
  hideId: string | null = null,
): StripView[] {
  const rows = runningTimers(model, session, now, order).filter((r) => r.nodeId !== hideId)
  const ended = rows.filter((r) => endsAt(session, r.nodeId) <= now)
  if (ended.length === 0) {
    if (rows.length <= MAX_RAILS) return rows.map(asRail)
    return [asRail(rows[0]), moreRail(rows.length - 1)]
  }
  const banners = ended.slice(0, MAX_BANNERS)
  const rest = rows.filter((r) => !banners.includes(r))
  const out: StripView[] = banners.map((r) => banner(r, now - endsAt(session, r.nodeId)))
  if (rest.length === 1) out.push(asRail(rest[0]))
  else if (rest.length > 1) out.push(moreRail(rest.length))
  return out
}

function banner(r: TimerRow, sinceEndMs: number): BannerView {
  return {
    kind: 'banner',
    nodeId: r.nodeId,
    title: `${r.name} is ready`,
    line: `Timer ended ${endedAgo(sinceEndMs)}`,
    add: { label: '+5 min', action: { kind: 'extend', nodeId: r.nodeId, ms: ADD_TIME_MS } },
    done: { label: 'Done', action: { kind: 'markDone', nodeId: r.nodeId } },
  }
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
    readyAt: up ? null : `Ready around ${readyClock(now, s.endsAt, locale)}`,
    ended: up,
    fraction: span > 0 ? Math.min(1, Math.max(0, (now - s.startedAt) / span)) : 1,
    add: { label: 'Add 5 min', action: { kind: 'extend', nodeId, ms: ADD_TIME_MS } },
    stop: { label: 'Stop timer', action: { kind: 'stopNode', nodeId } },
    done: { label: "It's done", action: { kind: 'markDone', nodeId } },
  }
}
