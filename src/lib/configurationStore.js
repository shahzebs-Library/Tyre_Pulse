import { createRequestCache } from './requestCache'

/** How long a configuration read is reused before asking the server again. */
export const CONFIG_TTL_MS = 60000

// Tenant identity is derived by the server, never supplied by the browser.
// Missing rollout support is an error; never fall back to global tenant values.
//
// Reads are cached per signed-in user + organisation for CONFIG_TTL_MS, and
// concurrent callers share one request. Each read is a full round trip to the
// database region (~250-450 ms from Riyadh) for a value that changes rarely.
// The cache is cleared when the identity changes (setConfigurationScope), and
// a namespace is dropped whenever it is saved here. Failed reads are never
// cached. Before an identity is known (scope '' or no user) nothing is cached.
export function listConfiguration(client, namespace) {
  return cachedRead(`${namespace}|*`, () =>
    client.rpc('get_organisation_configuration', { p_namespace: namespace, p_key: null }))
}

// Settings values are stored as text. Older saves wrapped plain strings in JSON
// quotes, sometimes twice ("\"SAR\""), so the UI showed "SAR" with the quotes.
// Peel every JSON layer until the value is no longer an encoded string.
export function decodeConfigValue(value) {
  let out = value
  for (let i = 0; i < 4 && typeof out === 'string'; i += 1) {
    const t = out.trim()
    if (!t) return t
    let next
    try { next = JSON.parse(t) } catch { return out }
    if (next === out) return out
    out = next
  }
  return out
}

// Keys that are always text, even when the value looks like a number.
const TEXT_KEYS = new Set(['company_name', 'currency'])

/**
 * Text settings: remove storage quoting only while the next layer is still
 * text. A name that is itself valid JSON ("1.00", "null", "true") stays the
 * name the person typed instead of becoming a number or null.
 */
export function decodeTextValue(value) {
  if (value == null) return ''
  let out = typeof value === 'string' ? value : String(value)
  for (let i = 0; i < 4; i += 1) {
    const t = out.trim()
    if (!t.startsWith('"')) return out
    let next
    try { next = JSON.parse(t) } catch { return out }
    if (typeof next !== 'string') return out
    out = next
  }
  return out
}

export function decodeConfigRows(rows) {
  const map = {}
  for (const { key, value } of rows ?? []) {
    map[key] = TEXT_KEYS.has(key) ? decodeTextValue(value) : decodeConfigValue(value)
  }
  return map
}

export async function getConfiguration(client, namespace, key) {
  const result = await cachedRead(`${namespace}|k:${key}`, () =>
    client.rpc('get_organisation_configuration', { p_namespace: namespace, p_key: key }))
  return { ...result, data: result.error ? null : (result.data?.[0] ?? null) }
}

export async function saveConfiguration(client, namespace, rows) {
  const values = (Array.isArray(rows) ? rows : [rows]).map(({ key, value }) => ({ key, value }))
  // Drop the namespace before AND after: a read that started before this save
  // must not repopulate the cache with the old value.
  invalidateConfiguration(namespace)
  const result = await client.rpc('save_organisation_configuration', { p_namespace: namespace, p_values: values })
  invalidateConfiguration(namespace)
  if (!result.error && result.data?.saved !== values.length) {
    return { data: null, error: new Error('The server did not confirm every settings change. Reload before retrying.') }
  }
  return result
}

// Invalidate tenant-local caches, including requests started before an identity change.
let scope = ''
let generation = 0
const listeners = new Set()
export const configurationGeneration = () => generation
/** The current `${userId}|${orgId}` identity ('' before sign-in). */
export const configurationScope = () => scope
/** True when `scope` names a signed-in user, so a per-user cache is safe. */
export const isCacheableScope = (value = scope) => typeof value === 'string' && value.split('|')[0] !== ''

const configCache = createRequestCache({ ttlMs: CONFIG_TTL_MS })

function cachedRead(suffix, load) {
  const current = scope
  if (!isCacheableScope(current)) return Promise.resolve(load())
  return configCache
    .get(`${current}|${suffix}`, () => Promise.resolve(load()), { cacheIf: (r) => r && !r.error })
    .then(copyResult)
}

// Callers get their own arrays and row objects, so one screen editing a row
// can never change what another screen reads from the cache.
function copyResult(result) {
  if (!result || !Array.isArray(result.data)) return result
  return { ...result, data: result.data.map((row) => (row && typeof row === 'object' ? { ...row } : row)) }
}

/**
 * Forget cached configuration for the current identity: one key, a whole
 * namespace, or everything. Use before a read that must reflect a change made
 * elsewhere (for example a live permission update).
 */
export function invalidateConfiguration(namespace, key) {
  if (!namespace) { configCache.clear(); return }
  const base = `${scope}|${namespace}|`
  if (key == null) { configCache.invalidate(base); return }
  configCache.invalidate(`${base}k:${key}`)
  configCache.invalidate(`${base}*`)
}
export function setConfigurationScope(next) {
  if (next === scope) return
  scope = next
  generation += 1
  configCache.clear()
  for (const listener of listeners) listener()
}
export function subscribeConfigurationScope(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
