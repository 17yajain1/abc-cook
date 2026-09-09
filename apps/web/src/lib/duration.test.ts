import { describe, expect, it } from 'vitest'

import { formatMinutes, roundMin } from './duration'

describe('roundMin', () => {
  it('trims the scheduler 0.01-min quantum', () => {
    expect(roundMin(12.01)).toBe(12)
    expect(roundMin(8.99)).toBe(9)
    expect(roundMin(9)).toBe(9)
  })

  it('leaves zero alone — "0 min" is a real answer for a plan that saves nothing', () => {
    expect(roundMin(0)).toBe(0)
  })
})

describe('formatMinutes', () => {
  it('reads as bare minutes under an hour', () => {
    expect(formatMinutes(34)).toBe('34 min')
    expect(formatMinutes(59)).toBe('59 min')
  })

  it('switches to hours at 60 and drops a zero minute remainder', () => {
    expect(formatMinutes(60)).toBe('1 hr')
    expect(formatMinutes(120)).toBe('2 hr')
  })

  it('reads as hours and minutes above the hour', () => {
    expect(formatMinutes(78)).toBe('1 hr 18 min')
    expect(formatMinutes(145)).toBe('2 hr 25 min')
  })

  it('rounds before deciding the shape, so 59.6 is an hour not "59.6 min"', () => {
    expect(formatMinutes(59.6)).toBe('1 hr')
  })
})
