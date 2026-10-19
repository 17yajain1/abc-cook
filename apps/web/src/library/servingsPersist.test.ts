import { describe, expect, it, vi } from 'vitest'

import type { ImportMeta, RecipePlanResponse } from '@abc-cook/schema'

import type { PlanOrigin } from '@/cooking-mode/planKey'
import kadhi from '@/__fixtures__/kadhi-pakora.plan-response.json'
import type { ServingsChoice } from '@/lib/servings'

import { canonicalSourceKey } from './sourceKey'
import { persistTargetId, shouldPersist, toStored } from './servingsPersist'

const KADHI = kadhi as RecipePlanResponse
const META: ImportMeta = { warnings: [], review_recommended: false, sources: [], provenance: null, degraded: false }
const importOrigin: PlanOrigin = { kind: 'import', payload: KADHI, importMeta: META }

describe('persistTargetId (Q3: the same rule as planKeyFor)', () => {
  it('a library origin is its own id, with no lookup', () => {
    const find = vi.fn()
    expect(persistTargetId({ kind: 'library', id: 'abc' }, find)).toBe('abc')
    expect(find).not.toHaveBeenCalled()
  })

  it('a saved import is the id saved under its source key', () => {
    const find = vi.fn((key: string) => (key === canonicalSourceKey(KADHI.graph.source) ? { id: 'saved-1' } : undefined))
    expect(persistTargetId(importOrigin, find)).toBe('saved-1')
    expect(find).toHaveBeenCalledWith(canonicalSourceKey(KADHI.graph.source))
  })

  it('an unsaved import has no target', () => {
    expect(persistTargetId(importOrigin, () => undefined)).toBeNull()
  })

  it('a server (fixture) origin has no target and is never looked up', () => {
    const find = vi.fn()
    expect(persistTargetId({ kind: 'server', recipeId: 'kadhi-pakora' }, find)).toBeNull()
    expect(find).not.toHaveBeenCalled()
  })
})

describe('toStored (factor 1 is stored as null)', () => {
  const S = (chosen: number, original: number): ServingsChoice => ({ mode: 'servings', chosen, original })
  const B = (multiplier: 0.5 | 1 | 1.5 | 2 | 3): ServingsChoice => ({ mode: 'batch', multiplier })

  it('null and undefined are null', () => {
    expect(toStored(null)).toBeNull()
    expect(toStored(undefined)).toBeNull()
  })

  it('stepping back to the original, or Reset to N, writes null', () => {
    expect(toStored(S(4, 4))).toBeNull()
    expect(toStored(B(1))).toBeNull()
  })

  it('any other factor is kept as is', () => {
    expect(toStored(S(6, 4))).toEqual(S(6, 4))
    expect(toStored(B(0.5))).toEqual(B(0.5))
  })
})

describe('shouldPersist', () => {
  it('no write while the stepper is locked by a cook in progress', () => {
    expect(shouldPersist(true, 'abc')).toBe(false)
  })

  it('no write without a target', () => {
    expect(shouldPersist(false, null)).toBe(false)
  })

  it('writes when unlocked and there is a target', () => {
    expect(shouldPersist(false, 'abc')).toBe(true)
  })
})
