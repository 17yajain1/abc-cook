import { useEffect, useMemo, useState } from 'react'

import type { GraphProvenance, RecipePlanResponse } from '@abc-cook/schema'

import { deriveCookingModel } from '@/cooking/model'
import type { SessionStore } from '@/cooking/store'
import type { SessionConflict } from '@/cooking/types'
import { useSession } from '@/cooking/useSession'
import { headerTiming } from '@/lib/duration'
import type { ServingsChoice } from '@/lib/servings'
import { derivePlan } from '@/plan/derive'
import { stepNumbers } from '@/plan/stepNumbers'
import { useHomeSurface } from '@/shell/useHomeSurface'

import { CookingShell } from './CookingShell'
import { finishCooking, replaceSession, type SessionFinished } from './finalizeSession'
import { ingredientsById } from './quantity'
import { StepListSheet } from './StepListSheet'
import { pageOrder, stepList } from './stepPage'
import { runningTimers, timerSheet, type RailView } from './timers'
import { TimerSheet, type TimerSheetContent } from './TimerSheet'
import { useWakeLock } from './useWakeLock'
import {
  buildConflictView,
  buildCookingView,
  buildEntryView,
  buildSheetView,
  type ActionDescriptor,
  type ConflictAction,
  type CookingView,
  type ScreenId,
} from './viewModel'
import { shouldHoldWakeLock } from './wakeLock'
import { WhatsCookingSheet } from './WhatsCookingSheet'

/**
 * Cooking Mode (M3.4), Checkpoint 1: the core journey — entry, task (hands-on and
 * hands-off-pending), wait/long_wait, handover, What's Cooking, sitting_break/resume,
 * leaving/returning, stale, plan-key conflict, and done. Every fact comes from the real
 * M3.3 session core (`@/cooking/{engine,select,model,store,useSession}`) — this
 * component only resolves which screen to show (`viewModel.ts`) and wires its buttons
 * to the matching `useSession` call. No local state machine, no timer of its own:
 * `now` is re-read on an interval and on `visibilitychange`, never counted down
 * (`CLAUDE.md` "Timers survive backgrounding").
 */
