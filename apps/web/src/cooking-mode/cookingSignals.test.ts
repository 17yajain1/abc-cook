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
  const stopped: number[] = []
  const notes: Array<{ type: string; hz: number }> = []
  const ramps: Array<[string, number, number]> = []
  const ctx: AudioContextLike & { state: AudioContextState } = {
    state: 'running',
    currentTime: 5,
    destination: {},
    resume: () => Promise.resolve(),
    createOscillator: () => {
      const osc = {
        type: 'sine' as OscillatorType,
        frequency: { value: 0 },
        connect: () => undefined,
        start: (when?: number) => {
          started.push(when ?? 0)
          notes.push({ type: osc.type, hz: osc.frequency.value })
        },
        stop: (when?: number) => {
          stopped.push(when ?? 0)
        },
      }
      return osc
    },
    createGain: () => ({
      gain: {
        value: 1,
        setValueAtTime: (v: number, t: number) => ramps.push(['set', v, t]),
        linearRampToValueAtTime: (v: number, t: number) => ramps.push(['linear', v, t]),
        exponentialRampToValueAtTime: (v: number, t: number) => ramps.push(['exp', v, t]),
      },
      connect: () => undefined,
    }),
  }
  const resume = vi.fn(() => {
    ctx.state = 'running'
    return Promise.resolve()
  })
  ctx.resume = resume
  const create = vi.fn(() => ctx)
  return { create, resume, started, stopped, notes, ramps, ctx }
}

const round = (xs: number[]) => xs.map((x) => Math.round(x * 100) / 100)

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

    signals.playSound('timerEnd')
    expect(audio.started.length).toBeGreaterThan(0)
  })

  it('a keydown, touchend or click unlocks too, and a second gesture creates no second context', () => {
    for (const type of ['keydown', 'touchend', 'click']) {
      const audio = fakeAudio()
      const target = new FakeTarget()
      createWebCookingSignals({ wakeLock: fakeWakeLock(), createAudioContext: audio.create, unlockTarget: target })
      target.fire(type)
      target.fire('pointerdown')
      expect(audio.create, type).toHaveBeenCalledTimes(1)
    }
  })

  it('the listener stays on: a tap after the page was backgrounded resumes a suspended context (iOS)', () => {
    const audio = fakeAudio()
    const target = new FakeTarget()
    createWebCookingSignals({ wakeLock: fakeWakeLock(), createAudioContext: audio.create, unlockTarget: target })
    target.fire('touchend')
    expect(target.count()).toBe(4)
    target.fire('touchend') // running: nothing to do
    expect(audio.resume).toHaveBeenCalledTimes(1)
    audio.ctx.state = 'suspended'
    target.fire('click')
    expect(audio.resume).toHaveBeenCalledTimes(2)
  })

  it('playSound tries resume() first when the context is suspended', () => {
    const audio = fakeAudio()
    const target = new FakeTarget()
    const signals = createWebCookingSignals({ wakeLock: fakeWakeLock(), createAudioContext: audio.create, unlockTarget: target })
    target.fire('pointerdown')
    audio.ctx.state = 'suspended'
    signals.playSound('timerEnd')
    expect(audio.resume).toHaveBeenCalledTimes(2)
  })

  it('the chime: 880 Hz then 660 Hz, triangle, 0.18 s each, three times in about 1.8 s', () => {
    const audio = fakeAudio()
    const target = new FakeTarget()
    const signals = createWebCookingSignals({ wakeLock: fakeWakeLock(), createAudioContext: audio.create, unlockTarget: target })
    target.fire('pointerdown')
    signals.playSound('timerEnd')
    expect(audio.notes).toEqual([880, 660, 880, 660, 880, 660].map((hz) => ({ type: 'triangle', hz })))
    expect(round(audio.started)).toEqual([5, 5.18, 5.6, 5.78, 6.2, 6.38])
    expect(round(audio.stopped)).toEqual([5.18, 5.36, 5.78, 5.96, 6.38, 6.56])
    expect(audio.stopped[audio.stopped.length - 1] - 5).toBeLessThanOrEqual(1.8)
  })

  it('each note fades in over 10 ms to 0.3 and out exponentially (no clicks)', () => {
    const audio = fakeAudio()
    const target = new FakeTarget()
    const signals = createWebCookingSignals({ wakeLock: fakeWakeLock(), createAudioContext: audio.create, unlockTarget: target })
    target.fire('pointerdown')
    signals.playSound('timerEnd')
    const first = audio.ramps.slice(0, 3).map(([k, v, t]) => [k, v, Math.round(t * 1000) / 1000])
    expect(first).toEqual([
      ['set', 0.0001, 5],
      ['linear', 0.3, 5.01],
      ['exp', 0.0001, 5.18],
    ])
    expect(audio.ramps).toHaveLength(18)
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

  it('skips the call before the page has had a tap (Chrome blocks it and logs an error)', () => {
    const vibrate = vi.fn(() => true)
    let active = false
    const signals = createWebCookingSignals({ wakeLock: fakeWakeLock(), vibrate, hasUserActivation: () => active })
    signals.vibrate([300, 150, 300])
    expect(vibrate).not.toHaveBeenCalled()
    active = true
    signals.vibrate([300, 150, 300])
    expect(vibrate).toHaveBeenCalledTimes(1)
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
    expect(target.count()).toBe(4)

    signals.dispose()
    expect(target.count()).toBe(0)
    target.fire('pointerdown')
    expect(audio.create).not.toHaveBeenCalled()
  })
})
