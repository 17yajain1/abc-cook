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
