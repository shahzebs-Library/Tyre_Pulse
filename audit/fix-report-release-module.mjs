import fs from 'node:fs';const p='src/data/releases.json';const r=JSON.parse(fs.readFileSync(p,'utf8'));r[0].changes[2].modules=['tyre_records'];fs.writeFileSync(p,JSON.stringify(r,null,2)+'\n');
