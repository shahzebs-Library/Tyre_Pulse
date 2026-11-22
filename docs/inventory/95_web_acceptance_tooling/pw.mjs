// Playwright helper: one browser context per test user with a minted session injected
// into localStorage 'tp_auth' (src/lib/supabase.js AUTH_STORAGE_KEY) before the app loads.
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs'
import { session } from './jwt.mjs'
export const BASE = 'http://127.0.0.1:5199'
export const SHOTS = '/var/lib/tp-acc/web/shots'
let browser
export async function open(who, { width = 1440, height = 900, country = 'KSA' } = {}) {
  browser ??= await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width, height } })
  const s = session(who)
  await ctx.addInitScript(([v, c]) => {
    try {
      if (!sessionStorage.getItem('qa_init')) {
        localStorage.setItem('tp_auth', v); localStorage.setItem('tp_lang', 'en')
        if (c) { localStorage.setItem('tp_active_country', c); localStorage.setItem('tp_working_context', JSON.stringify({ country: c })) }
        sessionStorage.setItem('qa_init', '1')
      }
    } catch {}
  }, [JSON.stringify(s), country])
  const page = await ctx.newPage()
  const log = []
  page.on('console', (m) => { if (m.type() === 'error') log.push('console: ' + m.text().slice(0, 200)) })
  page.on('pageerror', (e) => log.push('pageerror: ' + String(e).slice(0, 200)))
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/rest/v1')) log.push(`http ${r.status()} ${r.request().method()} ${r.url().replace(/^.*rest\/v1/, '').slice(0, 140)}`) })
  return { ctx, page, log, token: s.access_token }
}
export async function shot(page, name) { await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }) }
export async function close() { await browser?.close() }
