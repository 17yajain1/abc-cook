import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse, SavedRecipe } from '@abc-cook/schema'

import { deriveCookingModel } from '@/cooking/model'
import { createSessionStore, type StorageLike as SessionStorageLike } from '@/cooking/store'
import chickenBiryani from '@/__fixtures__/chicken-biryani.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import { canonicalSourceKey } from '@/library/sourceKey'
import { createLibrary, type SaveResult, type StorageLike as LibraryStorageLike } from '@/library/store'

import { planKeyFor, type PlanOrigin } from './planKey'

/**
 * CP1c (M3.4.5 session-lockout plan) — the false-conflict fix for an import that gets
 * saved to the library. Two tiers, matching this repo's existing split:
 *
 * - `planKeyFor` alone, with an injected `findSavedEntry` predicate (no `Library`, no
 *   storage) — the pure identity logic itself.
 * - `planKeyFor` wired to a real `createLibrary` + a real `createSessionStore`/`engine`
 *   — proving the actual bug (`import:<graphId>` vs `library:<id>` for the same saved
 *   recipe producing a false `'conflict'`) is fixed end to end, at the same store/engine
 *   layer `CookingModeScreen`/`App.tsx` actually drive (same tier CP1b's own tests used).
 */

const KADAI = kadaiPaneer as RecipePlanResponse
const BIRYANI = chickenBiryani as RecipePlanResponse
const T0 = 1_700_000_000_000

class MemoryStorage implements LibraryStorageLike, SessionStorageLike {
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
}

function mustSave(result: SaveResult): SavedRecipe {
  if (!result.ok) throw new Error(`unexpected save failure: ${result.message}`)
  return result.recipe
}

// ---------------------------------------------------------------------------
// planKeyFor — pure (tests 1, 2, 5's predicate-level shape)
// ---------------------------------------------------------------------------

describe('planKeyFor — pure', () => {
  it('test 1: an unsaved import gets its own transient import:<graph.id> identity', () => {
    const origin: PlanOrigin = { kind: 'import', payload: KADAI, importMeta: {} }
    expect(planKeyFor(origin, () => undefined)).toBe(`import:${KADAI.graph.id}`)
  })

  it('a save-failed import (findSavedEntry finds nothing) also falls back to import:<graph.id>', () => {
    // Mirrors `App.tsx`'s `onImported`: on `library.save` failure the origin stays
    // `import`, and `library.findBySource` correctly reports nothing for this source.
    const origin: PlanOrigin = { kind: 'import', payload: KADAI, importMeta: {} }
    expect(planKeyFor(origin, () => undefined)).toBe(`import:${KADAI.graph.id}`)
  })

  it('test 2: a saved import resolves to the stable library:<id> identity instead', () => {
    const origin: PlanOrigin = { kind: 'import', payload: KADAI, importMeta: {} }
    expect(planKeyFor(origin, () => ({ id: 'lib-id-1' }))).toBe('library:lib-id-1')
  })

  it('looks the saved entry up by this payload\'s own canonical source key, not an arbitrary one', () => {
    const origin: PlanOrigin = { kind: 'import', payload: KADAI, importMeta: {} }
    let seenKey: string | null = null
    planKeyFor(origin, (sourceKey) => {
      seenKey = sourceKey
      return undefined
    })
    expect(seenKey).toBe(canonicalSourceKey(KADAI.graph.source))
  })

  it('server and library origins are untouched by findSavedEntry — no second identity system', () => {
    expect(planKeyFor({ kind: 'server', recipeId: 'kadai' }, () => ({ id: 'irrelevant' }))).toBe('server:kadai')
    expect(planKeyFor({ kind: 'library', id: 'abc' }, () => undefined)).toBe('library:abc')
  })
})

// ---------------------------------------------------------------------------
// CP1c integration — real Library + real cooking SessionStore/engine
// ---------------------------------------------------------------------------

