import { describe, expect, it, vi } from 'vitest'

import type { ImportMeta, ImportOriginal, RecipePlanResponse, ReprocessResponse } from '@abc-cook/schema'

import { ApiError } from '@/api/client'
import { createServerVersion } from '@/api/serverVersion'
import type { CookingSession } from '@/cooking/types'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'

import { openSavedChecked, openSavedNow, type OpenDeps, type OpenOutcome } from './openSaved'
import { canonicalSourceKey } from './sourceKey'
import { createLibrary, type StorageLike } from './store'

const BASE = kadaiPaneer as RecipePlanResponse
const NOW = 1_800_000_000_000
const H = 3_600_000
const urlPayload = (title = 'Stored'): RecipePlanResponse => ({
  ...BASE,
  graph: { ...BASE.graph, title, source: { kind: 'url', value: 'https://x.test/a', imported_at: '2026-10-01T00:00:00Z' } },
})
const textPayload = (): RecipePlanResponse => ({
  ...BASE,
  graph: { ...BASE.graph, source: { kind: 'text', value: 'pasted words', imported_at: '2026-10-01T00:00:00Z' } },
})
const META: ImportMeta = { warnings: [], review_recommended: false, sources: [], provenance: null, degraded: false }
const ORIGINAL = { recipe: {}, source_text: 's', raw_title: 't', graph_id: 'g', source: urlPayload().graph.source } as unknown as ImportOriginal

function memoryStorage(): StorageLike & { raw(): string | null } {
  const data = new Map<string, string>()
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    raw: () => data.get('abc-cook:library:v1') ?? null,
  }
}

function session(over: Partial<CookingSession> = {}): CookingSession {
  return {
    version: 1,
    planKey: 'library:x',
    graphId: 'g',
    startedAt: NOW - 30 * H,
    lastSeenAt: NOW - 30 * H,
    leftAt: null,
    finishedAt: null,
    nodes: { a: { state: 'pending' } },
    lastTransition: null,
    ...over,
  }
}

function setup(opts: {
  payload?: RecipePlanResponse
  meta?: ImportMeta | null
  original?: ImportOriginal | null
  stamp?: number | null
  server?: number | 'down'
  reprocess?: OpenDeps['reprocess']
  feed?: { payload: RecipePlanResponse; postprocessVersion: number } | null
  session?: (id: string) => CookingSession | null
  budgetMs?: number
}) {
  const storage = memoryStorage()
  const library = createLibrary(storage, () => new Date('2026-10-01T00:00:00Z'))
  const payload = opts.payload ?? urlPayload()
  const saved = library.save(payload, opts.meta === undefined ? META : opts.meta, {
    original: opts.original ?? null,
    postprocess_version: opts.stamp ?? null,
  })
  if (!saved.ok) throw new Error('seed failed')
  const id = saved.recipe.id

  const fetchInfo = vi.fn((signal?: AbortSignal) => {
    if (opts.server === 'down' || opts.server === undefined) return Promise.reject(new Error('down'))
    void signal
    return Promise.resolve({ status: 'ok', version: '0', postprocess_version: opts.server })
  })
  const serverVersion = createServerVersion(fetchInfo)
  const reprocess = vi.fn(opts.reprocess ?? (() => Promise.reject(new ApiError(0, 'down'))))
  const events: string[] = []
  const endSessionIfFor = vi.fn((sid: string) => void events.push(`end:${sid}`))
  const refresh = library.refresh.bind(library)
  const spyLibrary = {
    get: library.get.bind(library),
    refresh: (...a: Parameters<typeof refresh>) => {
      events.push('refresh')
      return refresh(...a)
    },
  }
  const findInFeed = vi.fn(() => Promise.resolve(opts.feed ?? null))
  const deps: OpenDeps = {
    library: spyLibrary,
    serverVersion,
    reprocess,
    findInFeed,
    getSession: () => (opts.session ? opts.session(id) : null),
    endSessionIfFor,
    now: () => NOW,
    budgetMs: opts.budgetMs,
  }
  return { deps, id, storage, library, fetchInfo, reprocess, endSessionIfFor, findInFeed, events, serverVersion }
}

async function open(s: ReturnType<typeof setup>): Promise<OpenOutcome> {
  return openSavedNow(s.deps, s.id) ?? (await openSavedChecked(s.deps, s.id))
}

