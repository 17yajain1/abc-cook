import { describe, expect, it } from 'vitest'

import type { RecipePlanResponse } from '@abc-cook/schema'

import { deriveCookingModel } from './model'
import chickenBiryani from '@/__fixtures__/chicken-biryani.plan-response.json'
import homemadeDonuts from '@/__fixtures__/homemade-donuts.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import maggi2min from '@/__fixtures__/maggi-2min.plan-response.json'
import pizzaDough from '@/__fixtures__/pizza-dough.plan-response.json'
import strawberryShortcake from '@/__fixtures__/strawberry-shortcake.plan-response.json'
import syntheticTwoSittings from '@/__fixtures__/synthetic-two-sittings.plan-response.json'
import syntheticTwoWindows from '@/__fixtures__/synthetic-two-windows.plan-response.json'

const FIXTURES: [string, RecipePlanResponse][] = [
  ['kadai-paneer', kadaiPaneer as RecipePlanResponse],
  ['chicken-biryani', chickenBiryani as RecipePlanResponse],
  ['homemade-donuts', homemadeDonuts as RecipePlanResponse],
  ['pizza-dough', pizzaDough as RecipePlanResponse],
  ['synthetic-two-sittings', syntheticTwoSittings as RecipePlanResponse],
  ['synthetic-two-windows', syntheticTwoWindows as RecipePlanResponse],
  ['strawberry-shortcake', strawberryShortcake as RecipePlanResponse],
  ['maggi-2min', maggi2min as RecipePlanResponse],
]

// Test matrix row 1 — order is a permutation of `scheduled`, correctly sorted by
// `(start_min, occupies_cook ? 1 : 0, node_id)`, on every fixture.
describe('deriveCookingModel — order (row 1)', () => {
  it.each(FIXTURES)('%s: order is a permutation of plan.scheduled', (_name, payload) => {
    const model = deriveCookingModel(payload)
    expect(new Set(model.order)).toEqual(new Set(payload.plan.scheduled.map((s) => s.node_id)))
    expect(model.order.length).toBe(payload.plan.scheduled.length)
  })

  it.each(FIXTURES)('%s: order is sorted by (start_min, occupies_cook, node_id)', (_name, payload) => {
    const model = deriveCookingModel(payload)
    const scheduledByNode = new Map(payload.plan.scheduled.map((s) => [s.node_id, s]))

    // Tuple comparison by hand — JS's `<=` on arrays coerces to strings, which sorts
    // "10" before "9"; that silently passed a wrongly-ordered pair in an earlier draft
    // of this test.
    const compareKey = (a: readonly [number, number, string], b: readonly [number, number, string]): number =>
      a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2])

    for (let i = 1; i < model.order.length; i++) {
      const prev = scheduledByNode.get(model.order[i - 1])!
      const cur = scheduledByNode.get(model.order[i])!
      const prevKey: [number, number, string] = [prev.start_min, prev.occupies_cook ? 1 : 0, prev.node_id]
      const curKey: [number, number, string] = [cur.start_min, cur.occupies_cook ? 1 : 0, cur.node_id]
      expect(compareKey(prevKey, curKey)).toBeLessThanOrEqual(0)
    }
  })

  // Plan §K1's per-collision table (round 2, owner-reviewed) is the authoritative
  // resolution of every same-`start_min` tie; the narrative order list in plan §F1
  // (round 1) disagrees with it on one pair (biryani's t=4 tie) — see the CP1 report.
  // These pairwise checks assert the §K1 table's resolutions directly.
  it('kadai: cook_tomato_base (off) precedes chop_capsicum (on) at their shared start_min=10', () => {
    const model = deriveCookingModel(kadaiPaneer as RecipePlanResponse)
    expect(model.order.indexOf('cook_tomato_base')).toBeLessThan(model.order.indexOf('chop_capsicum'))
  })

  it('biryani: boil_spiced_water, soak_rice (off) precede slice_onions (on) at start_min=0', () => {
    const model = deriveCookingModel(chickenBiryani as RecipePlanResponse)
    const sliceOnions = model.order.indexOf('slice_onions')
    expect(model.order.indexOf('boil_spiced_water')).toBeLessThan(sliceOnions)
    expect(model.order.indexOf('soak_rice')).toBeLessThan(sliceOnions)
  })

  it('biryani: fry_birista (off) precedes chop_mint_coriander (on) at their shared start_min=4 (§K1)', () => {
    const model = deriveCookingModel(chickenBiryani as RecipePlanResponse)
    expect(model.order.indexOf('fry_birista')).toBeLessThan(model.order.indexOf('chop_mint_coriander'))
  })

  it('two-windows: simmer_stew, soak_dried_beans (off) precede dice_potatoes (on) at start_min=8', () => {
    const model = deriveCookingModel(syntheticTwoWindows as RecipePlanResponse)
    const dicePotatoes = model.order.indexOf('dice_potatoes')
    expect(model.order.indexOf('simmer_stew')).toBeLessThan(dicePotatoes)
    expect(model.order.indexOf('soak_dried_beans')).toBeLessThan(dicePotatoes)
  })

  it('two-windows: rest_bowl (off) precedes chop_fresh_herbs (on) at their shared start_min=37', () => {
    const model = deriveCookingModel(syntheticTwoWindows as RecipePlanResponse)
    expect(model.order.indexOf('rest_bowl')).toBeLessThan(model.order.indexOf('chop_fresh_herbs'))
  })
})

// Test matrix row 2 — consumers is the inverse of dependsOn; exactly one sink; sink is
// last in order.
describe('deriveCookingModel — consumers / sink (row 2)', () => {
  it.each(FIXTURES)('%s: consumers is the inverse of dependsOn', (_name, payload) => {
    const model = deriveCookingModel(payload)
    for (const node of Object.values(model.nodes)) {
      for (const dep of node.dependsOn) {
        expect(model.nodes[dep].consumers).toContain(node.id)
      }
    }
    for (const node of Object.values(model.nodes)) {
      for (const consumer of node.consumers) {
        expect(model.nodes[consumer].dependsOn).toContain(node.id)
      }
    }
  })

  it.each(FIXTURES)('%s: exactly one sink', (_name, payload) => {
    const model = deriveCookingModel(payload)
    const sinks = Object.values(model.nodes).filter((n) => n.isSink)
    expect(sinks).toHaveLength(1)
    expect(sinks[0].id).toBe(model.sinkId)
  })

  it.each(FIXTURES)('%s: sink is the last node in order', (_name, payload) => {
    const model = deriveCookingModel(payload)
    expect(model.order[model.order.length - 1]).toBe(model.sinkId)
  })
})