export function CookingModeScreen({
  payload,
  provenance = null,
  editedSteps,
  importedSteps,
  planKey,
  servingsChoice = null,
  store,
  onExit,
  onGoTo,
  canGoTo,
  onFinish,
  emitCompletion,
}: {
  payload: RecipePlanResponse
  /** FGC-3: which steps ABC Cook added; `null` for a plan with no provenance (the label is simply absent). */
  provenance?: GraphProvenance | null
  /** R6b: ids of the steps whose text the cook edited; a time phrase in one earns the quiet timer note (B3 ii). */
  editedSteps?: ReadonlySet<string>
  /** R6b B26: those steps as imported, to tell whether the amounts in an edited step moved. */
  importedSteps?: ReadonlyMap<string, string>
  planKey: string
  /** R4: the choice a session started from this screen begins with (the plan view's). A session
   * already in progress carries its own, and that one wins everywhere below. */
  servingsChoice?: ServingsChoice | null
  store: SessionStore
  onExit: () => void
  /** CP1b: navigates to a conflicting session's own plan, App-level (`App.tsx`'s
   * `goToConflict`) — resolving `library:`/`server:` planKeys through the app's existing
   * library lookup / `fetchPlan`, never a new endpoint. Called with `conflict.planKey`. */
  onGoTo: (planKey: string) => void
  /** CP1b: whether `onGoTo` can actually resolve `planKey` right now (a `library:` id
   * still in the library, or any `server:` id — `fetchPlan` is always tried). Backed by
   * the real `Library`, unlike `buildConflictView`'s own prefix-only default. */
  canGoTo: (planKey: string) => boolean
  /** P1 #6 §C4: called after the done screen's "Finished cooking" ends the session —
   * navigates to the Library (`App.tsx` passes `backToPicker`). */
  onFinish: () => void
  /** M5: receives a confirmed session completion ("Finished cooking" tapped, or a finished
   * session replaced through the conflict flow). `App.tsx` appends it to the local outbox. */
  emitCompletion: (event: SessionFinished) => void
}) {
  const model = useMemo(() => deriveCookingModel(payload, provenance), [payload, provenance])
  const ingredients = useMemo(() => ingredientsById(payload.graph.ingredients), [payload])
  const timing = useMemo(() => headerTiming(payload.summary ?? null, payload.plan.total_min), [payload])
  // PR 2 CP2: "Step N of M" is the recipe-page number, counted the way the page counts it.
  const pageNumbers = useMemo(() => stepNumbers(derivePlan(payload, provenance).stages), [payload, provenance])
  // PR 2 CP2: cooking mode is on the Home register's cream ground, safe-area strip included.
  useHomeSurface(true)

  const session = useSession(store)
  const [now, setNow] = useState(() => Date.now())
  const [leaving, setLeaving] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  // PR 2 CP3: the timer sheet (one timer, or the Timers list behind "N more timers"), the All
  // steps sheet, and the step whose "You'll need" list the cook opened (owner answer 4:
  // it stays open while on that step and closes when the step on screen changes).
  const [timerFor, setTimerFor] = useState<{ mode: 'one'; nodeId: string } | { mode: 'all' } | null>(null)
  const [stepsOpen, setStepsOpen] = useState(false)
  const [needOpenFor, setNeedOpenFor] = useState<string | null>(null)

  // CP-B (notes/pr19-atomic-replace-plan.md §3/§6): staged, in-memory-only replacement
  // intent — none of these three are ever persisted or dispatched to the store by
  // themselves. `pendingReplace` holds the *other* session's planKey (`conflict.planKey`)
  // once "End it and start this" is tapped; the blocking session survives fully intact
  // in storage until "Start cooking" is actually tapped on the staged entry screen this
  // produces (§3). `replaceError` surfaces a retryable `storage_write_failed` from that
  // second tap. `replaceNotice` surfaces the approved `conflict_changed` handling (§6/
  // §10): cleared `pendingReplace`, re-evaluated current session state, and an explicit
  // persistent notice, regardless of which screen the re-evaluation lands on.
  const [pendingReplace, setPendingReplace] = useState<string | null>(null)
  const [replaceError, setReplaceError] = useState(false)
  const [replaceNotice, setReplaceNotice] = useState(false)

  // Recomputed, never counted down — a completed timer is read off `endsAt` the next
  // time this fires, whether that's the next tick or the tab regaining visibility.
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const id = window.setInterval(tick, 1000)
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])

  const openResult = session.open(model, planKey)

  // CP2's Rules-of-Hooks fix (M3.4 CP2 investigation, corrected against current `main`):
  // the CP2 plan called `useWakeLock` "after `view` is resolved", but `view` is now
  // computed after two early returns below (staged-replace, conflict) — a hook there
  // would violate the Rules of Hooks. `wakeScreenId` resolves the same screen identity
  // those branches would render, unconditionally, so the hook can be called before them.
  const wakeScreenId: ScreenId =
    openResult.status === 'conflict' && pendingReplace === openResult.conflict.planKey
      ? 'entry'
      : openResult.status === 'conflict'
        ? 'conflict'
        : openResult.status === 'none'
          ? 'entry'
          : buildCookingView(model, openResult.session, now, ingredients, {
              recipeTitle: payload.graph.title,
              leaving,
              choice: openResult.session.servingsChoice ?? null,
            }).screenId
  useWakeLock(shouldHoldWakeLock(wakeScreenId))

  const runEngine = (fn: () => void) => {
    fn()
    setSheetOpen(false)
    setTimerFor(null)
    setStepsOpen(false)
    setLeaving(false)
  }

  const dispatchAction = (action: ActionDescriptor) => {
    switch (action.kind) {
      case 'start':
        runEngine(() => {
          if (pendingReplace == null) {
            session.start(model, planKey, payload.graph.title, servingsChoice)
            return
          }
          // The second tap: the one persisted write that both ends the blocking
          // session (A) and starts this one (B) — `store.replace` (CP-A). No
          // separate `session.end()` call anywhere in this path (§3 "Central design
          // finding").
          // `replaceSession` is that same `store.replace` dispatch, plus the M5
          // completion event when the session being discarded was finished.
          const result = replaceSession(
            store,
            model,
            planKey,
            pendingReplace,
            payload.graph.title,
            emitCompletion,
            Date.now(),
            servingsChoice,
          )
          if (result.ok) {
            setPendingReplace(null)
            setReplaceError(false)
          } else if (result.reason === 'conflict_changed') {
            // §6/§10: not a silent re-derive — clear the stale staging, surface an
            // explicit notice, and let the normal render path below re-evaluate
            // `openResult` from scratch.
            setPendingReplace(null)
            setReplaceError(false)
            setReplaceNotice(true)
          } else {
            // storage_write_failed (or any other rejection `replace` might report):
            // retryable — keep `pendingReplace` so "Start cooking" can be tapped
            // again without redoing the conflict flow.
            setReplaceError(true)
          }
        })
        return
      case 'startNode':
        runEngine(() => {
          // Started from a view naming it: move on, as Done does (CP2 `clearView`). The
          // view is navigation, so the start stays what Undo reverses.
          const result = session.startNode(model, action.nodeId)
          if (result.ok && action.clearView) session.view(model, null)
        })
        return
      case 'markDone':
        runEngine(() => session.markDone(model, action.nodeId))
        return
      // PR 2 CP3: the timer sheet's "Stop timer".
      case 'stopNode':
        runEngine(() => session.stopNode(model, action.nodeId))
        return
      case 'view':
        runEngine(() => session.view(model, action.nodeId))
        return
      case 'extend':
        runEngine(() => session.extend(model, action.nodeId, action.ms))
        return
      case 'acknowledge':
        runEngine(() => session.acknowledge(model))
        return
      case 'resume':
        runEngine(() => session.resume(model))
        return
      case 'touch':
        runEngine(() => session.touch())
        return
      case 'end':
        runEngine(() => session.end())
        return
      case 'undo':
        runEngine(() => session.undo(model))
        return
      case 'finish':
        runEngine(() => finishCooking(store, emitCompletion, Date.now()))
        onFinish()
        return
      case 'endAndExit':
        runEngine(() => session.end())
        onExit()
        return
      case 'stay':
        setLeaving(false)
        return
      case 'seePlan':
        onExit()
        return
    }
  }

  // The shell's CP3 controls: a rail opens its timer's sheet ("N more timers": the Timers
  // list), "Step N of M" opens All steps, "Show N more" opens the rest of You'll need here.
  const stepControls = (v: CookingView) => ({
    needExpanded: v.nodeId != null && needOpenFor === v.nodeId,
    onAction: dispatchAction,
    onRail: (rail: RailView) => setTimerFor(rail.kind === 'timer' ? { mode: 'one', nodeId: rail.nodeId } : { mode: 'all' }),
    onSteps: () => setStepsOpen(true),
    onExpandNeed: () => setNeedOpenFor(v.nodeId),
  })

  // Staged replacement (CP-B, plan §3): "End it and start this" was tapped — A is
  // still fully intact in storage (nothing has been dispatched yet); this renders B's
  // ordinary entry screen in its place, purely a local view swap. `session.replace`
  // only fires when this screen's own "Start cooking" is tapped (the `dispatchAction`
  // `'start'` case above).
  if (openResult.status === 'conflict' && pendingReplace === openResult.conflict.planKey) {
    const view = buildEntryView(model, payload.graph.title, timing, servingsChoice)
    if (replaceError) view.note = 'Couldn’t save on this device — storage may be full.'
    return (
      <div className="relative h-full overflow-hidden">
        {replaceNotice && <ReplaceNotice onDismiss={() => setReplaceNotice(false)} />}
        <CookingShell
          view={view}
          onPrimary={() => view.primary && dispatchAction(view.primary.action)}
          onSecondary={() => view.secondary && dispatchAction(view.secondary.action)}
          onLeave={() => setLeaving(true)}
          onSheet={() => setSheetOpen(true)}
          onNavigate={dispatchAction}
          {...stepControls(view)}
        />
      </div>
    )
  }

  if (openResult.status === 'conflict') {
    return (
      <div className="relative h-full overflow-hidden">
        {replaceNotice && <ReplaceNotice onDismiss={() => setReplaceNotice(false)} />}
        <ConflictScreen
          conflict={openResult.conflict}
          canGoTo={canGoTo}
          onGoTo={onGoTo}
          onEndBlockingSession={() => {
            // Local UI transition only — no dispatch, no store touch. A survives
            // untouched until the staged entry screen's "Start cooking" is tapped.
            setPendingReplace(openResult.conflict.planKey)
            setReplaceError(false)
            setReplaceNotice(false)
          }}
          onClose={onExit}
        />
      </div>
    )
  }

  const view: CookingView =
    openResult.status === 'none'
      ? buildEntryView(model, payload.graph.title, timing, servingsChoice)
      : buildCookingView(model, openResult.session, now, ingredients, {
          recipeTitle: payload.graph.title,
          leaving,
          choice: openResult.session.servingsChoice ?? null,
          editedSteps,
          importedSteps,
          pageNumbers,
        })

  const sheet =
    sheetOpen && openResult.status === 'ok' ? buildSheetView(model, openResult.session, now) : null

  // CP3 sheets, rebuilt from the session every render; a sheet whose subject is gone (the
  // timer stopped or finished, nothing left running, the step page replaced) shows nothing.
  const live = openResult.status === 'ok' ? openResult.session : null
  const order = pageOrder(model, pageNumbers)
  let timerContent: TimerSheetContent | null = null
  if (live != null && view.nodeId != null && timerFor != null) {
    if (timerFor.mode === 'one') {
      const one = timerSheet(model, live, now, timerFor.nodeId, order, view.nodeId)
      timerContent = one != null ? { mode: 'one', sheet: one } : null
    } else {
      const rows = runningTimers(model, live, now, order)
      timerContent = rows.length > 0 ? { mode: 'all', rows } : null
    }
  }
  const steps = live != null && view.nodeId != null && stepsOpen ? stepList(model, live, now, order, view.nodeId) : null

  return (
    <div className="relative h-full overflow-hidden">
      {replaceNotice && <ReplaceNotice onDismiss={() => setReplaceNotice(false)} />}
      <CookingShell
        view={view}
        onPrimary={() => view.primary && dispatchAction(view.primary.action)}
        onSecondary={() => view.secondary && dispatchAction(view.secondary.action)}
        onLeave={() => setLeaving(true)}
        onSheet={() => setSheetOpen(true)}
        onNavigate={dispatchAction}
        {...stepControls(view)}
      />
      {sheet && <WhatsCookingSheet sheet={sheet} onClose={() => setSheetOpen(false)} />}
      {timerContent && (
        <TimerSheet
          content={timerContent}
          onAction={dispatchAction}
          onPick={(nodeId) => setTimerFor({ mode: 'one', nodeId })}
          onClose={() => setTimerFor(null)}
        />
      )}
      {steps && (
        <StepListSheet rows={steps} onPick={(row) => dispatchAction(row.action)} onClose={() => setStepsOpen(false)} />
      )}
    </div>
  )
}

