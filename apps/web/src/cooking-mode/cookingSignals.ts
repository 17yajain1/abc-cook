import { createWakeLockController, type WakeLockController } from './wakeLock'

/**
 * PR 2 CP1 — the `cookingSignals` seam: one small interface for everything Cooking Mode
 * does *outside* the screen (keep it awake, beep, buzz, tell the UI a timer ended, a live
 * timer on platforms that have one). PR 2 CP4 wires the sound, the vibration and `notify`
 * to timer ends (`signals.ts`, `timerEndSignals.ts`); `useWakeLock` is unchanged. Same
 * discipline as `wakeLock.ts`: imports nothing from `@/cooking/`, never
 * calls `Date.now()`, and every browser surface is injected, so it is testable under this
 * repo's `environment: 'node'` vitest setup. `webCookingSignals()` is the only function
 * that touches `navigator`/`document`/`AudioContext`.
 */

/** A timer reached its end. `endsAt` is the absolute wall-clock end the session stores. */
export interface CookingNotice {
  kind: 'timerEnded'
  nodeId: string
  endsAt: number
}

/** The timer a platform live-activity would show. */
export interface LiveTimer {
  nodeId: string
  label: string
  endsAt: number
}

export interface CookingSignals {
  keepAwake(on: boolean): void
  playSound(sound: 'timerEnd'): void
  vibrate(pattern: number | number[]): void
  notify(notice: CookingNotice): void
  liveTimer(timer: LiveTimer | null): void
}

export interface WebCookingSignals extends CookingSignals {
  /** The in-app event CP4's banner will listen to. Returns the unsubscribe. */
  onNotify(listener: (notice: CookingNotice) => void): () => void
  dispose(): void
}

/** The subset of Web Audio `playSound` uses — real `AudioContext` satisfies it. */
export interface AudioContextLike {
  /** iOS suspends the context when the page is backgrounded; a tap resumes it. */
  readonly state?: AudioContextState
  readonly currentTime: number
  readonly destination: object
  resume(): Promise<void>
  createOscillator(): {
    type: OscillatorType
    frequency: { value: number }
    connect(destination: object): unknown
    start(when?: number): void
    stop(when?: number): void
  }
  createGain(): {
    gain: {
      value: number
      setValueAtTime(value: number, time: number): unknown
      linearRampToValueAtTime(value: number, time: number): unknown
      exponentialRampToValueAtTime(value: number, time: number): unknown
    }
    connect(destination: object): unknown
  }
}

