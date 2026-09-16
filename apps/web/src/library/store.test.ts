import { describe, expect, it } from 'vitest'

import type { ImportMeta, RecipePlanResponse } from '@abc-cook/schema'

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

  it('a wrong version reads as empty and preserves the raw value', () => {
    const storage = new MemoryStorage()
    storage.setItem('abc-cook:library:v1', JSON.stringify({ version: 2, recipes: [] }))

    const library = createLibrary(storage, clock('2026-09-15T10:00:00Z'))
    expect(library.list()).toEqual([])
    expect(storage.keys().some((k) => k.startsWith('abc-cook:library:v1:unreadable-'))).toBe(true)
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
