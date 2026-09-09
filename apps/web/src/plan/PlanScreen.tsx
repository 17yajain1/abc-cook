import { useState } from 'react'

import type { RenderPlan } from './derive'
import { IngredientsPanel } from './IngredientsPanel'
import { RecipeHeader } from './RecipeHeader'
import { StageCard } from './StageCard'

type Tab = 'plan' | 'ingredients'

export function PlanScreen({
  plan,
  onPickAnother,
}: {
  plan: RenderPlan
  onPickAnother: () => void
}) {
  const [tab, setTab] = useState<Tab>('plan')

  // `relative` matters: the CTA below is absolutely positioned, and without a positioned
  // ancestor it resolved against the viewport and escaped the 390px column at any wider
  // width. Invisible at exactly 390px, which is why M2 shipped it.
  return (
    <div className="relative flex h-full flex-col bg-paper">
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

      <div className="no-scrollbar flex-1 overflow-y-auto pb-28">
        {plan.warnings.length > 0 && (
          <div className="mx-5 mt-4 border-l-2 border-ink bg-paper-sunk px-3 py-2 text-[13px] text-ink-2">
            {plan.warnings.map((w) => (
              <p key={w}>{sentence(w)}</p>
            ))}
          </div>
        )}

        {tab === 'plan' ? (
          <div className="px-5 pt-6">
            {plan.stages.map((stage, i) => (
              <StageCard
                key={stage.stageId}
                stage={stage}
                position={i + 1}
                isLast={i === plan.stages.length - 1}
                defaultExpanded
              />
            ))}

            {plan.savedMin === 0 && (
              <p className="pb-4 pt-2 text-[13px] text-ink-3">
                Nothing in this recipe cooks unattended — there's no prep to slot in
                while you wait.
              </p>
            )}
          </div>
        ) : (
          <IngredientsPanel groups={plan.ingredientGroups} />
        )}
      </div>

      <div className="absolute bottom-0 left-0 right-0 border-t border-rule bg-paper px-5 pb-6 pt-4">
        {/* Disabled, so deliberately not signal — a dead control must not wear the
            colour reserved for the live one. M3 turns this signal when it works. */}
        <button
          type="button"
          disabled
          className="w-full cursor-not-allowed rounded-control border border-rule bg-paper-sunk py-3.5 text-center text-[18px] font-semibold text-ink-3"
        >
          Start Cooking (coming in M3)
        </button>
      </div>
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

/** "uses 2 burners" -> "Uses 2 burners". */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
