import { useCallback, useSyncExternalStore } from 'react'

import type { OpenResult } from './engine'
import type { DispatchResult, SessionAction, SessionStore } from './store'
import type { CookingModel, CookingSession } from './types'

/**
 * The `useSyncExternalStore` binding over a `SessionStore` (plan §G/§K5 — no Zustand;
 * selector-level subscription comes from `useSyncExternalStore` itself). This is the
 * **only** place `Date.now()` is read in the cooking session stack (CLAUDE.md "Timers
 * survive backgrounding"; M3.3 exit criterion 3: `grep -n "Date.now" src/cooking`
 * returns only this file). `engine.ts`/`model.ts`/`select.ts` take `now` as a parameter
 * and never read the clock themselves.
 *
 * No screen consumes this in M3.3 (plan §C0 — `Start Cooking` stays inert); it exists so
 * the reducer and store are wired the way M3.4 will call them. Not covered by a
 * dedicated test file — plan §G's CP1+CP2 file list names `model`/`engine`/`select`/
 * `store`/`constants` tests only; this file has no logic of its own to test beyond what
 * `store.test.ts` already exercises (`dispatch`/`getState`/`subscribe`), and hook
 * rendering would need `jsdom`/`@testing-library/react`, which M3.3 does not add
 * (CP2 brief: "Do NOT add ... another dependency").
 */
export interface UseSessionResult {
  session: CookingSession | null
  open(model: CookingModel, planKey: string): OpenResult
  start(model: CookingModel, planKey: string, recipeTitle?: string): DispatchResult
  startNode(model: CookingModel, nodeId: string): DispatchResult
  markDone(model: CookingModel, nodeId: string): DispatchResult
  acknowledge(model: CookingModel): DispatchResult
  skip(model: CookingModel, nodeId: string): DispatchResult
  extend(model: CookingModel, nodeId: string): DispatchResult
  undo(model: CookingModel): DispatchResult
  leave(model: CookingModel): DispatchResult
  resume(model: CookingModel): DispatchResult
  touch(): DispatchResult
  end(): DispatchResult
}

export function useSession(store: SessionStore): UseSessionResult {
  const session = useSyncExternalStore(store.subscribe, store.getState)

  const dispatch = useCallback((action: SessionAction) => store.dispatch(action), [store])

  const open = useCallback((model: CookingModel, planKey: string) => store.open(model, planKey, Date.now()), [store])
  const start = useCallback(
    (model: CookingModel, planKey: string, recipeTitle?: string) =>
      dispatch({ type: 'start', model, planKey, now: Date.now(), recipeTitle }),
    [dispatch],
  )
  const startNode = useCallback(
    (model: CookingModel, nodeId: string) => dispatch({ type: 'startNode', model, nodeId, now: Date.now() }),
    [dispatch],
  )
  const markDone = useCallback(
    (model: CookingModel, nodeId: string) => dispatch({ type: 'markDone', model, nodeId, now: Date.now() }),
    [dispatch],
  )
  const acknowledge = useCallback(
    (model: CookingModel) => dispatch({ type: 'acknowledge', model, now: Date.now() }),
    [dispatch],
  )
  const skip = useCallback(
    (model: CookingModel, nodeId: string) => dispatch({ type: 'skip', model, nodeId, now: Date.now() }),
    [dispatch],
  )
  const extend = useCallback(
    (model: CookingModel, nodeId: string) => dispatch({ type: 'extend', model, nodeId, now: Date.now() }),
    [dispatch],
  )
  const undo = useCallback((model: CookingModel) => dispatch({ type: 'undo', model, now: Date.now() }), [dispatch])
  const leave = useCallback((model: CookingModel) => dispatch({ type: 'leave', model, now: Date.now() }), [dispatch])
  const resume = useCallback((model: CookingModel) => dispatch({ type: 'resume', model, now: Date.now() }), [dispatch])
  const touch = useCallback(() => dispatch({ type: 'touch', now: Date.now() }), [dispatch])
  const end = useCallback(() => dispatch({ type: 'end', now: Date.now() }), [dispatch])

  return { session, open, start, startNode, markDone, acknowledge, skip, extend, undo, leave, resume, touch, end }
}
