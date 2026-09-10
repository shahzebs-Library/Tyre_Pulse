import fs from 'node:fs';
const p='CODEX_CONTEXT.md';const s=fs.readFileSync(p,'utf8');const anchor='- Default branch: `main`.';
const note='- Web release notes: add a new newest-first entry to `src/data/releases.json` for each user-facing web release (English/Arabic and affected module keys; no customer data). `scripts/release-build.mjs` embeds the same versioned notes in the app and waiting service worker. The update prompt reads that worker directly; Settings > Update history shows the installed history, filtered by effective module access. Keep prior entries so users who skip releases see all applicable changes.\n';
fs.writeFileSync(p,s.replace(anchor,note+anchor));
