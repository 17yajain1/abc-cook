import { useId } from 'react'

import { mapCardFill, stageColor } from '@/lib/stageColor'

import type { MapCard, MapLayout } from './layout'

/**
 * Renders a `MapLayout` — nothing more. Every coordinate, every label, every note
 * already lives on the layout object; this file only turns them into SVG and HTML.
 * See `docs/DESIGN_SYSTEM.md` § *The Map grammar* for the mark set this draws.
 *
 * Draw order matters for legibility on paper: axis, then edges, then flows, then cards
 * on top of both, then overflow cards last (`GRAPH_VIEW.md` §4).
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
            id="map-arrow-flow"
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L8,4 L0,8 Z" fill="var(--color-ink-2)" />
          </marker>
        </defs>

        {/* Time axis — the spine every card is measured against. No rail, no signal:
            the critical path is a layout input only (DESIGN_SYSTEM.md § The Map grammar,
            "Critical path"). */}
        <line
          x1={layout.axis.x}
          y1={layout.axis.y0}
          x2={layout.axis.x}
          y2={layout.axis.y1}
          stroke="var(--color-ink)"
          strokeWidth={1}
          markerEnd="url(#map-arrow-dep)"
        />
        {layout.axis.ticks.map((tick) => (
          <text
            key={tick.y}
            x={layout.axis.x - 8}
            y={tick.y}
            textAnchor="end"
            dominantBaseline="middle"
            className="tabular"
            fontSize={11}
            fontWeight={500}
            fill="var(--color-ink-3)"
          >
            {tick.label}
          </text>
        ))}

        {/* Dependencies — solid, orthogonal, one shared arrowhead per merge. */}
        {layout.edges.map((edge) => (
          <path
            key={`${edge.from}->${edge.to}`}
            d={edge.d}
            fill="none"
            stroke="var(--color-ink)"
            strokeWidth={1}
            markerEnd="url(#map-arrow-dep)"
          />
        ))}

        {/* Parallel flow — dashed, a bus off the host plus one branch per borrowed
            card. Drawn only from plan.windows, never inferred from attention. */}
        {layout.flows.map((flow) => (
          <g key={flow.windowId}>
            <path
              d={flow.busD}
              fill="none"
              stroke="var(--color-ink-2)"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            {flow.branches.map((branch) => (
              <path
                key={branch.to}
                d={branch.d}
                fill="none"
                stroke="var(--color-ink-2)"
                strokeWidth={1}
                strokeDasharray="4 3"
                markerEnd="url(#map-arrow-flow)"
              />
            ))}
          </g>
        ))}

        {layout.cards.map((card) => (
          <TaskCard key={card.nodeId} card={card} />
        ))}

        {layout.overflow.map((card) => (
          <g key={`${card.fromMin}-${card.toMin}`}>
            <rect
              x={card.x}
              y={card.y}
              width={card.w}
              height={card.h}
              rx={8}
              fill="var(--color-paper-sunk)"
              stroke="var(--color-ink-3)"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
            <text
              x={card.x + card.w / 2}
              y={card.y + card.h / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={13}
              fontWeight={500}
              fill="var(--color-ink-3)"
            >
              +{card.nodeIds.length} more
            </text>
          </g>
        ))}
      </svg>

      <Legend legend={layout.legend} />
    </div>
  )
}

function TaskCard({ card }: { card: MapCard }) {
  const fill = card.borrowed ? 'var(--color-field)' : mapCardFill(card.stageIndex)
  const stroke = card.borrowed
    ? 'color-mix(in srgb, var(--color-ink-3) 40%, transparent)'
    : stageColor(card.stageIndex)

  // Stack label line(s), the duration, and the optional attention note, centred as a
  // block inside the card. Small cards (no note) get a shorter block.
  const LABEL_LINE_H = 16
  const SMALL_LINE_H = 14
  const contentH = card.labelLines.length * LABEL_LINE_H + SMALL_LINE_H + (card.note ? SMALL_LINE_H : 0)
  const top = card.y + Math.max(0, (card.h - contentH) / 2)
  const cx = card.x + card.w / 2

  return (
    <g>
      <rect
        x={card.x}
        y={card.y}
        width={card.w}
        height={card.h}
        rx={8}
        fill={fill}
        stroke={stroke}
        strokeWidth={1}
      />
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
          fontSize={11}
          fontWeight={400}
          fill="var(--color-ink-3)"
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
      {legend.hasParallel && (
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: 'var(--color-field)' }}
          />
          Parallel (while waiting)
        </span>
      )}
      <span className="flex items-center gap-1.5">
        <svg width="16" height="8" aria-hidden="true">
          <line x1={0} y1={4} x2={16} y2={4} stroke="var(--color-ink)" strokeWidth={1} />
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
              stroke="var(--color-ink-2)"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          </svg>
          Parallel flow
        </span>
      )}
    </div>
  )
}
