/**
 * Dispatch service — Load Planning (V142). Plans and tracks dispatch loads:
 * a load ties an asset + driver to an origin/destination, cargo, weight and a
 * scheduled window, then moves through a status lifecycle. RLS enforces org
 * isolation; this layer keeps explicit column lists and null-safe country
 * scoping, mirroring support.js / stock.js.
 */
import { supabase, unwrap, applyCountry } from './_client'

const COLS =
  'id,organisation_id,country,load_no,asset_no,driver_name,origin,destination,' +
  'cargo,weight_kg,scheduled_at,status,site,notes,created_by,created_at,updated_at'

export const LOAD_STATUSES = ['planned', 'dispatched', 'in_transit', 'delivered', 'cancelled']

/** A relation-missing error means the migration hasn't been applied yet. */
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return (
    m.includes('does not exist') ||
    m.includes('relation') ||
    m.includes('schema cache') ||
    m.includes('could not find the table')
  )
}

/**
 * List dispatch loads (newest scheduled first). Optional status/country
 * filters. Returns [] (not a throw) when the table is absent so the page can
 * show a "apply migration" hint instead of an error.
 */
export async function listLoads({ country, status, limit = 500 } = {}) {
  try {
    let q = supabase.from('dispatch_loads').select(COLS)
    if (status) q = q.eq('status', status)
    q = applyCountry(q, country)
    return unwrap(await q.order('scheduled_at', { ascending: false, nullsFirst: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

export async function getLoad(id) {
  return unwrap(await supabase.from('dispatch_loads').select(COLS).eq('id', id).maybeSingle())
}

/** Create a load. Requires at least an asset_no or a load_no to identify it. */
export async function createLoad(values = {}) {
  const asset_no = String(values.asset_no || '').trim()
  const load_no = String(values.load_no || '').trim()
  if (!asset_no && !load_no) {
    throw new Error('An asset number or a load number is required.')
  }
  const status = LOAD_STATUSES.includes(values.status) ? values.status : 'planned'
  const weight = values.weight_kg === '' || values.weight_kg == null ? null : Number(values.weight_kg)
  const payload = {
    load_no: load_no ? load_no.slice(0, 100) : null,
    asset_no: asset_no ? asset_no.slice(0, 100) : null,
    driver_name: values.driver_name ? String(values.driver_name).slice(0, 200) : null,
    origin: values.origin ? String(values.origin).slice(0, 300) : null,
    destination: values.destination ? String(values.destination).slice(0, 300) : null,
    cargo: values.cargo ? String(values.cargo).slice(0, 500) : null,
    weight_kg: Number.isFinite(weight) ? weight : null,
    scheduled_at: values.scheduled_at || null,
    status,
    site: values.site ? String(values.site).slice(0, 200) : null,
    notes: values.notes ? String(values.notes).slice(0, 4000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('dispatch_loads').insert(payload).select(COLS).single())
}

/** Patch a load. Immutable identity/audit columns are stripped defensively. */
export async function updateLoad(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id
  delete clean.created_at
  delete clean.organisation_id
  delete clean.created_by
  if (clean.status != null && !LOAD_STATUSES.includes(clean.status)) delete clean.status
  if (clean.weight_kg === '' ) clean.weight_kg = null
  if (clean.weight_kg != null) {
    const w = Number(clean.weight_kg)
    clean.weight_kg = Number.isFinite(w) ? w : null
  }
  return unwrap(await supabase.from('dispatch_loads').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteLoad(id) {
  return unwrap(await supabase.from('dispatch_loads').delete().eq('id', id))
}
