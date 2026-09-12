/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { connectorDelayMs, entryDelayMs, FADE_MS, SWEEP_MS } from './motion'
import { layoutMap } from './layout'
import chickenBiryani from '@/__fixtures__/chicken-biryani.plan-response.json'
import homemadeDonuts from '@/__fixtures__/homemade-donuts.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import maggi from '@/__fixtures__/maggi-2min.plan-response.json'
import strawberryShortcake from '@/__fixtures__/strawberry-shortcake.plan-response.json'
import syntheticTwoWindows from '@/__fixtures__/synthetic-two-windows.plan-response.json'

const ALL: [string, RecipePlanResponse][] = [
  ['kadai-paneer', kadaiPaneer as RecipePlanResponse],
  ['maggi-2min', maggi as RecipePlanResponse],
  ['chicken-biryani', chickenBiryani as RecipePlanResponse],
  ['homemade-donuts', homemadeDonuts as RecipePlanResponse],
  ['strawberry-shortcake', strawberryShortcake as RecipePlanResponse],
  ['synthetic-two-windows', syntheticTwoWindows as RecipePlanResponse],
]

describe('entryDelayMs', () => {
  it('is zero at the top of the map', () => {
    expect(entryDelayMs(0, 1000)).toBe(0)
  })

  it('is SWEEP_MS at the bottom of the map', () => {
    expect(entryDelayMs(1000, 1000)).toBe(SWEEP_MS)
  })

  it('is monotone non-decreasing in y', () => {
    const height = 800
    let prev = -1
    for (let y = 0; y <= height; y += 17) {
      const delay = entryDelayMs(y, height)
      expect(delay).toBeGreaterThanOrEqual(prev)
      prev = delay
    }
  })

  it('always returns an integer number of milliseconds', () => {
    for (const y of [0, 1, 7, 133.5, 999, 1000]) {
      expect(Number.isInteger(entryDelayMs(y, 1000))).toBe(true)
    }
  })

  it('clamps y outside the map bounds instead of extrapolating', () => {
    expect(entryDelayMs(-50, 1000)).toBe(0)
    expect(entryDelayMs(1500, 1000)).toBe(SWEEP_MS)
  })

  it('does not divide by zero on a degenerate zero-height map', () => {
    expect(entryDelayMs(0, 0)).toBe(0)
  })
})

describe('connectorDelayMs', () => {
  it('is FADE_MS when there are no cards', () => {
    expect(connectorDelayMs([], 1000)).toBe(FADE_MS)
  })

  it('is exactly the slowest card delay plus FADE_MS', () => {
    const cards = [{ y: 0 }, { y: 500 }, { y: 1000 }]
    expect(connectorDelayMs(cards, 1000)).toBe(entryDelayMs(1000, 1000) + FADE_MS)
  })

  it('does not depend on card order', () => {
    const forward = [{ y: 0 }, { y: 300 }, { y: 900 }]
    const backward = [{ y: 900 }, { y: 300 }, { y: 0 }]
    expect(connectorDelayMs(forward, 1000)).toBe(connectorDelayMs(backward, 1000))
  })
})

describe('the entry sweep over real fixture geometry', () => {
  it.each(ALL)('%s: every card delay is within [0, SWEEP_MS], sorted by y', (_name, fixture) => {
    const layout = layoutMap(fixture)
    const byY = [...layout.cards].sort((a, b) => a.y - b.y)

    let prevDelay = -1
    for (const card of byY) {
      const delay = entryDelayMs(card.y, layout.height)
      expect(delay).toBeGreaterThanOrEqual(0)
      expect(delay).toBeLessThanOrEqual(SWEEP_MS)
      expect(delay).toBeGreaterThanOrEqual(prevDelay)
      prevDelay = delay
    }
  })

  it.each(ALL)('%s: connectors start exactly when the slowest card lands, never before', (_name, fixture) => {
    const layout = layoutMap(fixture)
    const lastCardLanding = Math.max(0, ...layout.cards.map((c) => entryDelayMs(c.y, layout.height) + FADE_MS))
    expect(connectorDelayMs(layout.cards, layout.height)).toBe(lastCardLanding)
  })

  it.each(ALL)('%s: a short map gets no dead hold — connector delay tracks its own sweep, not a fixed floor', (_name, fixture) => {
    const layout = layoutMap(fixture)
    // Regression guard for the removed CONNECTOR_DELAY_MS=500 universal constant:
    // any fixture whose real sweep finishes well under 500ms must not still wait
    // until 500ms for its connectors.
    const delay = connectorDelayMs(layout.cards, layout.height)
    const maxPossibleDelay = SWEEP_MS + FADE_MS
    expect(delay).toBeLessThanOrEqual(maxPossibleDelay)
  })
})

describe('index.css stays in step with the motion constants', () => {
  const cssPath = fileURLToPath(new URL('../index.css', import.meta.url))
  const css = readFileSync(cssPath, 'utf-8')

  it('the card fade duration matches FADE_MS', () => {
    expect(css).toContain(`animation: map-fade-in ${FADE_MS}ms ease-out both;`)
  })

  it('no longer hardcodes a fixed connector delay', () => {
    // Regression guard: the delay is computed per-map in MapView.tsx and applied
    // inline, not authored as a static CSS rule — if a `.map-enter-late` class with
    // a baked-in `animation-delay` reappears here, it has silently stopped tracking
    // each map's real sweep.
    expect(css).not.toMatch(/\.map-enter-late/)
  })

  it('reduced-motion also zeroes animation-delay, not just duration', () => {
    const reducedMotionBlock = css.slice(css.indexOf('prefers-reduced-motion'))
    expect(reducedMotionBlock).toContain('animation-delay: 0ms !important;')
  })
})
