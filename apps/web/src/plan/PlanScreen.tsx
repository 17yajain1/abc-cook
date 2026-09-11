import { useState } from 'react'

import { MapView } from '@/map/MapView'
import type { MapLayout } from '@/map/layout'

import type { RenderPlan } from './derive'
import { IngredientsPanel } from './IngredientsPanel'
import { RecipeHeader } from './RecipeHeader'
import { StageCard } from './StageCard'

type Tab = 'plan' | 'ingredients'
/**
 * Plan/Map is a mode switch inside the Cooking Plan tab, not a third top-level tab —
 * both views stay, neither replaces the other (`DESIGN_SYSTEM.md` § The Map grammar,
 * "Entry point"). `Plan` is the permanent default when a recipe opens.
 */
type Mode = 'plan' | 'map'

export function PlanScreen({
  plan,
  map,
  onPickAnother,
}: {
  plan: RenderPlan
  map: MapLayout
  onPickAnother: () => void
}) {
  const [tab, setTab] = useState<Tab>('plan')
  const [mode, setMode] = useState<Mode>('plan')
  const showingMap = tab === 'plan' && mode === 'map'

  // `relative` matters: the CTA below is absolutely positioned, and without a positioned
  // ancestor it resolved against the viewport and escaped the 390px column at any wider
  // width. Invisible at exactly 390px, which is why M2 shipped it.
  // `overflow-x-clip`: nothing bleeds past the content box any more (the wait-window
  // panel is fully contained in its stage's own body), but the clip stays as a guard
  // against a sub-390px viewport.
  return (
    <div className="relative flex h-full flex-col overflow-x-clip bg-paper">
      <RecipeHeader plan={plan} />

      <div className="flex flex-shrink-0 items-stretch gap-5 border-b border-rule px-5">
        <TabButton active={tab === 'plan'} onClick={() => setTab('plan')}>
          Cooking Plan
        </TabButton>
        <TabButton active={tab === 'ingredients'} onClick={() => setTab('ingredients')}>
          Ingredients
        </TabButton>
        <button
          type="button"
          onClick={onPickAnother}
          className="ml-auto self-center text-[13px] text-ink-3 underline underline-offset-4"
        >
          change recipe
        </button>
      </div>

      {tab === 'plan' && (
        <div className="flex flex-shrink-0 items-stretch gap-4 px-5 pt-2.5">
          <ModeButton active={mode === 'plan'} onClick={() => setMode('plan')}>
            Plan
          </ModeButton>
          <ModeButton active={mode === 'map'} onClick={() => setMode('map')}>
            Map
          </ModeButton>
        </div>
      )}

      <div className={`no-scrollbar flex-1 overflow-y-auto ${showingMap ? '' : 'pb-56'}`}>
        {plan.warnings.length > 0 && (
          <div className="mx-5 mt-4 border-l-2 border-ink bg-paper-sunk px-3 py-2 text-[13px] text-ink-2">
            {plan.warnings.map((w) => (
              <p key={w}>{sentence(w)}</p>
            ))}
          </div>
        )}

        {tab === 'ingredients' ? (
          <IngredientsPanel groups={plan.ingredientGroups} />
        ) : mode === 'map' ? (
          <div className="pt-4">
            <MapView layout={map} />
          </div>
        ) : (
          <div className="px-5 pt-6">
            {plan.stages.map((stage) => (
              <StageCard key={stage.stageId} stage={stage} defaultExpanded />
            ))}

            {plan.savedMin === 0 && (
              <p className="pb-4 pt-2 text-[13px] text-ink-3">
                Nothing in this recipe cooks unattended — there's no prep to slot in
                while you wait.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Hidden in Map mode — the mock draws no CTA there. z-20 keeps this fixed footer
          above the scrolled plan content beneath it. */}
      {!showingMap && (
        <div className="absolute bottom-0 left-0 right-0 z-20 border-t border-rule bg-paper px-5 pb-6 pt-4">
          {/* Signal, and the label is just "Start Cooking" (DESIGN_SYSTEM.md § PrimaryCTA).
              It does nothing until M3 — that limitation lives in the person-test caveat,
              not on the button — so it is aria-disabled with no handler rather than a
              greyed `disabled`, which would dim the one signal mark on the screen. */}
          <button
            type="button"
            aria-disabled="true"
            className="flex h-[52px] w-full cursor-default items-center justify-center rounded-control bg-signal text-[18px] font-semibold text-paper"
          >
            Start Cooking
          </button>
        </div>
      )}
    </div>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 pb-2.5 pt-1 text-[15px] font-medium ${
        active ? 'border-ink text-ink' : 'border-transparent text-ink-3'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * `Plan · Map` — same underline idiom as `TabButton`, smaller and inset, so it reads as
 * a mode within the Cooking Plan tab rather than a sibling of it. No pill, no
 * segmented-control chrome (`DESIGN_SYSTEM.md` § Avoid generated-design tells).
 */
function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px border-b-2 pb-1.5 text-[13px] font-medium ${
        active ? 'border-ink text-ink' : 'border-transparent text-ink-3'
      }`}
    >
      {children}
    </button>
  )
}

/** "uses 2 burners" -> "Uses 2 burners". */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
