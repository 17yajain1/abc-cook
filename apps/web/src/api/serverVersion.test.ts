import { describe, expect, it, vi } from 'vitest'

import type { ServerInfo } from '@abc-cook/schema'

import { createServerVersion } from './serverVersion'

const info = (v: number): ServerInfo => ({ status: 'ok', version: '0.0.0', postprocess_version: v })

describe('createServerVersion', () => {
  it('is lazy: nothing is fetched until the first get()', () => {
    const fetchInfo = vi.fn().mockResolvedValue(info(9))
    createServerVersion(fetchInfo)
    expect(fetchInfo).not.toHaveBeenCalled()
  })

  it('fetches once and memoises a success', async () => {
    const fetchInfo = vi.fn().mockResolvedValue(info(9))
    const sv = createServerVersion(fetchInfo)
    expect(await sv.get()).toBe(9)
    expect(await sv.get()).toBe(9)
    expect(fetchInfo).toHaveBeenCalledTimes(1)
  })

  it('does not memoise a failure: returns null and retries on the next call', async () => {
    const fetchInfo = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(info(9))
    const sv = createServerVersion(fetchInfo)
    expect(await sv.get()).toBeNull()
    expect(await sv.get()).toBe(9)
    expect(fetchInfo).toHaveBeenCalledTimes(2)
  })

  it('a malformed response (no integer stamp) is a failure, not a version', async () => {
    const fetchInfo = vi.fn().mockResolvedValue({ status: 'ok' })
    const sv = createServerVersion(fetchInfo)
    expect(await sv.get()).toBeNull()
  })

  it('note() sets the memo so get() does not fetch', async () => {
    const fetchInfo = vi.fn().mockResolvedValue(info(9))
    const sv = createServerVersion(fetchInfo)
    sv.note(10)
    expect(await sv.get()).toBe(10)
    expect(fetchInfo).not.toHaveBeenCalled()
  })

  it('note() overrides an earlier memo', async () => {
    const sv = createServerVersion(vi.fn().mockResolvedValue(info(9)))
    await sv.get()
    sv.note(11)
    expect(await sv.get()).toBe(11)
  })

  it('an abort resolves to null and is not memoised', async () => {
    const controller = new AbortController()
    const fetchInfo = vi.fn((signal?: AbortSignal) =>
      signal?.aborted
        ? Promise.reject(new Error('aborted'))
        : new Promise<ServerInfo>((_, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    )
    const sv = createServerVersion(fetchInfo)
    const pending = sv.get(controller.signal)
    controller.abort()
    expect(await pending).toBeNull()

    fetchInfo.mockResolvedValueOnce(info(9))
    expect(await sv.get()).toBe(9)
  })

  it('passes the signal through to the fetcher', async () => {
    const fetchInfo = vi.fn().mockResolvedValue(info(9))
    const controller = new AbortController()
    await createServerVersion(fetchInfo).get(controller.signal)
    expect(fetchInfo).toHaveBeenCalledWith(controller.signal)
  })
})