describe('CP1c integration — import route and library route resolve the same identity', () => {
  it('test 3: opening the same saved recipe from the library produces the same planKey the (already-saved) import route produces', () => {
    const library = createLibrary(new MemoryStorage(), () => new Date('2026-01-01T00:00:00Z'))
    const saved = mustSave(library.save(KADAI, {}))

    // `App.tsx`'s `onImported` always calls `library.save` before `planKey` is ever
    // read for that origin — this mirrors that ordering.
    const importPlanKey = planKeyFor({ kind: 'import', payload: KADAI, importMeta: {} }, (k) => library.findBySource(k))
    const libraryPlanKey = planKeyFor({ kind: 'library', id: saved.id }, (k) => library.findBySource(k))

    expect(importPlanKey).toBe(libraryPlanKey)
    expect(importPlanKey).toBe(`library:${saved.id}`)
  })

  it('test 4: a session started via the (already-saved) import route is recognized, not conflicted, when reopened via the library route', () => {
    const library = createLibrary(new MemoryStorage(), () => new Date('2026-01-01T00:00:00Z'))
    const saved = mustSave(library.save(KADAI, {}))
    const store = createSessionStore(new MemoryStorage(), () => T0)
    const model = deriveCookingModel(KADAI)

    const importPlanKey = planKeyFor({ kind: 'import', payload: KADAI, importMeta: {} }, (k) => library.findBySource(k))
    store.dispatch({ type: 'start', model, planKey: importPlanKey, now: T0, recipeTitle: KADAI.graph.title })

    // Later: the cook navigates away and reopens the same recipe from the Library
    // screen — `App.tsx`'s `openSaved` derives a fresh model from the same stored
    // payload and asks for `library:<id>`.
    const libraryPlanKey = planKeyFor({ kind: 'library', id: saved.id }, (k) => library.findBySource(k))
    const reopened = store.open(deriveCookingModel(saved.payload), libraryPlanKey, T0 + 60_000)

    expect(reopened.status).toBe('ok') // not 'conflict' — this is the bug CP1c fixes
  })

  it('test 5: a genuinely different saved recipe never shares the identity', () => {
    const library = createLibrary(new MemoryStorage(), () => new Date('2026-01-01T00:00:00Z'))
    library.save(KADAI, {})
    library.save(BIRYANI, {})

    const kadaiKey = planKeyFor({ kind: 'import', payload: KADAI, importMeta: {} }, (k) => library.findBySource(k))
    const biryaniKey = planKeyFor({ kind: 'import', payload: BIRYANI, importMeta: {} }, (k) => library.findBySource(k))

    expect(kadaiKey.startsWith('library:')).toBe(true)
    expect(biryaniKey.startsWith('library:')).toBe(true)
    expect(kadaiKey).not.toBe(biryaniKey)
  })

  it('test 6: a re-import producing a new graph.id still conflicts with the old active session — never silently replaced', () => {
    const library = createLibrary(new MemoryStorage(), () => new Date('2026-01-01T00:00:00Z'))
    const firstSave = mustSave(library.save(KADAI, {}))
    const store = createSessionStore(new MemoryStorage(), () => T0)

    const planKey1 = planKeyFor({ kind: 'import', payload: KADAI, importMeta: {} }, (k) => library.findBySource(k))
    store.dispatch({ type: 'start', model: deriveCookingModel(KADAI), planKey: planKey1, now: T0, recipeTitle: KADAI.graph.title })

    // Re-importing the SAME source (`POST /import` mints a fresh random `graph_id` per
    // call — M3.4 CP2 investigation §1) replaces the library entry in place, same `id`.
    const reImported: RecipePlanResponse = { ...KADAI, graph: { ...KADAI.graph, id: 'kadai-paneer-reimport-v2' } }
    const reSave = mustSave(library.save(reImported, {}))
    expect(reSave.id).toBe(firstSave.id) // same library entry — this is the trap CP1c must not fall into

    const planKey2 = planKeyFor({ kind: 'import', payload: reImported, importMeta: {} }, (k) => library.findBySource(k))
    expect(planKey2).toBe(planKey1) // same planKey string — exactly why graphId still has to be checked

    const opened = store.open(deriveCookingModel(reImported), planKey2, T0 + 60_000)
    expect(opened.status).toBe('conflict') // graphId mismatch (unmodified engine.open()) still catches this
    if (opened.status === 'conflict') {
      expect(opened.conflict.planKey).toBe(planKey1)
    }

    // And the stored session itself is untouched — never silently replaced.
    expect(store.getState()?.planKey).toBe(planKey1)
    expect(store.getState()?.graphId).toBe(KADAI.graph.id)
  })

  it('test 7: existing CP1a/CP1b conflict behavior is unchanged for two independently-started sessions', () => {
    // Two different recipes, two different planKeys, no import: involved at all — the
    // exact shape CP1a/CP1b's own tests already exercise against `engine.ts` directly.
    // Re-asserted here at the planKeyFor layer to confirm CP1c didn't touch it.
    const library = createLibrary(new MemoryStorage(), () => new Date('2026-01-01T00:00:00Z'))
    library.save(KADAI, {})
    const kadaiKey = planKeyFor({ kind: 'import', payload: KADAI, importMeta: {} }, (k) => library.findBySource(k))

    const store = createSessionStore(new MemoryStorage(), () => T0)
    store.dispatch({
      type: 'start',
      model: deriveCookingModel(KADAI),
      planKey: kadaiKey,
      now: T0,
      recipeTitle: KADAI.graph.title,
    })

    const conflictRead = store.open(deriveCookingModel(BIRYANI), 'library:some-other-biryani-id', T0)
    expect(conflictRead).toEqual({
      status: 'conflict',
      conflict: { planKey: kadaiKey, title: 'Kadai Paneer', state: 'active' },
    })
  })
})
