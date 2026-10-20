import { describe, expect, it } from 'vitest'

import type { ImportMeta, RecipePlanResponse } from '@abc-cook/schema'

import kadhi from '@/__fixtures__/kadhi-pakora.plan-response.json'

import { applyEdits, ingredientAnchor, stepAnchor, type RecipeEdit } from './recipeEdits'
import { createLibrary, type StorageLike } from './store'

const RAW = kadhi as RecipePlanResponse
const AT = '2026-10-20T08:00:00.000Z'
const META: ImportMeta = { warnings: [], review_recommended: false, sources: [], provenance: null, degraded: false }
const KEY = 'abc-cook:library:v1'
const FAILED = "Couldn't save your change. Try again."

class MemoryStorage implements StorageLike {
  data = new Map<string, string>()
  failWrites = false
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error('quota')
    this.data.set(key, value)
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
}

const clock = (iso: string) => () => new Date(iso)
const raw = (): RecipePlanResponse => structuredClone(RAW)

const renameEdit = (id: string, p: RecipePlanResponse, index: number, name: string): RecipeEdit =>
  ({ id, created_at: AT, op: 'set_ingredient_name', anchor: ingredientAnchor(p, index), value: { name } }) as RecipeEdit
const amountEdit = (id: string, p: RecipePlanResponse, index: number, low: number): RecipeEdit =>
  ({
    id,
    created_at: AT,
    op: 'set_ingredient_amount',
    anchor: ingredientAnchor(p, index),
    value: { amount: { kind: 'number', low, high: null }, unit: 'tbsp' },
  }) as RecipeEdit
const addEdit = (id: string, name: string): RecipeEdit =>
  ({ id, created_at: AT, op: 'add_ingredient', value: { name, amount: { kind: 'number', low: 7.77, high: null }, unit: 'tsp', step: null } }) as RecipeEdit

function seeded(storage = new MemoryStorage()) {
  const library = createLibrary(storage, clock('2026-10-01T00:00:00Z'))
  const saved = library.save(raw(), META, { original: null, postprocess_version: 14 })
  if (!saved.ok) throw new Error('seed')
  return { storage, library, id: saved.recipe.id, recipe: saved.recipe }
}

describe('library.setEdits', () => {
  it('stores the edits on the entry and nothing else: timestamps and order stay', () => {
    const { library, id, recipe, storage } = seeded()
    const other = library.save(
      { ...raw(), graph: { ...raw().graph, source: { kind: 'text', value: 'second', imported_at: AT } } } as RecipePlanResponse,
      META,
    )
    if (!other.ok) throw new Error('seed 2')
    const orderBefore = library.list().map((r) => r.id)
    const edits = [renameEdit('e1', RAW, 4, 'Fresh ginger')]
    const res = library.setEdits(id, edits)
    expect(res.ok).toBe(true)
    const after = library.get(id)!
    expect(after.edits).toEqual(edits)
    expect(after.saved_at).toBe(recipe.saved_at)
    expect(after.updated_at).toBe(recipe.updated_at)
    expect(after.payload).toEqual(recipe.payload)
    expect(after.postprocess_version).toBe(14)
    expect(library.list().map((r) => r.id)).toEqual(orderBefore)
    // and it survives a reload
    const again = createLibrary(storage, clock('2026-10-02T00:00:00Z'))
    expect(again.get(id)!.edits).toEqual(edits)
  })

  it('A8: a throwing storage gives the approved message, leaves the list unchanged, and keeps the old edits', () => {
    const { library, id, storage } = seeded()
    const first = [renameEdit('e1', RAW, 4, 'Fresh ginger')]
    expect(library.setEdits(id, first).ok).toBe(true)
    const listBefore = JSON.stringify(library.list())
    storage.failWrites = true
    const res = library.setEdits(id, [...first, amountEdit('e2', RAW, 1, 1)])
    expect(res).toEqual({ ok: false, message: FAILED })
    expect(JSON.stringify(library.list())).toBe(listBefore)
    expect(library.get(id)!.edits).toEqual(first)
  })

  it('an unknown entry is a failure that writes nothing', () => {
    const { library, storage } = seeded()
    const before = storage.data.get(KEY)
    expect(library.setEdits('nope', []).ok).toBe(false)
    expect(storage.data.get(KEY)).toBe(before)
  })

  it('clearing the edits stores an empty array', () => {
    const { library, id } = seeded()
    library.setEdits(id, [renameEdit('e1', RAW, 4, 'X')])
    expect(library.setEdits(id, []).ok).toBe(true)
    expect(library.get(id)!.edits).toEqual([])
  })
})

