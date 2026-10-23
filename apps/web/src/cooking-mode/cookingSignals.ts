import { createWakeLockController, type WakeLockController } from './wakeLock'

/**
 * PR 2 CP1 — the `cookingSignals` seam: one small interface for everything Cooking Mode
 * does *outside* the screen (keep it awake, beep, buzz, tell the UI a timer ended, a live
 * timer on platforms that have one). Not wired to any screen yet; `useWakeLock` is
 * unchanged. Same discipline as `wakeLock.ts`: imports nothing from `@/cooking/`, never
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
    gain: { value: number }
    connect(destination: object): unknown
  }
}

/** The subset of `EventTarget` the audio unlock needs — real `document` satisfies it. */
export interface EventTargetLike {
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

/** Browsers only let audio start from a user gesture, so the first tap or key press
 * creates and resumes the `AudioContext`. */
const UNLOCK_EVENTS = ['pointerdown', 'keydown'] as const

const BEEP_HZ = 880
const BEEP_GAIN = 0.2
const BEEP_SECONDS = 0.3

export function createWebCookingSignals(deps: {
  wakeLock: WakeLockController
  /** Absent: `playSound` is a no-op. */
  createAudioContext?: () => AudioContextLike
  /** Only passed when `navigator.vibrate` exists. */
  vibrate?: (pattern: number | number[]) => boolean
  /** The first `pointerdown`/`keydown` here creates and resumes the `AudioContext`. */
  unlockTarget?: EventTargetLike
}): WebCookingSignals {
  const listeners = new Set<(notice: CookingNotice) => void>()
  let audio: AudioContextLike | null = null

  function removeUnlock(): void {
    for (const type of UNLOCK_EVENTS) deps.unlockTarget?.removeEventListener(type, unlock)
  }

  function unlock(): void {
    removeUnlock()
    if (audio != null || deps.createAudioContext == null) return
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
      try {
        const oscillator = audio.createOscillator()
        const gain = audio.createGain()
        oscillator.type = 'sine'
        oscillator.frequency.value = BEEP_HZ
        gain.gain.value = BEEP_GAIN
        oscillator.connect(gain)
        gain.connect(audio.destination)
        const at = audio.currentTime
        oscillator.start(at)
        oscillator.stop(at + BEEP_SECONDS)
      } catch {
        // Audio failures are silent no-ops, like the wake lock's.
      }
    },

    vibrate(pattern) {
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
    ...(typeof document !== 'undefined' ? { unlockTarget: document } : {}),
  })
}
