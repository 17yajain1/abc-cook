import { describe, expect, it } from 'vitest'

import type { AcquiredSource, SourcePreview, StreamedDraft } from '@abc-cook/schema'

import { importViewFor } from './importView'
import type { ImportStatus } from './phase'
import { progressStripFor, sourceKindFor, type SourceKind } from './progressStrip'

const acquired: AcquiredSource = { title: 'T', channel: 'C', description: 'D' }
const preview: SourcePreview = {
  title: 'P',
  ingredients: ['1 onion'],
  instructions: [{ heading: null, lines: ['Chop.', 'Fry.'] }],
}
const onion = { name: 'Onion', group: null, prep_note: null, qty: '1', unit: null }
const draft = (over: Partial<StreamedDraft> = {}): StreamedDraft => ({
  ingredients: [],
  ingredients_complete: false,
  steps: [],
  steps_complete: false,
  calls: 1,
  ...over,
})

function strip(
  status: ImportStatus,
  over: { draft?: StreamedDraft | null; acquired?: AcquiredSource | null; preview?: SourcePreview | null; kind?: SourceKind } = {},
) {
  const a = over.acquired === undefined ? null : over.acquired
  const p = over.preview === undefined ? null : over.preview
  const d = over.draft === undefined ? null : over.draft
  const view = importViewFor({ instant: null, acquired: a, preview: p, draft: d, status })
  return progressStripFor(view, status, { kind: over.kind ?? 'video', preview: p != null })
}
const states = (s: ReturnType<typeof strip>) => s.segments.map((x) => x.state)

describe('progressStripFor', () => {
  it('always has the four parts, in order', () => {
    expect(strip('acquiring').segments.map((s) => s.key)).toEqual(['read', 'ingredients', 'steps', 'plan'])
  })

  it('acquiring: reading the source is the part in progress', () => {
    const s = strip('acquiring')
    expect(states(s)).toEqual(['active', 'pending', 'pending', 'pending'])
    expect(s.headline).toBe('Getting the recipe…')
  })

  it('a title and channel from the job do not end the read: captions and link probing are still running', () => {
    // The server publishes `acquired` as soon as yt-dlp answers, still `acquiring`.
    const s = strip('acquiring', { acquired })
    expect(states(s)).toEqual(['active', 'pending', 'pending', 'pending'])
    expect(s.headline).toBe('Getting the recipe…')
  })

  it('extracting with nothing streamed yet: the source is read, ingredients are next', () => {
    const s = strip('extracting', { acquired, draft: draft() })
    expect(states(s)).toEqual(['done', 'active', 'pending', 'pending'])
    expect(s.headline).toBe('Reading the ingredients…')
  })

  it('ingredients streaming but not complete stay in progress, and the headline agrees', () => {
    const s = strip('extracting', { acquired, draft: draft({ ingredients: [onion] }) })
    expect(states(s)).toEqual(['done', 'active', 'pending', 'pending'])
    expect(s.headline).toBe('Reading the ingredients…')
  })

  it('steps have begun: ingredients are done even before the draft flags them complete', () => {
    const s = strip('extracting', { acquired, draft: draft({ ingredients: [onion], steps: [{ text: 'Chop.' }] }) })
    expect(states(s)).toEqual(['done', 'done', 'active', 'pending'])
    expect(s.headline).toBe('Reading the steps…')
  })

  it('ingredients complete, steps streaming', () => {
    const s = strip('extracting', {
      acquired,
      draft: draft({ ingredients: [onion], ingredients_complete: true, steps: [{ text: 'Chop.' }] }),
    })
    expect(states(s)).toEqual(['done', 'done', 'active', 'pending'])
    expect(s.headline).toBe('Reading the steps…')
  })

  it('both sections complete: building the plan is next, and the headline says so', () => {
    const s = strip('extracting', {
      acquired,
      draft: draft({ ingredients: [onion], ingredients_complete: true, steps: [{ text: 'Chop.' }], steps_complete: true }),
    })
    expect(states(s)).toEqual(['done', 'done', 'done', 'active'])
    expect(s.headline).toBe('Building your cooking plan…')
  })

  it.each(['validating', 'plan_building'] as const)('%s: the plan is the part in progress', (status) => {
    const s = strip(status, {
      acquired,
      draft: draft({ ingredients: [onion], ingredients_complete: true, steps: [{ text: 'Chop.' }], steps_complete: true }),
    })
    expect(states(s)).toEqual(['done', 'done', 'done', 'active'])
  })

  it('done: every part is done', () => {
    const s = strip('done', {
      acquired,
      draft: draft({ ingredients: [onion], ingredients_complete: true, steps: [{ text: 'Chop.' }], steps_complete: true }),
    })
    expect(states(s)).toEqual(['done', 'done', 'done', 'done'])
  })

  it('a blog page gives its recipe whole: read, ingredients and steps are done at once', () => {
    const s = strip('plan_building', { acquired, preview, kind: 'page' })
    expect(states(s)).toEqual(['done', 'done', 'done', 'active'])
    expect(s.segments[0].label).toBe('Page read')
  })

  it('a cache hit with no draft and no preview: nothing streams, and the plan is the part in progress', () => {
    // Status moves straight to plan_building: the job is past extraction, so the sections are not still open.
    const s = strip('plan_building')
    expect(states(s)).toEqual(['done', 'done', 'done', 'active'])
    expect(s.headline).toBe('Building your cooking plan…')
  })

  it('pasted text: the first part reads "Text read" and is done as soon as the job has moved on', () => {
    const s = strip('extracting', { kind: 'text', draft: draft() })
    expect(s.segments[0]).toEqual({ key: 'read', label: 'Text read', state: 'done' })
  })

  it('never states a time', () => {
    const s = strip('extracting', { acquired, draft: draft() })
    expect(JSON.stringify(s)).not.toMatch(/\d\s*(sec|min|s\b)|about|usually/i)
  })
})

describe('sourceKindFor', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', false, 'video'],
    ['https://youtu.be/dQw4w9WgXcQ', false, 'video'],
    ['https://www.instagram.com/reel/CWqAgUZgCku/', false, 'video'],
    ['https://kitchen.example/recipes/dal', false, 'page'],
    [null, false, 'page'],
    [null, true, 'text'],
    ['https://youtu.be/dQw4w9WgXcQ', true, 'text'],
  ] as const)('%s (text=%s) is %s', (url, isText, kind) => {
    expect(sourceKindFor(url, isText)).toBe(kind)
  })
})
