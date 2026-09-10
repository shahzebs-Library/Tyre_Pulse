import fs from 'node:fs';
const asset=fs.readdirSync('dist').find(x=>x.startsWith('release-notes-'));
const data=fs.readFileSync('dist/'+asset,'utf8');
if(!data.includes('اطّلع')||data.includes('????')) throw new Error('Arabic release encoding invalid');
console.log('Built worker contains corrected Arabic release text.');
