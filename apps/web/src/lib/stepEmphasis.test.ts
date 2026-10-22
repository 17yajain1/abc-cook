import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import croissant from '@/__fixtures__/croissant.plan-response.json'
import pumpkin from '@/__fixtures__/pumpkin-pancakes.plan-response.json'

import { emphasisSpans, type ConsumedIngredient } from './stepEmphasis'
import { timePhraseSpans } from './stepNote'

const FIXTURES = import.meta.glob('../__fixtures__/*.plan-response.json', { eager: true, import: 'default' }) as Record<
  string,
  RecipePlanResponse
>

const names = (...n: string[]): ConsumedIngredient[] => n.map((name) => ({ name }))

const bold = (text: string, consumed: ConsumedIngredient[] = [], factor = 1): string[] =>
  emphasisSpans(text, consumed, factor).map((s) => text.slice(s.start, s.end))

/** A fixture step by 1-based position, with the names of the ingredients it consumes. */
function step(payload: unknown, n: number): { text: string; consumed: ConsumedIngredient[] } {
  const p = payload as RecipePlanResponse
  const node = p.graph.nodes[n - 1]
  const byId = new Map(p.graph.ingredients.map((i) => [i.id, i]))
  return { text: node.instruction, consumed: (node.consumes ?? []).flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])) }
}

describe('quantity spans', () => {
  it('bolds every amount in the step, with the name when it directly follows', () => {
    expect(bold('Heat 1 litre milk with 2 tbsp sugar.', names('milk', 'sugar'))).toEqual(['1 litre milk', '2 tbsp sugar'])
  })

  it('bolds the amount alone when the next words are not a consumed ingredient', () => {
    expect(bold('Add 2 tbsp of the oil.', names('milk'))).toEqual(['2 tbsp'])
  })

  it('never bolds a name on its own', () => {
    expect(bold('Add the milk and stir.', names('milk'))).toEqual([])
  })

  it('never bolds a name that is not directly after its amount', () => {
    expect(bold('Pour 1 litre of water, then add the milk.', names('milk'))).toEqual(['1 litre'])
  })

  it('never bolds a bare number with no unit', () => {
    expect(bold('Cut into 6 triangles and 8 equal portions.', names('bread'))).toEqual([])
    expect(bold('Fry 2 eggs.', names('eggs'))).toEqual([])
  })

  it('reads integers, fractions, mixed numbers, unicode fractions, ranges and no-space forms', () => {
    expect(bold('Add 2 cups, 1/2 tsp, 1 1/2 cups, ½ cup, 1½ tbsp, 80-90 ml, 2 to 3 cloves and 10g.')).toEqual([
      '2 cups',
      '1/2 tsp',
      '1 1/2 cups',
      '½ cup',
      '1½ tbsp',
      '80-90 ml',
      '2 to 3 cloves',
      '10g',
    ])
  })

  it('needs a whole unit word', () => {
    expect(bold('Add 2 garlic and 1 lemon and 3 gram masala.')).toEqual(['3 gram'])
  })

  it('does not bold a time as a quantity', () => {
    expect(bold('Cook for 10 minutes.')).toEqual(['10 minutes'])
  })

  it('draws no quantity spans at a factor other than 1, but still bolds times and heat', () => {
    const text = 'Heat 1 litre milk on low heat for 10 min.'
    expect(bold(text, names('milk'), 2)).toEqual(['low heat', '10 min'])
    expect(bold(text, names('milk'), 1)).toEqual(['1 litre milk', 'low heat', '10 min'])
  })

  it('pumpkin step 2: every amount, with its ingredient', () => {
    const { text, consumed } = step(pumpkin, 2)
    expect(bold(text, consumed)).toEqual([
      '1/2 tsp salt',
      '1/2 tsp pumpkin pie spice',
      '1 tsp cinnamon',
      '1/4 cup brown sugar',
      '1 tsp vanilla',
    ])
  })

  it('croissant step 1: the amounts, the name after them and the bracketed ones', () => {
    const { text, consumed } = step(croissant, 1)
    expect(bold(text, consumed)).toEqual([
      '1/3 cup of warm water',
      '80-90 ml',
      '1 tbsp sugar',
      '10g',
      '1 tbsp dry yeast or instant yeast',
      '8g',
    ])
  })

  it('croissant step 4: "5 tbsp soft butter" (a descriptor before the name) and the bracketed grams', () => {
    const { text, consumed } = step(croissant, 4)
    expect(bold(text, consumed)).toEqual(['2 cups flour', '250g', '5 tbsp soft butter', '50g', '6 minutes'])
  })

  it('a step with no unit has no quantity bold at all', () => {
    expect(bold('Cut the bread into 6 triangles and arrange them in 2 layers.', names('bread'))).toEqual([])
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

  it('does not bold the word degrees', () => {
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

  it('bolds an oven temperature, with or without the scale letter', () => {
    expect(bold('Bake at 190° (375°F) for 20 minutes.')).toEqual(['190°', '375°F', '20 minutes'])
    expect(bold('Preheat to 200 °C.')).toEqual(['200 °C'])
  })

  it('croissant step 18: the temperatures and the time', () => {
    const { text, consumed } = step(croissant, 18)
    expect(bold(text, consumed)).toEqual(['190°', '375°F', '20-25 minutes'])
  })

  it('never bolds "simmer", "lower the heat", a bare "heat" or a number with no degree sign', () => {
    expect(bold('Simmer gently. Lower the heat. Heat the oil. Make 190 portions.')).toEqual([])
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

  it('never overlaps, never leaves the text, never bolds "simmer", and has no quantity span at a factor of 2', () => {
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
        expect(emphasisSpans(node.instruction, consumed, 2).some((s) => s.kind === 'quantity')).toBe(false)
      }
    }
  })

  it('finds quantities, times and heat in the real recipes', () => {
    const kinds = new Set<string>()
    for (const [, payload] of entries) {
      for (const node of payload.graph.nodes) {
        for (const s of emphasisSpans(node.instruction, [], 1)) kinds.add(s.kind)
      }
    }
    expect([...kinds].sort()).toEqual(['heat', 'quantity', 'time'])
  })
})
