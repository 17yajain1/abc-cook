import { useEffect, useRef, useState } from 'react'

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

  // The Map's entry animation plays once per recipe, not on every Plan<->Map toggle
  // (`DESIGN_SYSTEM.md` § Map entry animation) — replaying it on every glance would
  // fight the app's own "fast answer, wet hands" premise. A ref (not state) is the
  // right boundary, for two reasons:
  // 1. Lifecycle: App.tsx never transitions directly between two `{kind:'plan'}`
  //    views — every recipe change passes through `loading` first, a different
  //    component at the same JSX slot, which unmounts this PlanScreen and gives the
  //    next recipe a fresh instance (and a fresh ref). Toggling `mode` only re-renders
  //    this same instance, so the ref survives exactly across the toggles it should
  //    and resets exactly when the recipe does.
  // 2. Correctness under a `useState` alternative was tried and is actively wrong:
  //    flipping state right after the animated mount commits re-renders this same,
  //    still-mounted `MapView` instance mid-animation with `skipEntryAnimation=true`,
  //    which strips the animation classes off already-animating elements and snaps
  //    every card straight to full opacity almost instantly — defeating the animation
  //    on the one mount it's supposed to play on. A ref's mutation triggers no
  //    re-render, so flipping it immediately after mount is inert until PlanScreen
  //    re-renders for some other reason (the next toggle) — which is exactly what's
  //    needed here. This is a deliberate exception to "don't read refs during render":
  //    that guidance protects against stale reads because a ref's mutation won't
  //    trigger a re-render — which is precisely the property this relies on, not a
  //    hazard to avoid. (Read at the JSX call site below, with the lint suppression.)
  const hasAnimatedMapRef = useRef(false)
  useEffect(() => {
    if (mode === 'map') hasAnimatedMapRef.current = true
  }, [mode])

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
            {/* eslint-disable-next-line react-hooks/refs -- deliberate: see the ref's
                declaration comment above for why a state re-render here would break
                the animation it's supposed to gate. */}
            <MapView layout={map} skipEntryAnimation={hasAnimatedMapRef.current} />
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
