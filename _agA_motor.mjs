import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import fs from 'node:fs'
const [,,file,out,fieldsCsv,manual] = process.argv
const FIELDS = fieldsCsv.split(',')
const doc = await getDocument({ data:new Uint8Array(fs.readFileSync(file)), useSystemFonts:true }).promise
let bands = manual ? manual.split(',').map(t=>({y:+t.split(':')[0], f:t.split(':')[1]})).sort((a,b)=>a.y-b.y) : null
let dataMinX=null
const recs=[]
for (let p=1;p<=doc.numPages;p++){
  const tc = await (await doc.getPage(p)).getTextContent()
  const items = tc.items.filter(i=>i.str.trim()).map(i=>({x:Math.round(i.transform[4]),y:Math.round(i.transform[5]),s:i.str.trim()}))
  // locate the risk-id row: >=5 pure integers sharing a y
  const byY={}
  for(const i of items) if(/^\d{1,4}$/.test(i.s)) (byY[i.y]=byY[i.y]||[]).push(i)
  const ridRow = Object.values(byY).filter(a=>a.length>=5).sort((a,b)=>a[0].y-b[0].y)[0]
  if(!ridRow) continue
  const minX = Math.min(...ridRow.map(i=>i.x))
  const labels = items.filter(i=>i.x < minX-5 && i.x>=140 && !/^\d/.test(i.s) && !/Attaching to|Rate Includes|NON AGENCY/.test(i.s))
  if (labels.length>=12){
    const ys=[]
    for(const l of labels.sort((a,b)=>a.y-b.y)){ const g=ys.find(g=>Math.abs(g-l.y)<=12); if(g===undefined) ys.push(l.y) }
    if (!manual && ys.length===FIELDS.length){ bands = ys.map((y,i)=>({y,f:FIELDS[i]})) }
    if (dataMinX===null||minX<dataMinX) dataMinX=minX
  }
  if(!bands) continue
  const data = items.filter(i=>i.x >= minX-12 && !/^Page No/.test(i.s) && !/Rate Includes|NON AGENCY|Attaching to/.test(i.s))
  const cols=[]
  for(const it of data.slice().sort((a,b)=>a.x-b.x)){ const c=cols[cols.length-1]; if(c && it.x - c.x <= 10) { c.items.push(it); c.x=it.x } else cols.push({x:it.x,items:[it]}) }
  for(const c of cols){
    const rec={source_page:p}
    for(const it of c.items.sort((a,z)=>a.y-z.y)){
      let best=bands[0]; for(const b of bands) if(Math.abs(it.y-b.y)<Math.abs(it.y-best.y)) best=b
      rec[best.f]=(rec[best.f]||'')+it.s
    }
    if(rec.risk_id && /^\d+$/.test(rec.risk_id)) recs.push(rec)
  }
}
const seen=new Map(); for(const r of recs) if(!seen.has(r.risk_id)) seen.set(r.risk_id,r)
const uniq=[...seen.values()].sort((a,b)=>+a.risk_id-+b.risk_id)
fs.writeFileSync(out, JSON.stringify(uniq,null,1))
const n=s=>s?Number(String(s).replace(/[ ,]/g,'')):0
console.log(file.split('/').pop(),'rows',uniq.length,'range',uniq[0]?.risk_id,'..',uniq.at(-1)?.risk_id)
const miss=[];for(let i=1;i<=+uniq.at(-1).risk_id;i++) if(!seen.has(String(i))) miss.push(i)
console.log('missing',miss.length,miss.slice(0,15))
console.log('SUM insured',uniq.reduce((a,r)=>a+n(r.sum_insured),0).toFixed(2),'SUM total',uniq.reduce((a,r)=>a+n(r.total_premium),0).toFixed(2))
console.log('fill',FIELDS.map(f=>f+'='+uniq.filter(r=>r[f]).length).join(' '))
console.log('sample',JSON.stringify(uniq.slice(0,2)))
