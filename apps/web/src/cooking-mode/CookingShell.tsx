import type { CookingView, Shell } from './viewModel'

/**
 * `CookingShell` (M3.4 handoff §2): ground, top bar (recipe name · Leave cooking), body
 * column, footer column — one component, ground as a prop, three values (`paper` is
 * used for both the plain calm screens and the `sheet` overlay's dimmed backdrop;
 * `WhatsCookingSheet` renders the sheet panel itself). No card, shadow, gradient or
 * accent — depth is ground value and rule weight only (`DESIGN_SYSTEM.md`).
 */

const GROUND: Record<Shell, { bg: string; ink: string; meta: string; rule: string }> = {
  paper: { bg: 'bg-paper', ink: 'text-ink', meta: 'text-ink-3', rule: 'border-rule' },
  field: { bg: 'bg-field', ink: 'text-ink', meta: 'text-ink-2', rule: 'border-rule' },
  dark: { bg: 'bg-ink', ink: 'text-paper', meta: 'text-paper/60', rule: 'border-paper/25' },
}

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
  const hasWhisper = !!(view.whisperText || view.showLink)

  return (
    <div className={`flex h-full flex-col ${g.bg}`}>
      <div className="flex flex-shrink-0 items-center justify-between px-4 pt-3.5" style={{ minHeight: 32 }}>
        <span className={`text-[13px] ${g.meta}`}>{view.topRecipe}</span>
        {view.showTopRight && (
          <button
            type="button"
            onClick={onLeave}
            className={`text-[13px] underline underline-offset-[3px] ${g.meta}`}
          >
            Leave cooking
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-[124px]">
        {view.label && <div className={`mb-3 text-[13px] ${g.meta}`}>{view.label}</div>}
        <h1
          className={`text-[30px] font-semibold leading-[1.15] ${g.ink}`}
          style={{ fontStretch: '88%' }}
        >
          {view.title}
        </h1>
        {view.instr && <p className={`mt-5 text-[18px] leading-[1.55] ${g.ink}`}>{view.instr}</p>}
        {view.qty && <p className={`mt-4 text-[15px] leading-[1.5] ${g.meta}`}>{view.qty}</p>}
        {view.note && <p className={`mt-4 text-[15px] leading-[1.5] ${g.meta}`}>{view.note}</p>}
      </div>

      <div className="flex-shrink-0 px-6 pb-[34px]">
        {hasWhisper && (
          <div className={`flex flex-col items-start gap-2 border-t py-[18px] ${g.rule}`}>
            {view.whisperText && <p className={`text-[18px] leading-[1.5] ${g.ink}`}>{view.whisperText}</p>}
            {view.showLink && (
              <button
                type="button"
                onClick={onSheet}
                className={`text-[15px] underline underline-offset-[3px] ${g.meta}`}
              >
                What&apos;s cooking
              </button>
            )}
          </div>
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

        {view.secondary && (
          <div className="pt-3.5 text-center">
            <button
              type="button"
              onClick={onSecondary}
              className={`text-[15px] underline underline-offset-[3px] ${g.meta}`}
            >
              {view.secondary.label}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
