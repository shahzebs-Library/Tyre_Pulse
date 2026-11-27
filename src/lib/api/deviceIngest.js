/**
 * Device ingest service - the one seam between the Devices & Integrations
 * page and the device-ingest RPCs (migration 20261128100000_device_ingest).
 *
 * Every RPC re-checks Admin / super admin server-side and raises 42501 for
 * anyone else; the page being admin-only is a convenience, not the boundary.
 * Before the migration is applied the RPCs do not exist: `isNotProvisioned`
 * turns that into `{ missing: true }` so the page shows an honest
 * "not set up yet" state instead of an error.
 */
import { supabase, unwrap, toServiceError, isNotProvisioned } from './_client'
import { MESSAGE_TYPES, VENDORS, normalizeBatch, SAMPLE_PAYLOADS } from '../../../supabase/functions/_shared/deviceIngest.js'

export { MESSAGE_TYPES, VENDORS, SAMPLE_PAYLOADS }

/** Public endpoint a device posts to. */
export function ingestEndpoint() {
  const base = (import.meta.env?.VITE_SUPABASE_URL || '').replace(/\/+$/, '')
  return base ? `${base}/functions/v1/device-ingest` : '/functions/v1/device-ingest'
}

async function rpc(name, args) {
  try {
    return unwrap(await supabase.rpc(name, args))
  } catch (err) {
    throw toServiceError(err, 'The device service did not answer. Try again.')
  }
}

/** Keys + overview in one call. `{ missing:true }` before the migration. */
export async function loadIngestState() {
  try {
    const [keys, overview, unmatched] = await Promise.all([
      unwrap(await supabase.rpc('device_ingest_keys_list')),
      unwrap(await supabase.rpc('device_ingest_overview')),
      unwrap(await supabase.rpc('device_ingest_unmatched_list', { p_limit: 200 })),
    ])
    return { missing: false, keys: keys || [], overview: overview || {}, unmatched: unmatched || [] }
  } catch (err) {
    if (isNotProvisioned(err)) return { missing: true, keys: [], overview: {}, unmatched: [] }
    throw toServiceError(err, 'Could not load devices and integrations.')
  }
}

/** Validate the form before it reaches the server. Returns an error string or ''. */
export function validateKeyForm({ name, dataTypes, rate } = {}) {
  if (!String(name || '').trim()) return 'name_required'
  if (String(name).trim().length > 120) return 'name_too_long'
  const types = Array.isArray(dataTypes) ? dataTypes : []
  if (!types.length) return 'types_required'
  if (types.some((t) => !MESSAGE_TYPES.includes(t))) return 'types_invalid'
  const r = Number(rate)
  if (!Number.isInteger(r) || r < 1 || r > 6000) return 'rate_invalid'
  return ''
}

/** Mint a key. Resolves { id, key, prefix }; `key` is shown ONCE and never stored. */
export async function createIngestKey({ name, dataTypes, deviceRowId = null, rate = 600, expiresAt = null, vendor = 'generic' }) {
  const err = validateKeyForm({ name, dataTypes, rate })
  if (err) throw toServiceError({ message: err, code: '22023' }, 'Check the form and try again.')
  return rpc('device_ingest_key_create', {
    p_name: String(name).trim(),
    p_data_types: dataTypes,
    p_device_row: deviceRowId || null,
    p_rate: Number(rate),
    p_expires_at: expiresAt || null,
    p_vendor: VENDORS.includes(vendor) ? vendor : 'generic',
  })
}

export function revokeIngestKey(id, reason) {
  return rpc('device_ingest_key_revoke', { p_id: id, p_reason: reason ? String(reason).slice(0, 500) : null })
}

export function resolveUnmatched(id, vehicleId) {
  return rpc('device_ingest_resolve_unmatched', { p_id: id, p_vehicle_id: vehicleId })
}

export function dismissUnmatched(id) {
  return rpc('device_ingest_dismiss_unmatched', { p_id: id })
}

export function saveIngestSettings(settings) {
  return rpc('device_ingest_save_settings', { p_settings: settings || {} })
}

/**
 * "Send test payload": validate + map in the browser with the same module the
 * edge function uses, then ask the server which asset each message would hit.
 * Nothing is written. Returns { vendor, rows:[{ index, type, status, error?, asset_no?, target_table? }] }.
 */
export async function testPayload(text, vendor) {
  let body
  try {
    body = typeof text === 'string' ? JSON.parse(text) : text
  } catch {
    return { vendor: vendor || 'generic', rows: [], error: 'bad_json' }
  }
  const batch = normalizeBatch(body, { vendor })
  if (batch.error) return { vendor: batch.vendor, rows: [], error: batch.error }
  const rows = batch.rejected.map((r) => ({ index: r.index, type: r.type, status: 'rejected', error: r.error }))
  if (batch.messages.length) {
    const res = await rpc('device_ingest_dry_run', { p_messages: batch.messages.slice(0, 50).map((m) => m.message) })
    ;(res?.results || []).forEach((r, i) => {
      const src = batch.messages[i]
      rows.push({ index: src.index, type: src.message.type, status: r.status, error: r.error || r.reason || null,
        asset_no: r.asset_no || null, target_table: r.target_table || null })
    })
  }
  rows.sort((a, b) => a.index - b.index)
  return { vendor: batch.vendor, rows }
}

/** curl snippet shown under a freshly minted key. */
export function curlExample(key, vendor = 'generic') {
  const sample = SAMPLE_PAYLOADS[vendor] || SAMPLE_PAYLOADS.generic
  const q = vendor && vendor !== 'generic' ? `?vendor=${vendor}` : ''
  return `curl -X POST '${ingestEndpoint()}${q}' \\\n  -H 'x-device-key: ${key}' \\\n  -H 'content-type: application/json' \\\n  -d '${JSON.stringify(sample)}'`
}
