import { describe, expect, it } from 'vitest'

import type { ImportOriginal } from '@abc-cook/schema'

import { importExtrasFrom } from './importExtras'

const ORIGINAL = { graph_id: 'g' } as unknown as ImportOriginal

describe('importExtrasFrom', () => {
  it('lifts original and the version stamp off a done result', () => {
    expect(importExtrasFrom({ original: ORIGINAL, postprocess_version: 9 })).toEqual({
      original: ORIGINAL,
      postprocess_version: 9,
    })
  })

  it('missing fields become nulls', () => {
    expect(importExtrasFrom({})).toEqual({ original: null, postprocess_version: null })
  })

  it('explicit nulls stay null', () => {
    expect(importExtrasFrom({ original: null, postprocess_version: null })).toEqual({
      original: null,
      postprocess_version: null,
    })
  })
})
