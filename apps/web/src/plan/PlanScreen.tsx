import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { ImportMeta } from '@abc-cook/schema'

import { choiceFactor, type ServingsChoice } from '@/lib/servings'
import { asWrittenLine } from '@/library/ingredientEditor'
import { useNow } from '@/lib/useNow'
import { useHomeSurface } from '@/shell/useHomeSurface'
import { measureSections, scrollTopFor, type ScrollAnchor } from '@/import/scrollAnchor'

import { BackButton } from './BackButton'
import type { RenderIngredientGroup, RenderPlan, RenderStage, RenderWaitRow } from './derive'
import type { AlreadySaved } from './AlreadySavedNotice'
import { EndOfPageSection, type RemoveControl } from './EndOfPageSection'
import type { EndOfPageBlock } from './endOfPage'
import { EditToolbar, type IngredientsEdit } from './EditableIngredientList'
import { SectionEditButton } from './SectionEditButton'
import { IngredientsPanel } from './IngredientsPanel'
import { multitaskNote } from './multitaskNote'
import { OrphanReview } from './OrphanReview'
import { StepEditContext, type StepEditApi } from './stepEditContext'
import { stepChoiceGroups } from './stepRows'
import { stageOrdinals, stepNumbers } from './stepNumbers'
import { useRecipeEditing, type PlanEditing } from './useRecipeEditing'
import { orphanNoticeLine } from '@/library/recipeEdits'
import { panelServings } from './panelServings'
import { ReadyPill } from './ReadyPill'
import { RecipeHeader, type SaveControl } from './RecipeHeader'
import { RecipePage } from './RecipePage'
import { useReadyNotice } from './useReadyNotice'
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

/** The N in "N ingredients": every ingredient the plan lists, across groups. */
export function ingredientCount(groups: readonly RenderIngredientGroup[]): number {
  return groups.reduce((n, g) => n + g.items.length, 0)
}

/** D2: every card starts open. The keys are the run keys `PlanScreen` expands by, one per card. */
export function allStageKeys(plan: Pick<RenderPlan, 'stages'>): string[] {
  return plan.stages.map((s) => s.key)
}

/**
 * Whether the compact sticky bar should show. It takes over once the page's title has scrolled up
 * to where the bar sits, so the title appears to stay put while the full header scrolls away. Both
 * figures are measured from the top of the scroll area: the title's bottom edge, and the bar's height
 * (which includes the phone's top safe-area inset).
 */
export function isCompactHeader(scrollTop: number, titleBottom: number, barHeight: number): boolean {
  return scrollTop > 0 && scrollTop >= titleBottom - barHeight
}

/**
 * The recipe page (R1, Home register; one scroll with no tabs since D7). One scroll area holds the
 * header (picture, title, fact tiles), What you need, the steps in open stage cards, and the end of
 * the page. The Map mode was removed from this page on 2026-10-13 (`docs/GRAPH_VIEW.md`);
 * `src/map/` stays, unused, until a later clean-up PR.
 *
 * The compact bar (back, title) is a second copy laid over the top of the scroll area, rendered
 * only while `isCompactHeader` says the page's own title has reached it. Overlaying it rather than
 * making the page's own header sticky means the content below never jumps when the bar appears. It is
 * mounted and unmounted, not faded with opacity/visibility: on iOS Safari the faded-in bar painted its
 * back arrow but not its title text (R1, iPhone retest), and a freshly mounted element has nothing to
 * repaint. An empty, invisible spacer of the same height stays mounted so the threshold can still be
 * measured while the bar is absent.
 */
