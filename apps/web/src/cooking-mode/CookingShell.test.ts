import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { CookingShell } from './CookingShell'
import { ingredientsById } from './quantity'
import { buildCookingView, type CookingView } from './viewModel'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import * as engine from '@/cooking/engine'
import { deriveCookingModel } from '@/cooking/model'
import type { CookingSession, Rejected } from '@/cooking/types'

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
  renderToStaticMarkup(createElement(CookingShell, { view: v, onPrimary: noop, onSecondary: noop, onLeave: noop, onSheet: noop }))

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
    expect(list).toMatch(/^<ul role="list" aria-label="Ingredients" class="mt-4 flex flex-wrap gap-1.5">/)
    expect(chipTexts(list!)).toEqual(['2 medium onion'])
    const li = list!.match(/<li class="([^"]*)"/)![1].split(' ')
    for (const c of ['rounded-control', 'border', 'px-2.5', 'py-[4.25px]', 'text-[14px]', 'leading-[1.25]', 'border-rule', 'text-ink']) {
      expect(li, c).toContain(c)
    }
    // Display only: nothing focusable or clickable inside the list.
    expect(list).not.toMatch(/<button|<a |tabindex|role="button"|onclick/i)
  })

  it('task with several ingredients: every amount and unit is visible, and the old quantity line is gone', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    se = must(engine.markDone(se, model, 'chop_onion', T0 + 3 * MIN))
    const html = render(view(se, T0 + 3 * MIN))
    expect(chipTexts(chipList(html)!)).toEqual(['3 tbsp oil', '1 tbsp ginger-garlic paste'])
    // The joined " · " quantity line is no longer rendered on the step screen.
    expect(html).not.toContain('3 tbsp oil · 1 tbsp ginger-garlic paste')
  })

  it('handsoff_pending: chips render on the pending hands-off start screen', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    se = must(engine.markDone(se, model, 'chop_onion', T0 + 3 * MIN))
    se = must(engine.markDone(se, model, 'saute_onion', T0 + 8 * MIN))
    se = must(engine.markDone(se, model, 'chop_tomato', T0 + 10 * MIN))
    const v = view(se, T0 + 10 * MIN)
    expect(v.screenId).toBe('handsoff_pending')
    expect(chipTexts(chipList(render(v))!)).toEqual(['salt to taste'])
  })

  it('a step with no ingredients renders no list at all', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    for (const id of ['chop_onion', 'saute_onion', 'chop_tomato'] as const) se = must(engine.markDone(se, model, id, T0 + 10 * MIN))
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
    se = must(engine.markDone(se, model, 'saute_onion', T0 + 8 * MIN))
    se = must(engine.markDone(se, model, 'chop_tomato', T0 + 10 * MIN))
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
