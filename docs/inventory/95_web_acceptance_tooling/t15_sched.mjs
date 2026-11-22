import { open, close, BASE } from './pw.mjs'
import { dismiss, snap } from './ui.mjs'
const who = process.argv[2] || 'admin'
const { page, log } = await open(who)
await page.goto(`${BASE}/scheduled-reports`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000); await dismiss(page)
console.log('page:', (await page.innerText('main')).replace(/\n+/g, ' | ').slice(0, 300))
await page.getByRole('button', { name: /New Schedule/ }).first().click(); await page.waitForTimeout(1200)
const item = page.getByRole('menuitem').first()
if (await item.count()) { console.log('menu:', (await page.getByRole('menuitem').allTextContents()).join(' | ')); await item.click(); await page.waitForTimeout(1500) }
const dlg = page.getByRole('dialog').last()
const sels = dlg.locator('select')
let found = false
for (let i = 0; i < await sels.count(); i++) {
  const o = await sels.nth(i).locator('option').allTextContents()
  if (o.some((x) => /Inventory Control/.test(x))) { found = true; await sels.nth(i).selectOption({ label: o.find((x) => /Inventory Control/.test(x)) }); console.log('report type options:', o.join(', ')) }
}
console.log('inventory report type selectable:', found)
await page.waitForTimeout(1000)
await dlg.locator('input').first().fill('QA inventory digest')
await dlg.locator('textarea').last().fill('qa@example.invalid')
const fmt = dlg.locator('select').filter({ has: page.locator('option', { hasText: 'Excel' }) }).first()
if (await fmt.count()) await fmt.selectOption({ label: 'Excel' })
const dl = page.waitForEvent('download', { timeout: 20000 }).catch(() => null)
await dlg.getByRole('button', { name: 'Generate now' }).click()
const d = await dl
console.log('generate now download:', d ? d.suggestedFilename() : 'NONE')
if (d) await d.saveAs('/var/lib/tp-acc/web/shots/inventory_report_generated.xlsx')
await snap(page, `t15_${who}_schedule_inventory`)
await dlg.getByRole('button', { name: 'Save Schedule' }).click(); await page.waitForTimeout(3000)
console.log('dialog:', (await dlg.innerText()).replace(/\n+/g, ' | ').slice(0, 900))
console.log(log.filter((l) => l.startsWith('http') && !/organisation_configuration|org_branding|country_addresses|subscription|corrective_actions/.test(l)).join('\n'))
await close()
