import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const cdp = process.env.AUDIT_CDP || 'http://127.0.0.1:9222'
const origin = process.env.AUDIT_ORIGIN || 'https://www.tyrepulse.app'
const out = process.env.AUDIT_OUT || join(tmpdir(), `tyrepulse-production-audit-${new Date().toISOString().slice(0, 10)}`)
mkdirSync(out, { recursive: true })

const routes = [
  ['dashboard', '/'],
  ['action-center', '/action-center'],
  ['fleet-master', '/fleet'],
  ['assets', '/asset-management'],
  ['inspections', '/inspections'],
  ['work-orders', '/work-orders'],
  ['accidents', '/accidents'],
  ['stock', '/stock'],
  ['reports', '/reports'],
  ['integrations', '/integrations'],
  ['billing', '/billing'],
  ['settings', '/settings'],
  ['ai-command-center', '/ai-command-center'],
]

const browser = await chromium.connectOverCDP(cdp)
const context = browser.contexts()[0]
const page = context.pages().find(candidate => candidate.url().startsWith(origin))
if (!page) throw new Error(`No authenticated ${origin} page is open.`)

const consoleErrors = []
const pageErrors = []
const failedResponses = []
page.on('console', message => { if (message.type() === 'error') consoleErrors.push({ url: page.url(), text: message.text() }) })
page.on('pageerror', error => pageErrors.push({ url: page.url(), text: error.message }))
page.on('response', response => {
  if (response.status() >= 400) failedResponses.push({ page: page.url(), status: response.status(), url: response.url().replace(/\?.*$/, '') })
})

const results = []
for (let index = 0; index < routes.length; index += 1) {
  const [name, route] = routes[index]
  const startedAt = Date.now()
  let navigationError = null
  try {
    await page.goto(`${origin}${route}`, { waitUntil: 'domcontentloaded', timeout: 45_000 })
    await page.locator('h1, h2, [role="alert"]').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
    await page.waitForTimeout(500)
  } catch (error) {
    navigationError = error.message
  }
  const metrics = await page.evaluate(() => {
    const visible = element => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0
    }
    const text = document.body.innerText
    return {
      url: location.href,
      title: document.title,
      headings: [...document.querySelectorAll('h1,h2,h3')].filter(visible).slice(0, 12).map(element => element.textContent.trim()),
      buttons: [...document.querySelectorAll('button')].filter(visible).length,
      links: [...document.querySelectorAll('a')].filter(visible).length,
      tables: document.querySelectorAll('table').length,
      inputs: [...document.querySelectorAll('input,select,textarea')].filter(visible).length,
      unlabeledInputs: [...document.querySelectorAll('input,select,textarea')].filter(element => visible(element) && !element.labels?.length && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby')).length,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      loadingSignals: (text.match(/loading|please wait|skeleton/gi) || []).slice(0, 10),
      errorSignals: (text.match(/failed to|unable to|something went wrong|error loading|not configured|unavailable/gi) || []).slice(0, 10),
      emptySignals: (text.match(/no records|no data|nothing here|get started|no .* found/gi) || []).slice(0, 10),
      textSample: text.slice(0, 1_500),
    }
  }).catch(error => ({ evaluationError: error.message, url: page.url() }))
  const screenshot = join(out, `${String(index + 1).padStart(2, '0')}-${name}.png`)
  await page.screenshot({ path: screenshot, fullPage: false }).catch(() => {})
  results.push({ name, route, durationMs: Date.now() - startedAt, navigationError, ...metrics, screenshot })
}

await page.setViewportSize({ width: 390, height: 844 })
await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {})
await page.locator('h1, h2, [role="alert"]').first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {})
await page.waitForTimeout(500)
const mobile = await page.evaluate(() => ({
  url: location.href,
  horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
  visibleNavigation: [...document.querySelectorAll('nav,aside')].filter(element => {
    const rect = element.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }).length,
}))
mobile.screenshot = join(out, '14-dashboard-mobile.png')
await page.screenshot({ path: mobile.screenshot, fullPage: false })
await page.setViewportSize({ width: 1440, height: 900 })

const report = { generatedAt: new Date().toISOString(), origin, out, results, mobile, consoleErrors, pageErrors, failedResponses }
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({
  out,
  routes: results.map(({ name, url, durationMs, navigationError, horizontalOverflow, tables, inputs, unlabeledInputs, errorSignals, emptySignals }) => ({ name, url, durationMs, navigationError, horizontalOverflow, tables, inputs, unlabeledInputs, errorSignals, emptySignals })),
  mobile,
  consoleErrors: consoleErrors.length,
  pageErrors: pageErrors.length,
  failedResponses: failedResponses.length,
}, null, 2))
await browser.close()
