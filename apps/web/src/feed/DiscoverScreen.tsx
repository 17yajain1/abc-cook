import { useState } from 'react'

import { DISCOVER } from '@/home/copy'
import { ArrowLeftIcon, GridViewIcon, ListViewIcon } from '@/home/icons'

import { FeedCard } from './FeedCard'
import { FeedRow } from './FeedRow'
import { FilterChips } from './FilterChips'
import type { Feed } from './useFeed'

type ViewMode = 'card' | 'list'

/** See all: the whole feed with a card / list toggle. The bottom nav stays (the shell owns
 * it); back returns to Home. */
export function DiscoverScreen({ feed, onBack }: { feed: Feed; onBack: () => void }) {
  const [mode, setMode] = useState<ViewMode>('card')

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto home-page px-5 [&>*]:shrink-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onBack}
            aria-label={DISCOVER.back}
            className="-ml-2 flex h-11 w-11 items-center justify-center text-[24px]"
          >
            <ArrowLeftIcon />
          </button>
          <h1 className="text-[22px] font-bold leading-[26px] tracking-[-0.3px]">{DISCOVER.title}</h1>
        </div>
        <div className="flex rounded-full border border-home-rule bg-home-surface p-1">
          <ModeButton label={DISCOVER.cardView} active={mode === 'card'} onClick={() => setMode('card')}>
            <GridViewIcon />
          </ModeButton>
          <ModeButton label={DISCOVER.listView} active={mode === 'list'} onClick={() => setMode('list')}>
            <ListViewIcon />
          </ModeButton>
        </div>
      </div>
      <FilterChips filters={feed.filters} value={feed.filterId} onChange={feed.setFilterId} />
      {feed.items == null ? null : feed.items.length === 0 ? (
        <p className="py-6 text-[15px] text-home-ink-2">{DISCOVER.empty}</p>
      ) : mode === 'card' ? (
        <div className="flex flex-col gap-3">
          {feed.items.map((item) => (
            <FeedCard
              key={item.id}
              item={item}
              saved={feed.isSaved(item)}
              now={feed.now}
              layout="full"
              onOpen={() => feed.open(item)}
              onSave={() => feed.save(item)}
            />
          ))}
        </div>
      ) : (
        <ul>
          {feed.items.map((item) => (
            <FeedRow
              key={item.id}
              item={item}
              saved={feed.isSaved(item)}
              now={feed.now}
              onOpen={() => feed.open(item)}
              onSave={() => feed.save(item)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function ModeButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`flex h-10 w-11 items-center justify-center rounded-full text-[20px] ${
        active ? 'bg-home-ink text-home-ground' : 'text-home-ink-2'
      }`}
    >
      {children}
    </button>
  )
}
