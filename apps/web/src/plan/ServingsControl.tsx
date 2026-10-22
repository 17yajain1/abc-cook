import { BATCH_LADDER, choiceFactor, servingsBounds, stepChoice, type ServingsChoice } from '@/lib/servings'
import { servingsCopy } from '@/lib/servingsCopy'

/**
 * What the Ingredients tab's servings control can be (R4, A1/A2):
 * - `live`: a stepper. Servings when the recipe states how many it serves, a relative
 *   "Amounts ×1" size when it doesn't (the choice's own mode says which). `unscaled` is how
 *   many amounts the scaler cannot scale at the current factor.
 * - `locked`: a cook is in progress on this plan, so the stepper is disabled and says why.
 * - `gated`: no amount in the recipe can be scaled (hand goldens, a payload from before
 *   `qty_amount`). Only the line, in the control's slot: a stepper that does nothing would
 *   be a lie, even greyed out.
 */
export type ServingsControlState =
  | { kind: 'live'; choice: ServingsChoice; unscaled: number }
  | { kind: 'locked'; choice: ServingsChoice }
  | { kind: 'gated' }

/** The recipe as written, in the same mode as `choice`. */
function resetTarget(choice: ServingsChoice): ServingsChoice {
  return choice.mode === 'servings' ? { ...choice, chosen: choice.original } : { mode: 'batch', multiplier: 1 }
}

/**
 * Port of recipe-page study frame 3: label and sub-line on the left, a pill stepper on the
 * right, 44 px targets. "Reset to N" sits on the sub-line's own row. Times never change with
 * the stepper, which is what the sub-line promises; from factor 2 it says a bigger batch can
 * take longer instead (copy table in `servingsCopy`).
 */
