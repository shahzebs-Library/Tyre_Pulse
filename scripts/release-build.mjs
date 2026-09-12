import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
// Public, editorial notes only. Never include account names or operational data.
export function releaseBuild() {
  const releases = JSON.parse(readFileSync(new URL('../src/data/releases.json', import.meta.url), 'utf8'))
  const ids = new Set()
  for (const release of releases) {
    if (!release.id || ids.has(release.id) || !/^\d{4}-\d{2}-\d{2}$/.test(release.date) || !release.changes?.length) throw new Error('Invalid or duplicate release notes')
    ids.add(release.id)
    for (const change of release.changes) if (!Array.isArray(change.modules) || !change.text?.en) throw new Error('Release notes require module tags and English text')
  }
  const manifest = { schema: 1, buildId: process.env.VERCEL_GIT_COMMIT_SHA || 'local', releases }
  const json = JSON.stringify(manifest)
  const filename = `release-notes-${createHash('sha256').update(json).digest('hex').slice(0,16)}.js`
  return { manifest, filename, plugin: {
    name: 'tyrepulse-release-notes',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: filename, source: `self.addEventListener('message', event => { if (event.data?.type === 'TP_RELEASE_NOTES' && event.ports?.[0]) event.ports[0].postMessage(${json}); });` })
    },
  } }
}
