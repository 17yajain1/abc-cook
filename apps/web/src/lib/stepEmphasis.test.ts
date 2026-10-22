import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { emphasisSpans, type ConsumedIngredient } from './stepEmphasis'
import { timePhraseSpans } from './stepNote'

const FIXTURES = import.meta.glob('../__fixtures__/*.plan-response.json', { eager: true, import: 'default' }) as Record<
  string,
  RecipePlanResponse
>

const ing = (name: string, qty_text: string | null, unit: string | null = null, qty: number | null = null): ConsumedIngredient => ({
  name,
  qty,
  qty_text,
  qty_amount: null,
  unit,
})

const bold = (text: string, consumed: ConsumedIngredient[] = [], factor = 1): string[] =>
  emphasisSpans(text, consumed, factor).map((s) => text.slice(s.start, s.end))

describe('quantity spans', () => {
  it('bolds an amount the text quotes, with the name when it directly follows', () => {
    expect(bold('Heat 1 litre milk with sugar.', [ing('milk', '1', 'litre')])).toEqual(['1 litre milk'])
  })

  it('bolds the amount alone when the name does not follow it', () => {
    expect(bold('Add 2 tbsp of the oil.', [ing('oil', '2', 'tbsp')])).toEqual(['2 tbsp'])
  })

  it('never bolds a name on its own', () => {
    expect(bold('Add the milk and stir.', [ing('milk', '1', 'litre')])).toEqual([])
  })

  it('never bolds a name that is not adjacent to its amount', () => {
    expect(bold('Pour 1 litre of water, then add the milk.', [ing('milk', '1', 'litre')])).toEqual(['1 litre'])
  })

  it('skips a bare number that has no name after it', () => {
    expect(bold('Cook 2 eggs for 2 minutes.', [ing('onions', '2')])).toEqual(['2 minutes'])
    expect(bold('Fry 2 eggs.', [ing('eggs', '2')])).toEqual(['2 eggs'])
  })

  it('does not bold words such as "to taste"', () => {
    expect(bold('Add salt to taste.', [ing('salt', 'to taste')])).toEqual([])
  })

  it('finds only a word-bounded amount', () => {
    expect(bold('Add 12 cups of stock.', [ing('stock', '2', 'cups')])).toEqual([])
  })

  it('draws no quantity spans at a factor other than 1, but still bolds times and heat', () => {
    const text = 'Heat 1 litre milk on low heat for 10 min.'
    expect(bold(text, [ing('milk', '1', 'litre')], 2)).toEqual(['low heat', '10 min'])
    expect(bold(text, [ing('milk', '1', 'litre')], 1)).toEqual(['1 litre milk', 'low heat', '10 min'])
  })
})

describe('time spans', () => {
  it('bolds numeric and word times', () => {
    expect(bold('Simmer for 10 minutes, then rest for half an hour.')).toEqual(['10 minutes', 'half an hour'])
  })

  it('timePhraseSpans is sorted and never overlaps', () => {
    const spans = timePhraseSpans('Cook 2-3 min, rest ten minutes, then 1 hr.')
    for (let i = 1; i < spans.length; i++) expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end)
    expect(spans.length).toBe(3)
  })

  it('does not bold a degree', () => {
    expect(bold('Bake at 180 degrees.')).toEqual([])
  })
})

describe('heat spans', () => {
  it('bolds a heat setting', () => {
    expect(bold('Cook on low heat, then high flame, then medium-high heat.')).toEqual([
      'low heat',
      'high flame',
      'medium-high heat',
    ])
  })

  it('never bolds "simmer", "lower the heat" or a bare "heat"', () => {
    expect(bold('Simmer gently. Lower the heat. Heat the oil.')).toEqual([])
  })
})

describe('Devanagari', () => {
  it('leaves Hindi text untouched, except a listed time form', () => {
    expect(bold('कढ़ाई में तेल गरम करें और प्याज़ भूनें।')).toEqual([])
    expect(bold('इसे दस मिनट पकाएं।')).toEqual(['दस मिनट'])
  })
})

describe('across every fixture', () => {
  const entries = Object.entries(FIXTURES)

  it('has fixtures to walk', () => {
    expect(entries.length).toBeGreaterThan(5)
  })

  it('never overlaps, never leaves the text, never bolds "simmer"', () => {
    for (const [file, payload] of entries) {
      const byId = new Map(payload.graph.ingredients.map((i) => [i.id, i]))
      for (const node of payload.graph.nodes) {
        const consumed = (node.consumes ?? []).flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
        const spans = emphasisSpans(node.instruction, consumed, 1)
        spans.forEach((s, i) => {
          expect(s.start, `${file} ${node.id}`).toBeGreaterThanOrEqual(0)
          expect(s.end, `${file} ${node.id}`).toBeLessThanOrEqual(node.instruction.length)
          expect(s.end).toBeGreaterThan(s.start)
          if (i > 0) expect(s.start, `${file} ${node.id}`).toBeGreaterThanOrEqual(spans[i - 1].end)
          expect(node.instruction.slice(s.start, s.end).toLowerCase()).not.toBe('simmer')
        })
        // At a factor of 2 nothing is a quantity span.
        expect(emphasisSpans(node.instruction, consumed, 2).some((s) => s.kind === 'quantity')).toBe(false)
      }
    }
  })

  it('finds at least some quantities, times and heat in the real recipes', () => {
    const kinds = new Set<string>()
    for (const [, payload] of entries) {
      const byId = new Map(payload.graph.ingredients.map((i) => [i.id, i]))
      for (const node of payload.graph.nodes) {
        const consumed = (node.consumes ?? []).flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
        for (const s of emphasisSpans(node.instruction, consumed, 1)) kinds.add(s.kind)
      }
    }
    expect([...kinds].sort()).toEqual(['heat', 'quantity', 'time'])
  })
})
