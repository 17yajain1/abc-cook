import { useState } from 'react'

import { plannerPhoto } from '@/assets/home'
import { PLANNER } from '@/home/copy'
import { CheckIcon } from '@/home/icons'

import { isOnWaitlist, joinWaitlist } from './waitlist'

/** Planner tab: the Meal Planner isn't built, so this is a promise and a Notify me. The
 * tap is only remembered on this device in H1 (see `waitlist.ts`). */
export function PlannerScreen() {
  const [noted, setNoted] = useState(() => isOnWaitlist())

  return (
    <div className="h-full overflow-y-auto px-5 pb-28 pt-16">
      <h1 className="text-[22px] font-bold leading-[26px] tracking-[-0.3px]">{PLANNER.screenTitle}</h1>
      <div className="mt-5 aspect-[350/263] overflow-hidden rounded-home-tile border border-home-sage-rule bg-home-sage">
        <img src={plannerPhoto} alt="" className="h-full w-full object-cover" />
      </div>
      <h2 className="mt-7 text-[30px] font-bold leading-[34px] tracking-[-0.5px]">{PLANNER.heading}</h2>
      <p className="mt-2 text-[15px] leading-[22px] text-home-ink-2">{PLANNER.body}</p>
      <button
        type="button"
        disabled={noted}
        onClick={() => {
          joinWaitlist()
          setNoted(true)
        }}
        className="mt-6 h-[52px] w-full rounded-full bg-home-terracotta text-[15px] font-semibold text-home-ground disabled:bg-[#f1e7de] disabled:text-[#8c7a6f]"
      >
        {noted ? PLANNER.noted : PLANNER.notify}
      </button>
      {noted && (
        <div className="mt-3 flex gap-3 rounded-home-card border border-home-sage-rule bg-home-sage p-4">
          <CheckIcon className="mt-0.5 shrink-0 text-[22px] text-home-sage-chip-text" />
          <div>
            <p className="text-[15px] font-semibold leading-[19px]">{PLANNER.notedTitle}</p>
            <p className="mt-0.5 text-[13px] leading-[18px] text-home-ink-2">{PLANNER.notedBody}</p>
          </div>
        </div>
      )}
    </div>
  )
}
