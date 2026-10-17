import type { SavedRecipe } from '@abc-cook/schema'

import { canonicalUrlSourceKey } from '../library/sourceKey'
import { instantPreviewFor, type InstantPreview } from './instantPreview'

/** Looks a saved entry up by its canonical source key (`Library.findBySource`). */
export type FindSaved = (sourceKey: string) => SavedRecipe | undefined

/**
 * The saved recipe a pasted URL would just re-import, if any. Matches on the same
 * canonical key `library.save` dedups on, so every spelling of one source (watch, shorts,
 * youtu.be, a `si=` share link, a blog URL with `utm_` parameters) finds the same entry.
 * An unparseable URL has no key, so it never matches. URLs only: a pasted text is the
 * user's own and is not checked.
 */
export function savedMatchFor(url: string, findBySource: FindSaved): SavedRecipe | undefined {
  const key = canonicalUrlSourceKey(url.trim())
  return key == null ? undefined : findBySource(key)
}

export type SubmitPlan =
  | { kind: 'duplicate'; saved: SavedRecipe }
  | { kind: 'import'; instant: InstantPreview | null }

/**
 * What a URL submit does, in its one fixed order: (1) the duplicate check, then (2) the
 * instant header, then (3) the network call. A duplicate carries no `instant`, so nothing
 * is shown, fetched or started for it. `skipDuplicateCheck` is set by Re-import and
 * Import again, which exist precisely to import a source that is already saved.
 */
export function submitPlan(
  url: string,
  options: { findSaved?: FindSaved; skipDuplicateCheck?: boolean },
): SubmitPlan {
  if (options.findSaved && !options.skipDuplicateCheck) {
    const saved = savedMatchFor(url, options.findSaved)
    if (saved) return { kind: 'duplicate', saved }
  }
  return { kind: 'import', instant: instantPreviewFor(url) }
}
