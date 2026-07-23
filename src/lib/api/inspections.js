/**
 * Inspections service - inspection records (inspections). Explicit column lists
 * (no SELECT *); null-safe country scoping. Additive only - mirrors
 * assets.js / tyres.js.
 */
import { supabase, unwrap, applyCountry } from './_client'

const COLS =
  'id,title,inspection_type,site,asset_no,tyre_serial,status,findings,severity,inspection_date,scheduled_date,completed_date,inspector,notes,country,created_by,created_at'

/**
 * Wider column set for the Inspections page (list grid, detail/approval modals,
 * checklist workflow, PDF export). Superset of COLS plus the page-specific
 * fields the UI renders. Omits organisation_id (RLS-managed). Kept separate from
 * the narrow COLS so existing consumers of the narrow functions are unaffected.
 */
const PAGE_COLS =
  'id,title,inspection_type,site,asset_no,tyre_serial,region,status,findings,severity,inspection_date,scheduled_date,completed_date,inspector,notes,country,created_by,created_at,attendees,vehicle_type,tyre_conditions,odometer_km,hour_meter,photo_data,inspector_signature,linked_action_id,approval_status,approver_email,approver_signature,approved_at,approved_by,pressure_reading,locked,locked_at,custom_data'

/**
 * List inspections, newest first. Country-scoped (null-safe) and optionally
 * filtered by status / severity / site / inspection type.
 * @param {{country?:string, status?:string, severity?:string, site?:string, type?:string, limit?:number}} [opts]
 */
export async function listInspections({ country, status, severity, site, type, limit = 100 } = {}) {
  let q = supabase
    .from('inspections')
    .select(COLS)
    .order('created_at', { ascending: false })
    .limit(limit)
  q = applyCountry(q, country)
  if (status) q = q.eq('status', status)
  if (severity) q = q.eq('severity', severity)
  if (site) q = q.eq('site', site)
  if (type) q = q.eq('inspection_type', type)
  return unwrap(await q)
}

/** Get one inspection by id (or null if not found). */
export async function getInspection(id) {
  return unwrap(await supabase.from('inspections').select(COLS).eq('id', id).maybeSingle())
}

/** Create an inspection; returns the inserted row. */
export async function createInspection(values) {
  return unwrap(await supabase.from('inspections').insert(values).select(COLS).single())
}

/** Update an inspection by id; returns the updated row. */
export async function updateInspection(id, patch) {
  return unwrap(
    await supabase.from('inspections').update(patch).eq('id', id).select(COLS).single(),
  )
}

// ── Inspections page (wide-column) boundary ──────────────────────────────────
// The functions below back the heavy Inspections page. They use PAGE_COLS and
// replicate the page's exact scoping / ordering / paging so behaviour is
// identical to the prior inline `supabase.from('inspections')` calls.

/**
 * One page (range) of inspections for the list grid, newest-scheduled first.
 * Mirrors the page's `fetchAllPages` callback exactly: order by scheduled_date
 * desc, range(from, to), optional strict country eq (only when a real country
 * is active) and optional created_by eq (Tyre Man scoping).
 *
 * Returns the raw Supabase `{ data, error }` result (does NOT throw / unwrap) so
 * it remains a drop-in for `fetchAllPages`, whose contract reads `{ data, error }`
 * per page and returns partial data on error. Callers that page the full list
 * pass this straight to `fetchAllPages`.
 *
 * @param {{from:number, to:number, country?:string, createdBy?:string}} opts
 * @returns {Promise<{data:any[]|null, error:any}>}
 */
export function listInspectionsForPage({ from, to, country, createdBy } = {}) {
  let q = supabase
    .from('inspections')
    .select(PAGE_COLS)
    .order('scheduled_date', { ascending: false })
    .range(from, to)
  if (country && country !== 'All') q = q.eq('country', country)
  if (createdBy) q = q.eq('created_by', createdBy)
  return q
}

/** Get one inspection by id for the page (approval landing / detail). */
export async function getInspectionForPage(id) {
  return unwrap(await supabase.from('inspections').select(PAGE_COLS).eq('id', id).single())
}

/**
 * Patch an inspection by id, fire-and-check-error style (no returning select).
 * The page checks only the thrown error; it never reads a returned row here.
 */
export async function patchInspection(id, patch) {
  return unwrap(await supabase.from('inspections').update(patch).eq('id', id))
}

/** Insert an inspection (no returning row). */
export async function insertInspection(values) {
  return unwrap(await supabase.from('inspections').insert(values))
}

/** Insert an inspection and return the inserted row (full row via select()). */
export async function insertInspectionReturning(values) {
  return unwrap(await supabase.from('inspections').insert(values).select().single())
}

/** Delete an inspection by id. */
export async function deleteInspection(id) {
  return unwrap(await supabase.from('inspections').delete().eq('id', id))
}

// ── vehicle_fleet lookups used by the Inspections page ───────────────────────
// Narrow reads against vehicle_fleet that the page needs for its checklist
// master data and asset lookup. Kept here (not in assets.js) as the page's own
// least-privilege boundary; other consumers are unaffected.

const VEHICLE_COLS = 'site,asset_no,vehicle_type'

/** All fleet vehicles (site/asset_no/vehicle_type) for checklist master data. */
export async function listInspectionVehicles() {
  return unwrap(await supabase.from('vehicle_fleet').select(VEHICLE_COLS))
}

/** Look up a single fleet vehicle by asset number (or null if not found). The same
 * asset number can exist per country (V348), so limit(1) keeps this single-row-safe
 * for a super-admin; RLS scopes a country-restricted user to their own row. */
export async function findVehicleByAsset(assetNo, country) {
  let q = supabase.from('vehicle_fleet').select('vehicle_type,asset_no,site,country').eq('asset_no', assetNo)
  if (country && country !== 'All') q = q.eq('country', country)
  const rows = unwrap(await q.order('country', { ascending: true }).limit(1))
  return Array.isArray(rows) ? rows[0] || null : rows || null
}
