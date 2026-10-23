import { EmphasisText } from '@/plan/EmphasisText'

import { READY_WHEN } from './copy'
import { needShown } from './quantity'
import type { TickState } from './stepPage'
import type { RailView } from './timers'
import type { ActionDescriptor, CookingView, Shell } from './viewModel'

/**
 * `CookingShell` (M3.4 handoff §2, PR 2 CP2's v2 frame): top bar (recipe name · Leave),
 * progress ticks, body column, footer — one component. PR 2 CP2 puts every cooking screen
 * on the Home register's one cream ground (`home/tokens.css`, shared, not aliased); the
 * three `Shell` values all resolve to it now and CP4 removes the type. The step pages
 * (`task`, `handsoff_pending`, `step_running`, `step_done`) get the v2 layout: timer rails,
 * "Step N of M" (opens All steps), name, text (bolded, D6), the cue, the hands-off line,
 * "You'll need", Up next pinned to the bottom of the content, then Back + a terracotta
 * pill (PR 2 CP3). Every other screen keeps today's layout and copy, recoloured.
 */

const CREAM = {
  bg: 'bg-home-ground',
  ink: 'text-home-ink',
  ink2: 'text-home-ink-2',
  meta: 'text-home-ink-2',
  rule: 'border-home-rule',
  mark: 'border-home-ink-2',
}

const GROUND: Record<Shell, typeof CREAM> = { paper: CREAM, field: CREAM, dark: CREAM }

const STEP_SCREENS = new Set(['task', 'handsoff_pending', 'step_running', 'step_done'])

/** Viewed = ink, done = terracotta, running = the peach tint, to do = rule. */
const TICK: Record<TickState, string> = {
  viewed: 'bg-home-ink',
  done: 'bg-home-terracotta',
  running: 'bg-home-tint-2',
  todo: 'bg-home-rule',
}

const PILL = 'h-[60px] rounded-full bg-home-terracotta text-[18px] font-bold text-home-ground'

/** The design's small list icon beside "Step N of M". */
function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M8 6h12M8 12h12M8 18h12" />
      <circle cx="4" cy="6" r="1" fill="currentColor" />
      <circle cx="4" cy="12" r="1" fill="currentColor" />
      <circle cx="4" cy="18" r="1" fill="currentColor" />
    </svg>
  )
}

