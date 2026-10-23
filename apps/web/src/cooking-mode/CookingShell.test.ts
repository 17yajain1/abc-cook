import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { CookingShell } from './CookingShell'
import { ingredientsById } from './quantity'
import { StepListSheet } from './StepListSheet'
import { pageOrder, stepList } from './stepPage'
import { runningTimers, timerSheet } from './timers'
import { TimerSheet, type TimerSheetContent } from './TimerSheet'
import { buildCookingView, type CookingView } from './viewModel'
import homemadeDonuts from '@/__fixtures__/homemade-donuts.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import kadhiPakora from '@/__fixtures__/kadhi-pakora.plan-response.json'
import * as engine from '@/cooking/engine'
import { deriveCookingModel } from '@/cooking/model'
import type { CookingSession, Rejected } from '@/cooking/types'
import { emphasisSpans } from '@/lib/stepEmphasis'
import { derivePlan } from '@/plan/derive'
import { stepNumbers } from '@/plan/stepNumbers'

/**
 * The shell, render layer. Static markup only (`react-dom/server`, already a dependency;
 * the repo's tests run with `environment: 'node'` and no jsdom). These are structural
 * assertions — which element, which text, which classes — not snapshots, so unrelated
 * copy or spacing changes do not break them. Layout and legibility are verified in the
 * real app, not here.
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
const render = (v: CookingView, needExpanded = false) =>
  renderToStaticMarkup(
    createElement(CookingShell, {
      view: v,
      needExpanded,
      onPrimary: noop,
      onSecondary: noop,
      onLeave: noop,
      onSheet: noop,
      onNavigate: noop,
      onAction: noop,
      onRail: noop,
      onSteps: noop,
      onExpandNeed: noop,
    }),
  )

/** The "You'll need" block, or null. */
function needBlock(html: string): string | null {
  const m = html.match(/<div data-need="true"[^>]*>.*?<\/div><\/div>(?=<|$)/)
  return m ? m[0] : null
}
/** [name, amount] per row. */
const needTexts = (html: string) =>
  [...html.matchAll(/<div data-need-row="true"[^>]*><span>(.*?)<\/span>(?:<b[^>]*>(.*?)<\/b>)?<\/div>/g)].map((m) => [
    m[1],
    m[2] ?? null,
  ])

