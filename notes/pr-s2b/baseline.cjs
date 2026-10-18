const { library, browser, homeGround } = require('./lib.cjs')
const out = process.argv[2]; const base = process.argv[3] || 'http://127.0.0.1:5174'
const names = (process.env.NAMES || 'kadhi-pakora,pumpkin-pancakes,chicken-biryani').split(',')
;(async () => {
  const b = await browser()
  const ctx = await b.newContext({ viewport: { width: 360, height: 697 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto(base); await page.evaluate((l) => { localStorage.clear(); localStorage.setItem('abc-cook:library:v1', l) }, library(names)); await page.reload()
  console.log('body bg', await homeGround(page))
  const titles = await page.evaluate(() => 0)
  for (const n of names) {
    const title = JSON.parse(require('fs').readFileSync(require('path').join(require('./lib.cjs').WEB, `src/__fixtures__/${n}.plan-response.json`), 'utf8')).graph.title
    await page.getByRole('button', { name: 'Cookbook', exact: true }).click()
    await page.locator('button, a, [role=button]').filter({ hasText: title }).first().click()
    await page.locator('button[aria-pressed]', { hasText: /^Ingredients/ }).first().click()
    await page.waitForTimeout(500)
    console.log(n, JSON.stringify(await homeGround(page)))
    await page.locator('xpath=(//li/ancestor::div[contains(@class,"px-5") and contains(@class,"py-5")])[1]').screenshot({ path: `${out}/${n}.panel.png` })
    await page.screenshot({ path: `${out}/${n}.top.png` })
    await page.evaluate(() => { const el = document.querySelector('.overflow-y-auto'); if (el) el.scrollTop = el.scrollHeight })
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${out}/${n}.bottom.png` })
    await page.getByRole('button', { name: 'Back' }).first().click()
  }
  await b.close()
})().catch((e) => { console.error(e); process.exit(1) })
