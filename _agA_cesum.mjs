import fs from 'node:fs'
const SD=process.argv[2]
const n=s=>Number(String(s).replace(/,/g,''))
const out=[]
// Alinma Tokio Marine style
for(const f of ['CE - CPM - 2022 - 2024','CE - PAR - 2023 - 2024']){
  const t=fs.readFileSync(`${SD}/ins/txt/${f}.txt`,'utf8').replace(/\n/g,' ')
  const re=/(P\/[\d\/]+(?:\/R\d)?)\s+(\d{2}-[A-Z]{3}-\d{2})\s*\/\s*(\d{2}-[A-Z]{3}-\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/g
  let m; const rows=[]
  while((m=re.exec(t))) rows.push({policy_no:m[1],period_from:m[2],period_to:m[3],outstanding_amount:n(m[4]),paid_amount:n(m[5]),total:n(m[6])})
  const tot=t.match(/Total\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})/)
  const cover=/CPM/.test(f)?'CPM':'PAR'
  out.push({source_file:f+'.pdf', insurer:'Alinma Tokio Marine', cover_type:cover, rows,
    stated_total: tot?{outstanding:n(tot[1]),paid:n(tot[2]),total:n(tot[3])}:null})
}
// Walaa style
{
  const f='CE - CPM - 2025 -2026'
  const t=fs.readFileSync(`${SD}/ins/txt/${f}.txt`,'utf8')
  const rows=[]
  for(const line of t.split('\n')){
    const m=line.trim().match(/^(P-C01-\d{2}-\d{5}-\d{6})\s+(.+?)\s+(Green [A-Za-z ]+Company)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)$/)
    if(m) rows.push({policy_no:m[1],lob:m[2].trim(),insured:m[3],period_from:m[4],period_to:m[5],outstanding_amount:n(m[6]),paid_amount:n(m[7]),total:n(m[8])})
  }
  const tot=t.match(/Total\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)/)
  out.push({source_file:f+'.pdf', insurer:'Walaa Cooperative Insurance Company', cover_type:null, rows,
    stated_total: tot?{outstanding:n(tot[1]),paid:n(tot[2]),total:n(tot[3])}:null})
}
fs.writeFileSync(`${SD}/ins/ce_summaries.json`, JSON.stringify(out,null,1))
for(const f of out){
  const s=f.rows.reduce((a,r)=>[a[0]+r.outstanding_amount,a[1]+r.paid_amount,a[2]+r.total],[0,0,0])
  console.log(f.source_file,'rows',f.rows.length,'sum',s.map(x=>x.toFixed(2)).join('/'),'stated',JSON.stringify(f.stated_total))
}
