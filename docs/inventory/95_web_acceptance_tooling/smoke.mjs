import { open, shot, close, BASE } from './pw.mjs'
const who = process.argv[2] || 'admin', path = process.argv[3] || '/stock', wait = Number(process.argv[4] || 9000)
const { page, log } = await open(who)
await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(wait)
await shot(page, `smoke_${who}_${path.replace(/[^a-z0-9]+/gi, '_')}`)
console.log((await page.innerText('body')).slice(0, 2500).replace(/\n+/g, ' | '))
console.log('---LOG---\n' + log.slice(0, 40).join('\n'))
await close()
