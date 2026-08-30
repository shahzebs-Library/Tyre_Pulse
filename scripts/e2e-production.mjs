import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const baseURL = (process.env.E2E_BASE_URL || 'http://127.0.0.1:4173').replace(/\/$/, '')
const identifier = process.env.E2E_USER_IDENTIFIER?.trim()
const password = process.env.E2E_USER_PASSWORD
const assetNo = process.env.E2E_ASSET_NO?.trim()
const requireAuth = process.argv.includes('--require-auth') || process.env.E2E_REQUIRE_AUTH === '1'

const missingCredentials = !identifier || !password
if (missingCredentials && requireAuth) {
  console.error('Authenticated E2E blocked: set E2E_USER_IDENTIFIER and E2E_USER_PASSWORD for a dedicated approved test user.')
  process.exit(2)
}

const browser = await chromium.launch({ headless: process.env.E2E_HEADLESS !== '0' })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'en-US',
})
const page = await context.newPage()
const browserErrors = []
page.on('pageerror', error => browserErrors.push(error.message))
page.on('console', message => {
  if (message.type() === 'error') browserErrors.push(message.text())
})

async function expectVisible(selector, description) {
  // The first Windows/CI Chromium launch can spend several seconds warming the
  // signed production chunks. This is a page readiness bound, not a test retry.
  await page.locator(selector).waitFor({ state: 'visible', timeout: 30_000 })
  console.log(`PASS ${description}`)
}

try {
  await page.goto(`${baseURL}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await expectVisible('#login-identifier', 'public login identifier is visible')
  await expectVisible('#login-password', 'public login password is visible')

  if (missingCredentials) {
    console.log('SKIP authenticated journeys: E2E_USER_IDENTIFIER/E2E_USER_PASSWORD are not set.')
    console.log('Public smoke test completed. Use npm run test:e2e:required in the production gate so missing credentials fail closed.')
    process.exitCode = browserErrors.length ? 1 : 0
  } else {
    await page.locator('#login-identifier').fill(identifier)
    await page.locator('#login-password').fill(password)
    await page.locator('form').filter({ has: page.locator('#login-password') }).locator('button[type="submit"]').click()
    await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 30_000 })
    console.log(`PASS approved test user authenticated (${page.url()})`)

    await page.goto(`${baseURL}/asset-management`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 20_000 })
    await expectVisible('main, [role="main"]', 'authenticated Assets route renders its application shell')

    if (assetNo) {
      await page.goto(`${baseURL}/asset-management/${encodeURIComponent(assetNo)}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
      await page.getByRole('button', { name: /^Full history/ }).waitFor({ state: 'visible', timeout: 30_000 })
      await page.getByRole('button', { name: /^Full history/ }).click()
      await page.getByText('Recorded events', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 })
      console.log(`PASS Asset Detail full-history journey (${assetNo})`)
    } else {
      console.log('SKIP Asset Detail data journey: E2E_ASSET_NO is not set to a seeded asset visible to the test user.')
    }

    if (browserErrors.length) {
      throw new Error(`Browser errors detected:\n${browserErrors.join('\n')}`)
    }
  }
} catch (error) {
  await mkdir('test-results', { recursive: true }).catch(() => {})
  await page.screenshot({ path: 'test-results/e2e-failure.png', fullPage: true }).catch(() => {})
  console.error(`FAIL ${error.message}`)
  process.exitCode = 1
} finally {
  await browser.close()
}
