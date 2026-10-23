import { Fragment } from 'react'

import type { Ingredient } from '@abc-cook/schema'

import { emphasisSpans } from '@/lib/stepEmphasis'

/**
 * A step's instruction with its quantities, times and heat in bold (D6). The text is never altered,
 * only wrapped; what counts is decided in `lib/stepEmphasis.ts`.
 */
export function EmphasisText({
  text,
  consumed,
  factor,
}: {
  text: string
  consumed: readonly Pick<Ingredient, 'name' | 'qty' | 'qty_text' | 'qty_amount' | 'unit'>[]
  factor: number
}) {
  const spans = emphasisSpans(text, consumed, factor)
  if (spans.length === 0) return <>{text}</>
  const parts: React.ReactNode[] = []
  let at = 0
  spans.forEach((span, i) => {
    if (span.start > at) parts.push(<Fragment key={`t${i}`}>{text.slice(at, span.start)}</Fragment>)
    parts.push(
      <b key={`b${i}`} className="font-bold text-home-ink">
        {text.slice(span.start, span.end)}
      </b>,
    )
    at = span.end
  })
  if (at < text.length) parts.push(<Fragment key="tail">{text.slice(at)}</Fragment>)
  return <>{parts}</>
}
