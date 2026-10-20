import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { ImportMeta } from '@abc-cook/schema'

import type { ServingsChoice } from '@/lib/servings'
import { asWrittenLine } from '@/library/ingredientEditor'
import { useHomeSurface } from '@/shell/useHomeSurface'

import { BackButton } from './BackButton'
import type { RenderIngredientGroup, RenderPlan, RenderStage, RenderWaitRow } from './derive'
import type { AlreadySaved } from './AlreadySavedNotice'
import { EndOfPageSection, type RemoveControl } from './EndOfPageSection'
import type { EndOfPageBlock } from './endOfPage'
import { EditToolbar, type IngredientsEdit } from './EditableIngredientList'
import { IngredientsPanel } from './IngredientsPanel'
import { OrphanReview } from './OrphanReview'
import { StepEditContext, type StepEditApi } from './stepEditContext'
import { stepChoiceGroups } from './stepRows'
import { useRecipeEditing, type PlanEditing } from './useRecipeEditing'
import { orphanNoticeLine } from '@/library/recipeEdits'
import { panelServings } from './panelServings'
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
  servingsChoice = null,
  servingsLocked = false,
  onServingsChoiceChange,
  endOfPage,
  editing,
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
  /** R4: the cook's servings choice for this open recipe (`null` = as written). Owned by `App`,
   * because it travels into the cooking session. */
  servingsChoice?: ServingsChoice | null
  /** Q9: a cook is in progress on this plan, so the choice can't change. */
  servingsLocked?: boolean
  onServingsChoiceChange?: (choice: ServingsChoice | null) => void
  /** R5: the end of the Plan tab. Absent when there is nothing to show. */
  endOfPage?: { block: EndOfPageBlock | null; remove: RemoveControl | null }
  /** R6a: the saved entry's edit context. Absent when there is no entry to edit (Q4). */
  editing?: PlanEditing
}) {
  const [tab, setTab] = useState<Tab>('plan')
  const [reviewing, setReviewing] = useState(false)
  const statusLine = statusLineFor(importMeta)
  // A13: the servings gate reads the imported rows, never the edited ones.
  const servings = panelServings(plan, importMeta, servingsChoice, servingsLocked, onServingsChoiceChange, editing?.gateLines)
  const edit = useRecipeEditing(editing)
  const editMode = edit.session.mode === 'edit'
  const orphans = editing?.ctx.overlay.orphans ?? []
  // Every way out of the editor (a tab, back, Start cooking) goes through `edit.guard`, so a
  // changed row is committed or kept open, never dropped (A24).
  const latest = useRef({ onBack, onStartCooking })
  useEffect(() => {
    latest.current = { onBack, onStartCooking }
  })
  const guardedBack = () => edit.guard('back', () => latest.current.onBack())
  const guardedStart = () => edit.guard('start', () => latest.current.onStartCooking())
  // R1: the recipe page is a Home-register screen (DESIGN_SYSTEM.md § Register: Home and
  // browse screens), so the page behind it takes the Home ground too.
  useHomeSurface(true)

  // M3.2: overview-first — every card starts collapsed, and each opens on its own.
  // P1 #5: keyed by `stage.key` (the run), not `stage.stageId` — a stage rendered as
  // more than one card (plan §D) expands each card independently.
  const [expandedStages, setExpandedStages] = useState<Set<string>>(() => new Set())
  const flipStage = (key: string) => setExpandedStages((prev) => toggleStageSet(prev, key))
  // R6b D6: closing the card that holds the open step goes through the editor's one door, so a typed
  // step is committed or kept open with its error, never dropped (A24). Any other card just flips.
  const toggleStage = (key: string) => {
    const open = edit.session.step?.target.nodeId
    const stage = plan.stages.find((s) => s.key === key)
    const holdsOpen = open != null && stage != null && expandedStages.has(key) && stageTaskIds(stage).includes(open)
    if (holdsOpen) edit.guard('collapse', () => flipStage(key))
    else flipStage(key)
  }
  // R6b D6: Edit on the Plan tab opens every card, like "Show full recipe". It runs when edit mode starts
  // or the cook arrives on this tab in it, and not again, so a card the cook closes by hand stays closed.
  const stageKeys = useRef<string[]>([])
  useEffect(() => {
    stageKeys.current = plan.stages.map((s) => s.key)
  })
  useEffect(() => {
    if (editMode && tab === 'plan') setExpandedStages(new Set(stageKeys.current))
  }, [editMode, tab])

  const scrollRef = useRef<HTMLDivElement>(null)
  const pageTabsRef = useRef<HTMLDivElement>(null)
  const barSpacerRef = useRef<HTMLDivElement>(null)
  const compactBarRef = useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState(false)
  const onScroll = () => {
    const el = scrollRef.current
    if (!el || !pageTabsRef.current || !barSpacerRef.current) return
    setCompact(
      isCompactHeader(el.scrollTop, pageTabsRef.current.offsetTop, barSpacerRef.current.offsetHeight),
    )
  }

  // The edit toolbar sticks under the compact bar (A24: Done stays reachable on a long list), so it
  // needs the bar's height: 0 while the bar is not showing.
  useLayoutEffect(() => {
    scrollRef.current?.style.setProperty('--plan-bar-h', compact ? `${compactBarRef.current?.offsetHeight ?? 0}px` : '0px')
  }, [compact, tab])

  // Switching tabs while the bar is showing keeps the tabs pinned: the new tab's content
  // starts right under the bar instead of wherever the old tab was scrolled to. Runs
  // before paint (layout effect), so the old scroll position never flashes.
  const pinTabsRef = useRef(false)
  const switchTab = (next: Tab) => {
    if (next === tab) return
    edit.guard('tab', () => {
      pinTabsRef.current = compact
      setTab(next)
    })
  }
  const showPlanTab = () => {
    pinTabsRef.current = compact
    setTab('plan')
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
  const noticeLine = orphanNoticeLine(orphans.length)
  const stepGroups = useMemo(() => stepChoiceGroups(plan), [plan])
  // B4: the rename note's "Edit the step". It goes through the same door as a tab switch, so a blocked
  // exit stays put (the open row keeps its error and scrolls into view); otherwise it lands on the Plan
  // tab with that step open.
  const goToStep = (nodeId: string) =>
    edit.guard('tab', () => {
      showPlanTab()
      edit.enterAtStep(nodeId)
    })
  const choice = servings?.choice ?? null
  const ingredientsEdit: IngredientsEdit | undefined = editing ? { editing, api: edit, choice, stepGroups, goToStep } : undefined
  const stepApi: StepEditApi | null = editing
    ? {
        inEdit: editMode,
        edited: editing.ctx.overlay.editedSteps,
        importedSteps: editing.ctx.overlay.importedSteps,
        step: edit.session.step,
        savedStep: edit.session.savedStep,
        factorLine: asWrittenLine(choice),
        writeError: edit.session.writeError,
        blocked: edit.blocked,
        landing: edit.landing,
        onLanded: edit.clearLanding,
        open: edit.openStepById,
        change: edit.changeStep,
        save: edit.commitOpen,
        restore: edit.restoreStepText,
      }
    : null
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
  if (reviewing) {
    return (
      <div className="h-screen-dynamic relative overflow-x-clip bg-home-ground text-home-ink">
        <div className="no-scrollbar h-full overflow-y-auto">
          <OrphanReview orphans={orphans} onBack={() => setReviewing(false)} onDiscard={edit.discard} />
        </div>
      </div>
    )
  }

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
          onBack={guardedBack}
          staleness={staleness}
          alreadySaved={alreadySaved}
          servingsChoice={servings?.choice}
          statusLine={statusLine}
        />

        {noticeLine && (
          <p className="px-5 pt-1 text-[13px] leading-[1.4] text-home-ink-2">
            {noticeLine}{' '}
            <button type="button" onClick={() => setReviewing(true)} className="relative font-medium text-home-ink underline underline-offset-2 after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']">
              Review
            </button>
          </p>
        )}

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
          <IngredientsPanel groups={plan.ingredientGroups} servings={servings} edit={ingredientsEdit} />
        ) : (
          <StepEditContext.Provider value={stepApi}>
            {ingredientsEdit && <EditToolbar edit={ingredientsEdit} hint="Tap a step to change it." />}
            <div className={ingredientsEdit ? 'px-5 pt-2' : 'px-5 pt-5'}>
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

              {endOfPage && <EndOfPageSection block={endOfPage.block} remove={endOfPage.remove} />}
            </div>
          </StepEditContext.Provider>
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
          ref={compactBarRef}
          data-testid="compact-bar"
          className="absolute left-0 right-0 top-0 z-30 border-b border-home-rule bg-home-ground pt-[var(--safe-top)]"
        >
          <div className="flex h-14 items-center gap-1 px-3">
            <BackButton onClick={guardedBack} />
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
          onClick={guardedStart}
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

/** Every node id a card draws: its inline tasks and its windows' tasks. */
function stageTaskIds(stage: RenderStage): string[] {
  return [...stage.inlineTasks.map((t) => t.nodeId), ...stage.windows.flatMap((w) => w.tasks.map((t) => t.nodeId))]
}

/** "uses 2 burners" -> "Uses 2 burners". */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
