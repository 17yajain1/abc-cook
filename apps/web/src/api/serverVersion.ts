import type { ServerInfo } from '@abc-cook/schema'

/**
 * The server's `POSTPROCESS_VERSION`, fetched lazily from `/health` and remembered for
 * the session. Saved recipes are compared against it (`library/staleness.ts`).
 *
 * Only a success is remembered. A failure (offline, timeout, abort, malformed body)
 * resolves to `null`, which the open path reads as "couldn't check", and the next open
 * tries again.
 */
export interface ServerVersion {
  /** The version, or `null` when it couldn't be learned. Never rejects. */
  get(signal?: AbortSignal): Promise<number | null>
  /** Updates the memo from a response that carries the stamp (import, reprocess). */
  note(version: number): void
}

export function createServerVersion(fetchInfo: (signal?: AbortSignal) => Promise<ServerInfo>): ServerVersion {
  let known: number | null = null

  return {
    async get(signal?: AbortSignal): Promise<number | null> {
      if (known != null) return known
      try {
        const info = await fetchInfo(signal)
        if (!Number.isInteger(info.postprocess_version)) return null
        known = info.postprocess_version
        return known
      } catch {
        return null
      }
    },

    note(version: number): void {
      known = version
    },
  }
}
