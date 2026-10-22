import type { Ref } from 'react'

import type { ImportMeta } from '@abc-cook/schema'

import { formatMinutes } from '@/lib/duration'
import { sourceLink } from '@/lib/source'

import { BackButton } from './BackButton'
import { AlreadySavedNotice, type AlreadySaved } from './AlreadySavedNotice'
import type { PanelServings } from './IngredientsPanel'
import { PlanAheadCard } from './PlanAheadCard'
import { RecipeFacts } from './RecipeFacts'
import { RecipeThumbnail } from './RecipeThumbnail'
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

/** D7: the Edit pill in the header. It shows until editing starts; the sticky bar then carries Done and the hint. */
export interface EditPill {
  editing: boolean
  onToggle: () => void
}

/**
 * The top of the recipe page (D7), a printed masthead rather than a hero: back, Saved or Save and the
 * Edit pill, then the picture, title, source line and the fact tiles.
 *
 * The saved-time claim is deliberately *not* signal. `docs/DESIGN_SYSTEM.md` rations signal to the
 * critical path and the single primary action, and on this page that is the CTA alone. Facts earn their
 * weight typographically in white tiles. The Save control follows the same rule: ink, bordered, never the
 * signal colour reserved for "Start cooking" (M2.12 design decision 4).
 */
export function RecipeHeader({
  plan,
  save,
  importMeta,
  onBack,
  staleness,
  alreadySaved,
  servings,
  statusLine,
  edit,
  titleRef,
}: {
  plan: RenderPlan
  save?: SaveControl
  /** The top-left back control. */
  onBack: () => void
  /** For the legacy-defaulted-servings gap only (`lib/servings.ts`) — absent for a
   * fixture recipe (never went through `/import`), same as `PlanScreen`'s own prop. */
  importMeta?: ImportMeta | null
  /** The saved plan may be out of date: shown directly under the title. */
  staleness?: StalenessMarker
  /** A pasted link matched this saved recipe: "Already in your Cookbook" + Import again. */
  alreadySaved?: AlreadySaved
  /** R4: the servings control, resolved for this page (the tile hosts it). */
  servings?: PanelServings
  /** A6 (FGC-16): the import-status line, under the tiles. Hidden while the staleness line shows, so the
   * two never compete for the slot. */
  statusLine?: string | null
  edit?: EditPill
  /** The title's element, for the compact bar's threshold. */
  titleRef?: Ref<HTMLHeadingElement>
}) {
  const source = sourceLink(plan.sourceUrl)
  const card = plan.outline?.card ?? null

  return (
    <header className="flex-shrink-0 px-5 pb-4 pt-[calc(12px+var(--safe-top))]">
      {/* Back top-left; Saved / Save and Edit top-right, so the picture and title get the full width. */}
      <div className="-ml-2 mb-3 flex items-center justify-between gap-3">
        <BackButton onClick={onBack} circled />
        <div className="flex items-center gap-2">
          {save && <SaveButton save={save} />}
          {/* While editing, the sticky bar's Done is the one way out, so the pill goes. */}
          {edit && !edit.editing && <EditButton edit={edit} />}
        </div>
      </div>
      <RecipeThumbnail sourceKey={plan.sourceKey} />
      <h1 ref={titleRef} className="text-[30px] font-extrabold leading-[1.1] tracking-[-0.3px] text-home-ink">
        {plan.title}
      </h1>
      {staleness && <StalenessNotice marker={staleness} />}
      {(plan.cuisine || source) && (
        <p className="mt-1.5 text-[14px] text-home-ink-2">
          {plan.cuisine}
          {plan.cuisine && source && ' · '}
          {source && (
            <a
              href={source.href}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              From {source.name} ↗
            </a>
          )}
        </p>
      )}

      <RecipeFacts plan={plan} importMeta={importMeta} servings={servings} hasCard={card != null} />
      {!staleness && statusLine && <p className="mt-2 text-[12px] leading-[1.4] text-home-ink-2">{statusLine}</p>}
      {/* One action never shows twice: the stale marker's Re-import wins over Import again. */}
      {alreadySaved && !staleness?.onReimport && <AlreadySavedNotice alreadySaved={alreadySaved} />}
      {/* R2: the plan-ahead card replaces the multi-sitting "Start about … before you eat". */}
      {card && <PlanAheadCard card={card} />}

      {/* A plan with no phases (saved before POSTPROCESS_VERSION 3) keeps its one-line saving. */}
      {!plan.outline && plan.savedMin > 0 && (
        <p className="mt-4 text-[18px] font-bold leading-snug text-home-ink">
          This plan saves you <span className="tabular">{formatMinutes(plan.savedMin)}</span> by prepping
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
    return <span className="flex-shrink-0 text-[13px] font-medium text-home-ink-2">Saved</span>
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

function EditButton({ edit }: { edit: EditPill }) {
  return (
    <button
      type="button"
      onClick={edit.onToggle}
      className="relative h-9 flex-shrink-0 rounded-full border border-home-rule bg-home-surface px-3.5 text-[14px] font-semibold text-home-ink after:absolute after:-inset-y-1 after:inset-x-0 after:content-['']"
    >
      Edit
    </button>
  )
}
