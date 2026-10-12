import { useCallback, useState } from 'react'

import { asHttpUrl, clipboardReadGranted, readClipboardText } from './clipboard'

/**
 * Clipboard access for the Copy sheet. Opening the sheet never triggers a permission
 * prompt: `checkOnOpen` reads the clipboard only when permission is already `granted`.
 * Otherwise the clipboard is read solely from `readOnPasteTap`, an explicit tap.
 */
export function useClipboardUrl() {
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null)

  const checkOnOpen = useCallback(async () => {
    setClipboardUrl(null)
    if (!(await clipboardReadGranted(navigator.permissions))) return
    const text = await readClipboardText(navigator.clipboard)
    setClipboardUrl(text == null ? null : asHttpUrl(text))
  }, [])

  /** The field's Paste tap: returns the trimmed clipboard text, or null if unavailable. */
  const readOnPasteTap = useCallback(async (): Promise<string | null> => {
    const text = await readClipboardText(navigator.clipboard)
    return text == null ? null : text.trim()
  }, [])

  return { clipboardUrl, checkOnOpen, readOnPasteTap }
}
