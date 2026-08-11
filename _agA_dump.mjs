import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import fs from 'node:fs'
const [,, file, out] = process.argv
const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(file)), useSystemFonts: true }).promise
const chunks = []
for (let p = 1; p <= doc.numPages; p++) {
  const tc = await (await doc.getPage(p)).getTextContent()
  let last = null, line = [], lines = []
  for (const it of tc.items) {
    const y = Math.round(it.transform[5])
    if (last !== null && Math.abs(y - last) > 3) { lines.push(line.join(' ')); line = [] }
    last = y; line.push(it.str)
  }
  lines.push(line.join(' '))
  chunks.push(`\n===== PAGE ${p} =====\n` + lines.join('\n').replace(/[ \t]{2,}/g,' '))
}
fs.writeFileSync(out, `PAGES: ${doc.numPages}\n` + chunks.join('\n'))
console.log(file.split('/').pop(), doc.numPages)
