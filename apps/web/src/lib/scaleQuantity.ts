import type { Ingredient } from '@abc-cook/schema'

/**
 * Multiply an ingredient's amount by a servings factor, without ever lying about it.
 *
 * The amount was parsed on the backend (`Ingredient.qty_amount`, set only when the parser was
 * certain); this only multiplies it and rounds it the way a cook would measure it. It never
 * parses text, never converts units and never rewrites a word ("2 cup" stays "2 cup").
 *
 * Returns the amount text only: each caller still joins unit and name itself, so layout is
 * untouched. At factor 1, or whenever the amount cannot be scaled (no `qty_amount`: vague, a
 * second amount, a package size, or a recipe saved before the field existed), `text` is the
 * source's own `qty_text` verbatim and `scaled` is false.
 */
export interface ScaledQuantity {
  text: string | null
  scaled: boolean
}

type UnitClass = 'metricSmall' | 'metricLarge' | 'spoonCup' | 'count'

/**
 * The closed unit vocabulary: lower-case, plurals listed rather than stripped. Anything not
 * here is a count (medium, large, nos, piece, clove, inch, pinch, ...). Mirrors the backend's
 * `MEASURE_UNITS` (`abc_cook/extract/quantity.py`), which the package-size rule uses.
 */
const UNIT_CLASSES: Readonly<Record<string, UnitClass>> = {
  g: 'metricSmall',
  gm: 'metricSmall',
  gms: 'metricSmall',
  gram: 'metricSmall',
  grams: 'metricSmall',
  ml: 'metricSmall',
  millilitre: 'metricSmall',
  millilitres: 'metricSmall',
  milliliter: 'metricSmall',
  milliliters: 'metricSmall',
  kg: 'metricLarge',
  kgs: 'metricLarge',
  kilogram: 'metricLarge',
  kilograms: 'metricLarge',
  l: 'metricLarge',
  litre: 'metricLarge',
  litres: 'metricLarge',
  liter: 'metricLarge',
  liters: 'metricLarge',
  tsp: 'spoonCup',
  tsps: 'spoonCup',
  teaspoon: 'spoonCup',
  teaspoons: 'spoonCup',
  tbsp: 'spoonCup',
  tbsps: 'spoonCup',
  tablespoon: 'spoonCup',
  tablespoons: 'spoonCup',
  cup: 'spoonCup',
  cups: 'spoonCup',
  katori: 'spoonCup',
  katoris: 'spoonCup',
  glass: 'spoonCup',
  glasses: 'spoonCup',
  oz: 'spoonCup',
  ounce: 'spoonCup',
  ounces: 'spoonCup',
  lb: 'spoonCup',
  lbs: 'spoonCup',
  pound: 'spoonCup',
  pounds: 'spoonCup',
  pint: 'spoonCup',
  pints: 'spoonCup',
  quart: 'spoonCup',
  quarts: 'spoonCup',
}

const FIRST_WORD_RE = /^[^\p{L}]*(\p{L}+)/u

const firstWord = (text: string | null | undefined): string | null =>
  FIRST_WORD_RE.exec(text ?? '')?.[1]?.toLowerCase() ?? null

/** The unit's class: the `unit` field, or the first word of the text after the number. */
export function unitClass(unit: string | null | undefined, rest: string): UnitClass {
  const word = firstWord(unit) ?? firstWord(rest)
  return (word != null ? UNIT_CLASSES[word] : undefined) ?? 'count'
}

/** Float error sits at the 1e-15 level; snapping first keeps an exact boundary on its side. */
const snap = (x: number): number => Math.round(x * 1e9) / 1e9

/** Nearest, with an exact half rounding up (`Math.round`). */
const roundTo = (x: number, step: number): number => Math.round(snap(x / step)) * step

const trimDecimal = (x: number): string => x.toFixed(2).replace(/\.?0+$/, '')

/** The fractions a cook measures with, ascending; ties round to the larger. */
const FRACTIONS: ReadonlyArray<readonly [number, string]> = [
  [0, ''],
  [0.25, '¼'],
  [1 / 3, '⅓'],
  [0.5, '½'],
  [2 / 3, '⅔'],
  [0.75, '¾'],
  [1, ''],
]

function formatMetricSmall(value: number): string {
  return String(value >= 10 ? roundTo(value, 5) : Math.max(1, Math.round(value)))
}

