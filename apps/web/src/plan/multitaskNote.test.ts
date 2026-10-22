import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { derivePlan, hasParallelWork, type RenderPlan } from './derive'
import { hostPhrase } from './hostPhrase'
import { countWord, multitaskNote } from './multitaskNote'
import { PlanAheadCard } from './PlanAheadCard'
import { PlanScreen } from './PlanScreen'

const FIXTURES = import.meta.glob('../__fixtures__/*.plan-response.json', { eager: true, import: 'default' }) as Record<
  string,
  RecipePlanResponse
>
const named = (name: string): RecipePlanResponse => FIXTURES[`../__fixtures__/${name}.plan-response.json`]
// The clock is frozen: Thursday 22 Oct 2026, 6:07 pm.
const NOW = new Date(2026, 9, 22, 18, 7)
const screen = (name: string) =>
  renderToStaticMarkup(
    createElement(PlanScreen, { plan: derivePlan(named(name)), onBack: () => {}, onStartCooking: () => {}, now: NOW }),
  )

describe('multitaskNote', () => {
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
        const text = `${note.bold} ${note.detail ?? ''}`.toLowerCase()
        expect(text, `${file} ${task.label}`).not.toContain(task.label.toLowerCase())
      }
    }
  })

  it('one window: "You\'ll do {k} steps while {host phrase} ({N} min)."', () => {
    const note = multitaskNote(derivePlan(named('kadai-paneer')))!
    expect(note.bold).toBe("You'll do three steps while the tomato base cooks (12 min).")
    expect(note.detail).toBeNull()
  })

  it('two or more windows: a bold "other things cook" line and the longest wait in grey', () => {
    const note = multitaskNote(derivePlan(named('chicken-biryani')))!
    expect(note.bold).toBe("You'll do five steps while other things cook.")
    expect(note.detail).toBe('The longest wait is while the rice soaks (20 min).')
  })

  it('k is every window task, spelled out up to ten, then digits; one is singular', () => {
    expect([1, 2, 3, 10].map(countWord)).toEqual(['one', 'two', 'three', 'ten'])
    expect(countWord(11)).toBe('11')
    const plan = derivePlan(named('kadai-paneer'))
    const w = plan.stages.flatMap((s) => s.windows)[0]
    const one = { stages: [{ ...plan.stages[0], windows: [{ ...w, tasks: w.tasks.slice(0, 1) }] }] }
    expect(multitaskNote(one as unknown as RenderPlan)!.bold).toMatch(/^You'll do one step while/)
  })

  it('uses the sentence time format: minutes under an hour, "about 1 hr" from an hour', () => {
    const plan = derivePlan(named('kadai-paneer'))
    const w = plan.stages.flatMap((s) => s.windows)[0]
    const long = { stages: [{ ...plan.stages[0], windows: [{ ...w, hostDurationTypical: 60 }] }] }
    expect(multitaskNote(long as unknown as RenderPlan)!.bold).toContain('(about 1 hr)')
  })

  it('the first window id is the first Meanwhile block in drawing order', () => {
    for (const name of ['kadai-paneer', 'chicken-biryani', 'kadhi-pakora']) {
      const plan = derivePlan(named(name))
      expect(multitaskNote(plan)!.firstWindowId).toBe(plan.stages.flatMap((s) => s.windows)[0].id)
    }
  })

  it('names every fixture host either as "while the {thing} {verb}s" or by quoting the step', () => {
    for (const [file, p] of entries) {
      for (const w of derivePlan(p).stages.flatMap((s) => s.windows)) {
        const phrase = hostPhrase(w.hostLabel)
        expect(phrase, `${file} ${w.hostLabel}`).toMatch(/^(while the [\p{L}' -]+ [a-z]+|during ".+")$/u)
      }
    }
  })
})

describe('the note on the page', () => {
  it('shows with a See which link when something can be done while waiting, and the scroll target exists', () => {
    for (const name of ['kadai-paneer', 'chicken-biryani', 'kadhi-pakora']) {
      const out = screen(name)
      const id = multitaskNote(derivePlan(named(name)))!.firstWindowId
      expect(out, name).toContain("You&#x27;ll do ")
      expect(out, name).toContain('See which')
      expect(out, name).toContain(`data-meanwhile="${id}"`)
      expect(out, name).not.toContain('See where')
    }
  })

  it('is absent when there is nothing to slot in', () => {
    for (const name of ['pumpkin-pancakes', 'maggi-2min', 'pizza-dough']) {
      const out = screen(name)
      expect(out, name).not.toContain('You&#x27;ll do')
      expect(out, name).not.toContain('See which')
      expect(out, name).not.toContain('data-meanwhile')
    }
  })

  it('croissant: the plan-ahead card with the ready-around time and no multitask line', () => {
    const out = screen('croissant')
    expect(out).toContain('Start now and it&#x27;s ready around ')
    expect(out).toContain('free for most of it: 3 long breaks, the longest about 1 hr.')
    expect(out).not.toContain('See which')
    expect(out).not.toContain('Plan ahead:')
  })

  it('has no between-stage wait row that names a host step, and no attention line in the Meanwhile block', () => {
    for (const name of ['kadai-paneer', 'chicken-biryani', 'kadhi-pakora']) {
      const out = screen(name)
      expect(out, name).not.toContain('Your hands are free')
      expect(out, name).not.toContain('Checking the pan now and then')
      expect(out, name).not.toContain('room to spare')
      expect(out, name).not.toContain('Plenty of time')
    }
  })
})

describe('PlanAheadCard merges, never doubles', () => {
  const ahead = { bold: "Start now and it's ready around 11:00 pm.", detail: "You're free for most of it: 3 long breaks, the longest about 1 hr." }
  const multitask = { bold: "You'll do three steps while the rice soaks (20 min).", detail: null }
  const html = (props: Partial<Parameters<typeof PlanAheadCard>[0]>) =>
    renderToStaticMarkup(createElement(PlanAheadCard, { ahead: null, multitask: null, onSeeWhich: () => {}, ...props }))
  const cards = (out: string) => out.split('bg-home-peach').length - 1

  it('is one card: the plan-ahead bold line first, then grey lines, then the link', () => {
    const out = html({ ahead, multitask })
    expect(cards(out)).toBe(1)
    expect(out.split('font-bold').length - 1).toBe(1)
    expect(out.indexOf('Start now')).toBeLessThan(out.indexOf('free for most of it'))
    expect(out.indexOf('free for most of it')).toBeLessThan(out.indexOf('You&#x27;ll do three steps'))
    expect(out.indexOf('You&#x27;ll do three steps')).toBeLessThan(out.indexOf('See which'))
  })

  it('is one card with either note alone (the multitask line then bold), and none with neither', () => {
    expect(cards(html({ ahead }))).toBe(1)
    expect(html({ ahead })).not.toContain('See which')
    expect(cards(html({ multitask }))).toBe(1)
    expect(html({ multitask })).toContain('See which')
    expect(html({})).toBe('')
  })
})
