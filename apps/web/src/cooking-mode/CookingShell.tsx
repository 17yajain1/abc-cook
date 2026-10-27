import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { EmphasisText } from '@/plan/EmphasisText'

import { noBreakWords, READY_WHEN } from './copy'
import { needShown } from './quantity'
import type { TickState } from './stepPage'
import type { BannerView, RailView, StripView } from './timers'
import type { ActionButton, ActionDescriptor, CookingView } from './viewModel'

/**
 * `CookingShell` (M3.4 handoff §2, PR 2's v2 frames): every cooking screen on the Home
 * register's one cream ground (`home/tokens.css`, shared, not aliased). Four layouts
 * (PR 2 CP4), all in Archivo (`--font-sans`):
 * - step (`task`, `handsoff_pending`, `step_done`; CP3): strips, "Step N of M" (opens All
 *   steps), name, text (bolded, D6), the cue, the hands-off line, "You'll need", Up next
 *   pinned to the bottom of the content, then Back + a terracotta pill;
 * - waiting (V2Wait): the same top, then the time left, "Add 5 min", the bar, the ready
 *   line, the Meanwhile block and "When it's done";
 * - done (V2Done): the recipe's picture, "‹Title› is done.", one line, Back + "Finished cooking";
 * - message (the stale screen, and through `MessageScreen` the conflict screen).
 * The strips under the top bar are the CP3 rails and the CP4 banners. Undo is drawn outside
 * the footer on every layout, so the primary never moves.
 */

/** Viewed = ink, done = terracotta, running = the peach tint, to do = rule. */
const TICK: Record<TickState, string> = {
  viewed: 'bg-home-ink',
  done: 'bg-home-terracotta',
  running: 'bg-home-tint-2',
  todo: 'bg-home-rule',
}

const PILL = 'h-[60px] rounded-full bg-home-terracotta text-[18px] font-bold text-home-ground'
// min-h, not h: a long recipe name ("End it and cook Homemade Glazed Donuts") wraps to two lines.
const OUTLINED =
  'min-h-[60px] rounded-full border-[1.5px] border-home-terracotta bg-home-ground px-3.5 py-2 text-[18px] font-bold leading-[1.3] text-home-terracotta-text'

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

function TickIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12l5 5L20 7" />
    </svg>
  )
}

