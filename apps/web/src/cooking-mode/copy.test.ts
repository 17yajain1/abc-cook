import { describe, expect, it } from 'vitest'

import {
  aboutMinutes,
  cap,
  clockStr,
  dayClock,
  handsOffLine,
  localClock,
  minutesLeft,
  READY_WHEN,
  splitCopy,
  timeLeft,
  timerLength,
  wordFor,
} from './copy'

const MIN = 60_000
// A clock time joins its am/pm with a no-break space (U+00A0); expectations are written with a plain one.
const nb = (s: string) => s.replace(/(\d) (am|pm)/, '$1\u00a0$2')

describe('wordFor', () => {
  it('spells small numbers, falls back to digits past the table', () => {
    expect(wordFor(0)).toBe('zero')
    expect(wordFor(3)).toBe('three')
    expect(wordFor(20)).toBe('twenty')
    expect(wordFor(21)).toBe('21')
  })
})

describe('cap', () => {
  it('capitalizes the first letter only', () => {
    expect(cap('onions light golden')).toBe('Onions light golden')
    expect(cap('')).toBe('')
  })
})

describe('aboutMinutes', () => {
  it('spells out minutes up to twenty', () => {
    expect(aboutMinutes(1 * MIN)).toBe('one minute')
    expect(aboutMinutes(11 * MIN)).toBe('eleven minutes')
    expect(aboutMinutes(20 * MIN)).toBe('twenty minutes')
  })

  it('buckets to the nearest five minutes between twenty and ninety', () => {
    expect(aboutMinutes(57 * MIN)).toBe('55 minutes')
  })

  it('reads in hours from ninety minutes to a day', () => {
    expect(aboutMinutes(90 * MIN)).toBe('two hours')
    expect(aboutMinutes(480 * MIN)).toBe('eight hours')
  })

  it('reads in days at 24 hours and beyond', () => {
    expect(aboutMinutes(1440 * MIN)).toBe('one day')
    expect(aboutMinutes(2880 * MIN)).toBe('two days')
  })

  it('floors non-positive remainders to "no time"', () => {
    expect(aboutMinutes(0)).toBe('no time')
    expect(aboutMinutes(-5000)).toBe('no time')
  })
})

describe('minutesLeft', () => {
  it('boundary tests at 59/60/89/90/119/120 seconds', () => {
    expect(minutesLeft(59_000)).toBe('Less than a minute left')
    expect(minutesLeft(60_000)).toBe('About 1 min left')
    expect(minutesLeft(89_000)).toBe('About 2 min left')
    expect(minutesLeft(90_000)).toBe('About 2 min left')
    expect(minutesLeft(119_000)).toBe('About 2 min left')
    expect(minutesLeft(120_000)).toBe('About 2 min left')
  })

  it('reads zero and longer durations without ever floor-ing to "no time"', () => {
    expect(minutesLeft(0)).toBe('Less than a minute left')
    expect(minutesLeft(4 * MIN)).toBe('About 4 min left')
    expect(minutesLeft(50 * MIN)).toBe('About 50 min left')
  })

  it('never increases as time passes — Math.ceil, not Math.round', () => {
    let last = Number.POSITIVE_INFINITY
    for (let ms = 130_000; ms >= 0; ms -= 1000) {
      const s = minutesLeft(ms)
      const n = s === 'Less than a minute left' ? 0 : Number(s.match(/\d+/)![0])
      expect(n).toBeLessThanOrEqual(last)
      last = n
    }
  })

  it('never renders "no time" or m:ss', () => {
    for (const ms of [0, 20_000, 59_000, 60_000, 4 * MIN, 50 * MIN]) {
      expect(minutesLeft(ms)).not.toBe('no time')
      expect(minutesLeft(ms)).not.toMatch(/^\d+:\d{2}$/)
    }
  })
})

describe('clockStr', () => {
  it('formats 12-hour wall-clock time with am/pm', () => {
    const t = new Date(2026, 8, 22, 16, 18, 0).getTime()
    expect(clockStr(t)).toBe(nb('4:18 pm'))
  })

  it('joins the time and am/pm with a no-break space', () => {
    const t = new Date(2026, 8, 22, 16, 18, 0).getTime()
    expect(clockStr(t)).toMatch(/\d:\d\d\u00a0pm$/)
    expect(dayClock(t - 86_400_000, t)).not.toMatch(/\d:\d\d (am|pm)/)
  })

  it('renders midnight as 12 am', () => {
    const t = new Date(2026, 8, 22, 0, 5, 0).getTime()
    expect(clockStr(t)).toBe(nb('12:05 am'))
  })
})

describe('dayClock', () => {
  const now = new Date(2026, 8, 22, 15, 0, 0).getTime()

  it('reads a same-day target as a bare clock time', () => {
    const target = new Date(2026, 8, 22, 16, 18, 0).getTime()
    expect(dayClock(now, target)).toBe(nb('4:18 pm'))
  })

  it('reads next-day as "tomorrow, …"', () => {
    const target = new Date(2026, 8, 23, 7, 0, 0).getTime()
    expect(dayClock(now, target)).toBe(nb('tomorrow, 7:00 am'))
  })

  it('reads further out as "in N days, …"', () => {
    const target = new Date(2026, 8, 25, 9, 0, 0).getTime()
    expect(dayClock(now, target)).toBe(nb('in 3 days, 9:00 am'))
  })
})