/**
 * CP-B (plan §6/§10): the persistent notice for `replace`'s `conflict_changed`
 * rejection — "That cooking session changed — showing the current state." Rendered as
 * an overlay above whichever screen `openResult` re-derives to (entry, a freshly
 * derived conflict, or an ordinary cooking view), since that screen is not known ahead
 * of time. Dismissible rather than timed — nothing here re-triggers it, so it would
 * otherwise sit forever.
 */
function ReplaceNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 border-b border-home-rule bg-home-ground px-4 pb-3 pt-[calc(12px+var(--safe-top))] text-[13px] text-home-ink">
      <p>That cooking session changed — showing the current state.</p>
      <button type="button" onClick={onDismiss} className="shrink-0 underline underline-offset-[3px]">
        Dismiss
      </button>
    </div>
  )
}

/**
 * `conflict` (M3.4 handoff §1/§7 row 10; CP1a+CP1b of the M3.4.5 session-lockout plan).
 * Identifies the other cook when `conflict.title` is known (plan decision 1/3 — the
 * `recipeTitle` snapshot `engine.start()` takes) and classifies it (active/finished/
 * stale/unknown) via `buildConflictView`, which also decides (via `canGoTo`) whether
 * "Go to <recipe>" is offered at all.
 *
 * All three actions are live as of CP1b (`endAndStart` revised by CP-B — see below):
 * - `goTo` calls `onGoTo(conflict.planKey)` — `App.tsx`'s job to actually navigate
 *   (library lookup / `fetchPlan`); this component only ever asks for that planKey.
 * - `endAndStart` (CP-B, notes/pr19-atomic-replace-plan.md §3) stages the replacement
 *   locally via `onEndBlockingSession` — no dispatch, no store touch. The blocking
 *   session (A) stays fully intact in storage; `CookingModeScreen` swaps to A's
 *   still-`'conflict'` `openResult` rendering B's ordinary entry screen instead of this
 *   one. The actual atomic write (`session.replace`, ending A and starting B in one
 *   persisted call) only happens when that entry screen's own "Start cooking" is
 *   tapped — never auto-started (plan CP1b §2 still holds: "Do NOT automatically start
 *   cooking").
 * - `close` calls `onClose` (→ `onExit`), unchanged since before CP1a: returns to the
 *   Plan view for the recipe the cook was trying to open, leaving the blocking session
 *   untouched (plan CP1b §3).
 *
 * Bypasses `CookingShell`/`CookingView` (unlike every other screen in this file) because
 * this screen needs three action slots, not `CookingShell`'s two — reusing the same
 * Home-register tokens and pill as the shell (PR 2 CP2) rather than a new shell.
 */
