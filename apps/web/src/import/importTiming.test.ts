import { describe, expect, it } from 'vitest'

import { createImportTimer } from './importTiming'

describe('createImportTimer', () => {
  it('reports each mark in ms from submit, first write wins', () => {
    let t = 1000
    const timer = createImportTimer(() => t)
    timer.mark('submit')
    t = 1180
    timer.mark('thumbnail')
    t = 1950
    timer.mark('title')
    t = 2500
    timer.mark('title') // ignored
    expect(timer.report()).toEqual({ submit: 0, thumbnail: 180, title: 950 })
  })

  it('reports nothing before submit', () => {
    const timer = createImportTimer(() => 5)
    timer.mark('plan')
    expect(timer.report()).toEqual({})
  })
})
