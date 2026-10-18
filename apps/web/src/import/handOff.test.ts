import { describe, expect, it, vi } from 'vitest'

import type { ImportMeta, RecipePlanResponse } from '@abc-cook/schema'

import type { RenderPlan } from '../plan/derive'
import { completeImport, handOffFor, type FinishedImport, type ImportHandlers } from './handOff'
import { hasReadable, importViewFor } from './importView'

const plan = { title: 'Plan' } as unknown as RenderPlan
const payload = { graph: { id: 'g1' } } as unknown as RecipePlanResponse
const importMeta = { degraded: false } as unknown as ImportMeta
const extras = { original: null, postprocess_version: 10 }
const done = { plan, payload, importMeta, extras }

function handlers(saveState: FinishedImport['saveState'] = { status: 'saved' }) {
  const calls: string[] = []
  const h: ImportHandlers = {
    save: vi.fn(() => {
      calls.push('save')
      return saveState
    }),
    open: vi.fn(() => {
      calls.push('open')
    }),
  }
  return { h, calls }
}

describe('handOffFor', () => {
  it('waits for a tap when the reading screen showed anything readable', () => {
    expect(handOffFor(true)).toBe('tap')
  })

  it('opens at once when it showed nothing, as a cache hit does', () => {
    expect(handOffFor(false)).toBe('auto')
  })
})

describe('completeImport', () => {
  it('saves once at done and parks the plan for a tap, without opening it', () => {
    const { h, calls } = handlers()
    const outcome = completeImport(done, true, h)
    expect(calls).toEqual(['save'])
    expect(outcome).toEqual({ kind: 'ready', finished: { ...done, saveState: { status: 'saved' } } })
  })

  it('the tap opens it exactly once, after the save', () => {
    const { h, calls } = handlers()
    const outcome = completeImport(done, true, h)
    if (outcome.kind !== 'ready') throw new Error('expected ready')
    h.open(outcome.finished) // what the hook's tap does
    expect(calls).toEqual(['save', 'open'])
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.open).toHaveBeenCalledTimes(1)
    expect(h.open).toHaveBeenCalledWith(outcome.finished)
  })

  it('closing after ready never opens: the entry was saved, and stays saved', () => {
    const { h, calls } = handlers()
    completeImport(done, true, h)
    // The person taps Close: the hook resets and calls neither handler again.
    expect(calls).toEqual(['save'])
    expect(h.open).not.toHaveBeenCalled()
  })

  it('opens straight away when nothing was shown, saving first', () => {
    const { h, calls } = handlers()
    const outcome = completeImport(done, false, h)
    expect(calls).toEqual(['save', 'open'])
    expect(outcome.kind).toBe('opened')
  })

  it('carries a failed save to the opened plan, so its Save control can retry', () => {
    const { h } = handlers({ status: 'error', message: 'Storage is full.' })
    const outcome = completeImport(done, true, h)
    expect(outcome.kind === 'ready' && outcome.finished.saveState).toEqual({
      status: 'error',
      message: 'Storage is full.',
    })
  })
})

describe('hasReadable', () => {
  const base = { instant: null, acquired: null, preview: null, status: 'extracting' as const }
  const onion = { name: 'Onion', group: null, prep_note: null, qty: '1', unit: null }
  const draft = (over = {}) => ({
    ingredients: [],
    ingredients_complete: false,
    steps: [],
    steps_complete: false,
    calls: 1,
    ...over,
  })

  it('is false for a header and placeholders only', () => {
    expect(hasReadable(importViewFor(base))).toBe(false)
    expect(hasReadable(importViewFor({ ...base, draft: draft() }))).toBe(false)
  })

  it('is true once draft ingredients or draft steps are on screen', () => {
    expect(hasReadable(importViewFor({ ...base, draft: draft({ ingredients: [onion] }) }))).toBe(true)
    expect(hasReadable(importViewFor({ ...base, draft: draft({ steps: [{ text: 'Stir.' }] }) }))).toBe(true)
  })

  it('is true for a blog preview', () => {
    const preview = { title: 'P', ingredients: ['1 onion'], instructions: [] }
    expect(hasReadable(importViewFor({ ...base, preview }))).toBe(true)
  })
})
