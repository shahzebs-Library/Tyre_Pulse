/**
 * Speed Limiters service (V153) — per-asset speed-limiter configuration: the
 * governed limit (km/h), the fitted limiter/telematics device, a status
 * lifecycle (active → disabled → fault), and the last verification date. RLS
 * enforces org isolation (read for any authenticated member; writes gated to
 * Admin/Manager/Director). This layer keeps an explicit column list
 * (least-privilege select) and null-safe country scoping, mirroring
 * batteries.js / support.js.
 *
 * When the table has not been migrated yet, the lister degrades to [] so the
 * page can surface an "apply MIGRATIONS_V153_SPEED_LIMITERS.sql" hint instead
 * of throwing.
 */
import { supabase, unwrap, applyCountry } from './_client'

export const COLS =
  'id,organisation_id,country,asset_no,limit_kph,device_id,last_verified_at,' +
  'status,site,notes,created_by,created_at,updated_at'

export const SPEED_LIMITER_STATUS_VALUES = ['active', 'disabled', 'fault']

/** True when a Supabase error means the table/relation is not deployed yet. */
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return (
    m.includes('does not exist') ||
    m.includes('relation') ||
    m.includes('schema cache') ||
    m.includes('could not find the table')
  )
}

/** Coerce a value to a finite number, or null. */
function num(value) {
  if (value === '' || value == null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * List speed limiters (newest first). Optional country / status filters. Returns
 * [] when the table is missing so the UI can prompt for the migration rather
 * than error.
 * @param {{ country?:string, status?:string, limit?:number }} [opts]
 */
export async function listSpeedLimiters({ country, status, limit = 500 } = {}) {
  try {
    let q = supabase.from('speed_limiters').select(COLS)
    if (status) q = q.eq('status', status)
    q = applyCountry(q, country)
    return unwrap(await q.order('created_at', { ascending: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getSpeedLimiter(id) {
  return unwrap(await supabase.from('speed_limiters').select(COLS).eq('id', id).maybeSingle())
}

/** Create a speed limiter. Requires an asset number. */
export async function createSpeedLimiter(values = {}) {
  const assetNo = String(values.asset_no || '').trim()
  if (!assetNo) throw new Error('An asset number is required.')
  const status = SPEED_LIMITER_STATUS_VALUES.includes(values.status) ? values.status : 'active'
  const payload = {
    asset_no: assetNo.slice(0, 120),
    limit_kph: num(values.limit_kph),
    device_id: values.device_id ? String(values.device_id).slice(0, 120) : null,
    last_verified_at: values.last_verified_at || null,
    status,
    site: values.site ? String(values.site).slice(0, 120) : null,
    notes: values.notes ? String(values.notes).slice(0, 4000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('speed_limiters').insert(payload).select(COLS).single())
}

/** Patch a speed limiter. Immutable columns are stripped before the update. */
export async function updateSpeedLimiter(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id; delete clean.created_at; delete clean.organisation_id; delete clean.created_by
  if ('limit_kph' in clean) clean.limit_kph = num(clean.limit_kph)
  if ('asset_no' in clean) {
    const assetNo = String(clean.asset_no || '').trim()
    if (!assetNo) throw new Error('An asset number is required.')
    clean.asset_no = assetNo.slice(0, 120)
  }
  if ('status' in clean && !SPEED_LIMITER_STATUS_VALUES.includes(clean.status)) delete clean.status
  if ('device_id' in clean) clean.device_id = clean.device_id ? String(clean.device_id).slice(0, 120) : null
  if ('site' in clean) clean.site = clean.site ? String(clean.site).slice(0, 120) : null
  if ('notes' in clean) clean.notes = clean.notes ? String(clean.notes).slice(0, 4000) : null
  if ('last_verified_at' in clean) clean.last_verified_at = clean.last_verified_at || null
  return unwrap(await supabase.from('speed_limiters').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteSpeedLimiter(id) {
  return unwrap(await supabase.from('speed_limiters').delete().eq('id', id))
}

/**
 * Lean fleet projection (asset_no + site + is_active) used ONLY to compute
 * speed-limiter coverage vs the fleet on the registry page. Country-scoped and
 * null-safe. Degrades to [] when vehicle_fleet is unavailable so the page can
 * fall back to a limiter-only view (honest: coverage ratios become null when
 * there is no fleet denominator). Capped high enough to cover a full fleet.
 * @param {{ country?:string, limit?:number }} [opts]
 */
export async function listFleetForCoverage({ country, limit = 5000 } = {}) {
  try {
    let q = supabase.from('vehicle_fleet').select('asset_no,site,is_active')
    q = applyCountry(q, country)
    const rows = unwrap(await q.limit(limit)) || []
    // Governed-fleet denominator = assets that are still in service. Rows with a
    // null is_active are treated as active (legacy data), never dropped silently.
    return rows.filter((r) => r && r.is_active !== false)
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}
