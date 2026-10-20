import { describe, expect, it, vi } from 'vitest'

import type { ImportMeta, ImportOriginal, RecipePlanResponse, ReprocessResponse } from '@abc-cook/schema'

import { createServerVersion } from '@/api/serverVersion'
import * as engine from '@/cooking/engine'
import { deriveCookingModel } from '@/cooking/model'
import type { CookingSession, Rejected } from '@/cooking/types'
import { createSessionStore } from '@/cooking/store'
import { completionEventFor } from '@/cooking-mode/finalizeSession'
import { planKeyFor } from '@/cooking-mode/planKey'
import chickenBiryani from '@/__fixtures__/chicken-biryani.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import kadhi from '@/__fixtures__/kadhi-pakora.plan-response.json'
import { quantityTrailingScaled } from '@/lib/quantity'
import { servingsControlKind } from '@/lib/servings'
import { derivePlan } from '@/plan/derive'
import { panelIngredientGroups } from '@/plan/ingredientGroups'
import { panelServings } from '@/plan/panelServings'

import { openSavedChecked, openSavedNow, type OpenDeps } from './openSaved'
import { applyEdits, ingredientAnchor, overlayForRecipe, stepAnchor, viewParts, type RecipeEdit } from './recipeEdits'
import { canonicalSourceKey } from './sourceKey'
import { createLibrary, type StorageLike } from './store'

const KADAI = kadaiPaneer as RecipePlanResponse
const KADHI = kadhi as RecipePlanResponse
const NOW = 1_800_000_000_000
const AT = '2026-10-20T08:00:00.000Z'

/** An engine result that must not have been rejected. */
function must(result: CookingSession | Rejected): CookingSession {
  if ('ok' in result) throw new Error('the engine rejected the step')
  return result
}
const META: ImportMeta = { warnings: [], review_recommended: false, sources: [], provenance: null, degraded: false }
const urlPayload = (base: RecipePlanResponse): RecipePlanResponse =>
  structuredClone({
    ...base,
    graph: { ...base.graph, source: { kind: 'url', value: 'https://x.test/a', imported_at: '2026-10-01T00:00:00Z' } },
  }) as RecipePlanResponse
const ORIGINAL = { recipe: {}, source_text: 's', raw_title: 't', graph_id: 'g', source: urlPayload(KADAI).graph.source } as unknown as ImportOriginal

type Row = RecipePlanResponse['graph']['ingredients'][number]
const rows = (p: RecipePlanResponse): Row[] => p.graph.ingredients as Row[]

const amountEdit = (p: RecipePlanResponse, index: number, low: number, unit: string | null): RecipeEdit =>
  ({
    id: 'e1',
    created_at: AT,
    op: 'set_ingredient_amount',
    anchor: ingredientAnchor(p, index),
    value: { amount: { kind: 'number', low, high: null }, unit },
  }) as RecipeEdit

function memoryStorage(): StorageLike {
  const data = new Map<string, string>()
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) }
}

function setup(opts: { original?: ImportOriginal | null; stamp?: number; server?: number; reprocess?: OpenDeps['reprocess']; feed?: { payload: RecipePlanResponse; postprocessVersion: number } | null; busy?: boolean }) {
  const library = createLibrary(memoryStorage(), () => new Date('2026-10-01T00:00:00Z'))
  const raw = urlPayload(KADAI)
  const saved = library.save(raw, META, { original: opts.original ?? null, postprocess_version: opts.stamp ?? 1 })
  if (!saved.ok) throw new Error('seed')
  const id = saved.recipe.id
  const edits = [amountEdit(raw, 0, 3, 'tbsp')]
  library.setEdits(id, edits)
  const reprocess = vi.fn(opts.reprocess ?? (() => Promise.reject(new Error('down'))))
  const deps: OpenDeps = {
    library,
    serverVersion: createServerVersion(() => Promise.resolve({ status: 'ok', version: '0', postprocess_version: opts.server ?? 14 })),
    reprocess,
    findInFeed: () => Promise.resolve(opts.feed ?? null),
    getSession: () =>
      opts.busy
        ? ({ version: 1, planKey: `library:${id}`, graphId: raw.graph.id, startedAt: NOW - 3_600_000, lastSeenAt: NOW - 60_000, leftAt: null, finishedAt: null, nodes: {}, lastTransition: null } as never)
        : null,
    endSessionIfFor: () => {},
    now: () => NOW,
  }
  return { library, id, deps, reprocess, raw }
}

