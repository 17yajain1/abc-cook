import type { PlanAheadCard as PlanAheadCardData } from './cookOutline'

/** R2: the plan-ahead card — the one fact a multi-stretch recipe must not bury: start well
 * before you eat. Copy is built in `cookOutline.ts`; ink on peach, no signal colour. */
export function PlanAheadCard({ card }: { card: PlanAheadCardData }) {
  return (
    <div className="mt-4 rounded-home-mini border border-home-peach-rule bg-home-peach px-4 py-3">
      <p className="text-balance text-[15px] font-bold leading-[1.3] text-home-ink">{card.title}</p>
      <p className="tabular mt-0.5 text-[13px] text-home-ink-2">{card.body}</p>
    </div>
  )
}
