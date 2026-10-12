import { plannerPhoto } from '@/assets/home'

import { TILES } from './copy'

/** Sage tile for the Meal Planner, which is not started: the chip says so. */
export function PlannerTile({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative h-[130px] overflow-hidden rounded-home-tile border border-home-sage-rule bg-home-sage px-4 py-3.5 text-left"
    >
      <img
        src={plannerPhoto}
        alt=""
        className="absolute -bottom-3 -right-3 h-[72px] w-[72px] rounded-full object-cover"
      />
      <h2 className="relative text-[18px] font-bold leading-[22px]">{TILES.plannerTitle}</h2>
      <p className="relative mt-1 max-w-[120px] text-[13px] leading-[17px] text-home-ink-2">{TILES.plannerSub}</p>
      <span className="absolute bottom-3 left-4 rounded-full bg-home-sage-accent px-3 py-1 text-[12px] font-semibold text-home-sage-chip-text">
        {TILES.comingSoon}
      </span>
    </button>
  )
}
