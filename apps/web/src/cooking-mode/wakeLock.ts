import type { ScreenId } from './viewModel'

/**
 * M3.4 CP2 Item 1 (`notes/m3.4-cp2-plan.md` § Item 1) — pure wake-lock decisions and an
 * injectable controller, both testable under this repo's `environment: 'node'` vitest
 * setup (no jsdom, no `navigator` mock). Imports nothing from `@/cooking/` and never
 * calls `Date.now()` — timing stays entirely with the caller's `now` tick.
 */

/**
 * Screen state -> hold or release (CP2 plan's decided table): `task`,
 * `handsoff_pending`, `wait` and `handover` hold; everything else releases. An
 * exhaustive `switch` with no `default` — adding a `ScreenId` without deciding its
 * wake-lock behaviour fails the type-check (TS2366) rather than silently defaulting.
 */
export function shouldHoldWakeLock(screenId: ScreenId): boolean {
  switch (screenId) {
    case 'task':
    case 'handsoff_pending':
    case 'wait':
    case 'handover':
      return true
    case 'entry':
    case 'long_wait':
    case 'leaving':
    case 'returning':
    case 'sitting_break':
    case 'sitting_resume':
    case 'stale':
    case 'conflict':
    case 'done':
      return false
  }
}

/** The minimal surface `useWakeLock` needs from a real `WakeLockSentinel` — an
 * injectable seam so `wakeLock.ts` never touches `navigator` itself. */
export interface WakeLockSentinelLike {
  release(): Promise<void>
  addEventListener(type: 'release', listener: () => void): void
}

export interface WakeLockController {
  /** Ask to hold. A no-op if already holding, already requesting, or no `request` was
   * injected (unsupported browser / insecure origin). */
  hold: () => void
  /** Ask to stop holding. Releases the current sentinel, if any. */
  stop: () => void
  /** The browser already released the sentinel on its own (a `visibilitychange` to
   * `hidden`, or the sentinel's own `release` event) — drop the local reference without
   * calling `release()` again. */
  drop: () => void
}

/**
 * Drives one `WakeLockSentinel` lifecycle from an injected `request` (CP2 plan §
 * Lifecycle). `request` is omitted entirely when `'wakeLock' in navigator` is false —
 * every method below then becomes a silent no-op, per CP2's "every failure is a silent
 * no-op" rule. Handles the async request race explicitly (§ Lifecycle "race to handle
 * explicitly"): a sentinel that resolves after `stop()` was already called is released
 * immediately, never stored.
 */
export function createWakeLockController(request?: () => Promise<WakeLockSentinelLike>): WakeLockController {
  let sentinel: WakeLockSentinelLike | null = null
  let holding = false
  let requesting = false

  function hold(): void {
    holding = true
    if (sentinel != null || requesting || request == null) return
    requesting = true
    request()
      .then((s) => {
        requesting = false
        if (!holding) {
          void s.release().catch(() => {})
          return
        }
        s.addEventListener('release', () => {
          sentinel = null
        })
        sentinel = s
      })
      .catch(() => {
        requesting = false
      })
  }

  function stop(): void {
    holding = false
    if (sentinel == null) return
    const s = sentinel
    sentinel = null
    void s.release().catch(() => {})
  }

  function drop(): void {
    sentinel = null
  }

  return { hold, stop, drop }
}
