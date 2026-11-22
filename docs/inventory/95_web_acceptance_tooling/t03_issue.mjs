import { open, close } from './pw.mjs'
import { go, field, text, snap, pick } from './ui.mjs'
const who = process.argv[2] || 'storekeeper'
const cases = JSON.parse(process.argv[3] || '[]') // [{action:'reserve'|'issue', item, qty, doc, reason}]
const { page, log } = await open(who)
await go(page, 'receiving')
for (const [n, c] of cases.entries()) {
  if (c.reload) await go(page, 'receiving')
  const card = page.locator('section, .cc-card').filter({ hasText: 'Reserve and issue' }).last()
  if (!c.keep) await pick(card, 'Stock line', c.item)
  await field(card, 'Quantity').fill(String(c.qty))
  if (c.doc) await field(card, 'Job card or document').fill(c.doc)
  if (c.reason) await field(card, 'Reason').fill(c.reason)
  await card.getByRole('button', { name: c.action === 'reserve' ? 'Reserve' : 'Issue', exact: true }).click()
  await page.waitForTimeout(3000)
  const t = await text(page)
  const i = t.indexOf('Reserve and issue')
  console.log(n, c.action, c.item, '=>', t.slice(i + 120, i + 700))
  await snap(page, `t03_${who}_${n}_${c.action}`)
}
console.log(log.filter((l) => l.startsWith('http') && !/organisation_configuration|org_branding|country_addresses|subscription|corrective_actions/.test(l)).join('\n'))
await close()