export function PlanScreen({
  plan,
  onBack,
  onStartCooking,
  startLabel = 'Start cooking',
  startSubline = null,
  save,
  importMeta,
  staleness,
  alreadySaved,
  servingsChoice = null,
  servingsLocked = false,
  onServingsChoiceChange,
  endOfPage,
  editing,
  now: frozenNow,
  fromImport = false,
  scrollAnchor = null,
}: {
  plan: RenderPlan
  /** Back to wherever the recipe was opened from (Home or Cookbook): `App` returns to
   *  the shell, which reopens the tab the person was on. */
  onBack: () => void
  onStartCooking: () => void
  /** The primary button's label: "Continue cooking" while a cook on this plan is under way. */
  startLabel?: string
  /** Replaces the outline's line under the button ("Pick up where you left off."); `null` keeps the outline's. */
  startSubline?: string | null
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
  /** R5: the end of the page. Absent when there is nothing to show. */
  endOfPage?: { block: EndOfPageBlock | null; remove: RemoveControl | null }
  /** R6a: the saved entry's edit context. Absent when there is no entry to edit (Q4). */
  editing?: PlanEditing
  /** Freezes the clock behind "ready around" (tests, screenshots). Absent in the app: it ticks every minute. */
  now?: Date
  /** This plan was just built by a live import: "Your plan is ready" shows briefly. A Cookbook open never sets it. */
  fromImport?: boolean
  /** Where the cook was reading on the importing page; applied once, before the first paint. */
  scrollAnchor?: ScrollAnchor | null
}) {
  const now = useNow(frozenNow)
  const [reviewing, setReviewing] = useState(false)
  const statusLine = statusLineFor(importMeta)
  // A13: the servings gate reads the imported rows, never the edited ones.
  const servings = panelServings(plan, importMeta, servingsChoice, servingsLocked, onServingsChoiceChange, editing?.gateLines)
  const edit = useRecipeEditing(editing)
  const editMode = edit.session.mode === 'edit'
  const orphans = editing?.ctx.overlay.orphans ?? []
  // Every way out of the editor (back, Start cooking, Done) goes through `edit.guard`, so a changed row
  // is committed or kept open, never dropped (A24).
  const latest = useRef({ onBack, onStartCooking })
  useEffect(() => {
    latest.current = { onBack, onStartCooking }
  })
  const guardedBack = () => edit.guard('back', () => latest.current.onBack())
  const guardedStart = () => edit.guard('start', () => latest.current.onStartCooking())
  // R1: the recipe page is a Home-register screen (DESIGN_SYSTEM.md § Register: Home and
  // browse screens), so the page behind it takes the Home ground too.
  useHomeSurface(true)

  // D2: every card starts open, and each collapses on its own.
  // P1 #5: keyed by `stage.key` (the run), not `stage.stageId` — a stage rendered as
  // more than one card (plan §D) expands each card independently.
  const [expandedStages, setExpandedStages] = useState<Set<string>>(() => new Set(allStageKeys(plan)))
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
  // R6b D6: Edit opens every card, so every step is reachable. It runs when edit mode starts and not
  // again, so a card the cook closes by hand stays closed.
  const stageKeys = useRef<string[]>([])
  useEffect(() => {
    stageKeys.current = allStageKeys(plan)
  })
  useEffect(() => {
    if (editMode) setExpandedStages(new Set(stageKeys.current))
  }, [editMode])

  const scrollRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const barSpacerRef = useRef<HTMLDivElement>(null)
  const compactBarRef = useRef<HTMLDivElement>(null)
  const [compact, setCompact] = useState(false)
  const ready = useReadyNotice(fromImport)
  // The position the swap landed on: a scroll event for any other position is the cook's own.
  const appliedTop = useRef<number | null>(null)
  const onScroll = () => {
    const el = scrollRef.current
    if (el && (appliedTop.current == null || Math.abs(el.scrollTop - appliedTop.current) > 2)) ready.dismiss()
    const title = titleRef.current
    if (!el || !title || !barSpacerRef.current) return
    setCompact(isCompactHeader(el.scrollTop, title.offsetTop + title.offsetHeight, barSpacerRef.current.offsetHeight))
  }

  // The swap from the importing page: open at the section the cook was reading, once, before paint.
  // The first render's anchor is the only one that counts, so later renders never move the page.
  const initialAnchor = useRef(scrollAnchor)
  useLayoutEffect(() => {
    const anchor = initialAnchor.current
    const el = scrollRef.current
    if (!anchor || !el) return
    const measured = measureSections(el)
    if (!measured) return
    // The compact bar covers the top of the page by the spacer's height once the page has scrolled.
    el.scrollTop = scrollTopFor(anchor, measured.tops, measured.heights, barSpacerRef.current?.offsetHeight ?? 0)
    appliedTop.current = el.scrollTop
    onScroll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The edit toolbar sticks under the compact bar (A24: Done stays reachable on a long page), so it
  // needs the bar's height: 0 while the bar is not showing.
  useLayoutEffect(() => {
    scrollRef.current?.style.setProperty('--plan-bar-h', compact ? `${compactBarRef.current?.offsetHeight ?? 0}px` : '0px')
  }, [compact])

  const waitRowsAfter = new Map<number, RenderWaitRow[]>()
  for (const row of plan.waitRows) {
    // A wait that names its host step is already on that step's row, with its time: said once, there.
    if (row.hostLabels.length === 1) continue
    const bucket = waitRowsAfter.get(row.afterStageIndex) ?? []
    bucket.push(row)
    waitRowsAfter.set(row.afterStageIndex, bucket)
  }

  const noticeLine = orphanNoticeLine(orphans.length)
  // D5: the multitask note's "See where" opens the card holding the first Meanwhile block, if the cook
  // closed it, then scrolls to the block once it is drawn.
  const note = useMemo(() => multitaskNote(plan), [plan])
  const seeWhich = () => {
    if (!note) return
    const stage = plan.stages.find((s) => s.windows.some((w) => w.id === note.firstWindowId))
    if (stage && !expandedStages.has(stage.key)) flipStage(stage.key)
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        scrollRef.current
          ?.querySelector(`[data-meanwhile="${note.firstWindowId}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
      ),
    )
  }
  // CP5.1 U1: a section's Edit enters edit mode (as the header pill does), then scrolls that section's
  // heading to just below the compact bar and the sticky toolbar, once both are laid out.
  const editSection = (anchor: 'need' | 'steps') => {
    edit.enter()
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const scroller = scrollRef.current
        const target = scroller?.querySelector<HTMLElement>(`[data-anchor="${anchor}"]`)
        if (!scroller || !target) return
        const bar = barSpacerRef.current?.offsetHeight ?? 0
        const toolbar = scroller.querySelector<HTMLElement>('[data-edit-toolbar]')?.offsetHeight ?? 0
        const top = scroller.scrollTop + target.getBoundingClientRect().top - scroller.getBoundingClientRect().top
        scroller.scrollTo({ top: top - bar - toolbar, behavior: 'smooth' })
      }),
    )
  }
  const stepGroups = useMemo(() => stepChoiceGroups(plan), [plan])
  const numbers = useMemo(() => stepNumbers(plan.stages), [plan.stages])
  const ordinals = useMemo(() => stageOrdinals(plan.stages), [plan.stages])
  // B4: the rename note's "Edit the step". It goes through the same door as any exit, so a blocked
  // exit stays put (the open row keeps its error and scrolls into view); otherwise that step opens in
  // place and the page centres it (`landing`).
  const goToStep = (nodeId: string) => edit.guard('tab', () => edit.enterAtStep(nodeId))
  const choice = servings?.choice ?? null
  const factor = choiceFactor(choice)
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
  const editPill = editing
    ? { editing: editMode, onToggle: () => (editMode ? edit.guard('done', () => {}) : edit.enter()) }
    : undefined

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
    <RecipePage
      mode="plan"
      scrollRef={scrollRef}
      onScroll={onScroll}
      bottomPad="pb-[calc(14rem+var(--safe-bottom))]"
      overlay={
        <>
          {/* Measures the compact bar's height: the top inset plus the 56px title row. Empty and
              invisible, so it has nothing to paint. */}
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
            </div>
          )}
        </>
      }
      footer={
        <>
          {fromImport && <ReadyPill visible={ready.visible} />}
          {/* Terracotta pill, the Home register's primary action (R1; was signal in the Plan
              register). Sentence case: Home bans Title Case. M3.4: wired to Cooking Mode. */}
          {/* While editing, Done is the way forward: Start cooking waits until the edits are committed. */}
          <button
            type="button"
            onClick={guardedStart}
            disabled={editMode}
            className="flex h-14 w-full items-center justify-center rounded-full bg-home-terracotta text-[17px] font-bold text-home-ground disabled:bg-home-disabled disabled:text-home-disabled-ink"
          >
            {startLabel}
          </button>
          {/* R2: what "Start cooking" begins, in one line. Absent without `summary.phases`. */}
          {(startSubline ?? plan.outline?.ctaSubline) && (
            <p className="mt-1.5 line-clamp-2 text-balance text-center text-[12px] leading-[1.35] text-home-ink-2">
              {startSubline ?? plan.outline?.ctaSubline}
            </p>
          )}
        </>
      }
    >
      <RecipeHeader
        plan={plan}
        save={save}
        importMeta={importMeta}
        onBack={guardedBack}
        staleness={staleness}
        alreadySaved={alreadySaved}
        servings={servings}
        statusLine={statusLine}
        edit={editPill}
        titleRef={titleRef}
        multitask={note ? { bold: note.bold, detail: note.detail } : null}
        onSeeWhich={seeWhich}
        now={now}
      />

      {noticeLine && (
        <p className="px-5 pb-2 text-[13px] leading-[1.4] text-home-ink-2">
          {noticeLine}{' '}
          <button type="button" onClick={() => setReviewing(true)} className="relative font-medium text-home-ink underline underline-offset-2 after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']">
            Review
          </button>
        </p>
      )}

      {plan.warnings.length > 0 && (
        <div className="mx-5 mb-2 rounded-home-mini bg-home-thumb px-3 py-2 text-[13px] text-home-ink-2">
          {plan.warnings.map((w) => (
            <p key={w}>{sentence(w)}</p>
          ))}
        </div>
      )}

      {ingredientsEdit && <EditToolbar edit={ingredientsEdit} hint="Tap an ingredient or a step to change it." />}

      <IngredientsPanel
        groups={plan.ingredientGroups}
        servings={servings}
        edit={ingredientsEdit}
        onSectionEdit={editPill && !editMode ? () => editSection('need') : undefined}
      />

      <StepEditContext.Provider value={stepApi}>
        <section className="px-5 pt-[18px]" aria-labelledby="steps-heading" data-anchor="steps">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="steps-heading" className="text-[20px] font-extrabold leading-[1.2] text-home-ink">
              Steps
            </h2>
            {editPill && !editMode && <SectionEditButton onClick={() => editSection('steps')} label="Edit steps" />}
          </div>
          <div className="mt-3">
            {(waitRowsAfter.get(-1) ?? []).map((row, i) => (
              <WaitRow key={`wait-pre-${i}`} row={row} />
            ))}
            {plan.stages.map((stage, index) => (
              <Fragment key={stage.key}>
                <StageCard
                  stage={stage}
                  expanded={expandedStages.has(stage.key)}
                  onToggle={() => toggleStage(stage.key)}
                  ordinal={ordinals.get(stage.stageId) ?? stage.index + 1}
                  numbers={numbers}
                  factor={factor}
                />
                {(waitRowsAfter.get(index) ?? []).map((row, i) => (
                  <WaitRow key={`wait-${index}-${i}`} row={row} />
                ))}
              </Fragment>
            ))}

            {endOfPage && <EndOfPageSection block={endOfPage.block} remove={endOfPage.remove} />}
          </div>
        </section>
      </StepEditContext.Provider>
    </RecipePage>
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
