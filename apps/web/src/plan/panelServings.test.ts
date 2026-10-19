import { describe, expect, it, vi } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import croissant from '@/__fixtures__/croissant.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import kadhi from '@/__fixtures__/kadhi-pakora.plan-response.json'
import type { ServingsChoice } from '@/lib/servings'

import { derivePlan } from './derive'
import { panelServings } from './panelServings'

const KADHI = derivePlan(kadhi as RecipePlanResponse)
const KADAI = derivePlan(kadaiPaneer as RecipePlanResponse)
const CROISSANT = derivePlan(croissant as RecipePlanResponse)
const S = (chosen: number, original: number): ServingsChoice => ({ mode: 'servings', chosen, original })

describe('panelServings', () => {
  it('no change handler, no control', () => {
    expect(panelServings(KADHI, null, null, false, undefined)).toBeUndefined()
  })
  it('a recipe with nothing scalable is gated, whatever choice it is handed', () => {
    const s = panelServings(KADAI, null, S(6, 3), false, vi.fn())
    expect(s?.kind).toBe('gated')
    expect(s?.choice).toBeNull()
  })
  it('a stated recipe starts at its own servings, live', () => {
    const s = panelServings(KADHI, null, null, false, vi.fn())
    expect(s).toMatchObject({ kind: 'live', choice: S(4, 4) })
  })
  it('a defaulted recipe starts at x1 in batch mode', () => {
    expect(panelServings(CROISSANT, null, null, false, vi.fn())).toMatchObject({
      kind: 'live',
      choice: { mode: 'batch', multiplier: 1 },
    })
  })
  it('keeps a valid choice and reports locked', () => {
    expect(panelServings(KADHI, null, S(6, 4), true, vi.fn())).toMatchObject({ kind: 'locked', choice: S(6, 4) })
  })
  it('a choice made for other servings does not apply (reconcile)', () => {
    expect(panelServings(KADHI, null, S(6, 6), false, vi.fn())?.choice).toEqual(S(4, 4))
    expect(panelServings(CROISSANT, null, S(6, 4), false, vi.fn())?.choice).toEqual({ mode: 'batch', multiplier: 1 })
  })
  it('going back to the original reports null, so nothing is kept for an unchanged recipe', () => {
    const onChange = vi.fn()
    const s = panelServings(KADHI, null, S(6, 4), false, onChange)!
    s.onChange(S(4, 4))
    s.onChange(S(5, 4))
    expect(onChange.mock.calls).toEqual([[null], [S(5, 4)]])
  })
})
