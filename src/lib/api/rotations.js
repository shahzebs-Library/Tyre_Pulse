/**
 * Rotations service — tyre rotation schedule (tyre_rotations) plus the
 * paginated tyre_records read the Rotation Compliance page runs to build its
 * analytics. Explicit column lists (no SELECT *), single boundary for the
 * tyre_rotations table as pages migrate off inline supabase.from(...) calls.
 *
 * Scoping mirrors the page exactly:
 *   - tyre_rotations  → null-safe country scoping (country OR NULL) via applyCountry
 *   - tyre_records    → STRICT country eq (matches the page's .eq('country', …))
 */
import { supabase, unwrap, applyCountry, fetchAllPages, ServiceError } from './_client'

// Least-privilege column set for the schedule table. Omits organisation_id
// (RLS-managed) and updated_at (write-only bookkeeping the page does not read).
const COLS =
  'id,asset_no,site,scheduled_date,priority,status,notes,current_km,country,created_at'

// Columns the analytics engine consumes from tyre_records. Kept local to this
// service (the page's read is a specialised ascending, fully-paged scan that
// does not match tyres.js listTyreRecords).
const RECORD_COLS =
  'id,asset_no,serial_number,serial_no,position,brand,size,tread_depth,cost_per_tyre,issue_date,km_at_fitment,km_at_removal,risk_level,site,country'

/**
 * List scheduled rotations, earliest first. Null-safe country scoping so
 * uncategorised rows are never silently dropped.
 * @param {{country?:string}} [opts]
 */
export async function listRotations({ country } = {}) {
  let q = supabase
    .from('tyre_rotations')
    .select(COLS)
    .order('scheduled_date', { ascending: true })
  q = applyCountry(q, country)
  return unwrap(await q)
}

/** Get one scheduled rotation by id (or null if not found). */
export async function getRotation(id) {
  return unwrap(await supabase.from('tyre_rotations').select(COLS).eq('id', id).maybeSingle())
}

/** Insert one or more schedule rows. Accepts an array; returns nothing. */
export async function createRotations(rows) {
  return unwrap(await supabase.from('tyre_rotations').insert(rows))
}

/** Update a scheduled rotation by id. */
export async function updateRotation(id, patch) {
  return unwrap(await supabase.from('tyre_rotations').update(patch).eq('id', id))
}

/** Delete a scheduled rotation by id. */
export async function deleteRotation(id) {
  return unwrap(await supabase.from('tyre_rotations').delete().eq('id', id))
}

/**
 * Fully-paged tyre_records read for rotation analytics: ascending by issue_date
 * with STRICT country scoping (exact match, no NULL inclusion) to match the
 * page's prior .eq('country', …) behaviour. Returns the complete dataset.
 * @param {{country?:string}} [opts]
 * @returns {Promise<Array>} all matching records
 */
export async function listRotationRecords({ country } = {}) {
  const { data, error } = await fetchAllPages((from, to) => {
    let query = supabase
      .from('tyre_records')
      .select(RECORD_COLS)
      .order('issue_date', { ascending: true })
    if (country && country !== 'All') {
      query = query.eq('country', country)
    }
    return query.range(from, to)
  })
  if (error) throw new ServiceError(error.message, error.code, error)
  return data || []
}
