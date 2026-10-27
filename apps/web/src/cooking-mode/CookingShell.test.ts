import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { CookingShell, MessageScreen } from './CookingShell'
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
  buildCookingView(model, se, now, ingredients, { recipeTitle: KADAI.graph.title })
const render = (v: CookingView, needExpanded = false) =>
  renderToStaticMarkup(
    createElement(CookingShell, {
      view: v,
      needExpanded,
      onPrimary: noop,
      onSecondary: noop,
      onLeave: noop,
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

  it('the waiting screen draws no need block even if rows are set (CP4: the handover screen is gone)', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    for (const id of ['chop_onion', 'chop_tomato', 'saute_onion'] as const) se = must(engine.markDone(se, model, id, T0 + 8 * MIN))
    se = must(engine.startNode(se, model, 'cook_tomato_base', T0 + 10 * MIN))
    for (const id of ['chop_capsicum', 'cube_paneer', 'make_kadai_masala'] as const) se = must(engine.markDone(se, model, id, T0 + 16 * MIN))
    const v = view(se, T0 + 23 * MIN)
    expect(v.layout).toBe('waiting')
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
    buildCookingView(dModel, se, now, dIngredients, { recipeTitle: DONUTS.graph.title, pageNumbers })
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

  it('no Plan ground or ink token is left on a step, waiting, ended, done or stale screen (bar the Meanwhile block\'s field)', () => {
    let se = must(engine.start(null, model, 'server:kadai', T0))
    const screens = [render(view(se, T0))]
    for (const id of ['chop_onion', 'chop_tomato', 'saute_onion'] as const) se = must(engine.markDone(se, model, id, T0))
    se = must(engine.startNode(se, model, 'cook_tomato_base', T0))
    screens.push(render(view(se, T0 + 30_000)))
    for (const id of ['chop_capsicum', 'cube_paneer', 'make_kadai_masala'] as const) se = must(engine.markDone(se, model, id, T0 + MIN))
    const wait = view(se, T0 + 2 * MIN)
    expect(wait.screenId).toBe('wait')
    screens.push(render(wait))
    const ended = view(se, T0 + 23 * MIN)
    expect(ended.waiting?.ended).toBe(true)
    screens.push(render(ended))
    const done = view(must(engine.markDone(se, model, 'finish', T0 + 24 * MIN)), T0 + 24 * MIN)
    expect(done.screenId).toBe('done')
    screens.push(render(done))
    const stale = view(must(engine.start(null, model, 'k', T0)), T0 + 3 * 24 * 60 * MIN)
    expect(stale.screenId).toBe('stale')
    screens.push(render(stale))
    for (const html of screens) {
      // CP4: the Meanwhile block sits on the recipe page's own `bg-field` (WaitWindowBlock),
      // on purpose; nothing else from the Plan register.
      expect(html.replaceAll('rounded-home-mini bg-field', '')).not.toMatch(/\b(bg|text|border)-(paper|ink|ink-2|ink-3|field|rule|signal)(\/\d+)?\b/)
    }
  })
})

describe('CookingShell — PR 2 CP3 step screens', () => {
  const DONUTS = homemadeDonuts as RecipePlanResponse
  const dModel = deriveCookingModel(DONUTS)
  const dIngredients = ingredientsById(DONUTS.graph.ingredients)
  const pageNumbers = stepNumbers(derivePlan(DONUTS).stages)
  const dView = (se: CookingSession, now: number) =>
    buildCookingView(dModel, se, now, dIngredients, { recipeTitle: DONUTS.graph.title, pageNumbers })
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

  it('timer sheet: on its own step the header says "Step N"; expired, "Time\'s up" and Add 5 min stays (CP4: from now)', () => {
    const se = must(engine.view(rising(), dModel, 'first_rise', T0))
    const html = sheetHtml({ mode: 'one', sheet: timerSheet(dModel, se, T0 + 61 * MIN, 'first_rise', order, 'first_rise')! })
    expect(html).not.toContain('Go to step')
    expect(html).toMatch(/>Step \d+<\/span>/)
    expect(html).toContain('Time&#x27;s up')
    expect(html).not.toContain('Ready around')
    expect(html).toContain('>Add 5 min</button>')
    expect(html).not.toContain('col-span-2')
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
    const html = renderToStaticMarkup(createElement(StepListSheet, { rows, onPick: noop, onClose: noop, onAction: noop }))
    expect(html).toMatch(/role="dialog" aria-label="All steps"/)
    expect(html).toContain('>All steps<')
    expect(html.match(/class="flex min-h-14/g)).toHaveLength(order.length)
    expect(html).toMatch(/<path d="M5 12l5 5L20 7"><\/path><\/svg><span class="sr-only">Step 1, done<\/span>/)
    expect(html).toMatch(/aria-current="step" class="[^"]*bg-home-peach[^"]*">.*?You are here/)
    expect(html).toMatch(/text-home-sage-chip-text"[^>]*>1 hr left</) // first rise, running
  })
})

describe('CookingShell — PR 2 CP4 non-step screens', () => {
  const DONUTS = homemadeDonuts as RecipePlanResponse
  const dModel = deriveCookingModel(DONUTS)
  const dIngredients = ingredientsById(DONUTS.graph.ingredients)
  const pageNumbers = stepNumbers(derivePlan(DONUTS).stages)
  const dView = (se: CookingSession, now: number, extra: { reviewing?: boolean; thumbnail?: string | null } = {}) =>
    buildCookingView(dModel, se, now, dIngredients, { recipeTitle: DONUTS.graph.title, pageNumbers, ...extra })
  const fresh = () => must(engine.start(null, dModel, 'server:donuts', T0))
  const footer = (html: string) => html.match(/<div data-footer="true"[^>]*>.*$/)![0]
  /** First rise viewed and running (ends T0+60); heat_oil also running (ends T0+12). */
  const waitingOnRise = () => {
    let se = must(engine.startNode(fresh(), dModel, 'first_rise', T0))
    se = must(engine.startNode(se, dModel, 'heat_oil', T0))
    return must(engine.view(se, dModel, 'first_rise', T0))
  }

  it('waiting (V2Wait): the 26px step name, 52px minutes + "min left", Add 5 min, the 4px bar, the ready line', () => {
    const html = render(dView(waitingOnRise(), T0 + 12 * MIN - 30_000))
    expect(html).toMatch(/<h1 class="text-\[26px\] font-extrabold[^"]*"[^>]*>First rise<\/h1>/)
    expect(html).toMatch(/<span class="text-\[52px\] font-bold[^"]*">49<\/span><span class="text-\[18px\] font-semibold text-home-ink-2">min left<\/span>/)
    expect(html).toMatch(/<button type="button" class="h-11 px-1 text-\[16px\] font-bold text-home-terracotta-text">Add 5 min<\/button>/)
    expect(html).toMatch(/<div aria-hidden="true" class="flex h-1 bg-home-rule"><div class="bg-home-terracotta" style="width:19\.\d%"><\/div><\/div>/)
    expect(html).toMatch(/Ready around [^<]+\. We&#x27;ll ring when it&#x27;s done\./)
    // The other timer keeps its rail; this one's is hidden.
    expect(html).toContain('aria-label="Heat oil, 1 min left. Open timer"')
    expect(html).not.toContain('First rise, ')
  })

  it('waiting: "Meanwhile, do these" on the field ground, a 44px button per task; "When it\'s done"; "It\'s done" in the footer', () => {
    const html = render(dView(waitingOnRise(), T0 + MIN))
    expect(html).toMatch(/<div data-meanwhile="true" class="rounded-home-mini bg-field[^"]*"><div class="text-\[16px\] font-extrabold text-home-ink">Meanwhile, do these<\/div>/)
    expect(html).toMatch(/<button type="button" class="[^"]*min-h-11[^"]*"><span[^>]*>\d+<\/span><span class="[^"]*text-home-ink">Grease tray<\/span><\/button>/)
    expect(html).toMatch(/aria-label="When it&#x27;s done: step \d+, Roll and cut\. Go to it"/)
    expect(footer(html)).toMatch(/>Back<\/button><button[^>]*bg-home-terracotta[^>]*>It&#x27;s done<\/button>/)
  })

  it('waiting: a done task has the sage tick and "Done", its name in ink-2', () => {
    const se = must(engine.markDone(waitingOnRise(), dModel, 'grease_pan', T0 + MIN))
    const html = render(dView(must(engine.view(se, dModel, 'first_rise', T0 + MIN)), T0 + 2 * MIN))
    expect(html).toMatch(/<span class="[^"]*text-home-ink-2">Grease tray<\/span><span class="[^"]*text-home-sage-chip-text"[^>]*><svg[^>]*>.*?<\/svg>Done<\/span>/)
  })

  it('waiting: Undo sits outside the footer (the footer is byte-identical with and without it)', () => {
    const se = waitingOnRise()
    const withUndo = render(dView(se, T0 + 1_000))
    const without = render(dView(se, T0 + 20_000))
    expect(withUndo).toContain('>Undo timer start on Heat oil</button>')
    expect(footer(withUndo)).toBe(footer(without))
  })

  it('banner (V2Banner): a terracotta role=status strip, 17/800 title, the 14px line, outlined +5 min and cream Done; raised over any sheet', () => {
    const se = must(engine.startNode(fresh(), dModel, 'heat_oil', T0))
    const html = render(dView(se, T0 + 12 * MIN + 10_000))
    const banners = html.match(/<div data-banners="true" class="([^"]*)">(.*?)<\/div><\/div><\/div>(?=<div aria-hidden="true" data-ticks)/)
    expect(banners).not.toBeNull()
    expect(banners![1]).toContain('relative z-30')
    expect(banners![2]).toMatch(/^<div role="status" class="[^"]*bg-home-terracotta[^"]*text-home-ground[^"]*"><div class="min-w-0 flex-1"><div class="text-\[17px\] font-extrabold[^"]*">Heat oil is ready<\/div><div class="text-\[14px\] opacity-\[\.88\]">Timer ended just now<\/div><\/div>/)
    expect(banners![2]).toMatch(/<button type="button" class="[^"]*border-\[1\.5px\] border-home-ground[^"]*">\+5 min<\/button><button type="button" class="[^"]*bg-home-ground[^"]*text-home-terracotta-text">Done<\/button>/)
  })

  it('CP4.1: only the banners are raised; a rail below them is not (it dims with the page under a sheet)', () => {
    expect(render(dView(must(engine.startNode(fresh(), dModel, 'heat_oil', T0)), T0))).not.toContain('z-30')
    let se = must(engine.startNode(fresh(), dModel, 'heat_oil', T0))
    se = must(engine.startNode(se, dModel, 'first_rise', T0))
    const html = render(dView(se, T0 + 13 * MIN))
    const strips = html.match(/<div data-strips="true" class="([^"]*)">/)!
    expect(strips[1]).not.toContain('z-30')
    expect(html).toMatch(/<div data-banners="true" class="[^"]*relative z-30[^"]*">.*?<\/button><\/div><\/div><button type="button" aria-label="First rise, 47 min left\. Open timer"/)
  })

  it('two banners stack, the one that ended first on top', () => {
    let se = must(engine.startNode(fresh(), dModel, 'heat_oil', T0))
    se = must(engine.startNode(se, dModel, 'proof_donuts', T0))
    const html = render(dView(se, T0 + 26 * MIN))
    expect(html.match(/role="status"/g)).toHaveLength(2)
    expect(html.indexOf('Heat oil is ready')).toBeLessThan(html.indexOf('Proof donuts is ready'))
  })

  it('CP4.1: a sheet\'s top sits below the banners: All steps by `top`, the timer sheet by its max height', () => {
    const rows = stepList(dModel, fresh(), T0, pageOrder(dModel, pageNumbers), 'bloom_yeast')
    const steps = renderToStaticMarkup(createElement(StepListSheet, { rows, onPick: noop, onClose: noop, onAction: noop, top: 213 }))
    expect(steps).toMatch(/role="dialog" aria-label="All steps" class="[^"]*" style="top:213px"/)
    const one = timerSheet(dModel, must(engine.startNode(fresh(), dModel, 'first_rise', T0)), T0, 'first_rise', pageOrder(dModel, pageNumbers), null)!
    const sheet = renderToStaticMarkup(createElement(TimerSheet, { content: { mode: 'one', sheet: one }, onAction: noop, onPick: noop, onClose: noop, top: 213 }))
    expect(sheet).toMatch(/role="dialog" aria-label="First rise timer" class="[^"]*" style="max-height:calc\(100% - 213px\)"/)
  })

  it('a banner takes the rail\'s slot: the footer is byte-identical before and after a timer ends', () => {
    const se = must(engine.startNode(fresh(), dModel, 'heat_oil', T0))
    expect(footer(render(dView(se, T0 + 11 * MIN)))).toBe(footer(render(dView(se, T0 + 13 * MIN))))
  })

  it('done (V2Done): the picture full width, 300px, cover; 40/800 at 88% width; the line; Back + Finished cooking', () => {
    const se = must(engine.markDone(fresh(), dModel, 'glaze_donuts', T0 + 82 * MIN))
    const html = render(dView(se, T0 + 82 * MIN + 20_000, { thumbnail: 'https://i.ytimg.com/vi/x/hqdefault.jpg' }))
    expect(html).toMatch(/<div class="flex h-full flex-col bg-home-ground"><div class="flex-shrink-0 pt-\[var\(--safe-top\)\]"><img src="https:\/\/i\.ytimg\.com\/vi\/x\/hqdefault\.jpg" alt="Homemade Glazed Donuts, from the recipe&#x27;s video" class="block aspect-video max-h-\[30vh\] w-full object-cover"\/>/)
    expect(html).toMatch(/<h1 class="text-\[40px\] font-extrabold[^"]*" style="font-stretch:88%">Homemade Glazed Donuts is done\.<\/h1><p class="text-\[17px\] text-home-ink-2">Done in 1 hr 22 min\.<\/p>/)
    expect(footer(html)).toMatch(/>Back<\/button><button[^>]*>Finished cooking<\/button>/)
    expect(html).not.toContain('Leave')
  })

  it('done without a picture: no img and no gap', () => {
    const se = must(engine.markDone(fresh(), dModel, 'glaze_donuts', T0 + 82 * MIN))
    const html = render(dView(se, T0 + 82 * MIN + 20_000))
    expect(html).not.toContain('<img')
    expect(html).toContain('<div class="flex-shrink-0 pt-[var(--safe-top)]"></div>')
  })

  it('done: Undo for 10 s, outside the footer', () => {
    const se = must(engine.markDone(fresh(), dModel, 'glaze_donuts', T0 + 82 * MIN))
    const withUndo = render(dView(se, T0 + 82 * MIN))
    expect(withUndo).toContain('>Undo</button>')
    expect(footer(withUndo)).toBe(footer(render(dView(se, T0 + 82 * MIN + 20_000))))
  })

  it('stale: the message layout, 34/800 at 88% width, Carry on (pill) and Start again (outlined)', () => {
    const html = render(dView(fresh(), T0 + 3 * 24 * 60 * MIN))
    expect(html).toMatch(/<h1 class="text-\[34px\] font-extrabold[^"]*" style="font-stretch:88%">You were last here \d+ hr( \d+ min)? ago\.<\/h1>/)
    // The CP4 form, with a breakable space before "ago.", is gone.
    expect(html).not.toMatch(/<h1 class="text-\[34px\] font-extrabold[^"]*" style="font-stretch:88%">You were last here \d+ hr( \d+ min)? ago\.<\/h1>/)
    expect(html).toMatch(/<button type="button" class="[^"]*bg-home-terracotta[^"]*">Carry on<\/button><button type="button" class="[^"]*border-home-terracotta[^"]*">Start again<\/button>/)
    // CP4.1: Leave in the stale screen's top bar; "ago." kept with the time.
    expect(html).toMatch(/<button type="button" class="h-11[^"]*">Leave<\/button>/)
    expect(html).toMatch(/ ago\.<\/h1>/)
  })

  it('conflict (MessageScreen): heading, line and two buttons, no top bar', () => {
    const html = renderToStaticMarkup(
      createElement(MessageScreen, {
        heading: 'You’re still cooking Kadai Paneer.',
        line: 'Pick one cook to carry on with.',
        primary: { label: 'Back to Kadai Paneer', onClick: noop },
        secondary: { label: 'End it and cook Homemade Donuts', onClick: noop },
      }),
    )
    expect(html).not.toContain('Leave')
    expect(html.match(/<button/g)).toHaveLength(2)
    expect(html).toMatch(/style="font-stretch:88%">You’re still cooking Kadai Paneer\.<\/h1><p class="text-\[17px\][^"]*">Pick one cook to carry on with\.<\/p>/)
  })

  it('All steps: "End this cook" at the foot; the confirm in place, "End cook" and "Keep cooking"', () => {
    const rows = stepList(dModel, fresh(), T0, pageOrder(dModel, pageNumbers), 'bloom_yeast')
    const closed = renderToStaticMarkup(createElement(StepListSheet, { rows, onPick: noop, onClose: noop, onAction: noop }))
    expect(closed).toMatch(/<div data-end-cook="true"[^>]*><div[^>]*><button[^>]*underline[^>]*>End this cook<\/button><\/div><\/div>/)
    const confirming = renderToStaticMarkup(createElement(StepListSheet, { rows, onPick: noop, onClose: noop, onAction: noop, confirmingEnd: true }))
    expect(confirming).toContain('>End this cook? Running timers will stop.</p>')
    expect(confirming).toMatch(/<button[^>]*bg-home-terracotta[^>]*>End cook<\/button><button[^>]*>Keep cooking<\/button>/)
    // CP4.1: the foot carries the bottom padding, safe-area inset included, so scrolling it
    // into view shows the whole confirm above the home indicator.
    expect(confirming).toMatch(/<div data-end-cook="true" class="[^"]*pb-\[calc\(24px\+var\(--safe-bottom\)\)\][^"]*">/)
    expect(confirming).not.toMatch(/overflow-y-auto pb-\[calc/)
  })

  it('no m:ss anywhere in cooking mode\'s rendered screens', () => {
    const htmls = [render(dView(waitingOnRise(), T0 + 59 * MIN + 30_000)), render(dView(must(engine.startNode(fresh(), dModel, 'heat_oil', T0)), T0 + 11 * MIN + 45_000))]
    for (const html of htmls) expect(html.replace(/\d{1,2}:\d{2}(\s| )?(AM|PM|am|pm)?/g, (m) => (/[AaPp]/.test(m) ? '' : m))).not.toMatch(/\b\d{1,2}:\d{2}\b/)
  })
})
