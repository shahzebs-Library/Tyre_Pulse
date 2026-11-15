// Launch Chromium for the PDF harness. Uses the Playwright-managed browser when its
// version matches; otherwise the newest pre-installed Chromium under PLAYWRIGHT_BROWSERS_PATH.
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

export async function launch() {
  const args = ['--no-sandbox']
  try { return await chromium.launch({ args }) } catch { /* version mismatch: fall through */ }
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).filter((d) => /^chromium_headless_shell-\d+$/.test(d)).sort().reverse() : []
  for (const d of dirs) {
    const exe = path.join(base, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell')
    if (fs.existsSync(exe)) return chromium.launch({ executablePath: exe, args })
  }
  throw new Error('No Chromium found. Run: npx playwright install chromium')
}
