/**
 * ERP connection config — stored in app_settings under `erp_connection` as a
 * small JSON blob. NON-SECRET only (system, base URL, entities, cadence, on/off).
 * The API key/token is never kept here or in the browser; it is set as an
 * edge-function secret (see docs/ERP_INTEGRATION.md) so it can't leak client-side.
 */
import { supabase, unwrap } from './_client'
import { validateErpConfig } from '../erpReliability'

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
  credential_ref: 'ERP_API_KEY', entities: ['tyre', 'fleet'], frequency: 'daily', enabled: false,
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
  const clean = { ...validateErpConfig(config), updated_at: new Date().toISOString() }
  const { error } = await supabase.from('app_settings').upsert(
    { key: KEY, value: JSON.stringify(clean) }, { onConflict: 'key' },
  )
  if (error) throw new Error(error.message || 'Could not save the ERP connection.')
  return clean
}

/** Read-only operational evidence. Missing V610 degrades honestly to no runs. */
export async function listErpSyncRuns(connectionId, limit = 25) {
  if (!connectionId) return []
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 25))
  const { data, error } = await supabase.from('erp_sync_runs')
    .select('id,connection_id,trigger_type,status,attempt,source_count,staged_count,rejected_count,duplicate_count,started_at,finished_at,heartbeat_at,error_code,error_summary,created_at')
    .eq('connection_id', connectionId).order('created_at', { ascending: false }).limit(safeLimit)
  if (error?.code === '42P01' || error?.code === 'PGRST205') return []
  if (error) throw new Error('Could not load ERP sync history.')
  return data || []
}

export async function getErpReliabilitySummary(connectionId) {
  const runs = await listErpSyncRuns(connectionId, 100)
  const latest = runs[0] || null
  const lastSuccess = runs.find((run) => run.status === 'succeeded') || null
  return {
    latest,
    lastSuccessAt: lastSuccess?.finished_at || null,
    failedRuns: runs.filter((run) => run.status === 'failed' || run.status === 'partial').length,
    reconciliation: latest ? {
      source: Number(latest.source_count) || 0,
      staged: Number(latest.staged_count) || 0,
      rejected: Number(latest.rejected_count) || 0,
      duplicates: Number(latest.duplicate_count) || 0,
    } : null,
  }
}
