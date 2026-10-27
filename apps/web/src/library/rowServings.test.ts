import { describe, expect, it } from 'vitest'

import type { CookingSession } from '@/cooking/types'
import type { ServingsChoice } from '@/lib/servings'

import { rowServingsChoice } from './rowServings'

const T0 = 1_700_000_000_000
const DAY = 24 * 60 * 60_000
const S = (chosen: number, original: number): ServingsChoice => ({ mode: 'servings', chosen, original })

// Only the fields the rule reads.
const session = (over: Partial<CookingSession> = {}): CookingSession =>
  ({ planKey: 'library:k1', startedAt: T0, lastSeenAt: T0, leftAt: null, finishedAt: null, totalMin: 60, nodes: {}, ...over }) as unknown as CookingSession

describe('rowServingsChoice (CP5.1)', () => {
  it('no session, or a session for another entry: the saved choice', () => {
    expect(rowServingsChoice(null, 'k1', T0, S(6, 4))).toEqual(S(6, 4))
    expect(rowServingsChoice(session({ planKey: 'library:other' }), 'k1', T0, S(6, 4))).toEqual(S(6, 4))
  })

  it('an active or stale cook on this entry: the batch the session cooks, whatever is saved now', () => {
    const cooking = session({ servingsChoice: S(4, 4) })
    expect(rowServingsChoice(cooking, 'k1', T0 + 60_000, S(6, 4))).toEqual(S(4, 4))
    expect(rowServingsChoice(cooking, 'k1', T0 + 30 * DAY, S(6, 4))).toEqual(S(4, 4))
  })

  it('a cook that started as written has no choice, so the row shows as written', () => {
    expect(rowServingsChoice(session(), 'k1', T0 + 60_000, S(6, 4))).toBeNull()
  })

  it('a finished session, or one with no totalMin, is not a cook in progress: the saved choice', () => {
    expect(rowServingsChoice(session({ finishedAt: T0 + 1 }), 'k1', T0 + 2, S(6, 4))).toEqual(S(6, 4))
    expect(rowServingsChoice(session({ totalMin: undefined }), 'k1', T0 + 2, S(6, 4))).toEqual(S(6, 4))
  })
})
