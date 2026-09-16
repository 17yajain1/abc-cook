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
