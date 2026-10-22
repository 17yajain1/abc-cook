import type { PlanAheadCard as PlanAheadCardData } from './cookOutline'

/**
 * R2: the plan-ahead card — the one fact a multi-stretch recipe must not bury: start well before you eat.
 * Copy is built in `cookOutline.ts`; ink on peach, no signal colour. D5: the same card carries the multitask
 * note ("One chance to multitask: ...") with a "See where" link to the Meanwhile block. When both apply it is
 * one card, the plan-ahead line first and the multitask line second, never two cards.
 */
export function PlanAheadCard({
  card,
  multitask,
}: {
  card: PlanAheadCardData | null
  multitask?: { text: string; onSeeWhere: () => void } | null
}) {
  if (!card && !multitask) return null
  return (
    <div className="mt-4 rounded-home-mini border border-home-peach-rule bg-home-peach px-4 py-3">
      {card && (
        <>
          <p className="text-balance text-[15px] font-bold leading-[1.3] text-home-ink">{card.title}</p>
          <p className="tabular mt-0.5 text-[13px] text-home-ink-2">{card.body}</p>
        </>
      )}
      {multitask && (
        <div className={card ? 'mt-3 border-t border-home-peach-rule pt-3' : ''}>
          <p className="text-balance text-[15px] font-bold leading-[1.3] text-home-ink">{multitask.text}</p>
          <button
            type="button"
            onClick={multitask.onSeeWhere}
            className="relative mt-0.5 text-[13px] font-medium text-home-ink-2 underline underline-offset-2 after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']"
          >
            See where ↓
          </button>
        </div>
      )}
    </div>
  )
}