describe("CookingShell — You'll need (CP3, replaces the F2 chips)", () => {
  it('task: a "You\'ll need" heading and one row per ingredient, name left, amount right in bold tabular', () => {
    const se = must(engine.start(null, model, 'server:kadai', T0))
    const html = render(view(se, T0))
    expect(html).toContain('You&#x27;ll need')
    expect(needTexts(html)).toEqual([['Onion', '2 medium']])
    expect(html).toMatch(/<b class="[^"]*tabular-nums[^"]*"[^>]*>2 medium<\/b>/)
    // Display only, and the old chip list is gone.
    expect(html).not.toMatch(/aria-label="Ingredients"/)
    expect(needBlock(html) ?? '').not.toMatch(/<button|<a |tabindex/)
  })

  it('several ingredients: every amount visible, one row each', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    se = must(engine.markDone(se, model, 'chop_onion', T0 + 3 * MIN))
    se = must(engine.markDone(se, model, 'chop_tomato', T0 + 3 * MIN))
    expect(needTexts(render(view(se, T0 + 3 * MIN)))).toEqual([
      ['Oil', '3 tbsp'],
      ['Ginger-garlic paste', '1 tbsp'],
    ])
  })

  it('a step with no ingredients renders no block at all', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    for (const id of ['chop_onion', 'chop_tomato', 'saute_onion'] as const) se = must(engine.markDone(se, model, id, T0 + 10 * MIN))
    se = must(engine.startNode(se, model, 'cook_tomato_base', T0 + 10 * MIN))
    for (const id of ['chop_capsicum', 'cube_paneer', 'make_kadai_masala'] as const) se = must(engine.markDone(se, model, id, T0 + 16 * MIN))
    se = must(engine.acknowledge(se, model, T0 + 22 * MIN))
    const v = view(se, T0 + 22 * MIN + 10_000)
    expect(v.label).toBe('Add veggies') // consumes only comp_* ids
    expect(render(v)).not.toContain('You&#x27;ll need')
  })

  it('Kadhi step 1 (eleven ingredients): the first five, then "Show 6 more ▾" as a terracotta link; expanded shows all eleven', () => {
    const KADHI = kadhiPakora as RecipePlanResponse
    const kModel = deriveCookingModel(KADHI)
    const v = buildCookingView(kModel, must(engine.start(null, kModel, 'k', T0)), T0, ingredientsById(KADHI.graph.ingredients), {
      recipeTitle: KADHI.graph.title,
      leaving: false,
    })
    const collapsed = render(v)
    expect(needTexts(collapsed)).toHaveLength(5)
    expect(needTexts(collapsed)[0]).toEqual(['Curd', '1 ½ cups'])
    const link = collapsed.match(/<button[^>]*class="([^"]*)"[^>]*>Show 6 more<span aria-hidden="true"[^>]*>▾<\/span><\/button>/)
    expect(link).not.toBeNull()
    for (const c of ['text-home-terracotta-text', 'text-[16px]', 'font-semibold']) expect(link![1].split(' ')).toContain(c)
    const open = render(v, true)
    expect(needTexts(open)).toHaveLength(11)
    expect(open).not.toContain('6 more')
  })

  it('an unscaled amount: ink-2, not bold, with its accessible label', () => {
    const v = view(must(engine.start(null, model, 'server:kadai', T0)), T0)
    const html = render({ ...v, need: [{ name: 'Stock', amount: '1 can', unscaled: true, label: 'Stock, 1 can — amount for 4 servings' }] })
    expect(html).toMatch(/<div data-need-row="true"[^>]*aria-label="Stock, 1 can — amount for 4 servings"[^>]*><span>Stock<\/span><span class="[^"]*text-home-ink-2[^"]*"[^>]*>1 can<\/span>/)
    expect(html).not.toMatch(/<b[^>]*>1 can<\/b>/)
  })

  it('handover is unchanged: no need block even if rows are set', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    for (const id of ['chop_onion', 'chop_tomato', 'saute_onion'] as const) se = must(engine.markDone(se, model, id, T0 + 8 * MIN))
    se = must(engine.startNode(se, model, 'cook_tomato_base', T0 + 10 * MIN))
    for (const id of ['chop_capsicum', 'cube_paneer', 'make_kadai_masala'] as const) se = must(engine.markDone(se, model, id, T0 + 16 * MIN))
    const v = view(se, T0 + 23 * MIN)
    expect(v.screenId).toBe('handover')
    const html = render(v)
    expect(html).not.toContain('You&#x27;ll need')
    expect(render({ ...v, need: [{ name: 'Onion', amount: '2', unscaled: false }] })).toBe(html)
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

  it('step 1: Up next is one button with its aria-label; no Back', () => {
    const html = render(dView(fresh(), T0))
    const name = dModel.nodes.mix_dough.label
    expect(html).toContain(`aria-label="Up next: step 2, ${name}. Go to it"`)
    expect(html).not.toMatch(/>Back</)
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
    screens.push(render(view(se, T0 + 30_000)))
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

describe('CookingShell — PR 2 CP3 step screens', () => {
  const DONUTS = homemadeDonuts as RecipePlanResponse
  const dModel = deriveCookingModel(DONUTS)
  const dIngredients = ingredientsById(DONUTS.graph.ingredients)
  const pageNumbers = stepNumbers(derivePlan(DONUTS).stages)
  const dView = (se: CookingSession, now: number) =>
    buildCookingView(dModel, se, now, dIngredients, { recipeTitle: DONUTS.graph.title, leaving: false, pageNumbers })
  const fresh = () => must(engine.start(null, dModel, 'server:donuts', T0))
  const rising = () => must(engine.startNode(fresh(), dModel, 'first_rise', T0))
  const footer = (html: string) => html.match(/<div data-footer="true"[^>]*>.*$/)![0]

  it('the rail: a 48px sage button under the top bar, above the ticks, with the design\'s aria-label', () => {
    const html = render(dView(rising(), T0 + 8 * MIN))
    const rail = html.match(/<button[^>]*aria-label="First rise, 52 min left. Open timer"[^>]*>.*?<\/button>/)
    expect(rail).not.toBeNull()
    for (const c of ['h-12', 'bg-home-sage']) expect(rail![0]).toContain(c)
    expect(rail![0]).toMatch(/rounded-full bg-home-terracotta/) // the dot
    expect(rail![0]).toContain('>First rise<')
    expect(rail![0]).toMatch(/text-home-sage-chip-text[^"]*"[^>]*>52 min left</)
    expect(html.indexOf('Open timer')).toBeLessThan(html.indexOf('data-ticks'))
    expect(html).not.toContain('What&#x27;s cooking')
  })

  it('no rail without a running timer; the summary rail is its own button (CP3.1: no dot, "N more timers", › at the right)', () => {
    expect(render(dView(fresh(), T0))).not.toContain('Open timer')
    let se = rising()
    se = must(engine.startNode(se, dModel, 'proof_donuts', T0))
    se = must(engine.startNode(se, dModel, 'heat_oil', T0))
    const html = render(dView(se, T0))
    expect(html.match(/Open timer"/g)).toHaveLength(1)
    const more = html.match(/<button[^>]*aria-label="2 more timers. Show all timers"[^>]*>(.*?)<\/button>/)
    expect(more).not.toBeNull()
    const [tag, inner] = [more![0].slice(0, more![0].indexOf('>') + 1), more![1]]
    for (const c of ['h-12', 'bg-home-sage']) expect(tag).toContain(c) // same height and ground as a timer rail
    expect(inner).not.toContain('bg-home-terracotta') // the dot means a running timer
    expect(inner).toMatch(/^<span[^>]*>2 more timers<\/span><span aria-hidden="true" class="[^"]*text-home-sage-chip-text[^"]*">›<\/span>$/)
  })

  it('"Step N of M" is a 32px button that opens All steps', () => {
    const html = render(dView(fresh(), T0))
    expect(html).toMatch(/<button[^>]*aria-label="Step 1 of 11. Show all steps"[^>]*class="[^"]*h-8[^"]*"[^>]*>(<svg[^>]*aria-hidden="true"[^>]*>.*?<\/svg>)Step 1 of 11<\/button>/)
  })

  it('bolding: the step text goes through EmphasisText (the recipe page\'s spans, inside the step text only)', () => {
    // The first Donuts step the recipe page's rule bolds anything in.
    const id = dModel.order.find((n) => {
      const consumed = dModel.nodes[n].consumes.flatMap((c) => (dIngredients.get(c) ? [dIngredients.get(c)!] : []))
      return emphasisSpans(dModel.nodes[n].instruction, consumed, 1).length > 0
    })!
    expect(id).toBeDefined()
    const info = dModel.nodes[id]
    const consumed = info.consumes.flatMap((c) => (dIngredients.get(c) ? [dIngredients.get(c)!] : []))
    const spans = emphasisSpans(info.instruction, consumed, 1)
    const html = render(dView(must(engine.view(fresh(), dModel, id, T0)), T0))
    const text = html.match(/<p class="max-w-\[350px\] text-\[24px\][^>]*>(.*?)<\/p>/)![1]
    const bold = [...text.matchAll(/<b class="font-bold text-home-ink">(.*?)<\/b>/g)].map((m) => m[1])
    expect(bold).toEqual(spans.map((s) => info.instruction.slice(s.start, s.end)))
  })

  it('cue: "Ready when:" in bold ink, then the cue as stored', () => {
    const se = must(engine.view(fresh(), dModel, 'first_rise', T0))
    expect(render(dView(se, T0))).toMatch(
      /<p class="[^"]*text-\[17px\][^"]*"><b class="font-bold text-home-ink">Ready when:<\/b> doubled in bulk, holds a dimple when poked<\/p>/,
    )
  })

  it('hands-off: the sage tag, the line, and a quiet "Mark as done" link; primary "Start 1-hr timer"', () => {
    const se = must(engine.view(fresh(), dModel, 'first_rise', T0))
    const html = render(dView(se, T0))
    expect(html).toMatch(/<span class="[^"]*bg-home-sage[^"]*text-\[13px\][^"]*">Hands-off<\/span><span>About 1 hr\. Start a timer, or just move on\.<\/span>/)
    expect(html).toMatch(/<button[^>]*>Mark as done<\/button>/)
    expect(html).toMatch(/<button[^>]*bg-home-terracotta[^>]*>Start 1-hr timer<\/button>/)
  })

  it('no "Skip for now" anywhere on a step page', () => {
    const se = must(engine.markDone(fresh(), dModel, 'bloom_yeast', T0))
    expect(render(dView(se, T0 + 20_000))).not.toContain('Skip for now')
  })

  it('Undo sits outside the footer: the footer markup is byte-identical with and without it; no reserved slot', () => {
    const se = must(engine.markDone(fresh(), dModel, 'bloom_yeast', T0))
    const withUndo = render(dView(se, T0 + 1_000))
    const without = render(dView(se, T0 + 20_000))
    expect(withUndo).toMatch(/<button[^>]*class="[^"]*h-11[^"]*truncate[^"]*"[^>]*>Undo Done on Bloom yeast<\/button>/)
    expect(without).not.toContain('Undo')
    expect(footer(withUndo)).toBe(footer(without))
    expect(without).not.toContain('min-h-[46px]')
    // While Undo shows, the scroll column makes room for it so nothing hides under it.
    expect(withUndo).toMatch(/overflow-y-auto[^"]*pb-11/)
    expect(without).not.toMatch(/overflow-y-auto[^"]*pb-11/)
  })

  const order = pageOrder(dModel, pageNumbers)
  const sheetHtml = (content: TimerSheetContent) =>
    renderToStaticMarkup(createElement(TimerSheet, { content, onAction: noop, onPick: noop, onClose: noop }))

  it('timer sheet: a dialog named for the timer; Go to step, minutes, unit, ready clock, bar, three buttons', () => {
    const sheet = timerSheet(dModel, rising(), T0 + 8 * MIN, 'first_rise', order, 'bloom_yeast')!
    const html = sheetHtml({ mode: 'one', sheet })
    expect(html).toMatch(/role="dialog" aria-label="First rise timer"/)
    expect(html).toMatch(/<button[^>]*>Go to step \d+<\/button>/)
    expect(html).toMatch(/>52<\/span><span[^>]*>min left<\/span>/)
    expect(html).toContain('Ready around ')
    expect(html).toMatch(/style="width:13.3%"/)
    for (const label of ['Add 5 min', 'Stop timer', 'It&#x27;s done']) expect(html).toContain(`>${label}</button>`)
    expect(html).toMatch(/<button type="button" aria-label="Close"[^>]*bg-home-ink\/40/) // the scrim
  })

  it('timer sheet: on its own step the header says "Step N"; expired, no Add 5 min and Stop spans the row', () => {
    const se = must(engine.view(rising(), dModel, 'first_rise', T0))
    const html = sheetHtml({ mode: 'one', sheet: timerSheet(dModel, se, T0 + 61 * MIN, 'first_rise', order, 'first_rise')! })
    expect(html).not.toContain('Go to step')
    expect(html).toMatch(/>Step \d+<\/span>/)
    expect(html).toContain('Time&#x27;s up')
    expect(html).not.toContain('Add 5 min')
    expect(html).toMatch(/col-span-2[^>]*>Stop timer</)
  })

  it('Timers list: every running timer as a row button, soonest first', () => {
    let se = rising()
    se = must(engine.startNode(se, dModel, 'proof_donuts', T0))
    const html = sheetHtml({ mode: 'all', rows: runningTimers(dModel, se, T0, order) })
    expect(html).toMatch(/role="dialog" aria-label="Timers"/)
    expect(html.indexOf('Proof donuts')).toBeLessThan(html.indexOf('First rise'))
    expect(html.match(/<button type="button" class="flex min-h-14/g)).toHaveLength(2)
  })

  it('All steps: one 56px row per page step; done has a tick, the viewed row is peach with "You are here"', () => {
    const se = must(engine.markDone(rising(), dModel, 'bloom_yeast', T0))
    const rows = stepList(dModel, se, T0, order, 'mix_dough')
    const html = renderToStaticMarkup(createElement(StepListSheet, { rows, onPick: noop, onClose: noop }))
    expect(html).toMatch(/role="dialog" aria-label="All steps"/)
    expect(html).toContain('>All steps<')
    expect(html.match(/class="flex min-h-14/g)).toHaveLength(order.length)
    expect(html).toMatch(/<path d="M5 12l5 5L20 7"><\/path><\/svg><span class="sr-only">Step 1, done<\/span>/)
    expect(html).toMatch(/aria-current="step" class="[^"]*bg-home-peach[^"]*">.*?You are here/)
    expect(html).toMatch(/text-home-sage-chip-text"[^>]*>1 hr left</) // first rise, running
  })
})
