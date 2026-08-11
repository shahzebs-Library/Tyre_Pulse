import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import fs from 'node:fs'
const [,,file,out] = process.argv
const doc = await getDocument({ data:new Uint8Array(fs.readFileSync(file)), useSystemFonts:true }).promise
// fixed rotated-table field bands (label y -> field), learned from the labelled first schedule page
const BANDS = [[29,'risk'],[84,'machine_type'],[164,'equipment'],[259,'maker'],[322,'capacity'],[385,'plate_no'],[449,'year'],[528,'reference_no'],[607,'chassis_no'],[686,'rate'],[766,'sum_insured']]
const fieldFor = y => { let f=null; for(const [ly,n] of BANDS) if (y>=ly-4) f=n; return y<25?null:f }
const recs=[]
for (let p=1;p<=doc.numPages;p++){
  const tc = await (await doc.getPage(p)).getTextContent()
  const items = tc.items.filter(i=>i.str.trim()).map(i=>({x:Math.round(i.transform[4]),y:Math.round(i.transform[5]),s:i.str.trim()}))
  if (!items.some(i=>i.x>=100 && Math.abs(i.y-385)<=4 && /^[A-Z]{2,3}\d{2,4}$/.test(i.s))) continue
  const data = items.filter(i=>i.x>=100 && i.x<=505 && !/^Page No/.test(i.s))
  const bands=[]
  for(const it of data){ const b=bands.find(b=>Math.abs(b.c-it.x)<=13); if(b){b.items.push(it); b.c=Math.min(b.c,it.x)} else bands.push({c:it.x,items:[it]}) }
  for (const band of bands){
    const rec={source_page:p}
    for (const it of band.items.sort((a,b)=>a.y-b.y||a.x-b.x)){
      const f=fieldFor(it.y); if(!f) continue
      rec[f]= rec[f] ? rec[f]+' '+it.s : it.s
    }
    if (rec.risk && /^\d+$/.test(rec.risk)) recs.push(rec)
  }
}
const seen=new Map()
for(const r of recs){ if(!seen.has(r.risk)) seen.set(r.risk,r) }
const uniq=[...seen.values()].sort((a,b)=>+a.risk-+b.risk)
fs.writeFileSync(out, JSON.stringify(uniq,null,1))
const num=s=>s?Number(String(s).replace(/,/g,'')):null
console.log('raw',recs.length,'uniq',uniq.length,'range',uniq[0]?.risk,'..',uniq.at(-1)?.risk)
const missing=[]; for(let i=1;i<=+uniq.at(-1).risk;i++) if(!seen.has(String(i))) missing.push(i)
console.log('missing risk ids',missing.length, missing.slice(0,20))
console.log('with SI',uniq.filter(r=>num(r.sum_insured)>0).length,'SUM',uniq.reduce((a,r)=>a+(num(r.sum_insured)||0),0).toFixed(2))
console.log('equipment types',[...new Set(uniq.map(r=>r.equipment))].join(' | '))
console.log('sample',JSON.stringify(uniq.slice(0,2)),JSON.stringify(uniq.slice(-2)))
