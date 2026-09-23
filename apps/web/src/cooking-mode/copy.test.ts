import { describe, expect, it } from 'vitest'

import { aboutMinutes, cap, clockStr, dayClock, splitCopy, wordFor } from './copy'

const MIN = 60_000

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

describe('clockStr', () => {
  it('formats 12-hour wall-clock time with am/pm', () => {
    const t = new Date(2026, 8, 22, 16, 18, 0).getTime()
    expect(clockStr(t)).toBe('4:18 pm')
  })

  it('renders midnight as 12 am', () => {
    const t = new Date(2026, 8, 22, 0, 5, 0).getTime()
    expect(clockStr(t)).toBe('12:05 am')
  })
})

describe('dayClock', () => {
  const now = new Date(2026, 8, 22, 15, 0, 0).getTime()

  it('reads a same-day target as a bare clock time', () => {
    const target = new Date(2026, 8, 22, 16, 18, 0).getTime()
    expect(dayClock(now, target)).toBe('4:18 pm')
  })

  it('reads next-day as "tomorrow, …"', () => {
    const target = new Date(2026, 8, 23, 7, 0, 0).getTime()
    expect(dayClock(now, target)).toBe('tomorrow, 7:00 am')
  })

  it('reads further out as "in N days, …"', () => {
    const target = new Date(2026, 8, 25, 9, 0, 0).getTime()
    expect(dayClock(now, target)).toBe('in 3 days, 9:00 am')
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
