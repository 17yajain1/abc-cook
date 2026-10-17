import type { ImportMeta } from '@abc-cook/schema'

import { formatMinutes } from '@/lib/duration'
import { servingsLine } from '@/lib/servings'
import { sourceLink } from '@/lib/source'

import { BackButton } from './BackButton'
import { AlreadySavedNotice, type AlreadySaved } from './AlreadySavedNotice'
import { headerMeta } from './headerMeta'
import { CookOutlineView } from './CookOutlineView'
import { PlanAheadCard } from './PlanAheadCard'
import type { RenderPlan } from './derive'
import type { StalenessMarker } from './staleness'
import { StalenessNotice } from './StalenessNotice'

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
export function RecipeHeader({
  plan,
  save,
  importMeta,
  onBack,
  staleness,
  alreadySaved,
}: {
  plan: RenderPlan
  save?: SaveControl
  /** R1: the top-left back control. */
  onBack: () => void
  /** For the legacy-defaulted-servings gap only (`lib/servings.ts`) — absent for a
   * fixture recipe (never went through `/import`), same as `PlanScreen`'s own prop. */
  importMeta?: ImportMeta | null
  /** The saved plan may be out of date: shown directly under the title. */
  staleness?: StalenessMarker
  /** A pasted link matched this saved recipe: "Already in your Cookbook" + Import again. */
  alreadySaved?: AlreadySaved
}) {
    const servings = servingsLine(plan.servingsSource, importMeta)
  const source = sourceLink(plan.sourceUrl)
  const card = plan.outline?.card ?? null
  const timing = headerMeta(plan.summary, plan.totalMin, card != null)

  return (
    <header className="flex-shrink-0 px-5 pb-4 pt-[calc(12px+var(--safe-top))]">
      {/* Back top-left, Save top-right, so the title below gets the full width. */}
      <div className="-ml-2 mb-3 flex items-center justify-between gap-3">
        <BackButton onClick={onBack} circled />
        {save && <SaveButton save={save} />}
      </div>
      <h1 className="text-[30px] font-bold leading-[34px] tracking-[-0.5px] text-home-ink">
        {plan.title}
      </h1>
      {staleness && <StalenessNotice marker={staleness} />}
      {/* One action never shows twice: the stale marker's Re-import wins over Import again. */}
      {alreadySaved && !staleness?.onReimport && <AlreadySavedNotice alreadySaved={alreadySaved} />}
      {source && (
        <a
          href={source.href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 inline-block text-[13px] font-medium text-home-ink-2 underline underline-offset-2"
        >
          From {source.name} ↗
        </a>
      )}
      {plan.cuisine && <p className="mt-1 text-[15px] text-home-ink-2">{plan.cuisine}</p>}

      <div className="tabular mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-[13px] font-medium text-home-ink-2">
        {servings && <span>{servings}</span>}
        {timing.primary && <span>{timing.primary}</span>}
      </div>
      {timing.secondary && <p className="mt-0.5 text-[13px] text-home-ink-2">{timing.secondary}</p>}
      {/* R2: the plan-ahead card replaces the multi-sitting "Start about … before you eat". */}
      {card && <PlanAheadCard card={card} />}

      {plan.outline && <CookOutlineView outline={plan.outline} />}

      {/* R2: the outline's pill replaces this sentence; plans without phases keep it. */}
      {!plan.outline && plan.savedMin > 0 && (
        <p className="mt-4 text-[18px] font-bold leading-snug text-home-ink">
          This plan saves you{' '}
          <span className="tabular">{formatMinutes(plan.savedMin)}</span> by prepping
          while things cook.
        </p>
      )}

      {save?.status === 'error' && save.message && (
        <p className="mt-3 text-[13px] text-home-terracotta-text">{save.message}</p>
      )}
    </header>
  )
}

function SaveButton({ save }: { save: SaveControl }) {
  if (save.status === 'saved') {
    return (
      <span className="flex-shrink-0 text-[13px] font-medium text-home-ink-2">Saved</span>
    )
  }

  return (
    <button
      type="button"
      onClick={save.onSave}
      className="flex-shrink-0 rounded-full border border-home-rule bg-home-surface px-4 py-2 text-[13px] font-semibold text-home-ink active:bg-home-thumb"
    >
      {save.existing ? 'Update saved copy' : 'Save'}
    </button>
  )
}
