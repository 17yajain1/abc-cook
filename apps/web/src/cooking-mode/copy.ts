/**
 * Copy helpers ported from the M3.4 design handoff's prototype (`Cooking Mode - M3.4
 * UI.dc.html`) — phrasing only, no scheduling or session logic. Every function here is
 * a pure string formatter over values the real selectors already computed.
 */

import { formatMinutes, roundMin } from '@/lib/duration'

const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
  'eighteen', 'nineteen', 'twenty',
]

export function wordFor(n: number): string {
  return WORDS[n] ?? String(n)
}

export function cap(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text
}

/** "about ‹n› minutes" phrasing (§6): spelled out to twenty, then 5-minute buckets,
 * then hours, then days — the wait-window / whisper / away-shell register, never a
 * bare minute count. */
export function aboutMinutes(ms: number): string {
  const n = Math.round(ms / 60_000)
  if (n <= 0) return 'no time'
  if (n <= 20) return `${wordFor(n)} ${n === 1 ? 'minute' : 'minutes'}`
  if (n < 90) return `${Math.round(n / 5) * 5} minutes`
  if (n >= 1440) {
    const d = Math.round(n / 1440)
    return `${wordFor(d)} ${d === 1 ? 'day' : 'days'}`
  }
  const h = Math.round(n / 60)
  return `${wordFor(h)} ${h === 1 ? 'hour' : 'hours'}`
}

/** "About N min left" phrasing for a wait screen's time-left line (P0 #4, owner
 * decision 2026-09-27) — rounded, human-readable, and never m:ss. `Math.ceil`, not
 * `Math.round`: as time passes the displayed number must never go up (89s -> 1 min,
 * 90s -> 2 min would be a jump under `round`). Under a minute reads as its own phrase
 * rather than "0 min left". */
export function minutesLeft(ms: number): string {
  if (ms < 60_000) return 'Less than a minute left'
  return `About ${Math.ceil(ms / 60_000)} min left`
}

/** "4:18 pm" with a no-break space (U+00A0), so a time never splits from its am/pm across lines. */
export function clockStr(ms: number): string {
  const d = new Date(ms)
  const h = d.getHours() % 12 || 12
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'am' : 'pm'}`
}

/** The `long_wait` / `sitting_break` wall-clock line (§6, §8.1): "4:18 pm", "tomorrow,
 * 7:00 am", or "in 3 days, 9:00 am", by calendar-day difference from `now`. `clock`
 * formats the time itself (`clockStr` by default; `localClock` passes the device locale's). */
export function dayClock(now: number, target: number, clock: (ms: number) => string = clockStr): string {
  const a = new Date(now)
  const b = new Date(target)
  const days = Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
      86_400_000,
  )
  if (days === 0) return clock(target)
  if (days === 1) return `tomorrow, ${clock(target)}`
  return `in ${days} days, ${clock(target)}`
}

/** PR 2 CP3: `dayClock` with the time in the device locale's own clock ("1:42 PM",
 * "13:42"); `locale` is for tests. Every space inside the time becomes a no-break space,
 * so a time never splits from its am/pm. */
export function localClock(now: number, target: number, locale?: string): string {
  const format = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' })
  return dayClock(now, target, (ms) => format.format(ms).replace(/\s/gu, ' '))
}

/** PR 2 CP3: a timer's time left, as the rail, the timer sheet and All steps say it. Whole
 * minutes rounded up (`Math.ceil`, so the number never goes up as time passes), never
 * seconds; from an hour, `formatMinutes`' hours and minutes. At or past the end it is
 * "Time's up", with no count (CP4's banner takes that case over). `big` + `unit` is the
 * sheet's split ("52" + "min left"); `text` is the one-line form. */
export function timeLeft(ms: number): { big: string; unit: string | null; text: string } {
  if (ms <= 0) return { big: "Time's up", unit: null, text: "Time's up" }
  const min = Math.ceil(ms / 60_000)
  if (min < 60) return { big: String(min), unit: 'min left', text: `${min} min left` }
  const big = formatMinutes(min)
  return { big, unit: 'left', text: `${big} left` }
}

/** PR 2 CP3: a timer's length as an adjective ("Start 12-min timer", "Start 1-hr timer",
 * "Start 1 hr 30 min timer"): one unit is hyphenated, mixed units are not. Rounded with
 * `roundMin`, the same number `startNode` times; `null` under one minute (no length to name). */
export function timerLength(min: number): string | null {
  const m = roundMin(min)
  if (m < 1) return null
  if (m < 60) return `${m}-min`
  return m % 60 === 0 ? `${m / 60}-hr` : formatMinutes(m)
}

/** PR 2 CP3: the hands-off step's line, "About 1 hr. Start a timer, or just move on."
 * (the plain length, `formatMinutes`). `null` when the step has no length to name. */
export function handsOffLine(min: number): string | null {
  if (roundMin(min) < 1) return null
  return `About ${formatMinutes(min)}. Start a timer, or just move on.`
}

/** PR 2 CP3: the lead-in of the doneness cue line ("Ready when: golden brown"). One
 * constant, for later translation. */
export const READY_WHEN = 'Ready when:'

function firstClause(text: string): string {
  const cuts = ['. ', ', ', ' and ', ' then ', ' until ', ' with ']
  let best = text.length
  for (const cut of cuts) {
    const i = text.indexOf(cut)
    if (i > 12 && i < best) best = i
  }
  return text.slice(0, best).replace(/[.,]$/, '')
}

export interface SplitCopy {
  title: string
  body: string | null
}

/**
 * Title and body from one instruction (design decision §8.7 / handoff §3): the first
 * sentence is the title, the remainder is the body, so nothing is ever printed twice.
 * A first sentence too long for a 30px title falls back to its first clause, and then
 * the whole instruction carries the body.
 */
export function splitCopy(instruction: string): SplitCopy {
  const t = instruction.trim()
  const i = t.indexOf('. ')
  const first = i > 0 ? t.slice(0, i + 1) : t
  if (first.length <= 92) return { title: first.replace(/\.$/, ''), body: i > 0 ? t.slice(i + 2) : null }
  return { title: firstClause(first), body: t }
}
