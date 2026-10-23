import { describe, expect, it, vi, type Mock } from 'vitest'

import { createWebCookingSignals, type AudioContextLike, type CookingNotice, type EventTargetLike } from './cookingSignals'
import type { WakeLockController } from './wakeLock'

/**
 * PR 2 CP1 — `cookingSignals.ts` under the node environment: every browser surface is a
 * fake passed straight to `createWebCookingSignals`, same approach as `wakeLock.test.ts`.
 */

function fakeWakeLock(): WakeLockController & { hold: Mock<() => void>; stop: Mock<() => void> } {
  return { hold: vi.fn<() => void>(), stop: vi.fn<() => void>(), drop: vi.fn<() => void>() }
}

class FakeTarget implements EventTargetLike {
  listeners = new Map<string, Set<() => void>>()

  addEventListener(type: string, listener: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(listener)
  }

  removeEventListener(type: string, listener: () => void): void {
    this.listeners.get(type)?.delete(listener)
  }

  fire(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener()
  }

  count(): number {
    let n = 0
    for (const set of this.listeners.values()) n += set.size
    return n
  }
}

function fakeAudio() {
  const started: number[] = []
  const resume = vi.fn(() => Promise.resolve())
  const ctx: AudioContextLike = {
    currentTime: 5,
    destination: {},
    resume,
    createOscillator: () => ({
      type: 'sine',
      frequency: { value: 0 },
      connect: () => undefined,
      start: (when?: number) => {
        started.push(when ?? 0)
      },
      stop: () => undefined,
    }),
    createGain: () => ({ gain: { value: 1 }, connect: () => undefined }),
  }
  const create = vi.fn(() => ctx)
  return { create, resume, started }
}

describe('cookingSignals — keepAwake', () => {
  it('delegates to the existing wake lock controller', () => {
    const wakeLock = fakeWakeLock()
    const signals = createWebCookingSignals({ wakeLock })
    signals.keepAwake(true)
    expect(wakeLock.hold).toHaveBeenCalledTimes(1)
    signals.keepAwake(false)
    expect(wakeLock.stop).toHaveBeenCalledTimes(1)
  })
})

describe('cookingSignals — playSound', () => {
  it('is silent before the first tap, and plays after it', () => {
    const audio = fakeAudio()
    const target = new FakeTarget()
    const signals = createWebCookingSignals({ wakeLock: fakeWakeLock(), createAudioContext: audio.create, unlockTarget: target })

    signals.playSound('timerEnd')
    expect(audio.create).not.toHaveBeenCalled()
    expect(audio.started).toEqual([])

    target.fire('pointerdown')
    expect(audio.create).toHaveBeenCalledTimes(1)
    expect(audio.resume).toHaveBeenCalledTimes(1)
    expect(target.count()).toBe(0)

    signals.playSound('timerEnd')
    expect(audio.started).toEqual([5])
  })

  it('a keydown unlocks too, and a second gesture creates no second context', () => {
    const audio = fakeAudio()
    const target = new FakeTarget()
    createWebCookingSignals({ wakeLock: fakeWakeLock(), createAudioContext: audio.create, unlockTarget: target })
    target.fire('keydown')
    target.fire('pointerdown')
    expect(audio.create).toHaveBeenCalledTimes(1)
  })

  it('is a no-op without an audio context factory', () => {
    const target = new FakeTarget()
    const signals = createWebCookingSignals({ wakeLock: fakeWakeLock(), unlockTarget: target })
    expect(target.count()).toBe(0)
    expect(() => signals.playSound('timerEnd')).not.toThrow()
  })
})

describe('cookingSignals — vibrate', () => {
  it('calls the injected vibrate only', () => {
    const vibrate = vi.fn(() => true)
    createWebCookingSignals({ wakeLock: fakeWakeLock(), vibrate }).vibrate([200, 100, 200])
    expect(vibrate).toHaveBeenCalledWith([200, 100, 200])
  })

  it('is a no-op when vibrate is not injected', () => {
    expect(() => createWebCookingSignals({ wakeLock: fakeWakeLock() }).vibrate(200)).not.toThrow()
  })
})

describe('cookingSignals — notify', () => {
  it('reaches every subscriber; unsubscribe stops delivery', () => {
    const signals = createWebCookingSignals({ wakeLock: fakeWakeLock() })
    const a: CookingNotice[] = []
    const b: CookingNotice[] = []
    const offA = signals.onNotify((n) => a.push(n))
    signals.onNotify((n) => b.push(n))

    const notice: CookingNotice = { kind: 'timerEnded', nodeId: 'boil_water', endsAt: 1_700_000_000_000 }
    signals.notify(notice)
    expect(a).toEqual([notice])
    expect(b).toEqual([notice])

    offA()
    signals.notify(notice)
    expect(a).toEqual([notice])
    expect(b).toEqual([notice, notice])
  })
})

describe('cookingSignals — liveTimer and dispose', () => {
  it('liveTimer is a no-op on the web', () => {
    const wakeLock = fakeWakeLock()
    const vibrate = vi.fn(() => true)
    const signals = createWebCookingSignals({ wakeLock, vibrate })
    const heard: CookingNotice[] = []
    signals.onNotify((n) => heard.push(n))

    expect(() => signals.liveTimer({ nodeId: 'boil_water', label: 'Boil water', endsAt: 1 })).not.toThrow()
    expect(() => signals.liveTimer(null)).not.toThrow()
    expect(wakeLock.hold).not.toHaveBeenCalled()
    expect(vibrate).not.toHaveBeenCalled()
    expect(heard).toEqual([])
  })

  it('dispose removes the unlock listeners', () => {
    const audio = fakeAudio()
    const target = new FakeTarget()
    const signals = createWebCookingSignals({ wakeLock: fakeWakeLock(), createAudioContext: audio.create, unlockTarget: target })
    expect(target.count()).toBe(2)

    signals.dispose()
    expect(target.count()).toBe(0)
    target.fire('pointerdown')
    expect(audio.create).not.toHaveBeenCalled()
  })
})