/** The subset of `EventTarget` the audio unlock needs — real `document` satisfies it. */
export interface EventTargetLike {
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

/** Browsers only let audio start from a user gesture, so the first tap or key press
 * creates and resumes the `AudioContext`. iOS counts `touchend`/`click` as a gesture but
 * not always `pointerdown`, so all four are heard (PR 2 CP4). */
const UNLOCK_EVENTS = ['pointerdown', 'touchend', 'click', 'keydown'] as const

/** PR 2 CP4: the timer-end chime, synthesised (₹0, no file): two notes, 880 Hz then 660 Hz,
 * a triangle wave, 0.18 s each, a 10 ms fade in and an exponential fade out (no clicks),
 * played three times, 0.6 s apart (about 1.8 s in all). */
const CHIME_HZ = [880, 660] as const
const NOTE_SECONDS = 0.18
const REPEATS = 3
const REPEAT_SECONDS = 0.6
const FADE_IN_SECONDS = 0.01
const CHIME_GAIN = 0.3
/** Exponential ramps can't reach 0. */
const SILENT = 0.0001

export function createWebCookingSignals(deps: {
  wakeLock: WakeLockController
  /** Absent: `playSound` is a no-op. */
  createAudioContext?: () => AudioContextLike
  /** Only passed when `navigator.vibrate` exists. */
  vibrate?: (pattern: number | number[]) => boolean
  /** Whether the page has had a tap yet (`navigator.userActivation.hasBeenActive`). Before
   * one, Chrome blocks `vibrate` and logs an error, so the call is skipped. Absent: always try. */
  hasUserActivation?: () => boolean
  /** The first tap or key press here creates and resumes the `AudioContext`; every later one
   * resumes it again if the browser suspended it. */
  unlockTarget?: EventTargetLike
}): WebCookingSignals {
  const listeners = new Set<(notice: CookingNotice) => void>()
  let audio: AudioContextLike | null = null

  function removeUnlock(): void {
    for (const type of UNLOCK_EVENTS) deps.unlockTarget?.removeEventListener(type, unlock)
  }

  function resumeIfSuspended(ctx: AudioContextLike): void {
    if (ctx.state !== 'suspended') return
    void ctx.resume().catch(() => {})
  }

  // Stays on after the first gesture: iOS suspends the context when the page is
  // backgrounded, and only the next gesture may resume it.
  function unlock(): void {
    if (audio != null) {
      resumeIfSuspended(audio)
      return
    }
    if (deps.createAudioContext == null) return
    try {
      audio = deps.createAudioContext()
      void audio.resume().catch(() => {})
    } catch {
      // No audio on this device: playSound stays a silent no-op.
      audio = null
    }
  }

  if (deps.createAudioContext != null) {
    for (const type of UNLOCK_EVENTS) deps.unlockTarget?.addEventListener(type, unlock)
  }

  return {
    keepAwake(on) {
      if (on) deps.wakeLock.hold()
      else deps.wakeLock.stop()
    },

    // Before the unlock gesture there is no context, so this is silent (a web limit).
    playSound() {
      if (audio == null) return
      resumeIfSuspended(audio)
      try {
        const start = audio.currentTime
        for (let r = 0; r < REPEATS; r++) {
          CHIME_HZ.forEach((hz, i) => {
            const at = start + r * REPEAT_SECONDS + i * NOTE_SECONDS
            const oscillator = audio!.createOscillator()
            const gain = audio!.createGain()
            oscillator.type = 'triangle'
            oscillator.frequency.value = hz
            gain.gain.setValueAtTime(SILENT, at)
            gain.gain.linearRampToValueAtTime(CHIME_GAIN, at + FADE_IN_SECONDS)
            gain.gain.exponentialRampToValueAtTime(SILENT, at + NOTE_SECONDS)
            oscillator.connect(gain)
            gain.connect(audio!.destination)
            oscillator.start(at)
            oscillator.stop(at + NOTE_SECONDS)
          })
        }
      } catch {
        // Audio failures are silent no-ops, like the wake lock's.
      }
    },

    vibrate(pattern) {
      if (deps.hasUserActivation?.() === false) return
      deps.vibrate?.(pattern)
    },

    notify(notice) {
      for (const listener of [...listeners]) listener(notice)
    },

    // The web has no live timer surface.
    liveTimer() {},

    onNotify(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    dispose() {
      removeUnlock()
    },
  }
}

/** Binds the real `navigator.wakeLock`, `AudioContext`, `navigator.vibrate` and
 * `document`, each feature-detected; anything missing becomes a silent no-op. */
export function webCookingSignals(): WebCookingSignals {
  const hasNavigator = typeof navigator !== 'undefined'
  const wakeLockSupported = hasNavigator && 'wakeLock' in navigator
  const canVibrate = hasNavigator && typeof navigator.vibrate === 'function'
  return createWebCookingSignals({
    wakeLock: createWakeLockController(wakeLockSupported ? () => navigator.wakeLock.request('screen') : undefined),
    ...(typeof AudioContext !== 'undefined' ? { createAudioContext: () => new AudioContext() } : {}),
    ...(canVibrate ? { vibrate: (pattern: number | number[]) => navigator.vibrate(pattern) } : {}),
    ...(hasNavigator && navigator.userActivation != null
      ? { hasUserActivation: () => navigator.userActivation.hasBeenActive }
      : {}),
    ...(typeof document !== 'undefined' ? { unlockTarget: document } : {}),
  })
}
