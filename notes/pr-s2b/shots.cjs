// PR-S2b screenshot scenarios (360x697, headless Chrome via the project's playwright-core).
//
//   node shots.cjs <scenario> <outdir>
//
// Needs Vite on 127.0.0.1:5174 started with VITE_API_BASE=http://127.0.0.1:8765. The replay API
// (apps/api/scripts/replay_server.py) is started and stopped per scenario by this script, with
// OPENAI_API_KEY and LLM_API_KEY set to invalid values in that child only, so nothing can spend.
// YouTube is never contacted: the thumbnail and the oEmbed request are answered locally.
// Before trusting a capture, every shot logs #root's computed background and data-surface.
const fs = require('node:fs')
const net = require('node:net')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { browser, WEB } = require('./lib.cjs')

const API_ROOT = path.resolve(WEB, '../api')
const PY = process.env.PYTHON || 'C:/Users/ashya/AppData/Local/Programs/Python/Python312/python.exe'
const BASE = process.env.BASE || 'http://127.0.0.1:5174'
const IMPORT_FIXTURES = path.join(API_ROOT, 'tests/fixtures/import')
const RAW = {
  'chole-bhature-low': 'known-wrong/chole-bhature.raw.json',
  croissant: 'croissant.raw.json',
  'kadhi-pakora': 'kadhi-pakora.raw.json',
}
const THUMB = fs.readFileSync(path.join(__dirname, 'thumb.png'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PASTE_TEXT =
  'Easy croissants. Ingredients: 1/3 cup warm water, 1 tbsp sugar, 1 tbsp dry yeast, 1/5 cup warm milk, ' +
  '2/3 tsp salt, 2 cups flour, 5 tbsp butter, 1 egg. Method: Mix the water, sugar and yeast and leave for ' +
  '10 minutes. Add the milk, salt and flour and knead the dough. Roll out, fold in the butter, cut into ' +
  'triangles, roll up, proof, glaze with egg and bake until golden.'

const SCENARIOS = {
  // 1, 2, 4, 5, 6, 7 and the top bar: a no-blog link, the whole way through
  'croissant-ok': { fixture: 'croissant', script: 'ok', run: runCroissant },
  // 3: ingredients partway through a long, grouped, Hindi list
  'chole-ok': { fixture: 'chole-bhature-low', script: 'ok', run: runChole },
  // 8a / 9a: the stream stalls after the ingredients and some steps arrived
  'stall-draft': { fixture: 'croissant', script: 'stall_after:3000', run: (c) => runStall(c, 'a') },
  // 8b / 9b: it stalls before anything could be read
  'stall-nodraft': { fixture: 'croissant', script: 'stall_after:5', run: (c) => runStall(c, 'b') },
  // 10: the first call is unparseable, the retry succeeds; the draft is frozen from call 1
  retry: { fixture: 'croissant', script: 'invalid_json,ok', run: runRetry },
  // 11: pasted text, no header
  paste: { fixture: 'croissant', script: 'ok', run: runPaste },
  // 12: a source with a blog recipe: preview + ready
  'blog-ready': { fixture: 'kadhi-pakora', script: 'ok', run: runBlog },
  // 14: everything done before the first poll: nothing was shown, so it opens by itself
  'auto-handoff': { fixture: 'croissant', script: 'ok', extra: ['--speed', '100'], run: runAuto },
  // 13: the connection drops mid-poll after something was read
  'network-error': { fixture: 'croissant', script: 'ok', run: runNetwork },
}

function waitPort(port, timeoutMs = 60000) {
  const end = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const s = net.connect(port, '127.0.0.1')
      s.once('connect', () => { s.destroy(); resolve() })
      s.once('error', () => { s.destroy(); Date.now() > end ? reject(new Error('API did not start')) : setTimeout(tryOnce, 500) })
    }
    tryOnce()
  })
}

