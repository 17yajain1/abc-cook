import { describe, expect, it, vi } from 'vitest'

import type { ImportOriginal, RecipePlanResponse } from '@abc-cook/schema'

import biryani from '@/__fixtures__/chicken-biryani.plan-response.json'
import kadai from '@/__fixtures__/kadai-paneer.plan-response.json'
import { canonicalSourceKey } from '@/library/sourceKey'
import { createLibrary, type StorageLike } from '@/library/store'
import { persistTargetId } from '@/library/servingsPersist'
import type { PlanOrigin } from '@/cooking-mode/planKey'

import {
  copiedDate,
  cookOnRecipe,
  END_OF_PAGE_COPY,
  endOfPageFor,
  removeConfirmLine,
  removeSavedRecipe,
} from './endOfPage'

const NOW = new Date('2026-10-19T09:00:00Z')
const URL_SOURCE = { kind: 'url', value: 'https://www.youtube.com/watch?v=abc' }
const HAND_SOURCE = { kind: 'text', value: 'Hand-authored for a test.' }

const original = (kind: 'url' | 'text', text: string): ImportOriginal =>
  ({
    recipe: {},
    source: { kind, value: kind === 'url' ? URL_SOURCE.value : 'pasted', imported_at: '2026-10-12T00:00:00Z' },
    source_text: text,
    raw_title: 't',
    graph_id: 'g',
  }) as unknown as ImportOriginal

describe('copiedDate (Q13 + N4)', () => {
  it('this year: day and short month, no year', () => {
    expect(copiedDate('2026-10-12T08:00:00Z', NOW, 'UTC')).toBe('12 Oct')
  })

  it('another year: the year is added', () => {
    expect(copiedDate('2025-10-12T08:00:00Z', NOW, 'UTC')).toBe('12 Oct 2025')
  })

  it('is the local day, not the UTC day: 20:30Z on the 11th is the 12th in Asia/Kolkata', () => {
    const saved = '2026-10-11T20:30:00Z'
    expect(copiedDate(saved, NOW, 'UTC')).toBe('11 Oct')
    expect(copiedDate(saved, NOW, 'Asia/Kolkata')).toBe('12 Oct')
  })

  it('compares the year in the same zone: 31 Dec UTC night is 1 Jan local', () => {
    const saved = '2025-12-31T20:30:00Z'
    expect(copiedDate(saved, NOW, 'UTC')).toBe('31 Dec 2025')
    expect(copiedDate(saved, NOW, 'Asia/Kolkata')).toBe('1 Jan')
  })

  it('an unreadable timestamp draws no date', () => {
    expect(copiedDate('not a date', NOW, 'UTC')).toBeNull()
  })
})

describe('endOfPageFor (Q0: only when the header lacks nothing the block adds)', () => {
  const saved = '2026-10-12T08:00:00Z'

  it('a saved link: platform and date, no paste', () => {
    expect(
      endOfPageFor({ savedAt: saved, source: URL_SOURCE, original: original('url', 'grounding'), now: NOW, timeZone: 'UTC' }),
    ).toEqual({ platformLine: 'YouTube · copied 12 Oct', paste: null })
  })

  it('another site is named by its host', () => {
    expect(
      endOfPageFor({
        savedAt: saved,
        source: { kind: 'url', value: 'https://www.example.com/r/1' },
        original: null,
        now: NOW,
        timeZone: 'UTC',
      }),
    ).toEqual({ platformLine: 'example.com · copied 12 Oct', paste: null })
  })

  it('an unsaved link shows no block', () => {
    expect(
      endOfPageFor({ savedAt: null, source: URL_SOURCE, original: original('url', 'grounding'), now: NOW }),
    ).toBeNull()
  })

  it('a saved paste: date and the paste', () => {
    expect(
      endOfPageFor({
        savedAt: saved,
        source: { kind: 'text', value: 'pasted' },
        original: original('text', 'Boil water.'),
        now: NOW,
        timeZone: 'UTC',
      }),
    ).toEqual({ platformLine: 'Pasted text · copied 12 Oct', paste: 'Boil water.' })
  })

  it('an unsaved paste: the paste, no date', () => {
    expect(
      endOfPageFor({
        savedAt: null,
        source: { kind: 'text', value: 'pasted' },
        original: original('text', 'Boil water.'),
        now: NOW,
      }),
    ).toEqual({ platformLine: 'Pasted text', paste: 'Boil water.' })
  })

  it('a hand-authored text source with no original is never a paste, and has only a date', () => {
    expect(
      endOfPageFor({ savedAt: saved, source: HAND_SOURCE, original: null, now: NOW, timeZone: 'UTC' }),
    ).toEqual({ platformLine: 'Copied 12 Oct', paste: null })
    expect(endOfPageFor({ savedAt: null, source: HAND_SOURCE, original: null, now: NOW })).toBeNull()
  })

  it('a link original that holds grounding text is never shown as "as written"', () => {
    const out = endOfPageFor({
      savedAt: saved,
      source: URL_SOURCE,
      original: original('url', 'x'.repeat(5000)),
      now: NOW,
      timeZone: 'UTC',
    })
    expect(out?.paste).toBeNull()
  })

  it('a fixture (server) recipe has no saved date and no original: nothing', () => {
    expect(endOfPageFor({ savedAt: null, source: HAND_SOURCE, original: null, now: NOW })).toBeNull()
  })
})

