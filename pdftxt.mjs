import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import fs from 'node:fs'
const file = process.argv[2]
const maxPages = Number(process.argv[3] || 3)
const data = new Uint8Array(fs.readFileSync(file))
const doc = await getDocument({ data, useSystemFonts: true }).promise
console.log('PAGES:', doc.numPages)
for (let p = 1; p <= Math.min(maxPages, doc.numPages); p++) {
  const page = await doc.getPage(p)
  const tc = await page.getTextContent()
  let last = null, line = []
  const out = []
  for (const it of tc.items) {
    const y = Math.round(it.transform[5])
    if (last !== null && Math.abs(y - last) > 3) { out.push(line.join(' ')); line = [] }
    last = y
    line.push(it.str)
  }
  out.push(line.join(' '))
  console.log(`\n===== PAGE ${p} =====`)
  console.log(out.join('\n').replace(/[ \t]{2,}/g, ' '))
}
