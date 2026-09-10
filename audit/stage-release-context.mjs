import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
const current=fs.readFileSync('CODEX_CONTEXT.md','utf8');
const note=current.split('\n').find(line=>line.startsWith('- Web release notes:'));
const baseline=execFileSync('git',['show','HEAD:CODEX_CONTEXT.md'],{encoding:'utf8'});
fs.writeFileSync('audit/release-context-staged.md',baseline.replace('- Default branch: `main`.',note+'\n- Default branch: `main`.'));
const oid=execFileSync('git',['hash-object','-w','audit/release-context-staged.md'],{encoding:'utf8'}).trim();
execFileSync('git',['update-index','--cacheinfo','100644',oid,'CODEX_CONTEXT.md']);
