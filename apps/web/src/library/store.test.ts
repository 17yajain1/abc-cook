import { describe, expect, it } from 'vitest'

import type { ImportMeta, ImportOriginal, RecipePlanResponse } from '@abc-cook/schema'

import { choiceFactor, SERVINGS_DEFAULTED_WARNING, type ServingsChoice } from '@/lib/servings'

import { canonicalSourceKey } from './sourceKey'
import { createLibrary, type StorageLike } from './store'
import chickenBiryani from '@/__fixtures__/chicken-biryani.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import { derivePlan } from '@/plan/derive'

const KADAI = kadaiPaneer as RecipePlanResponse
const BIRYANI = chickenBiryani as RecipePlanResponse

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>()

  getItem(key: string): string | null {
    return this.data.has(key) ? (this.data.get(key) ?? null) : null
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }

  removeItem(key: string): void {
    this.data.delete(key)
  }

  raw(key: string): string | undefined {
    return this.data.get(key)
  }

  keys(): string[] {
    return [...this.data.keys()]
  }
}

const clock = (iso: string) => () => new Date(iso)

describe('createLibrary — save, list, get', () => {
  it('saves without loss: list() has it and get(id).payload equals the input', () => {
    const storage = new MemoryStorage()
    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))

    const result = library.save(KADAI)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(library.list().map((r) => r.id)).toEqual([result.recipe.id])
    expect(library.get(result.recipe.id)?.payload).toEqual(KADAI)
  })

  it('survives a reload: a new createLibrary over the same storage sees the same entries', () => {
    const storage = new MemoryStorage()
    const first = createLibrary(storage, clock('2026-09-15T10:00:00Z'))
    const saved = first.save(KADAI)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return

    const reopened = createLibrary(storage, clock('2026-09-15T11:00:00Z'))
    expect(reopened.list()).toEqual(first.list())
    expect(reopened.get(saved.recipe.id)?.payload).toEqual(KADAI)
  })

  it('a reopened saved recipe derives the same plan as the original', () => {
    const storage = new MemoryStorage()
    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))
    const saved = library.save(KADAI)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return

    const reopenedPayload = library.get(saved.recipe.id)!.payload
    expect(derivePlan(reopenedPayload)).toEqual(derivePlan(KADAI))
  })
})

describe('createLibrary — import_meta persistence (A6)', () => {
  const META: ImportMeta = {
    warnings: ['degraded', 'uses 2 burners'],
    review_recommended: true,
    sources: ['transcript', 'blog'],
    provenance: null,
    degraded: true,
  }

  it('is null when save() is called without one — the fixture-recipe path', () => {
    const storage = new MemoryStorage()
    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))
    const saved = library.save(KADAI)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.recipe.import_meta).toBeNull()
    expect(library.get(saved.recipe.id)?.import_meta).toBeNull()
  })

  it('persists and survives a reload', () => {
    const storage = new MemoryStorage()
    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))
    const saved = library.save(KADAI, META)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.recipe.import_meta).toEqual(META)

    const reopened = createLibrary(storage, clock('2026-09-15T11:00:00Z'))
    expect(reopened.get(saved.recipe.id)?.import_meta).toEqual(META)
  })

  it('a second save replaces the previous import_meta in place', () => {
    const storage = new MemoryStorage()
    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))
    const first = library.save(KADAI, META)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const clean: ImportMeta = { warnings: [], review_recommended: false, sources: [], provenance: null, degraded: false }
    const second = library.save(KADAI, clean)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.recipe.id).toBe(first.recipe.id)
    expect(second.recipe.import_meta).toEqual(clean)
  })
})

