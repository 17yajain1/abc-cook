/**
 * Copy helpers ported from the M3.4 design handoff's prototype (`Cooking Mode - M3.4
 * UI.dc.html`) — phrasing only, no scheduling or session logic. Every function here is
 * a pure string formatter over values the real selectors already computed.
 */

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

export function clockStr(ms: number): string {
  const d = new Date(ms)
  const h = d.getHours() % 12 || 12
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'am' : 'pm'}`
}

/** The `long_wait` / `sitting_break` wall-clock line (§6, §8.1): "4:18 pm", "tomorrow,
 * 7:00 am", or "in 3 days, 9:00 am", by calendar-day difference from `now`. */
export function dayClock(now: number, target: number): string {
  const a = new Date(now)
  const b = new Date(target)
  const days = Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) -
      Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) /
      86_400_000,
  )
  if (days === 0) return clockStr(target)
  if (days === 1) return `tomorrow, ${clockStr(target)}`
  return `in ${days} days, ${clockStr(target)}`
}

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
