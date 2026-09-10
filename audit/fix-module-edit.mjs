import fs from 'node:fs';
const p='audit/module-correctness-edit.mjs';let s=fs.readFileSync(p,'utf8');s="import fs from 'node:fs'; let p,s;\n"+s.slice(s.indexOf("p='src/lib/api/shifts.js'"));s=s.replaceAll('.index(','.indexOf(');fs.writeFileSync(p,s);
