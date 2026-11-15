// Shared helpers for the staging browser specs. Passwords are read at run time from the accounts file
// outside the repository and are never logged or written to evidence.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
// Prefer the machine's preinstalled Playwright (its browsers match); fall back to the project copy.
function loadPlaywright() {
  for (const p of [process.env.E2E_PLAYWRIGHT, '/opt/node22/lib/node_modules/playwright', 'playwright'].filter(Boolean)) {
    try { return require(p) } catch { /* try next */ }
  }
  throw new Error('Playwright not found')
}
const { chromium } = loadPlaywright()

const WEB = `http://127.0.0.1:${process.env.WEB_PORT || 5199}`
const DB = process.env.E2E_DB || 'tyrepulse_e2e'
const ACCOUNTS_FILE = process.env.E2E_ACCOUNTS_FILE
const EVIDENCE = process.env.E2E_EVIDENCE || path.join(__dirname, 'evidence')
const SCRATCH = process.env.E2E_SCRATCH_SHOTS || path.join(process.env.E2E_RUN || '/tmp', 'shots')
fs.mkdirSync(EVIDENCE, { recursive: true }); fs.mkdirSync(SCRATCH, { recursive: true })

function accounts() {
  const out = {}
  for (const line of fs.readFileSync(ACCOUNTS_FILE, 'utf8').split('\n')) {
    const p = line.split('|').map((s) => s.trim())
    if (p.length >= 5 && p[3].includes('@')) out[p[2]] = { company: p[0], role: p[1], username: p[2], email: p[3], password: p[4] }
  }
  return out
}
const ACC = accounts()

function sql(q) {
  return execFileSync('psql', ['-X', '-q', '-At', '-F', '\t', '-h', '127.0.0.1', '-p', process.env.PGPORT_E2E || '54329', '-U', 'postgres', '-d', DB, '-c', q], { encoding: 'utf8' }).trim()
}

// Console noise that comes from services that honestly do not exist locally (realtime, storage, edge functions).
const NOISE = [/realtime/i, /websocket/i, /\/functions\/v1\//, /\/storage\/v1\//, /501 \(Not Implemented\)/, /favicon/, /manifest/i, /service ?worker/i, /Failed to load resource.*501/]
const isNoise = (t) => NOISE.some((r) => r.test(t))

let browser
async function getBrowser() { if (!browser) browser = await chromium.launch(); return browser }
async function closeBrowser() { if (browser) await browser.close(); browser = null }

// A fresh signed-in context for one synthetic user. Signs in through the real login page.
async function signIn(username) {
  const a = ACC[username]
  if (!a) throw new Error(`no synthetic account ${username}`)
  const b = await getBrowser()
  const context = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, serviceWorkers: 'block' })
  const page = await context.newPage()
  const log = { console: [], failed: [], pageErrors: [] }
  page.on('console', (m) => { if (m.type() === 'error' && !isNoise(m.text())) log.console.push(m.text().slice(0, 400)) })
  page.on('pageerror', (e) => log.pageErrors.push(String(e.message).slice(0, 400)))
  page.on('response', (r) => {
    const u = r.url()
    if (r.status() >= 400 && (u.includes('/rest/v1') || u.includes('/auth/v1'))) log.failed.push(`${r.status()} ${r.request().method()} ${u.replace(/^https?:\/\/[^/]+/, '').slice(0, 220)}`)
  })
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('#login-identifier', a.email)
  await page.fill('#login-password', a.password)
  await page.click('button[type=submit].tpl-primary')
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 })
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
  // First sign-in shows the onboarding tour. Dismiss it the way a user would.
  const skip = page.getByRole('button', { name: 'Skip tour' }).first()
  if (await skip.waitFor({ state: 'visible', timeout: 4000 }).then(() => true, () => false)) { await skip.click(); await page.waitForTimeout(300) }
  return { context, page, log, account: a }
}

// Open a route and describe what the user sees.
async function openRoute(page, route, log) {
  const before = { c: log.console.length, f: log.failed.length, p: log.pageErrors.length }
  await page.goto(`${WEB}${route}`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(800)
  const text = (await page.locator('body').innerText().catch(() => '')) || ''
  const state = {
    url: new URL(page.url()).pathname,
    redirected: new URL(page.url()).pathname !== route,
    errorBoundary: /Something went wrong|ERR-[A-Z0-9]{6,}/.test(text),
    accessDenied: /Access Restricted|Access Denied|do(es)? not have (access|permission)|not authorized|No access/i.test(text),
    moduleUnavailable: /not available|turned off|under maintenance|Module unavailable|is disabled/i.test(text) && text.length < 1500,
    heading: ((await page.locator('h1').first().innerText().catch(() => '')) || '').trim().slice(0, 80),
    textLen: text.length,
    text,
    consoleErrors: log.console.slice(before.c),
    failedRequests: log.failed.slice(before.f),
    pageErrors: log.pageErrors.slice(before.p),
  }
  return state
}
const RAW_SQL = /(violates|constraint|null value in column|relation "|column "|duplicate key|syntax error|PGRST\d+|SQLSTATE|row-level security|invalid input syntax|42\d{3}|23\d{3})/i

module.exports = { WEB, ACC, sql, signIn, openRoute, closeBrowser, EVIDENCE, SCRATCH, RAW_SQL, isNoise }
