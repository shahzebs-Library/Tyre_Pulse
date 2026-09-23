import history from '../data/releases.json'
import { moduleAvailable } from './workspaceAccess'
function configuredRelease() {
  try {
    const raw = import.meta.env.TP_RELEASE
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    return validReleaseManifest(value) ? value : null
  } catch { return null }
}
export const installedRelease = configuredRelease() || { schema: 1, buildId: 'development', releases: history }
export function visibleReleases(releases, auth) {
  if (!auth.profile || auth.loading) return []
  const admin = auth.isSuperAdmin === true || auth.profile.role === 'Admin'
  return releases.map(release => ({ ...release, changes: release.changes.filter(change => admin || !change.modules.length || change.modules.some(key => moduleAvailable(auth, key))) })).filter(r => r.changes.length)
}
export function changesSince(manifest, installedId) {
  const index = manifest.releases.findIndex(r => r.id === installedId)
  return index < 0 ? manifest.releases.slice(0, 1) : manifest.releases.slice(0, index)
}
export function validReleaseManifest(data) {
  return data?.schema === 1 && typeof data.buildId === 'string' && Array.isArray(data.releases) && data.releases.length > 0 && data.releases.length <= 100 && data.releases.every(r => typeof r.id === 'string' && typeof r.date === 'string' && Array.isArray(r.changes) && r.changes.every(c => Array.isArray(c.modules) && c.modules.every(k => typeof k === 'string') && typeof c.text?.en === 'string'))
}
// Ask the exact WAITING worker. Fetching /latest.json could describe a newer
// deploy than the worker about to activate. Timeout preserves the update action.
export function readWaitingRelease(worker, { signal, timeout = 3000 } = {}) {
  if (!worker || signal?.aborted) return Promise.resolve(null)
  return new Promise(resolve => {
    const channel = new MessageChannel()
    let timer
    const finish = value => {
      clearTimeout(timer); channel.port1.close(); channel.port2.close()
      signal?.removeEventListener('abort', abort)
      resolve(value)
    }
    const abort = () => finish(null)
    signal?.addEventListener('abort', abort, { once: true })
    channel.port1.onmessage = event => finish(validReleaseManifest(event.data) ? event.data : null)
    timer = setTimeout(abort, timeout)
    try { worker.postMessage({ type: 'TP_RELEASE_NOTES' }, [channel.port2]) } catch { finish(null) }
  })
}
