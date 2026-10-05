/**
 * Retread jobs service (supabase/migrations/20261005101000_retread_jobs.sql).
 *
 * One row per casing sent, or proposed, for retreading. Until the migration is
 * applied the table does not exist: listRetreadJobs then resolves
 * `{ rows: [], missing: true }` so the page can say the register is not set up
 * yet, rather than reading as "no retreads" (the Contracts pattern: one query,
 * no extra probe). Any other failure throws a sanitised ServiceError.
 */
import { supabase, fetchAllPages, applyCountry, isMissingRelation, isNotProvisioned, toServiceError } from './_client'

const COLS =
  'id,country,site,casing_serial,tyre_record_id,brand,size,last_asset_no,first_life_km,vendor_name,grade,' +
  'cycle,status,inspected_at,sent_at,returned_at,cost,currency,outcome,life_km,warranty_months,notes,' +
  'created_at,updated_at'

export const RETREAD_JOB_STATUS_VALUES = ['eligible', 'at_vendor', 'qa', 'returned', 'rejected', 'cancelled']
export const RETREAD_JOB_OUTCOMES = ['pending', 'pass', 'fail']
export const RETREAD_GRADES = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C', 'Reject']

const MAX_ROWS = 5000

function num(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const text = (v, max) => {
  const s = v == null ? '' : String(v).trim()
  return s ? s.slice(0, max) : null
}

/** Build a clean payload from form values. Throws on the one required field. */
export function retreadJobPayload(values = {}) {
  const serial = text(values.casing_serial, 80)
  if (!serial) throw new Error('Enter the casing serial number.')
  const status = RETREAD_JOB_STATUS_VALUES.includes(values.status) ? values.status : 'eligible'
  const outcome = RETREAD_JOB_OUTCOMES.includes(values.outcome) ? values.outcome : 'pending'
  const cycle = Math.min(6, Math.max(1, Math.round(num(values.cycle) ?? 1)))
  const sent = values.sent_at || null
  const returned = values.returned_at || null
  if (sent && returned && returned < sent) throw new Error('The return date cannot be before the date it was sent.')
  const cost = num(values.cost)
  if (cost != null && cost < 0) throw new Error('Cost cannot be negative.')
  const currency = values.currency && /^[A-Z]{3}$/.test(values.currency) ? values.currency : null
  if (cost != null && !currency) throw new Error('Pick a country so the cost is stored in its own currency.')
  return {
    casing_serial: serial.toUpperCase(),
    country: text(values.country, 40),
    site: text(values.site, 80),
    tyre_record_id: values.tyre_record_id || null,
    brand: text(values.brand, 80),
    size: text(values.size, 40),
    last_asset_no: text(values.last_asset_no, 60),
    first_life_km: num(values.first_life_km),
    vendor_name: text(values.vendor_name, 160),
    grade: RETREAD_GRADES.includes(values.grade) ? values.grade : null,
    cycle,
    status,
    inspected_at: values.inspected_at || null,
    sent_at: sent,
    returned_at: returned,
    cost,
    currency,
    outcome,
    life_km: num(values.life_km),
    warranty_months: num(values.warranty_months),
    notes: text(values.notes, 1000),
  }
}

/**
 * Every retread job visible to the user, newest first. Null-safe country
 * scoping, id tiebreak so paging never drops a row.
 * Resolves { rows, missing, truncated }.
 */
export async function listRetreadJobs({ country } = {}) {
  const { data, error, truncated } = await fetchAllPages(
    (from, to) => applyCountry(supabase.from('retread_jobs').select(COLS), country)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
    { max: MAX_ROWS },
  )
  if (error) {
    if (isNotProvisioned(error) || isMissingRelation(error)) return { rows: [], missing: true, truncated: false }
    throw toServiceError(error, 'Could not load the retread register.')
  }
  return { rows: data || [], missing: false, truncated: !!truncated }
}

export async function createRetreadJob(values) {
  const { data, error } = await supabase.from('retread_jobs').insert(retreadJobPayload(values)).select(COLS).single()
  if (error) throw toServiceError(error, 'Could not save the retread.')
  return data
}

export async function updateRetreadJob(id, values) {
  if (!id) throw new Error('Missing retread id.')
  const { data, error } = await supabase.from('retread_jobs').update(retreadJobPayload(values)).eq('id', id).select(COLS).single()
  if (error) throw toServiceError(error, 'Could not update the retread.')
  return data
}

/** Partial status change (approve return, reject) without resending the form. */
export async function setRetreadJobStatus(id, patch = {}) {
  if (!id) throw new Error('Missing retread id.')
  const clean = {}
  if (patch.status && RETREAD_JOB_STATUS_VALUES.includes(patch.status)) clean.status = patch.status
  if (patch.outcome && RETREAD_JOB_OUTCOMES.includes(patch.outcome)) clean.outcome = patch.outcome
  if ('returned_at' in patch) clean.returned_at = patch.returned_at || null
  const { data, error } = await supabase.from('retread_jobs').update(clean).eq('id', id).select(COLS).single()
  if (error) throw toServiceError(error, 'Could not update the retread.')
  return data
}

export async function deleteRetreadJob(id) {
  const { error } = await supabase.from('retread_jobs').delete().eq('id', id)
  if (error) throw toServiceError(error, 'Could not delete the retread.')
}
