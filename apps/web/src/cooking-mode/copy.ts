/**
 * Cooking-mode copy helpers — phrasing only, no scheduling or session logic. Every function
 * here is a pure string formatter over values the real selectors already computed.
 */

import type { Node } from '@abc-cook/schema'

import { formatMinutes, roundMin } from '@/lib/duration'

/** Whole calendar days from `now`'s date to `target`'s, in local time (never "under 24 h"). */
function calendarDays(now: number, target: number): number {
  const a = new Date(now)
  const b = new Date(target)
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
      86_400_000,
  )
}

/** PR 2 CP4: "Ready around ‹this›", the time first in the device locale's clock: "1:42 PM",
 * "7:00 AM tomorrow", "7:00 AM in 3 days". "Tomorrow" is the next calendar day. Every space
 * inside the time is a no-break space, so a time never splits from its am/pm. `locale` is
 * for tests. */
export function readyClock(now: number, target: number, locale?: string): string {
  const format = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' })
  const time = format.format(target).replace(/\s/gu, ' ')
  const days = calendarDays(now, target)
  if (days <= 0) return time
  if (days === 1) return `${time} tomorrow`
  return `${time} in ${days} days`
}

/** PR 2 CP4: how long ago a timer ended, as the banner says it: "just now" under a minute,
 * then whole minutes ("4 min ago", `Math.round`, at least 1), then `formatMinutes` from an
 * hour ("1 hr 5 min ago"). Never seconds. */
export function endedAgo(ms: number): string {
  if (ms < 60_000) return 'just now'
  return `${formatMinutes(Math.max(1, Math.round(ms / 60_000)))} ago`
}

/** PR 2 CP4: a time since, in `formatMinutes` style ("45 min", "7 hr", "7 hr 20 min"), each
 * number joined to its unit by a no-break space so "7 / hr" never splits across lines in the
 * stale screen's 34px title. */
export function sinceText(ms: number): string {
  return formatMinutes(Math.max(0, ms) / 60_000).replace(/(\d) /g, '$1 ')
}

/** PR 2 CP4: `text` as a sentence: trimmed, with a full stop added unless it already ends in
 * `.`, `!`, `?` or `…` (a closing quote or bracket after the mark still counts). Every
 * cooking-mode sentence that ends in stored text goes through this, so none ends "..". */
export function sentence(text: string): string {
  const t = text.trim()
  return /[.!?…]["'”’)\]]*$/u.test(t) ? t : `${t}.`
}

/** PR 2 CP4.1: `text` cut into pieces, every word with an inner hyphen ("2-Minute",
 * "ginger-garlic") marked `nowrap`, so a headline never breaks it across lines. A no-wrap
 * span, not U+2011: the self-hosted font subset may not have the non-breaking hyphen. A word
 * is a run without ordinary spaces (a no-break space keeps its words together anyway). The
 * pieces join back to `text` exactly. */
export function noBreakWords(text: string): Array<{ text: string; nowrap: boolean }> {
  const out: Array<{ text: string; nowrap: boolean }> = []
  for (const part of text.split(/( +)/)) {
    if (part === '') continue
    const nowrap = /[\p{L}\p{N}]-[\p{L}\p{N}]/u.test(part)
    const last = out[out.length - 1]
    if (!nowrap && last != null && !last.nowrap) last.text += part
    else out.push({ text: part, nowrap })
  }
  return out
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

/** PR 2 CP3: the not-started hands-off step's line, by its tag (CP3.1): "Hands-off" says
 * "About 1 hr. Start a timer, or just move on."; "Low attention" (`periodic`, which wants
 * the cook now and then) says "About 12 min. Check on it now and then." The length is the
 * plain `formatMinutes`; `null` when the step has no length to name. */
export function handsOffLine(min: number, attention: Node['attention']): string | null {
  if (roundMin(min) < 1) return null
  const tail = attention === 'periodic' ? 'Check on it now and then.' : 'Start a timer, or just move on.'
  return `About ${formatMinutes(min)}. ${tail}`
}

/** PR 2 CP3: the lead-in of the doneness cue line ("Ready when: golden brown"). One
 * constant, for later translation. */
export const READY_WHEN = 'Ready when:'
