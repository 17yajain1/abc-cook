import { describe, expect, it } from 'vitest'

import type { ImportOriginal, SavedRecipe } from '@abc-cook/schema'

import type { CookingSession, NodeState } from '@/cooking/types'

import {
  ACTIVE_SESSION_MS,
  activityAt,
  feedOrigin,
  reimportable,
  sessionBlocksRefresh,
  stalenessOf,
  type FeedMatch,
} from './staleness'

const ORIGINAL = { recipe: {}, source: { kind: 'url', value: 'https://x.test/a' } } as unknown as ImportOriginal

function recipe(over: Partial<SavedRecipe> & { kind?: 'url' | 'text' | 'image' } = {}): SavedRecipe {
  const { kind = 'url', ...rest } = over
  return {
    id: 'r1',
    source_key: 'url:https://x.test/a',
    saved_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    payload: { graph: { source: { kind, value: 'https://x.test/a' } } },
    import_meta: { warnings: [], review_recommended: false, sources: [], provenance: null, degraded: false },
    original: null,
    postprocess_version: null,
    edits: [],
    ...rest,
  } as unknown as SavedRecipe
}

const noFeed = () => null
const feedAt = (v: number) => (): FeedMatch => ({ postprocessVersion: v })

describe('stalenessOf — rule 1: stamp at or above the server is current', () => {
  it('equal stamp is current, with or without an original', () => {
    expect(stalenessOf(recipe({ postprocess_version: 9 }), 9, noFeed)).toBe('current')
    expect(stalenessOf(recipe({ postprocess_version: 9, original: ORIGINAL }), 9, noFeed)).toBe('current')
  })

  it('a stamp newer than the server is current: never downgrade', () => {
    expect(stalenessOf(recipe({ postprocess_version: 10, original: ORIGINAL }), 9, noFeed)).toBe('current')
  })

  it('does not consult the feed when the stamp is current', () => {
    const lookup = () => {
      throw new Error('feed consulted')
    }
    expect(stalenessOf(recipe({ postprocess_version: 9 }), 9, lookup)).toBe('current')
  })
})

describe('stalenessOf — rule 2: an original makes it refreshable', () => {
  it('older stamp + original + known server version', () => {
    expect(stalenessOf(recipe({ postprocess_version: 8, original: ORIGINAL }), 9, noFeed)).toBe('refreshable')
  })

  it('null stamp + original is refreshable too', () => {
    expect(stalenessOf(recipe({ original: ORIGINAL }), 9, noFeed)).toBe('refreshable')
  })

  it('unknown server version -> unknown', () => {
    expect(stalenessOf(recipe({ postprocess_version: 8, original: ORIGINAL }), null, noFeed)).toBe('unknown')
  })
})

describe('stalenessOf — rule 3: no original, feed match', () => {
  it('feed stamp equal to the server -> feed_replaceable', () => {
    expect(stalenessOf(recipe({ import_meta: null }), 9, feedAt(9))).toBe('feed_replaceable')
  })

  it('feed stamp behind the server -> needs_reimport', () => {
    expect(stalenessOf(recipe({ import_meta: null }), 9, feedAt(8))).toBe('needs_reimport')
  })

  it('unknown server version -> unknown', () => {
    expect(stalenessOf(recipe({ import_meta: null }), null, feedAt(9))).toBe('unknown')
  })
})

describe('stalenessOf — rule 4: no original, no feed match', () => {
  it('a null stamp is stale by definition, decided without the server version', () => {
    expect(stalenessOf(recipe(), null, noFeed)).toBe('needs_reimport')
    expect(stalenessOf(recipe(), 9, noFeed)).toBe('needs_reimport')
  })

  it('a set stamp while the server version is unknown is unknown, not a guess', () => {
    expect(stalenessOf(recipe({ postprocess_version: 9 }), null, noFeed)).toBe('unknown')
  })

  it('an older stamp with no original cannot be refreshed', () => {
    expect(stalenessOf(recipe({ postprocess_version: 8 }), 9, noFeed)).toBe('needs_reimport')
  })
})

