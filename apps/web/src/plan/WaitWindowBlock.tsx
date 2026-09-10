import { roundMin } from '@/lib/duration'
import { stageColor } from '@/lib/stageColor'

import type { RenderWindow } from './derive'

/**
 * The signature component — Direction 3, "Two Kinds of Minute" (docs/DESIGN_SYSTEM.md
 * § WaitWindowBlock). A scheduler wait window is drawn as a **full-bleed field**: the
 * ground steps to `--color-field` (warm, deeper — a place, not a card) and runs to the
 * device edges while the content stays on the page margin. Flat surface: no border, no
 * shadow. Secondary text inside the field steps up from `ink-3` to `ink-2` because
 * `ink-3` does not clear AA against the warmer ground.
 *
 * Top to bottom: the host's label as a subject line (or, when the field absorbs an
 * otherwise-empty stage, that stage's title); the host's doneness cue; the host's
 * duration as the one large numeral on the Plan; a caption that derives from the host's
 * `attention` and asserts only hands-off, never heat; the ranked borrowed tasks; and one
 * qualitative footer line that carries no second number.
 *
 * Every value here is the scheduler's or the graph's, looked up by id. Nothing is added.
 */
export function WaitWindowBlock({
  window,
  stageLabel,
  stageOrdinal,
}: {
  window: RenderWindow
  /** Set when this field absorbs an otherwise-empty stage: its title renders here. */
  stageLabel?: string
  /** The absorbed stage's ordinal, rendered inline before the title (the gutter is
   *  covered by the full-bleed field in this case). */
  stageOrdinal?: number
}) {
  const [first, ...rest] = window.tasks
  const ranked = window.tasks.length > 1

  // Caption under the numeral. Derived from the host's attention — the only field the
  // graph has that speaks to "is the cook free?". Deliberately process-neutral: it does
  // not say "cooks" / "rests" / "proves", because the graph cannot confirm which.
  const caption =
    window.hostAttention === 'periodic'
      ? 'minutes, checking now and then'
      : 'minutes hands off'

  // Qualitative — no number, so it cannot contradict the numeral. Wording is category B
  // (DESIGN_SYSTEM.md § Still open #2): provisional until seen against a 0-slack and a
  // 50-min-slack window side by side.
  const footer =
    window.slackMin <= 2
      ? 'Start as soon as it is underway — the timing is tight.'
      : window.slackMin >= window.hostDurationTypical / 2
        ? 'Plenty of time — no need to rush.'
        : 'There is room to spare.'

  return (
    <div
      // When the field absorbs the stage header (`stageLabel`) it starts flush at the
      // stage top so the gutter ordinal lands level with the absorbed title; otherwise
      // it sits below the inline row before it.
      className={`mb-2 bg-field ${stageLabel ? '' : 'mt-4'}`}
      // Full bleed. The stage body sits 56px in from the viewport left (20 page pad +
      // 24 gutter + 12 gap) and 20px in from the right; pull both back to the edges,
      // then 20px inner padding returns the content to the page margin.
      style={{ marginLeft: -56, marginRight: -20 }}
    >
      <div className="px-5 pb-4 pt-[18px]">
        {stageLabel ? (
          <h2 className="flex items-baseline gap-2 text-[18px] font-semibold text-ink">
            {stageOrdinal != null && (
              <span className="tabular text-[13px] font-medium text-ink-2">
                {stageOrdinal}
              </span>
            )}
            <span className="expanded">{stageLabel}</span>
          </h2>
        ) : (
          <p className="text-[15px] font-semibold text-ink">{window.hostLabel}</p>
        )}

        {window.hostDonenessCue && (
          <p className="mt-1 text-[13px] leading-[1.42] text-ink-2">
            until {window.hostDonenessCue}
          </p>
        )}

        <p
          className="tabular mt-4 text-[44px] font-semibold leading-none text-ink"
          style={{ letterSpacing: '-0.025em' }}
        >
          {roundMin(window.hostDurationTypical)}
        </p>
        <p className="mt-1.5 text-[13px] text-ink-2">{caption}</p>

        <ul className="mt-3">
          {first && <WindowTask task={first} primary={ranked} />}
          {rest.map((task) => (
            <WindowTask key={task.nodeId} task={task} primary={false} />
          ))}
        </ul>

        <p className="mt-1 border-t border-rule pt-3 text-[13px] leading-[1.42] text-ink-2">
          {footer}
        </p>
      </div>
    </div>
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
    <li className="relative flex items-baseline gap-3 border-t border-rule py-3 pl-3">
      <span
        aria-hidden
        className="absolute bottom-0 left-0 top-0 w-[3px]"
        style={{ background: stageColor(task.homeStageIndex) }}
      />
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
