/**
 * Real-screenshot capture for the Tyre Pulse guide.
 *
 * Runs your actual app in a headless browser, logs in, visits each screen and
 * saves a PNG into docs/screenshots/. These are real captures of YOUR data —
 * no mockups.
 *
 * One-time setup:
 *   npm i -D playwright
 *   npx playwright install chromium
 *
 * Run (against a running dev server, default http://localhost:5173):
 *   npm run dev            # in one terminal
 *   SHOT_ID=admin@you.com SHOT_PW=yourpassword npm run screenshots
 *
 * Optional env:
 *   SHOT_BASE   base URL (default http://localhost:5173)
 *   SHOT_ID     login identifier (username / email / employee id)
 *   SHOT_PW     login password
 *   SHOT_WIDTH  viewport width  (default 1440)
 *   SHOT_HEIGHT viewport height (default 900)
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'docs', 'screenshots')
mkdirSync(OUT, { recursive: true })

const BASE   = process.env.SHOT_BASE   || 'http://localhost:5173'
const ID     = process.env.SHOT_ID     || ''
const PW     = process.env.SHOT_PW     || ''
const WIDTH  = Number(process.env.SHOT_WIDTH)  || 1440
const HEIGHT = Number(process.env.SHOT_HEIGHT) || 900

// name -> route. Names match the image references in TYRE_PULSE_GUIDE.md.
const SCREENS = [
  ['dashboard',             '/'],
  ['tyre-records',          '/tyres'],
  ['upload',                '/upload'],
  ['inspections',           '/inspections'],
  ['inspection-planner',    '/inspection-planner'],
  ['pressure-intelligence', '/pressure-intel'],
  ['accidents',             '/accidents'],
  ['work-orders',           '/work-orders'],
  ['safety-compliance',     '/safety-compliance'],
  ['reports',               '/reports'],
  ['executive-report',      '/executive-report'],
  ['ai-command-center',     '/ai-command-center'],
  ['audit-trail',           '/audit-trail'],
]

async function main() {
  if (!ID || !PW) {
    console.error('Set SHOT_ID and SHOT_PW (login credentials). Example:\n  SHOT_ID=admin@you.com SHOT_PW=secret npm run screenshots')
    process.exit(1)
  }

  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 2, // crisp, retina-quality PNGs
  })
  const page = await ctx.newPage()

  // ── Login ──
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.locator('form input:not([type="password"])').first().fill(ID)
  await page.locator('input[type="password"]').first().fill(PW)
  await Promise.all([
    page.waitForLoadState('networkidle'),
    page.locator('button[type="submit"]').first().click(),
  ])
  // Give the app a moment to resolve session + first data load.
  await page.waitForTimeout(2500)

  if (page.url().includes('/login')) {
    console.error('Login did not complete — check SHOT_ID / SHOT_PW and that the account is approved.')
    await browser.close()
    process.exit(1)
  }

  // ── Capture each screen ──
  let ok = 0
  for (const [name, route] of SCREENS) {
    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 30000 })
      await page.waitForTimeout(1800) // let charts/animations settle
      const file = join(OUT, `${name}.png`)
      await page.screenshot({ path: file, fullPage: true })
      ok++
      console.log(`✓ ${name.padEnd(24)} ${route}`)
    } catch (e) {
      console.warn(`✗ ${name.padEnd(24)} ${route}  (${e.message.split('\n')[0]})`)
    }
  }

  await browser.close()
  console.log(`\nDone — ${ok}/${SCREENS.length} screenshots saved to docs/screenshots/`)
}

main().catch(e => { console.error(e); process.exit(1) })