function ConflictScreen({
  conflict,
  canGoTo,
  onGoTo,
  onEndBlockingSession,
  onClose,
}: {
  conflict: SessionConflict
  canGoTo: (planKey: string) => boolean
  onGoTo: (planKey: string) => void
  onEndBlockingSession: () => void
  onClose: () => void
}) {
  const view = buildConflictView(conflict, canGoTo)

  const onAction = (action: ConflictAction) => {
    switch (action.kind) {
      case 'goTo':
        onGoTo(conflict.planKey)
        return
      case 'endAndStart':
        onEndBlockingSession()
        return
      case 'close':
        onClose()
        return
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center bg-home-ground px-6 text-center">
      <p className="text-[13px] text-home-ink-2">Already cooking</p>
      <h1 className="mt-3 text-[26px] font-semibold leading-[1.2] text-home-ink" style={{ fontStretch: '88%' }}>
        {view.message}
      </h1>
      <p className="mt-3 text-[15px] leading-[1.5] text-home-ink-2">One cook at a time.</p>
      <div className="mt-8 flex w-full flex-col gap-3">
        {view.actions.map((action, i) =>
          i === 0 ? (
            <button
              key={action.kind}
              type="button"
              onClick={() => onAction(action)}
              className="flex h-[60px] w-full items-center justify-center rounded-full bg-home-terracotta text-[18px] font-bold text-home-ground"
            >
              {action.label}
            </button>
          ) : action.kind === 'close' ? (
            <button
              key={action.kind}
              type="button"
              onClick={() => onAction(action)}
              className="text-[15px] underline underline-offset-[3px] text-home-ink-2"
            >
              {action.label}
            </button>
          ) : (
            <button
              key={action.kind}
              type="button"
              onClick={() => onAction(action)}
              className="flex min-h-[60px] w-full items-center justify-center rounded-full border border-home-ink px-3.5 py-2 text-center text-[18px] font-medium leading-[1.3] text-home-ink"
            >
              {action.label}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
