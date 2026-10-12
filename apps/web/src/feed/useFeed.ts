import { useCallback, useEffect, useState } from 'react'

import type { RecipePlanResponse } from '@abc-cook/schema'

import type { Library } from '@/library/store'

import { isSaved, saveFromFeed } from './saveFromFeed'
import { loadFeedSource } from './source'
import type { FeedFilter, FeedItem, FeedSource } from './types'

export interface Feed {
  filters: FeedFilter[]
  filterId: string
  setFilterId: (id: string) => void
  /** `null` while loading. */
  items: FeedItem[] | null
  now: number
  isSaved: (item: FeedItem) => boolean
  save: (item: FeedItem) => void
  open: (item: FeedItem) => void
}

/**
 * Loads the feed source once (only when `enabled`), then the items for the current filter.
 * Saved state is read from the library on every render (`isSaved`); a save just bumps a
 * counter so that read happens again.
 */
export function useFeed(
  enabled: boolean,
  library: Library,
  onOpenPlan: (payload: RecipePlanResponse) => void,
): Feed | null {
  const [source, setSource] = useState<FeedSource | null>(null)
  const [filterId, setFilterId] = useState('all')
  const [items, setItems] = useState<FeedItem[] | null>(null)
  const [, bump] = useState(0)

  useEffect(() => {
    if (!enabled) return
    let live = true
    void loadFeedSource().then((s) => live && setSource(s))
    return () => {
      live = false
    }
  }, [enabled])

  useEffect(() => {
    if (!source) return
    let live = true
    void source.list(filterId).then((list) => live && setItems(list))
    return () => {
      live = false
    }
  }, [source, filterId])

  const save = useCallback(
    (item: FeedItem) => {
      if (!source) return
      void saveFromFeed(library, source, item)
        .then(() => bump((n) => n + 1))
        .catch(() => {})
    },
    [source, library],
  )

  const open = useCallback(
    (item: FeedItem) => {
      if (!source) return
      void source.getPlan(item.id).then(onOpenPlan).catch(() => {})
    },
    [source, onOpenPlan],
  )

  if (!enabled || !source) return null
  return {
    filters: source.filters(),
    filterId,
    setFilterId,
    items,
    now: Date.now(),
    isSaved: (item) => isSaved(library, item),
    save,
    open,
  }
}
