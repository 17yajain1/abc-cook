import { Fragment, useState } from 'react'

import type { ImportMeta } from '@abc-cook/schema'

import { useHomeSurface } from '@/shell/useHomeSurface'

import type { RenderIngredientGroup, RenderPlan, RenderWaitRow } from './derive'
import { IngredientsPanel } from './IngredientsPanel'
import { RecipeHeader, type SaveControl } from './RecipeHeader'
import { StageCard } from './StageCard'
import { WaitRow } from './WaitRow'

/** A6: at most one calm line under the header, never a warning dump. Degraded takes
 * priority over review-recommended — a simplified plan is the bigger thing to know. */
export function statusLineFor(importMeta: ImportMeta | null | undefined): string | null {
  if (!importMeta) return null
  if (importMeta.degraded) return 'Plan simplified — steps run one after another.'
  if (importMeta.review_recommended) return 'Some timings are estimates.'
  return null
}

/** M3.2: toggles one stage id in an expansion set, leaving every other id untouched. */
export function toggleStageSet(expanded: ReadonlySet<string>, stageId: string): Set<string> {
  const next = new Set(expanded)
  if (next.has(stageId)) next.delete(stageId)
  else next.add(stageId)
  return next
}

/** The N in the `Ingredients N` tab: every ingredient the plan lists, across groups. */
export function ingredientCount(groups: readonly RenderIngredientGroup[]): number {
  return groups.reduce((n, g) => n + g.items.length, 0)
}

type Tab = 'plan' | 'ingredients'

/**
 * The recipe page. One tab row, `Plan · Ingredients N`. The Map mode was removed from
 * this page on 2026-10-13 (`docs/GRAPH_VIEW.md`); `src/map/` stays, unused, until a
 * later clean-up PR.
 */
export function PlanScreen({
  plan,
  onPickAnother,
  onStartCooking,
  save,
  importMeta,
}: {
  plan: RenderPlan
  onPickAnother: () => void
  onStartCooking: () => void
  save?: SaveControl
  importMeta?: ImportMeta | null
}) {
  const [tab, setTab] = useState<Tab>('plan')
  const statusLine = statusLineFor(importMeta)
  // R1: the recipe page is a Home-register screen (DESIGN_SYSTEM.md § Register: Home and
  // browse screens), so the page behind it takes the Home ground too.
  useHomeSurface(true)

  // M3.2: overview-first — every card starts collapsed, and each opens on its own.
  // P1 #5: keyed by `stage.key` (the run), not `stage.stageId` — a stage rendered as
  // more than one card (plan §D) expands each card independently.
  const [expandedStages, setExpandedStages] = useState<Set<string>>(() => new Set())
  const toggleStage = (key: string) => setExpandedStages((prev) => toggleStageSet(prev, key))

  const nIngredients = ingredientCount(plan.ingredientGroups)

  const waitRowsAfter = new Map<number, RenderWaitRow[]>()
  for (const row of plan.waitRows) {
    const bucket = waitRowsAfter.get(row.afterStageIndex) ?? []
    bucket.push(row)
    waitRowsAfter.set(row.afterStageIndex, bucket)
  }

  // `relative` matters: the CTA below is absolutely positioned, and without a positioned
  // ancestor it resolved against the viewport and escaped the 390px column at any wider
  // width. Invisible at exactly 390px, which is why M2 shipped it.
  // `overflow-x-clip`: nothing bleeds past the content box any more (the wait-window
  // panel is fully contained in its stage's own body), but the clip stays as a guard
  // against a sub-390px viewport.
  return (
    <div className="relative flex h-full flex-col overflow-x-clip bg-home-ground text-home-ink">
      <RecipeHeader plan={plan} save={save} importMeta={importMeta} />
      {statusLine && <p className="px-5 pb-2 text-[13px] text-home-ink-2">{statusLine}</p>}

      <div className="flex flex-shrink-0 items-stretch gap-5 border-b border-home-rule px-5">
        <TabButton active={tab === 'plan'} onClick={() => setTab('plan')}>
          Plan
        </TabButton>
        <TabButton active={tab === 'ingredients'} onClick={() => setTab('ingredients')}>
          Ingredients <span className="tabular">{nIngredients}</span>
        </TabButton>
        <button
          type="button"
          onClick={onPickAnother}
          className="ml-auto self-center text-[13px] text-home-ink-2 underline underline-offset-4"
        >
          change recipe
        </button>
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto pb-56">
        {plan.warnings.length > 0 && (
          <div className="mx-5 mt-4 rounded-home-mini bg-home-thumb px-3 py-2 text-[13px] text-home-ink-2">
            {plan.warnings.map((w) => (
              <p key={w}>{sentence(w)}</p>
            ))}
          </div>
        )}

        {tab === 'ingredients' ? (
          <IngredientsPanel groups={plan.ingredientGroups} />
        ) : (
          <div className="px-5 pt-6">
            {(waitRowsAfter.get(-1) ?? []).map((row, i) => (
              <WaitRow key={`wait-pre-${i}`} row={row} />
            ))}
            {plan.stages.map((stage, index) => (
              <Fragment key={stage.key}>
                <StageCard
                  stage={stage}
                  expanded={expandedStages.has(stage.key)}
                  onToggle={() => toggleStage(stage.key)}
                />
                {(waitRowsAfter.get(index) ?? []).map((row, i) => (
                  <WaitRow key={`wait-${index}-${i}`} row={row} />
                ))}
              </Fragment>
            ))}

            {plan.savedMin === 0 && (
              <p className="pb-4 pt-2 text-[13px] text-home-ink-2">
                {plan.hasUnattendedWork
                  ? "This recipe has long, hands-off waits — but nothing else in the plan can be done during them."
                  : "Nothing in this recipe cooks unattended — there's no prep to slot in while you wait."}
              </p>
            )}
          </div>
        )}
      </div>

      {/* z-20 keeps this fixed footer above the scrolled plan content beneath it. */}
      <div className="absolute bottom-0 left-0 right-0 z-20 border-t border-home-rule bg-home-ground px-5 pb-6 pt-4">
        {/* Terracotta pill, the Home register's primary action (R1; was signal in the Plan
            register). Sentence case: Home bans Title Case. M3.4: wired to Cooking Mode. */}
        <button
          type="button"
          onClick={onStartCooking}
          className="flex h-[52px] w-full items-center justify-center rounded-full bg-home-terracotta text-[18px] font-bold text-home-ground"
        >
          Start cooking
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
        active ? 'border-home-ink text-home-ink' : 'border-transparent text-home-ink-2'
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
