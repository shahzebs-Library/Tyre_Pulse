/**
 * Upload / data-intake reads/writes - the exact queries the UploadData page
 * consumes (column-mapping memory, field synonyms, duplicate detection, staged
 * approvals, and the final tyre/stock inserts + audit trails).
 *
 * Pass-through style: reads return the raw Supabase query builder (the page
 * reads `.data` / `.error` directly, sometimes via `.then(...)`); writes return
 * the raw result so the page can inspect `.error` and, for inserts, `.data`.
 * Explicit column lists where selected. Additive only - mirrors dailyOps.js /
 * analyticsReads.js pass-through conventions.
 */
import { supabase } from './_client'

// ── Mapping memory + synonyms ─────────────────────────────────────────────────

/** Permanent field synonyms for tyre_records (custom header → canonical field). */
export function listFieldSynonyms() {
  return supabase
    .from('field_synonyms')
    .select('custom_name, maps_to')
    .eq('table_target', 'tyre_records')
}

/** Recall a saved column mapping by header fingerprint (or null). */
export function getColumnMapping(fingerprint) {
  return supabase
    .from('column_mappings')
    .select('id, mapping')
    .eq('fingerprint', fingerprint)
    .maybeSingle()
}

/** Update an existing saved column mapping by id. */
export function updateColumnMapping(id, patch) {
  return supabase.from('column_mappings').update(patch).eq('id', id)
}

/** Upsert a saved column mapping keyed on fingerprint. */
export function upsertColumnMapping(values) {
  return supabase.from('column_mappings').upsert(values, { onConflict: 'fingerprint' })
}

/** Bump a used field synonym (use_count / last_used_at) for tyre_records. */
export function updateFieldSynonym(customName, patch) {
  return supabase
    .from('field_synonyms')
    .update(patch)
    .eq('custom_name', customName)
    .eq('table_target', 'tyre_records')
}

// ── Duplicate detection ───────────────────────────────────────────────────────

/** Existing tyre records matching any of the given serials (one batch). */
export function listExistingSerials(serials) {
  return supabase
    .from('tyre_records')
    .select('serial_no, asset_no, issue_date, id')
    .in('serial_no', serials)
}

// ── AI refinement ─────────────────────────────────────────────────────────────

/** Invoke the secure chat-ai edge function (server-side Anthropic key). */
export function invokeChatAI(body) {
  return supabase.functions.invoke('chat-ai', { body })
}

// ── Writes: staging, inserts, audit ───────────────────────────────────────────

/** Stage a non-admin upload batch for admin approval. */
export function insertPendingUpload(values) {
  return supabase.from('pending_uploads').insert(values)
}

/** Insert stock records (single row or bulk array). */
export function insertStockRecords(rows) {
  return supabase.from('stock_records').insert(rows)
}

/** Insert tyre records (single row or bulk array), returning inserted ids. */
export function insertTyreRecords(rows) {
  return supabase.from('tyre_records').insert(rows).select('id')
}

/** Insert cleaning_log audit entries for auto-classified rows. */
export function insertCleaningLog(entries) {
  return supabase.from('cleaning_log').insert(entries)
}

/** Record an upload_history audit row. */
export function insertUploadHistory(values) {
  return supabase.from('upload_history').insert(values)
}
