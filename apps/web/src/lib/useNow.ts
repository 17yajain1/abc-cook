import { useEffect, useState } from 'react'

/**
 * The current time, refreshed every minute and when the tab comes back to the front (a phone that slept
 * with the page open shows the right time the moment it wakes). `frozen` pins it, for tests and screenshots.
 */
export function useNow(frozen?: Date): Date {
  const [now, setNow] = useState<Date>(() => frozen ?? new Date())
  useEffect(() => {
    if (frozen) return
    const tick = () => setNow(new Date())
    const id = setInterval(tick, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [frozen])
  return frozen ?? now
}
