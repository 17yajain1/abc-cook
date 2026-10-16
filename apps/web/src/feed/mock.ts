/**
 * H1's stand-in for the public feed. Loaded only through dynamic `import()` when the feed
 * flag is on (`DiscoverSection`), so these fixtures never enter the default bundle.
 *
 * What is real: `title` and `cuisine` (the fixture graph's own) and `totalMin` (the
 * scheduler's `plan.total_min`). Everything marked `FAKE (mock only)` is invented to
 * exercise the layout — including the source URL, which `getPlan` writes onto the plan so
 * its `canonicalSourceKey` equals the item's `sourceKey`.
 */
import type { RecipePlanResponse, SourceRef } from '@abc-cook/schema'

import biryani from '@/__fixtures__/chicken-biryani.plan-response.json'
import donuts from '@/__fixtures__/homemade-donuts.plan-response.json'
import kadai from '@/__fixtures__/kadai-paneer.plan-response.json'
import maggi from '@/__fixtures__/maggi-2min.plan-response.json'
import pizza from '@/__fixtures__/pizza-dough.plan-response.json'
import shortcake from '@/__fixtures__/strawberry-shortcake.plan-response.json'
import twoSittings from '@/__fixtures__/synthetic-two-sittings.plan-response.json'
import twoWindows from '@/__fixtures__/synthetic-two-windows.plan-response.json'
import stamp from '@/__fixtures__/postprocess-version.json'
import { canonicalSourceKey } from '@/library/sourceKey'

import { applyFilter } from './filter'
import photo43 from './mock-assets/photo-4x3.svg'
import reel916 from './mock-assets/reel-9x16.svg'
import youtube169 from './mock-assets/youtube-16x9.svg'
import type { FeedFilter, FeedItem, FeedPlatform, FeedSource } from './types'

/** The Under-30 threshold lives here, in the source's filter data, never in a component. */
const UNDER_MINUTES = 30

export const MOCK_FILTERS: FeedFilter[] = [
  { id: 'all', label: 'All', emoji: null, matches: () => true },
  { id: 'under30', label: 'Under 30 min', emoji: null, matches: (i) => i.totalMin < UNDER_MINUTES },
  { id: 'veg', label: 'Veg', emoji: null, matches: (i) => i.diet === 'veg' },
  { id: 'indian', label: 'Indian', emoji: null, matches: (i) => /indian|hyderabadi/i.test(i.cuisine ?? '') },
]

interface Entry {
  id: string
  fixture: RecipePlanResponse
  platform: FeedPlatform
  source: SourceRef
  thumbnail: string | null
  // FAKE (mock only) from here on
  handle: string
  diet: FeedItem['diet']
  saves: number
  hoursAgo: number
}

const HOUR = 3_600_000
const imported_at = '2026-10-01T00:00:00Z'
const yt = (id: string): SourceRef => ({ kind: 'url', value: `https://www.youtube.com/watch?v=${id}`, imported_at })
const ig = (code: string): SourceRef => ({ kind: 'url', value: `https://www.instagram.com/reel/${code}/`, imported_at })
const web = (slug: string): SourceRef => ({ kind: 'url', value: `https://recipes.example.test/${slug}`, imported_at })

const ENTRIES: Entry[] = [
  // 16:9 YouTube thumbnail with big burned-in text.
  { id: 'mock-kadai', fixture: kadai as RecipePlanResponse, platform: 'youtube', source: yt('MOCKkadai01'), thumbnail: youtube169, handle: '@rasoi.with.ritu', diet: 'veg', saves: 1240, hoursAgo: 2 },
  // 9:16 reel cover.
  { id: 'mock-biryani', fixture: biryani as RecipePlanResponse, platform: 'instagram', source: ig('MOCKbiryani'), thumbnail: reel916, handle: '@hyderabad.kitchen', diet: 'non_veg', saves: 860, hoursAgo: 5 },
  // No image at all: the dish name on peach.
  { id: 'mock-donuts', fixture: donuts as RecipePlanResponse, platform: 'web', source: web('glazed-donuts'), thumbnail: null, handle: '@bakery.notes', diet: 'veg', saves: 312, hoursAgo: 26 },
  // Very long creator handle.
  { id: 'mock-maggi', fixture: maggi as RecipePlanResponse, platform: 'web', source: web('two-minute-maggi'), thumbnail: photo43, handle: '@the.extraordinarily.long.creator.handle.for.late.night.noodles', diet: 'veg', saves: 9, hoursAgo: 1 },
  { id: 'mock-shortcake', fixture: shortcake as RecipePlanResponse, platform: 'instagram', source: ig('MOCKshortck'), thumbnail: photo43, handle: '@sweet.tooth.diaries', diet: 'veg', saves: 2050, hoursAgo: 72 },
  { id: 'mock-pizza', fixture: pizza as RecipePlanResponse, platform: 'youtube', source: yt('MOCKpizza01'), thumbnail: youtube169, handle: '@doughboy', diet: 'veg', saves: 640, hoursAgo: 190 },
  { id: 'mock-lentil', fixture: twoWindows as RecipePlanResponse, platform: 'web', source: web('spiced-lentil-rice-bowl'), thumbnail: null, handle: '@weeknight.bowls', diet: 'veg', saves: 1, hoursAgo: 8 },
  { id: 'mock-rajma', fixture: twoSittings as RecipePlanResponse, platform: 'youtube', source: yt('MOCKrajma01'), thumbnail: reel916, handle: '@dhaba.at.home', diet: 'veg', saves: 18_400, hoursAgo: 340 },
]

function toItem(e: Entry, now: number): FeedItem {
  return {
    id: e.id,
    sourceKey: canonicalSourceKey(e.source),
    title: e.fixture.graph.title,
    platform: e.platform,
    creator: { handle: e.handle, url: null },
    thumbnail: e.thumbnail ? { src: e.thumbnail } : null,
    totalMin: e.fixture.plan.total_min,
    diet: e.diet,
    cuisine: e.fixture.graph.cuisine ?? null,
    saves: e.saves,
    publishedAt: new Date(now - e.hoursAgo * HOUR).toISOString(),
  }
}

/** A fresh copy of the fixture with the entry's fake source written on, so its
 * `canonicalSourceKey` equals the item's `sourceKey`. */
function planFor(entry: Entry): RecipePlanResponse {
  const payload = structuredClone(entry.fixture)
  payload.graph.source = entry.source
  return payload
}

export function createMockFeedSource(now: () => number = Date.now): FeedSource {
  const items = ENTRIES.map((e) => toItem(e, now()))
  return {
    filters: () => MOCK_FILTERS,
    list: (filterId) => Promise.resolve(applyFilter(items, MOCK_FILTERS, filterId)),
    getPlan: (itemId) => {
      const entry = ENTRIES.find((e) => e.id === itemId)
      if (!entry) return Promise.reject(new Error(`No mock feed item ${itemId}`))
      return Promise.resolve(planFor(entry))
    },
    findBySourceKey: (sourceKey) => {
      const entry = ENTRIES.find((e) => canonicalSourceKey(e.source) === sourceKey)
      if (!entry) return Promise.resolve(null)
      return Promise.resolve({ payload: planFor(entry), postprocessVersion: stamp.postprocess_version })
    },
  }
}
