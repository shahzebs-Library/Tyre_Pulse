/**
 * capture-marketing-screenshots.mjs
 *
 * Captures one real desktop screenshot per capability group advertised on the
 * marketing site, straight from the running application, and writes them into
 * marketing/public/screenshots/.
 *
 * WHY THIS EXISTS. The marketing site lists eight capability groups and shows
 * one picture, reused on two pages. /product, /industries, /pricing and
 * /security carry no visuals at all. The fix is real screens, not mockups: a
 * mockup of a product that exists is a worse lie than no picture, because a
 * buyer will compare it to the demo.
 *
 * PRIVACY. THIS IS THE PART THAT MATTERS. These screens contain live customer
 * data: asset numbers, site names, driver names, costs, job cards. Publishing
 * them on a public marketing site republishes that data to anyone, including
 * every crawler the site now invites. So:
 *
 *   - Run this against a DEMO organisation wherever you can.
 *   - Use --mask to paint over anything identifying that survives.
 *   - Look at every image before it is committed. The script prints a review
 *     checklist at the end and it is not decoration.
 *
 * The script never publishes anything. It writes files and stops.
 *
 * USAGE
 *   npx playwright install chromium          # once
 *   node scripts/capture-marketing-screenshots.mjs \
 *        --email you@example.com --password '...' \
 *        [--base https://www.tyrepulse.app] \
 *        [--only tyre-lifecycle,inspections] \
 *        [--mask ".user-name,.cost-cell"]
 *
 * Credentials may also come from APP_EMAIL and APP_PASSWORD so they never
 * appear in shell history.
 */
import { chromium } from 'playwright'
import { mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = resolve(ROOT, 'marketing/public/screenshots')

/**
 * 1600x900 matches the dimensions the marketing pages already declare on the
 * one existing screenshot, so a new image drops in without shifting layout.
 * deviceScaleFactor 2 gives a retina-sharp file; the pages downscale it.
 */
const VIEWPORT = { width: 1600, height: 900 }
const SCALE = 2

/**
 * Each capability group on the marketing site, mapped to the route that really
 * shows it. Every route here was verified to exist in src/App.jsx. The `slug`
 * becomes the filename that marketing/app/product/page.tsx looks for, so the
 * two stay in step.
 */
const TARGETS = [
  { slug: 'tyre-lifecycle', route: '/tyre-lifecycle', group: 'Tyre and fleet lifecycle' },
  { slug: 'workshop', route: '/workshop-live', group: 'Maintenance and workshop' },
  { slug: 'inspections', route: '/inspections', group: 'Digital inspections' },
  { slug: 'inventory', route: '/stock', group: 'Inventory and procurement' },
  { slug: 'approvals', route: '/approvals', group: 'Approvals and organization' },
  { slug: 'executive-report', route: '/board-overview', group: 'Reports and executive intelligence' },
  { slug: 'access-control', route: '/master-access-control', group: 'Access and tenant control' },
  { slug: 'ai-automation', route: '/ai-command-center', group: 'AI and automation' },
]

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const BASE = (arg('base') || process.env.APP_BASE_URL || 'https://www.tyrepulse.app').replace(/\/$/, '')
const EMAIL = arg('email') || process.env.APP_EMAIL
const PASSWORD = arg('password') || process.env.APP_PASSWORD
const ONLY = (arg('only') || '').split(',').map((s) => s.trim()).filter(Boolean)
const MASK = (arg('mask') || '').split(',').map((s) => s.trim()).filter(Boolean)

if (!EMAIL || !PASSWORD) {
  console.error('Need a login. Pass --email and --password, or set APP_EMAIL and APP_PASSWORD.')
  process.exit(2)
}

const targets = ONLY.length ? TARGETS.filter((t) => ONLY.includes(t.slug)) : TARGETS
if (!targets.length) {
  console.error(`--only matched nothing. Valid slugs: ${TARGETS.map((t) => t.slug).join(', ')}`)
  process.exit(2)
}

mkdirSync(OUT_DIR, { recursive: true })

/**
 * A page that redirected to the login screen, or to an access-denied screen,
 * means this account cannot reach that module. Capturing it anyway would put a
 * picture of a refusal on the marketing site, so it is skipped and reported.
 */
async function reachedTheModule(page, route) {
  const url = page.url()
  if (/\/login\b/.test(url)) return { ok: false, why: 'redirected to login' }
  if (!url.includes(route)) return { ok: false, why: `redirected to ${url.replace(BASE, '') || '/'}` }
  const denied = await page
    .locator('text=/access denied|not authorised|not authorized|no permission/i')
    .count()
    .catch(() => 0)
  if (denied > 0) return { ok: false, why: 'access denied for this account' }
  return { ok: true }
}

const captured = []
const skipped = []

const browser = await chromium.launch({ args: ['--no-sandbox'] })
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE })
const page = await ctx.newPage()

try {
  console.log(`Signing in to ${BASE}`)
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 45000 })
  await page.fill('input[type="email"], input[name="email"], input[placeholder*="email" i]', EMAIL)
  await page.fill('input[type="password"], input[name="password"], input[placeholder*="password" i]', PASSWORD)
  await page.click('button[type="submit"], button:has-text("Sign in"), button:has-text("Login")')
  await page.waitForURL((u) => !/\/login\b/.test(u.toString()), { timeout: 30000 })
  await page.waitForTimeout(3000)
  console.log('Signed in.\n')

  const maskLocators = MASK.map((sel) => page.locator(sel))

  for (const t of targets) {
    process.stdout.write(`${t.group.padEnd(38)} `)
    try {
      await page.goto(`${BASE}${t.route}`, { waitUntil: 'networkidle', timeout: 45000 })
      // Charts and paged tables settle after the network does.
      await page.waitForTimeout(4000)

      const reach = await reachedTheModule(page, t.route)
      if (!reach.ok) {
        skipped.push({ ...t, why: reach.why })
        console.log(`SKIPPED (${reach.why})`)
        continue
      }

      const file = resolve(OUT_DIR, `${t.slug}.png`)
      await page.screenshot({ path: file, mask: maskLocators })
      captured.push({ ...t, file })
      console.log('captured')
    } catch (err) {
      const why = String(err?.message || err).split('\n')[0]
      skipped.push({ ...t, why })
      console.log(`SKIPPED (${why})`)
    }
  }
} finally {
  await browser.close()
}

console.log(`\n${captured.length} captured, ${skipped.length} skipped, into marketing/public/screenshots/`)

if (skipped.length) {
  console.log('\nNot captured:')
  for (const s of skipped) console.log(`  ${s.slug.padEnd(20)} ${s.why}`)
  console.log('\nA skip is usually this account lacking that module, not a bug.')
  console.log('Re-run with an account that can reach it, or leave that group without a picture.')
}

if (captured.length) {
  console.log('\nBEFORE YOU COMMIT ANY OF THESE, look at each one and confirm:')
  console.log('  1. No real customer, driver or employee name is legible.')
  console.log('  2. No real money figure you would not put on a billboard.')
  console.log('  3. No asset number, plate, site or job card that identifies a client.')
  console.log('  4. Nothing in a header, avatar or breadcrumb naming the tenant.')
  console.log('  5. No open menu, tooltip or half-loaded skeleton mid-render.')
  console.log('\nAnything that fails, re-run with --mask "<css selector>" to paint over it,')
  console.log('or capture against a demo organisation instead.')
  console.log('\nNothing else to wire. /product finds these files by name at build time,')
  console.log('so committing the PNG is what makes the picture appear.')
}

process.exit(0)
