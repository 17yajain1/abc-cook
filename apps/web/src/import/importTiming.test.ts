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

  it('has marks for the first ingredient, the first step, ready and open', () => {
    let t = 0
    const timer = createImportTimer(() => t)
    timer.mark('submit')
    t = 14500
    timer.mark('ingredients')
    t = 19300
    timer.mark('firstStep')
    t = 33000
    timer.mark('ready')
    t = 36000
    timer.mark('open')
    expect(timer.report()).toEqual({
      submit: 0,
      ingredients: 14500,
      firstStep: 19300,
      ready: 33000,
      open: 36000,
    })
  })
})
