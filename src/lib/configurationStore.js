// Tenant identity is derived by the server, never supplied by the browser.
// Missing rollout support is an error; never fall back to global tenant values.
export function listConfiguration(client, namespace) {
  return client.rpc('get_organisation_configuration', { p_namespace: namespace, p_key: null })
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