describe('edits survive every other write, verbatim', () => {
  const junk = { id: 'x', op: 'from_the_future', value: { a: [1, 2] } } as unknown as RecipeEdit

  it('replace (a re-import of the same source) keeps them', () => {
    const { library, id } = seeded()
    const edits = [renameEdit('e1', RAW, 4, 'Fresh ginger'), junk]
    library.setEdits(id, edits)
    const res = library.save(raw(), META, { original: null, postprocess_version: 14 })
    expect(res.ok && res.replaced).toBe(true)
    expect(library.get(id)!.edits).toEqual(edits)
  })

  it('refresh keeps them, and stores the refreshed payload raw', () => {
    const { library, id } = seeded()
    const edits = [renameEdit('e1', RAW, 4, 'Fresh ginger')]
    library.setEdits(id, edits)
    const res = library.refresh(id, { payload: raw(), import_meta: META, postprocess_version: 15 })
    expect(res.ok).toBe(true)
    expect(library.get(id)!.edits).toEqual(edits)
    expect(JSON.stringify(library.get(id)!.payload)).not.toContain('Fresh ginger')
  })

  it('setServingsChoice keeps them', () => {
    const { library, id } = seeded()
    const edits = [renameEdit('e1', RAW, 4, 'Fresh ginger')]
    library.setEdits(id, edits)
    library.setServingsChoice(id, { mode: 'servings', chosen: 6, original: 4 })
    expect(library.get(id)!.edits).toEqual(edits)
  })

  it('a stored item the app does not understand is read back and written back untouched', () => {
    const storage = new MemoryStorage()
    const { library, id } = seeded(storage)
    library.setEdits(id, [junk])
    const again = createLibrary(storage, clock('2026-10-03T00:00:00Z'))
    expect(again.get(id)!.edits).toEqual([junk])
    expect(applyEdits(again.get(id)!.payload, again.get(id)!.edits ?? []).orphans).toEqual([])
  })

  it('a line that shifted after a refresh gives exactly one orphan, and the edit is kept', () => {
    const { library, id } = seeded()
    library.setEdits(id, [amountEdit('e1', RAW, 1, 1)])
    const shifted = raw()
    // a new first line: every later line moves down one, so index 1 now holds the old line 0
    ;(shifted.graph.ingredients as unknown[]).unshift({ ...RAW.graph.ingredients[0], id: 'ing_new', name: 'New line' })
    library.refresh(id, { payload: shifted, import_meta: META, postprocess_version: 15 })
    const recipe = library.get(id)!
    expect(recipe.edits).toHaveLength(1)
    const result = applyEdits(recipe.payload, recipe.edits ?? [])
    expect(result.orphans.map((o) => o.id)).toEqual(['e1'])
    expect(result.orphans).toHaveLength(1)
  })

  it('an unchanged refresh orphans nothing', () => {
    const { library, id } = seeded()
    library.setEdits(id, [amountEdit('e1', RAW, 1, 1), renameEdit('e2', RAW, 4, 'Fresh ginger')])
    library.refresh(id, { payload: raw(), import_meta: META, postprocess_version: 15 })
    const recipe = library.get(id)!
    expect(applyEdits(recipe.payload, recipe.edits ?? []).orphans).toEqual([])
  })
})