describe('createLibrary — duplicate policy', () => {
  it('replaces in place on a second save of the same source', () => {
    const storage = new MemoryStorage()
    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))

    const first = library.save(KADAI)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.replaced).toBe(false)

    const library2 = createLibrary(storage, clock('2026-09-15T12:00:00Z'))
    const second = library2.save(KADAI)
    expect(second.ok).toBe(true)
    if (!second.ok) return

    expect(second.replaced).toBe(true)
    expect(second.recipe.id).toBe(first.recipe.id)
    expect(second.recipe.saved_at).toBe(first.recipe.saved_at)
    expect(second.recipe.updated_at).toBe('2026-09-15T12:00:00.000Z')
    expect(library2.list()).toHaveLength(1)
  })

  it('"Update saved copy" (a second save of the same source) replaces the title, not just import_meta', () => {
    // P1 #5 Commit 3: title resolution can change `graph.title` on a re-import
    // (a different grounded claim, or a different fallback cleanup) without the
    // source itself changing — `save()` must carry that new title through, not
    // keep showing the one from the first import.
    const storage = new MemoryStorage()
    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))

    const first = library.save(KADAI)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.recipe.payload.graph.title).toBe(KADAI.graph.title)

    const reimported: RecipePlanResponse = {
      ...KADAI,
      graph: { ...KADAI.graph, title: 'Restaurant-Style Kadai Paneer' },
    }
    expect(canonicalSourceKey(reimported.graph.source)).toBe(canonicalSourceKey(KADAI.graph.source))

    const second = library.save(reimported)
    expect(second.ok).toBe(true)
    if (!second.ok) return

    expect(second.replaced).toBe(true)
    expect(second.recipe.id).toBe(first.recipe.id) // same saved entry, updated in place
    expect(second.recipe.payload.graph.title).toBe('Restaurant-Style Kadai Paneer')
    expect(library.list()).toHaveLength(1)
    expect(library.get(first.recipe.id)?.payload.graph.title).toBe('Restaurant-Style Kadai Paneer')
  })

  it('two different sources create two entries, findable by source key', () => {
    const storage = new MemoryStorage()
    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))

    const a = library.save(KADAI)
    const b = library.save(BIRYANI)
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return

    expect(library.list()).toHaveLength(2)
    expect(library.findBySource(canonicalSourceKey(KADAI.graph.source))?.id).toBe(a.recipe.id)
    expect(library.findBySource(canonicalSourceKey(BIRYANI.graph.source))?.id).toBe(b.recipe.id)
  })
})

describe('createLibrary — failure handling', () => {
  it('setItem throwing returns {ok:false} and leaves the list unchanged', () => {
    const storage = new MemoryStorage()
    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))
    library.save(KADAI)
    const before = library.list()

    const originalSetItem = storage.setItem.bind(storage)
    storage.setItem = () => {
      throw new Error('QuotaExceededError')
    }

    const result = library.save(BIRYANI)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.message.length).toBeGreaterThan(0)
    expect(library.list()).toEqual(before)

    storage.setItem = originalSetItem
  })
})

describe('createLibrary — compatibility with unreadable data', () => {
  it('corrupt JSON reads as empty, preserves the raw value, and never throws', () => {
    const storage = new MemoryStorage()
    storage.setItem('abc-cook:library:v1', '{not valid json')

    let library: ReturnType<typeof createLibrary> | undefined
    expect(() => {
      library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))
    }).not.toThrow()

    expect(library!.list()).toEqual([])
    const salvageKey = storage.keys().find((k) => k.startsWith('abc-cook:library:v1:unreadable-'))
    expect(salvageKey).toBeDefined()
    expect(storage.raw(salvageKey!)).toBe('{not valid json')
  })

  it('an unknown version reads as empty and preserves the raw value', () => {
    const storage = new MemoryStorage()
    storage.setItem('abc-cook:library:v1', JSON.stringify({ version: 99, recipes: [] }))

    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))
    expect(library.list()).toEqual([])
    expect(storage.keys().some((k) => k.startsWith('abc-cook:library:v1:unreadable-'))).toBe(true)
  })

  it('a version 2 library loads and is not salvaged', () => {
    const storage = new MemoryStorage()
    storage.setItem('abc-cook:library:v1', JSON.stringify({ version: 2, recipes: [] }))

    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))
    expect(library.list()).toEqual([])
    expect(storage.keys().some((k) => k.startsWith('abc-cook:library:v1:unreadable-'))).toBe(false)
  })

  it('a subsequent save does not clobber the salvaged raw value', () => {
    const storage = new MemoryStorage()
    storage.setItem('abc-cook:library:v1', 'garbage')
    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))
    library.save(KADAI)

    const salvageKey = storage.keys().find((k) => k.startsWith('abc-cook:library:v1:unreadable-'))
    expect(storage.raw(salvageKey!)).toBe('garbage')
  })

  it('the text-sourced Kadai Paneer fixture saves and reopens like any other', () => {
    const storage = new MemoryStorage()
    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))
    expect(KADAI.graph.source.kind).toBe('text')

    const saved = library.save(KADAI)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(library.get(saved.recipe.id)?.payload).toEqual(KADAI)
  })
})

