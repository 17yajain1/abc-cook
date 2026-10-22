import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { derivePlan, hasParallelWork, type RenderPlan } from './derive'
import { multitaskNote } from './multitaskNote'
import { PlanAheadCard } from './PlanAheadCard'
import { PlanScreen } from './PlanScreen'

const FIXTURES = import.meta.glob('../__fixtures__/*.plan-response.json', { eager: true, import: 'default' }) as Record<
  string,
  RecipePlanResponse
>
const named = (name: string): RecipePlanResponse => FIXTURES[`../__fixtures__/${name}.plan-response.json`]
const screen = (name: string) =>
  renderToStaticMarkup(
    createElement(PlanScreen, { plan: derivePlan(named(name)), onBack: () => {}, onStartCooking: () => {} }),
  )

describe('multitaskNote (D5 revised)', () => {
  const entries = Object.entries(FIXTURES)

  it('exists exactly when the scheduler put a task in a wait window, for every fixture', () => {
    expect(entries.length).toBeGreaterThan(8)
    for (const [file, p] of entries) {
      expect(multitaskNote(derivePlan(p)) !== null, file).toBe(hasParallelWork(p))
    }
  })

  it('names no task to do meanwhile', () => {
    for (const [file, p] of entries) {
      const plan = derivePlan(p)
      const note = multitaskNote(plan)
      if (!note) continue
      for (const task of plan.stages.flatMap((s) => s.windows.flatMap((w) => w.tasks))) {
        expect(note.text.toLowerCase(), `${file} ${task.label}`).not.toContain(task.label.toLowerCase())
      }
    }
  })

  it('one window: "One chance to multitask: do your prep while {host} cooks (N min)." for a periodic host', () => {
    expect(multitaskNote(derivePlan(named('kadai-paneer')))!.text).toBe(
      'One chance to multitask: do your prep while cook tomato base cooks (12 min).',
    )
  })

  it('two windows: the count in words, the longest wait, "goes" for an unattended host', () => {
    const note = multitaskNote(derivePlan(named('chicken-biryani')))!
    expect(note.text).toMatch(/^Two chances to multitask: the longest is while soak rice goes \((about )?20 min\)\.$/)
  })

  it('says "goes", never "cooks", for an unattended host, and spells counts up to ten', () => {
    const plan = derivePlan(named('chicken-biryani'))
    expect(multitaskNote(plan)!.text).not.toContain(' cooks ')
    const w = plan.stages.flatMap((s) => s.windows)[0]
    const many = { stages: [{ ...plan.stages[0], windows: Array.from({ length: 3 }, (_, i) => ({ ...w, id: `x${i}` })) }] }
    expect(multitaskNote(many as unknown as RenderPlan)!.text.startsWith('Three chances to multitask')).toBe(true)
  })

  it('the first window id is the first Meanwhile block in drawing order', () => {
    for (const name of ['kadai-paneer', 'chicken-biryani', 'kadhi-pakora']) {
      const plan = derivePlan(named(name))
      expect(multitaskNote(plan)!.firstWindowId).toBe(plan.stages.flatMap((s) => s.windows)[0].id)
    }
  })
})

describe('the note on the page', () => {
  it('shows with a See where link when something can be done while waiting, and the scroll target exists', () => {
    for (const name of ['kadai-paneer', 'chicken-biryani', 'kadhi-pakora']) {
      const out = screen(name)
      const id = multitaskNote(derivePlan(named(name)))!.firstWindowId
      expect(out, name).toContain('chance')
      expect(out, name).toContain('to multitask')
      expect(out, name).toContain('See where')
      expect(out, name).toContain(`data-meanwhile="${id}"`)
    }
  })

  it('is absent, with no section, when there is nothing to slot in', () => {
    for (const name of ['pumpkin-pancakes', 'maggi-2min', 'croissant', 'pizza-dough']) {
      const out = screen(name)
      expect(out, name).not.toContain('to multitask')
      expect(out, name).not.toContain('See where')
      expect(out, name).not.toContain('How this cook goes')
      expect(out, name).not.toContain('data-meanwhile')
    }
  })

  it('keeps croissant plan-ahead card with no multitask line', () => {
    const out = screen('croissant')
    expect(out).toContain('Plan ahead')
  })
})

describe('PlanAheadCard merges, never doubles', () => {
  const card = { title: 'Plan ahead: 3 hands-free breaks, the longest ~1 hr', body: 'Start ~4 hr 45 min before you want to eat.' }
  const multitask = { text: 'One chance to multitask: do your prep while soak rice goes (20 min).', onSeeWhere: () => {} }
  const html = (props: Parameters<typeof PlanAheadCard>[0]) => renderToStaticMarkup(createElement(PlanAheadCard, props))
  const cards = (out: string) => out.split('bg-home-peach').length - 1

  it('is one card with the plan-ahead line first and the multitask line second', () => {
    const out = html({ card, multitask })
    expect(cards(out)).toBe(1)
    expect(out.indexOf('Plan ahead')).toBeGreaterThan(-1)
    expect(out.indexOf('Plan ahead')).toBeLessThan(out.indexOf('One chance to multitask'))
    expect(out).toContain('See where')
  })

  it('is one card with either line alone, and none with neither', () => {
    expect(cards(html({ card, multitask: null }))).toBe(1)
    expect(html({ card, multitask: null })).not.toContain('See where')
    expect(cards(html({ card: null, multitask }))).toBe(1)
    expect(html({ card: null, multitask: null })).toBe('')
  })
})
