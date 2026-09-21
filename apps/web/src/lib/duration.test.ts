import { describe, expect, it } from 'vitest'

import type { PlanSummary, RecipePlanResponse, Session } from '@abc-cook/schema'

import {
  approxDurationPhrase,
  formatMinutes,
  formatRange,
  headerTiming,
  roundMin,
  roundTo5,
  roundTo15,
  roundUpTo5,
} from './duration'
import chickenBiryani from '@/__fixtures__/chicken-biryani.plan-response.json'
import homemadeDonuts from '@/__fixtures__/homemade-donuts.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'
import maggi from '@/__fixtures__/maggi-2min.plan-response.json'
import pizzaDough from '@/__fixtures__/pizza-dough.plan-response.json'
import strawberryShortcake from '@/__fixtures__/strawberry-shortcake.plan-response.json'
import syntheticTwoSittings from '@/__fixtures__/synthetic-two-sittings.plan-response.json'
import syntheticTwoWindows from '@/__fixtures__/synthetic-two-windows.plan-response.json'

describe('roundMin', () => {
  it('trims the scheduler 0.01-min quantum', () => {
    expect(roundMin(12.01)).toBe(12)
    expect(roundMin(8.99)).toBe(9)
    expect(roundMin(9)).toBe(9)
  })

  it('leaves zero alone — "0 min" is a real answer for a plan that saves nothing', () => {
    expect(roundMin(0)).toBe(0)
  })
})

describe('formatMinutes', () => {
  it('reads as bare minutes under an hour', () => {
    expect(formatMinutes(34)).toBe('34 min')
    expect(formatMinutes(59)).toBe('59 min')
  })

  it('switches to hours at 60 and drops a zero minute remainder', () => {
    expect(formatMinutes(60)).toBe('1 hr')
    expect(formatMinutes(120)).toBe('2 hr')
  })

  it('reads as hours and minutes above the hour', () => {
    expect(formatMinutes(78)).toBe('1 hr 18 min')
    expect(formatMinutes(145)).toBe('2 hr 25 min')
  })

  it('rounds before deciding the shape, so 59.6 is an hour not "59.6 min"', () => {
    expect(formatMinutes(59.6)).toBe('1 hr')
  })
})

describe('roundTo5 / roundUpTo5 / roundTo15 (M3.2)', () => {
  it('roundTo5 goes to the nearest multiple of 5', () => {
    expect(roundTo5(7)).toBe(5)
    expect(roundTo5(8)).toBe(10)
    expect(roundTo5(30)).toBe(30)
  })

  it('roundUpTo5 ceils — it never drops below the honest bound', () => {
    expect(roundUpTo5(9)).toBe(10)
    expect(roundUpTo5(46)).toBe(50)
    expect(roundUpTo5(50)).toBe(50)
  })

  it('roundTo15 goes to the nearest multiple of 15', () => {
    expect(roundTo15(535)).toBe(540)
    expect(roundTo15(1470)).toBe(1470)
    expect(roundTo15(7)).toBe(0)
  })
})

describe('formatRange (M3.2)', () => {
  it('collapses under 15 minutes to the plain typical time, no bucketing', () => {
    expect(formatRange(7, 9)).toBe('about 7 min')
  })

  it('shows a bare-minute range when the rounded bounds differ and stay under 120', () => {
    expect(formatRange(34, 46)).toBe('35–50 min')
  })

  it('collapses to "about N min" when both bounds round to the same 5-min bucket', () => {
    expect(formatRange(58, 59)).toBe('about 60 min')
  })

  it('switches to formatMinutes-style hours once the upper bound reaches 120', () => {
    expect(formatRange(138, 158)).toBe('2 hr 20 min – 2 hr 40 min')
  })

  it('is exactly the 120-minute boundary on the rounded upper bound: under it stays bare minutes, at it switches', () => {
    expect(formatRange(95, 111)).toBe('95–115 min') // highR rounds up to 115, still < 120
    expect(formatRange(95, 116)).toBe('1 hr 35 min – 2 hr') // highR rounds up to 120
  })
})

describe('approxDurationPhrase (M3.2)', () => {
  it('rounds to the nearest 15 minutes below the day cutoff', () => {
    expect(approxDurationPhrase(480)).toBe('8 hr')
  })

  it('reads as "a day" at 1200 minutes and beyond', () => {
    expect(approxDurationPhrase(1200)).toBe('a day')
    expect(approxDurationPhrase(1470)).toBe('a day')
  })

  it('stays under the day cutoff for a value that stays under it once rounded', () => {
    expect(approxDurationPhrase(1190)).toBe('19 hr 45 min')
  })
})

function session(overrides: Partial<Session>): Session {
  return {
    start_min: 0,
    end_min: 0,
    active_min: 0,
    node_ids: [],
    preceded_by_wait_min: null,
    elapsed_min: 0,
    elapsed_high_min: 0,
    preceded_by_host_node_ids: [],
    ...overrides,
  }
}

function summary(overrides: Partial<PlanSummary>): PlanSummary {
  return {
    active_min: 0,
    attended_min: 0,
    elapsed_min: 0,
    elapsed_high_min: 0,
    long_waits: [],
    sessions: [],
    ...overrides,
  }
}