async function startApi({ fixture, script, extra = [] }) {
  const env = { ...process.env, OPENAI_API_KEY: 'invalid-s2b', LLM_API_KEY: 'invalid-s2b', PYTHONPATH: API_ROOT }
  const child = spawn(PY, [path.join(API_ROOT, 'scripts/replay_server.py'), '--fixture', fixture, '--script', script, '--port', '8765', ...extra], {
    env, stdio: 'ignore', windowsHide: true,
  })
  await waitPort(8765)
  return child
}

async function state(page) {
  return page.evaluate(() => {
    const txt = (el) => (el.textContent ?? '').trim()
    const root = document.querySelector('#root')
    const footer = document.querySelector('[role=status]')
    const about = [...document.querySelectorAll('h2')].find((h) => txt(h) === 'About this video')
    const scroller = document.querySelector('.overflow-y-auto')
    const ab = about?.getBoundingClientRect()
    const sc = scroller?.getBoundingClientRect()
    return {
      h1: [...document.querySelectorAll('h1')].map(txt),
      h2: [...document.querySelectorAll('h2')].map(txt),
      draftLabels: [...document.querySelectorAll('span')].filter((s) => txt(s) === 'Draft').length,
      footer: footer ? txt(footer) : null,
      ingredientRows: document.querySelectorAll('li.border-b').length,
      steps: document.querySelectorAll('ol > li').length,
      aboutVisible: !!(ab && sc && ab.top < sc.bottom - 8),
      buttons: [...document.querySelectorAll('button')].map(txt).filter(Boolean),
      surface: document.documentElement.dataset.surface ?? null,
      rootBg: getComputedStyle(root).backgroundColor,
      bodyBg: getComputedStyle(document.body).backgroundColor,
    }
  })
}

async function newSession(fixture, out, { reducedMotion = 'reduce' } = {}) {
  fs.mkdirSync(out, { recursive: true })
  const raw = JSON.parse(fs.readFileSync(path.join(IMPORT_FIXTURES, RAW[fixture]), 'utf8'))
  const b = await browser()
  const ctx = await b.newContext({ viewport: { width: 360, height: 697 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion })
  const page = await ctx.newPage()
  await page.route(/i\.ytimg\.com/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: THUMB }))
  await page.route(/youtube\.com\/oembed/, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: raw.title, author_name: raw.channel }) }),
  )
  const log = []
  const consoleLines = []
  const polls = []
  page.on('console', async (m) => {
    if (!/import-timing/.test(m.text())) return
    try { consoleLines.push(JSON.stringify(await m.args()[1].jsonValue())) } catch { consoleLines.push(m.text()) }
  })
  page.on('response', async (res) => {
    if (res.request().method() === 'GET' && /:8765\/import\/[^/?]+$/.test(res.url())) {
      try {
        const j = await res.json()
        polls.push({ status: j.status, calls: j.draft?.calls ?? null, ing: j.draft?.ingredients?.length ?? 0, steps: j.draft?.steps?.length ?? 0 })
      } catch { /* aborted */ }
    }
  })
  const t0 = { v: 0 }
  const shot = async (name, note, opts = {}) => {
    const st = await state(page)
    st.t = +((Date.now() - t0.v) / 1000).toFixed(1)
    await page.screenshot({ path: path.join(out, `${name}.png`), ...opts })
    log.push({ name, note, ...st })
    console.log(name, JSON.stringify(st).slice(0, 330))
  }
  const at = async (sec) => { const w = sec * 1000 - (Date.now() - t0.v); if (w > 0) await sleep(w) }
  const waitFor = (fn, arg, timeout = 120000) => page.waitForFunction(fn, arg, { timeout, polling: 100 })
  const scrollTo = async (where) => {
    await page.evaluate((w) => { const s = document.querySelector('.overflow-y-auto'); if (s) s.scrollTop = w === 'top' ? 0 : s.scrollHeight }, where)
    await sleep(250)
  }
  const startLink = async () => {
    await page.goto(BASE)
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await page.getByRole('button', { name: 'Paste a link' }).click()
    await page.getByLabel('Paste any URL').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    t0.v = Date.now()
    await page.getByLabel('Paste any URL').press('Enter')
  }
  const finish = async () => {
    fs.writeFileSync(path.join(out, 'log.json'), JSON.stringify({ log, consoleLines, polls }, null, 2))
    await b.close()
  }
  return { b, ctx, page, raw, shot, at, waitFor, scrollTo, startLink, finish, log, polls, consoleLines, t0, sleep }
}

