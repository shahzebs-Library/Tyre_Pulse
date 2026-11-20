import { open, close } from './pw.mjs'
import { go, snap } from './ui.mjs'
const who = process.argv[2] || 'admin'
const refresh = process.argv[3] === 'refresh'
const { page, log } = await open(who)
await go(page, 'tyres')
if (refresh) {
  const b = page.getByRole('button', { name: /Refresh custody from tyre records/ })
  if (await b.count()) { await b.click(); await page.waitForTimeout(6000) } else console.log('NO refresh button for', who)
  await go(page, 'tyres')
}
const t = (await page.innerText('main')).replace(/\n+/g, ' | ')
const i = t.indexOf('Custody conflicts')
console.log(t.slice(i, i + 1400))
await snap(page, `t14_${who}_tyres`)
const row = page.locator('tbody tr').filter({ hasText: /Scrapped|scrapped/ }).first()
if (await row.count()) {
  await row.click(); await page.waitForTimeout(2500)
  const dlg = page.getByRole('dialog').last()
  if (await dlg.count()) {
    const btns = (await dlg.getByRole('button').allTextContents()).map((x) => x.trim()).filter(Boolean)
    console.log('conflict drawer buttons:', btns.join(' | '))
    console.log('drawer:', (await dlg.innerText()).replace(/\n+/g, ' | ').slice(0, 900))
    await snap(page, `t14_${who}_conflict`)
  }
}
console.log(log.filter((l) => l.startsWith('http') && !/organisation_configuration|org_branding|country_addresses|subscription|corrective_actions/.test(l)).join('\n'))
await close()