describe('Remove availability follows the saved entry (A1)', () => {
  const payload = kadai as RecipePlanResponse
  const key = canonicalSourceKey(payload.graph.source)
  const meta = { warnings: [], review_recommended: false, sources: [], provenance: null, degraded: false }
  const importOrigin: PlanOrigin = { kind: 'import', payload, importMeta: meta }

  it('an auto-saved import finds its entry', () => {
    expect(persistTargetId(importOrigin, (k) => (k === key ? { id: 'e1' } : undefined))).toBe('e1')
  })

  it('a failed save finds none: no Remove, no date', () => {
    expect(persistTargetId(importOrigin, () => undefined)).toBeNull()
  })

  it('a server recipe finds none', () => {
    expect(persistTargetId({ kind: 'server', recipeId: 'r' }, () => ({ id: 'x' }))).toBeNull()
  })
})

describe('cookOnRecipe (N2: library key OR the import key of the same graph)', () => {
  it('a library-keyed cook on this entry', () => {
    expect(cookOnRecipe({ planKey: 'library:e1' }, 'e1', 'g1')).toBe(true)
  })

  it('an import-keyed cook on the same graph (started before Save)', () => {
    expect(cookOnRecipe({ planKey: 'import:g1' }, 'e1', 'g1')).toBe(true)
  })

  it('a cook on another recipe is not this recipe', () => {
    expect(cookOnRecipe({ planKey: 'library:e2' }, 'e1', 'g1')).toBe(false)
    expect(cookOnRecipe({ planKey: 'import:g2' }, 'e1', 'g1')).toBe(false)
    expect(cookOnRecipe({ planKey: 'server:kadai' }, 'e1', 'g1')).toBe(false)
  })

  it('no session: no cook', () => {
    expect(cookOnRecipe(null, 'e1', 'g1')).toBe(false)
  })
})

describe('removeConfirmLine', () => {
  it('a cook in progress adds the cook line', () => {
    expect(removeConfirmLine(true)).toBe(
      "Remove this recipe from your Cookbook? To get it back you'd copy it again. Your cook in progress ends too.",
    )
  })

  it('without one, it does not', () => {
    expect(removeConfirmLine(false)).toBe("Remove this recipe from your Cookbook? To get it back you'd copy it again.")
  })
})

class MemoryStorage implements StorageLike {
  private data = new Map<string, string>()
  failWrites = false
  getItem(key: string): string | null {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('quota')
    this.data.set(key, value)
  }
  removeItem(key: string): void {
    this.data.delete(key)
  }
}

function setup(sessionPlanKey: ((entryId: string, graphId: string) => string) | null) {
  const storage = new MemoryStorage()
  const library = createLibrary(storage, () => new Date('2026-10-12T08:00:00Z'))
  const a = library.save(kadai as RecipePlanResponse)
  const b = library.save(biryani as RecipePlanResponse)
  if (!a.ok || !b.ok) throw new Error('setup save failed')
  const state = sessionPlanKey ? { planKey: sessionPlanKey(a.recipe.id, a.recipe.payload.graph.id) } : null
  const sessions = { getState: () => state, dispatch: vi.fn() }
  return { storage, library, a: a.recipe, b: b.recipe, sessions }
}

describe('removeSavedRecipe (wiring)', () => {
  it('removes the entry and ends a library-keyed cook on it', () => {
    const s = setup((id) => `library:${id}`)
    const r = removeSavedRecipe({ library: s.library, sessions: s.sessions, entryId: s.a.id, graphId: s.a.payload.graph.id, now: 5 })
    expect(r).toEqual({ ok: true })
    expect(s.library.get(s.a.id)).toBeUndefined()
    expect(s.sessions.dispatch).toHaveBeenCalledWith({ type: 'end', now: 5 })
  })

  it('ends an import-keyed cook on the same graph (cook started before Save, then saved, then removed)', () => {
    const s = setup((_id, graphId) => `import:${graphId}`)
    removeSavedRecipe({ library: s.library, sessions: s.sessions, entryId: s.a.id, graphId: s.a.payload.graph.id, now: 5 })
    expect(s.sessions.dispatch).toHaveBeenCalledWith({ type: 'end', now: 5 })
  })

  it('leaves a cook on another recipe alone', () => {
    const s = setup(() => 'library:some-other-entry')
    removeSavedRecipe({ library: s.library, sessions: s.sessions, entryId: s.a.id, graphId: s.a.payload.graph.id, now: 5 })
    expect(s.library.get(s.a.id)).toBeUndefined()
    expect(s.sessions.dispatch).not.toHaveBeenCalled()
  })

  it('no session: nothing is ended', () => {
    const s = setup(null)
    removeSavedRecipe({ library: s.library, sessions: s.sessions, entryId: s.a.id, graphId: s.a.payload.graph.id, now: 5 })
    expect(s.sessions.dispatch).not.toHaveBeenCalled()
  })

  it('a failed write keeps the entry and the cook, and says so', () => {
    const s = setup((id) => `library:${id}`)
    s.storage.failWrites = true
    const r = removeSavedRecipe({ library: s.library, sessions: s.sessions, entryId: s.a.id, graphId: s.a.payload.graph.id, now: 5 })
    expect(r).toEqual({ ok: false, message: "Couldn't remove it. Try again." })
    expect(s.library.get(s.a.id)).toBeDefined()
    expect(s.sessions.dispatch).not.toHaveBeenCalled()
  })
})

describe('copy', () => {
  it('uses the product words: no "phase", "session" or "Library"', () => {
    const all = Object.values(END_OF_PAGE_COPY).join(' ') + removeConfirmLine(true)
    expect(all).not.toMatch(/phase|session|library/i)
  })
})
