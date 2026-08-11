import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import fs from 'node:fs'
const [,,file,out] = process.argv
const doc = await getDocument({ data:new Uint8Array(fs.readFileSync(file)), useSystemFonts:true }).promise
const recs=[]
for(let p=1;p<=doc.numPages;p++){
  const tc = await (await doc.getPage(p)).getTextContent()
  const items = tc.items.filter(i=>i.str.trim()).map(i=>({x:Math.round(i.transform[4]),y:Math.round(i.transform[5]),s:i.str.trim()}))
  const rows={}
  for(const i of items){ const k=Object.keys(rows).find(k=>Math.abs(+k-i.y)<=3); (rows[k??i.y]=rows[k??i.y]||[]).push(i) }
  const kv={}
  for(const r of Object.values(rows)){
    const lab=r.filter(i=>i.x<125).sort((a,b)=>a.x-b.x).map(i=>i.s).join(' ').trim()
    const val=r.filter(i=>i.x>=125&&i.x<300).sort((a,b)=>a.x-b.x).map(i=>i.s).join(' ').trim()
    if(!lab) continue
    const m=lab.match(/^(.*?)\s+([A-Z0-9][A-Za-z0-9\/\-, .]*)$/)
    if(val) kv[lab]=val
    else if(m && /Sequence|Account/.test(lab)) kv[m[1].trim()]=m[2].trim()
    else kv[lab]=kv[lab]??null
  }
  if(!kv['Policy Number'] || !kv['Chassis Number']) continue
  const per=(kv['Policy Period']||'').match(/(\d{2}\/\d{2}\/\d{4})\s*-\s*(\d{2}\/\d{2}\/\d{4})/)
  const my=(kv['Model/Production Year']||'').match(/^(.*?)\s*\/\s*(\d{4})$/)
  const asset=(kv['Asset Number']||'').trim()
  const am=asset.match(/^(\S+)(?:\s+(.*))?$/)
  recs.push({source_page:p, policy_no:kv['Policy Number'], policy_holder:kv['Policy Holder Name']||null,
    period_from:per?per[1]:null, period_to:per?per[2]:null,
    make:kv['Vehicle Make']||null, plate_no:kv['Plate']||null, chassis_no:kv['Chassis Number']||null,
    model: my?my[1].trim():(kv['Model/Production Year']||null), model_year: my?+my[2]:null,
    asset_number_field: asset||null, asset_token: am?am[1]:null, asset_extra: am&&am[2]?am[2]:null,
    seq_no: kv['Sequence No/Custom Id']||null, insurance_type: kv['Type of Insurance']||null,
    additional_coverage: kv['Additional Coverage']||null})
}
fs.writeFileSync(out, JSON.stringify(recs,null,1))
console.log(file.split('/').pop(),'certs',recs.length)
console.log('policies',[...new Set(recs.map(r=>r.policy_no))])
console.log('fill',['asset_token','plate_no','chassis_no','make','model','model_year','seq_no'].map(f=>f+'='+recs.filter(r=>r[f]).length).join(' '))
const codes=recs.map(r=>r.asset_token).filter(v=>v&&/^[A-Z]{2,3}-?\s?\d{2,4}$/.test(v))
console.log('fleet-code-shaped asset tokens',codes.length,'distinct',new Set(codes).size)
console.log('other tokens',[...new Set(recs.map(r=>r.asset_token).filter(v=>v&&!/^[A-Z]{2,3}-?\s?\d{2,4}$/.test(v)))].slice(0,12))
console.log('sample',JSON.stringify(recs.slice(0,2),null,1))
