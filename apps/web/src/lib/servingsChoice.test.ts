import { describe, expect, it } from 'vitest'

import type {
  Ingredient,
  RecipePlanResponse,
  ServingsByBatch,
  ServingsByCount,
  ServingsChoice as GeneratedServingsChoice,
} from '@abc-cook/schema'

import croissant from '@/__fixtures__/croissant.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import kadhi from '@/__fixtures__/kadhi-pakora.plan-response.json'
import pizza from '@/__fixtures__/pizza-dough.plan-response.json'

import {
  BATCH_LADDER,
  choiceFactor,
  parseChoice,
  reconcileChoice,
  scalability,
  servingsBounds,
  servingsControlKind,
  servingsLine,
  servingsStated,
  SERVINGS_DEFAULTED_WARNING,
  stepChoice,
  type ServingsChoice,
} from './servings'
import { savedServingsLine, servingsCopy } from './servingsCopy'
import { quantityTrailing } from './quantity'
import { scaleQuantity } from './scaleQuantity'

const KADHI = kadhi as RecipePlanResponse
const PIZZA = pizza as RecipePlanResponse
const CROISSANT = croissant as RecipePlanResponse
const KADAI = kadaiPaneer as RecipePlanResponse

const S = (chosen: number, original: number): ServingsChoice => ({ mode: 'servings', chosen, original })
const B = (multiplier: 0.5 | 1 | 1.5 | 2 | 3): ServingsChoice => ({ mode: 'batch', multiplier })
const stated = { servings: 4, servings_stated: true }
const defaulted = { servings: 4, servings_stated: false }

describe('choiceFactor', () => {
  it('is chosen / original in servings mode, passed on raw', () => {
    expect(choiceFactor(S(6, 4))).toBe(1.5)
    expect(choiceFactor(S(2, 4))).toBe(0.5)
    expect(choiceFactor(S(3, 4))).toBe(0.75)
    expect(choiceFactor(S(8, 3))).toBe(8 / 3)
  })
  it('is the multiplier in batch mode', () => {
    for (const m of [0.5, 1, 1.5, 2, 3] as const) expect(choiceFactor(B(m))).toBe(m)
  })
  it('missing or null is 1', () => {
    expect(choiceFactor(null)).toBe(1)
    expect(choiceFactor(undefined)).toBe(1)
  })
  it('adds no rounding of its own: the tab text is scaleQuantity at chosen/original', () => {
    const items = KADHI.graph.ingredients
    for (const c of [S(2, 4), S(6, 4), S(8, 4), S(3, 4)]) {
      for (const item of items) {
        expect(quantityTrailing(item, choiceFactor(c))).toBe(
          quantityTrailing(item, c.mode === 'servings' ? c.chosen / c.original : 1),
        )
        expect(scaleQuantity(item, choiceFactor(c)).text).toBe(scaleQuantity(item, (c as { chosen: number }).chosen / 4).text)
      }
    }
  })
})

describe('servingsBounds (Q3: 1 .. max(2n, n + 4))', () => {
  it.each([
    [1, 5],
    [3, 7],
    [4, 8],
    [6, 12],
    [8, 16],
    [12, 24],
  ])('original %i -> max %i', (n, max) => {
    expect(servingsBounds(n)).toEqual({ min: 1, max })
  })
})

describe('stepChoice', () => {
  it('moves servings by one and stops at the bounds', () => {
    expect(stepChoice(S(4, 4), 1)).toEqual(S(5, 4))
    expect(stepChoice(S(4, 4), -1)).toEqual(S(3, 4))
    expect(stepChoice(S(1, 4), -1)).toEqual(S(1, 4))
    expect(stepChoice(S(8, 4), 1)).toEqual(S(8, 4))
  })
  it('walks the batch ladder and stops at the ends', () => {
    expect(stepChoice(B(1), 1)).toEqual(B(1.5))
    expect(stepChoice(B(1.5), 1)).toEqual(B(2))
    expect(stepChoice(B(2), 1)).toEqual(B(3))
    expect(stepChoice(B(3), 1)).toEqual(B(3))
    expect(stepChoice(B(1), -1)).toEqual(B(0.5))
    expect(stepChoice(B(0.5), -1)).toEqual(B(0.5))
  })
})

describe('servingsStated', () => {
  it('is the schema flag', () => {
    expect(servingsStated(stated)).toBe(true)
    expect(servingsStated(defaulted)).toBe(false)
  })
  it('treats a missing flag as stated, unless the legacy warning remembers the default', () => {
    expect(servingsStated({ servings: 4 })).toBe(true)
    expect(
      servingsStated(
        { servings: 4 },
        { warnings: [SERVINGS_DEFAULTED_WARNING] } as unknown as Parameters<typeof servingsStated>[1],
      ),
    ).toBe(false)
  })
})

