import { stageColor } from '@/lib/stageColor'

import type { RenderWindow } from './derive'

/**
 * The signature component — Direction 3, "Two Kinds of Minute" (docs/DESIGN_SYSTEM.md
 * § WaitWindowBlock, § Direction 3). A scheduler wait window renders as a panel nested
 * inside its host's own stage, directly beneath the host's ordinary task row — never in
 * place of it, never full-bleed. The panel sits on `--color-field` (warm, deeper than
 * the stage's own tint ground) with a 2px leading edge in the host stage's own tint.
 * Flat: no radius, no shadow beyond that edge.
 *
 * The head states the relationship in words — "Meanwhile, do these" plus a line derived
 * from the host's `attention` — never a numeral; the host's own duration already lives
 * one row above, in its `TaskRow`. Then the ranked borrowed tasks, then one qualitative
 * footer line that carries no second number.
 *
 * Every value here is the scheduler's or the graph's, looked up by id. Nothing is added.
 */
export function WaitWindowBlock({
  window,
  hostStageIndex,
}: {
  window: RenderWindow
  /** Index in `graph.stages` of the stage hosting this window — its tint leads the
   *  panel's edge. Distinct from a task's own `homeStageIndex` below. */
  hostStageIndex: number
}) {
  const [first, ...rest] = window.tasks
  const ranked = window.tasks.length > 1
  const showTintBar = hasMultiHomeStage(window.tasks)

  const attentionText = attentionLine(window.hostAttention)

  // Qualitative — no number, so it cannot contradict the host's own duration one row up.
  // Wording is category B (DESIGN_SYSTEM.md § Still open #2): provisional until seen
  // against a 0-slack and a 50-min-slack window side by side.
  const footer =
    window.slackMin <= 2
      ? 'Start as soon as it is underway — the timing is tight.'
      : window.slackMin >= window.hostDurationTypical / 2
        ? 'Plenty of time — no need to rush.'
        : 'There is room to spare.'

  return (
    <div
      className="mt-2 mb-2 bg-field"
      style={{ borderLeft: `2px solid ${stageColor(hostStageIndex)}` }}
    >
      <div className="p-3">
        <p className="text-[15px] font-semibold text-ink">Meanwhile, do these</p>
        <p className="mt-1 text-[13px] text-ink-2">{attentionText}</p>

        <ul className="mt-3">
          {first && <WindowTask task={first} primary={ranked} showTintBar={showTintBar} />}
          {rest.map((task) => (
            <WindowTask key={task.nodeId} task={task} primary={false} showTintBar={showTintBar} />
          ))}
        </ul>

        <p className="mt-1 border-t border-rule pt-3 text-[13px] leading-[1.42] text-ink-2">
          {footer}
        </p>
      </div>
    </div>
  )
}

/**
 * The line under the head. Derived from the host's `attention` — the only field the
 * graph has that speaks to "is the cook free?". Deliberately process-neutral: it does
 * not say "cooks" / "rests" / "proves", because the graph cannot confirm which.
 */
export function attentionLine(attention: RenderWindow['hostAttention']): string {
  return attention === 'periodic' ? 'checking the pan now and then' : 'your hands are free'
}

/**
 * Whether this window's borrowed tasks come from more than one home stage. The 3px
 * home-stage bar on each task row is drawn only when this is true — in both shipped
 * fixtures every task in a window shares one home stage, so the bar would otherwise be
 * one colour repeated, carrying no information (§ WaitWindowBlock).
 */
export function hasMultiHomeStage(tasks: readonly { homeStageIndex: number }[]): boolean {
  return new Set(tasks.map((t) => t.homeStageIndex)).size > 1
}

function WindowTask({
  task,
  primary,
  showTintBar,
}: {
  task: RenderWindow['tasks'][number]
  primary: boolean
  showTintBar: boolean
}) {
  return (
    <li
      className={`relative flex items-baseline gap-3 border-t border-rule py-3 ${showTintBar ? 'pl-3' : ''}`}
    >
      {showTintBar && (
        <span
          aria-hidden
          className="absolute bottom-0 left-0 top-0 w-[3px]"
          style={{ background: stageColor(task.homeStageIndex) }}
        />
      )}
      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <span
          className={`block text-[15px] text-ink ${primary ? 'font-semibold' : 'font-medium'}`}
        >
          {task.label}
        </span>
        {primary && (
          <span className="mt-0.5 block text-[12px] font-medium text-signal">
            Start with this
          </span>
        )}
      </span>
      <span className="tabular flex-shrink-0 text-[13px] font-medium text-ink-2">
        {task.durationTypical} min
      </span>
    </li>
  )
}
