import { hasNumber } from './amountNumber'

/**
 * Which cooking steps get "Amounts in this step's text are for N servings." (A4, W1-8).
 *
 * A step's text quotes amounts exactly as the source wrote them, so at a factor other than
 * 1 the screen's chips and the text disagree. The note says so, but only when the text has
 * an amount to disagree about: a number that is a time or a temperature ("Wait 10 min",
 * "350°F") is the same at every batch size and never earns the note.
 *
 * A time or temperature phrase is a number or range (10-15, 10–15, 10 to 15, 1½, 1 1/2)
 * directly followed by a closed list of words: min, mins, minute(s), hr, hrs, hour(s),
 * sec(s), second(s), degree(s), the degree signs (° ˚ º, optionally with C or F) and the
 * Hindi मिनट, घंटा, घंटे, सेकंड. Anything else with a number in it is an amount.
 */

const NUMBER_TOKEN = '(?:[0-9०-९]+(?:[.,/][0-9०-९]+)?|[¼-¾⅐-⅞])'
// "1 1/2" and "1½": a whole number followed by a fraction, with or without a space.
const NUMBER = `${NUMBER_TOKEN}(?:\\s?${NUMBER_TOKEN})?`
const RANGE = `${NUMBER}(?:\\s*(?:-|–|—|to)\\s*${NUMBER})?`
// The time words and the degree word are kept apart so R6b's time note can use the first
// without the second; together, in this order, they are the pattern R4 has always used.
const TIME_EN = 'mins?|minutes?|hrs?|hours?|secs?|seconds?'
const DEGREE_WORDS = 'degrees?'
const TIME_HI = 'मिनट|घंटा|घंटे|सेकंड'
const TIME_WORDS = `(?:${TIME_EN}|${DEGREE_WORDS}|${TIME_HI})`
const TIME_ONLY_WORDS = `(?:${TIME_EN}|${TIME_HI})`
// A word that merely starts with a time word ("2 minced garlic") is not a time word.
const TIME_PHRASE = new RegExp(`${RANGE}\\s*(?:[°˚º]\\s*[CF]?|${TIME_WORDS}(?![\\p{L}\\p{M}]))`, 'giu')

/** The R4 rule's pattern, exposed so a test can prove R6b did not change it. */
export const TIME_PHRASE_SOURCE = TIME_PHRASE.source

/** Whether `text` has a number outside a time or temperature phrase. */
export function textHasAmountNumber(text: string): boolean {
  return hasNumber(text.replace(TIME_PHRASE, ' '))
}

/**
 * Whether a step gets the note: its label (the screen's title) or its instruction has an
 * amount. The "Next: …" preview line is deliberately not asked.
 */
export function stepNeedsAmountNote(label: string | null, instruction: string): boolean {
  return (label != null && textHasAmountNumber(label)) || textHasAmountNumber(instruction)
}

// ---- R6b: times in an edited step ---------------------------------------------------------

/** Cooking mode and the Plan tab, under an edited step whose text has a time (B3 (ii), Q4 (b)). */
export const STEP_TIME_NOTE = 'Timers stay as planned. Changing times comes later.'

/** Under a saved step whose amounts moved while the ingredient rows did not (B20). */
export const STEP_AMOUNT_HINT = "Ingredient amounts don't change with the step. Edit the ingredient if you like."

// Number words, directly before a time word (B10). A closed list, matched whole and case-insensitively.
// The Hindi forms are written in NFC (their composition-excluded letters are decomposed), and the text
// is normalised the same way before it is matched.
const nfc = (s: string): string => s.normalize('NFC')
const EN_SMALL = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty-five|forty'
const EN_ANY = `a few|a couple of|half an|half|an|a|${EN_SMALL}`
// B16: "a second" and "one second" are not times. Before the plural "seconds" only two or more counts.
const EN_AT_LEAST_TWO = `a few|a couple of|${EN_SMALL.replace('one|', '')}`
const HI_AT_LEAST_TWO = nfc('दो|तीन|चार|पांच|पाँच|छह|सात|आठ|नौ|दस|पंद्रह|बीस|तीस|चालीस|ढाई|साढ़े')
const HI_ANY = `${HI_AT_LEAST_TWO}|${nfc('एक|आधा|आधे|डेढ़')}`
const NOT_IN_WORD = '(?<![\\p{L}\\p{M}\\p{N}])'
const NOT_CONTINUED = '(?![\\p{L}\\p{M}])'
const SEP = '(?:\\s+|-)'

const NUMERIC_TIME = new RegExp(`${RANGE}\\s*${TIME_ONLY_WORDS}${NOT_CONTINUED}`, 'iu')
const WORD_TIME = new RegExp(
  [
    `${NOT_IN_WORD}(?:${EN_ANY})${SEP}(?:mins?|minutes?|hrs?|hours?)${NOT_CONTINUED}`,
    `${NOT_IN_WORD}(?:${EN_AT_LEAST_TWO})${SEP}(?:secs|seconds)${NOT_CONTINUED}`,
    `${NOT_IN_WORD}(?:${HI_ANY})\\s+(?:${nfc('मिनट|घंटा|घंटे')})${NOT_CONTINUED}`,
    `${NOT_IN_WORD}(?:${HI_AT_LEAST_TWO})\\s+${nfc('सेकंड')}${NOT_CONTINUED}`,
  ].join('|'),
  'iu',
)

