import type { PlanSummary } from '@abc-cook/schema'

/**
 * Display helpers for minute values.
 *
 * These format; they never compute. Every value passed in originates from the
 * scheduler (CLAUDE.md — the frontend never derives a duration, a capacity or a
 * saving). Adding two minute values together belongs in `abc_cook/schedule/`, not here.
 *
 * Lives in `lib/` rather than beside the Plan view because the Map view (M2.75) and
 * cooking mode (M3) render the same minute values and must round them identically.
 */

/**
 * Trims the scheduler's 0.01-minute quantum for display.
 *
 * Not a computation — the underlying value is unchanged, this only decides how many
 * digits reach the screen.
 */
export function roundMin(min: number): number {
  return Math.round(min)
}

/**
 * A minute count as the UI says it out loud: `"34 min"`, `"1 hr 18 min"`, `"2 hr"`.
 *
 * Used for whole-recipe figures — total time, time saved — where an hours-and-minutes
 * reading is easier to judge than a bare minute count.
 */
export function formatMinutes(min: number): string {
  const whole = roundMin(min)
  if (whole < 60) return `${whole} min`
  const hours = Math.floor(whole / 60)
  const rest = whole % 60
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`
}

/** Nearest multiple of 5 — the header range's lower bound (M3.2). */
export function roundTo5(min: number): number {
  return Math.round(min / 5) * 5
}

/** Next multiple of 5 at or above `min` — the header range's upper bound (M3.2). An
 * honest upper bound must never round down, so this ceils rather than rounds. */
export function roundUpTo5(min: number): number {
  return Math.ceil(min / 5) * 5
}

/** Nearest multiple of 15 — the head-start and wait-row phrasing (M3.2), coarser than
 * the header range because these numbers are read once, not compared against a task. */
export function roundTo15(min: number): number {
  return Math.round(min / 15) * 15
}

/** A single rounded bound, in the header range's own idiom: bare minutes below two
 * hours (a range reads faster as "95–110 min" than as two hour-and-minute strings),
 * `formatMinutes`'s hour notation from two hours up. */
function formatBound(min: number): string {
  return min < 120 ? `${min} min` : formatMinutes(min)
}

/** "45 min", "4h 15m", "4h": the fact tile's short form of `formatMinutes`, so a long range fits one line. */
function formatMinutesCompact(min: number): string {
  const whole = roundMin(min)
  if (whole < 60) return `${whole} min`
  const hours = Math.floor(whole / 60)
  const rest = whole % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

/**
 * The header's primary timing range (M3.2), from a sitting's `elapsed_min` (low) and
 * `elapsed_high_min` (high). Never shows raw scheduler bounds — a 5-minute bucket is
 * the coarsest resolution the product is willing to promise, so both ends are rounded
 * to it before anything else is decided.
 *
 * Under 15 minutes the 5-minute bucket is too coarse relative to the total (a 5 vs. 10
 * split on a 7-9 min recipe misleads more than it clarifies), so this skips bucketing
 * entirely and reports the plain typical time instead.
 */
export function formatRange(low: number, high: number, compact = false): string {
  if (low < 15) return `about ${roundMin(low)} min`

  const lowR = roundTo5(low)
  const highR = roundUpTo5(high)
  if (lowR === highR) return `about ${formatBound(lowR)}`
  if (highR < 120) return `${lowR}–${highR} min`
  return compact ? `${formatMinutesCompact(lowR)}–${formatMinutesCompact(highR)}` : `${formatMinutes(lowR)} – ${formatMinutes(highR)}`
}

/** Whether `formatRange(low, high)` renders as a genuine two-sided range rather than
 * an `about N min` collapse — gates the single-sitting hands-on secondary line, which
 * would be redundant against a single number. Mirrors `formatRange`'s own branching
 * rather than sniffing its output string. */
function isSpread(low: number, high: number): boolean {
  return low >= 15 && roundTo5(low) !== roundUpTo5(high)
}

/** A rough "how long" phrase for a duration the cook reads once and doesn't watch —
 * the head-start line and a wait row's gap, both spans nobody times to the minute.
 * Coarser than the header range on purpose, and collapses to "a day" past 20 hours
 * because a minute count that far out stops being useful precision. */
export function approxDurationPhrase(min: number): string {
  if (min >= 1200) return 'a day'
  return formatMinutes(roundTo15(min))
}

export interface HeaderTiming {
  primary: string
  /** At most one of: the multi-sitting head-start line, or the single-sitting
   * hands-on line. Never both (M3.2) — showing two secondary claims at once is the
   * exact "double timing statement" the design review flagged. */
  secondary: string | null
}

/**
 * `RecipeHeader`'s timing block, computed entirely from `PlanSummary` — the frontend
 * never derives a duration (CLAUDE.md). `summary` is `null` for a plan saved before
 * M3.1 (or one that failed to summarize); that legacy shape falls back to the old
 * bare total, so an existing saved recipe keeps rendering.
 */
export function headerTiming(summary: PlanSummary | null | undefined, totalMin: number, compact = false): HeaderTiming {
  if (!summary || summary.sessions.length === 0) {
    return { primary: compact ? formatMinutesCompact(totalMin) : `${formatMinutes(totalMin)} total`, secondary: null }
  }

  const sessions = summary.sessions
  const last = sessions[sessions.length - 1]
  const low = last.elapsed_min
  // Defensive: a save from before the CP0 clamp could carry a high bound below the
  // low bound for a converging-chains recipe. The field's contract is an upper bound,
  // so it can never read below the number it's supposed to bound.
  const high = Math.max(last.elapsed_high_min, low)

  const primary = formatRange(low, high, compact)

  if (sessions.length > 1) {
    return { primary, secondary: `Start about ${approxDurationPhrase(summary.elapsed_min)} before you eat` }
  }

  if (isSpread(low, high)) {
    const activeR = roundTo5(summary.active_min)
    if (activeR >= 5 && activeR < (low * 2) / 3) {
      return { primary, secondary: `~${activeR} min hands-on` }
    }
  }

  return { primary, secondary: null }
}

/**
 * A duration inside a sentence: "12 min" under an hour, "about 1 hr" (or "about 1 hr 30 min") from an hour
 * up. The compact "4h 45m" form is for the fact tiles only.
 */
export function sentenceMinutes(min: number): string {
  const whole = roundMin(min)
  return whole < 60 ? `${whole} min` : `about ${formatMinutes(min)}`
}

/**
 * The recipe page's hands-on tile: `summary.active_min` to the nearest 5 min with the same `~` as
 * `headerTiming`'s hands-on line. Unlike that line it is always available: it is a fact tile, not a
 * claim that competes with the range, so the "only when informative" suppression doesn't apply. `null`
 * for a plan saved before `summary` existed. Under 5 min the figure is shown whole rather than as 0.
 */
export function handsOnTileText(summary: PlanSummary | null | undefined): string | null {
  if (!summary) return null
  const rounded = roundTo5(summary.active_min)
  return `~${formatMinutesCompact(rounded >= 5 ? rounded : summary.active_min)}`
}

/**
 * A hands-free gap as the cook reads it: `"55 min"`, `"1 hr 45 min"`, `"19 hr"`. R2.
 *
 * Floors, never rounds up: to 5 min below 120 min, to 15 min from 120 min to below 600 min,
 * to a whole hour from 600 min. Displayed minutes are always <= `min`. The step is fine for
 * short waits so the number sits next to a card's own figure without contradicting it
 * (donuts: 57 -> "55 min"). Formatting only; callers add the `~`. A gap under 5 min (not
 * produced by the scheduler's phase threshold) is shown whole-minute rather than as 0.
 */
export function approxWaitPhrase(min: number): string {
  const step = min < 120 ? 5 : min < 600 ? 15 : 60
  const floored = Math.floor(min / step) * step
  return formatMinutes(floored > 0 ? floored : Math.floor(min))
}

/**
 * How far ahead of eating the cook should start, as a phrase: `"3 hr 30 min"`, `"25 hr"`. R2.
 *
 * Ceils, never rounds down — a head start is never understated: to 15 min below 600 min,
 * to a whole hour from 600 min. Displayed minutes are always >= `min`. Formatting only;
 * callers add the `~`.
 */
export function startAheadPhrase(min: number): string {
  const step = min < 600 ? 15 : 60
  return formatMinutes(Math.ceil(min / step) * step)
}