export function ServingsControl({
  state,
  onChange,
}: {
  state: ServingsControlState
  onChange: (choice: ServingsChoice) => void
}) {
  if (state.kind === 'gated') {
    return (
      <div className="px-5 pt-4">
        <p className="text-[13px] leading-[1.4] text-home-ink-2">{servingsCopy(null).gated}</p>
      </div>
    )
  }

  const { choice } = state
  const copy = servingsCopy(choice)
  const locked = state.kind === 'locked'
  const factor = choiceFactor(choice)
  const original = factor === 1
  const bounds =
    choice.mode === 'servings'
      ? servingsBounds(choice.original)
      : { min: BATCH_LADDER[0], max: BATCH_LADDER[BATCH_LADDER.length - 1] }
  const level = choice.mode === 'servings' ? choice.chosen : choice.multiplier
  const atMin = level <= bounds.min
  const atMax = level >= bounds.max

  const button =
    'flex h-11 w-11 items-center justify-center text-[20px] text-home-ink outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-home-ink disabled:text-home-rule'

  return (
    <div className="px-5 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="text-[15px] font-semibold text-home-ink">{copy.label}</div>
          <div className="flex flex-wrap items-baseline gap-x-3 text-[13px] leading-[1.4] text-home-ink-2">
            <span>{locked ? copy.locked : copy.sub}</span>
            {!locked && !original && (
              <button
                type="button"
                onClick={() => onChange(resetTarget(choice))}
                className="relative font-medium underline underline-offset-2 after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']"
              >
                {copy.reset}
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center rounded-full border border-home-rule bg-home-surface">
          <button
            type="button"
            aria-label={copy.dec}
            disabled={locked || atMin}
            onClick={() => onChange(stepChoice(choice, -1))}
            className={button}
          >
            −
          </button>
          <span
            aria-live="polite"
            className={`tabular min-w-[34px] text-center text-[15px] font-semibold ${locked ? 'text-home-ink-2' : 'text-home-ink'}`}
          >
            {copy.value}
          </span>
          <button
            type="button"
            aria-label={copy.inc}
            disabled={locked || atMax}
            onClick={() => onChange(stepChoice(choice, 1))}
            className={button}
          >
            +
          </button>
        </div>
      </div>
      {state.kind === 'live' && !original && state.unscaled > 0 && (
        <p className="mt-2 text-[13px] leading-[1.4] text-home-ink-2">{copy.recipeLine(state.unscaled)}</p>
      )}
    </div>
  )
}

/** What the stepper and the line under the tiles both read: the control's state, resolved once. */
function resolve(state: Exclude<ServingsControlState, { kind: 'gated' }>) {
  const { choice } = state
  const copy = servingsCopy(choice)
  const factor = choiceFactor(choice)
  const bounds =
    choice.mode === 'servings'
      ? servingsBounds(choice.original)
      : { min: BATCH_LADDER[0], max: BATCH_LADDER[BATCH_LADDER.length - 1] }
  const level = choice.mode === 'servings' ? choice.chosen : choice.multiplier
  return { choice, copy, original: factor === 1, atMin: level <= bounds.min, atMax: level >= bounds.max }
}

const tile = 'rounded-home-mini border border-home-rule bg-home-surface'

/**
 * The servings fact tile on the recipe page (D7): the same control as above, with its minus, plus and
 * value in a tile beside the time tiles. A `gated` control is a plain tile showing `staticLine` (the
 * recipe's own servings, if it states one), because a stepper that does nothing would be a lie. The
 * buttons are drawn 28 px and carry a 44 px touch area.
 */
export function ServingsTile({
  state,
  onChange,
  staticLine,
}: {
  state: ServingsControlState
  onChange: (choice: ServingsChoice) => void
  staticLine: string | null
}) {
  if (state.kind === 'gated') {
    if (!staticLine) return null
    return (
      <div className={`${tile} flex min-w-0 flex-col justify-center px-3 py-2.5`}>
        <div className="text-[17px] font-bold leading-[1.15] text-home-ink">{staticLine}</div>
      </div>
    )
  }
  const { choice, copy, atMin, atMax } = resolve(state)
  const locked = state.kind === 'locked'
  const button =
    'relative flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full border border-home-rule bg-home-ground text-[16px] leading-none text-home-ink outline-none after:absolute after:-inset-2 after:content-[""] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-home-ink disabled:text-home-rule'
  return (
    <div className={`${tile} flex min-w-0 items-center justify-between px-1.5 py-1.5`}>
      <button type="button" aria-label={copy.dec} disabled={locked || atMin} onClick={() => onChange(stepChoice(choice, -1))} className={button}>
        −
      </button>
      <div className="min-w-0 text-center">
        <div aria-live="polite" className={`tabular text-[17px] font-bold leading-[1.15] ${locked ? 'text-home-ink-2' : 'text-home-ink'}`}>
          {copy.value}
        </div>
        <div className="text-[12px] leading-[1.25] text-home-ink-2">{copy.label.toLowerCase()}</div>
      </div>
      <button type="button" aria-label={copy.inc} disabled={locked || atMax} onClick={() => onChange(stepChoice(choice, 1))} className={button}>
        +
      </button>
    </div>
  )
}

/**
 * The one line under the tiles that goes with the servings tile: "Times stay the same" (or the times note
 * from factor 2) with Reset, "Cooking for N — finish to change" while locked, the unscaled-amounts line,
 * or, for a gated control, the reason the tile is static. Nothing at the recipe as written with no
 * unscaled amounts to report.
 */
export function ServingsSubline({
  state,
  onChange,
}: {
  state: ServingsControlState
  onChange: (choice: ServingsChoice) => void
}) {
  if (state.kind === 'gated') {
    return <p className="text-[12px] leading-[1.4] text-home-ink-2">{servingsCopy(null).gated}</p>
  }
  const { choice, copy, original } = resolve(state)
  const locked = state.kind === 'locked'
  if (original && !locked) return null
  return (
    <div className="text-[12px] leading-[1.4] text-home-ink-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span>{locked ? copy.locked : copy.sub}</span>
        {!locked && !original && (
          <button
            type="button"
            onClick={() => onChange(resetTarget(choice))}
            className="relative font-medium underline underline-offset-2 after:absolute after:-inset-x-2 after:-inset-y-3 after:content-['']"
          >
            {copy.reset}
          </button>
        )}
      </div>
      {state.kind === 'live' && !original && state.unscaled > 0 && <p className="mt-1">{copy.recipeLine(state.unscaled)}</p>}
    </div>
  )
}
