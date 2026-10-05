/**
 * Tyre Scrap Management page reads/writes - the exact inline Supabase queries
 * the scrap analysis screen consumes (removed/scrapped tyre corpus, shared
 * disposal statuses, mark-as-disposed upsert).
 *
 * Read-only pass-throughs return the raw Supabase query builder (thenable) the
 * page reads via `.data` / `.error` (corpus through `fetchAllPages`, disposals
 * through `.then`). Explicit column list on the corpus (no SELECT *). Country
 * filtering stays client-side in the page (unchanged). Additive only.
 */
import { supabase, isMissingColumn, toServiceError } from './_client'

/** Shared disposal statuses (tyre_record_id -> status source rows). */
export function listTyreDisposals() {
  return supabase.from('tyre_disposals').select('tyre_record_id,status')
}

/** Tyre records for scrap analysis, paged range (drives `fetchAllPages`). */
export function listScrapTyreRecords({ from, to } = {}) {
  return supabase
    .from('tyre_records')
    .select(
      // serial_number is a dead legacy column (0 of 7,504 rows populated): serve
      // the canonical serial_no under the name the disposal log reads.
      'id, asset_no, serial_number:serial_no, brand, size, position, site, country, ' +
      'risk_level, tread_depth, cost_per_tyre, km_at_fitment, km_at_removal, ' +
      'issue_date, removal_date, qty, category, removal_reason'
    )
    // Paged by fetchAllPages (concurrent windows): a unique order is required or
    // rows drop/repeat at page boundaries.
    .order('id', { ascending: true })
    .range(from, to)
}

/**
 * Upsert a disposal status for a tyre record (shared across the team). Conflict
 * target matches the page's prior inline upsert. Pass-through (page reads `.error`).
 */
export function upsertTyreDisposal(tyreRecordId, status) {
  return supabase
    .from('tyre_disposals')
    .upsert({ tyre_record_id: tyreRecordId, status }, { onConflict: 'tyre_record_id' })
}

const DISPOSAL_FULL_COLS = 'tyre_record_id,status,disposal_vendor,collection_due,recovery_value,currency,notes,updated_at'

/**
 * Disposal rows with the governance columns (20261005100000). Before that
 * migration is applied the extra columns do not exist; the read then falls back
 * to the original two columns and reports `governanceReady: false`, so the page
 * can say "not set up yet" instead of failing.
 * Resolves { rows, governanceReady }. Throws on any other error.
 */
export async function listTyreDisposalsFull() {
  const full = await supabase.from('tyre_disposals').select(DISPOSAL_FULL_COLS)
  if (!full.error) return { rows: full.data || [], governanceReady: true }
  if (!isMissingColumn(full.error)) throw toServiceError(full.error, 'Disposal statuses could not be loaded.')
  const base = await supabase.from('tyre_disposals').select('tyre_record_id,status')
  if (base.error) throw toServiceError(base.error, 'Disposal statuses could not be loaded.')
  return { rows: base.data || [], governanceReady: false }
}

/**
 * Save a disposal status with optional governance details. Detail keys are only
 * sent when the governance columns exist, so a pre-migration save still works.
 */
export async function saveTyreDisposal(tyreRecordId, { status, disposal_vendor, collection_due, recovery_value, currency, notes } = {}, { governanceReady = false } = {}) {
  if (!tyreRecordId) throw new Error('This tyre has no record to attach a disposal status to.')
  const payload = { tyre_record_id: tyreRecordId, status: status || 'Pending' }
  if (governanceReady) {
    const n = recovery_value === '' || recovery_value == null ? null : Number(recovery_value)
    Object.assign(payload, {
      disposal_vendor: disposal_vendor ? String(disposal_vendor).trim().slice(0, 160) : null,
      collection_due: collection_due || null,
      recovery_value: Number.isFinite(n) && n >= 0 ? n : null,
      currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
      notes: notes ? String(notes).trim().slice(0, 1000) : null,
    })
  }
  const { error } = await supabase.from('tyre_disposals').upsert(payload, { onConflict: 'tyre_record_id' })
  if (error) throw toServiceError(error, 'Could not save the disposal status.')
  return payload
}
