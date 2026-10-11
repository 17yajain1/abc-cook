import { describe, expect, it } from 'vitest'

import { createOutbox, type SessionFinished, type StorageLike } from './outbox'

const KEY = 'abc-cook:events:v1'

class MemoryStorage implements StorageLike {
  data = new Map<string, string>()
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

class FailingStorage extends MemoryStorage {
  override setItem(): void {
    throw new Error('quota exceeded')
  }
}

function event(overrides: Partial<SessionFinished> = {}): SessionFinished {
  return {
    event_id: 'server:kadai@1000',
    kind: 'session_finished',
    plan_key: 'server:kadai',
    started_at: 1000,
    finished_at: 5000,
    confirmed_at: 6000,
    via: 'finish',
    ...overrides,
  }
}

describe('outbox', () => {
  it('appends and reloads from storage', () => {
    const storage = new MemoryStorage()
    expect(createOutbox(storage, () => 1).append(event())).toEqual({ ok: true, created: true })

    expect(createOutbox(storage, () => 1).pending()).toEqual([event()])
  })

  it('de-duplicates by event_id, in memory and across reloads', () => {
    const storage = new MemoryStorage()
    const outbox = createOutbox(storage, () => 1)
    outbox.append(event())

    expect(outbox.append(event({ via: 'replace' }))).toEqual({ ok: true, created: false })
    expect(outbox.pending()).toHaveLength(1)
    expect(createOutbox(storage, () => 1).append(event())).toEqual({ ok: true, created: false })
    expect(createOutbox(storage, () => 1).pending()).toHaveLength(1)
  })

  it('keeps distinct event_ids separate', () => {
    const outbox = createOutbox(new MemoryStorage(), () => 1)
    outbox.append(event())
    outbox.append(event({ event_id: 'server:kadai@2000', started_at: 2000 }))

    expect(outbox.pending().map((e) => e.event_id)).toEqual(['server:kadai@1000', 'server:kadai@2000'])
  })

  it('a setItem failure returns { ok: false } without throwing and stores nothing', () => {
    const outbox = createOutbox(new FailingStorage(), () => 1)

    expect(outbox.append(event())).toEqual({ ok: false })
    expect(outbox.pending()).toEqual([])
  })

  it('a failed write can be retried once storage recovers', () => {
    const storage = new MemoryStorage()
    const outbox = createOutbox(storage, () => 1)
    const realSet = storage.setItem.bind(storage)
    storage.setItem = () => {
      throw new Error('quota exceeded')
    }
    expect(outbox.append(event())).toEqual({ ok: false })

    storage.setItem = realSet
    expect(outbox.append(event())).toEqual({ ok: true, created: true })
  })

  it('corrupt JSON is salvaged and the outbox starts empty', () => {
    const storage = new MemoryStorage()
    storage.setItem(KEY, '{not json')

    const outbox = createOutbox(storage, () => 42)

    expect(outbox.pending()).toEqual([])
    expect(storage.getItem(`${KEY}:unreadable-42`)).toBe('{not json')
  })

  it('a wrong version is salvaged and the outbox starts empty', () => {
    const storage = new MemoryStorage()
    const raw = JSON.stringify({ version: 2, events: [event()] })
    storage.setItem(KEY, raw)

    expect(createOutbox(storage, () => 7).pending()).toEqual([])
    expect(storage.getItem(`${KEY}:unreadable-7`)).toBe(raw)
  })

  it('salvage failing on unusable storage still does not throw', () => {
    const storage = new FailingStorage()
    storage.data.set(KEY, 'garbage')

    expect(createOutbox(storage, () => 1).pending()).toEqual([])
  })

  it('filters out malformed entries and in-file duplicates', () => {
    const storage = new MemoryStorage()
    storage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        events: [event(), event(), null, 'x', { event_id: 'no-kind' }, event({ event_id: 'b', via: 'bogus' as never })],
      }),
    )

    expect(createOutbox(storage, () => 1).pending()).toEqual([event()])
  })

  it('a throwing getItem degrades to an empty outbox', () => {
    const storage = new MemoryStorage()
    storage.getItem = () => {
      throw new Error('denied')
    }

    expect(createOutbox(storage, () => 1).pending()).toEqual([])
  })
})
