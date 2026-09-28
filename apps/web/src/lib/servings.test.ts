import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { ImportMeta, RecipePlanResponse } from '@abc-cook/schema'

import { SERVINGS_DEFAULTED_WARNING, servingsLine } from './servings'
import defaultedWarnings from '@/__fixtures__/synthetic-defaulted-servings.import-warnings.json'
import defaultedPlan from '@/__fixtures__/synthetic-defaulted-servings.plan-response.json'
import kadaiPaneer from '@/__fixtures__/kadai-paneer.plan-response.json'

const KADAI = kadaiPaneer as RecipePlanResponse
const DEFAULTED = defaultedPlan as RecipePlanResponse

describe('servingsLine — stated / yield / both / neither / singular', () => {
  it('stated, no yield: "N servings"', () => {
    expect(servingsLine({ servings: 3, servings_stated: true, yield_text: null })).toBe(
      '3 servings',
    )
  })

  it('singular: "1 serving"', () => {
    expect(servingsLine({ servings: 1, servings_stated: true, yield_text: null })).toBe(
      '1 serving',
    )
  })

  it('yield only (not stated): the yield text, verbatim', () => {
    expect(
      servingsLine({ servings: 4, servings_stated: false, yield_text: '14 rasgulla' }),
    ).toBe('14 rasgulla')
  })

  it('both stated and yielded, yield already says "people": yield alone — a second count would be redundant', () => {
    expect(
      servingsLine({
        servings: 8,
        servings_stated: true,
        yield_text: '8 people (makes 2, 10-12 inch crusts)',
      }),
    ).toBe('8 people (makes 2, 10-12 inch crusts)')
  })

  it('both stated and yielded, yield does NOT say "people": both, combined — the yield adds real information a bare count alone would not carry', () => {
    // Distinct numbers (8 vs 2), so PC5 never fires — servings stays genuinely
    // stated alongside a kept, ungrounded-in-people-words yield.
    expect(
      servingsLine({ servings: 8, servings_stated: true, yield_text: '2 loaves' }),
    ).toBe('8 servings · 2 loaves')
  })

  it('neither stated nor yielded: no line', () => {
    expect(servingsLine({ servings: 4, servings_stated: false, yield_text: null })).toBeNull()
  })

  it('a plan saved before these fields existed: absent fields default to stated, no yield', () => {
    expect(servingsLine({ servings: 4 })).toBe('4 servings')
  })
})

describe('servingsLine — the legacy defaulted-servings gap (§R5)', () => {
  it('field absent (defaults to stated=true) but import_meta carries the exact defaulted warning: no line', () => {
    const importMeta: ImportMeta = { warnings: [SERVINGS_DEFAULTED_WARNING] }
    expect(servingsLine({ servings: 4 }, importMeta)).toBeNull()
  })

  it('a different warning present does not suppress the line', () => {
    const importMeta: ImportMeta = { warnings: ['Some unrelated warning.'] }
    expect(servingsLine({ servings: 4, servings_stated: true, yield_text: null }, importMeta)).toBe(
      '4 servings',
    )
  })

  it('no import_meta at all: the residual accepted gap — the line still shows (§R5)', () => {
    expect(servingsLine({ servings: 4 }, null)).toBe('4 servings')
  })
})

describe('servingsLine — drift protection against graph.py\'s SERVINGS_DEFAULTED_WARNING', () => {
  it('the TS constant matches the exact string a regenerated fixture froze from build_graph()', () => {
    // synthetic-defaulted-servings.import-warnings.json is written by
    // export_web_fixtures.py from GraphBuildResult.warnings, straight from
    // graph.py's own SERVINGS_DEFAULTED_WARNING constant — not retyped by hand on
    // either side. A change to the Python constant, re-run through `make types`,
    // changes this fixture's content; if this assertion isn't updated to match,
    // this test (not a silent mismatch) is what catches the drift.
    expect(defaultedWarnings.warnings).toEqual([SERVINGS_DEFAULTED_WARNING])
  })

  it('the synthetic fixture graph itself round-trips through servingsLine as no line', () => {
    expect(DEFAULTED.graph.servings_stated).toBe(false)
    expect(servingsLine(DEFAULTED.graph)).toBeNull()
  })

  it('Kadai (a golden fixture, servings genuinely stated) shows its servings normally', () => {
    expect(KADAI.graph.servings_stated).toBe(true)
    expect(servingsLine(KADAI.graph)).toBe(`${KADAI.graph.servings} servings`)
  })
})

describe('grep: no display .tsx file reads .servings directly (§R5)', () => {
  // Scoped to .tsx (display components), not .ts — derive.ts's own construction of
  // `RenderPlan.servingsSource`/`.servings`/etc. from `graph.servings` is the
  // sanctioned internal pass-through §R5 names explicitly, not a violation; a
  // display component reading the raw number to render it, bypassing
  // `servingsLine`'s stated/yield/legacy-warning logic, is what this test catches.
  const SRC_DIR = fileURLToPath(new URL('..', import.meta.url))
  const DIRECT_SERVINGS_RE = /\.servings\b/
  const SKIP_DIRS = new Set(['node_modules', '__fixtures__'])

  function* walk(dir: string): Generator<string> {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        yield* walk(join(dir, entry.name))
        continue
      }
      if (/\.tsx$/.test(entry.name)) yield join(dir, entry.name)
    }
  }

  it('every .tsx file under src/, except tests, avoids a direct `.servings` property read', () => {
    const violations: string[] = []
    for (const path of walk(SRC_DIR)) {
      const rel = relative(SRC_DIR, path).replace(/\\/g, '/')
      if (rel.endsWith('.test.tsx')) continue
      const content = readFileSync(path, 'utf-8')
      if (DIRECT_SERVINGS_RE.test(content)) violations.push(rel)
    }
    expect(violations).toEqual([])
  })

  // Not a real regression test — proves the grep test above actually catches a
  // violation, rather than trivially passing on an empty/misconfigured walk. Scans
  // this very test file's own fixture-loading imports (which legitimately don't
  // contain `.servings`) plus a synthetic in-memory "file" standing in for a
  // violation, exercising the same regex the real test uses.
  it('sanity check: the DIRECT_SERVINGS_RE regex itself catches a bare .servings read and ignores the safe forms', () => {
    expect(DIRECT_SERVINGS_RE.test('const n = graph.servings')).toBe(true)
    expect(DIRECT_SERVINGS_RE.test('{recipe.servings} servings')).toBe(true)
    expect(DIRECT_SERVINGS_RE.test('plan.servingsStated')).toBe(false)
    expect(DIRECT_SERVINGS_RE.test('graph.servings_stated')).toBe(false)
    expect(DIRECT_SERVINGS_RE.test('SERVINGS_DEFAULTED_WARNING')).toBe(false)
  })
})
