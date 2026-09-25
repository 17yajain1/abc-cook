import type { ImportMeta, RecipePlanResponse } from '@abc-cook/schema'

import { canonicalSourceKey } from '@/library/sourceKey'

/**
 * `planKey` identity (CP1c of the M3.4.5 session-lockout plan). Pure and App-agnostic —
 * takes a `findSavedEntry` predicate instead of the real `Library`, matching
 * `conflictResolve.ts`'s injection pattern (testable without `localStorage`/jsdom).
 *
 * The bug this fixes (M3.4.5 investigation): `App.tsx`'s old `planKey(origin)` gave a
 * fresh import `import:${payload.graph.id}` even after `onImported` had *already* saved
 * it to the library — `graph.id` is a random UUID minted per `POST /import` call (M3.4
 * CP2 investigation §1), unrelated to the library entry's own stable `id`. Reopening the
 * *same* saved recipe later through the Library screen produced `library:${id}` instead
 * — a different `planKey` string for the same recipe/session, which `engine.open()`
 * (`@/cooking/engine.ts`) reads as a *foreign* plan and reports `'conflict'`, locking the
 * cook out of their own in-progress session.
 *
 * The fix: for an `import` origin, look the payload's source up in the library (the
 * library's own existing dedup mechanism, `canonicalSourceKey` — never a second identity
 * system) before falling back to the transient `import:` form. A saved import then
 * resolves to the *same* `library:${id}` a library-opened copy of the same recipe would
 * — same planKey, same `graphId` (the payload is the same object either way, `graph.id`
 * included), so `engine.open()`'s own unmodified check reports `'ok'`, not `'conflict'`.
 *
 * What this deliberately does NOT touch: `engine.open()`'s `graphId` half is untouched,
 * so a *re-import* that produces a genuinely different graph (a new random `graph.id`,
 * even though the library entry keeps the same `id`) still reports `'conflict'` against
 * an active session started on the old graph — `planKey` matching alone was never
 * sufficient, and still isn't (plan CP1c boundary: "a genuinely new graph/version...
 * remains a separate case").
 */
export type PlanOrigin =
  | { kind: 'server'; recipeId: string }
  | { kind: 'import'; payload: RecipePlanResponse; importMeta: ImportMeta }
  | { kind: 'library'; id: string }

/** The library lookup `planKeyFor` needs — `Library['findBySource']`'s own signature,
 * narrowed to the one field (`id`) this module reads. */
export type FindSavedEntry = (sourceKey: string) => { id: string } | undefined

/** Uniquely identifies a plan's origin for `PlanScreen`'s `key` and for the cooking
 * session's `planKey` (`App.tsx`). An `import` origin whose source is already saved
 * resolves to that saved entry's stable `library:${id}` identity; an unsaved (or
 * save-failed) import falls back to its own transient `import:${graph.id}`, unchanged
 * from before CP1c — still never a "Go to" destination (`conflictResolve.ts`'s
 * `import:` rule is untouched by this module).
 */
export function planKeyFor(origin: PlanOrigin, findSavedEntry: FindSavedEntry): string {
  switch (origin.kind) {
    case 'server':
      return `server:${origin.recipeId}`
    case 'library':
      return `library:${origin.id}`
    case 'import': {
      const saved = findSavedEntry(canonicalSourceKey(origin.payload.graph.source))
      return saved ? `library:${saved.id}` : `import:${origin.payload.graph.id}`
    }
  }
}
