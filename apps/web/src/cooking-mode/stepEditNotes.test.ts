import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import kadhiFixture from '@/__fixtures__/kadhi-pakora.plan-response.json'
import pizzaFixture from '@/__fixtures__/pizza-dough.plan-response.json'
import { deriveCookingModel } from '@/cooking/model'
import { current } from '@/cooking/select'
import { createSessionStore, type StorageLike } from '@/cooking/store'
import { applyEdits, stepAnchor, type RecipeEdit } from '@/library/recipeEdits'
import type { ServingsChoice } from '@/lib/servings'
import { STEP_AMOUNT_NOTE, STEP_TIME_NOTE } from '@/lib/stepNote'

import { ingredientsById } from './quantity'
import { buildCookingView, type CookingView } from './viewModel'

const KADHI = kadhiFixture as RecipePlanResponse
const PIZZA = pizzaFixture as RecipePlanResponse
const T0 = 1_700_000_000_000
const AT = '2026-10-20T08:00:00.000Z'

type MutNode = { id: string; instruction: string }
const nodesOf = (p: RecipePlanResponse): MutNode[] => p.graph.nodes as unknown as MutNode[]
const stepEdit = (id: string, p: RecipePlanResponse, index: number, text: string): RecipeEdit =>
  ({ id, created_at: AT, op: 'set_step_text', anchor: stepAnchor(p, index), value: { text } }) as RecipeEdit
const linkedAdd = (id: string, name: string, p: RecipePlanResponse, index: number): RecipeEdit =>
  ({ id, created_at: AT, op: 'add_ingredient', value: { name, amount: { kind: 'number', low: 0.5, high: null }, unit: 'tsp', step: stepAnchor(p, index) } }) as RecipeEdit

function memoryStorage(): StorageLike {
  const mem = new Map<string, string>()
  return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) }
}

/** The task screen for `nodeId` over the edited payload, walking a fresh session to it. */
function taskView(raw: RecipePlanResponse, edits: RecipeEdit[], nodeId: string, choice: ServingsChoice | null = null): CookingView {
  const overlay = applyEdits(raw, edits)
  const model = deriveCookingModel(overlay.payload)
  const ings = ingredientsById(overlay.payload.graph.ingredients)
  const store = createSessionStore(memoryStorage(), () => T0)
  store.dispatch({ type: 'start', model, planKey: 't', now: T0, recipeTitle: raw.graph.title, servingsChoice: choice })
  for (let i = 0; i < 80; i++) {
    const s = store.getState()!
    const cur = current(model, s)
    if (cur == null) {
      const run = model.order.find((id) => s.nodes[id].state === 'running')
      if (run == null) break
      store.dispatch({ type: 'markDone', model, nodeId: run, now: T0 })
      continue
    }
    const v = buildCookingView(model, s, T0, ings, { recipeTitle: raw.graph.title, choice, editedSteps: overlay.editedSteps, importedSteps: overlay.importedSteps })
    if (cur === nodeId && (v.screenId === 'task' || v.screenId === 'handsoff_pending')) return v
    store.dispatch({ type: model.nodes[cur].occupiesCook ? 'markDone' : 'startNode', model, nodeId: cur, now: T0 })
  }
  throw new Error(`no task screen for ${nodeId}`)
}

const COOK = 2
const COOK_ID = nodesOf(KADHI)[COOK].id

describe('B3 (ii): the cooking-mode time note', () => {
  it('shows on an edited step whose text has a time phrase', () => {
    const v = taskView(KADHI, [stepEdit('s1', KADHI, COOK, 'Stir till it boils, then lower the heat and cook for 40 minutes.')], COOK_ID)
    expect(v.stepTimeNote).toBe('Timers stay as planned. Changing times comes later.')
    expect(v.stepTimeNote).toBe(STEP_TIME_NOTE)
  })

  it('shows for a time written in words too (B10)', () => {
    const v = taskView(KADHI, [stepEdit('s1', KADHI, COOK, 'Stir till it boils, then cook for forty minutes.')], COOK_ID)
    expect(v.stepTimeNote).toBe(STEP_TIME_NOTE)
  })

  it('does not show on an edited step with no time phrase', () => {
    const v = taskView(KADHI, [stepEdit('s1', KADHI, COOK, 'Stir till it boils, then lower the heat and cook gently.')], COOK_ID)
    expect(v.stepTimeNote).toBeNull()
  })

  it('does not show on an unedited step, even when its text has a time phrase', () => {
    expect(/half hour/.test(nodesOf(KADHI)[COOK].instruction)).toBe(true)
    expect(taskView(KADHI, [], COOK_ID).stepTimeNote).toBeNull()
  })

  it('does not show on another step when a different step was edited', () => {
    const v = taskView(KADHI, [stepEdit('s1', KADHI, 0, 'Whisk everything for 5 minutes.')], COOK_ID)
    expect(v.stepTimeNote).toBeNull()
  })

  it('carries no "Edited" mark anywhere on the screen', () => {
    const v = taskView(KADHI, [stepEdit('s1', KADHI, COOK, 'Cook for 40 minutes.')], COOK_ID)
    expect(JSON.stringify(v)).not.toContain('Edited')
    expect(v.title).toBe('Cook for 40 minutes.')
  })

  it('the timer is still the scheduler\'s: the model\'s durations do not move', () => {
    const overlay = applyEdits(KADHI, [stepEdit('s1', KADHI, COOK, 'Cook for 40 minutes.')])
    const before = deriveCookingModel(KADHI)
    const after = deriveCookingModel(overlay.payload)
    expect(after.nodes[COOK_ID].durationTypical).toBe(before.nodes[COOK_ID].durationTypical)
    expect(after.nodes[COOK_ID].endMin).toBe(before.nodes[COOK_ID].endMin)
    expect(after.order).toEqual(before.order)
  })
})