// ---------------------------------------------------------------------------
// Staleness PR 2 (B1, B6): v1 → v2 migration, save extras, quota fallback, refresh.
// ---------------------------------------------------------------------------

const ORIGINAL = {
  recipe: { title: 'x', ingredients: [], steps: [] },
  repair: null,
  source_text: 'some grounding text',
  raw_title: 'Raw title',
  blog_name: null,
  source: KADAI.graph.source,
  graph_id: 'g_1',
  acquisition_warnings: [],
  sources: [],
} as unknown as ImportOriginal

const CLEAN_META: ImportMeta = { warnings: [], review_recommended: false, sources: [], provenance: null, degraded: false }
const KEY = 'abc-cook:library:v1'

function v1Entry(id: string, payload: RecipePlanResponse, extra: Record<string, unknown> = {}) {
  return {
    id,
    source_key: canonicalSourceKey(payload.graph.source),
    saved_at: '2026-09-01T10:00:00.000Z',
    updated_at: '2026-09-01T10:00:00.000Z',
    payload,
    ...extra,
  }
}

function seed(storage: MemoryStorage, body: unknown) {
  storage.setItem(KEY, JSON.stringify(body))
}

describe('createLibrary — v1 → v2 migration (B6)', () => {
  const v1Body = () => ({
    version: 1,
    recipes: [
      v1Entry('a', KADAI, { import_meta: CLEAN_META }),
      v1Entry('b', BIRYANI, { import_meta: null }),
      v1Entry('c', { ...KADAI, graph: { ...KADAI.graph, source: { ...KADAI.graph.source, value: 'other text' } } }),
    ],
  })

  it('reads all three v1 entries; every v1 field is deep-equal; a missing import_meta stays missing', () => {
    const storage = new MemoryStorage()
    const body = v1Body()
    seed(storage, body)
    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))

    expect(library.list()).toHaveLength(3)
    for (const original of body.recipes) {
      const got = library.get(original.id)! as unknown as Record<string, unknown>
      for (const [k, v] of Object.entries(original)) expect(got[k]).toEqual(v)
    }
    expect('import_meta' in library.get('c')!).toBe(false)
  })

  it('fills the new fields: postprocess_version null, original null, edits []', () => {
    const storage = new MemoryStorage()
    seed(storage, v1Body())
    const got = createLibrary(storage).get('a')!
    expect(got.postprocess_version).toBeNull()
    expect(got.original).toBeNull()
    expect(got.edits).toEqual([])
  })

  it('the next save writes version 2 with every entry', () => {
    const storage = new MemoryStorage()
    seed(storage, v1Body())
    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))
    expect(library.save(BIRYANI).ok).toBe(true)

    const written = JSON.parse(storage.raw(KEY)!)
    expect(written.version).toBe(2)
    expect(written.recipes).toHaveLength(3)
  })

  it('a v2 reread is the identity', () => {
    const storage = new MemoryStorage()
    const first = createLibrary(storage, clock('2026-09-15T10:00:00Z'))
    first.save(KADAI, CLEAN_META, { original: ORIGINAL, postprocess_version: 9 })
    const raw = storage.raw(KEY)!

    const second = createLibrary(storage, clock('2026-09-15T11:00:00Z'))
    expect(second.list()).toEqual(first.list())
    expect(storage.raw(KEY)).toBe(raw)
  })

  it('unknown fields on an entry survive a migrate + write', () => {
    const storage = new MemoryStorage()
    seed(storage, { version: 1, recipes: [v1Entry('a', KADAI, { future_field: { n: 1 } })] })
    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))
    library.save(BIRYANI)
    const written = JSON.parse(storage.raw(KEY)!)
    expect(written.recipes.find((r: { id: string }) => r.id === 'a').future_field).toEqual({ n: 1 })
  })

  it('a malformed original becomes null and the entry is kept', () => {
    const storage = new MemoryStorage()
    seed(storage, {
      version: 2,
      recipes: [v1Entry('a', KADAI, { original: { recipe: 'nope' }, postprocess_version: 9, edits: [] })],
    })
    const got = createLibrary(storage).get('a')!
    expect(got.original).toBeNull()
    expect(got.postprocess_version).toBe(9)
  })

  it('a non-integer stamp becomes null; a non-array edits becomes []', () => {
    const storage = new MemoryStorage()
    seed(storage, {
      version: 2,
      recipes: [v1Entry('a', KADAI, { postprocess_version: '9', edits: 'x' }), v1Entry('b', BIRYANI, { postprocess_version: 8.5 })],
    })
    const library = createLibrary(storage)
    expect(library.get('a')!.postprocess_version).toBeNull()
    expect(library.get('a')!.edits).toEqual([])
    expect(library.get('b')!.postprocess_version).toBeNull()
  })

  it('a well-formed original and edits are kept verbatim', () => {
    const storage = new MemoryStorage()
    const edits = [{ any: 'thing' }]
    seed(storage, { version: 2, recipes: [v1Entry('a', KADAI, { original: ORIGINAL, postprocess_version: 9, edits })] })
    const got = createLibrary(storage).get('a')!
    expect(got.original).toEqual(ORIGINAL)
    expect(got.edits).toEqual(edits)
  })
})

