/**
 * Resolves a conflicting session's `planKey` to a navigable target, or reports that it
 * cannot be resolved (CP1b of the M3.4.5 session-lockout plan). Pure and App-agnostic —
 * takes a `hasLibraryEntry` predicate instead of the real `Library`, so it is testable
 * without `localStorage`/jsdom and without constructing an `App.tsx` instance. The
 * caller (`App.tsx`) does the actual navigation/fetch; this module only decides *what
 * kind* of navigation applies, reusing the two resolution paths the app already has —
 * the library store and `fetchPlan` — and inventing neither a third path nor a fallback
 * route for anything else.
 *
 * `server:<id>` is always reported resolvable: `fetchPlan` (`@/api/client`) is an
 * existing, already-used resolution path for that `planKey` form, so per the CP1b brief
 * ("use an existing repository fetch/resolution path ONLY... if no existing server
 * resolver exists, treat server:<id> as unresolved") it is never hidden up front. A
 * fetch that fails at click time is handled by the app's existing error screen — the
 * same one `openRecipe` already falls back to — never a fabricated destination.
 *
 * `library:<id>` is resolvable only when `hasLibraryEntry(id)` says the entry still
 * exists — checked synchronously, unlike `server:`, because the library is already
 * in memory (no network round trip needed to know).
 *
 * `import:<graphId>` (and anything else) is never resolvable: an unsaved import has no
 * durable address to navigate back to (M3.4 CP2 investigation §1 — a fresh import's
 * `graph.id` is a random UUID nothing else is keyed to). This is also CP1b's own
 * explicit boundary: import: identity is CP1c's concern, not this one's.
 */
export type ConflictTarget =
  | { kind: 'library'; id: string }
  | { kind: 'server'; recipeId: string }
  | { kind: 'unresolved' }

const LIBRARY_PREFIX = 'library:'
const SERVER_PREFIX = 'server:'

export function resolveConflictTarget(planKey: string, hasLibraryEntry: (id: string) => boolean): ConflictTarget {
  if (planKey.startsWith(LIBRARY_PREFIX)) {
    const id = planKey.slice(LIBRARY_PREFIX.length)
    return hasLibraryEntry(id) ? { kind: 'library', id } : { kind: 'unresolved' }
  }
  if (planKey.startsWith(SERVER_PREFIX)) {
    return { kind: 'server', recipeId: planKey.slice(SERVER_PREFIX.length) }
  }
  return { kind: 'unresolved' }
}

/** Whether `resolveConflictTarget` would offer a "Go to" destination for `planKey` —
 * the predicate `buildConflictView` (`viewModel.ts`) takes to decide whether its
 * `goTo` action is present at all. */
export function canResolveConflictTarget(planKey: string, hasLibraryEntry: (id: string) => boolean): boolean {
  return resolveConflictTarget(planKey, hasLibraryEntry).kind !== 'unresolved'
}
