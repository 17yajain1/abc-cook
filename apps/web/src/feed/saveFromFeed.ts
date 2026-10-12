import type { ImportMeta } from '@abc-cook/schema'

import type { Library, SaveResult } from '@/library/store'

import type { FeedItem, FeedSource } from './types'

/** A feed plan never went through `/import` here, so there are no warnings to carry and
 * it is not degraded. */
export const NO_IMPORT_META: ImportMeta = {
  warnings: [],
  review_recommended: false,
  sources: [],
  provenance: null,
  degraded: false,
}

/** Whether the item is already in the Cookbook. Derived from the library every time —
 * never stored separately — so it can't drift from what's actually saved. */
export function isSaved(library: Pick<Library, 'findBySource'>, item: FeedItem): boolean {
  return library.findBySource(item.sourceKey) != null
}

/**
 * "Add to cookbook" from a feed card. No-op when already saved; otherwise fetches the
 * plan and saves it, which itself de-duplicates by `canonicalSourceKey`, so saving twice
 * can never leave two entries.
 */
export async function saveFromFeed(
  library: Pick<Library, 'findBySource' | 'save'>,
  source: Pick<FeedSource, 'getPlan'>,
  item: FeedItem,
): Promise<SaveResult | null> {
  if (isSaved(library, item)) return null
  const payload = await source.getPlan(item.id)
  return library.save(payload, null)
}
