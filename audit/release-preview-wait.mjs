import fs from 'node:fs';const p='audit/release-visual.mjs';let s=fs.readFileSync(p,'utf8').replaceAll("waitUntil:'networkidle'","waitUntil:'domcontentloaded'");fs.writeFileSync(p,s);
