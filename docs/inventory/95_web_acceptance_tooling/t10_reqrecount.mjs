// IC requests recount approval naming the recounter, via the reconciliation panel
import { open, close } from './pw.mjs'
import { go, field, snap } from './ui.mjs'
const who = process.argv[2] || 'invctl'
const target = process.argv[3] || 'QA PMV Manager'
const action = process.argv[4] || 'Request recount approval'
const { page, log } = await open(who)
await go(page, 'audits')
await page.locator('tbody tr').first().click(); await page.waitForTimeout(2500)
const drawer = page.getByRole('dialog')
await drawer.getByRole('button', { name: 'Reconcile', exact: true }).click(); await page.waitForTimeout(3000)
const sel = field(drawer, 'Recount by')
const o = await sel.locator('option').allTextContents()
console.log('QA options offered:', o.filter((x) => x.startsWith('QA')).join(', '))
await sel.selectOption({ label: o.find((x) => x.includes(target)) })
await drawer.getByRole('button', { name: action }).click(); await page.waitForTimeout(1200)
const d2 = page.getByRole('dialog').last()
const ta = d2.locator('textarea')
if (await ta.count()) { await ta.first().fill('QA: WH-A synchronising ring short by 2'); }
const send = d2.getByRole('button', { name: /Send|Request|Submit/ }).last()
if (await send.count() && action.startsWith('Request')) { await send.click(); await page.waitForTimeout(3000) }
await snap(page, `t10_${who}_${action.replace(/\W+/g, '_')}`)
const t = (await drawer.innerText()).replace(/\n+/g, ' | ')
const i = t.indexOf('outside tolerance')
console.log(t.slice(i, i + 200), '...', (t.match(/Approval:[^|]*\|[^|]*/g) || []).join(' ; '))
console.log(log.filter((l) => l.startsWith('http') && !/organisation_configuration|org_branding|country_addresses|subscription|corrective_actions/.test(l)).join('\n'))
await close()
