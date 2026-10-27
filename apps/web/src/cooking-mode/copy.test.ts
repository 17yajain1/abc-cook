import { describe, expect, it } from 'vitest'

import {
  endedAgo,
  handsOffLine,
  noBreakWords,
  READY_WHEN,
  readyClock,
  sentence,
  sinceText,
  timeLeft,
  timerLength,
} from './copy'

const MIN = 60_000
// A number joins its unit with a no-break space (PR 2 CP4 `sinceText`).
const nbUnit = (s: string) => s.replace(/(\d) /g, '$1\u00a0')

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

describe('handsOffLine (PR 2 CP3, CP3.1 by tag)', () => {
  it('Hands-off (unattended): the plain length, then "Start a timer, or just move on."', () => {
    expect(handsOffLine(12, 'unattended')).toBe('About 12 min. Start a timer, or just move on.')
    expect(handsOffLine(60, 'unattended')).toBe('About 1 hr. Start a timer, or just move on.')
    expect(handsOffLine(90, 'unattended')).toBe('About 1 hr 30 min. Start a timer, or just move on.')
    expect(handsOffLine(1080, 'unattended')).toBe('About 18 hr. Start a timer, or just move on.')
  })

  it('Low attention (periodic): the plain length, then "Check on it now and then."', () => {
    expect(handsOffLine(12, 'periodic')).toBe('About 12 min. Check on it now and then.')
    expect(handsOffLine(90, 'periodic')).toBe('About 1 hr 30 min. Check on it now and then.')
  })

  it('no length, no line (nothing to say "about" of)', () => {
    expect(handsOffLine(0.4, 'unattended')).toBeNull()
    expect(handsOffLine(0.4, 'periodic')).toBeNull()
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

describe('READY_WHEN', () => {
  it('is one string, for later translation', () => {
    expect(READY_WHEN).toBe('Ready when:')
  })
})

describe('readyClock (PR 2 CP4, the time first)', () => {
  const plain = (s: string) => s.replace(/\s/gu, ' ')
  const at = (d: number, h: number, m: number) => new Date(2026, 9, d, h, m, 0).getTime()

  it('same calendar day: the time alone, in the device locale', () => {
    expect(plain(readyClock(at(23, 13, 0), at(23, 13, 42), 'en-US'))).toBe('1:42 PM')
    expect(plain(readyClock(at(23, 13, 0), at(23, 13, 42), 'en-GB'))).toBe('13:42')
  })

  it('the next calendar day: "7:00 am tomorrow"', () => {
    expect(plain(readyClock(at(23, 21, 0), at(24, 7, 0), 'en-US'))).toBe('7:00 AM tomorrow')
    expect(plain(readyClock(at(23, 21, 0), at(24, 7, 0), 'en-GB'))).toBe('7:00 tomorrow')
  })

  it('"tomorrow" from the calendar day, never from "under 24 h"', () => {
    expect(plain(readyClock(at(23, 23, 50), at(24, 0, 10), 'en-GB'))).toBe('0:10 tomorrow')
    expect(plain(readyClock(at(23, 23, 50), at(24, 0, 10), 'en-US'))).toBe('12:10 AM tomorrow')
    expect(plain(readyClock(at(23, 1, 0), at(23, 7, 0), 'en-US'))).toBe('7:00 AM')
  })

  it('later: "in N days"', () => {
    expect(plain(readyClock(at(23, 9, 0), at(26, 7, 0), 'en-US'))).toBe('7:00 AM in 3 days')
  })

  it('no-break spaces inside the time', () => {
    expect(readyClock(at(23, 13, 0), at(23, 13, 42), 'en-US')).toMatch(/^1:42\u00a0PM$/)
  })
})

describe('endedAgo (PR 2 CP4, the banner)', () => {
  it('under a minute: "just now"', () => {
    expect(endedAgo(0)).toBe('just now')
    expect(endedAgo(59_999)).toBe('just now')
  })

  it('whole minutes, rounded, at least 1; never seconds', () => {
    expect(endedAgo(60_000)).toBe('1 min ago')
    expect(endedAgo(89_000)).toBe('1 min ago')
    expect(endedAgo(4 * MIN + 20_000)).toBe('4 min ago')
    expect(endedAgo(4 * MIN + 40_000)).toBe('5 min ago')
  })

  it('from an hour: hours and minutes', () => {
    expect(endedAgo(65 * MIN)).toBe('1 hr 5 min ago')
    expect(endedAgo(120 * MIN)).toBe('2 hr ago')
  })
})

describe('sinceText (PR 2 CP4, the stale screen)', () => {
  it('formatMinutes style, never "hours"', () => {
    expect(sinceText(45 * MIN)).toBe(nbUnit('45 min'))
    expect(sinceText(7 * 60 * MIN)).toBe(nbUnit('7 hr'))
    expect(sinceText(7 * 60 * MIN + 20 * MIN)).toBe(nbUnit('7 hr 20 min'))
  })

  it('a number never splits from its unit across lines (a no-break space between them)', () => {
    expect(sinceText(7 * 60 * MIN + 20 * MIN)).toBe('7\u00a0hr 20\u00a0min')
  })
})

describe('sentence (PR 2 CP4: no doubled full stop)', () => {
  it('adds a full stop only when the text has no closing mark', () => {
    expect(sentence('Kadai Paneer')).toBe('Kadai Paneer.')
    expect(sentence('Pizza dough.')).toBe('Pizza dough.')
    expect(sentence('Wow!')).toBe('Wow!')
    expect(sentence('Ready?')).toBe('Ready?')
    expect(sentence('And then…')).toBe('And then…')
  })

  it('trims first; a closing quote or bracket after the mark still counts', () => {
    expect(sentence('Pizza dough. ')).toBe('Pizza dough.')
    expect(sentence('Pizza dough ')).toBe('Pizza dough.')
    expect(sentence('He said "stop."')).toBe('He said "stop."')
    expect(sentence('(the best one!)')).toBe('(the best one!)')
    expect(sentence('the "best" one')).toBe('the "best" one.')
  })
})

describe('noBreakWords (PR 2 CP4.1: a hyphenated word never splits across lines)', () => {
  it('marks every word with an inner hyphen; everything else (spaces included) is kept as it is', () => {
    expect(noBreakWords("You're still cooking 2-Minute Maggi.")).toEqual([
      { text: "You're still cooking ", nowrap: false },
      { text: '2-Minute', nowrap: true },
      { text: ' Maggi.', nowrap: false },
    ])
  })

  it('several, and at either end; the pieces join back to the text exactly', () => {
    const text = 'Ginger-garlic and stir-fry noodles-'
    const parts = noBreakWords(text)
    expect(parts.filter((p) => p.nowrap).map((p) => p.text)).toEqual(['Ginger-garlic', 'stir-fry'])
    expect(parts.map((p) => p.text).join('')).toBe(text)
    expect(noBreakWords('Sev-puri')).toEqual([{ text: 'Sev-puri', nowrap: true }])
  })

  it('no hyphen: one plain piece; a lone dash between spaces is not a word', () => {
    expect(noBreakWords('Kadai Paneer')).toEqual([{ text: 'Kadai Paneer', nowrap: false }])
    expect(noBreakWords('Rice - quick')).toEqual([{ text: 'Rice - quick', nowrap: false }])
  })

  it('a no-break space keeps its words together in one piece (the stale title\'s "7 hr ago.")', () => {
    expect(noBreakWords('last here 7\u00a0hr\u00a0ago.')).toEqual([{ text: 'last here 7\u00a0hr\u00a0ago.', nowrap: false }])
  })
})
