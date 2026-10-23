import { describe, expect, it } from 'vitest'

import { readyAroundText } from './readyAround'

// Thursday 22 Oct 2026.
const at = (h: number, m: number) => new Date(2026, 9, 22, h, m)
// The time and its am/pm are joined by a no-break space (U+00A0); the expectations below are written with a plain one.
const nb = (s: string) => s.replace(/(\d) (am|pm)/, '$1\u00a0$2')

describe('readyAroundText', () => {
  it('adds the upper end rounded up to 5 min, then rounds the clock up to the next 5 min', () => {
    // 6:07 pm + 2 hr 50 min = 8:57 pm -> 9:00 pm
    expect(readyAroundText(at(18, 7), 170)).toBe(nb("Start now and it's ready around 9:00 pm."))
    // 6:00 pm + 4 hr 42 min (-> 285) = 10:45 pm exactly
    expect(readyAroundText(at(18, 0), 282)).toBe(nb("Start now and it's ready around 10:45 pm."))
  })

  it('writes h:mm am/pm in lower case with no leading zero, and 12 for noon and midnight hour', () => {
    expect(readyAroundText(at(9, 3), 60)).toBe(nb("Start now and it's ready around 10:05 am."))
    expect(readyAroundText(at(11, 0), 60)).toBe(nb("Start now and it's ready around 12:00 pm."))
    expect(readyAroundText(at(22, 30), 90)).toBe(nb("Start now and it's ready around 12:00 am tomorrow."))
  })

  it('names the day once the cook crosses midnight: tomorrow, then the weekday', () => {
    expect(readyAroundText(at(20, 0), 300)).toBe(nb("Start now and it's ready around 1:00 am tomorrow."))
    // 25 hours later is Friday 23 Oct, 7:00 pm -> tomorrow; 50 hours later is Saturday
    expect(readyAroundText(at(18, 0), 25 * 60)).toBe(nb("Start now and it's ready around 7:00 pm tomorrow."))
    expect(readyAroundText(at(18, 0), 50 * 60)).toBe(nb("Start now and it's ready around 8:00 pm on Saturday."))
  })

  it('never reads the clock itself: the same inputs give the same text', () => {
    expect(readyAroundText(at(18, 7), 170)).toBe(readyAroundText(at(18, 7), 170))
  })

  it('never leaves a breakable space between the time and am/pm', () => {
    for (const [h, m, min] of [[18, 7, 170], [9, 3, 60], [22, 30, 90], [18, 0, 25 * 60]] as const) {
      const text = readyAroundText(at(h, m), min)
      expect(text).toMatch(/\d:\d\d\u00a0(am|pm)/)
      expect(text).not.toMatch(/\d:\d\d (am|pm)/)
    }
  })
})
