import { BASE, shot } from './pw.mjs'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export async function go(page, section, extra = '') {
  await page.goto(`${BASE}/stock?section=${section}${extra}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)
  await dismiss(page)
}
export async function dismiss(page) {
  for (const name of ['Skip tour', 'Dismiss', 'Got it']) {
    const b = page.getByRole('button', { name, exact: true })
    if (await b.count()) { try { await b.first().click({ timeout: 1500 }) } catch {} }
  }
}
export function field(scopeLoc, label, nth = 0) {
  return scopeLoc.locator('label.cc-field').filter({ has: scopeLoc.page().locator(`span:text-is("${label}")`) }).nth(nth).locator('input, select, textarea').first()
}
export async function text(page) { return (await page.innerText('body')).replace(/\n+/g, ' | ') }
export async function snap(page, name) { await shot(page, name) }
export async function pick(scopeLoc, label, term, nth = 0, pickIndex = 0) {
  const inp = field(scopeLoc, label, nth)
  await inp.fill(term)
  await scopeLoc.page().waitForTimeout(1500)
  const btn = scopeLoc.locator('ul.inv-picklist li button').nth(pickIndex)
  await btn.click({ timeout: 5000 })
}