const reprocessed = (v: number, degraded = false): ReprocessResponse => ({
  payload: urlPayload('Refreshed'),
  import_meta: { ...META, degraded, warnings: degraded ? ['degraded'] : [] },
  postprocess_version: v,
})

describe('openSavedNow — the synchronous decisions', () => {
  it('a missing entry', () => {
    const s = setup({})
    expect(openSavedNow(s.deps, 'nope')).toEqual({ missing: true })
  })

  it('a stamp equal to the memoised server version opens instantly: no network at all', () => {
    const s = setup({ stamp: 9 })
    s.serverVersion.note(9)
    const out = openSavedNow(s.deps, s.id)
    expect(out && 'marker' in out && out.marker).toBeNull()
    expect(s.fetchInfo).not.toHaveBeenCalled()
    expect(s.reprocess).not.toHaveBeenCalled()
  })

  it('an unknown server version defers to the async check', () => {
    const s = setup({ stamp: 9 })
    expect(openSavedNow(s.deps, s.id)).toBeNull()
  })

  it('a cook in progress opens the stored plan unchanged, with no marker and no call', async () => {
    const s = setup({ stamp: 8, original: ORIGINAL, server: 9, session: (id) => session({ planKey: `library:${id}`, lastSeenAt: NOW - H }) })
    const out = await open(s)
    expect('marker' in out && out.marker).toBeNull()
    expect('recipe' in out && out.recipe.postprocess_version).toBe(8)
    expect(s.fetchInfo).not.toHaveBeenCalled()
    expect(s.reprocess).not.toHaveBeenCalled()
    expect(s.endSessionIfFor).not.toHaveBeenCalled()
  })
})

describe('openSavedChecked — refreshable', () => {
  it('reprocesses, ends the session first, then refreshes in place; no marker', async () => {
    const s = setup({ stamp: 8, original: ORIGINAL, server: 9, reprocess: () => Promise.resolve(reprocessed(9)) })
    const before = s.library.get(s.id)!
    const out = await open(s)
    expect(out).toMatchObject({ marker: null })
    const after = s.library.get(s.id)!
    expect(after.payload.graph.title).toBe('Refreshed')
    expect(after.postprocess_version).toBe(9)
    expect(after.id).toBe(before.id)
    expect(after.saved_at).toBe(before.saved_at)
    expect(after.updated_at).toBe(before.updated_at)
    expect(s.events).toEqual([`end:${s.id}`, 'refresh'])
    expect(s.serverVersion.peek()).toBe(9)
  })

  it('a refresh that degrades is applied, with the degraded flag', async () => {
    const s = setup({ stamp: 8, original: ORIGINAL, server: 9, reprocess: () => Promise.resolve(reprocessed(9, true)) })
    await open(s)
    expect(s.library.get(s.id)!.import_meta?.degraded).toBe(true)
  })

  it('a current stamp after the check makes no reprocess call', async () => {
    const s = setup({ stamp: 9, original: ORIGINAL, server: 9 })
    expect(await open(s)).toMatchObject({ marker: null })
    expect(s.reprocess).not.toHaveBeenCalled()
  })

  it('a 422 shows the stale marker and writes nothing', async () => {
    const s = setup({ stamp: 8, original: ORIGINAL, server: 9, reprocess: () => Promise.reject(new ApiError(422, 'bad')) })
    const raw = s.storage.raw()
    expect(await open(s)).toMatchObject({ marker: { kind: 'stale', reimport: true } })
    expect(s.storage.raw()).toBe(raw)
    expect(s.endSessionIfFor).not.toHaveBeenCalled()
  })

  it.each([
    ['a 5xx', new ApiError(503, 'x')],
    ['the network', new ApiError(0, 'x')],
  ])('%s shows "couldn\'t check", writes nothing, ends no session', async (_n, err) => {
    const s = setup({ stamp: 8, original: ORIGINAL, server: 9, reprocess: () => Promise.reject(err) })
    const raw = s.storage.raw()
    expect(await open(s)).toMatchObject({ marker: { kind: 'unchecked' } })
    expect(s.storage.raw()).toBe(raw)
    expect(s.endSessionIfFor).not.toHaveBeenCalled()
  })

  it('/health down: unchecked, and reprocess is never called', async () => {
    const s = setup({ stamp: 8, original: ORIGINAL, server: 'down' })
    const raw = s.storage.raw()
    expect(await open(s)).toMatchObject({ marker: { kind: 'unchecked' } })
    expect(s.reprocess).not.toHaveBeenCalled()
    expect(s.storage.raw()).toBe(raw)
  })

  it('a reprocess slower than the budget is aborted: unchecked, nothing written', async () => {
    const slow: OpenDeps['reprocess'] = (_o, signal) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(new ApiError(0, 'aborted'))))
    const s = setup({ stamp: 8, original: ORIGINAL, server: 9, reprocess: slow, budgetMs: 20 })
    const raw = s.storage.raw()
    expect(await open(s)).toMatchObject({ marker: { kind: 'unchecked' } })
    expect(s.storage.raw()).toBe(raw)
  })

  it('an unfinished session older than 24 h is ended, and only after a successful reprocess', async () => {
    const s = setup({
      stamp: 8,
      original: ORIGINAL,
      server: 9,
      reprocess: () => Promise.resolve(reprocessed(9)),
      session: (id) => session({ planKey: `library:${id}` }),
    })
    await open(s)
    expect(s.endSessionIfFor).toHaveBeenCalledWith(s.id)
  })
})