async function runCroissant({ fixture, out }) {
  const c = await newSession(fixture, out)
  const { page } = c
  await c.startLink()
  await c.at(5.0); await c.shot('02-acquired-description', 'acquired + description, extraction not started')
  await c.at(7.0); await c.shot('01-wait-6s', 'skeletons, About this video on the first screen')
  await c.waitFor(() => document.querySelectorAll('ol > li').length >= 3)
  await c.scrollTo('bottom'); await c.shot('04-steps-filling', 'steps arriving, scrolled to the newest')
  await c.scrollTo('top'); await c.shot('04b-steps-filling-top', 'same moment, top of the screen')
  // the top bar: solid Home ground, hairline once scrolled; nothing scrolls under Cancel
  await page.evaluate(() => { document.querySelector('.overflow-y-auto').scrollTop = 140 })
  await sleep(250)
  const bar = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /^(Cancel|Close)$/.test((b.textContent ?? '').trim()))
    const bar = btn.parentElement
    const cs = getComputedStyle(bar)
    const r = btn.getBoundingClientRect()
    return { bg: cs.backgroundColor, borderBottom: cs.borderBottomColor, h: Math.round(bar.getBoundingClientRect().height), btnH: Math.round(r.height), btnW: Math.round(r.width) }
  })
  console.log('top bar', JSON.stringify(bar)); c.log.push({ name: 'top-bar', ...bar })
  await c.shot('15-topbar-scrolled', 'content scrolled 140px: bar is solid Home ground, hairline showing')
  await page.evaluate(() => { document.querySelector('.overflow-y-auto').scrollTop = 0 })
  // ready
  await c.waitFor(() => [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === 'Your plan is ready'))
  const ready = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === 'Your plan is ready')
    const region = btn.closest('[role=status]')
    const r = btn.getBoundingClientRect()
    return { h: Math.round(r.height), w: Math.round(r.width), bottom: Math.round(r.bottom), vh: innerHeight, role: region?.getAttribute('role'), live: region?.getAttribute('aria-live'), top: [...document.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim())[0] }
  })
  console.log('ready button', JSON.stringify(ready)); c.log.push({ name: 'ready-button', ...ready })
  await sleep(300)
  await c.shot('05-ready', 'plan ready: sticky button, top control reads Close, draft still readable')
  await c.scrollTo('bottom'); await c.shot('05b-ready-scrolled', 'ready, scrolled: the button stays pinned')
  // saved at done, before any tap
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('abc-cook:library:v1') ?? '{"recipes":[]}').recipes.length)
  console.log('library entries before the tap:', saved); c.log.push({ name: 'saved-before-tap', recipes: saved })
  await page.getByRole('button', { name: 'Your plan is ready' }).click()
  await page.getByRole('button', { name: 'Back' }).first().waitFor()
  await sleep(500)
  await c.shot('06-recipe-after-tap', 'the recipe page after the tap')
  await page.locator('button[aria-pressed]', { hasText: /^Ingredients/ }).first().click()
  await sleep(400)
  await page.locator('xpath=(//li/ancestor::div[contains(@class,"px-5") and contains(@class,"py-5")])[1]').screenshot({ path: path.join(out, '07-ingredients-tab-panel.png') })
  await c.shot('07-ingredients-tab', 'the recipe page Ingredients tab')
  await sleep(200)
  console.log('timing', c.consoleLines.join(' | '))
  await c.finish()
  // the dot really animates when motion is allowed
  const b2 = await browser()
  const ctx2 = await b2.newContext({ viewport: { width: 360, height: 697 }, reducedMotion: 'no-preference' })
  const p2 = await ctx2.newPage()
  await p2.route(/i\.ytimg\.com/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: THUMB }))
  await p2.route(/youtube\.com\/oembed/, (r) => r.fulfill({ status: 404, body: '{}' }))
  await p2.goto(BASE); await p2.evaluate(() => localStorage.clear()); await p2.reload()
  await p2.getByRole('button', { name: 'Paste a link' }).click()
  await p2.getByLabel('Paste any URL').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  await p2.getByLabel('Paste any URL').press('Enter')
  await p2.waitForSelector('[role=status] span[aria-hidden=true]', { timeout: 20000 })
  const dot = await p2.evaluate(() => { const d = document.querySelector('[role=status] span[aria-hidden=true]'); const cs = getComputedStyle(d); return { animationName: cs.animationName, duration: cs.animationDuration, iteration: cs.animationIterationCount } })
  console.log('dot, motion allowed', JSON.stringify(dot))
  const p3 = await (await b2.newContext({ viewport: { width: 360, height: 697 }, reducedMotion: 'reduce' })).newPage()
  await p3.route(/i\.ytimg\.com/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: THUMB }))
  await p3.route(/youtube\.com\/oembed/, (r) => r.fulfill({ status: 404, body: '{}' }))
  await p3.goto(BASE); await p3.evaluate(() => localStorage.clear()); await p3.reload()
  await p3.getByRole('button', { name: 'Paste a link' }).click()
  await p3.getByLabel('Paste any URL').fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  await p3.getByLabel('Paste any URL').press('Enter')
  await p3.waitForSelector('[role=status] span[aria-hidden=true]', { timeout: 20000 })
  const dot2 = await p3.evaluate(() => { const d = document.querySelector('[role=status] span[aria-hidden=true]'); const cs = getComputedStyle(d); return { animationName: cs.animationName, duration: cs.animationDuration } })
  console.log('dot, reduced motion', JSON.stringify(dot2))
  fs.writeFileSync(path.join(out, 'dot.json'), JSON.stringify({ motionAllowed: dot, reduced: dot2, bar, ready, saved }, null, 2))
  await b2.close()
}

