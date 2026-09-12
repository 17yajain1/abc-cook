import { useId } from 'react'

import { mapCardFill, stageColor } from '@/lib/stageColor'

import type { MapCard, MapLayout } from './layout'

/**
 * Renders a `MapLayout` — nothing more. Every coordinate, every label, every note
 * already lives on the layout object; this file only turns them into SVG and HTML.
 * See `docs/DESIGN_SYSTEM.md` § *The Map grammar* for the mark set this draws, and
 * `M2.75 Map design handoff.md` for the approved visual spec it implements.
 *
 * No axis, no card strokes, no critical-path signal of any kind — all explicitly
 * rejected in the M2.75 handoff. Draw order: edges, then brackets, then cards on top
 * of both, then fold labels last.
 */
export function MapView({ layout }: { layout: MapLayout }) {
  const titleId = useId()
  const descId = useId()

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

        {layout.cards.map((card) => (
          <TaskCard key={card.nodeId} card={card} />
        ))}

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
      </svg>

      <Legend legend={layout.legend} />
    </div>
  )
}

function TaskCard({ card }: { card: MapCard }) {
  const fill = card.role === 'window-child' ? 'var(--color-field)' : mapCardFill(card.stageIndex)

  // Stack label line(s), the duration, and the optional attention note, centred as a
  // block inside the card.
  const LABEL_LINE_H = 16
  const SMALL_LINE_H = 14
  const contentH = card.labelLines.length * LABEL_LINE_H + SMALL_LINE_H + (card.note ? SMALL_LINE_H : 0)
  const top = card.y + Math.max(0, (card.h - contentH) / 2)
  const cx = card.x + card.w / 2

  return (
    <g>
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
