import { describe, expect, it } from 'vitest'

import type { AcquiredSource, SourcePreview, StreamedDraft } from '@abc-cook/schema'

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

  describe('a failed job', () => {
    it('has no pending sections: they are absent, not placeholders', () => {
      const view = importViewFor({
        ...base,
        instant: instant({ title: 'T' }),
        acquired: acquired(),
        status: 'failed',
      })
      expect(view.ingredients).toEqual({ kind: 'none' })
      expect(view.method).toEqual({ kind: 'none' })
      expect(JSON.stringify(view)).not.toContain('pending')
    })

    it('keeps the header: thumbnail, channel, title and description', () => {
      const view = importViewFor({ ...base, instant: instant(), acquired: acquired(), status: 'failed' })
      expect(view.header).toEqual({
        title: 'Acquired title',
        channel: 'Acquired channel',
        thumbnailUrl: THUMB,
        description: 'Acquired description',
      })
    })

    it('still shows source lines it really has (a blog preview), only dropping the empty ones', () => {
      const view = importViewFor({
        ...base,
        preview: preview({ instructions: [] }),
        status: 'failed',
      })
      expect(view.ingredients).toEqual({ kind: 'lines', lines: ['1 onion', '2 tbsp oil'] })
      expect(view.method).toEqual({ kind: 'none' })
    })

    it('a running job still shows pending, so the failed variant is the only difference', () => {
      expect(importViewFor({ ...base, status: 'extracting' }).ingredients).toEqual({ kind: 'pending' })
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

const draft = (over: Partial<StreamedDraft> = {}): StreamedDraft => ({
  ingredients: [],
  ingredients_complete: false,
  steps: [],
  steps_complete: false,
  calls: 1,
  ...over,
})
const onion = { name: 'Onion', group: null, prep_note: null, qty: '1', unit: null }

describe('the streamed draft', () => {
  it('fills the ingredients as items, in arrival order, as the server sent them', () => {
    const view = importViewFor({
      ...base,
      status: 'extracting',
      draft: draft({ ingredients: [onion, { ...onion, name: 'Oil', qty: '2', unit: 'tbsp' }] }),
    })
    expect(view.ingredients.kind).toBe('items')
    if (view.ingredients.kind !== 'items') return
    expect(view.ingredients.groups[0].items.map((i) => [i.name, i.trailing])).toEqual([
      ['Onion', '1'],
      ['Oil', '2 tbsp'],
    ])
    expect(view.method).toEqual({ kind: 'pending' })
  })

  it('fills the steps with the model text and whether the list has closed', () => {
    const open = importViewFor({ ...base, draft: draft({ steps: [{ text: 'Heat oil.' }] }) })
    expect(open.method).toEqual({ kind: 'steps', steps: ['Heat oil.'], complete: false })
    const closed = importViewFor({
      ...base,
      draft: draft({ steps: [{ text: 'Heat oil.' }], steps_complete: true }),
    })
    expect(closed.method).toEqual({ kind: 'steps', steps: ['Heat oil.'], complete: true })
  })

  it('a blank step is not shown', () => {
    const view = importViewFor({ ...base, draft: draft({ steps: [{ text: ' ' }, { text: 'Stir.' }] }) })
    expect(view.method).toEqual({ kind: 'steps', steps: ['Stir.'], complete: false })
  })

  describe('per-section precedence: preview, then draft, then pending', () => {
    const d = draft({ ingredients: [onion], steps: [{ text: 'Draft step.' }] })

    it('the preview wins a section it fills, over the draft', () => {
      const view = importViewFor({ ...base, preview: preview(), draft: d })
      expect(view.ingredients.kind).toBe('lines')
      expect(view.method.kind).toBe('sections')
    })

    it('the draft fills a section the preview left empty', () => {
      const view = importViewFor({ ...base, preview: preview({ instructions: [] }), draft: d })
      expect(view.ingredients.kind).toBe('lines')
      expect(view.method).toEqual({ kind: 'steps', steps: ['Draft step.'], complete: false })
      const other = importViewFor({ ...base, preview: preview({ ingredients: [] }), draft: d })
      expect(other.ingredients.kind).toBe('items')
      expect(other.method.kind).toBe('sections')
    })

    it('with neither, the section is pending', () => {
      const view = importViewFor({ ...base, draft: draft() })
      expect(view.ingredients).toEqual({ kind: 'pending' })
      expect(view.method).toEqual({ kind: 'pending' })
    })
  })

  it('a list the model closed with nothing in it is dropped, not left pending', () => {
    const view = importViewFor({
      ...base,
      draft: draft({ ingredients_complete: true, steps_complete: true }),
    })
    expect(view.ingredients).toEqual({ kind: 'none' })
    expect(view.method).toEqual({ kind: 'none' })
  })

  describe('a failed job keeps its draft', () => {
    it('shows the draft sections and drops the ones it never filled', () => {
      const view = importViewFor({
        ...base,
        status: 'failed',
        draft: draft({ ingredients: [onion] }),
      })
      expect(view.ingredients.kind).toBe('items')
      expect(view.method).toEqual({ kind: 'none' })
    })

    it('without a draft is the S1 model: both sections none', () => {
      const view = importViewFor({ ...base, status: 'failed', draft: null })
      expect(view.ingredients).toEqual({ kind: 'none' })
      expect(view.method).toEqual({ kind: 'none' })
      expect(importViewFor({ ...base, status: 'failed' })).toEqual(view)
    })
  })

  it('carries no duration, timer, offset or serving field', () => {
    const view = importViewFor({
      ...base,
      status: 'extracting',
      draft: draft({ ingredients: [onion], steps: [{ text: 'Fry for 5 minutes.' }], steps_complete: true }),
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
    expect(keys.filter((k) => /min|dur|time|timer|saved|parallel|start|offset|lead|serv|total/i.test(k))).toEqual(
      [],
    )
  })
})
