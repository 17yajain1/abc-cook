import type { TickState } from './stepPage'
import type { ActionDescriptor, CookingView, Shell } from './viewModel'

/**
 * `CookingShell` (M3.4 handoff §2, PR 2 CP2's v2 frame): top bar (recipe name · Leave),
 * progress ticks, body column, footer — one component. PR 2 CP2 puts every cooking screen
 * on the Home register's one cream ground (`home/tokens.css`, shared, not aliased); the
 * three `Shell` values all resolve to it now and CP4 removes the type. The step pages
 * (`task`, `handsoff_pending`, `step_running`, `step_done`) get the v2 layout: "Step N of M",
 * name, text, Up next pinned to the bottom of the content, then Back + a terracotta pill.
 * Every other screen keeps today's layout and copy, recoloured.
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
  onPrimary,
  onSecondary,
  onLeave,
  onSheet,
  onNavigate,
}: {
  view: CookingView
  onPrimary: () => void
  onSecondary: () => void
  onLeave: () => void
  onSheet: () => void
  /** Up next and Back: a `view` action, navigation only. */
  onNavigate: (action: ActionDescriptor) => void
}) {
  const g = GROUND[view.shell]
  const isStep = STEP_SCREENS.has(view.screenId)
  const hasWhisper = !!(view.whisperText || (view.showLink && view.strip == null))

  // Today's whisper / running strip / What's cooking link, recoloured (CP3 replaces them
  // with the rail). On a step page it sits above Up next; elsewhere, in the footer.
  const background = (
    <>
      {hasWhisper && (
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
      )}

      {/* 1d running-work strip — Owner-selected, not usability-validated; reopen
          condition in the design record. Read-only (O1):
          no control except the existing What's cooking sheet link (main's rule: shown
          whenever anything is running). */}
      {view.strip && (
        <div className={`border-t py-3.5 ${g.rule}`}>
          <div className="flex items-baseline gap-2.5">
            <span
              aria-hidden
              className={`h-2 w-2 flex-none self-center ${view.strip.holding ? 'border border-home-ink' : 'bg-home-ink'}`}
            />
            <span className={`flex-1 text-[16px] ${g.ink}`}>{view.strip.label}</span>
            <span className={`whitespace-nowrap text-[16px] ${g.ink}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {view.strip.right}
            </span>
          </div>
          {view.strip.sub && <div className={`pl-[18px] text-[13px] ${g.ink2}`}>{view.strip.sub}</div>}
          {view.showLink && (
            <button
              type="button"
              onClick={onSheet}
              className={`relative mt-1.5 pl-[18px] text-[15px] underline underline-offset-[3px] after:absolute after:inset-x-0 after:-inset-y-[11px] after:content-[''] ${g.meta}`}
            >
              What&apos;s cooking
            </button>
          )}
        </div>
      )}
    </>
  )

  const secondary = (view.secondary || view.reserveSecondary) && (
    <div className={`flex items-center justify-center text-center ${isStep ? 'pb-1' : 'pt-3.5'} ${view.reserveSecondary ? 'min-h-[46px]' : ''}`}>
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
              fills the space a short step leaves. */}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-5">
            <div className="flex shrink-0 flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                {view.step && (
                  <span
                    className={`flex h-8 items-center gap-1.5 self-start text-[15px] font-semibold ${g.ink2}`}
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    <ListIcon />
                    {view.step}
                  </span>
                )}
                <h1
                  className={`text-[26px] font-extrabold leading-[1.15] tracking-[-0.005em] ${g.ink}`}
                  style={{ textWrap: 'balance' }}
                >
                  {view.label}
                </h1>
              </div>
              <p className={`max-w-[350px] text-[24px] leading-[1.42] ${g.ink}`} style={{ textWrap: 'pretty' }}>
                {view.title}
              </p>
              {view.stateLine && <p className={note}>{view.stateLine}</p>}
              {view.addedNote && <p className={note}>{view.addedNote}</p>}
              {/* R4: at a servings factor other than 1, the step's own text still quotes the
                  source's amounts, while the chips below are scaled. Said once, quietly. */}
              {view.servingsNote && <p className={note}>{view.servingsNote}</p>}
              {view.timesNote && <p className={note}>{view.timesNote}</p>}
              {/* F2 ingredient chips (CP3 replaces them with You'll need rows): amount + name
                  per ingredient. Display only — a list, not controls: no handler, no button
                  role, no focus. A chip wraps internally only when its phrase cannot fit a
                  full line on its own, so no amount is ever cut. */}
              {view.chipItems.length > 0 && (
                <ul role="list" aria-label="Ingredients" className="flex flex-wrap gap-x-1.5 gap-y-1">
                  {/* An amount the scaler could not scale keeps its own text and gets a dashed
                      ink-2 outline (R4 W1-3) plus an accessible name that says so. The mark is
                      visual, never text: the phrase itself is unchanged. */}
                  {view.chipItems.map((chip) => (
                    <li
                      key={chip.text}
                      aria-label={chip.label}
                      className={`rounded-control border px-2.5 py-[2.25px] text-[14px] leading-[1.25] break-words ${
                        chip.unscaled ? `border-dashed ${g.mark}` : g.rule
                      } ${g.ink}`}
                    >
                      {chip.text}
                    </li>
                  ))}
                </ul>
              )}
              {view.note && <p className={note}>{view.note}</p>}
              {/* R6b B3 (ii), B21: said in the doneness-cue line's own style, after it. No "Edited" mark. */}
              {view.stepTimeNote && <p className={note}>{view.stepTimeNote}</p>}
              {view.stepAmountNote && <p className={note}>{view.stepAmountNote}</p>}
            </div>

            <div className="mt-auto shrink-0 pt-4">
              {background}
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

          {/* Footer: the secondary slot (Skip for now / Undo; its height is kept so the
              primary never moves), then Back + the primary pill. */}
          <div className="flex-shrink-0 px-5 pb-[calc(24px+var(--safe-bottom))] pt-1">
            {secondary}
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
