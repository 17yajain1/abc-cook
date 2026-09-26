import { useEffect, useMemo, useState } from 'react'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { deriveCookingModel } from '@/cooking/model'
import type { SessionStore } from '@/cooking/store'
import type { SessionConflict } from '@/cooking/types'
import { useSession } from '@/cooking/useSession'
import { headerTiming } from '@/lib/duration'

import { CookingShell } from './CookingShell'
import { ingredientsById } from './quantity'
import {
  buildConflictView,
  buildCookingView,
  buildEntryView,
  buildSheetView,
  type ActionDescriptor,
  type ConflictAction,
  type CookingView,
} from './viewModel'
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
  planKey,
  store,
  onExit,
  onGoTo,
  canGoTo,
}: {
  payload: RecipePlanResponse
  planKey: string
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
}) {
  const model = useMemo(() => deriveCookingModel(payload), [payload])
  const ingredients = useMemo(() => ingredientsById(payload.graph.ingredients), [payload])
  const timing = useMemo(() => headerTiming(payload.summary ?? null, payload.plan.total_min), [payload])

  const session = useSession(store)
  const [now, setNow] = useState(() => Date.now())
  const [leaving, setLeaving] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)

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

  const runEngine = (fn: () => void) => {
    fn()
    setSheetOpen(false)
    setLeaving(false)
  }

  const dispatchAction = (action: ActionDescriptor) => {
    switch (action.kind) {
      case 'start':
        runEngine(() => session.start(model, planKey, payload.graph.title))
        return
      case 'startNode':
        runEngine(() => session.startNode(model, action.nodeId))
        return
      case 'markDone':
        runEngine(() => session.markDone(model, action.nodeId))
        return
      case 'skip':
        runEngine(() => session.skip(model, action.nodeId))
        return
      case 'extend':
        runEngine(() => session.extend(model, action.nodeId))
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
      case 'stay':
        setLeaving(false)
        return
      case 'seePlan':
        onExit()
        return
    }
  }

  if (openResult.status === 'conflict') {
    return (
      <ConflictScreen
        conflict={openResult.conflict}
        canGoTo={canGoTo}
        onGoTo={onGoTo}
        onEndBlockingSession={() => session.end()}
        onClose={onExit}
      />
    )
  }

  const view: CookingView =
    openResult.status === 'none'
      ? buildEntryView(model, payload.graph.title, timing)
      : buildCookingView(model, openResult.session, now, ingredients, {
          recipeTitle: payload.graph.title,
          leaving,
        })

  const sheet =
    sheetOpen && openResult.status === 'ok' ? buildSheetView(model, openResult.session, now) : null

  return (
    <div className="relative h-full overflow-hidden">
      <CookingShell
        view={view}
        onPrimary={() => view.primary && dispatchAction(view.primary.action)}
        onSecondary={() => view.secondary && dispatchAction(view.secondary.action)}
        onLeave={() => setLeaving(true)}
        onSheet={() => setSheetOpen(true)}
      />
      {sheet && <WhatsCookingSheet sheet={sheet} onClose={() => setSheetOpen(false)} />}
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
 * All three actions are live as of CP1b:
 * - `goTo` calls `onGoTo(conflict.planKey)` — `App.tsx`'s job to actually navigate
 *   (library lookup / `fetchPlan`); this component only ever asks for that planKey.
 * - `endAndStart` calls `session.end()` (via `onEndBlockingSession`) and nothing else.
 *   The next render's `session.open(model, planKey)` then reports `'none'` for *this*
 *   plan, so `CookingModeScreen` falls through to `buildEntryView` on its own — the
 *   entry/start screen for the recipe the cook was trying to open, never auto-started
 *   (plan CP1b §2: "Do NOT automatically start cooking").
 * - `close` calls `onClose` (→ `onExit`), unchanged since before CP1a: returns to the
 *   Plan view for the recipe the cook was trying to open, leaving the blocking session
 *   untouched (plan CP1b §3).
 *
 * Bypasses `CookingShell`/`CookingView` (unlike every other screen in this file) because
 * this screen needs three action slots, not `CookingShell`'s two — reusing the same
 * design tokens (`bg-paper`/`text-ink`/`rounded-control`) rather than a new shell.
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
    <div className="flex h-full flex-col items-center justify-center bg-paper px-6 text-center">
      <p className="text-[13px] text-ink-3">Already cooking</p>
      <h1 className="mt-3 text-[26px] font-semibold leading-[1.2] text-ink" style={{ fontStretch: '88%' }}>
        {view.message}
      </h1>
      <p className="mt-3 text-[15px] leading-[1.5] text-ink-2">One cook at a time.</p>
      <div className="mt-8 flex w-full flex-col gap-3">
        {view.actions.map((action, i) =>
          i === 0 ? (
            <button
              key={action.kind}
              type="button"
              onClick={() => onAction(action)}
              className="flex h-[56px] w-full items-center justify-center rounded-control border border-ink bg-ink text-[18px] font-semibold text-paper"
              style={{ fontStretch: '106%' }}
            >
              {action.label}
            </button>
          ) : action.kind === 'close' ? (
            <button
              key={action.kind}
              type="button"
              onClick={() => onAction(action)}
              className="text-[15px] underline underline-offset-[3px] text-ink-3"
            >
              {action.label}
            </button>
          ) : (
            <button
              key={action.kind}
              type="button"
              onClick={() => onAction(action)}
              className="flex min-h-[56px] w-full items-center justify-center rounded-control border border-ink px-3.5 py-2 text-center text-[18px] font-medium leading-[1.3] text-ink"
            >
              {action.label}
            </button>
          ),
        )}
      </div>
    </div>
  )
}
