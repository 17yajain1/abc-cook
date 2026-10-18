import { describe, expect, it } from 'vitest'

import type { StreamedDraft } from '@abc-cook/schema'

import { importViewFor } from './importView'

const draft = (steps: { text: string; added?: boolean }[]): StreamedDraft =>
  ({
    ingredients: [],
    ingredients_complete: true,
    steps,
    steps_complete: false,
    calls: 1,
  }) as StreamedDraft

const view = (d: StreamedDraft) =>
  importViewFor({ instant: null, acquired: null, preview: null, draft: d, status: 'extracting' })

describe('importViewFor - added draft steps (FGC-3)', () => {
  it('flags the steps the model marked as added, in step order', () => {
    const { method } = view(draft([{ text: 'A.' }, { text: 'B.', added: true }, { text: 'C.' }]))
    expect(method).toMatchObject({ kind: 'steps', steps: ['A.', 'B.', 'C.'] })
    expect((method as { added?: boolean[] }).added).toEqual([false, true, false])
  })

  it('adds nothing to the view when no step is added', () => {
    const { method } = view(draft([{ text: 'A.' }, { text: 'B.', added: false }]))
    expect(method).toEqual({ kind: 'steps', steps: ['A.', 'B.'], complete: false })
  })

  it('keeps the flags aligned when a blank step is skipped', () => {
    const { method } = view(draft([{ text: ' ' }, { text: 'B.', added: true }]))
    expect((method as { steps: string[]; added?: boolean[] }).steps).toEqual(['B.'])
    expect((method as { added?: boolean[] }).added).toEqual([true])
  })
})
