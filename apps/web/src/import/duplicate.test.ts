import { describe, expect, it } from 'vitest'

import type { SavedRecipe } from '@abc-cook/schema'

import { canonicalUrlSourceKey } from '../library/sourceKey'
import { savedMatchFor, submitPlan } from './duplicate'
import { runSubmit, type SubmitIO } from './submitFlow'

const ID = 'dQw4w9WgXcQ'

function saved(sourceKey: string): SavedRecipe {
  return { id: 'saved-1', source_key: sourceKey } as unknown as SavedRecipe
}

/** A library holding exactly the entries keyed by `keys`. */
const findIn =
  (...keys: string[]) =>
  (key: string) =>
    keys.includes(key) ? saved(key) : undefined

describe('savedMatchFor', () => {
  const find = findIn(`youtube:${ID}`, 'url:example.com/recipes/dal')

  it.each([
    ['watch', `https://www.youtube.com/watch?v=${ID}`],
    ['shorts', `https://www.youtube.com/shorts/${ID}`],
    ['youtu.be', `https://youtu.be/${ID}`],
    ['si= share link', `https://youtu.be/${ID}?si=AbC123`],
    ['mobile watch with a timestamp', `https://m.youtube.com/watch?v=${ID}&t=42s`],
  ])('matches a saved YouTube entry from the %s form', (_name, url) => {
    expect(savedMatchFor(url, find)?.source_key).toBe(`youtube:${ID}`)
  })

  it('matches a blog URL that only differs by utm_ parameters, www and a trailing slash', () => {
    expect(
      savedMatchFor('https://www.example.com/recipes/dal/?utm_source=x&utm_medium=y', find),
    ).toBeDefined()
  })

  it('does not match a different source', () => {
    expect(savedMatchFor('https://youtu.be/other-id', find)).toBeUndefined()
    expect(savedMatchFor('https://example.com/recipes/other', find)).toBeUndefined()
  })

  it('tolerates whitespace from a paste', () => {
    expect(savedMatchFor(`  https://youtu.be/${ID}\n`, find)).toBeDefined()
  })

  it('never matches an unparseable URL, even one that equals a fallback key', () => {
    // A garbled string has no canonical key, so it cannot collide with a saved entry whose
    // key happens to be that lower-cased string.
    expect(canonicalUrlSourceKey('not a url')).toBeNull()
    expect(savedMatchFor('not a url', findIn('url:not a url'))).toBeUndefined()
    expect(savedMatchFor('', findIn('url:'))).toBeUndefined()
  })
})

describe('submitPlan', () => {
  const find = findIn(`youtube:${ID}`)

  it('returns duplicate, with no instant header, for a saved URL', () => {
    const plan = submitPlan(`https://youtu.be/${ID}`, { findSaved: find })
    expect(plan.kind).toBe('duplicate')
    expect('instant' in plan).toBe(false)
  })

  it('returns import, with the instant header, when skipDuplicateCheck is set', () => {
    const plan = submitPlan(`https://youtu.be/${ID}`, { findSaved: find, skipDuplicateCheck: true })
    expect(plan.kind).toBe('import')
    if (plan.kind === 'import') expect(plan.instant?.thumbnailUrl).toContain(ID)
  })

  it('returns import for an unsaved URL, and for no library at all', () => {
    expect(submitPlan('https://youtu.be/other', { findSaved: find }).kind).toBe('import')
    expect(submitPlan(`https://youtu.be/${ID}`, {}).kind).toBe('import')
  })

  it('returns import with no instant header for a non-YouTube URL', () => {
    const plan = submitPlan('https://example.com/recipes/dal', { findSaved: find })
    expect(plan).toEqual({ kind: 'import', instant: null })
  })
})

/** Records every effect of a submit, in order. */
function recorder() {
  const log: string[] = []
  const io: SubmitIO = {
    begin: (instant) => void log.push(instant ? 'begin:instant' : 'begin'),
    fetchOEmbed: async () => {
      log.push('oembed')
      return null
    },
    onTitle: () => void log.push('title'),
    startImport: async () => {
      log.push('startImport')
      return { job_id: 'j1' }
    },
    onStarted: (id) => void log.push(`started:${id}`),
    onStartFailed: () => void log.push('startFailed'),
    onDuplicate: (s) => void log.push(`duplicate:${s.id}`),
  }
  return { log, io }
}

describe('runSubmit order', () => {
  it('a duplicate shows no draft, fetches nothing and starts nothing', async () => {
    const { log, io } = recorder()
    runSubmit(`https://youtu.be/${ID}`, { findSaved: findIn(`youtube:${ID}`) }, io)
    await Promise.resolve()
    // `begin` is where the instant header and the polling phase are set: never called, so
    // the phase sequence is empty and the draft screen never flashes.
    expect(log).toEqual(['duplicate:saved-1'])
    expect(log).not.toContain('startImport')
    expect(log).not.toContain('oembed')
  })

  it('with skipDuplicateCheck the same URL runs: header first, then the network', async () => {
    const { log, io } = recorder()
    runSubmit(
      `https://youtu.be/${ID}`,
      { findSaved: findIn(`youtube:${ID}`), skipDuplicateCheck: true },
      io,
    )
    await new Promise((r) => setTimeout(r, 0))
    expect(log.slice(0, 3)).toEqual(['begin:instant', 'oembed', 'startImport'])
    expect(log).toContain('started:j1')
    expect(log).not.toContain('duplicate:saved-1')
  })

  it('an unsaved non-YouTube URL begins without an instant header and does not call oEmbed', async () => {
    const { log, io } = recorder()
    runSubmit('https://example.com/recipes/dal', { findSaved: findIn() }, io)
    await new Promise((r) => setTimeout(r, 0))
    expect(log).toEqual(['begin', 'startImport', 'started:j1'])
  })

  it('reports a failed start', async () => {
    const { log, io } = recorder()
    io.startImport = async () => {
      throw new Error('down')
    }
    runSubmit('https://example.com/r', {}, io)
    await new Promise((r) => setTimeout(r, 0))
    expect(log).toEqual(['begin', 'startFailed'])
  })
})