describe('A6 guard: an edited value never reaches a stored payload', () => {
  const MARKS = ['ing_user_', 'Unique-Name', 'Zzz-Added', '7.77']

  const storedPayloads = (storage: MemoryStorage): string[] => {
    const body = JSON.parse(storage.data.get(KEY) ?? '{"recipes":[]}') as { recipes: { payload: unknown }[] }
    return body.recipes.map((r) => JSON.stringify(r.payload))
  }

  it('save, refresh, setServingsChoice and setEdits all leave `payload` raw', () => {
    const { library, id, storage } = seeded()
    const edits = [renameEdit('e1', RAW, 4, 'Unique-Name'), addEdit('a1', 'Zzz-Added')]
    const check = (label: string) => {
      for (const payload of storedPayloads(storage)) for (const mark of MARKS) expect(payload, `${label}: ${mark}`).not.toContain(mark)
    }
    library.setEdits(id, edits)
    check('setEdits')
    // the edits themselves are stored, beside the payload
    expect(storage.data.get(KEY)).toContain('Unique-Name')
    library.setServingsChoice(id, { mode: 'servings', chosen: 6, original: 4 })
    check('setServingsChoice')
    library.refresh(id, { payload: raw(), import_meta: META, postprocess_version: 15 })
    check('refresh')
    library.save(raw(), META, { original: null, postprocess_version: 15 })
    check('save')
  })

  it('applying the edits never changes the raw payload the library holds', () => {
    const { library, id } = seeded()
    library.setEdits(id, [renameEdit('e1', RAW, 4, 'Unique-Name'), addEdit('a1', 'Zzz-Added')])
    const entry = library.get(id)!
    const snapshot = JSON.stringify(entry.payload)
    const overlaid = applyEdits(entry.payload, entry.edits ?? [])
    expect(overlaid.payload).not.toBe(entry.payload)
    expect(JSON.stringify(overlaid.payload)).toContain('Unique-Name')
    expect(JSON.stringify(entry.payload)).toBe(snapshot)
  })
})

describe('R6b: a step edit and a linked add never reach a stored payload', () => {
  const MARKS = ['ing_user_', 'Unique-Step-Text', 'Zzz-Linked']
  const stepEdits = (): RecipeEdit[] => [
    { id: 's1', created_at: AT, op: 'set_step_text', anchor: stepAnchor(RAW, 2), value: { text: 'Unique-Step-Text: cook for 40 minutes.' } } as RecipeEdit,
    {
      id: 'k1',
      created_at: AT,
      op: 'add_ingredient',
      value: { name: 'Zzz-Linked', amount: null, unit: null, step: stepAnchor(RAW, 2) },
    } as RecipeEdit,
  ]

  it('setEdits stores the edits beside the payload, which stays raw through setEdits, servings and refresh', () => {
    const { library, id, storage } = seeded()
    const check = (label: string) => {
      const body = JSON.parse(storage.data.get(KEY) ?? '{"recipes":[]}') as { recipes: { payload: unknown }[] }
      for (const r of body.recipes) for (const mark of MARKS) expect(JSON.stringify(r.payload), `${label}: ${mark}`).not.toContain(mark)
    }
    library.setEdits(id, stepEdits())
    check('setEdits')
    expect(storage.data.get(KEY)).toContain('Unique-Step-Text')
    library.setServingsChoice(id, { mode: 'servings', chosen: 6, original: 4 })
    check('setServingsChoice')
    library.refresh(id, { payload: raw(), import_meta: META, postprocess_version: 15 })
    check('refresh')
    expect(library.get(id)!.edits).toHaveLength(2)
  })

  it('applying them never changes the raw payload the library holds', () => {
    const { library, id } = seeded()
    library.setEdits(id, stepEdits())
    const entry = library.get(id)!
    const snapshot = JSON.stringify(entry.payload)
    const overlaid = applyEdits(entry.payload, entry.edits ?? [])
    expect(overlaid.payload).not.toBe(entry.payload)
    expect(JSON.stringify(overlaid.payload)).toContain('Unique-Step-Text')
    expect(JSON.stringify(entry.payload)).toBe(snapshot)
  })

  it('a refresh that rewrites the step orphans its edit, keeps both in the store, and lists the link as its own orphan', () => {
    const { library, id } = seeded()
    library.setEdits(id, stepEdits())
    const rewritten = raw()
    ;(rewritten.graph.nodes as unknown as { instruction: string }[])[2].instruction = 'The recipe was rewritten.'
    library.refresh(id, { payload: rewritten, import_meta: META, postprocess_version: 15 })
    const recipe = library.get(id)!
    expect(recipe.edits).toHaveLength(2)
    const result = applyEdits(recipe.payload, recipe.edits ?? [])
    expect(result.orphans.map((o) => `${o.kind}:${o.id}`)).toEqual(['step:s1', 'link:k1'])
  })
})
