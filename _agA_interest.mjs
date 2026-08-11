import fs from 'node:fs'
const [,,txt,out] = process.argv
const src = fs.readFileSync(txt,'utf8')
const parts = src.split(/^===== PAGE (\d+) =====$/m)
const policy = (src.match(/POLICY NUMBER (\S+)/)||[])[1]
const num = s => s==null?null:Number(String(s).replace(/,/g,''))
const ITEM = /(\d+)\.\s*(.+?)\s+([\d,]+\.\d{2})(?:\s+([\d,]+\.\d{2}))?\s+(In Force|Deleted|Cancelled)/g
const SKIP = /^(Interest List|SCHEDULE DETAILS|Insured\s*:|Currency\s*:|Sr\.$|No\.$|Risk$|ID\.$|Location Item|Policy Period|From To|Signed on behalf|Printed:|Grand Total)/
let cur=null; const risks=[]; const totals=[]
const addItems=(line,page)=>{ let m,n=0; ITEM.lastIndex=0
  while((m=ITEM.exec(line))){ let desc=m[2].trim(), qty=null
    const q=desc.match(/\s*(\d+)\s*(?:Qty|qty)\s*$/i); if(q){qty=+q[1];desc=desc.slice(0,q.index).trim()}
    cur.items.push({item_no:+m[1],description:desc,quantity:qty,total_value:num(m[3]),premium:num(m[4]),status:m[5],page}); n++ }
  return n }
for(let i=1;i<parts.length;i+=2){
  const page=+parts[i]
  for(const raw of parts[i+1].split('\n')){
    const l=raw.trim(); if(!l||SKIP.test(l)) continue
    let m
    if((m=l.match(/^(\d+)\s+(R\d{4,6})\s+(.*)$/))){
      cur={sr:+m[1],risk_id:m[2],location:null,city:null,map_url:null,age:null,floors:null,gps_lat:null,gps_lng:null,
           page,items:[],period_from:null,period_to:null,cover:null,_hdr:[]}
      risks.push(cur)
      let rest=m[3]
      const per=rest.match(/(.*?)\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s*$/)
      if(per){ rest=per[1]; cur.period_from=per[2]; cur.period_to=per[3] }
      const it=rest.match(/^(.*?)(\d+\.\s)/)
      if(it && addItems(rest,page)){ rest=it[1] }
      const cv=rest.match(/\s*(Property All Risk|Contractor.*)$/); if(cv){ cur.cover=cv[1].trim(); rest=rest.slice(0,cv.index) }
      cur.location = rest.trim()||null
      continue
    }
    if(!cur) continue
    if((m=l.match(/^Age of Building:\s*(\d+)/))){ cur.age=+m[1]; continue }
    if((m=l.match(/^GPS:\s*([\d.\-]+)\s*;\s*([\d.\-]+)/))){ cur.gps_lat=+m[1]; cur.gps_lng=+m[2]; continue }
    if((m=l.match(/^No\. of Floors\s*:\s*(\d+)/))){ cur.floors=+m[1]; continue }
    if((m=l.match(/^Risk Total\s+([\d,]+\.\d{2})(?:\s+([\d,]+\.\d{2}))?/))){ totals.push({risk_id:cur.risk_id,total:num(m[1]),premium:num(m[2])}); continue }
    if(/^https?:|goo\.gl|maps\.app/.test(l)){ cur.map_url=(cur.map_url||'')+l; continue }
    if(/\d+\.\s.*(In Force|Deleted|Cancelled)/.test(l)){
      const per=l.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s*$/)
      if(per && !cur.period_from){ cur.period_from=per[1]; cur.period_to=per[2] }
      const cv=l.match(/(Property All Risk|Contractor[^0-9]*)\s*\d{2}\//); if(cv&&!cur.cover) cur.cover=cv[1].trim()
      addItems(l,page); continue
    }
    if((m=l.match(/^(Property All Risk|Contractor.*?)\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})$/))){ cur.cover=m[1].trim(); cur.period_from=m[2]; cur.period_to=m[3]; continue }
    cur._hdr.push(l)
  }
}
for(const r of risks){ const plain=r._hdr.filter(x=>!/^[A-Za-z0-9_?=&.\-]{8,}$/.test(x)||/\s/.test(x)); r.city = plain.length?plain[plain.length-1]:null }
fs.writeFileSync(out, JSON.stringify({policy,risks,totals},null,1))
const itemSum = risks.reduce((a,r)=>a+r.items.reduce((b,i)=>b+i.total_value,0),0)
const totSum = totals.reduce((a,t)=>a+t.total,0)
console.log('==',txt.split('/').pop())
console.log('policy',policy,'risks',risks.length,'totals',totals.length,'items',risks.reduce((a,r)=>a+r.items.length,0))
console.log('item sum',itemSum.toFixed(2),'risk-total sum',totSum.toFixed(2),'diff',(itemSum-totSum).toFixed(2))
console.log('premium(items) ',risks.reduce((a,r)=>a+r.items.reduce((b,i)=>b+(i.premium||0),0),0).toFixed(2),'premium(risk totals)',totals.reduce((a,t)=>a+(t.premium||0),0).toFixed(2))
const bad = risks.map(r=>({id:r.risk_id,loc:r.location, s:+r.items.reduce((b,i)=>b+i.total_value,0).toFixed(2), t:(totals.find(t=>t.risk_id===r.risk_id)||{}).total}))
  .filter(x=>x.t==null || Math.abs(x.s-x.t)>0.02)
console.log('risks not reconciling',bad.length,JSON.stringify(bad))
console.log('leftover header lines',[...new Set(risks.flatMap(r=>r._hdr))].slice(0,10))
console.log('locations',risks.map(r=>r.risk_id+'='+r.location+' /'+r.city).join(' | '))
