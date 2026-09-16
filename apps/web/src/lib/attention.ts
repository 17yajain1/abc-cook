import type { Node } from '@abc-cook/schema'

/**
 * The attention caption the Map and Plan views share.
 *
 * Lives in `lib/` rather than beside either view because both render the same
 * categorical fact and must say it identically (the same reason `formatMinutes`
 * lives here — see `lib/duration.ts`).
 */

/** Attention note text — a categorical lookup, never a computed or authored string. */
export function attentionNote(attention: Node['attention']): string | null {
  if (attention === 'periodic') return '(low attention)'
  if (attention === 'unattended') return '(hands off)'
  return null
}
