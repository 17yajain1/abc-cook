import type { SavedRecipe } from '@abc-cook/schema'

import type { CookingSession, NodeState } from '@/cooking/types'

/**
 * Is a saved recipe's stored plan current, refreshable for free, or honestly marked?
 * Pure: no storage, no network, no clock (callers pass `now`). The spec is
 * `docs/plans/fix-saved-recipe-staleness.md` B3/B4a; this file only decides, the open
 * path in `App.tsx` acts.
 */

export type Staleness = 'current' | 'refreshable' | 'feed_replaceable' | 'needs_reimport' | 'unknown'

/** A feed entry for a saved recipe's source key. The payload is fetched separately. */
export interface FeedMatch {
  postprocessVersion: number
}

export type FeedLookup = (sourceKey: string) => FeedMatch | null

/** How recently a session must have been touched to count as "the cook is in progress".
 * Inside this window a refresh never replaces the plan the cook is following. */
export const ACTIVE_SESSION_MS = 24 * 60 * 60 * 1000

/**
 * Classifies `recipe` against the server's `POSTPROCESS_VERSION` (`null` = not known).
 *
 * Rules, in order:
 * 1. Stamp set, server version set, stamp >= server: `current` (a newer stamp is never
 *    downgraded).
 * 2. Has `original`: `refreshable`, or `unknown` while the server version is unknown.
 * 3. No `original`, feed has this source: `feed_replaceable` when the feed bundle is at
 *    the server's version, `unknown` while it isn't known, else `needs_reimport`.
 * 4. No `original`, no feed match: `needs_reimport`. Decided offline: a null stamp is
 *    stale by definition and an older stamp with nothing to replay can't be refreshed.
 */
export function stalenessOf(recipe: SavedRecipe, serverVersion: number | null, feedLookup: FeedLookup): Staleness {
  const stamp = recipe.postprocess_version ?? null
  if (stamp != null && serverVersion != null && stamp >= serverVersion) return 'current'

  if (recipe.original != null) return serverVersion != null ? 'refreshable' : 'unknown'

  const match = feedLookup(recipe.source_key)
  if (match) {
    if (serverVersion == null) return 'unknown'
    return match.postprocessVersion === serverVersion ? 'feed_replaceable' : 'needs_reimport'
  }
  return 'needs_reimport'
}

/** A recipe saved from the feed: no `import_meta`, or the feed still lists its source
 * (the header-save path stored a non-null placeholder before it was fixed forward). */
export function feedOrigin(recipe: SavedRecipe, feedLookup: FeedLookup): boolean {
  return recipe.import_meta == null || feedLookup(recipe.source_key) != null
}

/** Re-import needs a URL to prefill. Text and image sources get the marker only. */
export function reimportable(recipe: SavedRecipe, isFeedOrigin: boolean): boolean {
  return !isFeedOrigin && recipe.payload.graph.source.kind === 'url'
}

/** The latest of every timestamp a session carries. `lastSeenAt` alone isn't enough:
 * marking a step done never touches it. */
export function activityAt(session: CookingSession): number {
  let latest = Math.max(session.lastSeenAt, session.startedAt, session.finishedAt ?? 0, session.lastTransition?.at ?? 0)
  for (const node of Object.values(session.nodes)) latest = Math.max(latest, nodeTimestamp(node))
  return latest
}

function nodeTimestamp(node: NodeState): number {
  switch (node.state) {
    case 'pending':
      return 0
    case 'deferred':
      return node.at
    case 'running':
      return Math.max(node.startedAt, node.endsAt)
    case 'done':
      return node.at
  }
}

/**
 * Whether a refresh of entry `id` must leave it alone because a cook is in progress on
 * it: the stored session is for this entry and either has a timer still running or was
 * active within `ACTIVE_SESSION_MS`. A finished-but-unconfirmed session counts like any
 * other, so it blocks while recent and is ended silently after that.
 */
export function sessionBlocksRefresh(session: CookingSession | null, id: string, now: number): boolean {
  if (session == null || session.planKey !== `library:${id}`) return false
  for (const node of Object.values(session.nodes)) {
    if (node.state === 'running' && node.endsAt > now) return true
  }
  return now - activityAt(session) < ACTIVE_SESSION_MS
}
