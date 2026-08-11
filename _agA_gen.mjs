import fs from 'node:fs'
const SD='/tmp/claude-0/-home-user-Tyre-Pulse/fd290347-d58d-4b67-bff7-bb8aec80ea8c/scratchpad'
const ORG='00000000-0000-0000-0000-000000000001'
const MON={JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12}
export const iso = v => {            // explicit, never a bare ::timestamptz cast
  if(!v) return null
  let m = String(v).trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)            // DD/MM/YYYY day-first
  if(m){ const d=+m[1], mo=+m[2]; if(mo<1||mo>12||d<1||d>31) throw new Error('ambiguous/invalid day-first date: '+v)
    return `${m[3]}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}` }
  m = String(v).trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/)                     // DD-Mon-YYYY
  if(m) return `${m[3]}-${String(MON[m[2].toUpperCase()]).padStart(2,'0')}-${m[1].padStart(2,'0')}`
  m = String(v).trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/)                     // DD-MON-YY (Alinma)
  if(m) return `20${m[3]}-${String(MON[m[2].toUpperCase()]).padStart(2,'0')}-${m[1].padStart(2,'0')}`
  m = String(v).trim().match(/^(\d{4})-(\d{2})-(\d{2})/)
  if(m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}
export const isoUS = v => {          // the Claims Experience forms print MM/DD/YYYY
  if(!v) return null
  const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if(!m) return null
  const mo=+m[1], d=+m[2]; if(mo<1||mo>12||d<1||d>31) throw new Error('bad US date: '+v)
  return `${m[3]}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`
}
export const num = v => { if(v==null) return null; const s=String(v).replace(/[ ,]/g,''); if(!/^-?\d+(\.\d+)?$/.test(s)) return null; return Number(s) }
export const sq = s => "'"+String(s).replace(/'/g,"''")+"'"
export const jsonLit = arr => sq(JSON.stringify(arr))
export const load = f => JSON.parse(fs.readFileSync(`${SD}/ins/${f}`,'utf8'))
export { SD, ORG }
