import fs from 'node:fs'
const [,,txt,out] = process.argv
const parts = fs.readFileSync(txt,'utf8').split(/^===== PAGE (\d+) =====$/m)
const recs=[]
const g=(b,label)=>{ const m=b.match(new RegExp('^\\s*'+label+'\\s*(?:\\n)?\\s*:\\s*(.*)$','m')); if(!m) return null
  let v=m[1].replace(/[؀-ۿً-ٟ].*$/,'').replace(/\s*:\s*$/,'').trim(); return v||null }
for(let i=1;i<parts.length;i+=2){
  const page=+parts[i], b=parts[i+1]
  if(!/CERTIFICATE OF INSURANCE/.test(b)) continue
  const period = b.match(/Policy Period\s*:\s*From (\d{2}\/\d{2}\/\d{4}) to (\d{2}\/\d{2}\/\d{4})/)
  recs.push({
    source_page: page,
    policy_number: g(b,'Policy Number'),
    policy_holder: g(b,'Policy Holder Name'),
    description: (b.match(/Description of Machinery\n\s*\/ Equipment\s*\n\s*:\s*(.*)/)||[])[1]?.replace(/[؀-ۿ].*$/,'').trim()||null,
    plate_no: g(b,'Plate No\\.'),
    chassis_no: g(b,'Chassis \\/ Serial No\\.'),
    year: g(b,'Year of Manufacturing'),
    asset_id: g(b,'Asset ID No\\.'),
    location: g(b,'Location'),
    period_from: period? period[1]:null,
    period_to: period? period[2]:null,
  })
}
fs.writeFileSync(out, JSON.stringify(recs,null,1))
console.log('certs',recs.length)
console.log('with asset_id',recs.filter(r=>r.asset_id).length,'with chassis',recs.filter(r=>r.chassis_no).length,'with plate',recs.filter(r=>r.plate_no).length,'with year',recs.filter(r=>r.year).length)
console.log('sample',JSON.stringify(recs.slice(0,2),null,1))
const c={};for(const r of recs) c[r.asset_id]=(c[r.asset_id]||0)+1
console.log('dup asset ids', Object.entries(c).filter(([,v])=>v>1).length, Object.entries(c).filter(([,v])=>v>1).slice(0,10))
console.log('periods',[...new Set(recs.map(r=>r.period_from+'->'+r.period_to))])
