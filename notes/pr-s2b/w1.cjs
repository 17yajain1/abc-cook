// W1 capture: Home -> Copy sheet -> paste a (never fetched) YouTube link -> reading screen.
// Usage: node w1.cjs <outdir> [base]   (replay server on 8765, Vite on 5174 with VITE_API_BASE)
const fs = require('node:fs')
const path = require('node:path')
const { browser, homeGround, WEB } = require('./lib.cjs')

const out = process.argv[2]
const base = process.argv[3] || 'http://127.0.0.1:5174'
fs.mkdirSync(out, { recursive: true })
const RAW = { 'chole-bhature-low': 'known-wrong/chole-bhature.raw.json', croissant: 'croissant.raw.json', 'kadhi-pakora': 'kadhi-pakora.raw.json', 'pumpkin-pancakes': 'pumpkin-pancakes.raw.json' }
const FIX = process.env.FIX || 'chole-bhature-low'
const PARTWAY = +(process.env.N || 12)
const raw = JSON.parse(fs.readFileSync(path.join(WEB, '../api/tests/fixtures/import', RAW[FIX]), 'utf8'))
const THUMB = fs.readFileSync(path.join(__dirname, 'thumb.png'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
      h2: [...document.querySelectorAll('h2')].map(txt),
      draftLabels: [...document.querySelectorAll('span')].filter((s) => txt(s) === 'Draft').length,
      footer: footer ? txt(footer) : null,
      ingredientRows: document.querySelectorAll('li.border-b').length,
      steps: document.querySelectorAll('ol > li').length,
      aboutVisible: !!(ab && sc && ab.top < sc.bottom - 8),
      aboutTop: ab ? Math.round(ab.top) : null,
      scrollerBottom: sc ? Math.round(sc.bottom) : null,
      surface: document.documentElement.dataset.surface ?? null,
      rootBg: getComputedStyle(root).backgroundColor,
      bodyBg: getComputedStyle(document.body).backgroundColor,
    }
  })
}

;(async () => {
  const b = await browser()
  const ctx = await b.newContext({ viewport: { width: 360, height: 697 }, deviceScaleFactor: 2, colorScheme: 'light', reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  // No YouTube: the thumbnail and oEmbed are stubbed locally.
  await page.route(/i\.ytimg\.com/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: THUMB }))
  await page.route(/youtube\.com\/oembed/, (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: raw.title, author_name: raw.channel }) }),
  )
  const external = []
  page.on('request', (req) => { const u = req.url(); if (!/127\.0\.0\.1|^data:|^blob:/.test(u)) external.push(u) })

  await page.goto(base)
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await page.getByRole('button', { name: 'Paste a link' }).click()
  await page.getByLabel('Paste any URL').first().fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  const t0 = Date.now()
  await page.getByLabel('Paste any URL').first().press('Enter')
  const log = []
  const shot = async (name, note) => {
    const st = await state(page)
    st.t = +((Date.now() - t0) / 1000).toFixed(1)
    await page.screenshot({ path: path.join(out, `${name}.png`) })
    log.push({ name, note, ...st })
    console.log(name, JSON.stringify(st))
  }
  const at = async (sec) => { const w = sec * 1000 - (Date.now() - t0); if (w > 0) await sleep(w) }

  await at(1.0); await shot('0-header-only', 'instant header (thumbnail, oEmbed title)')
  await at(5.0); await shot('2-acquired-description', 'acquired + description, extraction not started')
  await at(7.0); await shot('1-wait-6s', 'skeletons, About this video visible')
  const waitFor = async (fn, arg, timeout = 60000) => page.waitForFunction(fn, arg, { timeout, polling: 100 })
  // ingredients draft partway through the list (list has 30 rows in kadhi)
  await waitFor((n) => document.querySelectorAll('li.border-b').length >= n, PARTWAY)
  await shot('3-ingredients-draft', 'ingredients partway through')
  await page.evaluate(() => { const s = document.querySelector('.overflow-y-auto'); s.scrollTop = s.scrollHeight })
  await sleep(250); await shot('3b-ingredients-draft-scrolled', 'scrolled to the newest row')
  await page.evaluate(() => { document.querySelector('.overflow-y-auto').scrollTop = 0 })
  await waitFor(() => document.querySelectorAll('ol > li').length >= 3)
  await page.evaluate(() => { const s = document.querySelector('.overflow-y-auto'); s.scrollTop = s.scrollHeight })
  await sleep(250); await shot('4-steps-filling', 'steps arriving (scrolled to newest)')
  await page.evaluate(() => { document.querySelector('.overflow-y-auto').scrollTop = 0 })
  await sleep(150); await shot('4b-steps-filling-top', 'same moment, top of the screen')
  fs.writeFileSync(path.join(out, 'log.json'), JSON.stringify({ log, external }, null, 2))
  console.log('external requests:', external.length ? external : 'none')
  await b.close()
})().catch((e) => { console.error(e); process.exit(1) })
