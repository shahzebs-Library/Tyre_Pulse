import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import fs from 'node:fs'
const [,,file,out] = process.argv
const doc = await getDocument({ data:new Uint8Array(fs.readFileSync(file)), useSystemFonts:true }).promise
// column bands taken from the printed header row of this schedule
const COLS = [[6,'sr_no'],[27,'risk_id'],[60,'location'],[100,'machine_name'],[165,'plate_no'],[200,'chassis_serial_no'],
              [258,'manufacturing_name'],[315,'manufacturing_year'],[380,'model_type'],[465,'owner_name'],[508,'asset_id_no'],
              [548,'sum_insured'],[610,'premium'],[672,'cover_description']]
const colFor = x => { let f=null; for(const [cx,n] of COLS) if (x>=cx-4) f=n; return f }
const recs=[]; const meta={}
for (let p=1;p<=doc.numPages;p++){
  const tc = await (await doc.getPage(p)).getTextContent()
  const items = tc.items.filter(i=>i.str.trim()).map(i=>({x:Math.round(i.transform[4]),y:Math.round(i.transform[5]),s:i.str.trim()}))
  const rows=[]; let cy=null,row=null
  for(const it of items.sort((a,b)=>b.y-a.y||a.x-b.x)){ if(cy===null||Math.abs(it.y-cy)>3){row=[];rows.push(row);cy=it.y} row.push(it) }
  let curr=null
  for(const r of rows){
    const first=r.find(i=>i.x>=100&&i.x<160)
    const m = first && first.s.match(/^(\d+)\.\s*(.*)$/)
    if(m){
      curr={source_page:p, item_no:+m[1]}
      for(const it of r){ const f=colFor(it.x); if(!f) continue
        let v = it===first ? m[2] : it.s
        if(!v) continue
        curr[f]=(curr[f]||'')+v }
      recs.push(curr); continue
    }
    // continuation lines (wrapped plate/chassis) belong to the record above
    const cont = r.filter(i=>i.x>=100 && !/Risk Total|Grand Total|Page No|Signed on|Printed:/.test(i.s))
    if(curr && cont.length && cont.length<=3 && cont.every(i=>/^[A-Z0-9\- ]+$/i.test(i.s))){
      for(const it of cont){ const f=colFor(it.x); if(!f) continue; curr[f]=(curr[f]||'')+it.s }
      continue
    }
    for(const it of r){ const t=it.s.match(/^(Risk Total|Grand Total)\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/); if(t) meta[t[1]]={value:t[2],premium:t[3]} }
  }
}
for(const r of recs){ if(r.premium){ const m=String(r.premium).match(/^([\d,]+\.\d{2})\s*(.*)$/); if(m){ r.premium=m[1]; if(m[2]) r.cover_description_inline=m[2] } } }
fs.writeFileSync(out, JSON.stringify({meta,recs},null,1))
const n=s=>s?Number(String(s).replace(/[ ,]/g,'')):0
console.log('items',recs.length,'range',recs[0]?.item_no,'..',recs.at(-1)?.item_no)
const missing=[];const have=new Set(recs.map(r=>r.item_no));for(let i=1;i<=recs.at(-1).item_no;i++) if(!have.has(i)) missing.push(i)
console.log('missing item nos',missing.length,missing.slice(0,20))
console.log('SUM insured',recs.reduce((a,r)=>a+n(r.sum_insured),0).toFixed(2),'premium',recs.reduce((a,r)=>a+n(r.premium),0).toFixed(2))
console.log('meta',JSON.stringify(meta))
console.log('field fill:', ['plate_no','chassis_serial_no','manufacturing_name','manufacturing_year','model_type','asset_id_no','owner_name','machine_name'].map(f=>f+'='+recs.filter(r=>r[f]).length).join(' '))
console.log('sample',JSON.stringify(recs.slice(0,2)))
console.log('types',[...new Set(recs.map(r=>r.manufacturing_name))].join(' | '))
