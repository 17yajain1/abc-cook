import { useEffect, useMemo, useState } from 'react'

import type { GraphProvenance, RecipePlanResponse } from '@abc-cook/schema'

import { deriveCookingModel } from '@/cooking/model'
import type { SessionStore } from '@/cooking/store'
import type { SessionConflict } from '@/cooking/types'
import { useSession } from '@/cooking/useSession'
import type { ServingsChoice } from '@/lib/servings'
import { derivePlan } from '@/plan/derive'
import { stepNumbers } from '@/plan/stepNumbers'
import { useHomeSurface } from '@/shell/useHomeSurface'

import { CookingShell, MessageScreen } from './CookingShell'
import { finishCooking, replaceSession, type SessionFinished } from './finalizeSession'
import { ingredientsById } from './quantity'
import { StepListSheet } from './StepListSheet'
import { pageOrder, stepList } from './stepPage'
import { runningTimers, sheetTop, timerSheet, type RailView } from './timers'
import { TimerSheet, type TimerSheetContent } from './TimerSheet'
import { useWakeLock } from './useWakeLock'
import {
  buildConflictView,
  buildCookingView,
  conflictTimer,
  recipeThumbnail,
  type ActionDescriptor,
  type ConflictAction,
  type CookingView,
} from './viewModel'
import { shouldHoldWakeLock } from './wakeLock'

const STORAGE_FULL = 'Couldn’t save on this device — storage may be full.'

