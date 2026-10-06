import { describe, expect, it } from 'vitest'

import type { SourceRef } from '@abc-cook/schema'

// `?raw` + JSON.parse, not a JSON import: a vector holds a lone UTF-16 surrogate (a
// 32-unit slice can split an emoji, as JS `slice` does), which Vite's JSON loader rejects.
import vectorsRaw from '../../../api/tests/fixtures/source_key_vectors.json?raw'
import { canonicalSourceKey } from './sourceKey'

/**
 * A3 parity: the API's Python `canonical_source_key` (`abc_cook/extract/source_key.py`)
 * must agree with this implementation on every vector. The same file is asserted by
 * `apps/api/tests/test_source_key.py`. Test-only -- nothing here ships in the app, and
 * this implementation is the reference: if a vector fails, regenerate the file from
 * this code, never change `sourceKey.ts` to fit the port.
 */
interface Vector {
  kind: string
  value: string
  key: string
}

const vectors = (JSON.parse(vectorsRaw) as { vectors: Vector[] }).vectors

describe('canonicalSourceKey — shared parity vectors', () => {
  it('has a meaningful number of vectors', () => {
    expect(vectors.length).toBeGreaterThan(100)
  })

  it.each(vectors.map((v, i) => [i, v] as const))('vector %i', (_i, v) => {
    const source = { kind: v.kind, value: v.value, imported_at: '2026-01-01T00:00:00Z' }
    expect(canonicalSourceKey(source as SourceRef)).toBe(v.key)
  })
})
