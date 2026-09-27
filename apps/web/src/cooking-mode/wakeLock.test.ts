import { describe, expect, it, vi } from 'vitest'

import type { ScreenId } from './viewModel'
import { createWakeLockController, shouldHoldWakeLock, type WakeLockSentinelLike } from './wakeLock'

/**
 * M3.4 CP2 Item 1 (`notes/m3.4-cp2-plan.md` § Tests, tests 1-10) — pure decisions and
 * the injectable controller, both run under this repo's `environment: 'node'` vitest
 * setup. No jsdom, no `navigator` mock: `navigator.wakeLock.request` is stood in for by
 * a fake `request` function passed straight to `createWakeLockController`.
 */

describe('shouldHoldWakeLock', () => {
  it('is exhaustive over every ScreenId — a Record literal fails to type-check if a case is missing', () => {
    const table: Record<ScreenId, boolean> = {
      task: true,
      handsoff_pending: true,
      wait: true,
      handover: true,
      entry: false,
      long_wait: false,
      leaving: false,
      returning: false,
      sitting_break: false,
      sitting_resume: false,
      stale: false,
      conflict: false,
      done: false,
    }
    for (const [screenId, expected] of Object.entries(table) as [ScreenId, boolean][]) {
      expect(shouldHoldWakeLock(screenId)).toBe(expected)
    }
  })

  it('holds on the four active-cooking screens', () => {
    expect(shouldHoldWakeLock('task')).toBe(true)
    expect(shouldHoldWakeLock('handsoff_pending')).toBe(true)
    expect(shouldHoldWakeLock('wait')).toBe(true)
    expect(shouldHoldWakeLock('handover')).toBe(true)
  })

  it('releases on every away, terminal and pre-cook screen', () => {
    const releasing: ScreenId[] = [
      'entry',
      'long_wait',
      'leaving',
      'returning',
      'sitting_break',
      'sitting_resume',
      'stale',
      'conflict',
      'done',
    ]
    for (const id of releasing) expect(shouldHoldWakeLock(id)).toBe(false)
  })

  it('releases on long_wait and sitting_break — regression guard for the two explicit owner decisions', () => {
    expect(shouldHoldWakeLock('long_wait')).toBe(false)
    expect(shouldHoldWakeLock('sitting_break')).toBe(false)
  })
})

function fakeSentinel(): WakeLockSentinelLike & { releaseCalls: number; fireRelease: () => void } {
  let releaseListener: (() => void) | null = null
  return {
    releaseCalls: 0,
    release(): Promise<void> {
      this.releaseCalls++
      return Promise.resolve()
    },
    addEventListener(_type, listener) {
      releaseListener = listener
    },
    fireRelease() {
      releaseListener?.()
    },
  }
}

describe('wake lock controller', () => {
  it('requests once when asked to hold; does not re-request while already holding', async () => {
    const sentinel = fakeSentinel()
    const request = vi.fn().mockResolvedValue(sentinel)
    const controller = createWakeLockController(request)

    controller.hold()
    controller.hold()
    await Promise.resolve()
    await Promise.resolve()
    controller.hold()

    expect(request).toHaveBeenCalledTimes(1)
  })

  it('releases the sentinel when asked to stop holding', async () => {
    const sentinel = fakeSentinel()
    const request = vi.fn().mockResolvedValue(sentinel)
    const controller = createWakeLockController(request)

    controller.hold()
    await Promise.resolve()
    await Promise.resolve()
    controller.stop()

    expect(sentinel.releaseCalls).toBe(1)
  })

  it('re-acquires after a simulated hide->show (the browser automatically releasing it)', async () => {
    const sentinelA = fakeSentinel()
    const sentinelB = fakeSentinel()
    const request = vi.fn().mockResolvedValueOnce(sentinelA).mockResolvedValueOnce(sentinelB)
    const controller = createWakeLockController(request)

    controller.hold()
    await Promise.resolve()
    await Promise.resolve()
    expect(request).toHaveBeenCalledTimes(1)

    // Hidden: the browser released it on its own; the caller drops the local reference.
    controller.drop()
    // Visible again, still wanting to hold: the caller asks again.
    controller.hold()
    await Promise.resolve()
    await Promise.resolve()

    expect(request).toHaveBeenCalledTimes(2)
  })

  it('swallows a rejected request() — no throw, no sentinel retained', async () => {
    const request = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    const controller = createWakeLockController(request)

    expect(() => controller.hold()).not.toThrow()
    await Promise.resolve()
    await Promise.resolve()

    // Nothing was retained: asking to hold again issues a fresh request rather than
    // treating a (nonexistent) sentinel as already held.
    controller.hold()
    await Promise.resolve()
    await Promise.resolve()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('the in-flight race: a request() that resolves after being told to stop releases immediately, never stores it', async () => {
    const sentinel = fakeSentinel()
    let resolveRequest: (s: WakeLockSentinelLike) => void = () => {}
    const request = vi.fn().mockReturnValue(new Promise<WakeLockSentinelLike>((resolve) => (resolveRequest = resolve)))
    const controller = createWakeLockController(request)

    controller.hold()
    controller.stop() // flips the intent before the request resolves
    resolveRequest(sentinel)
    await Promise.resolve()
    await Promise.resolve()

    expect(sentinel.releaseCalls).toBe(1)

    // Asking to hold again issues a fresh request — the raced sentinel was never stored.
    const sentinel2 = fakeSentinel()
    request.mockResolvedValueOnce(sentinel2)
    controller.hold()
    await Promise.resolve()
    await Promise.resolve()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('is a no-op when no request is injected (unsupported browser / insecure origin)', () => {
    const controller = createWakeLockController(undefined)
    expect(() => {
      controller.hold()
      controller.stop()
      controller.drop()
    }).not.toThrow()
  })

  it('clears the local reference when the sentinel fires its own release event', async () => {
    const sentinelA = fakeSentinel()
    const sentinelB = fakeSentinel()
    const request = vi.fn().mockResolvedValueOnce(sentinelA).mockResolvedValueOnce(sentinelB)
    const controller = createWakeLockController(request)

    controller.hold()
    await Promise.resolve()
    await Promise.resolve()

    sentinelA.fireRelease() // the OS/browser released it for a reason we did not trigger
    controller.hold() // still wanting to hold: must request again, not assume it's held
    await Promise.resolve()
    await Promise.resolve()

    expect(request).toHaveBeenCalledTimes(2)
  })
})
