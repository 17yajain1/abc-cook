import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

/**
 * The staleness line sits directly under the recipe title, so it is on screen without
 * scrolling even for the longest fixture title and a plan-ahead card (a slot below the
 * header was off-screen there at 360px). The button is a 44px-tall tap target.
 */

const FIXTURES = join(import.meta.dirname, '../src/__fixtures__')
const HEIGHT = 800

function libraryWithLongTitle(): { json: string; title: string } {
  const payload = JSON.parse(readFileSync(join(FIXTURES, 'pizza-dough.plan-response.json'), 'utf8')) as {
    graph: { title: string; source: unknown }
    plan: { sessions?: unknown[] }
  }
  payload.graph.source = { kind: 'url', value: 'https://example.test/long', imported_at: '2026-10-01T00:00:00Z' }
  const entry = {
    id: 'long',
    source_key: 'url:https://example.test/long',
    saved_at: '2026-10-13T00:00:00Z',
    updated_at: '2026-10-13T00:00:00Z',
    // A real import carries import_meta, so no feed origin and Re-import is offered.
    import_meta: { warnings: [], review_recommended: false, sources: [], provenance: null, degraded: false },
    payload,
  }
  return { json: JSON.stringify({ version: 1, recipes: [entry] }), title: payload.graph.title }
}

for (const width of [360, 390]) {
  test(`${width}px: the staleness line and Re-import are on screen under the longest title`, async ({ page }) => {
    const { json, title } = libraryWithLongTitle()
    await page.setViewportSize({ width, height: HEIGHT })
    await page.goto('/')
    await page.evaluate((lib) => {
      localStorage.clear()
      localStorage.setItem('abc-cook:library:v1', lib)
    }, json)
    await page.reload()
    await page.getByRole('button', { name: 'Cookbook', exact: true }).click()
    await page.locator('button, a, [role=button]').filter({ hasText: title }).first().click()
    await expect(page.getByRole('button', { name: 'Back' }).first()).toBeVisible()

    const line = page.getByText('This plan may be out of date.')
    const button = page.getByRole('button', { name: 'Re-import' })
    await expect(line).toBeVisible()
    await expect(button).toBeVisible()

    const heading = await page.getByRole('heading', { level: 1 }).boundingBox()
    const lineBox = await line.boundingBox()
    const buttonBox = await button.boundingBox()
    expect(heading && lineBox && buttonBox).toBeTruthy()
    expect(lineBox!.y, 'directly under the title').toBeGreaterThanOrEqual(heading!.y + heading!.height - 1)
    expect(lineBox!.y - (heading!.y + heading!.height), 'close to the title').toBeLessThan(24)
    expect(buttonBox!.y + buttonBox!.height, 'button fully on screen without scrolling').toBeLessThanOrEqual(HEIGHT)
    expect(buttonBox!.height, 'tap target height').toBeGreaterThanOrEqual(44)
    // A6 stays hidden while the staleness line shows.
    await expect(page.getByText('Plan simplified')).toHaveCount(0)
  })
}
