// node t08_audit_step.mjs <user> <button label> [then-button-label]
import { open, close } from './pw.mjs'
import { go, text, snap } from './ui.mjs'
const [who, label, ...more] = process.argv.slice(2)
const { page, log } = await open(who)
await go(page, 'audits')
await page.locator('tbody tr').first().click(); await page.waitForTimeout(2500)
const drawer = page.getByRole('dialog')
console.log('buttons:', (await drawer.getByRole('button').allTextContents()).map((s) => s.trim()).filter(Boolean).join(' | '))
for (const l of [label, ...more]) {
  const b = drawer.getByRole('button', { name: l, exact: true })
  if (!(await b.count())) { console.log('NO BUTTON', l); continue }
  await b.first().click(); await page.waitForTimeout(3000)
  await snap(page, `t08_${who}_${l.replace(/\W+/g, '_')}`)
}
const t = await (await drawer.count() ? drawer.innerText() : text(page))
console.log(t.replace(/\n+/g, ' | ').slice(0, 2500))
console.log(log.filter((l) => l.startsWith('http') && !/organisation_configuration|org_branding|country_addresses|subscription|corrective_actions/.test(l)).join('\n'))
await close()
