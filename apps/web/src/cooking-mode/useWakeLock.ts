import { useEffect, useState } from 'react'

import { createWakeLockController, type WakeLockController } from './wakeLock'

/**
 * M3.4 CP2 Item 1 — binds `wakeLock.ts`'s pure controller to the real
 * `navigator.wakeLock`. Not unit-tested: hook rendering needs jsdom/
 * `@testing-library/react`, which this repo does not add (same limitation and
 * rationale as `cooking/useSession.ts`). Verified by hand on a phone over a secure
 * origin — `navigator.wakeLock` is `undefined` on an insecure origin, which the feature
 * detection below turns into a permanent no-op, per CP2's "silent no-op" rule.
 *
 * Owns its own `visibilitychange` listener rather than extending
 * `CookingModeScreen`'s tick effect — self-contained and independently removable.
 */
export function useWakeLock(shouldHold: boolean): void {
  const [controller] = useState<WakeLockController>(() => {
    const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator
    return createWakeLockController(supported ? () => navigator.wakeLock.request('screen') : undefined)
  })

  useEffect(() => {
    if (shouldHold) controller.hold()
    else controller.stop()
  }, [controller, shouldHold])

  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        // The browser already released the sentinel on its own — just drop the local
        // reference so nothing stale is held.
        controller.drop()
      } else if (shouldHold) {
        controller.hold()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [controller, shouldHold])

  useEffect(() => {
    return () => controller.stop()
  }, [controller])
}
