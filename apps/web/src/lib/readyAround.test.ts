import { describe, expect, it } from 'vitest'

import { readyAroundText } from './readyAround'

// Thursday 22 Oct 2026.
const at = (h: number, m: number) => new Date(2026, 9, 22, h, m)
// The time and its AM/PM are joined by a no-break space (U+00A0); the expectations below are written with a plain one.
const nb = (s: string) => s.replace(/(\d) (AM|PM)/, '$1\u00a0$2')

describe('readyAroundText', () => {
  it('adds the upper end rounded up to 5 min, then rounds the clock up to the next 5 min', () => {
    // 6:07 PM + 2 hr 50 min = 8:57 PM -> 9:00 PM
    expect(readyAroundText(at(18, 7), 170, 'en-US')).toBe(nb("Start now and it's ready around 9:00 PM."))
    // 6:00 PM + 4 hr 42 min (-> 285) = 10:45 PM exactly
    expect(readyAroundText(at(18, 0), 282, 'en-US')).toBe(nb("Start now and it's ready around 10:45 PM."))
  })

  it('writes h:mm AM/PM with no leading zero, and 12 for the noon and midnight hour', () => {
    expect(readyAroundText(at(9, 3), 60, 'en-US')).toBe(nb("Start now and it's ready around 10:05 AM."))
    expect(readyAroundText(at(11, 0), 60, 'en-US')).toBe(nb("Start now and it's ready around 12:00 PM."))
    expect(readyAroundText(at(22, 30), 90, 'en-US')).toBe(nb("Start now and it's ready around 12:00 AM tomorrow."))
  })

  it('names the day once the cook crosses midnight: tomorrow, then the weekday', () => {
    expect(readyAroundText(at(20, 0), 300, 'en-US')).toBe(nb("Start now and it's ready around 1:00 AM tomorrow."))
    // 25 hours later is Friday 23 Oct, 7:00 PM -> tomorrow; 50 hours later is Saturday
    expect(readyAroundText(at(18, 0), 25 * 60, 'en-US')).toBe(nb("Start now and it's ready around 7:00 PM tomorrow."))
    expect(readyAroundText(at(18, 0), 50 * 60, 'en-US')).toBe(nb("Start now and it's ready around 8:00 PM on Saturday."))
  })

  it('never reads the clock itself: the same inputs give the same text', () => {
    expect(readyAroundText(at(18, 7), 170, 'en-US')).toBe(readyAroundText(at(18, 7), 170, 'en-US'))
  })

  it('never leaves a breakable space between the time and AM/PM', () => {
    for (const [h, m, min] of [[18, 7, 170], [9, 3, 60], [22, 30, 90], [18, 0, 25 * 60]] as const) {
      const text = readyAroundText(at(h, m), min, 'en-US')
      expect(text).toMatch(/\d:\d\d\u00a0(AM|PM)/)
      expect(text).not.toMatch(/\d:\d\d (AM|PM)/)
    }
  })

  it('follows the device clock format, as cooking mode does (CP5.1 U9): no forced 12-hour or case', () => {
    expect(readyAroundText(at(18, 7), 170, 'en-GB')).toBe("Start now and it's ready around 21:00.")
    expect(readyAroundText(at(20, 0), 300, 'en-GB')).toBe("Start now and it's ready around 1:00 tomorrow.")
  })
})
