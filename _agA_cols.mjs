import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import fs from 'node:fs'
const [,,file,pg] = process.argv
const doc = await getDocument({ data:new Uint8Array(fs.readFileSync(file)), useSystemFonts:true }).promise
const tc = await (await doc.getPage(+pg)).getTextContent()
const items = tc.items.filter(i=>i.str.trim()).map(i=>({x:Math.round(i.transform[4]),y:Math.round(i.transform[5]),s:i.str.trim()}))
items.sort((a,b)=> b.y-a.y || a.x-b.x)
let cy=null, row=[]
const rows=[]
for(const it of items){ if(cy===null||Math.abs(it.y-cy)>3){ if(row.length) rows.push(row); row=[]; cy=it.y } row.push(it) }
if(row.length) rows.push(row)
for(const r of rows) console.log(r[0].y, JSON.stringify(r.map(i=>i.x+':'+i.s)))