async function open(s: ReturnType<typeof setup>) {
  const out = openSavedNow(s.deps, s.id) ?? (await openSavedChecked(s.deps, s.id))
  if (!('recipe' in out)) throw new Error('missing')
  return out.recipe
}

describe('opening a saved recipe gives an overlaid view with the right orphan count', () => {
  it('a reprocess refresh whose line still matches: edits applied, no orphan', async () => {
    const s = setup({
      original: ORIGINAL,
      reprocess: () => Promise.resolve({ payload: urlPayload(KADAI), import_meta: META, postprocess_version: 14 } as ReprocessResponse),
    })
    const recipe = await open(s)
    expect(recipe.postprocess_version).toBe(14)
    const view = overlayForRecipe(recipe)
    expect(view.orphans).toEqual([])
    expect(rows(view.payload)[0].qty_text).toBe('3')
    expect(rows(view.payload)[0].unit).toBe('tbsp')
  })

  it('a reprocess refresh whose line changed: one orphan, the row shown as imported, the edit kept', async () => {
    const changed = urlPayload(KADAI)
    ;(changed.graph.ingredients as Row[])[0] = { ...rows(changed)[0], qty_text: '9' } as Row
    const s = setup({
      original: ORIGINAL,
      reprocess: () => Promise.resolve({ payload: changed, import_meta: META, postprocess_version: 14 } as ReprocessResponse),
    })
    const recipe = await open(s)
    expect(recipe.edits).toHaveLength(1)
    const view = overlayForRecipe(recipe)
    expect(view.orphans).toHaveLength(1)
    expect(rows(view.payload)[0].qty_text).toBe('9')
  })

  it('a feed replacement re-applies the edits by index and expected value', async () => {
    const s = setup({ original: null, feed: { payload: urlPayload(KADAI), postprocessVersion: 14 } })
    const recipe = await open(s)
    expect(recipe.postprocess_version).toBe(14)
    const view = overlayForRecipe(recipe)
    expect(view.orphans).toEqual([])
    expect(rows(view.payload)[0].qty_text).toBe('3')
  })

  it('an active-session open (no refresh) is overlaid too, with the same node ids', async () => {
    const s = setup({ original: ORIGINAL, busy: true })
    const recipe = await open(s)
    expect(s.reprocess).not.toHaveBeenCalled()
    const view = overlayForRecipe(recipe)
    expect(view.orphans).toEqual([])
    expect(rows(view.payload)[0].qty_text).toBe('3')
    expect(view.payload.graph.nodes.map((n) => n.id)).toEqual(recipe.payload.graph.nodes.map((n) => n.id))
  })

  it('the /recipes/reprocess body is the stored original, never an edited value', async () => {
    const s = setup({
      original: ORIGINAL,
      reprocess: () => Promise.resolve({ payload: urlPayload(KADAI), import_meta: META, postprocess_version: 14 } as ReprocessResponse),
    })
    await open(s)
    expect(s.reprocess).toHaveBeenCalledTimes(1)
    const [sent] = s.reprocess.mock.calls[0]
    expect(sent).toBe(ORIGINAL)
    expect(JSON.stringify({ original: sent })).not.toContain('ing_user_')
  })
})

describe('A17: the raw payload stays raw beside the overlaid view', () => {
  it('viewParts hands back a different object for the view and leaves the raw one untouched', () => {
    const raw = structuredClone(KADHI)
    const snapshot = JSON.stringify(raw)
    const parts = viewParts(raw, [amountEdit(raw, 1, 1, 'tbsp')])
    expect(parts.payload).not.toBe(raw)
    expect(parts.raw).toBe(raw)
    expect(JSON.stringify(parts.raw)).toBe(snapshot)
    expect(rows(parts.payload)[1].qty_text).toBe('1')
  })

  it('with nothing to apply the view is the raw payload itself, and the raw copy is still given', () => {
    const raw = structuredClone(KADHI)
    const parts = viewParts(raw, [])
    expect(parts.payload).toBe(raw)
    expect(parts.raw).toBe(raw)
  })

  it('an import-origin view (openImported) and a feed view (openFeedRecipe) built this way keep origin.payload raw', () => {
    for (const base of [urlPayload(KADHI), urlPayload(KADAI)]) {
      const originPayload = structuredClone(base)
      const snapshot = JSON.stringify(originPayload)
      const parts = viewParts(originPayload, [amountEdit(originPayload, 0, 3, 'tbsp')])
      expect(parts.raw).toBe(originPayload) // what `origin.payload` is set to
      expect(parts.payload).not.toBe(originPayload) // what `view.payload` is set to
      expect(JSON.stringify(originPayload)).toBe(snapshot)
      expect(rows(parts.payload)[0].qty_text).toBe('3')
    }
  })
})

