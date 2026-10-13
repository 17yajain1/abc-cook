import { useEffect } from 'react'

/**
 * Marks the page behind the app as a Home-register surface (`home/tokens.css`) while
 * `active`, so the safe-area strip, the phone-width `body` and over-scroll show the Home
 * ground rather than the Plan's paper. Cleared on unmount or when `active` goes false.
 */
export function useHomeSurface(active: boolean): void {
  useEffect(() => {
    if (!active) return
    document.documentElement.dataset.surface = 'home'
    return () => {
      delete document.documentElement.dataset.surface
    }
  }, [active])
}