export function CookingShell({
  view,
  needExpanded,
  onPrimary,
  onSecondary,
  onLeave,
  onNavigate,
  onAction,
  onRail,
  onSteps,
  onExpandNeed,
  onBannerBottom,
}: {
  view: CookingView
  /** CP4.1: where the timer-end banners end (px from the top of the screen), or `null`
   * when none shows, so the screen can keep any open sheet below them. */
  onBannerBottom?: (px: number | null) => void
  /** CP3 owner answer 4: "Show N more" was tapped on this step (state kept by the screen). */
  needExpanded: boolean
  onPrimary: () => void
  onSecondary: () => void
  /** PR 2 CP4: Leave just leaves; timers keep running. */
  onLeave: () => void
  /** Up next, Back and the Meanwhile rows: a `view` action (navigation only), or `review`. */
  onNavigate: (action: ActionDescriptor) => void
  /** Any other action the page offers: "Mark as done", "Add 5 min", a banner's buttons. */
  onAction: (action: ActionDescriptor) => void
  /** CP3: a rail was tapped: one timer's sheet, or the Timers list for "N more timers". */
  onRail: (rail: RailView) => void
  /** CP3: "Step N of M" was tapped: the All steps sheet. */
  onSteps: () => void
  onExpandNeed: () => void
}) {
  // Undo is drawn outside the footer, so the footer's height and the primary's position
  // never depend on it (CP3; CP4 for the waiting and done screens).
  const undo = view.secondary?.action.kind === 'undo' ? view.secondary : null
  const footer = <Footer back={view.back} primary={view.primary} onNavigate={onNavigate} onPrimary={onPrimary} />
  const undoBar = undo && <UndoBar label={undo.label} onClick={onSecondary} />

  if (view.layout === 'done') {
    return (
      <div className="flex h-full flex-col bg-home-ground">
        <div className="flex-shrink-0 pt-[var(--safe-top)]">{view.done?.thumbnail && <Thumbnail src={view.done.thumbnail} alt={view.done.alt} />}</div>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className={`flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-5 pt-6 ${undo ? 'pb-11' : ''}`}>
            <h1 className="text-[40px] font-extrabold leading-[1.02] tracking-[-0.01em] text-home-ink" style={{ fontStretch: '88%' }}>
              <Headline text={view.title} />
            </h1>
            {view.done && <p className="text-[17px] text-home-ink-2">{view.done.line}</p>}
          </div>
          {undoBar}
        </div>
        {footer}
      </div>
    )
  }

  const topBar = (
    // The cooking root no longer carries the top inset (useHomeSurface), so the bar adds it
    // itself. Leave is a 44px text button.
    <div className="flex-shrink-0 pt-[var(--safe-top)]">
      <div className="flex h-[52px] items-center justify-between gap-3 pl-5 pr-2 pt-2">
        <span className="min-w-0 truncate text-[15px] font-bold text-home-ink">{view.topRecipe}</span>
        {view.showTopRight && (
          <button type="button" onClick={onLeave} className="h-11 flex-none whitespace-nowrap px-3 text-[15px] font-semibold text-home-ink-2">
            Leave
          </button>
        )}
      </div>
    </div>
  )

  if (view.layout === 'message') {
    return (
      <div className="flex h-full flex-col bg-home-ground">
        {topBar}
        <MessageBody
          heading={view.title}
          line={view.instr}
          primary={view.primary && { label: view.primary.label, onClick: onPrimary }}
          secondary={view.secondary && { label: view.secondary.label, onClick: onSecondary }}
          note={view.note}
        />
      </div>
    )
  }

  const isWaiting = view.layout === 'waiting'
  const need = needShown(view.need, needExpanded)
  const note = 'text-[16px] leading-[1.45] text-home-ink-2'

  return (
    <div className="flex h-full flex-col bg-home-ground">
      {topBar}

      <Strips strips={view.strips} onRail={onRail} onAction={onAction} onBannerBottom={onBannerBottom} />

      {view.ticks && (
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

      {/* The content scrolls; Up next is pinned to its bottom (mt-auto) and fills the space a
          short step leaves. While Undo shows, the column keeps 44px free at its foot so
          nothing sits under the Undo bar. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className={`flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-5 ${undo ? 'pb-11' : ''}`}>
          <div className={`flex shrink-0 flex-col ${isWaiting ? 'gap-3.5' : 'gap-4'}`}>
            <div className="flex flex-col gap-1.5">
              {view.step && (
                <button
                  type="button"
                  onClick={onSteps}
                  aria-label={`${view.step}. Show all steps`}
                  className="flex h-8 items-center gap-1.5 self-start pr-2.5 text-[15px] font-semibold text-home-ink-2"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  <ListIcon />
                  {view.step}
                </button>
              )}
              <h1 className="text-[26px] font-extrabold leading-[1.15] tracking-[-0.005em] text-home-ink" style={{ textWrap: 'balance' }}>
                <Headline text={view.label ?? ''} />
              </h1>
            </div>

            {isWaiting ? (
              <>
                {view.waiting && <WaitingBlock waiting={view.waiting} onAction={onAction} />}
                {view.cue && <CueLine cue={view.cue} />}
                {view.waiting && view.waiting.meanwhile.length > 0 && <MeanwhileBlock rows={view.waiting.meanwhile} onNavigate={onNavigate} />}
              </>
            ) : (
              <>
                {/* D6: quantities, times and heat in bold, the recipe page's own rule. */}
                <p className="max-w-[350px] text-[24px] leading-[1.42] text-home-ink" style={{ textWrap: 'pretty' }}>
                  <EmphasisText text={view.title} consumed={view.consumed} factor={view.factor} />
                </p>
                {/* CP3 owner answer 3: how you know it's ready, only when the text doesn't say it. */}
                {view.cue && <CueLine cue={view.cue} />}
                {/* V2HandsOff: the sage tag and how long, never a forced timer; "Mark as done"
                    (owner answer 5) for a step done without timing it. */}
                {view.handsOff && (
                  <div className="flex flex-col items-start gap-1">
                    <div className="flex items-center gap-2.5 text-[16px] leading-[1.4] text-home-ink">
                      <span className="flex-none whitespace-nowrap rounded-full bg-home-sage px-2.5 py-1 text-[13px] font-bold text-home-sage-chip-text">
                        {view.handsOff.tag}
                      </span>
                      {view.handsOff.line && <span>{view.handsOff.line}</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => view.handsOff && onAction(view.handsOff.markDone.action)}
                      className="-ml-1 h-11 px-1 text-[16px] text-home-ink-2 underline underline-offset-[3px]"
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
                    <div className="pb-1.5 text-[14px] font-semibold text-home-ink-2">You&apos;ll need</div>
                    {need.rows.map((row) => (
                      <div
                        key={`${row.name}|${row.amount ?? ''}`}
                        data-need-row="true"
                        aria-label={row.label}
                        className="flex justify-between gap-3 border-t border-home-rule py-2 text-[16px] leading-[1.4] text-home-ink"
                      >
                        <span>{row.name}</span>
                        {row.amount != null &&
                          (row.unscaled ? (
                            <span className="whitespace-nowrap text-right text-home-ink-2" style={{ fontVariantNumeric: 'tabular-nums' }}>
                              {row.amount}
                            </span>
                          ) : (
                            <b className="whitespace-nowrap text-right font-bold tabular-nums">{row.amount}</b>
                          ))}
                      </div>
                    ))}
                    {need.more && (
                      <div className="border-t border-home-rule">
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
              </>
            )}
          </div>

          <div className="mt-auto shrink-0 pt-4">
            {/* Up next: the whole block is one button that moves the view (never a completion). */}
            {view.upNext && (
              <button
                type="button"
                onClick={() => view.upNext && onNavigate(view.upNext.action)}
                aria-label={`${view.upNext.label}: ${view.upNext.stepRef.toLowerCase()}, ${view.upNext.name}. Go to it`}
                className="flex w-full flex-col gap-1.5 border-t border-home-rule pb-4 pt-3.5 text-left text-home-ink"
              >
                <span className="flex w-full items-baseline justify-between">
                  <span className="text-[14px] font-semibold text-home-terracotta-text">{view.upNext.label}</span>
                  <span className="text-[13px] text-home-ink-2">{view.upNext.stepRef}</span>
                </span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[19px] font-extrabold leading-[1.25]">
                  {view.upNext.name}
                  {view.upNext.tag && (
                    <span className="flex-none whitespace-nowrap rounded-full bg-home-sage px-[9px] py-[3px] text-[12px] font-bold text-home-sage-chip-text">
                      {view.upNext.tag}
                    </span>
                  )}
                </span>
                <span className="text-[17px] leading-[1.45] text-home-ink-2">{view.upNext.text}</span>
              </button>
            )}
          </div>
        </div>
        {undoBar}
      </div>

      {footer}
    </div>
  )
}

/** CP3 owner answer 3: "Ready when:" in bold ink, then the cue as stored. */
function CueLine({ cue }: { cue: string }) {
  return (
    <p className="text-[17px] leading-[1.45] text-home-ink">
      <b className="font-bold text-home-ink">{READY_WHEN}</b> {cue}
    </p>
  )
}

/**
 * The strips under the top bar: CP3's sage rails and CP4's terracotta banners (V2Banner).
 * A banner takes a rail's slot, so the footer never moves; the text below moves down once,
 * by the height difference, when a timer ends. CP4.1: only the banners sit above an open
 * sheet's scrim (`z-30`), so they stay visible and tappable; the rails dim with the page.
 * Where the banners end is reported (`onBannerBottom`) so a sheet's top sits below them.
 */
function Strips({
  strips,
  onRail,
  onAction,
  onBannerBottom,
}: {
  strips: StripView[]
  onRail: (rail: RailView) => void
  onAction: (action: ActionDescriptor) => void
  onBannerBottom?: (px: number | null) => void
}) {
  const bannersRef = useRef<HTMLDivElement>(null)
  const banners = strips.filter((s): s is BannerView => s.kind === 'banner')
  const rails = strips.filter((s): s is RailView => s.kind !== 'banner')
  const hasBanners = banners.length > 0

  // The banners' bottom edge, from the top of the cooking screen (their offset parent), kept
  // current as they wrap, appear or go.
  useLayoutEffect(() => {
    const el = bannersRef.current
    if (onBannerBottom == null) return
    if (el == null) {
      onBannerBottom(null)
      return
    }
    const report = () => onBannerBottom(el.offsetTop + el.offsetHeight)
    report()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasBanners, onBannerBottom])

  if (strips.length === 0) return null
  return (
    <div data-strips="true" className="mt-1 flex flex-shrink-0 flex-col gap-px">
      {hasBanners && (
        <div ref={bannersRef} data-banners="true" className="relative z-30 flex flex-col gap-px">
          {banners.map((strip) => (
            <Banner key={`banner-${strip.nodeId}`} strip={strip} onAction={onAction} />
          ))}
        </div>
      )}
      {rails.map((strip) => (
          // CP3 timer rails (V2Running): full-width sage, 48px; the summary rail has no dot
          // (the dot means a running timer), and a › at its right edge (CP3.1).
          <button
            key={strip.kind === 'timer' ? strip.nodeId : 'more'}
            type="button"
            aria-label={strip.aria}
            onClick={() => onRail(strip)}
            className="flex h-12 w-full items-center gap-2.5 bg-home-sage px-5 text-left text-home-ink"
          >
            {strip.kind === 'timer' ? (
              <>
                <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-home-terracotta" />
                <span className="min-w-0 flex-1 truncate text-[16px] font-bold">{strip.name}</span>
                <span className="flex-none whitespace-nowrap text-[16px] font-bold text-home-sage-chip-text" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {strip.left}
                </span>
              </>
            ) : (
              <>
                <span className="flex-1 text-[16px] font-bold">{strip.text}</span>
                <span aria-hidden="true" className="flex-none text-[20px] font-bold leading-none text-home-sage-chip-text">›</span>
              </>
            )}
          </button>
      ))}
    </div>
  )
}

/** V2Banner: one ended timer, with its own "+5 min" and "Done". */
function Banner({ strip, onAction }: { strip: BannerView; onAction: (action: ActionDescriptor) => void }) {
  return (
    <div role="status" className="flex items-center gap-3 bg-home-terracotta px-5 py-3 text-home-ground">
      <div className="min-w-0 flex-1">
        <div className="text-[17px] font-extrabold leading-[1.25]">{strip.title}</div>
        <div className="text-[14px] opacity-[.88]">{strip.line}</div>
      </div>
      <button
        type="button"
        onClick={() => onAction(strip.add.action)}
        className="h-11 flex-none whitespace-nowrap rounded-full border-[1.5px] border-home-ground px-4 text-[15px] font-bold text-home-ground"
      >
        {strip.add.label}
      </button>
      <button
        type="button"
        onClick={() => onAction(strip.done.action)}
        className="h-11 flex-none whitespace-nowrap rounded-full bg-home-ground px-4 text-[15px] font-bold text-home-terracotta-text"
      >
        {strip.done.label}
      </button>
    </div>
  )
}

/** PR 2 CP4.1: headline text with every hyphenated word in a no-wrap span (`noBreakWords`). */
function Headline({ text }: { text: string }) {
  return (
    <>
      {noBreakWords(text).map((part, i) =>
        part.nowrap ? (
          <span key={i} className="whitespace-nowrap">
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  )
}

/** V2Wait: the 52px time left + "Add 5 min", the 4px bar and the ready line. */
function WaitingBlock({ waiting, onAction }: { waiting: NonNullable<CookingView['waiting']>; onAction: (action: ActionDescriptor) => void }) {
  return (
    <div data-waiting="true" className="flex flex-col gap-2.5 pt-1">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <div className="flex items-baseline gap-2" style={{ fontVariantNumeric: 'tabular-nums' }}>
          <span className="text-[52px] font-bold leading-none text-home-ink">{waiting.big}</span>
          {waiting.unit && <span className="text-[18px] font-semibold text-home-ink-2">{waiting.unit}</span>}
        </div>
        <button type="button" onClick={() => onAction(waiting.add.action)} className="h-11 px-1 text-[16px] font-bold text-home-terracotta-text">
          {waiting.add.label}
        </button>
      </div>
      <div aria-hidden="true" className="flex h-1 bg-home-rule">
        <div className="bg-home-terracotta" style={{ width: `${Math.round(waiting.fraction * 1000) / 10}%` }} />
      </div>
      <p className="text-[15px] text-home-ink-2">{waiting.line}</p>
    </div>
  )
}

/** "Meanwhile, do these" (the recipe page's WaitWindowBlock wording, on its field ground):
 * one 44px row per task, each a button to that step (P2: the cook can go anywhere). */
function MeanwhileBlock({
  rows,
  onNavigate,
}: {
  rows: NonNullable<CookingView['waiting']>['meanwhile']
  onNavigate: (action: ActionDescriptor) => void
}) {
  return (
    <div data-meanwhile="true" className="rounded-home-mini bg-field px-3.5 pb-1 pt-3">
      <div className="text-[16px] font-extrabold text-home-ink">Meanwhile, do these</div>
      {rows.map((row) => (
        <button
          key={row.nodeId}
          type="button"
          onClick={() => onNavigate(row.action)}
          className="mt-2 flex min-h-11 w-full items-center gap-2.5 border-t border-home-ink/12 text-left text-[16px]"
        >
          <span className="w-6 flex-none font-bold text-home-terracotta-text" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {row.n}
          </span>
          <span className={`min-w-0 flex-1 ${row.state === 'done' ? 'text-home-ink-2' : 'text-home-ink'}`}>{row.name}</span>
          {row.right && (
            <span className="flex flex-none items-center gap-1 whitespace-nowrap text-[14px] font-bold text-home-sage-chip-text" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {row.state === 'done' && <TickIcon />}
              {row.right}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/** The done screen's picture: full width, 16:9 and at most 30% of the screen's height, cover.
 * (`hqdefault`'s letterbox bars fall outside the 16:9 crop.) A failed load hides it, so there is
 * never a broken image or a gap (as `ContinueStrip` does). */
function Thumbnail({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return <img src={src} alt={alt} onError={() => setFailed(true)} className="block aspect-video max-h-[30vh] w-full object-cover" />
}

/** Undo, over the foot of the scroll area on the cream ground, never inside the footer. One
 * line; a long step name truncates. */
function UndoBar({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="absolute inset-x-0 bottom-0 flex h-11 items-center justify-center bg-home-ground px-5">
      <button type="button" onClick={onClick} className="h-11 max-w-full truncate text-[16px] text-home-ink-2 underline underline-offset-[3px]">
        {label}
      </button>
    </div>
  )
}

/** Footer: Back + the primary pill, nothing else. */
function Footer({
  back,
  primary,
  onNavigate,
  onPrimary,
}: {
  back: ActionButton | null
  primary: ActionButton | null
  onNavigate: (action: ActionDescriptor) => void
  onPrimary: () => void
}) {
  return (
    <div data-footer="true" className="flex-shrink-0 px-5 pb-[calc(24px+var(--safe-bottom))] pt-1">
      {(back || primary) && (
        <div className="flex items-center gap-3">
          {back && (
            <button type="button" onClick={() => onNavigate(back.action)} className="h-[60px] flex-none pl-1 pr-[18px] text-[17px] font-bold text-home-ink">
              Back
            </button>
          )}
          {primary && (
            <button type="button" onClick={onPrimary} className={`flex-1 ${PILL}`}>
              {primary.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

interface MessageButton {
  label: string
  onClick: () => void
}

/** The message layout's body (V2Conflict): a 34/800 heading at 88% width, one 17px line,
 * then a terracotta pill and an outlined pill, centred in the screen. */
function MessageBody({
  heading,
  line,
  primary,
  secondary,
  note,
}: {
  heading: string
  line: ReactNode
  primary: MessageButton | null
  secondary?: MessageButton | null
  note?: string | null
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-6 overflow-y-auto px-6 pb-[calc(24px+var(--safe-bottom))]">
      <div className="flex flex-col gap-2.5">
        <h1 className="text-[34px] font-extrabold leading-[1.06] text-home-ink" style={{ fontStretch: '88%' }}>
          <Headline text={heading} />
        </h1>
        {line && <p className="text-[17px] leading-[1.45] text-home-ink-2">{line}</p>}
      </div>
      <div className="flex flex-col gap-2.5">
        {primary && (
          <button type="button" onClick={primary.onClick} className={`flex w-full items-center justify-center px-3.5 ${PILL}`}>
            {primary.label}
          </button>
        )}
        {secondary && (
          <button type="button" onClick={secondary.onClick} className={`flex w-full items-center justify-center ${OUTLINED}`}>
            {secondary.label}
          </button>
        )}
        {note && <p className="text-[15px] leading-[1.45] text-home-terracotta-text">{note}</p>}
      </div>
    </div>
  )
}

/** PR 2 CP4: a full screen in the message layout with no top bar (V2Conflict, and the honest
 * "couldn't start" line). */
export function MessageScreen(props: {
  heading: string
  line: ReactNode
  primary: MessageButton | null
  secondary?: MessageButton | null
  note?: string | null
}) {
  return (
    <div className="flex h-full flex-col bg-home-ground pt-[var(--safe-top)]">
      <MessageBody {...props} />
    </div>
  )
}
