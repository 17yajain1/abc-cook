import type { SavedRecipe } from '@abc-cook/schema'

import { canResolveConflictTarget } from '@/cooking-mode/conflictResolve'
import { deriveCookingModel } from '@/cooking/model'
import { foreignLifecycle, stepPosition, type StepPosition } from '@/cooking/select'
import type { CookingSession } from '@/cooking/types'

export interface ContinueInfo {
  planKey: string
  title: string
  /** The saved entry behind a `library:` key — its thumbnail source. */
  sourceKey: string | null
  /** `stale` sessions still block a new cook (`engine.open`), so Home shows them too, with
   * no step line or progress; Resume lands on the existing stale screen. */
  state: 'active' | 'stale'
  /** Only when the payload is on the device (a `library:` key). Never estimated for a
   * `server:` key, whose payload isn't loaded. */
  step: StepPosition | null
}

const LIBRARY_PREFIX = 'library:'

/**
 * What the Continue cooking strip shows, or null for no strip. Pure: the session store,
 * the clock and the library are passed in.
 *
 * Shown for an `active` or `stale` session (never finished, never a legacy session with no
 * `totalMin` snapshot) whose plan Resume can actually reach — an unsaved `import:` key has
 * nowhere to navigate to. A session the person explicitly left (`leftAt`) still counts.
 * Every figure comes from the existing selectors; nothing is computed here.
 */
export function selectContinue(
  session: CookingSession | null,
  now: number,
  libraryEntry: (id: string) => SavedRecipe | undefined,
): ContinueInfo | null {
  if (session == null) return null
  const state = foreignLifecycle(session, now)
  if (state !== 'active' && state !== 'stale') return null
  if (!canResolveConflictTarget(session.planKey, (id) => libraryEntry(id) != null)) return null

  const entry = session.planKey.startsWith(LIBRARY_PREFIX)
    ? libraryEntry(session.planKey.slice(LIBRARY_PREFIX.length))
    : undefined

  let step: StepPosition | null = null
  if (entry && state === 'active') {
    const position = stepPosition(deriveCookingModel(entry.payload), session)
    step = { n: Math.min(position.n, position.total), total: position.total }
  }

  return {
    planKey: session.planKey,
    state,
    title: session.recipeTitle ?? entry?.payload.graph.title ?? 'Your recipe',
    sourceKey: entry?.source_key ?? null,
    step,
  }
}
