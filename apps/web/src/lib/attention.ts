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

/**
 * The line under a wait window's head, derived from the host's `attention` â€” the only field
 * the graph has that speaks to "is the cook free?". Deliberately process-neutral: it does
 * not say "cooks" / "rests" / "proves", because the graph cannot confirm which. Lives here
 * (not in `WaitWindowBlock.tsx`) so the pure outline derivation can use it without loading
 * a React component.
 */
export function attentionLine(attention: Node['attention']): string {
  return attention === 'periodic' ? 'checking the pan now and then' : 'your hands are free'
}

/**
 * The pill under a step on the recipe page: "Hands-off" for an unattended step, "Low attention" for a
 * periodic one, nothing for a hands-on one. The same categorical fact as `attentionNote`, as a label.
 */
export function attentionTag(attention: Node['attention']): string | null {
  if (attention === 'unattended') return 'Hands-off'
  if (attention === 'periodic') return 'Low attention'
  return null
}
