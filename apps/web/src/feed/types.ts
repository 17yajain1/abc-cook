/**
 * The public-recipes feed's view types.
 *
 * TEMPORARY, and deliberately **not** a mirror of a Pydantic model — none exists yet. H2
 * defines the feed model in Pydantic and replaces these with the generated type; per the
 * ROADMAP rule, no hand-written mirror survives past H1. Until then the feed reads through
 * `FeedSource`, which H1 backs with a mock and H2 backs with the API.
 */
import type { RecipePlanResponse } from '@abc-cook/schema'

export type FeedPlatform = 'youtube' | 'instagram' | 'web' | 'text'

export interface FeedItem {
  id: string
  /** `canonicalSourceKey` of the item's source — the de-dup identity shared with the
   * library, so "is it saved?" is a `library.findBySource` lookup. */
  sourceKey: string
  title: string
  platform: FeedPlatform
  creator: { handle: string; url: string | null }
  /** `null` renders the fallback: the dish name on peach, never an icon. */
  thumbnail: { src: string } | null
  /** Scheduler output (`plan.total_min`), never computed by the feed. */
  totalMin: number
  diet: 'veg' | 'non_veg' | null
  cuisine: string | null
  saves: number
  /** ISO timestamp. */
  publishedAt: string
}

export interface FeedFilter {
  id: string
  label: string
  /** Chips are the one place emoji is allowed on Home. */
  emoji: string | null
  matches: (item: FeedItem) => boolean
}

export interface FeedSource {
  filters(): FeedFilter[]
  list(filterId: string): Promise<FeedItem[]>
  /** The full plan for an item, ready for `PlanScreen`. */
  getPlan(itemId: string): Promise<RecipePlanResponse>
}
