import type { ImportMeta, ImportOriginal, RecipePlanResponse, ReprocessResponse, SavedRecipe } from '@abc-cook/schema'

import { ApiError } from '@/api/client'
import type { ServerVersion } from '@/api/serverVersion'
import type { CookingSession } from '@/cooking/types'

import { feedOrigin, reimportable, sessionBlocksRefresh, stalenessOf, type FeedMatch } from './staleness'
import type { Library } from './store'

/**
 * What opening a saved recipe does about staleness (spec B4/B4a). The decision is pure
 * and its effects are injected, so the whole table runs under Vitest. `App` only
 * renders the outcome.
 *
 * It never deletes anything and never makes an LLM call: the only network calls are
 * `/health` and `/recipes/reprocess`, both free, under one shared time budget.
 */

/** One budget per open for `/health` + `/reprocess` together, so the user never waits
 * longer than this for a plan that is already on the device. */
export const OPEN_BUDGET_MS = 3000

/** The line shown on the recipe page, or none. `reimport` is only set when a URL exists
 * to prefill. */
export type Marker = { kind: 'stale'; reimport: boolean } | { kind: 'unchecked' } | null

export type OpenOutcome = { recipe: SavedRecipe; marker: Marker } | { missing: true }

export interface OpenDeps {
  library: Pick<Library, 'get' | 'refresh'>
  serverVersion: ServerVersion
  reprocess: (original: ImportOriginal, signal: AbortSignal) => Promise<ReprocessResponse>
  /** Lazy: loads the feed chunk only when an entry with no `original` needs it. */
  findInFeed: (sourceKey: string) => Promise<{ payload: RecipePlanResponse; postprocessVersion: number } | null>
  getSession: () => CookingSession | null
  /** Ends the stored session only if it belongs to library entry `id`. Emits no metric. */
  endSessionIfFor: (id: string) => void
  now: () => number
  budgetMs?: number
}

/** The synchronous part: either the plan can open right now, or an async check is
 * needed. `ready` covers a missing entry, a cook in progress (opens unchanged, no
 * marker), and a stamp already known to be current. */
export function openSavedNow(deps: OpenDeps, id: string): OpenOutcome | null {
  const recipe = deps.library.get(id)
  if (!recipe) return { missing: true }
  if (sessionBlocksRefresh(deps.getSession(), id, deps.now())) return { recipe, marker: null }
  const known = deps.serverVersion.peek()
  const stamp = recipe.postprocess_version ?? null
  if (stamp != null && known != null && stamp >= known) return { recipe, marker: null }
  return null
}

/** The asynchronous part, run when `openSavedNow` returned `null`. Never rejects. */
export async function openSavedChecked(deps: OpenDeps, id: string): Promise<OpenOutcome> {
  const recipe = deps.library.get(id)
  if (!recipe) return { missing: true }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.budgetMs ?? OPEN_BUDGET_MS)
  try {
    return await check(deps, recipe, controller.signal)
  } finally {
    clearTimeout(timer)
  }
}

async function check(deps: OpenDeps, recipe: SavedRecipe, signal: AbortSignal): Promise<OpenOutcome> {
  const stamp = recipe.postprocess_version ?? null

  // Local lookups first: they need no network, and they let an entry with nothing to
  // replay be judged without `/health` (a null stamp is stale by definition).
  let match: { payload: RecipePlanResponse; postprocessVersion: number } | null = null
  if (recipe.original == null) {
    try {
      match = await deps.findInFeed(recipe.source_key)
    } catch {
      match = null
    }
  }
  const lookup = (key: string): FeedMatch | null =>
    match && key === recipe.source_key ? { postprocessVersion: match.postprocessVersion } : null

  const needsServer = !(stamp == null && recipe.original == null && match == null)
  const version = needsServer ? await deps.serverVersion.get(signal) : null

  const staleness = stalenessOf(recipe, version, lookup)
  const unchecked: OpenOutcome = { recipe, marker: { kind: 'unchecked' } }
  const stale = (): OpenOutcome => ({
    recipe,
    marker: { kind: 'stale', reimport: reimportable(recipe, feedOrigin(recipe, lookup)) },
  })

  switch (staleness) {
    case 'current':
      return { recipe, marker: null }

    case 'needs_reimport':
      return stale()

    case 'unknown':
      return unchecked

    case 'feed_replaceable': {
      if (!match) return unchecked
      deps.endSessionIfFor(recipe.id)
      const done = deps.library.refresh(recipe.id, {
        payload: match.payload,
        import_meta: null,
        postprocess_version: match.postprocessVersion,
      })
      return done.ok ? { recipe: done.recipe, marker: null } : unchecked
    }

    case 'refreshable': {
      if (recipe.original == null) return unchecked
      let response: ReprocessResponse
      try {
        response = await deps.reprocess(recipe.original, signal)
      } catch (err) {
        // A 422 means the stored original no longer validates: that is a stale plan we
        // can't fix, not a failed check. Everything else (offline, timeout, 5xx) is
        // "couldn't check", and nothing is written.
        return err instanceof ApiError && err.status === 422 ? stale() : unchecked
      }
      deps.serverVersion.note(response.postprocess_version)
      deps.endSessionIfFor(recipe.id)
      const done = deps.library.refresh(recipe.id, {
        payload: response.payload,
        import_meta: response.import_meta as ImportMeta,
        postprocess_version: response.postprocess_version,
      })
      return done.ok ? { recipe: done.recipe, marker: null } : unchecked
    }
  }
}
