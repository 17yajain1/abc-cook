import { DISCOVER } from '@/home/copy'

import { FeedCard } from './FeedCard'
import { FilterChips } from './FilterChips'
import type { Feed } from './useFeed'

/** Home's feed block: title and See all, filter chips, then the two-column grid. Rendered
 * only when the feed flag is on; shows a skeleton until the first items arrive. */
export function DiscoverSection({ feed, onSeeAll }: { feed: Feed; onSeeAll: () => void }) {
  return (
    <section className="mt-3 flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[22px] font-bold leading-[26px] tracking-[-0.3px]">{DISCOVER.title}</h2>
        <button type="button" onClick={onSeeAll} className="h-11 text-[15px] font-semibold text-home-terracotta-text">
          {DISCOVER.seeAll}
        </button>
      </div>
      <FilterChips filters={feed.filters} value={feed.filterId} onChange={feed.setFilterId} />
      {feed.items == null ? (
        <FeedSkeleton />
      ) : feed.items.length === 0 ? (
        <p className="py-6 text-[15px] text-home-ink-2">{DISCOVER.empty}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {feed.items.map((item) => (
            <FeedCard
              key={item.id}
              item={item}
              saved={feed.isSaved(item)}
              now={feed.now}
              layout="grid"
              onOpen={() => feed.open(item)}
              onSave={() => feed.save(item)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function FeedSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3" aria-hidden="true">
      {[0, 1].map((i) => (
        <div key={i} className="overflow-hidden rounded-home-card border border-home-rule bg-home-surface">
          <div className="aspect-[4/3] bg-home-skeleton-1" />
          <div className="flex flex-col gap-2 px-3 pb-3 pt-2.5">
            <div className="h-3.5 w-4/5 rounded-full bg-home-skeleton-1" />
            <div className="h-3 w-1/2 rounded-full bg-home-skeleton-2" />
            <div className="h-3 w-3/4 rounded-full bg-home-skeleton-2" />
          </div>
        </div>
      ))}
    </div>
  )
}
