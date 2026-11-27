/**
 * The signed-in user's access, read in ONE request where the database offers it.
 *
 * Sign-in and every tab refocus need three reads: the enforced module map
 * (get_user_module_permissions), the per-user grant overlay
 * (get_my_access_grants) and the per-capability overlay (get_my_capabilities).
 * From Saudi Arabia each request is a ~400 ms round trip to the database
 * region, so get_my_access_bundle (migration 20261126180000) answers all three
 * at once.
 *
 * Contract kept exactly: each part comes back as its own `{ data, error }`, so
 * AuthContext keeps the fail-closed handling it already had per read. A part
 * the bundle could not compute is read again with its own RPC, and when the
 * bundle function is not installed (42883 / PGRST202) or the bundle request
 * fails, the three reads go out separately as before.
 */
import { isNotProvisioned } from './_client'

// Learned once per session: the bundle RPC is not installed on this database.
let bundleMissing = false
/** Test hook. */
export function _resetAccessBundleProbe() { bundleMissing = false }

const settle = () => ({ data: null, error: true })

const SINGLE = {
  perms: 'get_user_module_permissions',
  grants: 'get_my_access_grants',
  caps: 'get_my_capabilities',
}

function single(client, key) {
  return Promise.resolve()
    .then(() => client.rpc(SINGLE[key]))
    .then((r) => r, settle)
}

function part(bundle, name) {
  const p = bundle?.[name]
  if (!p || typeof p !== 'object' || p.error !== false) return null
  return { data: p.data ?? null, error: null }
}

/**
 * @param {object} client supabase client
 * @returns {Promise<{ perms:{data,error}, grants:{data,error}, caps:{data,error} }>}
 *   never rejects; a failed part is `{ data: null, error: <truthy> }`.
 */
export async function loadMyAccess(client) {
  if (!bundleMissing) {
    const res = await Promise.resolve()
      .then(() => client.rpc('get_my_access_bundle'))
      .then((r) => r, (error) => ({ data: null, error }))
    if (res?.error && isNotProvisioned(res.error)) bundleMissing = true
    if (!res?.error && res?.data && typeof res.data === 'object') {
      const out = {
        perms: part(res.data, 'module_permissions'),
        grants: part(res.data, 'access_grants'),
        caps: part(res.data, 'capabilities'),
      }
      // A part the bundle could not compute is asked for on its own, so a
      // failure inside the bundle is never worse than the separate reads.
      const missing = Object.keys(out).filter((k) => !out[k])
      if (missing.length) {
        const again = await Promise.all(missing.map((k) => single(client, k)))
        missing.forEach((k, i) => { out[k] = again[i] })
      }
      return out
    }
  }
  const [perms, grants, caps] = await Promise.all([single(client, 'perms'), single(client, 'grants'), single(client, 'caps')])
  return { perms, grants, caps }
}
