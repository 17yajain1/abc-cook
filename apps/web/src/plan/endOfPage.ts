import type { ImportOriginal } from '@abc-cook/schema'

import type { Library, RemoveResult } from '@/library/store'
import { sourceLink } from '@/lib/source'

/**
 * R5: what the end of the recipe page says, and what Remove does. Pure: no clock read, no
 * storage of its own (`removeSavedRecipe` only calls what it is handed). The page is a
 * renderer of these results (`EndOfPage.tsx`).
 */

/** The copy table (docs/plans/r5-end-of-page.md). "Cookbook", never "Library". */
export const END_OF_PAGE_COPY = {
  heading: 'Where this came from',
  pastedText: 'Pasted text',
  showWritten: 'Show the recipe as written',
  hideWritten: 'Hide the recipe as written',
  showAll: 'Show all',
  remove: 'Remove from Cookbook',
  confirmRemove: 'Remove',
  keep: 'Keep it',
  removeFailed: "Couldn't remove it. Try again.",
} as const

const CONFIRM_LINE = "Remove this recipe from your Cookbook? To get it back you'd copy it again."
const CONFIRM_COOK = 'Your cook in progress ends too.'

export interface EndOfPageBlock {
  platformLine: string
  /** The pasted recipe, as written; null for everything that is not a paste. */
  paste: string | null
}

/**
 * "12 Oct", or "12 Oct 2025" when it is not `now`'s year, in the device's local time zone
 * (an explicit `timeZone` is for tests). `null` when `iso` is not a date.
 */
export function copiedDate(iso: string, now: Date, timeZone?: string): string | null {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const year = (d: Date) => new Intl.DateTimeFormat('en-GB', { year: 'numeric', timeZone }).format(d)
  const withYear = year(at) !== year(now)
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' as const } : {}),
    timeZone,
  }).format(at)
}

/**
 * The block under the plan (Q0): shown only when it has something the header lacks, a copied
 * date (the recipe has a saved entry) or a paste. An unsaved link import, and a recipe that
 * never went through the app's import, show nothing.
 *
 * The paste is keyed on `original.source.kind === 'text'`, never on `graph.source`: a
 * hand-authored fixture also has a text source, and a link import's `source_text` is
 * grounding text, not the recipe as written.
 */
export function endOfPageFor(args: {
  /** The saved entry's `saved_at`, or null when the recipe has no saved entry. */
  savedAt: string | null
  source: { kind: string; value: string }
  original: ImportOriginal | null
  now: Date
  timeZone?: string
}): EndOfPageBlock | null {
  const { savedAt, source, original, now, timeZone } = args
  const paste = original?.source.kind === 'text' ? original.source_text : null
  const date = savedAt != null ? copiedDate(savedAt, now, timeZone) : null

  if (paste != null) {
    return {
      platformLine: date != null ? `${END_OF_PAGE_COPY.pastedText} · copied ${date}` : END_OF_PAGE_COPY.pastedText,
      paste,
    }
  }
  if (date == null) return null

  const platform = source.kind === 'url' ? sourceLink(source.value)?.name : null
  return { platformLine: platform ? `${platform} · copied ${date}` : `Copied ${date}`, paste: null }
}

/**
 * Is the stored cook on this recipe? Its key is `library:<entryId>`, or `import:<graphId>`
 * when the cook started before the recipe was saved (the key does not change on Save).
 * The confirm line and the removal both use this one rule.
 */
export function cookOnRecipe(
  session: { planKey: string } | null,
  entryId: string | null,
  graphId: string,
): boolean {
  if (session == null) return false
  return (entryId != null && session.planKey === `library:${entryId}`) || session.planKey === `import:${graphId}`
}

export function removeConfirmLine(cookInProgress: boolean): string {
  return cookInProgress ? `${CONFIRM_LINE} ${CONFIRM_COOK}` : CONFIRM_LINE
}

/** The session store as Remove needs it. `SessionStore` satisfies this. */
export interface EndableSessions {
  getState(): { planKey: string } | null
  dispatch(action: { type: 'end'; now: number }): unknown
}

/**
 * Removes entry `entryId`, then ends the cook on it, if there is one (no metric: removing a
 * recipe is not finishing it). If the write fails nothing else happens, so a cook is never
 * ended for a recipe that is still saved.
 */
export function removeSavedRecipe(args: {
  library: Pick<Library, 'remove'>
  sessions: EndableSessions
  entryId: string
  graphId: string
  now: number
}): RemoveResult {
  const { library, sessions, entryId, graphId, now } = args
  const result = library.remove(entryId)
  if (!result.ok) return result
  if (cookOnRecipe(sessions.getState(), entryId, graphId)) sessions.dispatch({ type: 'end', now })
  return result
}