describe('A13: the servings control reads the imported payload', () => {
  const gated = urlPayload(KADAI)
  const gatedEdit = (p: RecipePlanResponse) => amountEdit(p, 0, 3, 'tbsp')

  it('a gated fixture stays gated after an amount edit', () => {
    const raw = structuredClone(gated)
    expect(servingsControlKind(raw.graph, null, rows(raw))).toBe('gated')
    const view = applyEdits(raw, [gatedEdit(raw)]).payload
    // the overlaid line now has a qty_amount, so reading the overlay would flip the gate
    expect(servingsControlKind(view.graph, null, rows(view))).not.toBe('gated')
    const plan = derivePlan(view)
    const importedLines = rows(raw)
    const control = panelServings(plan, null, { mode: 'servings', chosen: 6, original: 4 }, false, () => {}, importedLines)
    expect(control?.kind).toBe('gated')
    expect(control?.choice).toBeNull()
  })

  it('without the imported lines the gate would read the overlay (what A13 forbids)', () => {
    const raw = structuredClone(gated)
    const plan = derivePlan(applyEdits(raw, [gatedEdit(raw)]).payload)
    expect(panelServings(plan, null, null, false, () => {})?.kind).not.toBe('gated')
  })

  it('a live fixture plus one edit scales the edited line like any other', () => {
    const raw = structuredClone(KADHI)
    const view = applyEdits(raw, [amountEdit(raw, 1, 2, 'tbsp')]).payload
    const plan = derivePlan(view)
    const choice = { mode: 'servings' as const, chosen: 6, original: 4 }
    const control = panelServings(plan, null, choice, false, () => {}, rows(raw))
    expect(control?.kind).toBe('live')
    const groups = panelIngredientGroups(plan.ingredientGroups, 1.5)
    const line = groups.flatMap((g) => g.items).find((i) => i.key === rows(raw)[1].id)!
    expect(line.trailing).toBe('3 tbsp')
    expect(quantityTrailingScaled(rows(view)[1], 1.5).text).toBe('3 tbsp')
  })

  it('a biryani line with no amount keeps the gate as imported even after an edit', () => {
    const raw = structuredClone(chickenBiryani as RecipePlanResponse)
    const view = applyEdits(raw, [amountEdit(raw, 0, 500, 'g')]).payload
    const control = panelServings(derivePlan(view), null, null, false, () => {}, rows(raw))
    expect(control?.kind).toBe('gated')
  })
})

describe('A10: a session started before an edit resumes against the overlaid payload', () => {
  it('no conflict, the same node ids, and a running timer keeps its endsAt', () => {
    const raw = structuredClone(KADHI)
    const model0 = deriveCookingModel(raw)
    const key = 'library:abc'
    let session = must(engine.start(null, model0, key, NOW, raw.graph.title))
    // walk to the first hands-off node and start it
    for (const id of model0.order) {
      const info = model0.nodes[id]
      session = must(info.attention === 'hands_on' ? engine.markDone(session, model0, id, NOW) : engine.startNode(session, model0, id, NOW))
      if (info.attention !== 'hands_on') break
    }
    const running = Object.entries(session.nodes).find(([, n]) => n.state === 'running')
    expect(running).toBeDefined()
    const endsAtBefore = (running![1] as { endsAt: number }).endsAt

    // the cook now edits: an amount, a rename, a removal and an add
    const edits = [
      amountEdit(raw, 1, 1, 'tbsp'),
      { id: 'e2', created_at: AT, op: 'set_ingredient_name', anchor: ingredientAnchor(raw, 4), value: { name: 'Fresh ginger' } } as RecipeEdit,
      { id: 'e3', created_at: AT, op: 'remove_ingredient', anchor: ingredientAnchor(raw, 5) } as RecipeEdit,
      { id: 'a1', created_at: AT, op: 'add_ingredient', value: { name: 'Lemon', amount: null, unit: null, step: null } } as RecipeEdit,
    ]
    const overlaid = applyEdits(raw, edits).payload
    const model1 = deriveCookingModel(overlaid)
    expect(model1.order).toEqual(model0.order)
    expect(Object.keys(model1.nodes)).toEqual(Object.keys(model0.nodes))
    const opened = engine.open(session, model1, key, NOW + 60_000)
    expect(opened.status).toBe('ok')
    if (opened.status !== 'ok') return
    expect(opened.session.graphId).toBe(model1.graphId)
    const after = Object.entries(opened.session.nodes).find(([, n]) => n.state === 'running')
    expect((after![1] as { endsAt: number }).endsAt).toBe(endsAtBefore)
  })
})

