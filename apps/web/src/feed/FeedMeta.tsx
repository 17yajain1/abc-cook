import { ClockIcon } from '@/home/icons'
import { formatMinutes } from '@/lib/duration'

import type { FeedItem } from './types'

/** `🕐 40 min [veg mark]` — the time is the scheduler's total (`item.totalMin`). */
export function MetaRow({ item }: { item: FeedItem }) {
  return (
    <div className="flex items-center gap-1.5 text-[12px] text-home-ink-2">
      <ClockIcon className="text-[14px]" />
      <span className="tabular">{formatMinutes(item.totalMin)}</span>
      {item.diet && <DietMark diet={item.diet} />}
    </div>
  )
}

/** The fixed-colour veg / non-veg mark: a graphic with recognised colours, not text. */
function DietMark({ diet }: { diet: NonNullable<FeedItem['diet']> }) {
  const color = diet === 'veg' ? 'var(--color-home-veg)' : 'var(--color-home-nonveg)'
  return (
    <span
      role="img"
      aria-label={diet === 'veg' ? 'Vegetarian' : 'Non-vegetarian'}
      className="flex h-3 w-3 items-center justify-center rounded-[2px] border"
      style={{ borderColor: color }}
    >
      <span className="h-[5px] w-[5px] rounded-full" style={{ backgroundColor: color }} />
    </span>
  )
}

/** Handle on the left (truncates), saves on the right (never wraps). */
export function CreatorRow({ item, trailing }: { item: FeedItem; trailing: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[12px] text-home-ink-2">
      <span className="min-w-0 truncate">{item.creator.handle}</span>
      <span className="shrink-0 whitespace-nowrap">{trailing}</span>
    </div>
  )
}
