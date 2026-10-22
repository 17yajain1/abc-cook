import type { Ingredient } from '@abc-cook/schema'

import { hasNumber } from './amountNumber'
import { quantityTrailingScaled } from './quantity'
import { timePhraseSpans, type TextSpan } from './stepNote'

/**
 * What to put in bold in a step's instruction, so the cook can scan it with wet hands.
 *
 * Three things, in this order of priority, and nothing else:
 *  1. Quantities, from data: the display amount of an ingredient the step consumes, when that exact
 *     amount appears in the text (plus the ingredient's name when it directly follows, so "1 litre milk"
 *     is bolded whole). Partial by nature: the source only sometimes quotes an amount in a step.
 *  2. Times, from `timePhraseSpans`, the one time vocabulary the app has.
 *  3. Heat, from the closed list below.
 *
 * Presentational only. The graph has no heat field and no per-step amounts, so this reads the text; a
 * miss means plain text, and nothing here feeds a cooking decision. The text is never altered, only
 * wrapped.
 */

export type EmphasisKind = 'quantity' | 'time' | 'heat'
export interface EmphasisSpan extends TextSpan {
  kind: EmphasisKind
}

/** The fields of an ingredient the amount is built from (the same ones every quantity render uses). */
export type ConsumedIngredient = Pick<Ingredient, 'name' | 'qty' | 'qty_text' | 'qty_amount' | 'unit'>

// A closed list, on purpose: heat setting words next to "heat" or "flame". "simmer" is not here: it is an
// action, not a setting, and it would bold half the steps. No Hindi forms: none occur in the fixtures.
const HEAT =
  /(?<![\p{L}\p{N}])(?:low|medium|high|full)(?:[\s-]+(?:to\s+)?(?:low|medium|high))?\s+(?:heat|flame)(?![\p{L}\p{N}])/giu

const LETTER_OR_DIGIT = /[\p{L}\p{M}\p{N}]/u

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)

const overlaps = (a: TextSpan, b: TextSpan): boolean => a.start < b.end && b.start < a.end

/** A candidate for `ingredient`'s amount in `text`: the first word-bounded occurrence that is safe to bold. */
function quantitySpan(text: string, ingredient: ConsumedIngredient, times: TextSpan[]): TextSpan | null {
  const amount = quantityTrailingScaled(ingredient, 1).text?.trim()
  // "to taste", "a pinch": words, not amounts worth bolding.
  if (!amount || !hasNumber(amount)) return null
  const name = ingredient.name.trim()
  const re = new RegExp(escape(amount).replace(/\s+/g, String.raw`\s+`), 'giu')
  for (const m of text.matchAll(re)) {
    const start = m.index
    let end = start + m[0].length
    if (start > 0 && LETTER_OR_DIGIT.test(text[start - 1])) continue
    if (end < text.length && LETTER_OR_DIGIT.test(text[end])) continue
    if (times.some((t) => overlaps(t, { start, end }))) continue
    // The name only counts when it directly follows the amount.
    let named = false
    if (name !== '') {
      const spaced = escape(name).replace(/\s+/g, String.raw`\s+`)
      const after = new RegExp(String.raw`^\s+${spaced}(?![\p{L}\p{M}\p{N}])`, 'iu').exec(text.slice(end))
      if (after) {
        end += after[0].length
        named = true
      }
    }
    // A bare number ("2") with nothing after it could be a time or a count of something else.
    if (!named && /^[\d\s.,/¼-¾⅐-⅞०-९]+$/u.test(amount)) continue
    return { start, end }
  }
  return null
}

/**
 * The spans to bold in `instruction`, sorted and never overlapping (first match wins, in the order
 * quantity, time, heat). At a servings `factor` other than 1 there are no quantity spans: the text
 * quotes the original amounts, and the servings note already says so. Times and heat still bold.
 */
export function emphasisSpans(
  instruction: string,
  consumed: readonly ConsumedIngredient[],
  factor: number,
): EmphasisSpan[] {
  const times = timePhraseSpans(instruction)
  const chosen: EmphasisSpan[] = []
  const add = (span: TextSpan, kind: EmphasisKind) => {
    if (span.end <= span.start || chosen.some((c) => overlaps(c, span))) return
    chosen.push({ ...span, kind })
  }
  if (factor === 1) {
    for (const ingredient of consumed) {
      const span = quantitySpan(instruction, ingredient, times)
      if (span) add(span, 'quantity')
    }
  }
  for (const span of times) add(span, 'time')
  for (const m of instruction.matchAll(HEAT)) add({ start: m.index, end: m.index + m[0].length }, 'heat')
  return chosen.sort((a, b) => a.start - b.start)
}