export function CookingShell({
  view,
  needExpanded,
  onPrimary,
  onSecondary,
  onLeave,
  onSheet,
  onNavigate,
  onAction,
  onRail,
  onSteps,
  onExpandNeed,
}: {
  view: CookingView
  /** CP3 owner answer 4: "Show N more" was tapped on this step (state kept by the screen). */
  needExpanded: boolean
  onPrimary: () => void
  onSecondary: () => void
  onLeave: () => void
  /** The What's cooking link, on the wait screens only since CP3. */
  onSheet: () => void
  /** Up next and Back: a `view` action, navigation only. */
  onNavigate: (action: ActionDescriptor) => void
  /** CP3: any other action the page offers (the hands-off "Mark as done"). */
  onAction: (action: ActionDescriptor) => void
  /** CP3: a rail was tapped: one timer's sheet, or the Timers list for "N more timers". */
  onRail: (rail: RailView) => void
  /** CP3: "Step N of M" was tapped: the All steps sheet. */
  onSteps: () => void
  onExpandNeed: () => void
}) {
  const g = GROUND[view.shell]
  const isStep = STEP_SCREENS.has(view.screenId)
  const hasWhisper = !!(view.whisperText || view.showLink)

  // The whisper and the What's cooking link, recoloured: on the wait screens only since
  // CP3 (the step pages use the rail); CP4 replaces them there too.
  const background = hasWhisper && (
    <div className={`flex flex-col items-start gap-2 border-t py-[18px] ${g.rule}`}>
      {view.whisperText && <p className={`text-[18px] leading-[1.5] ${g.ink}`}>{view.whisperText}</p>}
      {view.showLink && (
        <button
          type="button"
          onClick={onSheet}
          className={`relative text-[15px] underline underline-offset-[3px] after:absolute after:inset-x-0 after:-inset-y-[11px] after:content-[''] ${g.meta}`}
        >
          What&apos;s cooking
        </button>
      )}
    </div>
  )

  // CP3: Undo on a step page is drawn outside the footer, so the primary never moves.
  const stepUndo = isStep && view.secondary?.action.kind === 'undo' ? view.secondary : null
  const need = needShown(view.need, needExpanded)

  // The non-step screens' secondary slot (kept until CP4).
  const secondary = (view.secondary || view.reserveSecondary) && (
    <div className={`flex items-center justify-center pt-3.5 text-center ${view.reserveSecondary ? 'min-h-[46px]' : ''}`}>
      {view.secondary && (
        <button
          type="button"
          onClick={onSecondary}
          className={`relative underline underline-offset-[3px] after:absolute after:inset-x-0 after:-inset-y-[11px] after:content-[''] ${
            view.secondary.action.kind === 'undo' ? `text-[16px] ${g.ink2}` : `text-[15px] ${g.meta}`
          }`}
        >
          {view.secondary.label}
        </button>
      )}
    </div>
  )

  const note = `text-[16px] leading-[1.45] ${g.ink2}`

  return (
    <div className={`flex h-full flex-col ${g.bg}`}>
      {/* Top bar. The cooking root no longer carries the top inset (useHomeSurface), so
          the bar adds it itself. Leave is a 44px text button. */}
      <div className="flex-shrink-0 pt-[var(--safe-top)]">
        <div className="flex h-[52px] items-center justify-between gap-3 pl-5 pr-2 pt-2">
          <span className={`min-w-0 truncate text-[15px] font-bold ${g.ink}`}>{view.topRecipe}</span>
          {view.showTopRight && (
            <button
              type="button"
              onClick={onLeave}
              className={`h-11 flex-none whitespace-nowrap px-3 text-[15px] font-semibold ${g.ink2}`}
            >
              Leave
            </button>
          )}
        </div>
      </div>

      {/* CP3 timer rails (V2Running): full-width sage, 48px, under the top bar; one per
          running timer up to two, the second becoming "N more timers" with a third (owner answer 1). */}
      {isStep && view.rails.length > 0 && (
        <div className="mt-1 flex flex-shrink-0 flex-col gap-px">
          {view.rails.map((rail) => (
            <button
              key={rail.kind === 'timer' ? rail.nodeId : 'more'}
              type="button"
              aria-label={rail.aria}
              onClick={() => onRail(rail)}
              className={`flex h-12 w-full items-center gap-2.5 bg-home-sage px-5 text-left ${g.ink}`}
            >
              {rail.kind === 'timer' ? (
                <>
                  <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-home-terracotta" />
                  <span className="min-w-0 flex-1 truncate text-[16px] font-bold">{rail.name}</span>
                  <span
                    className="flex-none whitespace-nowrap text-[16px] font-bold text-home-sage-chip-text"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {rail.left}
                  </span>
                </>
              ) : (
                // CP3.1: the summary rail has no dot (the dot means a running timer), and a ›
                // at its right edge says it opens the Timers list.
                <>
                  <span className="flex-1 text-[16px] font-bold">{rail.text}</span>
                  <span aria-hidden="true" className="flex-none text-[20px] font-bold leading-none text-home-sage-chip-text">›</span>
                </>
              )}
            </button>
          ))}
        </div>
      )}

      {isStep && view.ticks && (
        <div
          aria-hidden="true"
          data-ticks="true"
          className="grid flex-shrink-0 gap-[3px] px-5 pt-1.5"
          style={{ gridTemplateColumns: `repeat(${view.ticks.length}, minmax(0, 1fr))` }}
        >
          {view.ticks.map((t) => (
            <div key={t.nodeId} className={`h-[3px] ${TICK[t.state]}`} />
          ))}
        </div>
      )}

      {isStep ? (
        <>
          {/* Step page: the content scrolls; Up next is pinned to its bottom (mt-auto) and
              fills the space a short step leaves. While Undo shows, the column keeps 44px
              free at its foot so nothing sits under the Undo bar. */}
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div className={`flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-5 ${stepUndo ? 'pb-11' : ''}`}>
              <div className="flex shrink-0 flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  {view.step && (
                    <button
                      type="button"
                      onClick={onSteps}
                      aria-label={`${view.step}. Show all steps`}
                      className={`flex h-8 items-center gap-1.5 self-start pr-2.5 text-[15px] font-semibold ${g.ink2}`}
                      style={{ fontVariantNumeric: 'tabular-nums' }}
                    >
                      <ListIcon />
                      {view.step}
                    </button>
                  )}
                  <h1
                    className={`text-[26px] font-extrabold leading-[1.15] tracking-[-0.005em] ${g.ink}`}
                    style={{ textWrap: 'balance' }}
                  >
                    {view.label}
                  </h1>
                </div>
                {/* D6: quantities, times and heat in bold, the recipe page's own rule. */}
                <p className={`max-w-[350px] text-[24px] leading-[1.42] ${g.ink}`} style={{ textWrap: 'pretty' }}>
                  <EmphasisText text={view.title} consumed={view.consumed} factor={view.factor} />
                </p>
                {/* CP3 owner answer 3: how you know it's ready, only when the text doesn't say it. */}
                {view.cue && (
                  <p className={`text-[17px] leading-[1.45] ${g.ink}`}>
                    <b className="font-bold text-home-ink">{READY_WHEN}</b> {view.cue}
                  </p>
                )}
                {/* V2HandsOff: the sage tag and how long, never a forced timer; "Mark as done"
                    (owner answer 5) for a step done without timing it. */}
                {view.handsOff && (
                  <div className="flex flex-col items-start gap-1">
                    <div className={`flex items-center gap-2.5 text-[16px] leading-[1.4] ${g.ink}`}>
                      <span className="flex-none whitespace-nowrap rounded-full bg-home-sage px-2.5 py-1 text-[13px] font-bold text-home-sage-chip-text">
                        {view.handsOff.tag}
                      </span>
                      {view.handsOff.line && <span>{view.handsOff.line}</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => view.handsOff && onAction(view.handsOff.markDone.action)}
                      className={`-ml-1 h-11 px-1 text-[16px] underline underline-offset-[3px] ${g.ink2}`}
                    >
                      {view.handsOff.markDone.label}
                    </button>
                  </div>
                )}
                {view.stateLine && <p className={note}>{view.stateLine}</p>}
                {view.addedNote && <p className={note}>{view.addedNote}</p>}
                {/* R4: at a servings factor other than 1, the step's own text still quotes the
                    source's amounts, while the rows below are scaled. Said once, quietly. */}
                {view.servingsNote && <p className={note}>{view.servingsNote}</p>}
                {view.timesNote && <p className={note}>{view.timesNote}</p>}
                {/* CP3 "You'll need" (V2Step): name left, amount right in bold tabular, rules
                    between. Display only, except "Show N more", which opens the rest here. An
                    amount the scaler could not scale is ink-2, not bold, with an accessible
                    name that says so (R4). */}
                {view.need.length > 0 && (
                  <div data-need="true">
                    <div className={`pb-1.5 text-[14px] font-semibold ${g.ink2}`}>You&apos;ll need</div>
                    {need.rows.map((row) => (
                      <div
                        key={`${row.name}|${row.amount ?? ''}`}
                        data-need-row="true"
                        aria-label={row.label}
                        className={`flex justify-between gap-3 border-t py-2 text-[16px] leading-[1.4] ${g.rule} ${g.ink}`}
                      >
                        <span>{row.name}</span>
                        {row.amount != null &&
                          (row.unscaled ? (
                            <span className={`whitespace-nowrap text-right ${g.ink2}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {row.amount}
                            </span>
                          ) : (
                            <b className="whitespace-nowrap text-right font-bold tabular-nums">{row.amount}</b>
                          ))}
                      </div>
                    ))}
                    {need.more && (
                      <div className={`border-t ${g.rule}`}>
                        <button
                          type="button"
                          onClick={onExpandNeed}
                          className="flex h-11 w-full items-center gap-1 text-left text-[16px] font-semibold text-home-terracotta-text"
                        >
                          {need.more}
                          <span aria-hidden="true" className="text-[14px]">▾</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {view.note && <p className={note}>{view.note}</p>}
                {/* R6b B3 (ii), B21: quiet notes after the step's own lines. No "Edited" mark. */}
                {view.stepTimeNote && <p className={note}>{view.stepTimeNote}</p>}
                {view.stepAmountNote && <p className={note}>{view.stepAmountNote}</p>}
              </div>

              <div className="mt-auto shrink-0 pt-4">
                {/* Up next: the whole block is one button that moves the view (never a
                    completion). */}
                {view.upNext && (
                  <button
                    type="button"
                    onClick={() => view.upNext && onNavigate(view.upNext.action)}
                    aria-label={`${view.upNext.label}: ${view.upNext.stepRef.toLowerCase()}, ${view.upNext.name}. Go to it`}
                    className={`flex w-full flex-col gap-1.5 border-t pb-4 pt-3.5 text-left ${g.rule} ${g.ink}`}
                  >
                    <span className="flex w-full items-baseline justify-between">
                      <span className="text-[14px] font-semibold text-home-terracotta-text">{view.upNext.label}</span>
                      <span className={`text-[13px] ${g.ink2}`}>{view.upNext.stepRef}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[19px] font-extrabold leading-[1.25]">
                      {view.upNext.name}
                      {view.upNext.tag && (
                        <span className="flex-none whitespace-nowrap rounded-full bg-home-sage px-[9px] py-[3px] text-[12px] font-bold text-home-sage-chip-text">
                          {view.upNext.tag}
                        </span>
                      )}
                    </span>
                    <span className={`text-[17px] leading-[1.45] ${g.ink2}`}>{view.upNext.text}</span>
                  </button>
                )}
              </div>
            </div>
            {/* CP3: Undo, over the foot of the scroll area on the cream ground, never inside
                the footer, so the footer's height and the primary's position never depend on
                it. One line; a long step name truncates. */}
            {stepUndo && (
              <div className={`absolute inset-x-0 bottom-0 flex h-11 items-center justify-center px-5 ${g.bg}`}>
                <button
                  type="button"
                  onClick={onSecondary}
                  className={`h-11 max-w-full truncate text-[16px] underline underline-offset-[3px] ${g.ink2}`}
                >
                  {stepUndo.label}
                </button>
              </div>
            )}
          </div>

          {/* Footer: Back + the primary pill, nothing else. */}
          <div data-footer="true" className="flex-shrink-0 px-5 pb-[calc(24px+var(--safe-bottom))] pt-1">
            {(view.back || view.primary) && (
              <div className="flex items-center gap-3">
                {view.back && (
                  <button
                    type="button"
                    onClick={() => view.back && onNavigate(view.back.action)}
                    className={`h-[60px] flex-none pl-1 pr-[18px] text-[17px] font-bold ${g.ink}`}
                  >
                    Back
                  </button>
                )}
                {view.primary && (
                  <button type="button" onClick={onPrimary} className={`flex-1 ${PILL}`}>
                    {view.primary.label}
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* Body column (B0). The lead-in (124px) is a spacer that *shrinks* (down to
              24px) before the content is pushed below the fold. Content is `shrink-0`;
              only the spacer yields. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6">
            <div aria-hidden className="min-h-6 shrink basis-[124px]" />
            <div className="shrink-0">
              {view.step && <div className={`mb-1 text-[13px] ${g.meta}`}>{view.step}</div>}
              {view.label && <div className={`mb-3 text-[13px] ${g.meta}`}>{view.label}</div>}
              <h1 className={`text-[30px] font-semibold leading-[1.15] ${g.ink}`} style={{ fontStretch: '88%' }}>
                {view.title}
              </h1>
              {view.instr && <p className={`mt-5 text-[18px] leading-[1.55] ${g.ink}`}>{view.instr}</p>}
              {view.waitTime && (
                <div className="mt-4">
                  <p className={`text-[18px] leading-[1.55] ${g.ink}`}>{view.waitTime.left}</p>
                  <p className={`text-[15px] leading-[1.5] ${g.meta}`}>{view.waitTime.readyAt}</p>
                </div>
              )}
              {view.qty && <p className={`mt-4 text-[15px] leading-[1.5] ${g.meta}`}>{view.qty}</p>}
              {view.note && <p className={`mt-4 text-[15px] leading-[1.5] ${g.meta}`}>{view.note}</p>}
            </div>
          </div>

          <div className="flex-shrink-0 px-6 pb-[34px]">
            {background}

            {view.primary &&
              (view.primary.solid ? (
                <button type="button" onClick={onPrimary} className={`flex w-full items-center justify-center ${PILL}`}>
                  {view.primary.label}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onPrimary}
                  className={`flex min-h-[60px] w-full items-center justify-center rounded-full border border-home-ink px-3.5 py-2 text-center text-[18px] font-medium leading-[1.3] ${g.ink}`}
                >
                  {view.primary.label}
                </button>
              ))}

            {secondary}
          </div>
        </>
      )}
    </div>
  )
}
