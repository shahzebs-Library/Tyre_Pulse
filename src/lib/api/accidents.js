/**
 * Accidents service - incident records (accidents). Explicit column lists
 * (no SELECT *); null-safe country scoping. Additive only - mirrors
 * assets.js / tyres.js.
 */
import { supabase, unwrap, applyCountry, fetchAllPages } from './_client'

const COLS =
  'id,asset_no,site,country,incident_date,severity,status,accident_type,claim_amount,claim_status,recovered_amount,recovery_status,repair_cost,estimated_damage_cost,driver_name,location,created_at'

// PAGE_COLS includes claim/insurer/police PII - this is the accident owner page;
// RLS governs access, not the column list. The least-privilege COLS above stay
// PII-free for analytics/safety consumers; these page-specific functions serve
// the accident-management owner screen, which legitimately renders every field.
// Omits organisation_id (RLS-managed).
const PAGE_COLS =
  'id,site,asset_no,vehicle_id,plate_number,vehicle_type,reported_by,reporter_name,incident_date,incident_time,location,accident_type,severity,description,injuries,injury_count,third_party_involved,police_report_no,damage_description,estimated_damage_cost,photos,status,notes,created_at,updated_at,reviewed_by,reviewed_at,responsible_party,liable_party,payer,driver_name,insurer,policy_no,claim_status,claim_amount,claim_approved_amount,deductible,parts_cost,closure_status,close_requested_by,close_requested_at,close_request_note,closure_approved_by,closure_approved_at,closure_rejected_reason,recovered_amount,recovery_date,recovery_source,recovery_status,recovery_reference,country,case_stage,damage_condition,current_status,action_to_be_taken,responsible_owner,required_action,status_update_date,status_update_note,expected_release_date,repair_cost,insurance_claim_no,inspector,damage_class,fault_status,najm_status,najm_fault,taqdeer_status,gcc_liability_ratio,repair_type,next_step,workshop_name,workshop_location,workshop_quotation,discount_pct,final_amount,amount_transfer,taqdeer_no,release_date'
  // V300+ unified workflow + structured fields (single lifecycle, VOR, routing, RCA, docs)
  + ',workflow_stage,reference_no,project,department,departments_involved,responsible_owner_id,latitude,longitude,vor,vor_since,documents,videos,root_cause,corrective_action,preventive_action,hse_investigation,target_date,closure_evidence,sla_due_at,approved_repair_amount,estimate_approved_by,estimate_approved_at'

/**
 * List accidents, newest first. Country-scoped (null-safe) and optionally
 * filtered by status / severity / site.
 * @param {{country?:string, status?:string, severity?:string, site?:string, limit?:number}} [opts]
 */
export async function listAccidents({ country, status, severity, site, limit = 100 } = {}) {
  let q = supabase
    .from('accidents')
    .select(COLS)
    .order('created_at', { ascending: false })
    .limit(limit)
  q = applyCountry(q, country)
  if (status) q = q.eq('status', status)
  if (severity) q = q.eq('severity', severity)
  if (site) q = q.eq('site', site)
  return unwrap(await q)
}

/** Get one accident by id (or null if not found). */
export async function getAccident(id) {
  return unwrap(await supabase.from('accidents').select(COLS).eq('id', id).maybeSingle())
}

/** Create an accident record; returns the inserted row. */
export async function createAccident(values) {
  return unwrap(await supabase.from('accidents').insert(values).select(COLS).single())
}

/** Update an accident record by id; returns the updated row. */
export async function updateAccident(id, patch) {
  return unwrap(
    await supabase.from('accidents').update(patch).eq('id', id).select(COLS).single(),
  )
}

// ── Accident-management owner page (renders full record incl. claim/insurer/police PII) ──

/**
 * Fetch ONE page of accidents for the owner screen, newest incident first,
 * scoped by strict country match (exact `.eq`, no NULL inclusion) to replicate
 * the page's prior behaviour. Returns the raw Supabase `{ data, error }` so it
 * drops directly into `fetchAllPages` for transparent multi-page fetching.
 * @param {{country?:string, from:number, to:number}} opts
 */
export function listAccidentsForPage({ country, from, to } = {}) {
  let q = supabase
    .from('accidents')
    .select(PAGE_COLS)
    .order('incident_date', { ascending: false })
    .range(from, to)
  if (country && country !== 'All') q = q.eq('country', country)
  return q
}

/**
 * Fetch ALL accidents for the owner screen across pages (past the PostgREST
 * 1000-row cap). Mirrors the page's `fetchAllPages` loop exactly.
 * @param {{country?:string, max?:number}} [opts]
 * @returns {Promise<{data:any[], error:any, truncated:boolean}>}
 */
export function listAllAccidentsForPage({ country, max = 100000 } = {}) {
  return fetchAllPages((from, to) => listAccidentsForPage({ country, from, to }), { max })
}

/**
 * Fleet vehicle picker source for the accident form's asset combobox.
 * Replicates the page's `fleet_master` read (select/order) exactly.
 */
export async function listAccidentFleet() {
  // Assets live in vehicle_fleet (the legacy fleet_master table is empty), so the
  // accident form's vehicle picker must read from there or it shows nothing.
  return unwrap(
    await supabase
      .from('vehicle_fleet')
      .select('asset_no, vehicle_type, site, country, registration_no, fleet_number')
      .order('asset_no'),
  )
}

/**
 * Pass-through insert for the owner page (single row or bulk array). The page
 * only checks for an error, so no `.select().single()` - that would reject a
 * bulk array insert. Returns the raw Supabase `{ data, error }`.
 * @param {object|object[]} values
 */
export function createAccidentForPage(values) {
  return supabase.from('accidents').insert(values)
}

/**
 * Pass-through update by id for the owner page. Returns the raw Supabase
 * `{ data, error }` (the page only checks the error).
 */
export function updateAccidentForPage(id, patch) {
  return supabase.from('accidents').update(patch).eq('id', id)
}

/**
 * Delete an accident by id. Returns the raw Supabase `{ data, error }`
 * (the page currently ignores the result, matching prior fire-and-forget).
 */
export function deleteAccident(id) {
  return supabase.from('accidents').delete().eq('id', id)
}
