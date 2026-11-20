// node t12_approvals.mjs <user> [approve|reject|view] [row-filter]
import { open, close } from './pw.mjs'
import { go, snap } from './ui.mjs'
const [who, action = 'view', filt = ''] = process.argv.slice(2)
const { page, log } = await open(who)
await go(page, 'controls')
await page.waitForTimeout(1500)
const rows = page.locator('tbody tr')
const n = await rows.count()
const texts = []
for (let i = 0; i < n; i++) texts.push((await rows.nth(i).innerText()).replace(/\s+/g, ' '))
console.log(`queue for ${who} (${n}):\n` + texts.join('\n'))
await snap(page, `t12_${who}_queue`)
if (action !== 'view') {
  const r = filt ? rows.filter({ hasText: filt }).first() : rows.first()
  const decide = r.getByRole('button', { name: 'Decide' })
  if (!(await decide.count())) console.log('NO Decide button for', who)
  else {
    await decide.click(); await page.waitForTimeout(1500)
    const dlg = page.getByRole('dialog').last()
    await dlg.locator('textarea').last().fill(`QA ${action} by ${who}`)
    await dlg.getByRole('button', { name: action === 'approve' ? 'Approve' : 'Reject', exact: true }).click()
    await page.waitForTimeout(3000)
    await snap(page, `t12_${who}_${action}`)
    console.log('dialog after:', (await page.getByRole('dialog').count()) ? (await page.getByRole('dialog').last().innerText()).replace(/\n+/g, ' | ').slice(0, 600) : 'closed')
  }
}
console.log(log.filter((l) => l.startsWith('http') && !/organisation_configuration|org_branding|country_addresses|subscription|corrective_actions/.test(l)).join('\n'))
await close()
