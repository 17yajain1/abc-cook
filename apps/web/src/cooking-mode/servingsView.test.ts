import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import croissant from '@/__fixtures__/croissant.plan-response.json'
import pizza from '@/__fixtures__/pizza-dough.plan-response.json'
import { current } from '@/cooking/select'
import { createSessionStore, type StorageLike } from '@/cooking/store'
import { deriveCookingModel } from '@/cooking/model'
import { headerTiming } from '@/lib/duration'
import type { ServingsChoice } from '@/lib/servings'

import { ingredientsById, quantityChips, quantityPhrases } from './quantity'
import { buildCookingView, buildEntryView } from './viewModel'

const PIZZA = pizza as RecipePlanResponse
const CROISSANT = croissant as RecipePlanResponse
const S = (chosen: number, original: number): ServingsChoice => ({ mode: 'servings', chosen, original })
const B = (multiplier: 0.5 | 1 | 1.5 | 2 | 3): ServingsChoice => ({ mode: 'batch', multiplier })
const T0 = 1_700_000_000_000

function memoryStorage(): StorageLike {
  const mem = new Map<string, string>()
  return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) }
}

/** Walks a fresh session to the first task screen whose node satisfies `want`. */
function viewAt(payload: RecipePlanResponse, choice: ServingsChoice | null, want: (nodeId: string) => boolean) {
  const model = deriveCookingModel(payload)
  const ings = ingredientsById(payload.graph.ingredients)
  const store = createSessionStore(memoryStorage(), () => T0)
  store.dispatch({ type: 'start', model, planKey: 't', now: T0, recipeTitle: payload.graph.title, servingsChoice: choice })
  for (let i = 0; i < 80; i++) {
    const s = store.getState()!
    const cur = current(model, s)
    if (cur == null) {
      const run = model.order.find((id) => s.nodes[id].state === 'running')
      if (run == null) break
      store.dispatch({ type: 'markDone', model, nodeId: run, now: T0 })
      continue
    }
    const v = buildCookingView(model, s, T0, ings, { recipeTitle: payload.graph.title, leaving: false, choice })
    if ((v.screenId === 'task' || v.screenId === 'handsoff_pending') && want(cur)) return { v, model, node: model.nodes[cur], ings }
    store.dispatch({ type: model.nodes[cur].occupiesCook ? 'markDone' : 'startNode', model, nodeId: cur, now: T0 })
  }
  throw new Error('no matching step')
}

describe('quantityChips', () => {
  const model = deriveCookingModel(CROISSANT)
  const ings = ingredientsById(CROISSANT.graph.ingredients)
  const butterNode = Object.values(model.nodes).find((n) => n.consumes.includes('ing_butter'))!

  it('text is exactly the phrase string at every factor and marker state', () => {
    for (const f of [1, 0.5, 1.5, 2, 3]) {
      for (const node of Object.values(model.nodes)) {
        expect(quantityChips(node, ings, f).map((c) => c.text)).toEqual(quantityPhrases(node, ings, f))
      }
    }
  })
  it('flags the butter chip at factor 2 and nothing at factor 1', () => {
    expect(quantityChips(butterNode, ings, 2).some((c) => c.unscaled)).toBe(true)
    expect(quantityChips(butterNode, ings, 1).some((c) => c.unscaled)).toBe(false)
  })
  it('the flag follows the line: the scaled flour chip is not flagged', () => {
    const chips = quantityChips(butterNode, ings, 2)
    expect(chips.find((c) => c.text.includes('flour'))?.unscaled).toBe(false)
    expect(chips.find((c) => c.text.includes('butter'))?.unscaled).toBe(true)
  })
})

describe('cooking step at factor 1 is today, byte for byte', () => {
  it('no note, no marker, "Step n of N" unchanged', () => {
    const { v } = viewAt(PIZZA, null, () => true)
    expect(v.servingsNote).toBeNull()
    expect(v.step).toMatch(/^Step \d+ of \d+$/)
    expect(v.chipItems.map((c) => c.text)).toEqual(v.chips)
    expect(v.chipItems.every((c) => !c.unscaled)).toBe(true)
  })
  it('a servings choice equal to the original is factor 1', () => {
    const { v } = viewAt(PIZZA, S(8, 8), () => true)
    expect(v.servingsNote).toBeNull()
    expect(v.step).toMatch(/^Step \d+ of \d+$/)
  })
})

