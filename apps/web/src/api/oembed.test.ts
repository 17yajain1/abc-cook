import { describe, expect, it } from 'vitest'

import { fetchOEmbed, parseOEmbed } from './oembed'

const URL_ = 'https://www.youtube.com/oembed?url=x&format=json'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status })
}

describe('parseOEmbed', () => {
  it('reads title and author_name', () => {
    expect(parseOEmbed({ title: ' Kadhi Pakora ', author_name: 'Some Kitchen' })).toEqual({
      title: 'Kadhi Pakora',
      channel: 'Some Kitchen',
    })
  })

  it('treats a missing or blank author as no channel', () => {
    expect(parseOEmbed({ title: 'T' })).toEqual({ title: 'T', channel: null })
    expect(parseOEmbed({ title: 'T', author_name: '  ' })).toEqual({ title: 'T', channel: null })
  })

  it.each([null, 'text', 42, {}, { title: '' }, { title: 7 }])('rejects %j', (body) => {
    expect(parseOEmbed(body)).toBeNull()
  })
})

describe('fetchOEmbed', () => {
  it('returns the parsed body on 200', async () => {
    const fake = (async () => jsonResponse(200, { title: 'T', author_name: 'C' })) as typeof fetch
    expect(await fetchOEmbed(URL_, undefined, fake)).toEqual({ title: 'T', channel: 'C' })
  })

  it.each([401, 400, 404, 500])('returns null on HTTP %i', async (status) => {
    const fake = (async () => jsonResponse(status, { error: 'nope' })) as typeof fetch
    expect(await fetchOEmbed(URL_, undefined, fake)).toBeNull()
  })

  it('returns null when the body is not JSON', async () => {
    const fake = (async () => new Response('<html>', { status: 200 })) as typeof fetch
    expect(await fetchOEmbed(URL_, undefined, fake)).toBeNull()
  })

  it('returns null when the network fails', async () => {
    const fake = (async () => {
      throw new TypeError('Failed to fetch')
    }) as typeof fetch
    expect(await fetchOEmbed(URL_, undefined, fake)).toBeNull()
  })

  it('returns null when the caller aborts', async () => {
    const outer = new AbortController()
    const fake = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))
      })) as typeof fetch
    const pending = fetchOEmbed(URL_, outer.signal, fake)
    outer.abort()
    expect(await pending).toBeNull()
  })

  it('gives up after 2.5 s', async () => {
    const fake = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')))
      })) as typeof fetch
    const started = Date.now()
    expect(await fetchOEmbed(URL_, undefined, fake)).toBeNull()
    const elapsed = Date.now() - started
    expect(elapsed).toBeGreaterThanOrEqual(2400)
    expect(elapsed).toBeLessThan(4000)
  })
})
