// Helpers shared by the round 2 specs (work orders, recall tracker, closure review, checklist acknowledge).
const fs = require('fs')
const path = require('path')
const L = require('../lib.cjs')

const OUT = path.join(process.env.E2E_RUN || '/tmp', 'results_r2')
fs.mkdirSync(OUT, { recursive: true })
const save = (name, data) => fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(data, null, 2))

// SQL as the database owner with triggers off: fixture resets only, never an app path.
const fixtureSql = (q) => L.sql(`begin; set local session_replication_role = replica; ${q}; commit;`)

// Sign in and collect browser dialogs (the Work Orders page reports a refused save with window.alert).
async function session(username, opts = {}) {
  const s = await L.signIn(username)
  s.alerts = []
  s.page.on('dialog', async (d) => { s.alerts.push(d.message()); await d.accept().catch(() => {}) })
  if (opts.viewport) await s.page.setViewportSize(opts.viewport)
  return s
}

// The sidebar is a list of groups. Open every group and return every link the person is offered.
async function sidebarLinks(page) {
  const groups = page.locator('aside button, nav button')
  const n = await groups.count()
  const links = new Map()
  const grab = async () => {
    for (const a of await page.locator('aside a[href^="/"], nav a[href^="/"]').evaluateAll((as) => as.map((x) => [x.getAttribute('href'), x.innerText.trim().replace(/\s+/g, ' ')]))) links.set(a[0], a[1])
  }
  await grab()
  for (let i = 0; i < n; i++) {
    const b = groups.nth(i)
    if (!(await b.isVisible().catch(() => false))) continue
    await b.click({ timeout: 2000 }).catch(() => {})
    await page.waitForTimeout(150)
    await grab()
  }
  await page.keyboard.press('Escape').catch(() => {})
  return [...links.entries()].map(([href, text]) => ({ href, text }))
}

// A form control by the text of its label (the label and the control are siblings in these forms).
const control = (scope, label) => scope.locator(
  `xpath=.//label[starts-with(normalize-space(.), "${label}")]/following-sibling::*[self::input or self::select or self::textarea][1]`).first()

const bodyText = async (page) => ((await page.locator('body').innerText().catch(() => '')) || '').replace(/\s+/g, ' ')
const rawSql = (t) => L.RAW_SQL.test(String(t || ''))

module.exports = { ...L, OUT, save, fixtureSql, session, sidebarLinks, control, bodyText, rawSql }
