import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
for(const p of execFileSync('git',['diff','--name-only','--','src'],{encoding:'utf8'}).trim().split('\n')){if(p)fs.writeFileSync(p,fs.readFileSync(p,'utf8').replaceAll('\r\n','\n'));}
