import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { CookingShell } from './CookingShell'
import { ingredientsById } from './quantity'
import { buildCookingView, type CookingView } from './viewModel'
import homemadeDonuts from '@/__fixtures__/homemade-donuts.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import * as engine from '@/cooking/engine'
import { deriveCookingModel } from '@/cooking/model'
import type { CookingSession, Rejected } from '@/cooking/types'
import { derivePlan } from '@/plan/derive'
import { stepNumbers } from '@/plan/stepNumbers'

/**
 * F2 ingredient chips, render layer. Static markup only (`react-dom/server`, already a
 * dependency; the repo's tests run with `environment: 'node'` and no jsdom). These are
 * structural assertions — which element, which text, which classes — not snapshots, so
 * unrelated copy or spacing changes do not break them. Layout and legibility are
 * verified in the real app, not here.
 */

const KADAI = kadaiPaneer as RecipePlanResponse
const model = deriveCookingModel(KADAI)
const ingredients = ingredientsById(KADAI.graph.ingredients)
const T0 = 1_700_000_000_000
const MIN = 60_000
const noop = () => {}

function must(result: CookingSession | Rejected): CookingSession {
  if (engine.isRejected(result)) throw new Error(`unexpected rejection: ${result.reason}`)
  return result
}
const view = (se: CookingSession, now: number) =>
  buildCookingView(model, se, now, ingredients, { recipeTitle: KADAI.graph.title, leaving: false })
const render = (v: CookingView) =>
  renderToStaticMarkup(createElement(CookingShell, { view: v, onPrimary: noop, onSecondary: noop, onLeave: noop, onSheet: noop, onNavigate: noop }))

/** The <ul> ingredient list, or null. */
function chipList(html: string): string | null {
  const m = html.match(/<ul[^>]*aria-label="Ingredients"[^>]*>.*?<\/ul>/)
  return m ? m[0] : null
}
const chipTexts = (list: string) => [...list.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((m) => m[1])

describe('CookingShell — F2 ingredient chips', () => {
  it('task: renders one non-interactive chip per ingredient in a labelled list, with the F2 box', () => {
    const se = must(engine.start(null, model, 'server:kadai', T0))
    const html = render(view(se, T0))
    const list = chipList(html)
    expect(list).not.toBeNull()
    expect(list).toMatch(/^<ul role="list" aria-label="Ingredients" class="flex flex-wrap gap-x-1.5 gap-y-1">/)
    expect(chipTexts(list!)).toEqual(['2 medium onion'])
    const li = list!.match(/<li class="([^"]*)"/)![1].split(' ')
    for (const c of ['rounded-control', 'border', 'px-2.5', 'py-[2.25px]', 'text-[14px]', 'leading-[1.25]', 'border-home-rule', 'text-home-ink']) {
      expect(li, c).toContain(c)
    }
    // Display only: nothing focusable or clickable inside the list.
    expect(list).not.toMatch(/<button|<a |tabindex|role="button"|onclick/i)
  })

  it('task with several ingredients: every amount and unit is visible, and the old quantity line is gone', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    se = must(engine.markDone(se, model, 'chop_onion', T0 + 3 * MIN))
    se = must(engine.markDone(se, model, 'chop_tomato', T0 + 3 * MIN)) // so saute_onion is the current step
    const html = render(view(se, T0 + 3 * MIN))
    expect(chipTexts(chipList(html)!)).toEqual(['3 tbsp oil', '1 tbsp ginger-garlic paste'])
    // The joined " · " quantity line is no longer rendered on the step screen.
    expect(html).not.toContain('3 tbsp oil · 1 tbsp ginger-garlic paste')
  })

  it('handsoff_pending: chips render on the pending hands-off start screen', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    se = must(engine.markDone(se, model, 'chop_onion', T0 + 3 * MIN))
    se = must(engine.markDone(se, model, 'chop_tomato', T0 + 10 * MIN))
    se = must(engine.markDone(se, model, 'saute_onion', T0 + 8 * MIN))
    const v = view(se, T0 + 10 * MIN)
    expect(v.screenId).toBe('handsoff_pending')
    expect(chipTexts(chipList(render(v))!)).toEqual(['salt to taste'])
  })

  it('a step with no ingredients renders no list at all', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    for (const id of ['chop_onion', 'chop_tomato', 'saute_onion'] as const) se = must(engine.markDone(se, model, id, T0 + 10 * MIN))
    se = must(engine.startNode(se, model, 'cook_tomato_base', T0 + 10 * MIN))
    for (const id of ['chop_capsicum', 'cube_paneer', 'make_kadai_masala'] as const) se = must(engine.markDone(se, model, id, T0 + 16 * MIN))
    se = must(engine.acknowledge(se, model, T0 + 22 * MIN))
    const v = view(se, T0 + 22 * MIN + 10_000)
    expect(v.screenId).toBe('task')
    expect(v.label).toBe('Add veggies') // consumes only comp_* ids
    expect(chipList(render(v))).toBeNull()
  })

  it('dark handover is unchanged: no chip list, and chips cannot reach it even if set', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    se = must(engine.markDone(se, model, 'chop_onion', T0 + 3 * MIN))
    se = must(engine.markDone(se, model, 'chop_tomato', T0 + 10 * MIN))
    se = must(engine.markDone(se, model, 'saute_onion', T0 + 8 * MIN))
    se = must(engine.startNode(se, model, 'cook_tomato_base', T0 + 10 * MIN))
    se = must(engine.markDone(se, model, 'chop_capsicum', T0 + 12 * MIN))
    se = must(engine.markDone(se, model, 'cube_paneer', T0 + 14 * MIN))
    se = must(engine.markDone(se, model, 'make_kadai_masala', T0 + 16 * MIN))
    const v = view(se, T0 + 23 * MIN)
    expect(v.screenId).toBe('handover')
    const html = render(v)
    expect(chipList(html)).toBeNull()
    expect(html).not.toContain('<li')
    // The non-step branch never reads `chips`: forcing a value changes nothing.
    expect(render({ ...v, chips: ['2 medium onion'] })).toBe(html)
  })
})

