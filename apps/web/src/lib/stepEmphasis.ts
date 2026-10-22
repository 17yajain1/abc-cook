import type { Ingredient } from '@abc-cook/schema'

import { timePhraseSpans, type TextSpan } from './stepNote'

/**
 * What to put in bold in a step's instruction, so the cook can scan it with wet hands.
 *
 * Three things, in this order of priority, and nothing else:
 *  1. Quantities: a number (or range) directly followed by a unit from a closed list ("1 tbsp", "80-90 ml",
 *     "10g", "1 1/2 cups"), every one in the step. The bold runs on over the next words only when they name
 *     an ingredient this step consumes ("1 tbsp dry yeast", "5 tbsp soft butter"). A bare number with no unit
 *     ("6 triangles", "8 equal portions") is never bold, and neither is a name on its own.
 *  2. Times, from `timePhraseSpans`, the one time vocabulary the app has.
 *  3. Heat: a setting word next to "heat" or "flame", and an oven temperature ("190°", "375°F").
 *
 * Presentational only. The graph has no heat field and no per-step amounts, so this reads the text; the lists
 * are closed on purpose, a miss means plain text, and nothing here feeds a cooking decision. The text is never
 * altered, only wrapped.
 */

export type EmphasisKind = 'quantity' | 'time' | 'heat'
export interface EmphasisSpan extends TextSpan {
  kind: EmphasisKind
}

/** All emphasis needs of an ingredient is its name. */
export type ConsumedIngredient = Pick<Ingredient, 'name'>

// The units seen in the fixtures plus their common spellings. Closed on purpose.
const UNITS = [
  'oz can',
  'tsp',
  'tbsp',
  'teaspoons?',
  'tablespoons?',
  'cups?',
  'kg',
  'kilograms?',
  'grams?',
  'gm',
  'g',
  'ml',
  'litres?',
  'liters?',
  'l',
  'oz',
  'ounces?',
  'lbs?',
  'pounds?',
  'pinch(?:es)?',
  'handfuls?',
  'cloves?',
  'cans?',
  'sachets?',
  'medium',
  'large',
  'small',
].join('|')

const FRACTION_GLYPH = '[¼-¾⅐-⅞]'
// An amount: "1 1/2", "1/2", "½", "1½", "2.5", "10". Mixed numbers come first so "1 1/2" is one number.
const NUMBER = `(?:\\d+\\s\\d+/\\d+|\\d+/\\d+|\\d*${FRACTION_GLYPH}|\\d+(?:[.,]\\d+)?)`
const RANGE = `${NUMBER}(?:\\s*(?:-|–|—|to)\\s*${NUMBER})?`
const NOT_IN_WORD = '(?<![\\p{L}\\p{M}\\p{N}])'
// "10g", "10 g": a space or none between the number and its unit; the unit must end its word.
const QUANTITY = new RegExp(`${NOT_IN_WORD}${RANGE}\\s?(?:${UNITS})(?![\\p{L}\\p{M}])`, 'giu')

// A closed list, on purpose: heat setting words next to "heat" or "flame". "simmer" is not here: it is an
// action, not a setting, and it would bold half the steps. No Hindi forms: none occur in the fixtures.
const HEAT =
  /(?<![\p{L}\p{N}])(?:low|medium|high|full)(?:[\s-]+(?:to\s+)?(?:low|medium|high))?\s+(?:heat|flame)(?![\p{L}\p{N}])/giu
// An oven temperature: "190°", "190 °C", "375°F". A bare number without the degree sign is not one.
const OVEN = /(?<![\p{L}\p{N}])\d{2,3}\s?[°˚º](?:\s?[CF](?![\p{L}\p{M}]))?/giu

const WORD = /^[\p{L}\p{M}'’-]+/u

const overlaps = (a: TextSpan, b: TextSpan): boolean => a.start < b.end && b.start < a.end

const words = (s: string): string[] => s.toLowerCase().split(/\s+/).filter(Boolean)

/**
 * How far the bold runs on past a quantity: over the following words when they name an ingredient this
 * step consumes. "soft butter" counts for the ingredient "Butter" (a descriptor before the name is
 * allowed, at most two words, and an "of" is skipped); anything else leaves the bold at the unit.
 */
function nameEnd(text: string, from: number, consumed: readonly ConsumedIngredient[]): number {
  // Up to a few following plain words, with their end offsets.
  const run: { word: string; end: number }[] = []
  let at = from
  for (let i = 0; i < 8; i++) {
    const rest = text.slice(at)
    const gap = /^[ \t]+/.exec(rest)
    if (!gap) break
    const m = WORD.exec(rest.slice(gap[0].length))
    if (!m) break
    at += gap[0].length + m[0].length
    run.push({ word: m[0].toLowerCase(), end: at })
  }
  let best = from
  for (const ingredient of consumed) {
    const name = words(ingredient.name)
    if (name.length === 0) continue
    const limit = Math.min(run.length, name.length + 2)
    for (let k = name.length; k <= limit; k++) {
      const tail = run.slice(k - name.length, k).map((r) => r.word)
      if (tail.join(' ') !== name.join(' ')) continue
      const lead = run.slice(0, k - name.length).map((r) => r.word)
      // Anything before the name must be one or two descriptors, optionally led by "of".
      const descriptors = lead[0] === 'of' ? lead.slice(1) : lead
      if (descriptors.length > 2) continue
      best = Math.max(best, run[k - 1].end)
      break
    }
  }
  return best
}

/**
 * The spans to bold in `instruction`, sorted and never overlapping (first match wins, in the order
 * quantity, time, heat). At a servings `factor` other than 1 there are no quantity spans: the text quotes
 * the original amounts, and the servings note already says so. Times and heat still bold.
 */
export function emphasisSpans(
  instruction: string,
  consumed: readonly ConsumedIngredient[],
  factor: number,
): EmphasisSpan[] {
  const chosen: EmphasisSpan[] = []
  const add = (span: TextSpan, kind: EmphasisKind) => {
    if (span.end <= span.start || chosen.some((c) => overlaps(c, span))) return
    chosen.push({ ...span, kind })
  }
  if (factor === 1) {
    for (const m of instruction.matchAll(QUANTITY)) {
      const end = m.index + m[0].length
      add({ start: m.index, end: nameEnd(instruction, end, consumed) }, 'quantity')
    }
  }
  for (const span of timePhraseSpans(instruction)) add(span, 'time')
  for (const m of instruction.matchAll(HEAT)) add({ start: m.index, end: m.index + m[0].length }, 'heat')
  for (const m of instruction.matchAll(OVEN)) add({ start: m.index, end: m.index + m[0].length }, 'heat')
  return chosen.sort((a, b) => a.start - b.start)
}
