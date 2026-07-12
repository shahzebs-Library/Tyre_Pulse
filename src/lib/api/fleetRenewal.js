/**
 * Fleet Renewal service — reads/writes the `fleet_renewal_plans` table backing
 * the Fleet Renewal Planning module (/fleet-renewal). Single boundary for that
 * table: explicit least-privilege column list (no SELECT *), null-safe country
 * scoping, and consistent ServiceError handling via unwrap. Mirrors the
 * retreadClaims.js / support.js style.
 *
 * The list method tolerates a not-yet-migrated database: if the table is missing
 * it resolves to [] so the page can prompt the operator to apply
 * MIGRATIONS_V159_FLEET_RENEWAL.sql instead of crashing.
 */
import { supabase, unwrap, applyCountry } from './_client'

export const COLS =
  'id,organisation_id,country,asset_no,current_km,age_years,recommendation,' +
  'target_replace_date,est_cost,priority,status,site,notes,' +
  'created_by,created_at,updated_at'

export const RENEWAL_STATUSES = ['planned', 'approved', 'deferred', 'completed']
export const RENEWAL_PRIORITIES = ['low', 'medium', 'high']

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return (
    m.includes('does not exist') ||
    m.includes('could not find the table') ||
    m.includes('schema cache') ||
    (m.includes('relation') && m.includes('fleet_renewal_plans'))
  )
}

const toNumberOrNull = (v) => {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

const emptyToNull = (v) => {
  const s = v == null ? '' : String(v).trim()
  return s ? s : null
}

/**
 * List renewal plans (newest first). Optional status + null-safe country
 * filters. Returns [] when the backing table has not been migrated yet.
 * @param {{ country?:string, status?:string, limit?:number }} [opts]
 */
export async function listRenewalPlans({ country, status, limit = 500 } = {}) {
  try {
    let q = supabase.from('fleet_renewal_plans').select(COLS)
    if (status) q = q.eq('status', status)
    q = applyCountry(q, country)
    return unwrap(await q.order('created_at', { ascending: false }).limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Get one renewal plan by id (or null if not found). */
export async function getRenewalPlan(id) {
  return unwrap(await supabase.from('fleet_renewal_plans').select(COLS).eq('id', id).maybeSingle())
}

/**
 * Create a renewal plan. Requires an asset_no so every plan is attributable to a
 * specific fleet asset. Coerces numerics and normalises empty strings to NULL.
 */
export async function createRenewalPlan(values = {}) {
  const asset_no = emptyToNull(values.asset_no)
  if (!asset_no) throw new Error('An asset number is required.')
  const priority = RENEWAL_PRIORITIES.includes(values.priority) ? values.priority : 'medium'
  const status = RENEWAL_STATUSES.includes(values.status) ? values.status : 'planned'
  const payload = {
    country: emptyToNull(values.country),
    asset_no: asset_no.slice(0, 120),
    current_km: toNumberOrNull(values.current_km),
    age_years: toNumberOrNull(values.age_years),
    recommendation: values.recommendation ? String(values.recommendation).slice(0, 8000) : null,
    target_replace_date: emptyToNull(values.target_replace_date),
    est_cost: toNumberOrNull(values.est_cost),
    priority,
    status,
    site: emptyToNull(values.site),
    notes: values.notes ? String(values.notes).slice(0, 8000) : null,
  }
  return unwrap(await supabase.from('fleet_renewal_plans').insert(payload).select(COLS).single())
}

/** Patch a renewal plan by id. Strips immutable/managed columns; coerces types. */
export async function updateRenewalPlan(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id
  delete clean.organisation_id
  delete clean.created_by
  delete clean.created_at
  delete clean.updated_at
  if ('current_km' in clean) clean.current_km = toNumberOrNull(clean.current_km)
  if ('age_years' in clean) clean.age_years = toNumberOrNull(clean.age_years)
  if ('est_cost' in clean) clean.est_cost = toNumberOrNull(clean.est_cost)
  if ('target_replace_date' in clean) clean.target_replace_date = emptyToNull(clean.target_replace_date)
  if ('asset_no' in clean) clean.asset_no = emptyToNull(clean.asset_no)
  if ('site' in clean) clean.site = emptyToNull(clean.site)
  if (clean.priority && !RENEWAL_PRIORITIES.includes(clean.priority)) delete clean.priority
  if (clean.status && !RENEWAL_STATUSES.includes(clean.status)) delete clean.status
  return unwrap(await supabase.from('fleet_renewal_plans').update(clean).eq('id', id).select(COLS).single())
}

/** Delete a renewal plan by id. */
export async function deleteRenewalPlan(id) {
  return unwrap(await supabase.from('fleet_renewal_plans').delete().eq('id', id))
}