describe('createLibrary — save extras and quota fallback (B1)', () => {
  it('stores original and postprocess_version from extras', () => {
    const library = createLibrary(new MemoryStorage(), clock('2026-09-15T10:00:00Z'))
    const saved = library.save(KADAI, CLEAN_META, { original: ORIGINAL, postprocess_version: 9 })
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.recipe.original).toEqual(ORIGINAL)
    expect(saved.recipe.postprocess_version).toBe(9)
    expect(saved.withoutOriginal).toBe(false)
  })

  it('without extras both are null and edits is []', () => {
    const library = createLibrary(new MemoryStorage(), clock('2026-09-15T10:00:00Z'))
    const saved = library.save(KADAI)
    if (!saved.ok) throw new Error('save failed')
    expect(saved.recipe.original).toBeNull()
    expect(saved.recipe.postprocess_version).toBeNull()
    expect(saved.recipe.edits).toEqual([])
  })

  it('a replace keeps the existing edits', () => {
    const storage = new MemoryStorage()
    const edits = [{ any: 'thing' }]
    seed(storage, { version: 2, recipes: [v1Entry('a', KADAI, { original: null, postprocess_version: 8, edits })] })
    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))
    const saved = library.save(KADAI, CLEAN_META, { original: ORIGINAL, postprocess_version: 9 })
    if (!saved.ok) throw new Error('save failed')
    expect(saved.replaced).toBe(true)
    expect(saved.recipe.edits).toEqual(edits)
    expect(saved.recipe.original).toEqual(ORIGINAL)
  })

  /** A storage that rejects any write whose body contains a non-null `original`. */
  function quotaOnOriginal(storage: MemoryStorage) {
    const real = storage.setItem.bind(storage)
    storage.setItem = (k, v) => {
      if (k === KEY && /"original":\{/.test(v)) throw new Error('QuotaExceededError')
      real(k, v)
    }
  }

  it('NEW entry: a failed write retries once with original null, keeps the stamp', () => {
    const storage = new MemoryStorage()
    quotaOnOriginal(storage)
    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))
    const saved = library.save(KADAI, CLEAN_META, { original: ORIGINAL, postprocess_version: 9 })
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.withoutOriginal).toBe(true)
    expect(saved.recipe.original).toBeNull()
    expect(saved.recipe.postprocess_version).toBe(9)
    expect(JSON.parse(storage.raw(KEY)!).recipes[0].original).toBeNull()
  })

  it('REPLACED entry: the same retry applies', () => {
    const storage = new MemoryStorage()
    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))
    library.save(KADAI)
    quotaOnOriginal(storage)
    const saved = library.save(KADAI, CLEAN_META, { original: ORIGINAL, postprocess_version: 9 })
    if (!saved.ok) throw new Error('save failed')
    expect(saved.replaced).toBe(true)
    expect(saved.withoutOriginal).toBe(true)
    expect(saved.recipe.original).toBeNull()
  })

  it('both writes failing returns {ok:false} and leaves the list unchanged', () => {
    const storage = new MemoryStorage()
    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))
    library.save(KADAI)
    const before = library.list()
    storage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    const saved = library.save(BIRYANI, CLEAN_META, { original: ORIGINAL, postprocess_version: 9 })
    expect(saved.ok).toBe(false)
    expect(library.list()).toEqual(before)
  })
})

