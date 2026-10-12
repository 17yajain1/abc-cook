import { describe, expect, it } from 'vitest'

import { canonicalSourceKey } from '@/library/sourceKey'
import { createLibrary, type StorageLike } from '@/library/store'

import { applyFilter } from './filter'
import { formatAgo, formatSaves, formatSavesAgo } from './format'
import { createMockFeedSource, MOCK_FILTERS } from './mock'
import { isSaved, saveFromFeed } from './saveFromFeed'
import type { FeedItem } from './types'

const NOW = Date.parse('2026-10-12T12:00:00Z')
const source = createMockFeedSource(() => NOW)

function memoryStorage(): StorageLike {
  const data = new Map<string, string>()
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

describe('applyFilter', () => {
  it('All keeps everything in order; an unknown id also keeps everything', async () => {
    const all = await source.list('all')
    expect(applyFilter(all, MOCK_FILTERS, 'all').map((i) => i.id)).toEqual(all.map((i) => i.id))
    expect(applyFilter(all, MOCK_FILTERS, 'nope')).toHaveLength(all.length)
  })
  it('Under 30 min uses the source threshold on the scheduler total', async () => {
    const under = await source.list('under30')
    expect(under.length).toBeGreaterThan(0)
    expect(under.every((i) => i.totalMin < 30)).toBe(true)
  })
  it('Veg keeps only veg items', async () => {
    const veg = await source.list('veg')
    expect(veg.length).toBeGreaterThan(0)
    expect(veg.every((i) => i.diet === 'veg')).toBe(true)
  })
})

describe('format', () => {
  it('formats saves', () => {
    expect(formatSaves(1)).toBe('1 save')
    expect(formatSaves(412)).toBe('412 saves')
    expect(formatSaves(1240)).toBe('1.2k saves')
    expect(formatSaves(2000)).toBe('2k saves')
    expect(formatSaves(18_400)).toBe('18.4k saves')
  })
  it('formats age against an injected now', () => {
    const ago = (ms: number) => new Date(NOW - ms).toISOString()
    expect(formatAgo(ago(10_000), NOW)).toBe('just now')
    expect(formatAgo(ago(5 * 60_000), NOW)).toBe('5m ago')
    expect(formatAgo(ago(2 * 3_600_000), NOW)).toBe('2h ago')
    expect(formatAgo(ago(3 * 86_400_000), NOW)).toBe('3d ago')
    expect(formatAgo(ago(21 * 86_400_000), NOW)).toBe('3w ago')
    expect(formatAgo(ago(-5000), NOW)).toBe('just now')
    expect(formatSavesAgo(1240, ago(2 * 3_600_000), NOW)).toBe('1.2k saves, 2h ago')
  })
})

describe('mock source', () => {
  it('has unique ids and the four required layout cases', async () => {
    const items = await source.list('all')
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
    expect(items.some((i) => i.platform === 'youtube' && i.thumbnail)).toBe(true) // 16:9
    expect(items.some((i) => i.platform === 'instagram' && i.thumbnail)).toBe(true) // 9:16 reel
    expect(items.some((i) => i.thumbnail == null)).toBe(true) // no image
    expect(items.some((i) => i.creator.handle.length > 40)).toBe(true) // long handle
  })
  it('takes totalMin from the fixture plan, never its own number', async () => {
    for (const item of await source.list('all')) {
      const payload = await source.getPlan(item.id)
      expect(item.totalMin).toBe(payload.plan.total_min)
      expect(item.title).toBe(payload.graph.title)
    }
  })
  it("getPlan's canonical source key equals the item's", async () => {
    for (const item of await source.list('all')) {
      const payload = await source.getPlan(item.id)
      expect(canonicalSourceKey(payload.graph.source)).toBe(item.sourceKey)
    }
  })
})

describe('saveFromFeed', () => {
  async function firstItem(): Promise<FeedItem> {
    return (await source.list('all'))[0]
  }

  it('saving twice leaves one library entry', async () => {
    const library = createLibrary(memoryStorage())
    const item = await firstItem()
    expect((await saveFromFeed(library, source, item))?.ok).toBe(true)
    expect(await saveFromFeed(library, source, item)).toBeNull()
    expect(library.list()).toHaveLength(1)
  })
  it('derives the saved state from findBySource, not a separate flag', async () => {
    const library = createLibrary(memoryStorage())
    const item = await firstItem()
    expect(isSaved(library, item)).toBe(false)
    await saveFromFeed(library, source, item)
    expect(isSaved(library, item)).toBe(true)
    expect(library.findBySource(item.sourceKey)?.payload.graph.title).toBe(item.title)
  })
})
