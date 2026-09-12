import { useId } from 'react'

import { mapCardFill, stageColor } from '@/lib/stageColor'

import type { MapCard, MapLayout } from './layout'
import { connectorDelayMs, entryDelayMs } from './motion'

/**
 * Renders a `MapLayout` — nothing more. Every coordinate, every label, every note
 * already lives on the layout object; this file only turns them into SVG and HTML.
 * See `docs/DESIGN_SYSTEM.md` § *The Map grammar* for the mark set this draws, and
 * `M2.75 Map design handoff.md` for the approved visual spec it implements.
 *
 * No axis, no card strokes, no critical-path signal of any kind — all explicitly
 * rejected in the M2.75 handoff. Draw order: edges, then brackets, then cards on top
 * of both, then fold labels last.
 *
 * Entry animation (`docs/DESIGN_SYSTEM.md` § *Map entry animation*, once per recipe —
 * `PlanScreen` decides when to pass `skipEntryAnimation`, this component only draws
 * it): cards fade in top-to-bottom, delayed by their own `y` (`entryDelayMs`); edges,
 * brackets and fold labels fade in together at `connectorDelayMs`, derived from this
 * map's own slowest card rather than a fixed number — a short map gets no dead hold,
 * a tall one still waits out its full sweep. The legend never animates. CSS-only, no
 * timing in React state — see `.map-enter` in `index.css` and the reduced-motion
 * override there.
 */
