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
const TIME_WORDS = '(?:mins?|minutes?|hrs?|hours?|secs?|seconds?|degrees?|मिनट|घंटा|घंटे|सेकंड)'
// A word that merely starts with a time word ("2 minced garlic") is not a time word.
const TIME_PHRASE = new RegExp(`${RANGE}\\s*(?:[°˚º]\\s*[CF]?|${TIME_WORDS}(?![\\p{L}\\p{M}]))`, 'giu')

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