describe('cooking step at factor != 1', () => {
  it('scales chips, extends the step line, and notes a step whose text has an amount', () => {
    const { v, model } = viewAt(PIZZA, S(16, 8), (id) => /\d/.test(model_instr(PIZZA, id)))
    expect(v.step).toMatch(/^Step \d+ of \d+ · for 16 servings$/)
    expect(v.servingsNote).toBe("Amounts in this step's text are for 8 servings.")
    expect(v.chips).toEqual(v.chipItems.map((c) => c.text))
    expect(model.order.length).toBeGreaterThan(0)
  })
  it('batch mode uses the batch copy', () => {
    const { v } = viewAt(CROISSANT, B(2), () => true)
    expect(v.step).toMatch(/^Step \d+ of \d+ · amounts ×2$/)
  })
  it('an unscaled chip carries the accessible label text', () => {
    const { v } = viewAt(CROISSANT, B(2), (id) => deriveCookingModel(CROISSANT).nodes[id].consumes.includes('ing_butter'))
    const marked = v.chipItems.filter((c) => c.unscaled)
    expect(marked.length).toBeGreaterThan(0)
    expect(marked[0].label).toBe(`${marked[0].text} — amount as written`)
    expect(v.chipItems.filter((c) => !c.unscaled).every((c) => c.label === undefined)).toBe(true)
  })
  it('the "Next:" preview line is never noted or changed', () => {
    const { v } = viewAt(PIZZA, S(16, 8), () => true)
    expect(v.next === null || v.next.startsWith('Next: ')).toBe(true)
  })
})

describe('times note (F1): once per session, on its first step, from factor 2', () => {
  it('shows on the first step screen of a session started from the plan at factor 2', () => {
    const { v } = viewAt(PIZZA, S(16, 8), () => true)
    expect(v.step).toMatch(/^Step 1 of /)
    expect(v.timesNote).toBe('Times are for 8 servings. A bigger batch can take longer.')
  })
  it('is not repeated on a later step', () => {
    const model = deriveCookingModel(PIZZA)
    const first = model.order[0]
    const { v } = viewAt(PIZZA, S(16, 8), (id) => id !== first)
    expect(v.step).not.toMatch(/^Step 1 of /)
    expect(v.timesNote).toBeNull()
  })
  it('batch mode uses the batch wording', () => {
    const { v } = viewAt(CROISSANT, B(2), () => true)
    expect(v.timesNote).toBe('Times are for the recipe as written. A bigger batch can take longer.')
  })
  it('is absent below factor 2, and at factor 1', () => {
    expect(viewAt(PIZZA, S(12, 8), () => true).v.timesNote).toBeNull()
    expect(viewAt(PIZZA, null, () => true).v.timesNote).toBeNull()
    expect(viewAt(CROISSANT, B(1.5), () => true).v.timesNote).toBeNull()
  })
  it('the resume and conflict entry screen keeps carrying it in its note', () => {
    const model = deriveCookingModel(PIZZA)
    const timing = headerTiming(PIZZA.summary ?? null, PIZZA.plan.total_min)
    expect(buildEntryView(model, 'Pizza', timing, S(16, 8)).note).toContain('A bigger batch can take longer.')
  })
})

describe('entry screen', () => {
  const model = deriveCookingModel(PIZZA)
  const timing = headerTiming(PIZZA.summary ?? null, PIZZA.plan.total_min)
  it('unchanged at factor 1', () => {
    const a = buildEntryView(model, 'Pizza', timing)
    const b = buildEntryView(model, 'Pizza', timing, null)
    expect(b).toEqual(a)
    expect(buildEntryView(model, 'Pizza', timing, S(8, 8))).toEqual(a)
  })
  it('names the choice, and adds the times note from factor 2', () => {
    const v = buildEntryView(model, 'Pizza', timing, S(12, 8))
    expect(v.instr).toContain('For 12 servings')
    expect(v.note ?? '').not.toContain('A bigger batch')
    const w = buildEntryView(model, 'Pizza', timing, S(16, 8))
    expect(w.note).toContain('Times are for 8 servings. A bigger batch can take longer.')
  })
  it('batch copy', () => {
    const v = buildEntryView(model, 'Pizza', timing, B(2))
    expect(v.instr).toContain('Amounts ×2')
    expect(v.note).toContain('Times are for the recipe as written. A bigger batch can take longer.')
  })
})

function model_instr(payload: RecipePlanResponse, id: string): string {
  return payload.graph.nodes.find((n) => n.id === id)?.instruction ?? ''
}
