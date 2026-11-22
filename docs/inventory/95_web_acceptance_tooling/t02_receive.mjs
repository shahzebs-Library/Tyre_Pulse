import { open, close } from './pw.mjs'
import { go, field, text, snap, pick } from './ui.mjs'
const who = process.argv[2] || 'admin'
const cases = JSON.parse(process.argv[3] || '[]') // [{grn, site, item, loc, qty, rej, cost, cur}]
const { page, log } = await open(who)
await go(page, 'receiving')
for (const c of cases) {
  const card = page.locator('section, .cc-card').filter({ hasText: 'Receive goods' }).first()
  await field(card, 'GRN').fill(c.grn).catch(async () => { await card.locator('input').first().fill(c.grn) })
  await field(card, 'Site').fill(c.site)
  await pick(card, 'Item', c.item)
  const locSel = field(card, 'Location')
  const opts = await locSel.locator('option').allTextContents()
  await locSel.selectOption({ label: opts.find((o) => o.includes(c.loc)) })
  await field(card, 'Received').fill(String(c.qty))
  if (c.rej) await field(card, 'Rejected').fill(String(c.rej))
  if (c.cost != null) { await field(card, 'Unit cost').fill(String(c.cost)); await field(card, 'Currency').fill(c.cur || 'SAR') }
  await card.getByRole('button', { name: 'Receive', exact: true }).click()
  await page.waitForTimeout(3000)
  const t = await text(page)
  const i = t.indexOf('Receive goods')
  console.log(c.grn, '=>', t.slice(i, i + 900))
  await snap(page, `t02_receive_${who}_${c.grn}`)
}
console.log(log.filter((l) => l.startsWith('http') && !/organisation_configuration|org_branding|country_addresses|subscription|corrective_actions/.test(l)).join('\n'))
await close()
