import { describe, expect, it } from 'vitest'

import { isOnWaitlist, joinWaitlist, type StorageLike } from './waitlist'

function memory(): StorageLike {
  const data = new Map<string, string>()
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  }
}

describe('planner waitlist', () => {
  it('is off until joined, then stays on', () => {
    const s = memory()
    expect(isOnWaitlist(s)).toBe(false)
    expect(joinWaitlist(s)).toBe(true)
    expect(isOnWaitlist(s)).toBe(true)
  })
  it('survives a storage that throws', () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(isOnWaitlist(broken)).toBe(false)
    expect(joinWaitlist(broken)).toBe(false)
  })
})