describe('createLibrary — refresh in place (B1)', () => {
  const refreshed: RecipePlanResponse = { ...KADAI, graph: { ...KADAI.graph, title: 'Refreshed title' } }

  it('replaces payload, import_meta and stamp; keeps id, source_key, saved_at, updated_at, original, edits', () => {
    const storage = new MemoryStorage()
    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))
    const saved = library.save(KADAI, CLEAN_META, { original: ORIGINAL, postprocess_version: 8 })
    if (!saved.ok) throw new Error('save failed')
    library.save(BIRYANI) // a later entry, so a reorder would be visible
    const orderBefore = library.list().map((r) => r.id)

    const later = createLibrary(storage, clock('2026-09-20T10:00:00Z'))
    const result = later.refresh(saved.recipe.id, {
      payload: refreshed,
      import_meta: { ...CLEAN_META, degraded: true },
      postprocess_version: 9,
    })
    expect(result.ok).toBe(true)
    const got = later.get(saved.recipe.id)!
    expect(got.payload.graph.title).toBe('Refreshed title')
    expect(got.import_meta?.degraded).toBe(true)
    expect(got.postprocess_version).toBe(9)
    expect(got.id).toBe(saved.recipe.id)
    expect(got.source_key).toBe(saved.recipe.source_key)
    expect(got.saved_at).toBe(saved.recipe.saved_at)
    expect(got.updated_at).toBe(saved.recipe.updated_at)
    expect(got.original).toEqual(ORIGINAL)
    expect(got.edits).toEqual([])
    expect(later.list().map((r) => r.id)).toEqual(orderBefore)
  })

  it('persists across a reload', () => {
    const storage = new MemoryStorage()
    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))
    const saved = library.save(KADAI)
    if (!saved.ok) throw new Error('save failed')
    library.refresh(saved.recipe.id, { payload: refreshed, import_meta: null, postprocess_version: 9 })
    expect(createLibrary(storage).get(saved.recipe.id)?.payload.graph.title).toBe('Refreshed title')
  })

  it('rejects a payload whose source key differs, writing nothing', () => {
    const storage = new MemoryStorage()
    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))
    const saved = library.save(KADAI)
    if (!saved.ok) throw new Error('save failed')
    const raw = storage.raw(KEY)
    const result = library.refresh(saved.recipe.id, { payload: BIRYANI, import_meta: null, postprocess_version: 9 })
    expect(result.ok).toBe(false)
    expect(storage.raw(KEY)).toBe(raw)
  })

  it('rejects an unknown id', () => {
    const library = createLibrary(new MemoryStorage())
    expect(library.refresh('nope', { payload: KADAI, import_meta: null, postprocess_version: 9 }).ok).toBe(false)
  })

  it('a failed write returns {ok:false} and leaves the entry unchanged', () => {
    const storage = new MemoryStorage()
    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))
    const saved = library.save(KADAI)
    if (!saved.ok) throw new Error('save failed')
    storage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    const result = library.refresh(saved.recipe.id, { payload: refreshed, import_meta: null, postprocess_version: 9 })
    expect(result.ok).toBe(false)
    expect(library.get(saved.recipe.id)?.payload.graph.title).toBe(KADAI.graph.title)
  })
})

