import type { RenderWindow } from './derive'
import { stageColor } from './stageColor'

/**
 * The signature component (docs/DESIGN_SYSTEM.md). "While this cooks": the prep the
 * scheduler slotted into an unattended stretch. Rendered attached to its host stage
 * card, never floating as a separate tips section — that attachment is what makes the
 * idea legible.
 *
 * Every number here is the scheduler's: `usedMin`, `slackMin`, and the host's own
 * duration. Nothing is added up in this file.
 */
export function WaitWindowBlock({ window }: { window: RenderWindow }) {
  const [first, ...rest] = window.tasks

  return (
    <section className="mt-3 overflow-hidden rounded-2xl border border-line-strong">
      <div className="bg-window-head px-4 py-2.5">
        <p className="text-xs font-bold uppercase tracking-wide text-saffron">
          ⚡ While this cooks
        </p>
        <p className="tabular mt-0.5 text-xs text-ink-dim">
          {round(window.usedMin)} min prep · fits in {round(window.hostDurationTypical)} min
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 bg-window px-4 py-2.5 text-xs">
        <Chip tone="cook">
          🔥 <b className="tabular">{round(window.hostDurationTypical)}</b>&nbsp;min cooking
        </Chip>
        <span className="text-ink-dim">›</span>
        <Chip tone="prep">
          ✓ <b className="tabular">{round(window.usedMin)}</b>&nbsp;min prep
        </Chip>
      </div>

      <ul className="bg-surface">
        {first && <WindowTask task={first} primary />}
        {rest.map((task) => (
          <WindowTask key={task.nodeId} task={task} primary={false} />
        ))}
      </ul>

      <p className="bg-verified-tint px-4 py-2 text-xs text-verified-ink">
        {window.slackMin <= 0
          ? `All this prep fits inside the ${round(window.hostDurationTypical)} min cook`
          : `Fits with ${round(window.slackMin)} min to spare`}
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
    <li
      className="flex items-center gap-3 border-t border-line px-4 first:border-t-0"
      style={{ paddingBlock: primary ? 14 : 10 }}
    >
      <span
        aria-hidden
        className="h-8 w-1 flex-shrink-0 rounded-full"
        style={{ background: stageColor(task.homeStageIndex) }}
      />
      <div className="min-w-0 flex-1">
        <p
          className="font-semibold text-ink"
          style={{ fontSize: primary ? 15 : 13 }}
        >
          {task.label}
        </p>
        <p className="tabular mt-0.5 text-xs text-ink-dim">
          {primary ? 'Start with this one · ' : ''}
          {task.durationTypical} min
        </p>
      </div>
      <span aria-hidden className="flex-shrink-0 text-ink-dim">
        ›
      </span>
    </li>
  )
}

function Chip({
  tone,
  children,
}: {
  tone: 'cook' | 'prep'
  children: React.ReactNode
}) {
  const cls =
    tone === 'cook'
      ? 'bg-saffron-tint text-saffron-dim'
      : 'bg-verified-tint text-verified-ink'
  return (
    <span className={`flex items-center gap-1 rounded-lg px-2.5 py-1 ${cls}`}>
      {children}
    </span>
  )
}

/** Trim the scheduler's 0.01-min rounding quantum for display. Not a computation. */
function round(min: number): number {
  return Math.round(min)
}
