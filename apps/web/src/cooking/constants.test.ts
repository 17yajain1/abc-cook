import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { LONG_WAIT_MS, SESSION_BREAK_MS } from './constants'
import pizzaDough from '@/__fixtures__/pizza-dough.plan-response.json'
import syntheticTwoSittings from '@/__fixtures__/synthetic-two-sittings.plan-response.json'

const FIXTURES: [string, RecipePlanResponse][] = [
  ['pizza-dough', pizzaDough as RecipePlanResponse],
  ['synthetic-two-sittings', syntheticTwoSittings as RecipePlanResponse],
]

// Row 33: classifying the scheduler's own typical-pace gaps with SESSION_BREAK_MS /
// LONG_WAIT_MS reproduces the same counts `summary.py` (`SESSION_BREAK_MIN = 120`,
// `LONG_WAIT_MIN = 45`) produced server-side — confirming the ms constants convert the
// Python minute thresholds correctly, including at the boundary.
describe('SESSION_BREAK_MS / LONG_WAIT_MS reproduce summary.py session/long-wait counts (row 33)', () => {
  it.each(FIXTURES)('%s: every session-break gap classifies as a session break', (_name, payload) => {
    const summary = payload.summary!
    const gaps = summary.sessions.map((s) => s.preceded_by_wait_min).filter((v): v is number => v != null)

    // Exactly one gap precedes every sitting after the first.
    expect(gaps).toHaveLength(summary.sessions.length - 1)
    for (const gapMin of gaps) {
      expect(gapMin * 60_000).toBeGreaterThanOrEqual(SESSION_BREAK_MS)
    }
  })

  it.each(FIXTURES)('%s: every long_wait gap classifies as a long wait, never a session break', (_name, payload) => {
    const summary = payload.summary!
    for (const longWait of summary.long_waits) {
      const gapMs = longWait.idle_min * 60_000
      expect(gapMs).toBeGreaterThanOrEqual(LONG_WAIT_MS)
      expect(gapMs).toBeLessThan(SESSION_BREAK_MS)
    }
  })
})