describe('createLibrary — the persisted servings choice (R4b)', () => {
  const S = (chosen: number, original: number): ServingsChoice => ({ mode: 'servings', chosen, original })
  const B = (multiplier: 0.5 | 1 | 1.5 | 2 | 3): ServingsChoice => ({ mode: 'batch', multiplier })
  // Same source as KADAI, so it is the same saved entry; only the servings facts differ.
  const withServings = (servings: number, stated = true): RecipePlanResponse => ({
    ...KADAI,
    graph: { ...KADAI.graph, servings, servings_stated: stated },
  })
  const LEGACY_META: ImportMeta = { ...CLEAN_META, warnings: [SERVINGS_DEFAULTED_WARNING] }

  function seeded(extra: Record<string, unknown>, payload: RecipePlanResponse = KADAI, meta: ImportMeta | null = CLEAN_META) {
    const storage = new MemoryStorage()
    seed(storage, {
      version: 2,
      recipes: [v1Entry('a', payload, { import_meta: meta, postprocess_version: 9, original: null, edits: [], ...extra })],
    })
    return { storage, library: createLibrary(storage, clock('2026-09-15T10:00:00Z')) }
  }

  describe('reading', () => {
    it('an entry saved before the field reads as null, which is factor 1, and storage is not rewritten', () => {
      const { storage, library } = seeded({})
      const raw = storage.raw(KEY)
      expect(library.get('a')!.servings_choice).toBeNull()
      expect(choiceFactor(library.get('a')!.servings_choice)).toBe(1)
      expect(storage.raw(KEY)).toBe(raw)
    })

    it('a valid stored choice is kept', () => {
      expect(seeded({ servings_choice: S(5, 3) }).library.get('a')!.servings_choice).toEqual(S(5, 3))
      expect(seeded({ servings_choice: B(2) }, withServings(4, false)).library.get('a')!.servings_choice).toEqual(B(2))
    })

    it.each([
      ['a string', 'six'],
      ['a number', 6],
      ['an off-ladder multiplier', { mode: 'batch', multiplier: 4 }],
      ['a zero headcount', { mode: 'servings', chosen: 0, original: 3 }],
      ['an unknown mode', { mode: 'pinch', chosen: 2, original: 3 }],
    ])('%s reads as null; the entry and every other field are kept', (_name, bad) => {
      const stored = v1Entry('a', KADAI, {
        import_meta: CLEAN_META,
        postprocess_version: 9,
        original: null,
        edits: [],
        servings_choice: bad,
      })
      const storage = new MemoryStorage()
      seed(storage, { version: 2, recipes: [stored] })
      const got = createLibrary(storage).get('a')! as unknown as Record<string, unknown>
      expect(got).toBeDefined()
      expect(got.servings_choice).toBeNull()
      for (const [k, v] of Object.entries(stored)) if (k !== 'servings_choice') expect(got[k]).toEqual(v)
    })

    it('drops a choice whose original no longer matches the recipe servings', () => {
      expect(seeded({ servings_choice: S(6, 4) }).library.get('a')!.servings_choice).toBeNull()
    })

    it('drops a servings choice when the recipe went from stated to defaulted, by flag or by the legacy warning', () => {
      expect(seeded({ servings_choice: S(5, 3) }, withServings(3, false)).library.get('a')!.servings_choice).toBeNull()
      expect(seeded({ servings_choice: S(5, 3) }, KADAI, LEGACY_META).library.get('a')!.servings_choice).toBeNull()
    })

    it('drops a batch choice when the recipe went from defaulted to stated', () => {
      expect(seeded({ servings_choice: B(2) }).library.get('a')!.servings_choice).toBeNull()
    })

    it('clamps chosen into the bounds', () => {
      expect(seeded({ servings_choice: S(99, 3) }).library.get('a')!.servings_choice).toEqual(S(7, 3))
    })
  })

  describe('setServingsChoice', () => {
    function two() {
      const storage = new MemoryStorage()
      let t = '2026-09-15T10:00:00Z'
      const library = createLibrary(storage, () => new Date(t))
      const first = library.save(KADAI)
      t = '2026-09-15T11:00:00Z'
      const second = library.save(BIRYANI)
      if (!first.ok || !second.ok) throw new Error('save failed')
      return { storage, library, first: first.recipe, second: second.recipe }
    }

    it('writes the choice and leaves updated_at, saved_at, everything else and the list order alone', () => {
      const { library, first } = two()
      const before = library.get(first.id)!
      const orderBefore = library.list().map((r) => r.id)

      const result = library.setServingsChoice(first.id, S(5, 3))
      expect(result.ok).toBe(true)
      const after = library.get(first.id)! as unknown as Record<string, unknown>
      expect(after.servings_choice).toEqual(S(5, 3))
      for (const [k, v] of Object.entries(before)) if (k !== 'servings_choice') expect(after[k]).toEqual(v)
      expect(library.list().map((r) => r.id)).toEqual(orderBefore)
    })

    it('survives a reload', () => {
      const { storage, library, first } = two()
      library.setServingsChoice(first.id, S(5, 3))
      expect(createLibrary(storage).get(first.id)!.servings_choice).toEqual(S(5, 3))
    })

    it('factor 1 writes null, both for the original headcount and for batch x1', () => {
      const { storage, library, first, second } = two()
      library.setServingsChoice(first.id, S(5, 3))
      expect(library.setServingsChoice(first.id, S(3, 3))).toMatchObject({ ok: true, recipe: { servings_choice: null } })
      expect(createLibrary(storage).get(first.id)!.servings_choice).toBeNull()
      expect(library.setServingsChoice(second.id, null)).toMatchObject({ ok: true, recipe: { servings_choice: null } })
    })

    it('reconciles against the entry before writing: a choice for other servings is stored as null', () => {
      const { library, first } = two()
      library.setServingsChoice(first.id, S(6, 4))
      expect(library.get(first.id)!.servings_choice).toBeNull()
    })

    it('an unknown id is {ok:false} and changes nothing', () => {
      const { storage, library } = two()
      const raw = storage.raw(KEY)
      const list = library.list()
      expect(library.setServingsChoice('nope', S(5, 3)).ok).toBe(false)
      expect(storage.raw(KEY)).toBe(raw)
      expect(library.list()).toEqual(list)
    })

    it('a failed write is {ok:false} and leaves the list unchanged', () => {
      const { storage, library, first } = two()
      const list = library.list()
      storage.setItem = () => {
        throw new Error('QuotaExceededError')
      }
      expect(library.setServingsChoice(first.id, S(5, 3)).ok).toBe(false)
      expect(library.list()).toEqual(list)
    })
  })

  describe('save', () => {
    const savedFor = (library: ReturnType<typeof createLibrary>, id: string) => library.get(id)!.servings_choice

    it('a new entry takes the provided choice, or null', () => {
      const a = createLibrary(new MemoryStorage())
      const withChoice = a.save(KADAI, CLEAN_META, { servings_choice: S(5, 3) })
      if (!withChoice.ok) throw new Error('save failed')
      expect(withChoice.recipe.servings_choice).toEqual(S(5, 3))

      const b = createLibrary(new MemoryStorage())
      const plain = b.save(KADAI)
      if (!plain.ok) throw new Error('save failed')
      expect(plain.recipe.servings_choice).toBeNull()
    })

    it('a replace with the extra undefined keeps the existing choice', () => {
      const library = createLibrary(new MemoryStorage())
      const first = library.save(KADAI)
      if (!first.ok) throw new Error('save failed')
      library.setServingsChoice(first.recipe.id, S(5, 3))

      const again = library.save(KADAI, CLEAN_META, { postprocess_version: 9 })
      expect(again.ok && again.replaced).toBe(true)
      expect(savedFor(library, first.recipe.id)).toEqual(S(5, 3))
    })

    it('a replace with a provided choice wins over the existing one; null clears it', () => {
      const library = createLibrary(new MemoryStorage())
      const first = library.save(KADAI, CLEAN_META, { servings_choice: S(5, 3) })
      if (!first.ok) throw new Error('save failed')

      library.save(KADAI, CLEAN_META, { servings_choice: S(2, 3) })
      expect(savedFor(library, first.recipe.id)).toEqual(S(2, 3))
      library.save(KADAI, CLEAN_META, { servings_choice: null })
      expect(savedFor(library, first.recipe.id)).toBeNull()
    })

    it('reconciles against the new payload, for a kept and for a provided choice', () => {
      const library = createLibrary(new MemoryStorage())
      const first = library.save(KADAI, CLEAN_META, { servings_choice: S(6, 3) })
      if (!first.ok) throw new Error('save failed')

      library.save(withServings(4), CLEAN_META)
      expect(savedFor(library, first.recipe.id)).toBeNull()

      library.save(withServings(4), CLEAN_META, { servings_choice: S(6, 3) })
      expect(savedFor(library, first.recipe.id)).toBeNull()
      library.save(withServings(4), CLEAN_META, { servings_choice: S(6, 4) })
      expect(savedFor(library, first.recipe.id)).toEqual(S(6, 4))
    })

    it('drops the kept choice when the mode changes (stated to defaulted and back)', () => {
      const library = createLibrary(new MemoryStorage())
      const first = library.save(KADAI, CLEAN_META, { servings_choice: S(5, 3) })
      if (!first.ok) throw new Error('save failed')
      library.save(withServings(3, false), CLEAN_META)
      expect(savedFor(library, first.recipe.id)).toBeNull()

      library.save(withServings(3, false), CLEAN_META, { servings_choice: B(2) })
      expect(savedFor(library, first.recipe.id)).toEqual(B(2))
      library.save(KADAI, CLEAN_META)
      expect(savedFor(library, first.recipe.id)).toBeNull()
    })

    it('the quota fallback without original still stores the choice', () => {
      const storage = new MemoryStorage()
      const library = createLibrary(storage)
      const real = storage.setItem.bind(storage)
      storage.setItem = (k, v) => {
        if (k === KEY && /"original":\{/.test(v)) throw new Error('QuotaExceededError')
        real(k, v)
      }
      const saved = library.save(KADAI, CLEAN_META, { original: ORIGINAL, servings_choice: S(5, 3) })
      expect(saved.ok && saved.withoutOriginal).toBe(true)
      expect(saved.ok && saved.recipe.servings_choice).toEqual(S(5, 3))
    })
  })

  describe('refresh', () => {
    const refreshInput = (payload: RecipePlanResponse, meta: ImportMeta | null = CLEAN_META) => ({
      payload,
      import_meta: meta,
      postprocess_version: 10,
    })

    it('keeps the choice when the recipe is the same', () => {
      const library = createLibrary(new MemoryStorage())
      const saved = library.save(KADAI, CLEAN_META, { servings_choice: S(5, 3) })
      if (!saved.ok) throw new Error('save failed')
      const result = library.refresh(saved.recipe.id, refreshInput(KADAI))
      expect(result.ok && result.recipe.servings_choice).toEqual(S(5, 3))
    })

    it('drops it when the servings change (3 to 4)', () => {
      const library = createLibrary(new MemoryStorage())
      const saved = library.save(KADAI, CLEAN_META, { servings_choice: S(5, 3) })
      if (!saved.ok) throw new Error('save failed')
      const result = library.refresh(saved.recipe.id, refreshInput(withServings(4)))
      expect(result.ok && result.recipe.servings_choice).toBeNull()
      expect(library.get(saved.recipe.id)!.servings_choice).toBeNull()
    })

    it('drops it when the mode changes, by flag or by the legacy warning', () => {
      const library = createLibrary(new MemoryStorage())
      const saved = library.save(KADAI, CLEAN_META, { servings_choice: S(5, 3) })
      if (!saved.ok) throw new Error('save failed')
      expect(library.refresh(saved.recipe.id, refreshInput(withServings(3, false)))).toMatchObject({
        ok: true,
        recipe: { servings_choice: null },
      })

      library.setServingsChoice(saved.recipe.id, null)
      const again = library.save(KADAI, CLEAN_META, { servings_choice: S(5, 3) })
      if (!again.ok) throw new Error('save failed')
      expect(library.refresh(saved.recipe.id, refreshInput(KADAI, LEGACY_META))).toMatchObject({
        ok: true,
        recipe: { servings_choice: null },
      })
    })

    it('a feed replacement (import_meta null) keeps a stated choice', () => {
      const library = createLibrary(new MemoryStorage())
      const saved = library.save(KADAI, null, { servings_choice: S(5, 3) })
      if (!saved.ok) throw new Error('save failed')
      const result = library.refresh(saved.recipe.id, refreshInput(KADAI, null))
      expect(result.ok && result.recipe.servings_choice).toEqual(S(5, 3))
    })
  })
})
