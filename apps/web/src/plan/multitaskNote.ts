import { sentenceMinutes } from '@/lib/duration'

import type { RenderPlan } from './derive'
import { hostPhrase } from './hostPhrase'

/**
 * D5, revised twice: one note under the fact tiles when something can be done while waiting. The page says
 * each fact once: the top summarises (a count of steps, one wait), and step names live in Steps. So the note
 * says how many steps can be done meanwhile and names only the wait they sit in, never the steps themselves;
 * the Meanwhile block it points to has those.
 *
 * Every figure is the scheduler's: the number of tasks it put in windows, and the host's own duration.
 */

const COUNTS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

/** "one" ... "ten", then the digits. */
export function countWord(n: number): string {
  return COUNTS[n] ?? String(n)
}

export interface MultitaskNote {
  /** The bold line: "You'll do three steps while the tomato base cooks (12 min)." */
  bold: string
  /** The grey line, only with two or more windows: the longest wait. */
  detail: string | null
  /** The first window in the order the steps are drawn: where "See which" scrolls to. */
  firstWindowId: string
}

/** `null` unless the scheduler put a task in a wait window. */
export function multitaskNote(plan: Pick<RenderPlan, 'stages'>): MultitaskNote | null {
  const windows = plan.stages.flatMap((stage) => stage.windows.filter((w) => w.tasks.length > 0))
  if (windows.length === 0) return null

  const steps = windows.reduce((n, w) => n + w.tasks.length, 0)
  const doing = `You'll do ${countWord(steps)} ${steps === 1 ? 'step' : 'steps'}`

  // The longest wait: a selection among the plan's own host durations; the first one on a tie.
  const longest = windows.reduce((best, w) => (w.hostDurationTypical > best.hostDurationTypical ? w : best))
  const wait = `${hostPhrase(longest.hostLabel)} (${sentenceMinutes(longest.hostDurationTypical)})`

  if (windows.length === 1) {
    return { bold: `${doing} ${wait}.`, detail: null, firstWindowId: windows[0].id }
  }
  return {
    bold: `${doing} while other things cook.`,
    detail: `The longest wait is ${wait}.`,
    firstWindowId: windows[0].id,
  }
}