/**
 * Cooking Mode: the step and waiting screens, the done screen, the stale screen and the
 * plan-key conflict (PR 2 CP4: no start, leaving or returning screen; a timer's end is a
 * banner). Every fact comes from the real session core (`@/cooking/{engine,select,model,
 * store,useSession}`) — this component only resolves which screen to show (`viewModel.ts`)
 * and wires its buttons to the matching `useSession` call. No local state machine, no timer
 * of its own: `now` is re-read on an interval and on `visibilitychange`, never counted down
 * (`CLAUDE.md` "Timers survive backgrounding"). The timer-end sound lives app-wide
 * (`useTimerEndSignals` in `App.tsx`), so it never rings twice.
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
  foreignStepName = () => null,
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
   * `goToConflict`). Called with `conflict.planKey`. */
  onGoTo: (planKey: string) => void
  /** CP1b: whether `onGoTo` can actually resolve `planKey` right now. Backed by the real
   * `Library`, unlike `buildConflictView`'s own prefix-only default. */
  canGoTo: (planKey: string) => boolean
  /** PR 2 CP4: the name of a step of another plan (the conflict screen's timer line), or
   * `null` when this device can't tell (no payload for that plan here). */
  foreignStepName?: (planKey: string, nodeId: string) => string | null
  /** P1 #6 §C4: called after "Finished cooking" ends the session. */
  onFinish: () => void
  /** M5: receives a confirmed session completion ("Finished cooking" tapped, or a finished
   * session replaced through the conflict flow). `App.tsx` appends it to the local outbox. */
  emitCompletion: (event: SessionFinished) => void
}) {
  const model = useMemo(() => deriveCookingModel(payload, provenance), [payload, provenance])
  const ingredients = useMemo(() => ingredientsById(payload.graph.ingredients), [payload])
  // PR 2 CP2: "Step N of M" is the recipe-page number, counted the way the page counts it.
  const pageNumbers = useMemo(() => stepNumbers(derivePlan(payload, provenance).stages), [payload, provenance])
  const thumbnail = useMemo(() => recipeThumbnail(payload.graph.source), [payload])
  // PR 2 CP2: cooking mode is on the Home register's cream ground, safe-area strip included.
  useHomeSurface(true)

  const session = useSession(store)
  const [now, setNow] = useState(() => Date.now())
  // PR 2 CP3: the timer sheet (one timer, or the Timers list behind "N more timers"), the All
  // steps sheet, and the step whose "You'll need" list the cook opened (owner answer 4:
  // it stays open while on that step and closes when the step on screen changes).
  const [timerFor, setTimerFor] = useState<{ mode: 'one'; nodeId: string } | { mode: 'all' } | null>(null)
  const [stepsOpen, setStepsOpen] = useState(false)
  const [needOpenFor, setNeedOpenFor] = useState<string | null>(null)
  // CP4.1: where the timer-end banners end, so an open sheet's top sits below them.
  const [bannerBottom, setBannerBottom] = useState<number | null>(null)
  // PR 2 CP4: the done screen's Back shows the last step. Local UI, never persisted: it names
  // the `finishedAt` it was tapped on, so it lapses on its own once the session isn't that
  // finished session any more (Undo, a new cook), and a reload lands on the done screen.
  const [reviewingFor, setReviewingFor] = useState<number | null>(null)
  // A storage failure on "End it and cook ..." or "Start again" (one atomic `store.replace`).
  const [replaceError, setReplaceError] = useState(false)
  // CP-B §6/§10: `replace` reported `conflict_changed` — say so over whatever screen follows.
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
  const live = openResult.status === 'ok' ? openResult.session : null
  const reviewing = live?.finishedAt != null && reviewingFor === live.finishedAt

  const view: CookingView | null =
    live != null
      ? buildCookingView(model, live, now, ingredients, {
          recipeTitle: payload.graph.title,
          choice: live.servingsChoice ?? null,
          editedSteps,
          importedSteps,
          pageNumbers,
          reviewing,
          thumbnail,
        })
      : null
  // Called before any early return (Rules of Hooks); the conflict and "couldn't start"
  // screens release the lock.
  useWakeLock(view != null && shouldHoldWakeLock(view.screenId))

  const runEngine = (fn: () => void) => {
    fn()
    setTimerFor(null)
    setStepsOpen(false)
  }

  /** One atomic `store.replace`: ends `expectedPlanKey`'s session (with its M5 completion if
   * it was finished) and starts this plan's, which opens on step 1. */
  const replace = (expectedPlanKey: string, choice: ServingsChoice | null, at: number) => {
    const result = replaceSession(store, model, planKey, expectedPlanKey, payload.graph.title, emitCompletion, at, choice)
    if (result.ok) {
      setReplaceError(false)
    } else if (result.reason === 'conflict_changed') {
      // Not a silent re-derive: an explicit notice, and the render below re-evaluates.
      setReplaceError(false)
      setReplaceNotice(true)
    } else {
      setReplaceError(true)
    }
  }

  const dispatchAction = (action: ActionDescriptor) => {
    switch (action.kind) {
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
      case 'touch':
        runEngine(() => session.touch())
        return
      case 'startAgain':
        runEngine(() => replace(planKey, live?.servingsChoice ?? servingsChoice, Date.now()))
        return
      case 'undo':
        runEngine(() => session.undo(model))
        return
      case 'finish':
        runEngine(() => finishCooking(store, emitCompletion, Date.now()))
        onFinish()
        return
      case 'review':
        runEngine(() => {
          if (live?.finishedAt == null) return
          setReviewingFor(live.finishedAt)
          session.view(model, model.order.find((id) => model.nodes[id].isSink) ?? null)
        })
        return
      case 'endAndExit':
        runEngine(() => session.end())
        onExit()
        return
    }
  }

  if (openResult.status === 'conflict') {
    const conflict = openResult.conflict
    return (
      <div className="relative h-full overflow-hidden">
        {replaceNotice && <ReplaceNotice onDismiss={() => setReplaceNotice(false)} />}
        <ConflictScreen
          conflict={conflict}
          canGoTo={canGoTo}
          recipeTitle={payload.graph.title}
          timer={conflictTimer(session.session, (nodeId) => foreignStepName(conflict.planKey, nodeId))}
          now={now}
          error={replaceError}
          onGoTo={onGoTo}
          onEndBlockingSession={() => runEngine(() => replace(conflict.planKey, servingsChoice, Date.now()))}
          onClose={onExit}
        />
      </div>
    )
  }

  // `none` is only reachable when `startIfNone`'s write failed: say so, with no start content.
  if (view == null || live == null) {
    return (
      <MessageScreen
        heading="Couldn’t start cooking on this device — storage may be full."
        line={null}
        primary={{ label: 'Back', onClick: onExit }}
      />
    )
  }

  if (replaceError && view.screenId === 'stale') view.note = STORAGE_FULL

  // CP3 sheets, rebuilt from the session every render; a sheet whose subject is gone (the
  // timer stopped or finished, nothing left running, the step page replaced) shows nothing.
  const order = pageOrder(model, pageNumbers)
  let timerContent: TimerSheetContent | null = null
  if (view.nodeId != null && timerFor != null) {
    if (timerFor.mode === 'one') {
      const one = timerSheet(model, live, now, timerFor.nodeId, order, view.nodeId)
      timerContent = one != null ? { mode: 'one', sheet: one } : null
    } else {
      const rows = runningTimers(model, live, now, order)
      timerContent = rows.length > 0 ? { mode: 'all', rows } : null
    }
  }
  const steps = view.nodeId != null && stepsOpen ? stepList(model, live, now, order, view.nodeId) : null

  return (
    <div className="relative h-full overflow-hidden">
      {replaceNotice && <ReplaceNotice onDismiss={() => setReplaceNotice(false)} />}
      <CookingShell
        view={view}
        needExpanded={view.nodeId != null && needOpenFor === view.nodeId}
        onPrimary={() => view.primary && dispatchAction(view.primary.action)}
        onSecondary={() => view.secondary && dispatchAction(view.secondary.action)}
        // PR 2 CP4: Leave just leaves; timers keep running and Home's Continue strip brings the cook back.
        onLeave={onExit}
        onNavigate={dispatchAction}
        onAction={dispatchAction}
        onRail={(rail: RailView) => setTimerFor(rail.kind === 'timer' ? { mode: 'one', nodeId: rail.nodeId } : { mode: 'all' })}
        onSteps={() => setStepsOpen(true)}
        onExpandNeed={() => setNeedOpenFor(view.nodeId)}
        onBannerBottom={setBannerBottom}
      />
      {timerContent && (
        <TimerSheet
          top={sheetTop(bannerBottom)}
          content={timerContent}
          onAction={dispatchAction}
          onPick={(nodeId) => setTimerFor({ mode: 'one', nodeId })}
          onClose={() => setTimerFor(null)}
        />
      )}
      {steps && (
        <StepListSheet
          top={sheetTop(bannerBottom)}
          rows={steps}
          onPick={(row) => dispatchAction(row.action)}
          onClose={() => setStepsOpen(false)}
          onAction={dispatchAction}
        />
      )}
    </div>
  )
}

