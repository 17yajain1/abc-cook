import type { FeedFilter, FeedItem } from './types'

/** Items matching the filter with `filterId`; an unknown id matches everything (the
 * feed must never go blank because a chip id went stale). Order is preserved. */
export function applyFilter(items: readonly FeedItem[], filters: readonly FeedFilter[], filterId: string): FeedItem[] {
  const filter = filters.find((f) => f.id === filterId)
  return filter ? items.filter(filter.matches) : [...items]
}