export function MapView({
  layout,
  skipEntryAnimation = false,
}: {
  layout: MapLayout
  /** True once this recipe's Map has already played its entry — set by `PlanScreen`,
   * which tracks it per recipe, not per mount: a `Plan -> Map` toggle for the recipe
   * already being viewed passes `true` (no replay); a newly opened or re-opened
   * recipe passes `false` (fresh animation). Cards and connectors render at full
   * opacity immediately when `true` — no animation classes, no delay, nothing to skip
   * past. See `docs/DESIGN_SYSTEM.md` § *Map entry animation* and `PlanScreen.tsx`. */
  skipEntryAnimation?: boolean
}) {
  const titleId = useId()
  const descId = useId()
  const lateDelayMs = connectorDelayMs(layout.cards, layout.height)
  const lateProps = skipEntryAnimation
    ? {}
    : { className: 'map-enter', style: { animationDelay: `${lateDelayMs}ms` } }

  return (
    <div>
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        width={layout.width}
        height={layout.height}
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        className="block w-full"
      >
        <title id={titleId}>Cooking map</title>
        <desc id={descId}>{layout.description}</desc>

        <defs>
          <marker
            id="map-arrow-dep"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L8,4 L0,8 Z" fill="var(--color-ink)" />
          </marker>
          <marker
            id="map-arrow-tick"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L8,4 L0,8 Z" fill="var(--color-ink-3)" />
          </marker>
        </defs>

        {/* Edges, brackets and fold labels: the second entry beat, once this map's own
            slowest card has landed (§ Map entry animation, `connectorDelayMs`). One
            <g> so they fade in as a single unit. */}
        <g {...lateProps}>
          {/* Mainline chain — solid, quiet, one shared arrowhead per merge. */}
          {layout.edges.map((edge) => (
            <path
              key={`${edge.from}->${edge.to}`}
              d={edge.d}
              fill="none"
              stroke="var(--color-ink)"
              strokeWidth={1.5}
              markerEnd="url(#map-arrow-dep)"
            />
          ))}

          {/* Window brackets — one per window, not one per member. */}
          {layout.brackets.map((bracket) => (
            <g key={bracket.windowId}>
              <path d={bracket.stemD} fill="none" stroke="var(--color-ink-3)" strokeWidth={1} strokeDasharray="3 3" />
              <path d={bracket.spineD} fill="none" stroke="var(--color-ink-3)" strokeWidth={1} strokeDasharray="3 3" />
              {bracket.ticks.map((tick) => (
                <path
                  key={tick.to}
                  d={tick.d}
                  fill="none"
                  stroke="var(--color-ink-3)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  markerEnd="url(#map-arrow-tick)"
                />
              ))}
            </g>
          ))}

        </g>

        {layout.cards.map((card) => (
          <TaskCard
            key={card.nodeId}
            card={card}
            mapHeight={layout.height}
            skipEntryAnimation={skipEntryAnimation}
          />
        ))}

        {/* Fold labels paint above cards, per the original draw order, but fade with
            the rest of the second beat — same delay, a second <g> to preserve z-order. */}
        <g {...lateProps}>
          {layout.folds.map((fold) => (
            <text
              key={fold.anchorNodeId}
              x={fold.x}
              y={fold.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={11}
              fontWeight={500}
              fill="var(--color-ink-3)"
            >
              {fold.text}
            </text>
          ))}
        </g>
      </svg>

      <Legend legend={layout.legend} />
    </div>
  )
}

function TaskCard({
  card,
  mapHeight,
  skipEntryAnimation,
}: {
  card: MapCard
  mapHeight: number
  skipEntryAnimation: boolean
}) {
  const fill = card.role === 'window-child' ? 'var(--color-field)' : mapCardFill(card.stageIndex)

  // Stack label line(s), the duration, and the optional attention note, centred as a
  // block inside the card.
  const LABEL_LINE_H = 16
  const SMALL_LINE_H = 14
  const contentH = card.labelLines.length * LABEL_LINE_H + SMALL_LINE_H + (card.note ? SMALL_LINE_H : 0)
  const top = card.y + Math.max(0, (card.h - contentH) / 2)
  const cx = card.x + card.w / 2

  // Entry sweep: this card's fade delay is proportional to its own y, so the reveal
  // runs top-to-bottom in place of the removed time axis (§ Map entry animation).
  const delayMs = entryDelayMs(card.y, mapHeight)
  const cardProps = skipEntryAnimation
    ? {}
    : { className: 'map-enter', style: { animationDelay: `${delayMs}ms` } }

  return (
    <g {...cardProps}>
      <rect x={card.x} y={card.y} width={card.w} height={card.h} rx={8} fill={fill} />
      {card.labelLines.map((line, i) => (
        <text
          key={i}
          x={cx}
          y={top + i * LABEL_LINE_H + LABEL_LINE_H / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={13}
          fontWeight={500}
          fill="var(--color-ink)"
        >
          {line}
        </text>
      ))}
      <text
        x={cx}
        y={top + card.labelLines.length * LABEL_LINE_H + SMALL_LINE_H / 2}
        textAnchor="middle"
        dominantBaseline="middle"
        className="tabular"
        fontSize={11}
        fontWeight={500}
        fill="var(--color-ink-2)"
      >
        {card.durationLabel}
      </text>
      {card.note && (
        <text
          x={cx}
          y={top + card.labelLines.length * LABEL_LINE_H + SMALL_LINE_H + SMALL_LINE_H / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={10}
          fontWeight={500}
          fill="var(--color-ink-2)"
        >
          {card.note}
        </text>
      )}
    </g>
  )
}

function Legend({ legend }: { legend: MapLayout['legend'] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3 text-[12px] text-ink-2">
      {legend.stages.map((stage) => (
        <span key={stage.stageIndex} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: stageColor(stage.stageIndex) }}
          />
          {stage.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <svg width="16" height="8" aria-hidden="true">
          <line x1={0} y1={4} x2={16} y2={4} stroke="var(--color-ink)" strokeWidth={1.5} />
        </svg>
        Dependency
      </span>
      {legend.hasParallel && (
        <span className="flex items-center gap-1.5">
          <svg width="16" height="8" aria-hidden="true">
            <line
              x1={0}
              y1={4}
              x2={16}
              y2={4}
              stroke="var(--color-ink-3)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          </svg>
          Parallel (while waiting)
        </span>
      )}
    </div>
  )
}