describe('splitCopy', () => {
  it('splits a short first sentence into title and body', () => {
    const c = splitCopy(
      'Heat oil, add the ginger-garlic paste, then the onions. Sauté until light golden.',
    )
    expect(c.title).toBe('Heat oil, add the ginger-garlic paste, then the onions')
    expect(c.body).toBe('Sauté until light golden.')
  })

  it('carries the whole instruction as title with no body when there is one sentence', () => {
    const c = splitCopy('Serve.')
    expect(c.title).toBe('Serve')
    expect(c.body).toBeNull()
  })

  it('falls back to the first clause and keeps the full instruction as body when the first sentence is too long', () => {
    const long =
      'Lift the dough over both knuckles and roll your knuckles under the center, working outward as you rotate the dough and leaving a thicker crust at the edge.'
    const c = splitCopy(long)
    expect(c.title.length).toBeLessThan(92)
    expect(c.body).toBe(long)
  })
})

describe('timerLength (PR 2 CP3)', () => {
  it('one unit is hyphenated, mixed units are not', () => {
    expect(timerLength(1)).toBe('1-min')
    expect(timerLength(12)).toBe('12-min')
    expect(timerLength(60)).toBe('1-hr')
    expect(timerLength(1080)).toBe('18-hr')
    expect(timerLength(90)).toBe('1 hr 30 min')
    expect(timerLength(270)).toBe('4 hr 30 min')
  })

  it('rounds the way startNode times (roundMin): 59.6 is an hour; under half a minute is no length', () => {
    expect(timerLength(59.6)).toBe('1-hr')
    expect(timerLength(0.4)).toBeNull()
    expect(timerLength(0)).toBeNull()
  })
})

describe('handsOffLine (PR 2 CP3)', () => {
  it('uses the plain length', () => {
    expect(handsOffLine(12)).toBe('About 12 min. Start a timer, or just move on.')
    expect(handsOffLine(60)).toBe('About 1 hr. Start a timer, or just move on.')
    expect(handsOffLine(90)).toBe('About 1 hr 30 min. Start a timer, or just move on.')
    expect(handsOffLine(1080)).toBe('About 18 hr. Start a timer, or just move on.')
  })

  it('no length, no line (nothing to say "about" of)', () => {
    expect(handsOffLine(0.4)).toBeNull()
  })
})

describe('timeLeft (PR 2 CP3)', () => {
  it('whole minutes rounded up, never seconds', () => {
    expect(timeLeft(52 * MIN)).toEqual({ big: '52', unit: 'min left', text: '52 min left' })
    expect(timeLeft(51 * MIN + 1)).toEqual({ big: '52', unit: 'min left', text: '52 min left' })
    expect(timeLeft(30_000)).toEqual({ big: '1', unit: 'min left', text: '1 min left' })
    expect(timeLeft(1)).toEqual({ big: '1', unit: 'min left', text: '1 min left' })
  })

  it('an hour or more reads in hours and minutes', () => {
    expect(timeLeft(59 * MIN + 1)).toEqual({ big: '1 hr', unit: 'left', text: '1 hr left' })
    expect(timeLeft(72 * MIN)).toEqual({ big: '1 hr 12 min', unit: 'left', text: '1 hr 12 min left' })
    expect(timeLeft(71 * MIN + 30_000)).toEqual({ big: '1 hr 12 min', unit: 'left', text: '1 hr 12 min left' })
  })

  it('at or past the end: "Time\'s up", no count', () => {
    expect(timeLeft(0)).toEqual({ big: "Time's up", unit: null, text: "Time's up" })
    expect(timeLeft(-5 * MIN)).toEqual({ big: "Time's up", unit: null, text: "Time's up" })
  })

  it('never counts upward as time passes', () => {
    let last = Number.POSITIVE_INFINITY
    for (let ms = 130 * MIN; ms > 0; ms -= 7_000) {
      const m = Math.ceil(ms / MIN)
      expect(m).toBeLessThanOrEqual(last)
      last = m
      expect(timeLeft(ms).text).not.toMatch(/\d:\d\d/)
    }
  })
})

describe('localClock (PR 2 CP3, the device locale)', () => {
  const now = new Date(2026, 9, 23, 13, 0, 0).getTime()
  const target = new Date(2026, 9, 23, 13, 42, 0).getTime()
  const plain = (s: string) => s.replace(/\s/gu, ' ')

  it('en-US: 12-hour clock; en-GB: 24-hour clock', () => {
    expect(plain(localClock(now, target, 'en-US'))).toBe('1:42 PM')
    expect(plain(localClock(now, target, 'en-GB'))).toBe('13:42')
  })

  it('never breaks a time from its am/pm: every space inside it is a no-break space', () => {
    expect(localClock(now, target, 'en-US')).toMatch(/^1:42\u00a0PM$/)
  })

  it('keeps dayClock\'s day prefix', () => {
    expect(plain(localClock(now, new Date(2026, 9, 24, 7, 0).getTime(), 'en-GB'))).toBe('tomorrow, 7:00')
    expect(plain(localClock(now, new Date(2026, 9, 26, 9, 5).getTime(), 'en-US'))).toBe('in 3 days, 9:05 AM')
  })
})

describe('READY_WHEN', () => {
  it('is one string, for later translation', () => {
    expect(READY_WHEN).toBe('Ready when:')
  })
})
