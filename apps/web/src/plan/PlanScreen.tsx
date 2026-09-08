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

  return (
    <div className="flex h-full flex-col bg-ground">
      <RecipeHeader plan={plan} />

      <div className="flex flex-shrink-0 items-center gap-2 border-b border-line px-5 pb-2">
        <TabButton active={tab === 'plan'} onClick={() => setTab('plan')}>
          Cooking Plan
        </TabButton>
        <TabButton active={tab === 'ingredients'} onClick={() => setTab('ingredients')}>
          Ingredients
        </TabButton>
        <button
          type="button"
          onClick={onPickAnother}
          className="ml-auto text-xs text-ink-dim underline underline-offset-2"
        >
          change recipe
        </button>
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto pb-28">
        {plan.warnings.length > 0 && (
          <div className="mx-5 mt-4 rounded-xl border border-line-strong bg-surface-raised px-3 py-2 text-xs text-ink-muted">
            {plan.warnings.map((w) => (
              <p key={w}>{sentence(w)}</p>
            ))}
          </div>
        )}

        {tab === 'plan' ? (
          <div className="px-5 pt-5">
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
              <p className="pb-4 pt-2 text-center text-xs text-ink-dim">
                Nothing in this recipe cooks unattended — there's no prep to slot in
                while you wait.
              </p>
            )}
          </div>
        ) : (
          <IngredientsPanel groups={plan.ingredientGroups} />
        )}
      </div>

      <div
        className="absolute bottom-0 left-0 right-0 px-5 pb-6 pt-4"
        style={{ background: 'linear-gradient(to top, var(--color-ground) 72%, transparent)' }}
      >
        <button
          type="button"
          disabled
          className="w-full cursor-not-allowed rounded-2xl bg-surface-raised py-4 text-center text-base font-bold text-ink-dim"
        >
          Start Cooking · coming in M3
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
      className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${
        active ? 'bg-saffron text-ground' : 'text-ink-muted'
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
