import { useCallback, useEffect, useState } from 'react'

/** How long "Your plan is ready" stays if the cook does not scroll. */
export const READY_NOTICE_MS = 4000

/**
 * The "Your plan is ready" pill after a live import (D1). It mounts hidden and shows on the first effect,
 * so the live region it sits in already exists when its text arrives; it goes after 4 s or on the first
 * scroll the cook makes (`dismiss`). Never for a plan opened from the Cookbook (`active` false).
 */
export function useReadyNotice(active: boolean): { visible: boolean; dismiss: () => void } {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!active) return
    setVisible(true)
    const timer = window.setTimeout(() => setVisible(false), READY_NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [active])
  const dismiss = useCallback(() => setVisible(false), [])
  return { visible, dismiss }
}
