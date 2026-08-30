import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const base = process.env.AUDIT_BASE || 'http://127.0.0.1:5173'
const out = 'audit/web-2026-08-30'
mkdirSync(out, { recursive: true })

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const consoleErrors = []
const pageErrors = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()) })
page.on('pageerror', (e) => pageErrors.push(e.message))

await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(1500)
await page.screenshot({ path: `${out}/01-login-desktop.png`, fullPage: true })
const desktop = await page.evaluate(() => ({
  url: location.href,
  title: document.title,
  textLength: document.body.innerText.trim().length,
  headings: [...document.querySelectorAll('h1,h2,h3')].map((e) => ({ tag: e.tagName, text: e.textContent.trim() })),
  inputs: [...document.querySelectorAll('input')].map((e) => ({ type: e.type, name: e.name, label: e.labels?.[0]?.textContent?.trim() || '', aria: e.getAttribute('aria-label'), autocomplete: e.autocomplete })),
  buttons: [...document.querySelectorAll('button')].map((e) => ({ text: e.textContent.trim(), aria: e.getAttribute('aria-label'), disabled: e.disabled })),
  imagesWithoutAlt: [...document.querySelectorAll('img:not([alt])')].length,
  unlabeledInputs: [...document.querySelectorAll('input')].filter((e) => !e.labels?.length && !e.getAttribute('aria-label') && !e.getAttribute('aria-labelledby')).length,
  htmlLang: document.documentElement.lang,
  direction: document.documentElement.dir || getComputedStyle(document.documentElement).direction,
}))

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
const mobilePage = await mobile.newPage()
await mobilePage.goto(`${base}/login`, { waitUntil: 'domcontentloaded', timeout: 60000 })
await mobilePage.waitForTimeout(1000)
await mobilePage.screenshot({ path: `${out}/02-login-mobile.png`, fullPage: true })
const mobileMetrics = await mobilePage.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
  horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}))

let protectedRoute
try {
  await page.goto(`${base}/ai-command-center`, { waitUntil: 'commit', timeout: 5000 })
  await page.waitForTimeout(1500)
  protectedRoute = { requested: '/ai-command-center', landed: page.url() }
} catch (error) {
  protectedRoute = { requested: '/ai-command-center', landed: page.url(), error: error.message }
}

const result = { desktop, mobileMetrics, protectedRoute, consoleErrors, pageErrors }
writeFileSync(`${out}/browser-results.json`, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
await mobile.close()
await context.close()
await browser.close()
