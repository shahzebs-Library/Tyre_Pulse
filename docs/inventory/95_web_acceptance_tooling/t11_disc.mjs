// Discrepancy drawer actions. node t11_disc.mjs <user> <mode> [arg]
// modes: view | reqrecount <name> | recount <name> | propose <rootcause> | reqadj | approve | reject
import { open, close } from './pw.mjs'
import { go, field, snap } from './ui.mjs'
const [who, mode, arg] = process.argv.slice(2)
const { page, log } = await open(who)
await go(page, 'discrepancies')
let rowL = page.locator('tbody tr'); for (const part of (process.env.ROW || '020164-O').split('&')) rowL = rowL.filter({ hasText: part })
const row = rowL.first()
console.log('row:', (await row.innerText()).replace(/\s+/g, ' '))
await row.click(); await page.waitForTimeout(2500)
const dr = page.getByRole('dialog').last()
const click = async (name) => { const b = dr.getByRole('button', { name, exact: true }); if (!(await b.count())) { console.log('NO BUTTON', name); return false } await b.first().click(); await page.waitForTimeout(3000); return true }
const confirmDialog = async () => {
  const d2 = page.getByRole('dialog').last()
  const ta = d2.locator('textarea'); if (await ta.count()) await ta.last().fill('QA acceptance: approval request')
  const b = d2.getByRole('button', { name: /^(Send request|Request approval|Send|Submit|Confirm)$/ })
  if (await b.count()) { await b.last().click(); await page.waitForTimeout(3000) }
}
if (mode === 'reqrecount' || mode === 'recount') {
  const sel = field(dr, 'Recount by'); const o = await sel.locator('option').allTextContents()
  console.log('QA recounters offered:', o.filter((x) => x.startsWith('QA')).join(', '))
  await sel.selectOption({ label: o.find((x) => x.includes(arg)) })
  if (mode === 'reqrecount') { await click('Request recount approval'); await confirmDialog() } else await click(process.env.RECOUNT_LABEL || 'Assign recount')
}
if (mode === 'propose') {
  const rc = field(dr, 'Category'); const o = await rc.locator('option').allTextContents(); await rc.selectOption({ label: 'Count error' }); await field(dr, 'Investigation notes').fill('QA: confirmed short by recount'); console.log('root causes:', o.slice(0, 5).join(','))
  await field(dr, 'Proposed correct quantity').fill(arg || '5').catch(async () => {})
  const mv = field(dr, 'Move to'); const mo = await mv.locator('option').allTextContents(); console.log('move options:', mo.join(','))
  const prop = mo.find((x) => /propos/i.test(x)); if (prop) await mv.selectOption({ label: prop }); else await mv.selectOption({ label: 'Investigating' })
  await click('Save')
  if (!prop) { await page.waitForTimeout(1500); const mo2 = await mv.locator('option').allTextContents(); console.log('move options 2:', mo2.join(',')); const p2 = mo2.find((x) => /propos/i.test(x)); if (p2) { await field(dr, 'Proposed correct quantity').fill(arg || '5'); await mv.selectOption({ label: p2 }); await click('Save') } }
}
if (mode === 'reqadj') { await click('Request approval'); await confirmDialog() }
if (mode === 'approve' || mode === 'reject' || mode === 'hold') {
  const ta = field(dr, 'Decision note'); if (await ta.count()) await ta.fill(arg || 'QA decision')
  await click({ approve: 'Approve', reject: 'Reject', hold: 'Hold' }[mode])
}
await snap(page, `t11_${who}_${mode}`)
const t = (await dr.innerText()).replace(/\n+/g, ' | ')
console.log('drawer:', t.slice(0, 2200))
console.log(log.filter((l) => l.startsWith('http') && !/organisation_configuration|org_branding|country_addresses|subscription|corrective_actions/.test(l)).join('\n'))
await close()
