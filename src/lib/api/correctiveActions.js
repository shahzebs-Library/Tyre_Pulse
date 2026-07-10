/**
 * Corrective Actions service - corrective_actions records. Explicit column
 * lists (no SELECT *); additive, mirrors assets.js / inspections.js. Many pages
 * read corrective_actions (RCA, KPIs, executive reports, gate-pass blockers),
 * so this is the single boundary for that table as pages migrate onto it.
 */
import { supabase, unwrap, fetchAllPages } from './_client'

// Least-privilege column set covering the CorrectiveActions page (list + detail
// + edit form). Omits organisation_id (RLS-managed) and the legacy `photos`
// column the page does not read.
const COLS =
  'id,title,priority,site,region,description,assigned_to,status,root_cause,asset_no,tyre_serial,created_by,closed_by,created_at,closed_at,due_date,country,photo_data'

/**
 * List corrective actions, newest first. Strict country scoping (exact match,
 * no NULL inclusion) to match the page's prior `.eq('country', ...)` behaviour.
 * @param {{country?:string}} [opts]
 */
export async function listCorrectiveActions({ country } = {}) {
  return unwrap(await fetchAllPages((from, to) => {
    let q = supabase.from('corrective_actions').select(COLS)
      .order('created_at', { ascending: false }).order('id').range(from, to)
    if (country && country !== 'All') q = q.eq('country', country)
    return q
  }))
}

/** Get one corrective action by id (or null if not found). */
export async function getCorrectiveAction(id) {
  return unwrap(await supabase.from('corrective_actions').select(COLS).eq('id', id).maybeSingle())
}

/** Create a corrective action; returns the inserted row. */
export async function createCorrectiveAction(values) {
  return unwrap(await supabase.from('corrective_actions').insert(values).select(COLS).single())
}

/** Update a corrective action by id. */
export async function updateCorrectiveAction(id, patch) {
  return unwrap(await supabase.from('corrective_actions').update(patch).eq('id', id))
}
