import { Fragment, useLayoutEffect, useRef, useState } from 'react'

import type { ImportMeta } from '@abc-cook/schema'

import { useHomeSurface } from '@/shell/useHomeSurface'

import { BackButton } from './BackButton'
import type { RenderIngredientGroup, RenderPlan, RenderWaitRow } from './derive'
import type { AlreadySaved } from './AlreadySavedNotice'
import { IngredientsPanel } from './IngredientsPanel'
import { RecipeHeader, type SaveControl } from './RecipeHeader'
import type { StalenessMarker } from './staleness'
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

/**
 * R1: whether the compact sticky bar should show. It takes over once the page's own tab
 * row has scrolled up to where the bar's copy of the tabs sits, so the tabs appear to
 * stay put while the full header scrolls away. Both offsets are measured from the top of
 * the scroll area (the bar's offset includes the phone's top safe-area inset).
 */
export function isCompactHeader(scrollTop: number, pageTabsTop: number, barTabsTop: number): boolean {
  return scrollTop > 0 && scrollTop >= pageTabsTop - barTabsTop
}

type Tab = 'plan' | 'ingredients'

/**
 * The recipe page (R1, Home register). One scroll area holds the full header, the
 * `Plan · Ingredients N` tab row and the tab's content. The Map mode was removed from
 * this page on 2026-10-13 (`docs/GRAPH_VIEW.md`); `src/map/` stays, unused, until a
 * later clean-up PR.
 *
 * The compact bar (back, title, tabs) is a second copy laid over the top of the scroll
 * area, rendered only while `isCompactHeader` says the page's own tabs have reached it.
 * Overlaying it rather than making the page's own header sticky means the content below
 * never jumps when the bar appears. It is mounted and unmounted, not faded with
 * opacity/visibility: on iOS Safari the faded-in bar painted its back arrow but not its
 * title text (R1, iPhone retest), and a freshly mounted element has nothing to repaint.
 * An empty, invisible spacer of the same height stays mounted so the threshold can
 * still be measured while the bar is absent.
 */
export function PlanScreen({
  plan,
  onBack,
  onStartCooking,
  save,
  importMeta,
  staleness,
  alreadySaved,
}: {
  plan: RenderPlan
  /** Back to wherever the recipe was opened from (Home or Cookbook): `App` returns to
   *  the shell, which reopens the tab the person was on. */
  onBack: () => void
  onStartCooking: () => void
  save?: SaveControl
  importMeta?: ImportMeta | null
  staleness?: StalenessMarker
  /** Set when a pasted link matched this saved recipe: offers Import again. */
  alreadySaved?: AlreadySaved
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

  const scrollRef = useRef<HTMLDivElement>(null)
  const pageTabsRef = useRef<HTMLDivElement>(null)
  const barSpacerRef = useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState(false)
  const onScroll = () => {
    const el = scrollRef.current
    if (!el || !pageTabsRef.current || !barSpacerRef.current) return
    setCompact(
      isCompactHeader(el.scrollTop, pageTabsRef.current.offsetTop, barSpacerRef.current.offsetHeight),
    )
  }

  // Switching tabs while the bar is showing keeps the tabs pinned: the new tab's content
  // starts right under the bar instead of wherever the old tab was scrolled to. Runs
  // before paint (layout effect), so the old scroll position never flashes.
  const pinTabsRef = useRef(false)
  const switchTab = (next: Tab) => {
    if (next === tab) return
    pinTabsRef.current = compact
    setTab(next)
  }
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || !pinTabsRef.current) return
    pinTabsRef.current = false
    el.scrollTop = (pageTabsRef.current?.offsetTop ?? 0) - (barSpacerRef.current?.offsetHeight ?? 0)
  }, [tab])

  const waitRowsAfter = new Map<number, RenderWaitRow[]>()
  for (const row of plan.waitRows) {
    const bucket = waitRowsAfter.get(row.afterStageIndex) ?? []
    bucket.push(row)
    waitRowsAfter.set(row.afterStageIndex, bucket)
  }

  const nIngredients = ingredientCount(plan.ingredientGroups)
  const tabs = (
    <>
      <TabButton active={tab === 'plan'} onClick={() => switchTab('plan')}>
        Plan
      </TabButton>
      <TabButton active={tab === 'ingredients'} onClick={() => switchTab('ingredients')}>
        Ingredients <span className="tabular">{nIngredients}</span>
      </TabButton>
    </>
  )

  // `relative` matters: the CTA and the compact bar are absolutely positioned, and
  // without a positioned ancestor they resolved against the viewport and escaped the
  // 390px column at any wider width.
  // `overflow-x-clip`: a guard against a sub-390px viewport.
  // `h-screen-dynamic` (index.css): 100dvh, so the page tracks Safari's toolbars.
  return (
    <div className="h-screen-dynamic relative overflow-x-clip bg-home-ground text-home-ink">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="no-scrollbar h-full overflow-y-auto pb-[calc(14rem+var(--safe-bottom))]"
      >
        <RecipeHeader
          plan={plan}
          save={save}
          importMeta={importMeta}
          onBack={onBack}
          staleness={staleness}
          alreadySaved={alreadySaved}
        />
        {/* A6 stays here, and stays hidden while the staleness line shows under the title. */}
        {!staleness && statusLine && <p className="px-5 pb-2 text-[13px] text-home-ink-2">{statusLine}</p>}

        <div ref={pageTabsRef} className="flex items-stretch gap-6 border-b border-home-rule px-5">
          {tabs}
        </div>

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
          <div className="px-5 pt-5">
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

      {/* Measures where the bar's tabs start: the top inset plus the 56px title row. Empty
          and invisible, so it has nothing to paint. */}
      <div
        ref={barSpacerRef}
        aria-hidden
        className="pointer-events-none invisible absolute left-0 top-0 h-[calc(var(--safe-top)+56px)] w-px"
      />

      {compact && (
        <div
          data-testid="compact-bar"
          className="absolute left-0 right-0 top-0 z-30 border-b border-home-rule bg-home-ground pt-[var(--safe-top)]"
        >
          <div className="flex h-14 items-center gap-1 px-3">
            <BackButton onClick={onBack} />
            <p className="min-w-0 flex-1 truncate text-[18px] font-bold leading-[24px] text-home-ink">
              {plan.title}
            </p>
          </div>
          <div className="-mb-px flex items-stretch gap-6 px-5">{tabs}</div>
        </div>
      )}

      {/* z-20 keeps this fixed footer above the scrolled plan content beneath it. The
          bottom padding is at least the home-indicator inset, so the pill clears Safari's
          bottom toolbar and the home indicator. */}
      <div className="absolute bottom-0 left-0 right-0 z-20 border-t border-home-rule bg-home-ground px-5 pb-[max(24px,var(--safe-bottom))] pt-4">
        {/* Terracotta pill, the Home register's primary action (R1; was signal in the Plan
            register). Sentence case: Home bans Title Case. M3.4: wired to Cooking Mode. */}
        <button
          type="button"
          onClick={onStartCooking}
          className="flex h-[52px] w-full items-center justify-center rounded-full bg-home-terracotta text-[18px] font-bold text-home-ground"
        >
          Start cooking
        </button>
        {/* R2: what "Start cooking" begins, in one line. Absent without `summary.phases`. */}
        {plan.outline && (
          <p className="mt-2 line-clamp-2 text-balance text-center text-[13px] leading-[1.35] text-home-ink-2">
            {plan.outline.ctaSubline}
          </p>
        )}
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
      aria-pressed={active}
      className={`-mb-px border-b-2 pb-2.5 pt-1 text-[15px] font-semibold ${
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
