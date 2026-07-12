/**
 * Batteries service (V146) — vehicle/asset battery lifecycle: install date,
 * warranty term, health %, live voltage, and a status lifecycle. RLS enforces
 * org isolation; any authenticated member may read and maintain records. This
 * layer keeps an explicit column list (least-privilege select) and null-safe
 * country scoping, mirroring certifications.js / support.js.
 *
 * When the table has not been migrated yet, listers degrade to [] so the page
 * can surface an "apply MIGRATIONS_V146_BATTERIES.sql" hint instead of throwing.
 */
import { supabase, unwrap, applyCountry } from './_client'

const COLS =
  'id,organisation_id,country,serial_no,asset_no,brand,install_date,warranty_months,' +
  'health_pct,voltage,status,site,notes,created_by,created_at,updated_at'

export const BATTERY_STATUS_VALUES = ['healthy', 'weak', 'replace', 'retired']

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
 * List batteries (newest first). Optional country / status filters. Returns []
 * when the table is missing so the UI can prompt for the migration rather than
 * error.
 */
export async function listBatteries({ country, status, limit = 500 } = {}) {
  try {
    let q = supabase.from('batteries').select(COLS)
    if (status) q = q.eq('status', status)
    q = applyCountry(q, country)
    return unwrap(await q.order('created_at', { ascending: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getBattery(id) {
  return unwrap(await supabase.from('batteries').select(COLS).eq('id', id).maybeSingle())
}

/** Create a battery. Requires at least an asset_no or a serial_no. */
export async function createBattery(values = {}) {
  const assetNo = String(values.asset_no || '').trim()
  const serialNo = String(values.serial_no || '').trim()
  if (!assetNo && !serialNo) throw new Error('An asset number or serial number is required.')
  const status = BATTERY_STATUS_VALUES.includes(values.status) ? values.status : 'healthy'
  const payload = {
    serial_no: serialNo ? serialNo.slice(0, 120) : null,
    asset_no: assetNo ? assetNo.slice(0, 120) : null,
    brand: values.brand ? String(values.brand).slice(0, 120) : null,
    install_date: values.install_date || null,
    warranty_months: num(values.warranty_months),
    health_pct: num(values.health_pct),
    voltage: num(values.voltage),
    status,
    site: values.site ? String(values.site).slice(0, 120) : null,
    notes: values.notes ? String(values.notes).slice(0, 4000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('batteries').insert(payload).select(COLS).single())
}

/** Patch a battery. Immutable columns are stripped before update. */
export async function updateBattery(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id
  delete clean.created_at
  delete clean.created_by
  delete clean.organisation_id
  delete clean.updated_at
  if (clean.status != null && !BATTERY_STATUS_VALUES.includes(clean.status)) delete clean.status
  if (clean.warranty_months != null) clean.warranty_months = num(clean.warranty_months)
  if (clean.health_pct != null) clean.health_pct = num(clean.health_pct)
  if (clean.voltage != null) clean.voltage = num(clean.voltage)
  if (clean.asset_no != null) clean.asset_no = String(clean.asset_no).trim().slice(0, 120) || null
  if (clean.serial_no != null) clean.serial_no = String(clean.serial_no).trim().slice(0, 120) || null
  return unwrap(await supabase.from('batteries').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteBattery(id) {
  return unwrap(await supabase.from('batteries').delete().eq('id', id))
}
