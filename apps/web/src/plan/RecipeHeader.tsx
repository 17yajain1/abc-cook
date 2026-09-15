import { formatMinutes } from '@/lib/duration'

import type { RenderPlan } from './derive'

/** M2.12: Save state for a Plan view opened from an import, or the static mark for one
 * opened from the library. Absent entirely for a fixture recipe (nothing to save). */
export interface SaveControl {
  status: 'idle' | 'saved' | 'error'
  /** Whether this source already has a saved entry — flips the idle button's label. */
  existing: boolean
  message?: string
  onSave: () => void
}

/**
 * The top of the Plan view. A printed masthead, not a hero: the M2 radial gradient was
 * decoration, and it ended in a hard horizontal seam wherever the header's box stopped.
 *
 * The saved-time line is deliberately *not* signal. `docs/DESIGN_SYSTEM.md` rations
 * signal to the critical path and the single primary action, and on the Plan view that
 * is the CTA alone. This claim earns its weight typographically instead — colouring the
 * number alone would also be the "accent one word in a headline" tell. The Save control
 * follows the same rule: ink, bordered, never the signal colour reserved for "Start
 * Cooking" (M2.12 design decision 4).
 */
export function RecipeHeader({ plan, save }: { plan: RenderPlan; save?: SaveControl }) {
  return (
    <header className="flex-shrink-0 px-5 pb-4 pt-7">
      <div className="flex items-start justify-between gap-3">
        <h1 className="condensed text-[30px] font-semibold leading-[1.05] text-ink">
          {plan.title}
        </h1>
        {save && <SaveButton save={save} />}
      </div>
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

      {save?.status === 'error' && save.message && (
        <p className="mt-3 text-[13px] text-signal">{save.message}</p>
      )}
    </header>
  )
}

function SaveButton({ save }: { save: SaveControl }) {
  if (save.status === 'saved') {
    return (
      <span className="flex-shrink-0 pt-1 text-[13px] font-medium text-ink-3">Saved</span>
    )
  }

  return (
    <button
      type="button"
      onClick={save.onSave}
      className="flex-shrink-0 rounded-control border border-ink-3 px-3 py-1.5 text-[13px] font-medium text-ink active:bg-paper-sunk"
    >
      {save.existing ? 'Update saved copy' : 'Save'}
    </button>
  )
}