describe('openSavedChecked — no original', () => {
  it('a legacy url import (null stamp, no feed match) is stale with Re-import, and /health is never called', async () => {
    const s = setup({})
    expect(await open(s)).toMatchObject({ marker: { kind: 'stale', reimport: true } })
    expect(s.fetchInfo).not.toHaveBeenCalled()
    expect(s.reprocess).not.toHaveBeenCalled()
  })

  it('a legacy text-source entry is stale without Re-import', async () => {
    const s = setup({ payload: textPayload() })
    expect(await open(s)).toMatchObject({ marker: { kind: 'stale', reimport: false } })
  })

  it('a feed save with a current match is replaced silently: no reprocess, null meta, stamped', async () => {
    const feedPayload = urlPayload('From feed')
    const s = setup({ meta: null, server: 9, feed: { payload: feedPayload, postprocessVersion: 9 } })
    const out = await open(s)
    expect(out).toMatchObject({ marker: null })
    expect(s.reprocess).not.toHaveBeenCalled()
    const after = s.library.get(s.id)!
    expect(after.payload.graph.title).toBe('From feed')
    expect(after.import_meta).toBeNull()
    expect(after.postprocess_version).toBe(9)
    expect(after.original).toBeNull()
    expect(s.events).toEqual([`end:${s.id}`, 'refresh'])
  })

  it('a header-saved feed entry (non-null meta) is replaced the same way', async () => {
    const s = setup({ meta: META, server: 9, feed: { payload: urlPayload('From feed'), postprocessVersion: 9 } })
    expect(await open(s)).toMatchObject({ marker: null })
    expect(s.library.get(s.id)!.payload.graph.title).toBe('From feed')
  })

  it('a feed save whose match is behind the server is stale with NO Re-import', async () => {
    const s = setup({ meta: null, server: 9, feed: { payload: urlPayload('Old'), postprocessVersion: 8 } })
    expect(await open(s)).toMatchObject({ marker: { kind: 'stale', reimport: false } })
    expect(s.library.get(s.id)!.payload.graph.title).toBe('Stored')
  })

  it('a feed save with no match at all is stale with NO Re-import', async () => {
    const s = setup({ meta: null, server: 9, feed: null })
    expect(await open(s)).toMatchObject({ marker: { kind: 'stale', reimport: false } })
  })

  it('a feed replacement while the server is unreachable: unchecked, nothing written', async () => {
    const s = setup({ meta: null, server: 'down', feed: { payload: urlPayload('From feed'), postprocessVersion: 9 } })
    const raw = s.storage.raw()
    expect(await open(s)).toMatchObject({ marker: { kind: 'unchecked' } })
    expect(s.storage.raw()).toBe(raw)
  })

  it('the replaced feed entry keeps its source key', async () => {
    const s = setup({ meta: null, server: 9, feed: { payload: urlPayload('From feed'), postprocessVersion: 9 } })
    await open(s)
    expect(s.library.get(s.id)!.source_key).toBe(canonicalSourceKey(urlPayload().graph.source))
  })
})
