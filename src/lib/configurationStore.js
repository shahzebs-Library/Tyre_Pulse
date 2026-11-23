// Tenant identity is derived by the server, never supplied by the browser.
// Missing rollout support is an error; never fall back to global tenant values.
export function listConfiguration(client, namespace) {
  return client.rpc('get_organisation_configuration', { p_namespace: namespace, p_key: null })
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
  const result = await client.rpc('get_organisation_configuration', { p_namespace: namespace, p_key: key })
  return { ...result, data: result.error ? null : (result.data?.[0] ?? null) }
}

export async function saveConfiguration(client, namespace, rows) {
  const values = (Array.isArray(rows) ? rows : [rows]).map(({ key, value }) => ({ key, value }))
  const result = await client.rpc('save_organisation_configuration', { p_namespace: namespace, p_values: values })
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
export function setConfigurationScope(next) {
  if (next === scope) return
  scope = next
  generation += 1
  for (const listener of listeners) listener()
}
export function subscribeConfigurationScope(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
