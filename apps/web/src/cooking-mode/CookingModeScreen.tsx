import { useEffect, useMemo, useState } from 'react'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { deriveCookingModel } from '@/cooking/model'
import type { SessionStore } from '@/cooking/store'
import { useSession } from '@/cooking/useSession'
import { headerTiming } from '@/lib/duration'

import { CookingShell } from './CookingShell'
import { ingredientsById } from './quantity'
import { buildCookingView, buildEntryView, buildSheetView, type ActionDescriptor, type CookingView } from './viewModel'
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
}: {
  payload: RecipePlanResponse
  planKey: string
  store: SessionStore
  onExit: () => void
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
        runEngine(() => session.start(model, planKey))
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
    return <ConflictScreen onClose={onExit} />
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
 * `conflict` (M3.4 handoff §1/§7 row 10): the safe path only — a bare way back, never
 * the destructive "end that cook and start this one" branch, which M3.3's `end()`
 * (a no-report bare clear) doesn't yet have the semantics to support from a screen.
 *
 * Design/production gap (flagged per the M3.4 checkpoint instructions): the prototype
 * names the *other* cook's own title on this screen, resolved from its own in-memory
 * fixture table. Production has no such registry — a stored session only carries the
 * other plan's `planKey`/`graphId`, not a title — so this renders generically and
 * "Close" returns to the Plan view for the recipe the cook was trying to open, rather
 * than attempting to navigate to the other one.
 */
function ConflictScreen({ onClose }: { onClose: () => void }) {
  const view: CookingView = {
    screenId: 'conflict',
    shell: 'field',
    topRecipe: '',
    showTopRight: false,
    label: 'Already cooking',
    title: 'Another cook is already on.',
    instr: 'One cook at a time. Finish or leave that one before starting this.',
    qty: null,
    note: null,
    whisperText: null,
    showLink: false,
    primary: { label: 'Close', solid: true, action: { kind: 'seePlan' } },
    secondary: null,
  }
  return <CookingShell view={view} onPrimary={onClose} onSecondary={() => {}} onLeave={() => {}} onSheet={() => {}} />
}
