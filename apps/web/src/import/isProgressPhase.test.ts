import { describe, expect, it } from 'vitest'

import type { StreamedDraft } from '@abc-cook/schema'

import { isProgressPhase } from './ImportProgress'
import type { Phase } from './phase'

const draft: StreamedDraft = {
  ingredients: [{ name: 'Onion', group: null, prep_note: null, qty: '1', unit: null }],
  ingredients_complete: false,
  steps: [],
  steps_complete: false,
  calls: 1,
}
const error = (over: Partial<Extract<Phase, { kind: 'error' }>> = {}): Phase => ({
  kind: 'error',
  message: 'The server had a problem (500).',
  preview: null,
  acquired: null,
  draft: null,
  ...over,
})

describe('isProgressPhase', () => {
  it('takes over the screen while reading', () => {
    expect(isProgressPhase({ kind: 'polling', status: 'extracting', preview: null, acquired: null, draft: null })).toBe(true)
  })

  it('slow takes over too: the page stays up with Keep waiting, nothing read is dropped', () => {
    expect(
      isProgressPhase({ kind: 'slow', jobId: 'j', token: 1, status: 'extracting', preview: null, acquired: null, draft: null }),
    ).toBe(true)
  })

  it('failed takes over, with or without anything read', () => {
    expect(
      isProgressPhase({ kind: 'failed', failure: 'unavailable', url: null, preview: null, acquired: null, draft: null }),
    ).toBe(true)
  })

  it('keeps an error with nothing read inline, in the entry form or the Copy sheet', () => {
    expect(isProgressPhase(error())).toBe(false)
  })

  it('takes over for an error once anything was read: a draft, a description or a preview', () => {
    expect(isProgressPhase(error({ draft }))).toBe(true)
    expect(isProgressPhase(error({ acquired: { title: 'T', channel: null, description: null } }))).toBe(true)
    expect(isProgressPhase(error({ preview: { title: 'P', ingredients: [], instructions: [] } }))).toBe(true)
  })

  it('leaves the entry phase to the form', () => {
    expect(isProgressPhase({ kind: 'entry' })).toBe(false)
  })
})
