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
      for (const bar of [...lanes.you, ...lanes.running.flat()]) {
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
      const hosts = new Map(lanes.running.flat().map((h) => [h.id, h]))
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
      for (const row of lanes.running) {
        row.forEach((bar, i) => {
          if (i > 0) expect(bar.from, file).toBeGreaterThanOrEqual(row[i - 1].to)
        })
      }
    }
  })

  it('shows every step exactly once across the two lanes (a window task inside its meanwhile block)', () => {
    for (const [file, p] of entries) {
      const lanes = lanesOf(p)
      if (!lanes) continue
      const inYou = lanes.you.filter((b) => b.kind === 'step').map((b) => b.id)
      const inBlocks = p.plan.windows.flatMap((w) => w.assigned)
      const running = lanes.running.flat().map((b) => b.id)
      const all = [...inYou, ...inBlocks, ...running]
      expect(new Set(all).size, file).toBe(all.length)
      expect([...all].sort(), file).toEqual(p.plan.scheduled.map((s) => s.node_id).sort())
    }
  })

  it('keeps every host of a window in the second lane', () => {
    for (const [file, p] of entries) {
      const lanes = lanesOf(p)
      if (!lanes) continue
      const running = new Set(lanes.running.flat().map((b) => b.id))
      for (const w of p.plan.windows.filter((w) => w.assigned.length > 0)) expect(running.has(w.host_node_id), `${file} ${w.id}`).toBe(true)
    }
  })

  it('kadai: unchanged, one running step under the window block', () => {
    const lanes = lanesOf(named('kadai-paneer'))!
    expect(lanes.running.length).toBe(1)
    expect(lanes.running[0].map((b) => b.label)).toEqual(['Cook tomato base'])
    expect(lanes.you.filter((b) => b.kind === 'meanwhile').length).toBe(1)
    expect(lanes.you.filter((b) => b.kind === 'step').length).toBe(6)
  })

  it('biryani: every step that runs without the cook has a bar', () => {
    const lanes = lanesOf(named('chicken-biryani'))!
    expect(lanes.running.flat().map((b) => b.label).sort()).toEqual(
      ['Boil spiced water', 'Cook chicken', 'Dum cook', 'Fry birista', 'Marinate chicken', 'Parboil rice', 'Soak rice'].sort(),
    )
    expect(lanes.you.filter((b) => b.kind === 'meanwhile').length).toBe(2)
  })

  it('kadhi: its waits are shown', () => {
    const lanes = lanesOf(named('kadhi-pakora'))!
    expect(lanes.running.flat().length).toBeGreaterThan(0)
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
