import { CheckIcon, PlusIcon } from '@/home/icons'

import { CreatorRow, MetaRow } from './FeedMeta'
import { formatSaves, formatSavesAgo } from './format'
import { RecipeThumb } from './RecipeThumb'
import type { FeedItem } from './types'

/** The save control: a 32px circle inside a 44×44 tap target. `+` when not in the Cookbook,
 * a terracotta check once it is (derived by the caller from `library.findBySource`). */
export function SaveControl({ item, saved, onSave }: { item: FeedItem; saved: boolean; onSave: () => void }) {
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={saved}
      aria-label={saved ? `${item.title} is in your cookbook` : `Add ${item.title} to cookbook`}
      className="flex h-11 w-11 items-center justify-center"
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-full text-[18px] ${
          saved ? 'bg-home-terracotta text-home-ground' : 'bg-home-surface text-home-terracotta-text'
        }`}
      >
        {saved ? <CheckIcon /> : <PlusIcon />}
      </span>
    </button>
  )
}

/**
 * A recipe card. `grid` is the Home two-column card (169px wide at 390); `full` is the
 * See all card view. Tapping the card opens the recipe's Cooking Plan; the save control
 * sits over the thumbnail's corner and is its own button.
 */
export function FeedCard({
  item,
  saved,
  now,
  layout,
  onOpen,
  onSave,
}: {
  item: FeedItem
  saved: boolean
  now: number
  layout: 'grid' | 'full'
  onOpen: () => void
  onSave: () => void
}) {
  const full = layout === 'full'
  return (
    <article className="relative overflow-hidden rounded-home-card border border-home-rule bg-home-surface">
      <button type="button" onClick={onOpen} className="block w-full text-left" aria-label={item.title}>
        <RecipeThumb item={item} variant="card" />
        <div className={`flex flex-col gap-1.5 ${full ? 'px-3.5 pb-3.5 pt-3' : 'px-3 pb-3 pt-2.5'}`}>
          <h3
            className={`font-bold ${full ? 'text-[18px] leading-[22px]' : 'line-clamp-2 text-[15px] font-semibold leading-[19px]'}`}
          >
            {item.title}
          </h3>
          <MetaRow item={item} />
          <CreatorRow
            item={item}
            trailing={full ? formatSavesAgo(item.saves, item.publishedAt, now) : formatSaves(item.saves)}
          />
        </div>
      </button>
      <div className="absolute right-1 top-1">
        <SaveControl item={item} saved={saved} onSave={onSave} />
      </div>
    </article>
  )
}
