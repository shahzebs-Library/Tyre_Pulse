/**
 * ERP connection config — stored in app_settings under `erp_connection` as a
 * small JSON blob. NON-SECRET only (system, base URL, entities, cadence, on/off).
 * The API key/token is never kept here or in the browser; it is set as an
 * edge-function secret (see docs/ERP_INTEGRATION.md) so it can't leak client-side.
 */
import { supabase, unwrap } from './_client'

const KEY = 'erp_connection'

export const ERP_SYSTEMS = [
  { id: 'sap',      label: 'SAP' },
  { id: 'oracle',   label: 'Oracle' },
  { id: 'odoo',     label: 'Odoo' },
  { id: 'dynamics', label: 'Microsoft Dynamics' },
  { id: 'sage',     label: 'Sage' },
  { id: 'custom',   label: 'Custom REST API' },
]
export const ERP_AUTH = [
  { id: 'api_key', label: 'API key (header)' },
  { id: 'bearer',  label: 'Bearer token' },
  { id: 'basic',   label: 'Basic auth' },
  { id: 'oauth2',  label: 'OAuth 2.0' },
]
export const ERP_ENTITIES = [
  { id: 'tyre',      label: 'Tyre records' },
  { id: 'fleet',     label: 'Vehicles / fleet' },
  { id: 'stock',     label: 'Stock' },
  { id: 'workorder', label: 'Work orders' },
  { id: 'supplier',  label: 'Suppliers' },
]
export const ERP_FREQUENCY = ['manual', 'hourly', 'daily', 'weekly']

export const DEFAULT_ERP = Object.freeze({
  system: 'custom', name: 'ERP', base_url: '', auth_type: 'api_key',
  entities: ['tyre', 'fleet'], frequency: 'daily', enabled: false,
})

/** Read the saved ERP connection config (or defaults). */
export async function getErpConnection() {
  const rows = unwrap(
    await supabase.from('app_settings').select('value').eq('key', KEY).maybeSingle(),
  )
  if (!rows?.value) return { ...DEFAULT_ERP }
  try {
    const v = typeof rows.value === 'string' ? JSON.parse(rows.value) : rows.value
    return { ...DEFAULT_ERP, ...v }
  } catch { return { ...DEFAULT_ERP } }
}

/** Save the ERP connection config (admins only, enforced by app_settings RLS). */
export async function saveErpConnection(config) {
  const clean = {
    system: config.system || 'custom',
    name: (config.name || 'ERP').slice(0, 80),
    base_url: (config.base_url || '').trim().slice(0, 500),
    auth_type: config.auth_type || 'api_key',
    entities: Array.isArray(config.entities) && config.entities.length ? config.entities : ['tyre'],
    frequency: config.frequency || 'daily',
    enabled: !!config.enabled,
    updated_at: new Date().toISOString(),
  }
  if (clean.base_url && !/^https:\/\//i.test(clean.base_url)) {
    throw new Error('Base URL must start with https:// (secure endpoints only).')
  }
  const { error } = await supabase.from('app_settings').upsert(
    { key: KEY, value: JSON.stringify(clean) }, { onConflict: 'key' },
  )
  if (error) throw new Error(error.message || 'Could not save the ERP connection.')
  return clean
}
