/**
 * Telematics devices service - the single seam between the Telematics Device
 * Registry page (/telematics-devices) and Supabase (table `telematics_devices`,
 * V147). Keeps an explicit column list (least-privilege selects), null-safe
 * country scoping, and validation via the pure `src/lib/telematicsDevices.js`
 * helpers. RLS enforces org isolation and the read/write role split; this layer
 * never trusts client input blindly.
 *
 * Mirrors geofences.js / support.js. A missing `telematics_devices` relation
 * (org has not run the migration) degrades listing to an empty array so the
 * page can render its "apply the migration" empty state instead of erroring.
 */
import { supabase, unwrap, applyCountry } from './_client'
import { DEVICE_STATUSES } from '../telematicsDevices'

export const COLS =
  'id,organisation_id,country,device_id,provider,sim_number,asset_no,install_date,' +
  'last_seen_at,status,site,notes,created_by,created_at,updated_at'

/** True when the failure is "table does not exist yet" (pre-migration). */
function isMissingRelation(err) {
  const code = err?.code || err?.cause?.code
  const msg = String(err?.message || err?.cause?.message || '').toLowerCase()
  return (
    code === '42P01' || code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('schema cache') ||
    (msg.includes('relation') && msg.includes('telematics_devices'))
  )
}

/**
 * List devices (newest first). Optional `status` and `country` filters.
 * Returns [] when the table has not been provisioned yet.
 */
export async function listDevices({ country, status, limit = 500 } = {}) {
  try {
    let q = supabase.from('telematics_devices').select(COLS)
    if (status && DEVICE_STATUSES.includes(status)) q = q.eq('status', status)
    q = applyCountry(q, country)
    return unwrap(await q.order('created_at', { ascending: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * List devices AND report whether the registry table exists yet, in one call.
 * Returns `{ rows, missing }`: `missing` is true only when the failure is a
 * genuine "table not provisioned" (pre-migration) case, so the page can show
 * the honest "enable the registry" banner without conflating it with a real
 * empty registry. Any other error is rethrown for the page's error+Retry state.
 */
export async function listDevicesWithMeta({ country, status, limit = 500 } = {}) {
  try {
    let q = supabase.from('telematics_devices').select(COLS)
    if (status && DEVICE_STATUSES.includes(status)) q = q.eq('status', status)
    q = applyCountry(q, country)
    const rows = unwrap(await q.order('created_at', { ascending: false }).limit(limit)) || []
    return { rows, missing: false }
  } catch (err) {
    if (isMissingRelation(err)) return { rows: [], missing: true }
    throw err
  }
}

export async function getDevice(id) {
  return unwrap(await supabase.from('telematics_devices').select(COLS).eq('id', id).maybeSingle())
}

/** Normalise a form value to a trimmed string (or null) with a max length. */
function str(v, max) {
  if (v == null) return null
  const s = String(v).trim()
  if (!s) return null
  return max ? s.slice(0, max) : s
}

/** Build a clean, typed insert payload from raw form values. */
function toPayload(values = {}) {
  const status = DEVICE_STATUSES.includes(values.status) ? values.status : 'active'
  return {
    device_id: str(values.device_id, 120),
    provider: str(values.provider, 120),
    sim_number: str(values.sim_number, 60),
    asset_no: str(values.asset_no, 60),
    install_date: values.install_date ? String(values.install_date).slice(0, 10) : null,
    last_seen_at: values.last_seen_at ? new Date(values.last_seen_at).toISOString() : null,
    status,
    site: str(values.site, 200),
    notes: str(values.notes, 4000),
    country: values.country ?? null,
  }
}

/** Register a device. Requires a non-empty device_id (IMEI / serial). */
export async function createDevice(values = {}) {
  const device_id = str(values.device_id, 120)
  if (!device_id) throw new Error('A device ID (IMEI or serial) is required.')
  const payload = toPayload({ ...values, device_id })
  return unwrap(await supabase.from('telematics_devices').insert(payload).select(COLS).single())
}

/** Patch a device. Re-validates device_id when supplied; strips immutable fields. */
export async function updateDevice(id, patch = {}) {
  const clean = {}
  if (patch.device_id !== undefined) {
    const device_id = str(patch.device_id, 120)
    if (!device_id) throw new Error('A device ID (IMEI or serial) is required.')
    clean.device_id = device_id
  }
  if (patch.provider !== undefined) clean.provider = str(patch.provider, 120)
  if (patch.sim_number !== undefined) clean.sim_number = str(patch.sim_number, 60)
  if (patch.asset_no !== undefined) clean.asset_no = str(patch.asset_no, 60)
  if (patch.install_date !== undefined) clean.install_date = patch.install_date ? String(patch.install_date).slice(0, 10) : null
  if (patch.last_seen_at !== undefined) clean.last_seen_at = patch.last_seen_at ? new Date(patch.last_seen_at).toISOString() : null
  if (patch.status !== undefined) clean.status = DEVICE_STATUSES.includes(patch.status) ? patch.status : 'active'
  if (patch.site !== undefined) clean.site = str(patch.site, 200)
  if (patch.notes !== undefined) clean.notes = str(patch.notes, 4000)
  if (patch.country !== undefined) clean.country = patch.country ?? null
  return unwrap(await supabase.from('telematics_devices').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteDevice(id) {
  return unwrap(await supabase.from('telematics_devices').delete().eq('id', id))
}

/**
 * Real fleet size for the coverage % denominator: count of active fleet assets
 * (`vehicle_fleet`, org- and country-scoped via RLS + null-safe country filter).
 * Uses a head-only COUNT (no rows fetched). Returns `null` on any error so the
 * page shows an honest "N/A" coverage instead of guessing a denominator.
 */
export async function countFleetAssets({ country } = {}) {
  try {
    let q = supabase
      .from('vehicle_fleet')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
    q = applyCountry(q, country)
    const { count, error } = await q
    if (error) throw error
    return typeof count === 'number' ? count : null
  } catch {
    return null
  }
}
