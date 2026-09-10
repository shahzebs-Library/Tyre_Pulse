import fs from 'node:fs';const p='audit/checklist-quality-fixes.mjs';let s=fs.readFileSync(p,'utf8');s=s.slice(0,s.indexOf("edit('src/lib/exportUtils.js'"));fs.writeFileSync(p,s);
