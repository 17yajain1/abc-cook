import { describe, expect, it } from 'vitest'

import { uniqueDisplayNames } from './displayNames'

describe('uniqueDisplayNames', () => {
  it('shows a name once when two portions (e.g. two groups) share it', () => {
    expect(uniqueDisplayNames(['Cumin seeds', 'Onion', 'Cumin seeds'])).toEqual([
      'Cumin seeds',
      'Onion',
    ])
  })

  it('treats trim and case variants as the same name, keeping the first spelling', () => {
    expect(uniqueDisplayNames(['Roasted peanuts', ' roasted PEANUTS ', 'Ginger'])).toEqual([
      'Roasted peanuts',
      'Ginger',
    ])
  })

  it('does no plural or stem matching', () => {
    expect(uniqueDisplayNames(['Green chilli', 'Green chillies'])).toEqual([
      'Green chilli',
      'Green chillies',
    ])
  })

  it('keeps first-occurrence order and does not mutate its input', () => {
    const input = ['b', 'a', 'B', 'c', 'a']
    expect(uniqueDisplayNames(input)).toEqual(['b', 'a', 'c'])
    expect(input).toEqual(['b', 'a', 'B', 'c', 'a'])
  })
})
