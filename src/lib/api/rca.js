/**
 * RCA service - rca_records (Root Cause Analysis) records. Explicit column
 * lists (no SELECT *); additive, mirrors correctiveActions.js / inspections.js.
 * Single boundary for the rca_records table as pages migrate onto it.
 */
import { supabase, unwrap } from './_client'

// Least-privilege column set covering the RcaRecords page (list + detail +
// edit form + create-linked-action). Omits organisation_id (RLS-managed) and
// the legacy `photos` column the page does not read (it uses `photo_data`).
const COLS =
  'id,asset_no,tyre_serial,brand,site,region,failure_date,km_at_failure,hours_at_failure,root_cause,contributing_factors,ai_analysis,corrective_action_id,created_by,created_at,country,photo_data'

// List select embeds the linked corrective action (id,title,status) exactly as
// the page previously did with its inline joined select.
const LIST_SELECT = `${COLS}, corrective_action:corrective_action_id(id,title,status)`

/**
 * List RCA records, newest first, with the linked corrective action embedded.
 * Strict country scoping (exact match, no NULL inclusion) to match the page's
 * prior `.eq('country', ...)` behaviour.
 * @param {{country?:string}} [opts]
 */
export async function listRcaRecords({ country } = {}) {
  let q = supabase.from('rca_records').select(LIST_SELECT).order('created_at', { ascending: false })
  if (country && country !== 'All') q = q.eq('country', country)
  return unwrap(await q)
}

/** Get one RCA record by id (or null if not found). */
export async function getRcaRecord(id) {
  return unwrap(await supabase.from('rca_records').select(LIST_SELECT).eq('id', id).maybeSingle())
}

/** Create an RCA record; returns the inserted row. */
export async function createRcaRecord(values) {
  return unwrap(await supabase.from('rca_records').insert(values).select(COLS).single())
}

/** Update an RCA record by id. */
export async function updateRcaRecord(id, patch) {
  return unwrap(await supabase.from('rca_records').update(patch).eq('id', id))
}