describe('feedOrigin and reimportable', () => {
  it('import_meta null is feed origin', () => {
    expect(feedOrigin(recipe({ import_meta: null }), noFeed)).toBe(true)
  })

  it('a feed match makes a non-null import_meta feed origin (header-saved)', () => {
    expect(feedOrigin(recipe(), feedAt(9))).toBe(true)
  })

  it('a non-null import_meta with no match is an import', () => {
    expect(feedOrigin(recipe(), noFeed)).toBe(false)
  })

  it('a missing import_meta key counts as null', () => {
    const r = recipe()
    delete (r as { import_meta?: unknown }).import_meta
    expect(feedOrigin(r, noFeed)).toBe(true)
  })

  it('re-import is offered for a url import only', () => {
    expect(reimportable(recipe(), false)).toBe(true)
    expect(reimportable(recipe({ kind: 'text' }), false)).toBe(false)
    expect(reimportable(recipe({ kind: 'image' }), false)).toBe(false)
  })

  it('re-import is never offered for a feed origin', () => {
    expect(reimportable(recipe(), true)).toBe(false)
  })
})

describe('sessionBlocksRefresh — B4a', () => {
  const NOW = 1_800_000_000_000
  const H = 60 * 60 * 1000

  function session(
    over: Partial<CookingSession> = {},
    nodes: Record<string, NodeState> = { a: { state: 'pending' } },
  ): CookingSession {
    return {
      version: 1,
      planKey: 'library:r1',
      graphId: 'g',
      startedAt: NOW - 30 * H,
      lastSeenAt: NOW - 30 * H,
      leftAt: null,
      finishedAt: null,
      nodes,
      lastTransition: null,
      ...over,
    }
  }

  it('the window is 24 hours', () => {
    expect(ACTIVE_SESSION_MS).toBe(24 * H)
  })

  it('no session -> does not block', () => {
    expect(sessionBlocksRefresh(null, 'r1', NOW)).toBe(false)
  })

  it('a session for another plan never blocks', () => {
    expect(sessionBlocksRefresh(session({ planKey: 'library:other', lastSeenAt: NOW }), 'r1', NOW)).toBe(false)
    expect(sessionBlocksRefresh(session({ planKey: 'server:r1', lastSeenAt: NOW }), 'r1', NOW)).toBe(false)
  })

  it('activity under 24 h blocks', () => {
    expect(sessionBlocksRefresh(session({ lastSeenAt: NOW - 23 * H }), 'r1', NOW)).toBe(true)
  })

  it('activity over 24 h does not block', () => {
    expect(sessionBlocksRefresh(session({ lastSeenAt: NOW - 25 * H }), 'r1', NOW)).toBe(false)
  })

  it('a running timer blocks even 24 h after the start', () => {
    const s = session({}, { a: { state: 'running', startedAt: NOW - 30 * H, endsAt: NOW + 60_000, extendedMs: 0 } })
    expect(sessionBlocksRefresh(s, 'r1', NOW)).toBe(true)
  })

  it('an expired timer is not "running" for this rule', () => {
    const s = session({}, { a: { state: 'running', startedAt: NOW - 30 * H, endsAt: NOW - 29 * H, extendedMs: 0 } })
    expect(sessionBlocksRefresh(s, 'r1', NOW)).toBe(false)
  })

  it('activity from done.at alone counts', () => {
    const s = session({}, { a: { state: 'done', at: NOW - 2 * H, endsAt: null } })
    expect(activityAt(s)).toBe(NOW - 2 * H)
    expect(sessionBlocksRefresh(s, 'r1', NOW)).toBe(true)
  })

  it('activity from lastTransition.at alone counts', () => {
    const s = session({ lastTransition: { kind: 'done', at: NOW - 3 * H, entries: [] } })
    expect(activityAt(s)).toBe(NOW - 3 * H)
    expect(sessionBlocksRefresh(s, 'r1', NOW)).toBe(true)
  })

  it('activityAt is the latest of every timestamp', () => {
    const s = session(
      { lastSeenAt: NOW - 10 * H, lastTransition: { kind: 'skip', at: NOW - 9 * H, entries: [] } },
      {
        a: { state: 'deferred', at: NOW - 8 * H },
        b: { state: 'running', startedAt: NOW - 7 * H, endsAt: NOW - 6 * H, extendedMs: 0 },
        c: { state: 'done', at: NOW - 5 * H, endsAt: null },
      },
    )
    expect(activityAt(s)).toBe(NOW - 5 * H)
  })

  it('Q3: finished but unconfirmed blocks while under 24 h, then no longer', () => {
    const fresh = session({ finishedAt: NOW - 2 * H, lastSeenAt: NOW - 2 * H })
    expect(sessionBlocksRefresh(fresh, 'r1', NOW)).toBe(true)
    const old = session({ finishedAt: NOW - 26 * H, lastSeenAt: NOW - 26 * H })
    expect(sessionBlocksRefresh(old, 'r1', NOW)).toBe(false)
  })
})
