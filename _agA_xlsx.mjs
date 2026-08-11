import XLSX from 'xlsx'
import fs from 'node:fs'
const wb = XLSX.read(fs.readFileSync(process.argv[2]), {type:'buffer', cellDates:true})
for (const name of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], {header:1, raw:true, defval:null})
  console.log('=== SHEET', name, 'rows', rows.length)
  rows.slice(0,4).forEach((r,i)=>console.log(i, JSON.stringify(r)))
}
