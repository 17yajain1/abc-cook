import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'

/**
 * R1 (2026-10-13): the recipe page and Home must never be wider than a phone screen. On
 * iOS Safari a page wider than the viewport is zoomed out, or opens cut off on the right.
 * Every fixture recipe is checked at each width, on both tabs, at the top and scrolled.
 * Also checked: text fields are at least 16px (iOS zooms in on focus below that), and the
 * compact bar shows back + title + tabs on screen with and without a notch inset, with
 * the title's own size, text and visibility checked.
 */

const WIDTHS = [360, 375, 393, 430]
const HEIGHT = 800

const FIXTURES = join(import.meta.dirname, '../src/__fixtures__')

/** Every `*.plan-response.json` fixture, wrapped as a saved Cookbook recipe. */
function fixtureLibrary(): string {
  const recipes = readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.plan-response.json'))
    .map((f) => {
      const name = f.replace('.plan-response.json', '')
      return {
        id: `fixture-${name}`,
        source_key: `fixture:${name}`,
        saved_at: '2026-10-13T00:00:00Z',
        updated_at: '2026-10-13T00:00:00Z',
        payload: JSON.parse(readFileSync(join(FIXTURES, f), 'utf8')) as unknown,
      }
    })
  return JSON.stringify({ version: 1, recipes })
}

const LIBRARY = fixtureLibrary()
const TITLES = (JSON.parse(LIBRARY) as { recipes: { payload: { graph: { title: string } } }[] }).recipes.map(
  (r) => r.payload.graph.title,
)

async function openHome(page: Page, width: number) {
  await page.setViewportSize({ width, height: HEIGHT })
  await page.goto('/')
  await page.evaluate((lib) => {
    localStorage.clear()
    localStorage.setItem('abc-cook:library:v1', lib)
  }, LIBRARY)
  await page.reload()
  await expect(page.getByTestId('app-shell')).toBeVisible()
}

/** The page's scroll width vs its visible width, plus any recipe-page element whose
 *  right edge passes the screen edge (the recipe page has no intentionally clipped art). */
async function overflow(page: Page, checkElements: boolean) {
  return page.evaluate((elements) => {
    const doc = document.documentElement
    const vw = doc.clientWidth
    const offenders = elements
      ? [...document.querySelectorAll('body *')]
          .filter((e) => {
            const r = e.getBoundingClientRect()
            return r.width > 0 && r.right > vw + 0.5
          })
          .map((e) => `${e.tagName.toLowerCase()} "${(e.textContent ?? '').trim().slice(0, 40)}"`)
      : []
    return { scrollWidth: doc.scrollWidth, clientWidth: vw, offenders }
  }, checkElements)
}

async function expectNoOverflow(page: Page, where: string, checkElements = true) {
  const o = await overflow(page, checkElements)
  expect(o.scrollWidth, `${where}: page is ${o.scrollWidth}px wide in a ${o.clientWidth}px viewport`).toBe(
    o.clientWidth,
  )
  expect(o.offenders, `${where}: elements past the right edge`).toEqual([])
}

