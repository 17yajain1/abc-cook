import { describe, expect, it, vi } from 'vitest'

import type { ImportMeta, RecipePlanResponse } from '@abc-cook/schema'

import type { RenderPlan } from '../plan/derive'
import { completeImport, type FinishedImport, type ImportHandlers } from './handOff'

const plan = { title: 'Plan' } as unknown as RenderPlan
const payload = { graph: { id: 'g1' } } as unknown as RecipePlanResponse
const importMeta = { degraded: false } as unknown as ImportMeta
const extras = { original: null, postprocess_version: 10 }
const done = { plan, payload, importMeta, extras, scrollAnchor: null }

function handlers(saveState: FinishedImport['saveState'] = { status: 'saved' }) {
  const calls: string[] = []
  const opened: FinishedImport[] = []
  const h: ImportHandlers = {
    save: vi.fn(() => {
      calls.push('save')
      return saveState
    }),
    open: vi.fn((finished: FinishedImport) => {
      calls.push('open')
      opened.push(finished)
    }),
  }
  return { h, calls, opened }
}

describe('completeImport', () => {
  it('saves once, then opens at once: there is no ready phase to wait in', () => {
    const { h, calls, opened } = handlers()
    completeImport(done, h)
    expect(calls).toEqual(['save', 'open'])
    expect(h.save).toHaveBeenCalledTimes(1)
    expect(h.open).toHaveBeenCalledTimes(1)
    expect(opened[0]).toEqual({ ...done, saveState: { status: 'saved' } })
  })

  it('carries the cook\'s scroll anchor to the open, so the plan page lands where they were reading', () => {
    const { h, opened } = handlers()
    completeImport({ ...done, scrollAnchor: { section: 'need', offset: 120 } }, h)
    expect(opened[0].scrollAnchor).toEqual({ section: 'need', offset: 120 })
  })

  it('carries a failed save to the opened plan, so its Save control can retry', () => {
    const { h, opened } = handlers({ status: 'error', message: 'Storage is full.' })
    completeImport(done, h)
    expect(opened[0].saveState).toEqual({ status: 'error', message: 'Storage is full.' })
  })
})
