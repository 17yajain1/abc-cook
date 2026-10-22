import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { CookLanes } from './CookLanes'
import { derivePlan, hasParallelWork } from './derive'
import { deriveCookLanes, hostAttentionSentence, joinLabels } from './laneGeometry'

const FIXTURES = import.meta.glob('../__fixtures__/*.plan-response.json', { eager: true, import: 'default' }) as Record<
  string,
  RecipePlanResponse
>
const named = (name: string): RecipePlanResponse => FIXTURES[`../__fixtures__/${name}.plan-response.json`]

const lanesOf = (p: RecipePlanResponse) =>
  deriveCookLanes({ graph: p.graph, scheduled: p.plan.scheduled, windows: p.plan.windows, totalMin: p.plan.total_min })

describe('deriveCookLanes (D5 geometry)', () => {
  const entries = Object.entries(FIXTURES)

  it('exists exactly when the scheduler put a task in a window, for every fixture', () => {
    expect(entries.length).toBeGreaterThan(8)
    for (const [file, p] of entries) {
      expect(lanesOf(p) !== null, file).toBe(hasParallelWork(p))
      expect(derivePlan(p).lanes !== null, file).toBe(hasParallelWork(p))
    }
  })

  it('is absent for a recipe with nothing to slot in (pumpkin, maggi, pizza, croissant)', () => {
    for (const name of ['pumpkin-pancakes', 'maggi-2min', 'pizza-dough', 'croissant']) {
      expect(lanesOf(named(name)), name).toBeNull()
    }
  })

  it('keeps every bar inside the plan, from before to', () => {
    for (const [file, p] of entries) {
      const lanes = lanesOf(p)
      if (!lanes) continue
      for (const bar of [...lanes.you, ...lanes.hosts.flat()]) {
        expect(bar.from, `${file} ${bar.id}`).toBeGreaterThanOrEqual(0)
        expect(bar.to, `${file} ${bar.id}`).toBeLessThanOrEqual(1)
        expect(bar.to, `${file} ${bar.id}`).toBeGreaterThanOrEqual(bar.from)
      }
    }
  })

  it('puts each meanwhile block inside its host bar', () => {
    for (const [file, p] of entries) {
      const lanes = lanesOf(p)
      if (!lanes) continue
      const hosts = new Map(lanes.hosts.flat().map((h) => [h.id, h]))
      for (const w of p.plan.windows.filter((w) => w.assigned.length > 0)) {
        const block = lanes.you.find((b) => b.kind === 'meanwhile' && b.id === w.id)!
        const host = hosts.get(w.host_node_id)!
        expect(block.from, `${file} ${w.id}`).toBeGreaterThanOrEqual(host.from - 1e-9)
        expect(block.to, `${file} ${w.id}`).toBeLessThanOrEqual(host.to + 1e-9)
      }
    }
  })

  it('draws no bar over another in a row', () => {
    for (const [file, p] of entries) {
      const lanes = lanesOf(p)
      if (!lanes) continue
      for (const row of lanes.hosts) {
        row.forEach((bar, i) => {
          if (i > 0) expect(bar.from, file).toBeGreaterThanOrEqual(row[i - 1].to)
        })
      }
    }
  })

  it('kadai: three busy steps before the window, a block for the three meanwhile tasks, one host', () => {
    const lanes = lanesOf(named('kadai-paneer'))!
    expect(lanes.hosts.length).toBe(1)
    expect(lanes.hosts[0].map((b) => b.label)).toEqual(['Cook tomato base'])
    expect(lanes.you.filter((b) => b.kind === 'meanwhile').length).toBe(1)
    expect(lanes.you.filter((b) => b.kind === 'step').length).toBe(6)
  })

  it('biryani: two windows, two hosts, two blocks', () => {
    const lanes = lanesOf(named('chicken-biryani'))!
    expect(lanes.hosts.flat().map((b) => b.label)).toEqual(['Soak rice', 'Cook chicken'])
    expect(lanes.you.filter((b) => b.kind === 'meanwhile').length).toBe(2)
  })
})

describe('the words', () => {
  it('joins labels', () => {
    expect(joinLabels([])).toBe('')
    expect(joinLabels(['A'])).toBe('A')
    expect(joinLabels(['A', 'B'])).toBe('A and B')
    expect(joinLabels(['A', 'B', 'C'])).toBe('A, B and C')
  })

  it('says hands are free only for an unattended host, checking the pan for a periodic one, nothing for hands-on', () => {
    expect(hostAttentionSentence('unattended')).toBe('Your hands are free.')
    expect(hostAttentionSentence('periodic')).toBe('Checking the pan now and then.')
    expect(hostAttentionSentence('hands_on')).toBeNull()
  })
})

describe('CookLanes markup', () => {
  const html = (name: string) => renderToStaticMarkup(createElement(CookLanes, { plan: derivePlan(named(name)) }))

  it('renders the heading, the sentence and the attention line for kadai', () => {
    const out = html('kadai-paneer')
    expect(out).toContain('How this cook goes')
    expect(out).toContain('While <b class="font-bold">Cook tomato base</b> is going (12 min), you can do: Cube capsicum, Cube paneer and Make kadai masala.')
    expect(out).toContain('Checking the pan now and then.')
  })

  it('renders one sentence per window for biryani, the first with "Your hands are free."', () => {
    const out = html('chicken-biryani')
    expect(out.split('While <b').length - 1).toBe(2)
    expect(out).toContain('Your hands are free.')
  })

  it('names no stove and promises nothing cooks on its own', () => {
    for (const name of ['kadai-paneer', 'chicken-biryani']) {
      const out = html(name)
      expect(out).not.toMatch(/stove|on its own|usually about/i)
    }
  })

  it('renders nothing when there is no parallel work', () => {
    for (const name of ['pumpkin-pancakes', 'maggi-2min', 'croissant', 'pizza-dough']) expect(html(name)).toBe('')
  })
})
