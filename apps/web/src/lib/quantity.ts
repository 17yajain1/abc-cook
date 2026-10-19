/**
 * Display formatter for a parsed ingredient quantity.
 *
 * `Ingredient.qty` is a single number the scheduler-adjacent extractor already parsed
 * (`abc_cook/extract/graph.py:_parse_qty`); this only renders that one number as the
 * cook expects to read it ("1 1/4", not "1.25"). It never re-derives a quantity, and
 * it is not the primary display path — `Ingredient.qty_text` (the source's own text)
 * is preferred whenever present; this is the fallback for a bare parsed number with no
 * verbatim text alongside it (e.g. the golden fixtures, which predate `qty_text`).
 */

import type { Ingredient } from '@abc-cook/schema'

import { hasNumber } from './amountNumber'
import { scaleQuantity } from './scaleQuantity'

const FRACTION_DENOMINATORS = [2, 3, 4, 8]
const FRACTION_TOLERANCE = 1e-6

function reduceFraction(numerator: number, denominator: number): [number, number] {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const g = gcd(numerator, denominator)
  return [numerator / g, denominator / g]
}

export function formatQty(qty: number | null | undefined): string {
  if (qty == null) return ''

  const whole = Math.floor(qty)
  const frac = qty - whole
  if (frac < FRACTION_TOLERANCE) return String(whole)

  for (const denominator of FRACTION_DENOMINATORS) {
    const numerator = Math.round(frac * denominator)
    if (numerator > 0 && Math.abs(frac - numerator / denominator) < FRACTION_TOLERANCE) {
      const [n, d] = reduceFraction(numerator, denominator)
      const fractionText = `${n}/${d}`
      return whole > 0 ? `${whole} ${fractionText}` : fractionText
    }
  }

  return String(Math.round(qty * 100) / 100)
}

/** Lower-cased, single-spaced, with one trailing ASCII "s" dropped so cup/cups match. */
const fold = (text: string): string =>
  text.trim().toLowerCase().replace(/\s+/g, ' ').replace(/(?<=\S{2})s$/, '')

/**
 * The text of an ingredient's quantity column: the quantity, then the unit, as written.
 *
 * Models often put the unit inside the quantity as well ("1 cup" with unit "cup"), and
 * appending it again read "1 cup cup". The unit is left off when the quantity text already
 * ends with it as a whole word: case-insensitive, cup and cups the same unit, and a unit
 * glued to its number ("250g") counted. "1 cupcake" does not end with "cup", and neither
 * does "1 cup (240 ml)". Display only: it never parses or rewrites a number, and the
 * quantity text itself is kept as written ("2 cups" stays "2 cups").
 */
export function joinQtyUnit(qty: string | null | undefined, unit: string | null | undefined): string {
  const q = (qty ?? '').trim()
  const u = (unit ?? '').trim()
  if (!u) return q
  if (!q) return u
  const foldedQty = fold(q)
  const foldedUnit = fold(u)
  if (foldedQty.endsWith(foldedUnit)) {
    const before = foldedQty.slice(0, foldedQty.length - foldedUnit.length)
    if (before === '' || /[\s\d]$/.test(before)) return q
  }
  return `${q} ${u}`
}

/**
 * An ingredient's quantity column: its amount (scaled by `factor`, else the source's text, else the
 * parsed number) joined with its unit by `joinQtyUnit`. `null` when the line states no amount and no
 * unit. `omitAmount` drops the amount but keeps the unit (the chips' "a handful of ..." rule).
 *
 * `unscaled` is true when the cook asked for a factor other than 1 and this line carries a number
 * the scaler could not scale (`qty_amount` absent: a second amount, a package size, a payload from
 * before the field). It is never true for words ("to taste", "a pinch") and never at factor 1.
 */
export function quantityTrailingScaled(
  item: Pick<Ingredient, 'qty' | 'qty_text' | 'qty_amount' | 'unit'>,
  factor = 1,
  options: {
    formatNumber?: (qty: number | null | undefined) => string
    omitAmount?: (amount: string) => boolean
  } = {},
): { text: string | null; unscaled: boolean } {
  if (item.qty_text == null && item.qty == null && !item.unit) return { text: null, unscaled: false }
  const scaled = scaleQuantity(item, factor)
  let amount = scaled.text ?? (options.formatNumber ?? formatQty)(item.qty)
  const unscaled = factor !== 1 && !scaled.scaled && hasNumber(amount)
  if (amount && options.omitAmount?.(amount)) amount = ''
  return { text: joinQtyUnit(amount, item.unit), unscaled }
}

/** `quantityTrailingScaled`'s text: what every quantity render prints. */
export function quantityTrailing(
  item: Pick<Ingredient, 'qty' | 'qty_text' | 'qty_amount' | 'unit'>,
  factor = 1,
  options: {
    formatNumber?: (qty: number | null | undefined) => string
    omitAmount?: (amount: string) => boolean
  } = {},
): string | null {
  return quantityTrailingScaled(item, factor, options).text
}

/** How many lines at `factor` wear the unscaled marker (the K in "K amounts are for N servings"). */
export function unscaledCount(
  items: ReadonlyArray<Pick<Ingredient, 'qty' | 'qty_text' | 'qty_amount' | 'unit'>>,
  factor: number,
): number {
  return items.filter((item) => quantityTrailingScaled(item, factor).unscaled).length
}