describe('A6 guard: keys, metrics and sessions never see an edited value', () => {
  const raw = structuredClone(KADHI)
  const edits: RecipeEdit[] = [
    { id: 'e1', created_at: AT, op: 'set_ingredient_name', anchor: ingredientAnchor(raw, 4), value: { name: 'Unique-Name' } } as RecipeEdit,
    { id: 'a1', created_at: AT, op: 'add_ingredient', value: { name: 'Zzz-Added', amount: null, unit: null, step: null } } as RecipeEdit,
  ]
  const overlaid = applyEdits(raw, edits).payload

  it('the source key, the graph id and the plan key are the same for the raw and the overlaid payload', () => {
    expect(canonicalSourceKey(overlaid.graph.source)).toBe(canonicalSourceKey(raw.graph.source))
    expect(overlaid.graph.id).toBe(raw.graph.id)
    expect(deriveCookingModel(overlaid).graphId).toBe(deriveCookingModel(raw).graphId)
    expect(planKeyFor({ kind: 'library', id: 'abc' }, () => undefined)).toBe('library:abc')
  })

  it('a stored session built from the overlaid model holds no edited value', () => {
    const storage = memoryStorage()
    const store = createSessionStore(storage, () => NOW)
    store.dispatch({ type: 'start', model: deriveCookingModel(overlaid), planKey: 'library:abc', now: NOW, recipeTitle: overlaid.graph.title, servingsChoice: null })
    const stored = [...['abc-cook:session:v1']].map((k) => storage.getItem(k) ?? '').join('')
    expect(stored.length).toBeGreaterThan(0)
    for (const mark of ['ing_user_', 'Unique-Name', 'Zzz-Added']) expect(stored).not.toContain(mark)
  })

  it('a completion event carries a plan key and times, never a recipe value', () => {
    const model = deriveCookingModel(overlaid)
    const started = must(engine.start(null, model, 'library:abc', NOW, overlaid.graph.title))
    const session = { ...started, finishedAt: NOW + 1 }
    const event = completionEventFor(session, 'finish', NOW + 2)
    const text = JSON.stringify(event)
    for (const mark of ['ing_user_', 'Unique-Name', 'Zzz-Added', overlaid.graph.title]) expect(text).not.toContain(mark)
  })

  it('cooking mode reads the edited values from the overlaid payload only', () => {
    expect(JSON.stringify(raw)).not.toContain('Unique-Name')
    expect(JSON.stringify(overlaid)).toContain('Unique-Name')
  })
})

