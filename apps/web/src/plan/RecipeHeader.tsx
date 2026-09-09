import { formatMinutes } from '@/lib/duration'

import type { RenderPlan } from './derive'

/**
 * The top of the Plan view. A printed masthead, not a hero: the M2 radial gradient was
 * decoration, and it ended in a hard horizontal seam wherever the header's box stopped.
 *
 * The saved-time line is deliberately *not* signal. `docs/DESIGN_SYSTEM.md` rations
 * signal to the critical path and the single primary action, and on the Plan view that
 * is the CTA alone. This claim earns its weight typographically instead — colouring the
 * number alone would also be the "accent one word in a headline" tell.
 */
export function RecipeHeader({ plan }: { plan: RenderPlan }) {
  return (
    <header className="flex-shrink-0 px-5 pb-4 pt-7">
      <h1 className="condensed text-[30px] font-semibold leading-[1.05] text-ink">
        {plan.title}
      </h1>
      {plan.cuisine && <p className="mt-1 text-[15px] text-ink-2">{plan.cuisine}</p>}

      <div className="tabular mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px] font-medium text-ink-3">
        <span>
          {plan.servings} {plan.servings === 1 ? 'serving' : 'servings'}
        </span>
        <span>{formatMinutes(plan.totalMin)} total</span>
      </div>

      {plan.savedMin > 0 && (
        <p className="mt-4 text-[18px] font-semibold leading-snug text-ink">
          This plan saves you{' '}
          <span className="tabular">{formatMinutes(plan.savedMin)}</span> by prepping
          while things cook.
        </p>
      )}
    </header>
  )
}
