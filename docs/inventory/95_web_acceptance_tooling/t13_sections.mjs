// node t13_sections.mjs <user> <section[:tab]>... -> screenshot + body text per section
import { open, close, BASE } from './pw.mjs'
import { dismiss, snap } from './ui.mjs'
const [who, ...secs] = process.argv.slice(2)
const { page, log } = await open(who)
for (const s of secs) {
  const [sec, tab] = s.split(':')
  await page.goto(`${BASE}/stock?section=${sec}${tab ? `&tab=${tab}` : ''}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000); await dismiss(page)
  if (tab) { const tb = page.getByRole('tab', { name: new RegExp(tab, 'i') }); if (await tb.count()) { await tb.first().click(); await page.waitForTimeout(3000) } }
  await snap(page, `t13_${who}_${sec}${tab ? '_' + tab.replace(/\W+/g, '') : ''}`)
  const t = (await page.innerText('main').catch(() => page.innerText('body'))).replace(/\n+/g, ' | ')
  const i = t.indexOf('Value & reports')
  console.log(`\n=== ${who} ${s} ===\n` + t.slice(i > 0 ? i + 16 : 0, (i > 0 ? i : 0) + 2600))
}
console.log('---LOG---\n' + log.filter((l) => l.startsWith('http') && !/organisation_configuration|org_branding|country_addresses|subscription|corrective_actions/.test(l)).join('\n'))
await close()