describe('R6b: step edits and linked adds keep the same guarantees', () => {
  const raw = structuredClone(KADHI)
  const COOK = 2
  const stepText = 'Unique-Step-Text: cook for 40 minutes.'
  const edits: RecipeEdit[] = [
    { id: 's1', created_at: AT, op: 'set_step_text', anchor: stepAnchor(raw, COOK), value: { text: stepText } } as RecipeEdit,
    {
      id: 'k1',
      created_at: AT,
      op: 'add_ingredient',
      value: { name: 'Zzz-Linked', amount: null, unit: null, step: stepAnchor(raw, COOK) },
    } as RecipeEdit,
  ]
  const overlaid = applyEdits(raw, edits).payload

  it('N3 extended: a session started before the edit resumes with the same node ids, order and endsAt', () => {
    const model0 = deriveCookingModel(raw)
    const key = 'library:abc'
    let session = must(engine.start(null, model0, key, NOW, raw.graph.title))
    for (const id of model0.order) {
      const info = model0.nodes[id]
      session = must(info.attention === 'hands_on' ? engine.markDone(session, model0, id, NOW) : engine.startNode(session, model0, id, NOW))
      if (info.attention !== 'hands_on') break
    }
    const running = Object.entries(session.nodes).find(([, n]) => n.state === 'running')
    expect(running).toBeDefined()
    const endsAtBefore = (running![1] as { endsAt: number }).endsAt

    const model1 = deriveCookingModel(overlaid)
    expect(model1.order).toEqual(model0.order)
    expect(Object.keys(model1.nodes)).toEqual(Object.keys(model0.nodes))
    const cookId = (raw.graph.nodes as unknown as { id: string }[])[COOK].id
    expect(model1.nodes[cookId].instruction).toBe(stepText)
    expect(model0.nodes[cookId].instruction).not.toBe(stepText)
    const opened = engine.open(session, model1, key, NOW + 60_000)
    expect(opened.status).toBe('ok')
    if (opened.status !== 'ok') return
    expect(opened.session.graphId).toBe(model1.graphId)
    const after = Object.entries(opened.session.nodes).find(([, n]) => n.state === 'running')
    expect((after![1] as { endsAt: number }).endsAt).toBe(endsAtBefore)
  })

  it('the source key, graph id, plan key and the scheduler figures are the same for the raw and the overlaid payload', () => {
    expect(canonicalSourceKey(overlaid.graph.source)).toBe(canonicalSourceKey(raw.graph.source))
    expect(overlaid.graph.id).toBe(raw.graph.id)
    expect(deriveCookingModel(overlaid).graphId).toBe(deriveCookingModel(raw).graphId)
    expect(JSON.stringify(overlaid.plan)).toBe(JSON.stringify(raw.plan))
    expect(JSON.stringify(overlaid.summary)).toBe(JSON.stringify(raw.summary))
  })

  it('a stored session and a completion event hold no edited step text and no synthetic id', () => {
    const storage = memoryStorage()
    const store = createSessionStore(storage, () => NOW)
    store.dispatch({ type: 'start', model: deriveCookingModel(overlaid), planKey: 'library:abc', now: NOW, recipeTitle: overlaid.graph.title, servingsChoice: null })
    const stored = storage.getItem('abc-cook:session:v1') ?? ''
    expect(stored.length).toBeGreaterThan(0)
    for (const mark of ['ing_user_', 'Unique-Step-Text', 'Zzz-Linked']) expect(stored).not.toContain(mark)
    const model = deriveCookingModel(overlaid)
    const started = must(engine.start(null, model, 'library:abc', NOW, overlaid.graph.title))
    const text = JSON.stringify(completionEventFor({ ...started, finishedAt: NOW + 1 }, 'finish', NOW + 2))
    for (const mark of ['ing_user_', 'Unique-Step-Text', 'Zzz-Linked']) expect(text).not.toContain(mark)
  })

  it('the /recipes/reprocess body is the stored original, never an edited step', async () => {
    const s = setup({
      original: ORIGINAL,
      reprocess: () => Promise.resolve({ payload: urlPayload(KADAI), import_meta: META, postprocess_version: 14 } as ReprocessResponse),
    })
    s.library.setEdits(s.id, [
      { id: 's1', created_at: AT, op: 'set_step_text', anchor: stepAnchor(s.raw, 0), value: { text: stepText } } as RecipeEdit,
    ])
    await open(s)
    const [sent] = s.reprocess.mock.calls[0]
    expect(sent).toBe(ORIGINAL)
    expect(JSON.stringify({ original: sent })).not.toContain('Unique-Step-Text')
  })

  it('opening a saved recipe applies a step edit and counts a gone step as one orphan', async () => {
    const s = setup({ original: null, busy: true })
    s.library.setEdits(s.id, [
      { id: 's1', created_at: AT, op: 'set_step_text', anchor: stepAnchor(s.raw, 0), value: { text: stepText } } as RecipeEdit,
      {
        id: 's2',
        created_at: AT,
        op: 'set_step_text',
        anchor: { index: 1, expected: { text: 'A step that no longer exists.' } },
        value: { text: 'x' },
      } as RecipeEdit,
    ])
    const recipe = await open(s)
    const view = overlayForRecipe(recipe)
    expect((view.payload.graph.nodes as unknown as { instruction: string }[])[0].instruction).toBe(stepText)
    expect(view.orphans.map((o) => o.id)).toEqual(['s2'])
  })
})
