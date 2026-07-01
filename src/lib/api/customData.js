/**
 * Custom Data service — field_synonyms (upload-mapping dictionary) plus the
 * extra_fields tooling behind the Custom Data Manager page. Single Supabase
 * boundary for that domain: least-privilege column lists (no SELECT *), the
 * extra-field stats RPC, synonym CRUD, and the tyre_records reads/writes used
 * by the backfill / export flows.
 *
 * The tyre_records helpers here are intentionally narrow (only the columns the
 * page touches) and do NOT overlap tyres.js — they exist solely for the
 * extra_fields backfill/export and a generic dynamic-column patch.
 */
import { supabase, unwrap, fetchAllPages } from './_client'

export { fetchAllPages }

// Least-privilege column set for field_synonyms (list + add form + table).
const SYNONYM_COLS =
  'id,custom_name,maps_to,table_target,description,created_by,use_count,last_used_at,created_at'

/**
 * Aggregate extra_fields usage stats via the get_extra_field_stats RPC.
 * Returns [{ field_key, record_count, sample_vals }] (or null/error passthrough
 * as the RPC provides). Country is passed straight through as p_country
 * (null = all countries), matching the page's prior behaviour.
 * @param {{country?: string|null}} [opts]
 */
export async function getExtraFieldStats({ country = null } = {}) {
  return unwrap(await supabase.rpc('get_extra_field_stats', { p_country: country }))
}

/**
 * List all field synonyms, most-used first. Mirrors the page's
 * `.select('*').order('use_count', { ascending: false })`.
 */
export async function listFieldSynonyms() {
  return unwrap(
    await supabase
      .from('field_synonyms')
      .select(SYNONYM_COLS)
      .order('use_count', { ascending: false })
  )
}

/** Create a field synonym; returns the inserted row. */
export async function createFieldSynonym(values) {
  return unwrap(await supabase.from('field_synonyms').insert(values).select(SYNONYM_COLS).single())
}

/** Delete a field synonym by id. */
export async function deleteFieldSynonym(id) {
  return unwrap(await supabase.from('field_synonyms').delete().eq('id', id))
}

// tyre_records columns read by the Browse Records tab.
const RECORD_BROWSE_COLS = 'id, asset_no, serial_no, issue_date, site, brand, extra_fields'
// tyre_records columns read by the export flow (adds country).
const RECORD_EXPORT_COLS = 'id, asset_no, serial_no, issue_date, site, brand, country, extra_fields'

/**
 * Paginated browse of tyre_records that carry custom data (non-empty
 * extra_fields), newest first, with optional country scope and extra-field
 * key/value filtering. Returns Supabase's `{ data, count }` for the caller's
 * exact-count pagination.
 *
 * @param {object} opts
 * @param {string} [opts.country]     active country ('All' or falsy = no scope)
 * @param {string} [opts.filterKey]   extra_fields key to filter on
 * @param {string} [opts.filterVal]   value the key must contain (with filterKey)
 * @param {number} opts.from          range start (inclusive)
 * @param {number} opts.to            range end (inclusive)
 */
export async function listRecordsWithExtraFields({ country, filterKey, filterVal, from, to } = {}) {
  let q = supabase
    .from('tyre_records')
    .select(RECORD_BROWSE_COLS, { count: 'exact' })
    .not('extra_fields', 'eq', '{}')
    .not('extra_fields', 'is', null)
    .order('issue_date', { ascending: false })
    .range(from, to)

  if (country && country !== 'All') q = q.eq('country', country)

  if (filterKey && filterVal) {
    q = q.contains('extra_fields', { [filterKey]: filterVal })
  } else if (filterKey) {
    q = q.not('extra_fields->>' + filterKey, 'is', null)
  }

  const { data, count } = await q
  return { data: data ?? [], count: count ?? 0 }
}

/**
 * Fetch ALL tyre_records where `fieldKey` exists in extra_fields but the
 * canonical `target` column is still null — the candidate set for a backfill.
 * Returns the raw fetchAllPages `{ data, error, truncated }` so the caller can
 * short-circuit on error exactly as before.
 * @param {{fieldKey: string, target: string}} opts
 */
export async function listTyreRecordsForBackfill({ fieldKey, target } = {}) {
  return fetchAllPages((from, to) => supabase
    .from('tyre_records')
    .select('id, extra_fields')
    .not('extra_fields->>' + fieldKey, 'is', null)
    .is(target, null)
    .range(from, to))
}

/**
 * Fetch ALL tyre_records that carry custom data, newest first, for export.
 * Returns the raw fetchAllPages `{ data, error, truncated }`.
 */
export async function listTyreRecordsForExport() {
  return fetchAllPages((from, to) => supabase
    .from('tyre_records')
    .select(RECORD_EXPORT_COLS)
    .not('extra_fields', 'eq', '{}')
    .not('extra_fields', 'is', null)
    .order('issue_date', { ascending: false })
    .range(from, to))
}

/**
 * Apply an arbitrary column patch to a tyre_record by id. The patch is passed
 * through untouched so callers can set a dynamically-computed column, e.g.
 * `updateTyreRecordFields(id, { [canonicalColumn]: value })`.
 * @param {string} id
 * @param {Record<string, any>} patch
 */
export async function updateTyreRecordFields(id, patch) {
  return unwrap(await supabase.from('tyre_records').update(patch).eq('id', id))
}