describe('CookingShell — PR 2 CP2 step page', () => {
  const DONUTS = homemadeDonuts as RecipePlanResponse
  const dModel = deriveCookingModel(DONUTS)
  const dIngredients = ingredientsById(DONUTS.graph.ingredients)
  const pageNumbers = stepNumbers(derivePlan(DONUTS).stages)
  const dView = (se: CookingSession, now: number) =>
    buildCookingView(dModel, se, now, dIngredients, { recipeTitle: DONUTS.graph.title, leaving: false, pageNumbers })
  const fresh = () => must(engine.start(null, dModel, 'server:donuts', T0))

  it('step 1: Up next is one button with its aria-label; no Back; the step line is plain text', () => {
    const html = render(dView(fresh(), T0))
    const name = dModel.nodes.mix_dough.label
    expect(html).toContain(`aria-label="Up next: step 2, ${name}. Go to it"`)
    expect(html).not.toMatch(/>Back</)
    expect(html).toMatch(/<span[^>]*>(<svg[^>]*aria-hidden="true"[^>]*>.*?<\/svg>)Step 1 of 11<\/span>/)
    expect(html).not.toMatch(/<button[^>]*>[^<]*(<svg[^>]*>.*?<\/svg>)?Step 1 of 11/)
  })

  it('step 2: Back is a button; the primary is the terracotta pill', () => {
    const se = must(engine.markDone(fresh(), dModel, 'bloom_yeast', T0))
    const html = render(dView(se, T0 + 20_000))
    expect(html).toMatch(/<button[^>]*>Back<\/button>/)
    expect(html).toMatch(/<button[^>]*class="[^"]*bg-home-terracotta[^"]*"[^>]*>Done<\/button>/)
  })

  it('ticks: one aria-hidden segment per page step', () => {
    const html = render(dView(fresh(), T0))
    const ticks = html.match(/<div aria-hidden="true" data-ticks="true"[^>]*>(.*?)<\/div><\/div>/)
    expect(ticks).not.toBeNull()
    expect(ticks![0].match(/<div class="h-\[3px\]/g)).toHaveLength(pageNumbers.size)
  })

  it('no Plan ground or ink token is left on a step, wait or handover screen', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    const screens = [render(view(se, T0))]
    for (const id of ['chop_onion', 'chop_tomato', 'saute_onion'] as const) se = must(engine.markDone(se, model, id, T0))
    se = must(engine.startNode(se, model, 'cook_tomato_base', T0))
    for (const id of ['chop_capsicum', 'cube_paneer', 'make_kadai_masala'] as const) se = must(engine.markDone(se, model, id, T0 + MIN))
    const wait = view(se, T0 + 2 * MIN)
    expect(wait.screenId).toBe('wait')
    screens.push(render(wait))
    const handover = view(se, T0 + 23 * MIN)
    expect(handover.screenId).toBe('handover')
    screens.push(render(handover))
    for (const html of screens) {
      expect(html).not.toMatch(/\b(bg|text|border)-(paper|ink|ink-2|ink-3|field|rule|signal)(\/\d+)?\b/)
    }
  })
})
