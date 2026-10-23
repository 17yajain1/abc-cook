import { formatMinutes } from '@/lib/duration'

import type { RenderTask } from './derive'

/**
 * A task row's duration text (C1 long-duration formatting, C2 estimate cue, M3.2
 * three-way). Three mutually exclusive cases, checked in order:
 *  - hands-on: `~N min` — the cook is doing this themselves, so it's a rough figure
 *    the way the collapsed stage figure is, never a promise.
 *  - not hands-on and the duration's provenance is `inferred`: `about N min` — never
 *    for `defaulted` (`graph.py`: a defaulted number must never be presented as an
 *    estimate the model made).
 *  - otherwise: `N min`, plain.
 */
export function taskDurationText(task: RenderTask): string {
  const formatted = formatMinutes(task.durationTypical)
  if (task.attention === 'hands_on') return `~${formatted}`
  if (task.durationProvenance === 'inferred') return `about ${formatted}`
  return formatted
}