/**
 * Whether `text` states a time: a number or range directly before a time word, or one of a
 * closed list of number words before one ("one hour", "ten minutes", "half hour", "दस मिनट").
 * Degree words and signs are not times, and `TIME_PHRASE` above is untouched, so the R4 amount
 * note is exactly what it was. Neither pattern has a `g` flag, so repeated calls agree.
 */
export function textHasTimePhrase(text: string): boolean {
  const t = nfc(text)
  return NUMERIC_TIME.test(t) || WORD_TIME.test(t)
}

/** A stretch of a string, as `[start, end)` offsets. */
export interface TextSpan {
  start: number
  end: number
}

// The same two patterns `textHasTimePhrase` asks, with a `g` flag so every match is found.
const NUMERIC_TIME_ALL = new RegExp(NUMERIC_TIME.source, 'giu')
const WORD_TIME_ALL = new RegExp(WORD_TIME.source, 'giu')

/**
 * Where `text` states a time, by the same vocabulary as `textHasTimePhrase` ("10 min", "ten minutes",
 * "दस मिनट"). Sorted, never overlapping. Offsets are into `text` as given: it is not normalised here, so
 * a Hindi time written in decomposed form is simply not found (presentational only: plain text).
 */
export function timePhraseSpans(text: string): TextSpan[] {
  const found: TextSpan[] = []
  for (const re of [NUMERIC_TIME_ALL, WORD_TIME_ALL]) {
    re.lastIndex = 0
    for (const m of text.matchAll(re)) found.push({ start: m.index, end: m.index + m[0].length })
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end)
  const out: TextSpan[] = []
  for (const span of found) {
    const last = out[out.length - 1]
    if (last && span.start < last.end) continue
    out.push(span)
  }
  return out
}

// ---- R6b: did the amounts in a step move? ---------------------------------------------------

const NUMBER_RUN = new RegExp(NUMBER, 'gu')
const NUMBER_PIECE = new RegExp(NUMBER_TOKEN, 'gu')
const GLYPHS: Record<string, number> = {
  '¼': 1 / 4, '½': 1 / 2, '¾': 3 / 4, '⅐': 1 / 7, '⅑': 1 / 9, '⅒': 1 / 10, '⅓': 1 / 3, '⅔': 2 / 3,
  '⅕': 1 / 5, '⅖': 2 / 5, '⅗': 3 / 5, '⅘': 4 / 5, '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
}
const asciiDigits = (s: string): string => s.replace(/[०-९]/gu, (d) => String(d.charCodeAt(0) - 0x966))

function pieceValue(piece: string): string {
  if (piece in GLYPHS) return String(GLYPHS[piece])
  const p = asciiDigits(piece)
  const frac = /^(\d+)\/(\d+)$/.exec(p)
  if (frac) return Number(frac[2]) === 0 ? p : String(Number(frac[1]) / Number(frac[2]))
  const n = Number(p.replace(',', '.'))
  return Number.isNaN(n) ? p : String(n)
}

/** The amounts in `text`, as sorted numeric strings, with every time or temperature phrase left out.
 * "1½" and "1 1/2" give the same value; a mixed number is one amount. */
function amountsIn(text: string): string[] {
  const stripped = text.replace(TIME_PHRASE, ' ')
  const out: string[] = []
  for (const run of stripped.match(NUMBER_RUN) ?? []) {
    let sum = 0
    let raw = ''
    for (const piece of run.match(NUMBER_PIECE) ?? []) {
      const v = Number(pieceValue(piece))
      if (Number.isNaN(v)) raw += piece
      else sum += v
    }
    out.push(raw !== '' ? raw : String(Math.round(sum * 10_000) / 10_000))
  }
  return out.sort()
}

/** Cooking mode's version of the amount hint (B26): the page's sentence without its edit clause. */
export const STEP_AMOUNT_NOTE = "Ingredient amounts don't change with the step."

/**
 * B20/B26, the one decision for the page and for cooking mode: the step lists an ingredient (not just a
 * component product), so there is a row to disagree with, and the amounts in its text moved from the
 * imported text.
 */
export function stepAmountHint(imported: string, text: string, consumes: readonly string[] | null | undefined): boolean {
  return (consumes ?? []).some((id) => id.startsWith('ing_')) && stepAmountsChanged(imported, text)
}

/**
 * B20: whether the amounts outside time phrases differ between two step texts, by the same
 * number vocabulary the R4 amount note uses. A changed time alone is not an amount change.
 */
export function stepAmountsChanged(imported: string, edited: string): boolean {
  const a = amountsIn(imported)
  const b = amountsIn(edited)
  return a.length !== b.length || a.some((v, i) => v !== b[i])
}
