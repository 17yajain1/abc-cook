import { CreatorRow, MetaRow } from './FeedMeta'
import { SaveControl } from './FeedCard'
import { formatSavesAgo } from './format'
import { RecipeThumb } from './RecipeThumb'
import type { FeedItem } from './types'

/** List view row: the 72×72 thumbnail exception, a 1px rule between rows. */
export function FeedRow({
  item,
  saved,
  now,
  onOpen,
  onSave,
}: {
  item: FeedItem
  saved: boolean
  now: number
  onOpen: () => void
  onSave: () => void
}) {
  return (
    <li className="flex items-center gap-1 border-b border-home-rule py-3 last:border-b-0">
      <button type="button" onClick={onOpen} aria-label={item.title} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <RecipeThumb item={item} variant="row" />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="line-clamp-2 text-[15px] font-semibold leading-[19px]">{item.title}</h3>
          <MetaRow item={item} />
          <CreatorRow item={item} trailing={formatSavesAgo(item.saves, item.publishedAt, now)} />
        </div>
      </button>
      <SaveControl item={item} saved={saved} onSave={onSave} />
    </li>
  )
}