describe('B21: the R4 amount note and the time note on one screen', () => {
  it('both are present at a servings choice other than as written', () => {
    const at = 1 // "Measure 3 1/3 cups flour ..."
    const text = 'Measure 4 cups flour in a large bowl, then rest it for 10 minutes.'
    const v = taskView(PIZZA, [stepEdit('s1', PIZZA, at, text)], nodesOf(PIZZA)[at].id, { mode: 'servings', chosen: 16, original: 8 })
    expect(v.servingsNote).not.toBeNull()
    expect(v.stepTimeNote).toBe(STEP_TIME_NOTE)
    expect(v.servingsNote).not.toBe(v.stepTimeNote)
  })
})

describe('D10: a linked add shows as a chip on its step, with no marks', () => {
  it('lists the added ingredient with the step\'s own ingredients', () => {
    const v = taskView(KADHI, [stepEdit('s1', KADHI, COOK, 'Cook for 40 minutes.'), linkedAdd('k1', 'Kasuri methi', KADHI, COOK)], COOK_ID)
    expect(v.chips.some((c) => /kasuri methi/i.test(c))).toBe(true)
    expect(JSON.stringify(v)).not.toContain('Edited')
    expect(JSON.stringify(v)).not.toContain('ing_user_')
  })

  it('does not appear on the other steps', () => {
    const v = taskView(KADHI, [linkedAdd('k1', 'Kasuri methi', KADHI, COOK)], nodesOf(KADHI)[0].id)
    expect(v.chips.join('|').toLowerCase()).not.toContain('kasuri')
  })
})

describe('non-task screens', () => {
  it('a non-step view (CP4: the stale screen; the leaving screen is gone) carries a null stepTimeNote', () => {
    const overlay = applyEdits(KADHI, [stepEdit('s1', KADHI, COOK, 'Cook for 40 minutes.')])
    const model = deriveCookingModel(overlay.payload)
    const store = createSessionStore(memoryStorage(), () => T0)
    store.dispatch({ type: 'start', model, planKey: 't', now: T0, recipeTitle: 'k', servingsChoice: null })
    const later = T0 + 3 * 24 * 60 * 60_000
    const v = buildCookingView(model, store.getState()!, later, ingredientsById(overlay.payload.graph.ingredients), {
      recipeTitle: 'k',
      choice: null,
      editedSteps: overlay.editedSteps,
    })
    expect(v.screenId).toBe('stale')
    expect(v.stepTimeNote).toBeNull()
  })
})

describe('B26: the amount line in cooking mode', () => {
  const at = 1 // pizza "Measure 3 1/3 cups flour ..." consumes flour
  const id = nodesOf(PIZZA)[at].id
  const text = nodesOf(PIZZA)[at].instruction

  it('shows when the amounts moved (g1: 3 1/3 cups -> 4 cups), with no edit clause and no Edited mark', () => {
    const v = taskView(PIZZA, [stepEdit('s1', PIZZA, at, text.replace('3 1/3 cups', '4 cups'))], id)
    expect(v.stepAmountNote).toBe("Ingredient amounts don't change with the step.")
    expect(v.stepAmountNote).toBe(STEP_AMOUNT_NOTE)
    expect(JSON.stringify(v)).not.toContain('Edited')
  })

  it('does not show for a time-only change', () => {
    const t = 2 // "Knead by hand 2 minutes", consumes flour
    const v = taskView(PIZZA, [stepEdit('s1', PIZZA, t, nodesOf(PIZZA)[t].instruction.replace('2 minutes', '5 minutes'))], nodesOf(PIZZA)[t].id)
    expect(v.stepAmountNote).toBeNull()
  })

  it('does not show for a step with no ingredient', () => {
    const t = 5 // overnight rest, consumes nothing
    const v = taskView(PIZZA, [stepEdit('s1', PIZZA, t, nodesOf(PIZZA)[t].instruction.replace('1 week', '2 weeks'))], nodesOf(PIZZA)[t].id)
    expect(v.stepAmountNote).toBeNull()
  })

  it('does not show on an unedited step', () => {
    expect(taskView(PIZZA, [], id).stepAmountNote).toBeNull()
  })

  it('k2: all three notes can sit on one screen', () => {
    const edited = text.replace('3 1/3 cups', '4 cups') + ' Rest it for 10 minutes.'
    const v = taskView(PIZZA, [stepEdit('s1', PIZZA, at, edited)], id, { mode: 'servings', chosen: 16, original: 8 })
    expect(v.servingsNote).not.toBeNull()
    expect(v.stepTimeNote).toBe(STEP_TIME_NOTE)
    expect(v.stepAmountNote).toBe(STEP_AMOUNT_NOTE)
  })
})