describe('headerTiming — legacy fallback', () => {
  it('falls back to "{totalMin} total" with no secondary when summary is null', () => {
    expect(headerTiming(null, 34)).toEqual({ primary: '34 min total', secondary: null })
  })

  it('falls back the same way when summary is undefined', () => {
    expect(headerTiming(undefined, 78)).toEqual({ primary: '1 hr 18 min total', secondary: null })
  })

  it('falls back when a summary exists but reports no sessions', () => {
    expect(headerTiming(summary({ sessions: [] }), 20)).toEqual({
      primary: '20 min total',
      secondary: null,
    })
  })
})

describe('headerTiming — defensive guard for old saves', () => {
  it('clamps a last-session high bound below its low bound (pre-CP0 save)', () => {
    const s = summary({
      sessions: [session({ elapsed_min: 55, elapsed_high_min: 35 })],
    })
    // high < low would otherwise invert the range — clamped to the low bound instead.
    expect(headerTiming(s, 55).primary).toBe('about 55 min')
  })
})

describe('headerTiming — single sitting, hands-on secondary', () => {
  it('suppresses the hands-on line when rounded active time is under 5 minutes', () => {
    const s = summary({
      active_min: 2,
      sessions: [session({ elapsed_min: 30, elapsed_high_min: 40 })],
    })
    expect(headerTiming(s, 30).secondary).toBeNull()
  })

  it('shows "~N min hands-on" when active time is well under the lower bound', () => {
    const s = summary({
      active_min: 22,
      sessions: [session({ elapsed_min: 66, elapsed_high_min: 72 })],
    })
    expect(headerTiming(s, 66)).toEqual({ primary: '65–75 min', secondary: '~20 min hands-on' })
  })

  it('suppresses the hands-on line when the primary collapses to "about N min", not a range', () => {
    const s = summary({
      active_min: 2,
      sessions: [session({ elapsed_min: 7, elapsed_high_min: 9 })],
    })
    expect(headerTiming(s, 7)).toEqual({ primary: 'about 7 min', secondary: null })
  })

  it('suppresses the hands-on line when active time is not well under the lower bound', () => {
    const s = summary({
      active_min: 31,
      sessions: [session({ elapsed_min: 34, elapsed_high_min: 46 })],
    })
    expect(headerTiming(s, 34).secondary).toBeNull()
  })
})

describe('headerTiming — multi-sitting head-start secondary (Option A)', () => {
  it('is head-start, never both head-start and hands-on, whenever there is more than one sitting', () => {
    const s = summary({
      elapsed_min: 535,
      active_min: 3, // would otherwise pass the hands-on threshold on its own
      sessions: [
        session({ elapsed_min: 3, elapsed_high_min: 5 }),
        session({ elapsed_min: 52, elapsed_high_min: 58, preceded_by_wait_min: 480 }),
      ],
    })
    expect(headerTiming(s, 535)).toEqual({
      primary: '50–60 min',
      secondary: 'Start about 9 hr before you eat',
    })
  })

  it('reads "a day" for a >=1200-minute head start (pizza dough\'s overnight rise)', () => {
    const s = summary({
      elapsed_min: 1470,
      sessions: [
        session({ elapsed_min: 10, elapsed_high_min: 12 }),
        session({ elapsed_min: 10, elapsed_high_min: 15, preceded_by_wait_min: 270 }),
        session({ elapsed_min: 30, elapsed_high_min: 46, preceded_by_wait_min: 1150 }),
      ],
    })
    expect(headerTiming(s, 1470).secondary).toBe('Start about a day before you eat')
  })
})

describe('headerTiming — every shipped fixture', () => {
  const FIXTURES: [string, RecipePlanResponse, ReturnType<typeof headerTiming>][] = [
    [
      'kadai-paneer',
      kadaiPaneer as RecipePlanResponse,
      { primary: '35–50 min', secondary: null },
    ],
    ['maggi-2min', maggi as RecipePlanResponse, { primary: 'about 7 min', secondary: null }],
    [
      'chicken-biryani',
      chickenBiryani as RecipePlanResponse,
      { primary: '65–75 min', secondary: '~20 min hands-on' },
    ],
    [
      'homemade-donuts',
      homemadeDonuts as RecipePlanResponse,
      { primary: '2 hr 20 min – 2 hr 40 min', secondary: '~40 min hands-on' },
    ],
    [
      'strawberry-shortcake',
      strawberryShortcake as RecipePlanResponse,
      { primary: '45–60 min', secondary: '~25 min hands-on' },
    ],
    [
      'synthetic-two-windows',
      syntheticTwoWindows as RecipePlanResponse,
      { primary: '50–60 min', secondary: '~30 min hands-on' },
    ],
    [
      'pizza-dough',
      pizzaDough as RecipePlanResponse,
      { primary: '30–50 min', secondary: 'Start about a day before you eat' },
    ],
    [
      'synthetic-two-sittings',
      syntheticTwoSittings as RecipePlanResponse,
      { primary: '50–60 min', secondary: 'Start about 9 hr before you eat' },
    ],
  ]

  it.each(FIXTURES)('%s', (_slug, fixture, expected) => {
    expect(headerTiming(fixture.summary, fixture.plan.total_min)).toEqual(expected)
  })
})