describe('reconcileChoice (A2)', () => {
  it('keeps a valid servings choice for a stated recipe', () => {
    expect(reconcileChoice(S(6, 4), stated)).toEqual(S(6, 4))
  })
  it('keeps a valid batch choice for a defaulted recipe', () => {
    expect(reconcileChoice(B(2), defaulted)).toEqual(B(2))
  })
  it('drops a servings choice whose original is not the payload servings', () => {
    expect(reconcileChoice(S(6, 4), { servings: 6, servings_stated: true })).toBeNull()
  })
  it('drops a choice whose mode no longer matches stated / defaulted', () => {
    expect(reconcileChoice(S(6, 4), defaulted)).toBeNull()
    expect(reconcileChoice(B(2), stated)).toBeNull()
  })
  it('drops a multiplier that is not on the list', () => {
    expect(reconcileChoice({ mode: 'batch', multiplier: 2.5 }, defaulted)).toBeNull()
  })
  it('clamps chosen into the bounds', () => {
    expect(reconcileChoice(S(99, 4), stated)).toEqual(S(8, 4))
    expect(reconcileChoice(S(0, 4), stated)).toBeNull() // a zero headcount is malformed (R4b), not clamped
  })
  it('drops anything malformed', () => {
    for (const bad of [null, undefined, 3, 'x', {}, { mode: 'servings' }, { mode: 'servings', chosen: 'a', original: 4 }, { mode: 'servings', chosen: 2.5, original: 4 }, { mode: 'other' }]) {
      expect(reconcileChoice(bad, stated)).toBeNull()
    }
  })
})

describe('parseChoice (shape only, for the stored session)', () => {
  it('accepts both shapes and rejects the rest', () => {
    expect(parseChoice(S(6, 4))).toEqual(S(6, 4))
    expect(parseChoice(B(1.5))).toEqual(B(1.5))
    expect(parseChoice({ mode: 'batch', multiplier: 7 })).toBeNull()
    expect(parseChoice('x')).toBeNull()
    expect(parseChoice(undefined)).toBeNull()
  })
  it('rejects a headcount below 1, as the generated schema does (R4b)', () => {
    expect(parseChoice({ mode: 'servings', chosen: 0, original: 4 })).toBeNull()
    expect(parseChoice({ mode: 'servings', chosen: -2, original: 4 })).toBeNull()
    expect(parseChoice({ mode: 'servings', chosen: 1.5, original: 4 })).toBeNull()
  })
})

describe('the generated ServingsChoice (R4b)', () => {
  it('accepts both shapes, and the app re-exports that same type', () => {
    const count: ServingsByCount = { mode: 'servings', chosen: 6, original: 4 }
    const batch: ServingsByBatch = { mode: 'batch', multiplier: 1.5 }
    const generated: GeneratedServingsChoice[] = [count, batch]
    const app: ServingsChoice[] = generated
    expect(app.map((c) => choiceFactor(c))).toEqual([1.5, 1.5])
  })
  it('BATCH_LADDER satisfies the generated multiplier set, value for value', () => {
    const ladder: readonly ServingsByBatch['multiplier'][] = BATCH_LADDER
    expect(ladder).toEqual([0.5, 1, 1.5, 2, 3])
    // @ts-expect-error 4 is not a batch multiplier
    const bad: ServingsByBatch = { mode: 'batch', multiplier: 4 }
    expect(bad.mode).toBe('batch')
  })
})

describe('scalability and the control state (A1)', () => {
  const lines = (p: RecipePlanResponse): Ingredient[] => p.graph.ingredients
  it('kadai (hand golden, no qty_amount) is gated', () => {
    expect(scalability(lines(KADAI)).scalable).toBe(0)
    expect(servingsControlKind(KADAI.graph, null, lines(KADAI))).toBe('gated')
  })
  it('kadhi is live in servings mode, 28 of 28 numbered lines scalable', () => {
    expect(scalability(lines(KADHI))).toEqual({ scalable: 28, numbered: 28 })
    expect(servingsControlKind(KADHI.graph, null, lines(KADHI))).toBe('servings')
  })
  it('pizza is live in servings mode', () => {
    expect(scalability(lines(PIZZA))).toEqual({ scalable: 5, numbered: 5 })
    expect(servingsControlKind(PIZZA.graph, null, lines(PIZZA))).toBe('servings')
  })
  it('croissant is live in batch mode (defaulted servings)', () => {
    expect(scalability(lines(CROISSANT))).toEqual({ scalable: 6, numbered: 7 })
    expect(servingsControlKind(CROISSANT.graph, null, lines(CROISSANT))).toBe('batch')
  })
})