async function scrollPlan(page: Page, to: 'top' | 'bottom') {
  await page.evaluate((where) => {
    const el = document.querySelector<HTMLElement>('.overflow-y-auto')
    if (el) el.scrollTop = where === 'top' ? 0 : el.scrollHeight
  }, to)
  await page.waitForTimeout(250)
}

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test('Home has no horizontal overflow', async ({ page }) => {
      await openHome(page, width)
      // Home's hero photo deliberately runs past its tile and is clipped by it, so only
      // the page width is checked here, not individual elements.
      await expectNoOverflow(page, 'Home', false)
    })

    test('text fields are at least 16px (no iOS focus zoom)', async ({ page }) => {
      await openHome(page, width)
      await page.getByRole('button', { name: 'Paste a link' }).click()
      const sizes = await page.evaluate(() =>
        [...document.querySelectorAll('input, textarea, select')].map((e) =>
          parseFloat(getComputedStyle(e).fontSize),
        ),
      )
      expect(sizes.length).toBeGreaterThan(0)
      for (const size of sizes) expect(size).toBeGreaterThanOrEqual(16)
    })

    test('recipe page has no horizontal overflow', async ({ page }) => {
      // Walks every fixture on both tabs: ~20-25 s of a 30 s default on WebKit, so a busy
      // machine tipped it over. 60 s is headroom, not a loosened check.
      test.setTimeout(60_000)
      await openHome(page, width)
      for (const title of TITLES) {
        await page.getByRole('button', { name: 'Cookbook', exact: true }).click()
        await page.locator('button, a, [role=button]').filter({ hasText: title }).first().click()
        await expect(page.getByRole('button', { name: 'Back' }).first()).toBeVisible()
        // The seeded v1 entries have no stamp, no original and no feed match, so they get
        // the staleness line offline, and (no import_meta reads as feed-like) no Re-import.
        await expect(page.getByText('may be out of date')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Re-import' })).toHaveCount(0)

        await expectNoOverflow(page, `${title} · Plan · top`)
        await page.evaluate(() =>
          document.querySelectorAll<HTMLElement>('button[aria-expanded="false"]').forEach((b) => b.click()),
        )
        await scrollPlan(page, 'bottom')
        await expectNoOverflow(page, `${title} · Plan · all open, scrolled`)

        await page.locator('button[aria-pressed]', { hasText: /^Ingredients/ }).first().click()
        await scrollPlan(page, 'top')
        await expectNoOverflow(page, `${title} · Ingredients · top`)
        await scrollPlan(page, 'bottom')
        await expectNoOverflow(page, `${title} · Ingredients · scrolled`)

        await page.getByRole('button', { name: 'Back' }).first().click()
        await expect(page.getByTestId('app-shell')).toBeVisible()
      }
    })

    for (const inset of [0, 47]) {
      test(`compact bar shows back, title and tabs on screen (top inset ${inset}px)`, async ({ page }) => {
        await openHome(page, width)
        // env() is always 0 on a desktop browser; index.css reads it through --safe-top.
        await page.evaluate((px) => document.documentElement.style.setProperty('--safe-top', `${px}px`), inset)
        await page.getByRole('button', { name: 'Cookbook', exact: true }).click()
        await page.locator('button, a, [role=button]').filter({ hasText: TITLES[0] }).first().click()
        // Opening a saved recipe now awaits the staleness check (a lazy chunk), so wait for
        // the page before scripting against it.
        await expect(page.getByRole('button', { name: 'Back' }).first()).toBeVisible()
        await page.evaluate(() =>
          document.querySelectorAll<HTMLElement>('button[aria-expanded="false"]').forEach((b) => b.click()),
        )
        await scrollPlan(page, 'bottom')

        const bar = page.getByTestId('compact-bar')
        await expect(bar).toBeVisible()

        // The title, specifically: on iOS Safari it once went blank while the arrow showed.
        const title = bar.getByText(TITLES[0], { exact: true })
        await expect(title).toBeVisible()
        await expect(title).toHaveText(TITLES[0])
        const shown = await title.evaluate((el) => {
          const r = el.getBoundingClientRect()
          const cs = getComputedStyle(el)
          const hit = document.elementFromPoint(r.left + Math.min(10, r.width / 2), r.top + r.height / 2)
          return { width: r.width, height: r.height, visibility: cs.visibility, opacity: cs.opacity, onTop: hit === el }
        })
        expect(shown.width, 'title has width').toBeGreaterThan(0)
        expect(shown.height, 'title has height').toBeGreaterThan(0)
        expect(shown.visibility).toBe('visible')
        expect(shown.opacity).toBe('1')
        expect(shown.onTop, 'nothing covers the title').toBe(true)
        for (const part of [
          bar.getByRole('button', { name: 'Back' }),
          bar.getByText(TITLES[0], { exact: true }),
          bar.locator('button[aria-pressed]').first(),
        ]) {
          const box = await part.boundingBox()
          expect(box, 'compact bar part is laid out').not.toBeNull()
          expect(box!.y).toBeGreaterThanOrEqual(inset)
          expect(box!.y + box!.height).toBeLessThanOrEqual(HEIGHT)
        }
      })
    }
  })
}
