/**
 * Workshop Status -> Vehicle intake service (RPC + RLS reads only).
 *
 * Writes go through the SECURITY DEFINER functions of
 * 20261128090000_workshop_intake.sql. Reads go through RLS (org, country,
 * site and the workshop view permission). The live list is POLLED with an
 * updated_at cursor (no realtime publication: realtime WAL decoding was the
 * largest database cost before).
 */
import { supabase, fetchAllPages, toServiceError } from './_client'
import { fetchDirectory, fetchDirectoryByIds, directoryName } from './profileDirectory'
import { batches, mergeIngestResults, assetKey, resolveIntakePermissions } from '../workshopStatus/intake'

// Own explicit list (the intake screen needs fewer columns than Active vehicles).
export const INTAKE_COLS = [
  'id', 'organisation_id', 'country', 'asset_no', 'vehicle_id', 'reg_no', 'job_card_ref', 'vehicle_category',
  'site', 'complaint', 'source_remarks', 'ooc_since', 'responsible_user_id', 'expected_release_date',
  'current_active', 'daily_report_status', 'first_seen_at', 'removed_at', 'final_disposition', 'deleted_at',
  'updated_at',
  'intake_source', 'confirm_status', 'submitted_by', 'submitted_by_name', 'submitted_at', 'client_entered_at',
  'confirmed_by', 'confirmed_by_name', 'confirmed_at', 'confirm_note', 'returned_reason', 'returned_at',
  'source_key', 'work_order_id', 'provisional_ref', 'routed_to', 'routed_at', 'work_type', 'priority',
  'production_out_at', 'link_suggestion', 'job_outcome', 'job_outcome_reason', 'job_outcome_by_name',
  'job_outcome_at', 'rescheduled_for',
].filter((c, i, a) => a.indexOf(c) === i).join(',')

const SUPERVISOR_ROLES = ['Workshop Supervisor', 'Maintenance Supervisor', 'Workshop Area Manager', 'Workshop Maintenance Area Manager']
const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '')
const countryOf = (c) => (blank(c) || c === 'All' ? null : String(c).trim())

/** The caller's intake flags (all false on any failure). */
export async function loadIntakePermissions() {
  const { data, error } = await supabase.rpc('workshop_status_my_permissions')
  if (error) return { permissions: resolveIntakePermissions(null), error: toServiceError(error, 'Could not load your access.') }
  return { permissions: resolveIntakePermissions(data), error: null }
}

/**
 * Active intake records (anything not from the daily Excel, plus any record
 * still waiting for a person). With `since` only rows changed after it.
 */
export async function listIntake({ country, since = null } = {}) {
  const c = countryOf(country)
  const { data, error, truncated } = await fetchAllPages((from, to) => {
    let q = supabase.from('workshop_status_records').select(INTAKE_COLS).is('deleted_at', null)
      .or('intake_source.neq.excel_upload,confirm_status.neq.confirmed')
    if (c) q = q.eq('country', c)
    if (since) q = q.gt('updated_at', since)
    else q = q.eq('current_active', true)
    return q.order('updated_at', { ascending: true }).order('id', { ascending: true }).range(from, to)
  }, { max: 5000 })
  if (error) throw toServiceError(error, 'Could not load the workshop intake list.')
  return { rows: data || [], truncated: Boolean(truncated) }
}

/** Fleet details for the asset codes typed in the sheet (auto-fill). */
export async function lookupFleet({ country, assets }) {
  const c = countryOf(country)
  const keys = [...new Set((assets || []).map(assetKey).filter(Boolean))]
  const map = new Map()
  if (!c || !keys.length) return map
  for (const part of batches(keys, 150)) {
    const { data, error } = await supabase.from('vehicle_fleet')
      .select('id,asset_no,registration_no,vehicle_type,make,site')
      .eq('country', c).in('asset_no', part)
    if (error) throw toServiceError(error, 'Could not look up the vehicles.')
    for (const f of data || []) map.set(assetKey(f.asset_no), f)
  }
  return map
}

/** Send sheet rows (in batches of 200). Unchanged rows are skipped by the server. */
export async function upsertIntakeRows({ country, source = 'manual', rows }) {
  const results = []
  for (const part of batches(rows || [])) {
    const { data, error } = await supabase.rpc('workshop_intake_upsert_rows', { p_country: country, p_source: source, p_rows: part })
    if (error) throw toServiceError(error, 'The vehicles could not be saved.')
    results.push(data)
  }
  return mergeIngestResults(results)
}

async function rpc(name, args, fallback) {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw toServiceError(error, fallback)
  return data
}

export const confirmIntake = (ids, note) => rpc('workshop_intake_confirm', { p_ids: ids, p_note: note || null }, 'The vehicles could not be confirmed.')
export const returnIntake = (id, reason) => rpc('workshop_intake_return', { p_id: id, p_reason: reason }, 'The vehicle could not be returned.')
export const setIntakeOutcome = (id, outcome, reason, rescheduledFor) =>
  rpc('workshop_intake_set_outcome', { p_id: id, p_outcome: outcome || null, p_reason: reason, p_rescheduled_for: rescheduledFor || null }, 'The outcome could not be saved.')
export const releaseIntake = (id, disposition, remarks) =>
  rpc('workshop_intake_release', { p_id: id, p_disposition: disposition, p_remarks: remarks }, 'The vehicle could not be released.')
export const setIntakeJobCard = (id, jobCard) => rpc('workshop_intake_set_job_card', { p_id: id, p_job_card: jobCard }, 'The job card could not be saved.')
export const saveRosterEntry = (row) => rpc('workshop_intake_roster_save', { p_row: row }, 'The roster could not be saved.')
export const registerIntakeSheet = ({ country, name, defaultSite }) =>
  rpc('workshop_intake_sheet_register', { p_country: country, p_name: name, p_default_site: defaultSite || null }, 'The sheet could not be registered.')

export async function listAnomalies({ country, days = 14 } = {}) {
  const data = await rpc('workshop_intake_anomalies', { p_country: countryOf(country), p_days: days }, 'The checks could not be loaded.')
  return data || []
}

/** Roster with names. */
export async function listRoster({ country } = {}) {
  const c = countryOf(country)
  let q = supabase.from('workshop_site_supervisors')
    .select('id,country,site,user_id,role,shift_name,shift_start,shift_end,active,valid_from,valid_to,updated_at')
    .eq('active', true)
  if (c) q = q.eq('country', c)
  const { data, error } = await q.order('site').order('shift_name').order('id')
  if (error) throw toServiceError(error, 'Could not load the supervisor roster.')
  const people = await fetchDirectoryByIds((data || []).map((r) => r.user_id)).catch(() => [])
  const names = new Map(people.map((p) => [p.id, directoryName(p)]))
  return (data || []).map((r) => ({ ...r, name: names.get(r.user_id) || null }))
}

/** People who can be put on the roster (supervisor roles). */
export async function listRosterCandidates() {
  const { rows } = await fetchDirectory({ roles: SUPERVISOR_ROLES, activeOnly: true, max: 2000 })
  return rows.map((r) => ({ id: r.id, name: directoryName(r) || r.id, role: r.role }))
}

export async function listIntakeSheets() {
  const { data, error } = await supabase.from('workshop_intake_sheets')
    .select('id,country,name,default_site,active,last_seen_at,last_row_count,last_result,created_at')
    .order('created_at', { ascending: false })
  if (error) throw toServiceError(error, 'Could not load the connected sheets.')
  return data || []
}
