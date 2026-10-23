import { describe, expect, it } from 'vitest'

import { hostPhrase } from './hostPhrase'

describe('hostPhrase', () => {
  it('turns a listed verb and its object into "while the {object} {verb}s"', () => {
    expect(hostPhrase('Cook tomato base')).toBe('while the tomato base cooks')
    expect(hostPhrase('Soak rice')).toBe('while the rice soaks')
    expect(hostPhrase('Simmer stew')).toBe('while the stew simmers')
    expect(hostPhrase('Marinate chicken')).toBe('while the chicken marinates')
    expect(hostPhrase('Fry birista')).toBe('while the birista fries')
    expect(hostPhrase('Proof dough')).toBe('while the dough proofs')
  })

  it('takes the plural verb for a plural object, but not for a word ending in "ss"', () => {
    expect(hostPhrase('Bake shortcakes')).toBe('while the shortcakes bake')
    expect(hostPhrase('Soak beans')).toBe('while the beans soak')
    expect(hostPhrase('Fry potatoes')).toBe('while the potatoes fry')
    expect(hostPhrase('Cook grass')).toBe('while the grass cooks')
  })

  it('drops a leading article so it never says "the the"', () => {
    expect(hostPhrase('Cook the chicken')).toBe('while the chicken cooks')
  })

  it('quotes the step when the verb is not on the list', () => {
    expect(hostPhrase('Wait before serving')).toBe('during "Wait before serving"')
    expect(hostPhrase('First rise')).toBe('during "First rise"')
    expect(hostPhrase('Knead dough')).toBe('during "Knead dough"')
  })

  it('quotes the step when there is no object, or the object is long', () => {
    expect(hostPhrase('Cook')).toBe('during "Cook"')
    expect(hostPhrase('Cook the whole big pot of everything here')).toBe('during "Cook the whole big pot of everything here"')
  })

  it('quotes the step when the object is a clause or has digits or brackets', () => {
    expect(hostPhrase('Simmer to thicken')).toBe('during "Simmer to thicken"')
    expect(hostPhrase('Soak 2 hours')).toBe('during "Soak 2 hours"')
    expect(hostPhrase('Cook rice (low heat)')).toBe('during "Cook rice (low heat)"')
    expect(hostPhrase('Cook rice until soft')).toBe('during "Cook rice until soft"')
  })
})
