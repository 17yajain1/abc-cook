import { describe, expect, it } from 'vitest'

import type { AcquiredSource, SourcePreview } from '@abc-cook/schema'

import { importViewFor } from './importView'
import type { InstantHeader } from './instantPreview'

const THUMB = 'https://i.ytimg.com/vi/abc/hqdefault.jpg'
const instant = (over: Partial<InstantHeader> = {}): InstantHeader => ({
  thumbnailUrl: THUMB,
  title: null,
  channel: null,
  ...over,
})
const acquired = (over: Partial<AcquiredSource> = {}): AcquiredSource => ({
  title: 'Acquired title',
  channel: 'Acquired channel',
  description: 'Acquired description',
  ...over,
})
const preview = (over: Partial<SourcePreview> = {}): SourcePreview => ({
  title: 'Preview title',
  ingredients: ['1 onion', '2 tbsp oil'],
  instructions: [{ heading: null, lines: ['Heat the oil.', 'Add the onion.'] }],
  ...over,
})
const base = { instant: null, acquired: null, preview: null, status: 'acquiring' as const }

describe('importViewFor', () => {
  it('has no header and both sections pending when nothing is known', () => {
    expect(importViewFor(base)).toEqual({
      header: null,
      ingredients: { kind: 'pending' },
      method: { kind: 'pending' },
      status: 'acquiring',
    })
  })

  it('shows the thumbnail alone for an instant header before oEmbed answers', () => {
    const view = importViewFor({ ...base, instant: instant() })
    expect(view.header).toEqual({
      title: null,
      channel: null,
      thumbnailUrl: THUMB,
      description: null,
    })
  })

  describe('title precedence', () => {
    it('prefers oEmbed over acquired over preview', () => {
      const all = { ...base, acquired: acquired(), preview: preview() }
      expect(importViewFor({ ...all, instant: instant({ title: 'oEmbed title' }) }).header?.title).toBe(
        'oEmbed title',
      )
      expect(importViewFor({ ...all, instant: instant() }).header?.title).toBe('Acquired title')
      expect(importViewFor({ ...base, preview: preview() }).header?.title).toBe('Preview title')
    })

    it('falls through a blank title', () => {
      const view = importViewFor({ ...base, instant: instant({ title: '  ' }), acquired: acquired() })
      expect(view.header?.title).toBe('Acquired title')
    })

    it('does not change once oEmbed set it, when acquired arrives with the same text', () => {
      const early = importViewFor({ ...base, instant: instant({ title: 'Same' }) })
      const late = importViewFor({
        ...base,
        instant: instant({ title: 'Same' }),
        acquired: acquired({ title: 'Same' }),
      })
      expect(late.header?.title).toBe(early.header?.title)
    })
  })

  it('takes the channel from oEmbed, then acquired', () => {
    expect(
      importViewFor({ ...base, instant: instant({ channel: 'oEmbed channel' }), acquired: acquired() })
        .header?.channel,
    ).toBe('oEmbed channel')
    expect(importViewFor({ ...base, acquired: acquired() }).header?.channel).toBe('Acquired channel')
  })

  it('takes the description from acquired only', () => {
    expect(importViewFor({ ...base, acquired: acquired() }).header?.description).toBe(
      'Acquired description',
    )
    expect(importViewFor({ ...base, acquired: acquired({ description: null }) }).header?.description).toBeNull()
  })

  it('takes the thumbnail from the instant header only (a blog source has none)', () => {
    expect(importViewFor({ ...base, preview: preview() }).header?.thumbnailUrl).toBeNull()
  })

  describe('ingredients and method', () => {
    it('are pending until the blog preview exists', () => {
      const view = importViewFor({ ...base, instant: instant(), acquired: acquired() })
      expect(view.ingredients).toEqual({ kind: 'pending' })
      expect(view.method).toEqual({ kind: 'pending' })
    })

    it('become the source lines, verbatim', () => {
      const view = importViewFor({ ...base, preview: preview(), status: 'plan_building' })
      expect(view.ingredients).toEqual({ kind: 'lines', lines: ['1 onion', '2 tbsp oil'] })
      expect(view.method).toEqual({
        kind: 'sections',
        sections: [{ heading: null, lines: ['Heat the oil.', 'Add the onion.'] }],
      })
      expect(view.status).toBe('plan_building')
    })

    it('stay pending when the preview has empty lists', () => {
      const view = importViewFor({
        ...base,
        preview: preview({ ingredients: [' '], instructions: [{ heading: 'x', lines: [] }] }),
      })
      expect(view.ingredients).toEqual({ kind: 'pending' })
      expect(view.method).toEqual({ kind: 'pending' })
    })
  })

  it('has no duration, timer or advice field anywhere on the model', () => {
    const view = importViewFor({
      instant: instant({ title: 'T', channel: 'C' }),
      acquired: acquired(),
      preview: preview(),
      status: 'plan_building',
    })
    const keys: string[] = []
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
          keys.push(key)
          walk(child)
        }
      }
    }
    walk(view)
    expect(keys.filter((k) => /min|dur|time|timer|saved|parallel|start/i.test(k))).toEqual([])
  })
})
