import { roundUpTo5 } from './duration'

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "8:45 pm": 12-hour, lower-case am/pm, no leading zero on the hour. Local time. */
function clock(at: Date): string {
  const h = at.getHours()
  const m = at.getMinutes()
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}

/** Calendar days from `from` to `to`, by local date (not by 24-hour spans). */
function dayGap(from: Date, to: Date): number {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()
  const end = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime()
  return Math.round((end - start) / 86_400_000)
}

/**
 * The plan-ahead card's bold line: when it is ready if the cook starts now. `upperMin` is the upper end of the
 * plan's own range; it is rounded up to 5 min and added to `now`, and the clock time is then rounded up to the
 * next 5 min, so the time is never earlier than the plan's upper bound. A time on its own would mislead once
 * the cook crosses midnight, so the day is named: "tomorrow", or the weekday beyond that.
 *
 * `now` is passed in, never read here, so a test or a screenshot can freeze the clock.
 */
export function readyAroundText(now: Date, upperMin: number): string {
  const ready = new Date(now.getTime() + roundUpTo5(upperMin) * 60_000)
  const extra = (5 - (ready.getMinutes() % 5)) % 5
  const rounded = new Date(ready.getTime() + extra * 60_000)
  const gap = dayGap(now, rounded)
  const day = gap <= 0 ? '' : gap === 1 ? ' tomorrow' : ` on ${WEEKDAYS[rounded.getDay()]}`
  return `Start now and it's ready around ${clock(rounded)}${day}.`
}