function formatMetricLarge(value: number): string {
  return trimDecimal(Math.max(0.05, roundTo(value, 0.05)))
}

function formatSpoonCup(value: number): string {
  // Below a quarter the smallest measures are ⅛ and ¼ (never zero); ⅛ appears nowhere else.
  if (value < 0.25) return value < 0.1875 ? '⅛' : '¼'
  const whole = Math.floor(value)
  const frac = snap(value - whole)
  let best = FRACTIONS[0]
  for (const candidate of FRACTIONS) {
    if (Math.abs(frac - candidate[0]) <= Math.abs(frac - best[0])) best = candidate
  }
  if (best[0] === 1) return String(whole + 1)
  return `${whole > 0 ? whole : ''}${best[1]}`
}

function formatCount(value: number): string {
  const halves = Math.max(1, Math.round(snap(value * 2)))
  const whole = Math.floor(halves / 2)
  const half = halves % 2 === 1
  if (!half) return String(whole)
  return `${whole > 0 ? whole : ''}½`
}

const FORMATTERS: Record<UnitClass, (value: number) => string> = {
  metricSmall: formatMetricSmall,
  metricLarge: formatMetricLarge,
  spoonCup: formatSpoonCup,
  count: formatCount,
}

const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps

/**
 * R6 (A28): the amount a cook typed, with only the exact cooking-fraction equivalents snapped to
 * their fraction (.25, .5, .75, .33 and .333 as a third, .67 and .667 as two thirds). Anything
 * else is kept as typed, rounded to 2 decimals. Unlike the scaler's formatters it never rounds to
 * a coarser measure: 12 g stays 12, not 10.
 */
export function snapAmount(value: number): number {
  const whole = Math.floor(value + 1e-9)
  const frac = value - whole
  if (near(frac, 0.25) || near(frac, 0.5) || near(frac, 0.75)) return whole + Math.round(frac * 100) / 100
  if (near(frac, 1 / 3, 1e-6) || near(frac, 0.33) || near(frac, 0.333)) return whole + 1 / 3
  if (near(frac, 2 / 3, 1e-6) || near(frac, 0.67) || near(frac, 0.667)) return whole + 2 / 3
  return Math.round(value * 100) / 100
}

/**
 * R6: one amount as the editor writes `qty_text`: cooking fractions (½, never 0.5) for the exact
 * equivalents, the number as typed otherwise. It shares the scaler's fraction table, so an edited
 * line and a scaled line read the same way.
 */
export function formatAmount(value: number): string {
  const snapped = snapAmount(value)
  const whole = Math.floor(snapped + 1e-9)
  const frac = snapped - whole
  if (near(frac, 0)) return String(whole)
  for (const [fraction, glyph] of FRACTIONS) {
    if (glyph !== '' && near(frac, fraction, 1e-6)) return `${whole > 0 ? whole : ''}${glyph}`
  }
  return String(snapped)
}

/** R6: `low`, or `low–high` (an en dash) for a range. */
export function formatAmountRange(low: number, high: number | null | undefined): string {
  return high == null ? formatAmount(low) : `${formatAmount(low)}–${formatAmount(high)}`
}

/**
 * `ingredient`'s amount at `factor` (chosen servings / original servings).
 *
 * @param ingredient Only `qty_text`, `qty_amount` and `unit` are read.
 * @param factor Multiplier. 1, non-finite or non-positive leaves the amount as written.
 */
export function scaleQuantity(
  ingredient: Pick<Ingredient, 'qty_text' | 'qty_amount' | 'unit'>,
  factor: number,
): ScaledQuantity {
  const asWritten: ScaledQuantity = { text: ingredient.qty_text ?? null, scaled: false }
  const amount = ingredient.qty_amount
  if (factor === 1 || !Number.isFinite(factor) || factor <= 0 || amount == null) return asWritten

  const format = FORMATTERS[unitClass(ingredient.unit, amount.rest ?? '')]
  const low = format(snap(amount.low * factor))
  let amountText = low
  if (amount.high != null) {
    const high = format(snap(amount.high * factor))
    // Two ends that round to the same value are one value.
    amountText = high === low ? low : `${low}–${high}`
  }
  return { text: `${amount.prefix ?? ''}${amountText}${amount.rest ?? ''}`, scaled: true }
}
