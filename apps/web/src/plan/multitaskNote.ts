import type { RenderPlan, RenderWindow } from './derive'
import { taskDurationText } from './taskDuration'

/**
 * D5, revised: one note under the fact tiles when something can be done while waiting. The page says each
 * fact once: the top summarises (a count, one duration), and step names live in Steps. So the note names the
 * host step it is about, never the tasks to do meanwhile; those are in the Meanwhile block it points to.
 *
 * Every figure is the scheduler's: the number of windows that hold a task, and the host's own duration as
 * the step itself shows it (`taskDurationText`).
 */

const COUNTS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']

/** "One" ... "Ten", then the digits. */
function countWord(n: number): string {
  return COUNTS[n] ?? String(n)
}

/** "Cook tomato base" -> "cook tomato base". Only the first letter, and not an initialism ("PCR test"). */
function lowerFirst(label: string): string {
  const first = label.charAt(0)
  const second = label.charAt(1)
  if (first === first.toUpperCase() && second !== '' && second === second.toUpperCase() && second !== second.toLowerCase()) {
    return label
  }
  return `${first.toLowerCase()}${label.slice(1)}`
}

/**
 * "cooks" when the host is a periodic (low-attention) step, where the cook keeps an eye on a pan; "goes" for
 * an unattended one (soak, rest, marinate). The graph has no heat field, so this is a read of `attention`,
 * the one thing it does say, and "goes" is the neutral word whenever it can't tell.
 */
function verbFor(window: RenderWindow): 'cooks' | 'goes' {
  return window.hostAttention === 'periodic' ? 'cooks' : 'goes'
}

export interface MultitaskNote {
  text: string
  /** The first window in the order the steps are drawn: where "See where" scrolls to. */
  firstWindowId: string
}

/** `null` unless the scheduler put a task in a wait window. */
export function multitaskNote(plan: Pick<RenderPlan, 'stages'>): MultitaskNote | null {
  const entries = plan.stages.flatMap((stage) =>
    stage.windows
      .filter((w) => w.tasks.length > 0)
      .map((window) => ({ window, host: stage.inlineTasks.find((t) => t.nodeId === window.hostNodeId) })),
  )
  if (entries.length === 0) return null

  // The longest wait: a selection among the plan's own host durations; the first one on a tie.
  const longest = entries.reduce((best, e) => (e.window.hostDurationTypical > best.window.hostDurationTypical ? e : best))
  const name = lowerFirst(longest.window.hostLabel)
  const duration = longest.host ? ` (${taskDurationText(longest.host)})` : ''
  const verb = verbFor(longest.window)
  const text =
    entries.length === 1
      ? `One chance to multitask: do your prep while ${name} ${verb}${duration}.`
      : `${countWord(entries.length)} chances to multitask: the longest is while ${name} ${verb}${duration}.`
  return { text, firstWindowId: entries[0].window.id }
}
