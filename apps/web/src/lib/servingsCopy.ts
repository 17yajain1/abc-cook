import type { ImportMeta } from '@abc-cook/schema'

import { choiceFactor, reconcileChoice, servingsLine, type ServingsChoice } from './servings'

/**
 * Every string the servings feature shows, in one place (the R4 copy table). Servings mode
 * names people ("for 6 servings"); batch mode, used when the recipe doesn't state its
 * servings, names a relative size ("amounts ×2") and never counts people. `choice` is
 * null only for the gated line, which needs no choice.
 */
const NONE: ServingsChoice = { mode: 'servings', chosen: 1, original: 1 }

const servings = (n: number) => `${n} ${n === 1 ? 'serving' : 'servings'}`
const multiplier = (m: number) => (m === 0.5 ? '½' : m === 1.5 ? '1½' : String(m))

export interface ServingsCopy {
  label: string
  /** The stepper's value: "6" or "×1½". */
  value: string
  /** Under the label: "Times stay the same", or the times note from factor 2. */
  sub: string
  reset: string
  dec: string
  inc: string
  /** The second line under an amount the scaler couldn't scale. */
  marker: string
  /** Accessible label for a chip whose amount is unscaled. */
  chipLabel: (chipText: string) => string
  /** "K amounts are for N servings — scale them yourself." */
  recipeLine: (k: number) => string
  /** Under a cooking step whose text quotes an amount. */
  stepNote: string
  headerMeta: string
  /** The cooking entry screen's line. */
  entry: string
  stepMeta: (n: number, total: number) => string
  locked: string
  gated: string
  /** The times note on its own, or null below factor 2. */
  timesNote: string | null
}

/**
 * CP5.1 U5: the servings line on a Cookbook row. A saved servings choice replaces the recipe's own line,
 * since that line (and its yield text) describes the batch as written: "6 servings", or "Amounts ×2" for a
 * recipe that states no servings. A choice at factor 1, a stale one (made for another version of the
 * recipe) or none falls back to the usual `servingsLine`.
 */
export function savedServingsLine(
  source: Parameters<typeof servingsLine>[0],
  importMeta: ImportMeta | null | undefined,
  choice: unknown,
): string | null {
  const live = reconcileChoice(choice, source, importMeta)
  if (live == null || choiceFactor(live) === 1) return servingsLine(source, importMeta)
  return live.mode === 'servings' ? servings(live.chosen) : servingsCopy(live).headerMeta
}

export function servingsCopy(choice: ServingsChoice | null): ServingsCopy {
  const c = choice ?? NONE
  const factor = choiceFactor(c)
  const byCount = c.mode === 'servings'
  const original = byCount ? servings(c.original) : ''
  const chosen = byCount ? servings(c.chosen) : ''
  const x = byCount ? '' : multiplier(c.multiplier)

  const timesNote =
    factor >= 2
      ? byCount
        ? `Times are for ${original}. A bigger batch can take longer.`
        : 'Times are for the recipe as written. A bigger batch can take longer.'
      : null

  return {
    label: byCount ? 'Servings' : 'Amounts',
    value: byCount ? String(c.chosen) : `×${x}`,
    sub: timesNote ?? 'Times stay the same',
    reset: byCount ? `Reset to ${c.original}` : 'Reset to ×1',
    dec: byCount ? 'Fewer servings' : 'Smaller batch',
    inc: byCount ? 'More servings' : 'Larger batch',
    marker: byCount ? `for ${original}` : 'as written',
    chipLabel: (text) => `${text} — amount ${byCount ? `for ${original}` : 'as written'}`,
    recipeLine: (k) => {
      const where = byCount ? `for ${original}` : 'as written'
      return k === 1
        ? `1 amount is ${where} — scale it yourself.`
        : `${k} amounts are ${where} — scale them yourself.`
    },
    stepNote: byCount
      ? `Amounts in this step's text are for ${original}.`
      : "Amounts in this step's text are for the recipe as written.",
    headerMeta: byCount ? `${chosen} · recipe serves ${c.original}` : `Amounts ×${x}`,
    entry: byCount ? `For ${chosen}` : `Amounts ×${x}`,
    stepMeta: (n, total) =>
      byCount ? `Step ${n} of ${total} · for ${chosen}` : `Step ${n} of ${total} · amounts ×${x}`,
    locked: byCount ? `Cooking for ${c.chosen} — finish to change` : `Cooking at ×${x} — finish to change`,
    gated: "Amounts in this recipe can't be scaled yet.",
    timesNote,
  }
}