/**
 * CP-B (plan §6/§10): the persistent notice for `replace`'s `conflict_changed`
 * rejection — "That cooking session changed — showing the current state." Rendered as
 * an overlay above whichever screen `openResult` re-derives to, since that screen is not
 * known ahead of time. Dismissible rather than timed.
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
 * `conflict` (V2Conflict, PR 2 CP4): "You're still cooking ‹A›.", one line on its soonest
 * timer, and two choices (`buildConflictView`). "Back to ‹A›" calls `onGoTo` (App's
 * navigation); "End it and cook ‹B›" replaces A with B at once, one atomic write, and lands
 * on step 1 (no staged start screen); "Back" (only when A can't be gone to) leaves.
 */
function ConflictScreen({
  conflict,
  canGoTo,
  recipeTitle,
  timer,
  now,
  error,
  onGoTo,
  onEndBlockingSession,
  onClose,
}: {
  conflict: SessionConflict
  canGoTo: (planKey: string) => boolean
  recipeTitle: string
  timer: ReturnType<typeof conflictTimer>
  now: number
  error: boolean
  onGoTo: (planKey: string) => void
  onEndBlockingSession: () => void
  onClose: () => void
}) {
  const view = buildConflictView(conflict, canGoTo, { recipeTitle, timer, now })

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

  const [first, second] = view.actions
  return (
    <MessageScreen
      heading={view.heading}
      line={view.line}
      primary={{ label: first.label, onClick: () => onAction(first) }}
      secondary={second && { label: second.label, onClick: () => onAction(second) }}
      note={error ? STORAGE_FULL : null}
    />
  )
}