async function runChole({ fixture, out }) {
  const c = await newSession(fixture, out)
  await c.startLink()
  await c.waitFor((n) => document.querySelectorAll('li.border-b').length >= n, 12)
  await c.shot('03-ingredients-draft', 'ingredients partway through (grouped, Hindi, long)')
  await c.scrollTo('bottom'); await c.shot('03b-ingredients-draft-scrolled', 'scrolled to the newest rows')
  await c.finish()
}

async function runStall({ fixture, out }, which) {
  const c = await newSession(fixture, out)
  const { page } = c
  await c.startLink()
  await page.getByText(/recipe reader/).waitFor({ timeout: 150000 })
  await sleep(400)
  await c.shot(`08${which}-stall-${which === 'a' ? 'with' : 'no'}-draft`, 'unavailable on the Home ground')
  await c.scrollTo('bottom'); await c.shot(`08${which}b-scrolled`, 'scrolled')
  await c.scrollTo('top')
  await page.getByRole('button', { name: 'Try again' }).click()
  await sleep(500)
  await c.shot(`09${which}-try-again`, 'after Try again: a fresh reading screen')
  await c.finish()
}

async function runRetry({ fixture, out }) {
  const c = await newSession(fixture, out)
  const { page } = c
  await c.startLink()
  await c.at(30)
  await c.shot('10-retry-mid', 'about 30s: call 1 was unparseable, call 2 running; the draft is call 1\'s')
  await c.waitFor(() => [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === 'Your plan is ready'), null, 150000)
  await c.shot('10b-retry-ready', 'ready after the retry')
  const calls = Math.max(...c.polls.map((p) => p.calls ?? 0))
  let shrank = false
  for (let i = 1; i < c.polls.length; i++) if (c.polls[i].ing < c.polls[i - 1].ing || c.polls[i].steps < c.polls[i - 1].steps) shrank = true
  console.log('retry: max calls', calls, 'draft ever shrank?', shrank)
  c.log.push({ name: 'retry-summary', calls, shrank, polls: c.polls })
  await c.finish()
}

