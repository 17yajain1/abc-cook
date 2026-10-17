import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import { canonicalSourceKey } from '../library/sourceKey'
import { createLibrary, type StorageLike } from '../library/store'
import { submitPlan } from './duplicate'

const ID = 'dQw4w9WgXcQ'

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>()
  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value)
  }
  removeItem(key: string): void {
    this.data.delete(key)
  }
}

/** A payload for a YouTube source, as an import of `url` would produce. */
function payloadFor(url: string, title: string): RecipePlanResponse {
  const base = structuredClone(kadaiPaneer) as RecipePlanResponse
  base.graph.title = title
  base.graph.source = { kind: 'url', value: url, imported_at: '2026-10-17T00:00:00Z' }
  return base
}

describe('Import again replaces the saved entry', () => {
  // The prefilled value is the saved source's own value; the second run uses another
  // spelling of the same video, as a person who pasted a share link would.
  it.each([
    ['the prefilled value', `https://www.youtube.com/watch?v=${ID}`],
    ['a youtu.be form of the same id', `https://youtu.be/${ID}?si=share`],
  ])('with %s: count stays 1, same id, replaced, updated_at advances', (_name, again) => {
    let now = new Date('2026-10-17T10:00:00Z')
    const library = createLibrary(new MemoryStorage(), () => now)

    const first = library.save(payloadFor(`https://www.youtube.com/watch?v=${ID}`, 'First import'))
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.replaced).toBe(false)
    expect(library.list()).toHaveLength(1)

    // A plain submit of the same video is a duplicate...
    expect(submitPlan(again, { findSaved: library.findBySource }).kind).toBe('duplicate')
    // ...Import again sets skipDuplicateCheck, so it imports...
    const plan = submitPlan(again, { findSaved: library.findBySource, skipDuplicateCheck: true })
    expect(plan.kind).toBe('import')

    // ...and its result goes through the one existing save path.
    now = new Date('2026-10-17T11:30:00Z')
    const second = library.save(payloadFor(again, 'Second import'))
    expect(second.ok).toBe(true)
    if (!second.ok) return

    expect(library.list()).toHaveLength(1) // never a second entry
    expect(second.replaced).toBe(true)
    expect(second.recipe.id).toBe(first.recipe.id)
    expect(second.recipe.saved_at).toBe(first.recipe.saved_at)
    expect(second.recipe.updated_at > first.recipe.updated_at).toBe(true)
    expect(second.recipe.payload.graph.title).toBe('Second import')
    expect(second.recipe.source_key).toBe(
      canonicalSourceKey({ kind: 'url', value: again, imported_at: '' }),
    )
  })
})
