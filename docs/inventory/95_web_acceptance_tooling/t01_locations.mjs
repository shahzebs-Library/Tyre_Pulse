import { open, close } from './pw.mjs'
import { go, field, text, snap } from './ui.mjs'
const { page, log } = await open('admin')
await go(page, 'locations')
for (const [code, name, site] of [['WH-A', 'NHC main store', 'NHC'], ['WH-B', 'NHC tyre bay', 'NHC'], ['WH-D', 'Diriyah store', 'DIRIYAH']]) {
  await page.getByRole('button', { name: 'Add location' }).first().click()
  const dlg = page.getByRole('dialog')
  await field(dlg, 'Code').fill(code)
  await field(dlg, 'Name').fill(name)
  const typeSel = field(dlg, 'Type')
  const opts = await typeSel.locator('option').allTextContents()
  await typeSel.selectOption({ label: opts.find((o) => /warehouse|store/i.test(o)) || opts[0] })
  await field(dlg, 'Site').fill(site)
  await dlg.getByRole('button', { name: 'Save' }).click()
  await page.waitForTimeout(2500)
  const t = await text(page)
  console.log(code, t.includes(code) ? 'listed' : 'NOT LISTED', (t.match(/\d+ locations/) || [''])[0])
}
await snap(page, 't01_locations_admin')
console.log(log.filter((l) => !l.includes('WebSocket') && !l.includes('Failed to load')).join('\n'))
await close()
