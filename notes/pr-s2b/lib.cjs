// Ad hoc Playwright helpers for PR-S2b (outside the app package; notes/ is gitignored).
const path = require('node:path')
const fs = require('node:fs')
const WEB = path.resolve(__dirname, '../../apps/web')
const { chromium } = require(path.join(WEB, 'node_modules/playwright-core'))
const FIX = path.join(WEB, 'src/__fixtures__')

function library(names) {
  const recipes = names.map((name) => ({
    id: `fixture-${name}`, source_key: `fixture:${name}`,
    saved_at: '2026-10-13T00:00:00Z', updated_at: '2026-10-13T00:00:00Z',
    payload: JSON.parse(fs.readFileSync(path.join(FIX, `${name}.plan-response.json`), 'utf8')),
  }))
  return JSON.stringify({ version: 1, recipes })
}
async function browser() { return chromium.launch({ channel: 'chrome' }) }
async function homeGround(page) {
  return page.evaluate(() => ({ surface: document.documentElement.dataset.surface ?? null, body: getComputedStyle(document.body).backgroundColor, root: getComputedStyle(document.getElementById('root')).backgroundColor }))
}
module.exports = { library, browser, homeGround, WEB }