describe('servingsCopy (the copy table)', () => {
  it('servings mode', () => {
    const c = servingsCopy(S(6, 4))
    expect(c.label).toBe('Servings')
    expect(c.value).toBe('6')
    expect(c.sub).toBe('Times stay the same')
    expect(c.reset).toBe('Reset to 4')
    expect(c.dec).toBe('Fewer servings')
    expect(c.inc).toBe('More servings')
    expect(c.marker).toBe('for 4 servings')
    expect(c.stepNote).toBe("Amounts in this step's text are for 4 servings.")
    expect(c.headerMeta).toBe('6 servings · recipe serves 4')
    expect(c.entry).toBe('For 6 servings')
    expect(c.stepMeta(2, 9)).toBe('Step 2 of 9 · for 6 servings')
    expect(c.locked).toBe('Cooking for 6 — finish to change')
    expect(c.chipLabel('2 tsp salt')).toBe('2 tsp salt — amount for 4 servings')
  })
  it('batch mode', () => {
    const c = servingsCopy(B(1.5))
    expect(c.label).toBe('Amounts')
    expect(c.value).toBe('×1½')
    expect(c.reset).toBe('Reset to ×1')
    expect(c.dec).toBe('Smaller batch')
    expect(c.inc).toBe('Larger batch')
    expect(c.marker).toBe('as written')
    expect(c.stepNote).toBe("Amounts in this step's text are for the recipe as written.")
    expect(c.headerMeta).toBe('Amounts ×1½')
    expect(c.entry).toBe('Amounts ×1½')
    expect(c.stepMeta(2, 9)).toBe('Step 2 of 9 · amounts ×1½')
    expect(c.locked).toBe('Cooking at ×1½ — finish to change')
    expect(c.chipLabel('2 tsp salt')).toBe('2 tsp salt — amount as written')
  })
  it('times note shows from factor 2 up, never below', () => {
    expect(servingsCopy(S(8, 4)).sub).toBe('Times are for 4 servings. A bigger batch can take longer.')
    expect(servingsCopy(S(7, 4)).sub).toBe('Times stay the same')
    expect(servingsCopy(B(2)).sub).toBe('Times are for the recipe as written. A bigger batch can take longer.')
    expect(servingsCopy(B(1.5)).sub).toBe('Times stay the same')
    expect(servingsCopy(S(2, 4)).sub).toBe('Times stay the same')
  })
  it('factor 1.99 is below the times-note threshold and 2 is at it', () => {
    expect(servingsCopy(S(199, 100)).sub).toBe('Times stay the same')
    expect(servingsCopy(S(200, 100)).sub).toContain('A bigger batch can take longer.')
  })
  it('the recipe-level line is singular for one amount (W1-4)', () => {
    expect(servingsCopy(S(6, 4)).recipeLine(1)).toBe('1 amount is for 4 servings — scale it yourself.')
    expect(servingsCopy(S(6, 4)).recipeLine(3)).toBe('3 amounts are for 4 servings — scale them yourself.')
    expect(servingsCopy(B(2)).recipeLine(1)).toBe('1 amount is as written — scale it yourself.')
    expect(servingsCopy(B(2)).recipeLine(2)).toBe('2 amounts are as written — scale them yourself.')
  })
  it('says "serving" for one', () => {
    expect(servingsCopy(S(1, 4)).headerMeta).toBe('1 serving · recipe serves 4')
    expect(servingsCopy(S(1, 4)).entry).toBe('For 1 serving')
    expect(servingsCopy(S(2, 1)).marker).toBe('for 1 serving')
  })
  it('the gated line', () => {
    expect(servingsCopy(null).gated).toBe("Amounts in this recipe can't be scaled yet.")
  })
})

describe('savedServingsLine (CP5.1 U5: the Cookbook row)', () => {
  const withYield = { servings: 4, servings_stated: true, yield_text: 'Makes 12 pieces' }

  it('servings mode away from the original: the chosen count, without the original yield', () => {
    expect(savedServingsLine(withYield, null, S(6, 4))).toBe('6 servings')
    expect(savedServingsLine(withYield, null, S(1, 4))).toBe('1 serving')
  })

  it('batch mode away from x1: "Amounts ×N"', () => {
    const batch = { servings: 4, servings_stated: false, yield_text: null }
    expect(savedServingsLine(batch, null, B(2))).toBe('Amounts ×2')
    expect(savedServingsLine(batch, null, B(1.5))).toBe('Amounts ×1½')
  })

  it('no choice, a choice at the original, or batch x1: the usual line', () => {
    const usual = servingsLine(withYield, null)
    expect(savedServingsLine(withYield, null, null)).toBe(usual)
    expect(savedServingsLine(withYield, null, undefined)).toBe(usual)
    expect(savedServingsLine(withYield, null, S(4, 4))).toBe(usual)
    const batch = { servings: 4, servings_stated: false, yield_text: 'Makes 1 loaf' }
    expect(savedServingsLine(batch, null, B(1))).toBe(servingsLine(batch, null))
  })

  it('a stale choice (made for a different version, or the other mode) falls back', () => {
    const usual = servingsLine(withYield, null)
    expect(savedServingsLine(withYield, null, S(6, 8))).toBe(usual)
    expect(savedServingsLine(withYield, null, B(2))).toBe(usual)
  })
})
