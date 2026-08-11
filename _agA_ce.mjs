import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import fs from 'node:fs'
const files = process.argv.slice(3)
const out = process.argv[2]
const COLS=[[199,'vehicle_years'],[254,'sum_insured'],[360,'paid_count'],[460,'paid_amount'],[606,'outstanding_count'],[730,'outstanding_amount'],[860,'salvage_received'],[1000,'salvage_receivable']]
const colFor=x=>{ let b=COLS[0]; for(const c of COLS) if(Math.abs(x-c[0])<Math.abs(x-b[0])) b=c; return Math.abs(x-b[0])<=45?b[1]:null }
const all=[]
for(const file of files){
  const doc = await getDocument({ data:new Uint8Array(fs.readFileSync(file)), useSystemFonts:true }).promise
  const tc = await (await doc.getPage(1)).getTextContent()
  const items = tc.items.filter(i=>i.str.trim()).map(i=>({x:Math.round(i.transform[4]),y:Math.round(i.transform[5]),s:i.str.trim()}))
  const grab=(lbl)=>{ const l=items.find(i=>i.s===lbl); if(!l) return null
    const v=items.filter(i=>Math.abs(i.y-l.y)<=6 && i.x>l.x && i.x<l.x+260).sort((a,b)=>a.x-b.x)[0]; return v?v.s:null }
  const title=items.find(i=>/Claims Experience Form/.test(i.s))?.s||''
  const policy=(title.match(/Form\s+(\S+)$/)||[])[1]
  const cover=/Motor Comprehensive/.test(title)?'CMI':(/Third Part/.test(title)?'TPL':null)
  // label rows
  const labs=items.filter(i=>i.x<40 && (/^Month \d+$/.test(i.s)))
    .concat(items.filter(i=>i.x<70 && /^(Total for the last policy year|Prior Policy Year|Policy Year - 2 years prior)$/.test(i.s)))
  const rows=[]
  for(const l of labs){
    const vals=items.filter(i=>i.x>=150 && Math.abs(i.y-(l.y-6))<=4)
    if(!vals.length) continue
    const r={label:l.s}
    for(const v of vals){ const f=colFor(v.x); if(f) r[f]=v.s }
    rows.push(r)
  }
  const insp=items.find(i=>i.s==='Policy Inception Date'), expy=items.find(i=>i.s==='Policy Expiry Date')
  const dt=(l)=>{ if(!l) return null; const v=items.filter(i=>Math.abs(i.y-l.y)<=8 && i.x>150 && i.x<400).sort((a,b)=>a.x-b.x)[0]; return v?v.s:null }
  all.push({source_file:file.split('/').pop(), policy_no:policy, cover_type:cover,
    insured:grab('Group Name'), report_date:grab('Report Date'),
    period_from:dt(insp), period_to:dt(expy), rows})
}
fs.writeFileSync(out, JSON.stringify(all,null,1))
for(const f of all){ console.log('==',f.source_file,f.policy_no,f.cover_type,f.period_from,'->',f.period_to,'rows',f.rows.length)
  console.log('  ',JSON.stringify(f.rows.filter(r=>!/^Month/.test(r.label)))) }
