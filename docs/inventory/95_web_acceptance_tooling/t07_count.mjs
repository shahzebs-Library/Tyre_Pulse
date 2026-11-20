import { open, close } from './pw.mjs'
import { go, text, snap } from './ui.mjs'
const who = process.argv[2] || 'storekeeper'
const counts = JSON.parse(process.argv[3] || '{}') // item_code/description fragment -> qty ; '*' default
const submit = process.argv[4] === 'submit'
const { page, log } = await open(who)
await go(page, 'audits')
await page.locator('tbody tr').first().click(); await page.waitForTimeout(2000)
await page.getByRole('button', { name: 'Count', exact: true }).click(); await page.waitForTimeout(3000)
await snap(page, `t07_${who}_counter_view`)
const rows = page.locator('.inv-count-row').filter({ has: page.locator('input.inv-num') })
const n = await rows.count()
const lines = []
for (let i = 0; i < n; i++) lines.push((await rows.nth(i).innerText()).replace(/\s+/g, ' ').trim())
console.log('count lines (' + n + '):\n' + lines.join('\n'))
const t = await text(page)
const i0 = t.indexOf('Count')
console.log('expected/system qty words visible?:', /expected|system qty|on hand/i.test(t.slice(i0)) ? 'YES - check' : 'no')
if (submit) {
  for (let i = 0; i < n; i++) {
    const key = Object.keys(counts).find((k) => k !== '*' && k.split('@').every((part) => lines[i].includes(part)))
    const v = key ? counts[key] : counts['*']
    if (v === undefined) continue
    await rows.nth(i).locator('input.inv-num').first().fill(String(v))
    if (Number(v) === 0) { const cz = rows.nth(i).locator('input[type=checkbox]'); if (await cz.count()) await cz.first().check() }
  }
  await page.getByRole('button', { name: /Submit count/i }).last().click()
  await page.waitForTimeout(1200)
  await snap(page, `t07_${who}_confirm`)
  const conf = page.getByRole('button', { name: /Confirm|Yes, submit|Submit count/i }).last()
  if (await conf.count()) await conf.click()
  await page.waitForTimeout(3500)
  await snap(page, `t07_${who}_submitted`)
  const t2 = await text(page)
  console.log('after submit:', (t2.match(/(Posted[^|]*|Saved[^|]*|submitted[^|]*|Not [^|]*|refused[^|]*|You [^|]*)/gi) || []).slice(0, 8))
}
console.log(log.filter((l) => l.startsWith('http') && !/organisation_configuration|org_branding|country_addresses|subscription|corrective_actions/.test(l)).join('\n'))
await close()