async function runPaste({ fixture, out }) {
  const c = await newSession(fixture, out)
  const { page } = c
  await page.goto(BASE); await page.evaluate(() => localStorage.clear()); await page.reload()
  await page.getByRole('button', { name: 'Paste a link' }).click()
  await page.getByText('Paste recipe text instead').first().click()
  await sleep(300)
  await c.shot('11a-paste-screen', 'the paste screen')
  await page.getByLabel('Recipe text').fill(PASTE_TEXT)
  c.t0.v = Date.now()
  await page.getByRole('button', { name: 'Get the plan' }).click()
  await sleep(1500)
  await c.shot('11b-paste-reading', 'pasted text: no header, sections from the start')
  await c.waitFor(() => document.querySelectorAll('li.border-b').length >= 4)
  await c.shot('11c-paste-draft', 'pasted text: the draft arrives')
  await c.waitFor(() => [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === 'Your plan is ready'), null, 150000)
  await c.shot('11d-paste-ready', 'pasted text: ready')
  await c.finish()
}

async function runBlog({ fixture, out }) {
  const c = await newSession(fixture, out)
  const { page } = c
  await c.startLink()
  await c.at(9); await c.shot('12a-blog-preview', 'blog recipe on screen (no Draft labels), PreviewFooter')
  await c.waitFor(() => [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').trim() === 'Your plan is ready'), null, 150000)
  await sleep(300)
  await c.shot('12b-blog-ready', 'preview + ready')
  await c.scrollTo('bottom'); await c.shot('12c-blog-ready-scrolled', 'scrolled')
  await c.finish()
}

async function runAuto({ fixture, out }) {
  const c = await newSession(fixture, out)
  const { page } = c
  await c.startLink()
  await page.getByRole('button', { name: 'Back' }).first().waitFor({ timeout: 30000 })
  await sleep(400)
  const tapped = await page.getByRole('button', { name: 'Your plan is ready' }).count()
  console.log('"Your plan is ready" buttons seen:', tapped)
  await c.shot('14-auto-handoff', 'done before anything was shown: the recipe page opened by itself')
  c.log.push({ name: 'auto-summary', readyButtonsSeen: tapped, timing: c.consoleLines })
  await c.finish()
}

async function runNetwork({ fixture, out }) {
  const c = await newSession(fixture, out)
  const { page } = c
  await c.startLink()
  await c.waitFor(() => document.querySelectorAll('ol > li').length >= 2)
  await page.route(/:8765\/import\/[^/?]+$/, (r) => r.abort())
  await page.getByText(/Could not reach the API/).waitFor({ timeout: 30000 })
  await sleep(400)
  await c.shot('13a-network-error-with-draft', 'connection lost mid-poll: message at the top, the draft kept below')
  await c.scrollTo('bottom'); await c.shot('13b-scrolled', 'scrolled')
  await c.finish()
}

;(async () => {
  const [name, out] = process.argv.slice(2)
  const sc = SCENARIOS[name]
  if (!sc || !out) { console.error('usage: node shots.cjs <' + Object.keys(SCENARIOS).join('|') + '> <outdir>'); process.exit(2) }
  const api = await startApi(sc)
  try {
    await sc.run({ ...sc, out })
  } finally {
    api.kill()
  }
})().catch((e) => { console.error(e); process.exit(1) })
