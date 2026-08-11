import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import fs from 'node:fs'
const doc = await getDocument({ data:new Uint8Array(fs.readFileSync(process.argv[2])), useSystemFonts:true }).promise
const tc = await (await doc.getPage(+process.argv[3])).getTextContent()
const items = tc.items.filter(i=>i.str.trim()).map(i=>({x:Math.round(i.transform[4]),y:Math.round(i.transform[5]),s:i.str.trim()}))
const byY={}; for(const i of items) if(/^\d{1,4}$/.test(i.s)) (byY[i.y]=byY[i.y]||[]).push(i)
const rows=Object.values(byY).filter(a=>a.length>=5).sort((a,b)=>a[0].y-b[0].y)
console.log('candidate int rows:', rows.map(r=>r[0].y+':'+r.length+':'+r.map(i=>i.s).slice(0,5).join(',')))
const minX = rows.length?Math.min(...rows[0].map(i=>i.x)):null
console.log('minX',minX)
const labels = items.filter(i=>i.x < minX-5 && i.x>100 && !/^\d/.test(i.s))
console.log('labels',labels.length, labels.map(l=>l.y+':'+l.s).join(' | '))
