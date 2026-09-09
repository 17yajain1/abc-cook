import { roundMin } from '@/lib/duration'
import { stageColor } from '@/lib/stageColor'

import type { RenderWindow } from './derive'

/**
 * The signature component (docs/DESIGN_SYSTEM.md). "While this cooks": the prep the
 * scheduler slotted into an unattended stretch. Rendered attached to its host stage
 * card, never floating as a separate tips section — that attachment is what makes the
 * idea legible.
 *
 * Drawn as a recessed band, which is the Plan view's echo of the Map's hollow bar: a
 * wait window *is* a gap in the schedule, so it sinks rather than lifts. The two capacity
 * chips carry the brief's attended/unattended encoding directly — the host's cooking time
 * is outlined (nothing is being done to it) and the prep that fits inside it is filled
 * (that one is you, working).
 *
 * Every number here is the scheduler's: `usedMin`, `slackMin`, and the host's own
 * duration. Nothing is added up in this file.
 */
export function WaitWindowBlock({ window }: { window: RenderWindow }) {
  const [first, ...rest] = window.tasks

  return (
    <section className="mt-4 border-t-2 border-ink bg-paper-sunk">
      <div className="px-3 pb-2.5 pt-3">
        <p className="text-[13px] font-semibold text-ink">While this cooks</p>
        <p className="tabular mt-0.5 text-[13px]">
          <span className="font-medium text-ink">{roundMin(window.usedMin)} min prep</span>
          <span className="text-ink-3">
            {' '}
            fits in {roundMin(window.hostDurationTypical)} min
          </span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 pb-3 text-[13px] font-medium">
        <span className="tabular rounded-control border border-ink px-2 py-1 text-ink">
          {roundMin(window.hostDurationTypical)} min cooking
        </span>
        <span className="tabular rounded-control bg-ink px-2 py-1 text-paper">
          {roundMin(window.usedMin)} min prep
        </span>
      </div>

      <ul>
        {first && <WindowTask task={first} primary />}
        {rest.map((task) => (
          <WindowTask key={task.nodeId} task={task} primary={false} />
        ))}
      </ul>

      <p className="border-t border-rule px-3 py-2 text-[13px] text-ink-2">
        {window.slackMin <= 0
          ? `All this prep fits inside the ${roundMin(window.hostDurationTypical)} min cook`
          : `Fits with ${roundMin(window.slackMin)} min to spare`}
      </p>
    </section>
  )
}

function WindowTask({
  task,
  primary,
}: {
  task: RenderWindow['tasks'][number]
  primary: boolean
}) {
  return (
    <li className="flex items-baseline gap-3 border-t border-rule px-3 py-2.5">
      <span
        aria-hidden
        className="flex-shrink-0 self-stretch"
        style={{ width: 3, background: stageColor(task.homeStageIndex) }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-ink">{task.label}</p>
        {primary && (
          <p className="mt-0.5 text-[13px] text-ink-2">Start with this one</p>
        )}
      </div>
      <span className="tabular flex-shrink-0 text-[13px] font-medium text-ink-3">
        {task.durationTypical} min
      </span>
    </li>
  )
}
