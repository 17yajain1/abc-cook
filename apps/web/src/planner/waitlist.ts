/**
 * "Notify me" for the Meal Planner. H1 only remembers the tap on this device so the
 * button reads "Noted" on every return; nothing is sent anywhere.
 *
 * TODO(H2): send to backend in H2.
 */

const STORAGE_KEY = 'abc-cook:planner-waitlist:v1'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** Whether the person has already tapped Notify me. A storage that throws counts as no. */
export function isOnWaitlist(storage: StorageLike | undefined = safeLocalStorage()): boolean {
  try {
    return storage?.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/** Records the tap. Returns false if storage refused (private mode, quota). */
export function joinWaitlist(storage: StorageLike | undefined = safeLocalStorage()): boolean {
  try {
    storage?.setItem(STORAGE_KEY, '1')
    return storage != null
  } catch {
    return false
  }
}

function safeLocalStorage(): StorageLike | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}
