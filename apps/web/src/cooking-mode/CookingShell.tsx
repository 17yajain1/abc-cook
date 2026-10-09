import type { CookingView, Shell } from './viewModel'

/**
 * `CookingShell` (M3.4 handoff §2): ground, top bar (recipe name · Leave cooking), body
 * column, footer column — one component, ground as a prop, three values (`paper` is
 * used for both the plain calm screens and the `sheet` overlay's dimmed backdrop;
 * `WhatsCookingSheet` renders the sheet panel itself). No card, shadow, gradient or
 * accent — depth is ground value and rule weight only (`DESIGN_SYSTEM.md`).
 */

const GROUND: Record<Shell, { bg: string; ink: string; ink2: string; meta: string; rule: string }> = {
  paper: { bg: 'bg-paper', ink: 'text-ink', ink2: 'text-ink-2', meta: 'text-ink-3', rule: 'border-rule' },
  field: { bg: 'bg-field', ink: 'text-ink', ink2: 'text-ink-2', meta: 'text-ink-2', rule: 'border-rule' },
  dark: { bg: 'bg-ink', ink: 'text-paper', ink2: 'text-paper/60', meta: 'text-paper/60', rule: 'border-paper/25' },
}

/** The two screens that show a current step (V2.1 hierarchy, 1a order reweighted). */
const STEP_SCREENS = new Set(['task', 'handsoff_pending'])

export function CookingShell({
  view,
  onPrimary,
  onSecondary,
  onLeave,
  onSheet,
}: {
  view: CookingView
  onPrimary: () => void
  onSecondary: () => void
  onLeave: () => void
  onSheet: () => void
}) {
  const g = GROUND[view.shell]
  const isStep = STEP_SCREENS.has(view.screenId)
  const hasWhisper = !!(view.whisperText || (view.showLink && view.strip == null))

  return (
    <div className={`flex h-full flex-col ${g.bg}`}>
      {/* V2.1: the recipe name is readable ink, and Leave is a bordered control whose
          44px tap area (the ::after) doesn't grow the bar — findable, still far quieter
          than the solid primary. */}
      <div className="flex flex-shrink-0 items-center justify-between gap-3 px-4 pt-3" style={{ minHeight: 38 }}>
        <span className={`min-w-0 truncate text-[16px] font-semibold ${g.ink}`} style={{ fontStretch: '88%' }}>
          {view.topRecipe}
        </span>
        {view.showTopRight && (
          <button
            type="button"
            onClick={onLeave}
            className={`relative flex-none whitespace-nowrap rounded-control border px-2.5 py-[5px] text-[14px] leading-none after:absolute after:inset-x-0 after:-inset-y-[11px] after:content-[''] ${g.rule} ${g.ink2}`}
          >
            Leave cooking
          </button>
        )}
      </div>

      {/* Body column (B0). The lead-in (124px; 56px on step screens, whose content is
          taller) is a spacer that *shrinks* (down to 24px) before the content is pushed
          below the fold: short screens keep a calm top margin, a long step starts near
          the top and keeps its quantity line in view. Content is `shrink-0`; only the
          spacer yields. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6">
        <div aria-hidden className={`min-h-6 shrink ${isStep ? 'basis-[56px]' : 'basis-[124px]'}`} />
        {isStep ? (
          // V2.1 step screen: step line -> current-step title -> full instruction ->
          // ingredients -> cue. Same 1a order; only the weight moved off the instruction.
          <div className="shrink-0">
            {view.step && (
              <div className={`text-[13px] ${g.ink2}`} style={{ fontVariantNumeric: 'tabular-nums' }}>
                {view.step}
              </div>
            )}
            <h1
              className={`mb-2.5 mt-1 text-[26px] font-semibold leading-[1.12] ${g.ink}`}
              style={{ fontStretch: '88%', textWrap: 'balance' }}
            >
              {view.label}
            </h1>
            <p className={`text-[19px] leading-[1.45] ${g.ink}`} style={{ textWrap: 'pretty' }}>
              {view.title}
            </p>
            {view.qty && <p className={`mt-4 text-[15px] leading-[1.5] ${g.ink2}`}>{view.qty}</p>}
            {view.note && <p className={`mt-3 text-[15px] leading-[1.5] ${g.ink2}`}>{view.note}</p>}
          </div>
        ) : (
          <div className="shrink-0">
            {view.step && <div className={`mb-1 text-[13px] ${g.meta}`}>{view.step}</div>}
            {view.label && <div className={`mb-3 text-[13px] ${g.meta}`}>{view.label}</div>}
            <h1
              className={`text-[30px] font-semibold leading-[1.15] ${g.ink}`}
              style={{ fontStretch: '88%' }}
            >
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
            {view.next && <p className={`mt-4 text-[15px] leading-[1.5] ${g.meta}`}>{view.next}</p>}
          </div>
        )}
      </div>

      <div className="flex-shrink-0 px-6 pb-[34px]">
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

        {/* 1d running-work strip — PROVISIONAL, UNVALIDATED, V-A PENDING. Read-only (O1):
            no control except the existing What's cooking sheet link (main's rule: shown
            whenever anything is running). */}
        {view.strip && (
          <div className="border-t border-ink py-3.5">
            <div className="flex items-baseline gap-2.5">
              <span
                aria-hidden
                className={`h-2 w-2 flex-none self-center ${view.strip.holding ? 'border border-ink' : 'bg-ink'}`}
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

        {isStep && view.next && (
          <div className={`border-t py-3.5 text-[16px] ${g.rule} ${g.ink}`}>{view.next}</div>
        )}

        {view.primary &&
          (view.primary.solid ? (
            <button
              type="button"
              onClick={onPrimary}
              className={`flex h-[56px] w-full items-center justify-center rounded-control border text-[18px] font-semibold ${
                view.shell === 'dark' ? 'border-paper bg-paper text-ink' : 'border-ink bg-ink text-paper'
              }`}
              style={{ fontStretch: '106%' }}
            >
              {view.primary.label}
            </button>
          ) : (
            <button
              type="button"
              onClick={onPrimary}
              className={`flex min-h-[56px] w-full items-center justify-center rounded-control border px-3.5 py-2 text-center text-[18px] font-medium leading-[1.3] ${
                view.shell === 'dark' ? 'border-paper text-paper' : 'border-ink text-ink'
              }`}
            >
              {view.primary.label}
            </button>
          ))}

        {(view.secondary || view.reserveSecondary) && (
          <div className={`pt-3.5 text-center ${view.reserveSecondary ? 'min-h-[46px]' : ''}`}>
            {view.secondary && (
              <button
                type="button"
                onClick={onSecondary}
                className={`underline underline-offset-[3px] ${
                  view.secondary.action.kind === 'undo' ? `text-[16px] ${g.ink2}` : `text-[15px] ${g.meta}`
                }`}
              >
                {view.secondary.label}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
