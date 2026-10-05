/**
 * Audit Trail overview reads for the /audit page: KPI head-counts, in-app
 * import batches, and the event review flags (audit_event_reviews, migration
 * 20261005140000). Every count is a head-only exact count; a failed count is
 * null, never 0. The review table degrades to `{ provisioned:false }` until the
 * migration is applied.
 */
import { supabase, ServiceError, isNotProvisioned } from './_client'
import { toUserMessage } from '../safeError'
import { SECURITY_ACTIONS, DATA_CHANGE_ACTIONS, DELETE_ACTIONS } from '../auditTrailView'

function bound(q, col, from, to) {
  let out = q
  if (from) out = out.gte(col, from)
  if (to) {
    const next = new Date(`${to}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    out = out.lt(col, next.toISOString())
  }
  return out
}

async function headCount(table, col, from, to, refine) {
  let q = supabase.from(table).select('id', { count: 'exact', head: true })
  q = bound(q, col, from, to)
  if (refine) q = refine(q)
  const { count, error } = await q
  if (error) return { value: null, error }
  return { value: count ?? null, error: null }
}

/**
 * Period counts for the KPI strip. Returns numbers or null per figure plus the
 * first error seen, so the page can show N/A with a reason per tile.
 */
export async function loadAuditCounts({ from, to } = {}) {
  const [events, security, changes, deletes, uploads, batches] = await Promise.all([
    headCount('audit_log_v2', 'created_at', from, to),
    headCount('audit_log_v2', 'created_at', from, to, (q) => q.in('action', [...SECURITY_ACTIONS])),
    headCount('audit_log_v2', 'created_at', from, to, (q) => q.in('action', [...DATA_CHANGE_ACTIONS])),
    headCount('audit_log_v2', 'created_at', from, to, (q) => q.in('action', [...DELETE_ACTIONS])),
    headCount('upload_history', 'uploaded_at', from, to),
    headCount('import_batches', 'created_at', from, to),
  ])
  const all = [events, security, changes, deletes, uploads, batches]
  const err = all.find((x) => x.error)?.error || null
  return {
    events: events.value,
    security: security.value,
    changes: changes.value,
    deletes: deletes.value,
    uploads: uploads.value,
    batches: batches.value,
    error: err ? toUserMessage(err, 'Some audit figures could not be read.') : null,
  }
}

const BATCH_COLS =
  'id,module,country,site,approval_status,import_status,total_rows,imported_rows,skipped_rows,error_rows,' +
  'duplicate_rows,conflict_rows,created_at,completed_at,file_id,import_files(original_filename,size_bytes)'

/** In-app import batches in the window, newest first (bounded to 200). */
export async function listImportBatches({ from, to, limit = 200 } = {}) {
  let q = supabase.from('import_batches').select(BATCH_COLS)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit)
  q = bound(q, 'created_at', from, to)
  const { data, error } = await q
  if (error) {
    if (isNotProvisioned(error)) return []
    throw new ServiceError(toUserMessage(error, 'Could not load import batches.'), error.code, error)
  }
  return Array.isArray(data) ? data : []
}

const REVIEW_COLS = 'id,audit_id,record_table,record_id,status,note,created_by,created_at,resolved_at'

/** Open review flags count plus the flags for the given audit ids. */
export async function loadReviews({ auditIds = [] } = {}) {
  const open = await supabase.from('audit_event_reviews')
    .select('id', { count: 'exact', head: true }).neq('status', 'resolved')
  if (open.error) {
    if (isNotProvisioned(open.error)) return { provisioned: false, open: null, byAudit: {} }
    throw new ServiceError(toUserMessage(open.error, 'Could not read review flags.'), open.error.code, open.error)
  }
  const byAudit = {}
  const ids = [...new Set(auditIds.filter(Boolean))]
  if (ids.length) {
    const { data, error } = await supabase.from('audit_event_reviews').select(REVIEW_COLS).in('audit_id', ids)
    if (error) throw new ServiceError(toUserMessage(error, 'Could not read review flags.'), error.code, error)
    for (const r of data || []) byAudit[r.audit_id] = r
  }
  return { provisioned: true, open: open.count ?? null, byAudit }
}

/** Flag an audit event for review (one flag per event; a repeat updates it). */
export async function flagAuditEvent(row, note) {
  const payload = {
    audit_id: row.id,
    record_table: row.table_name ?? null,
    record_id: row.record_id != null ? String(row.record_id) : null,
    status: 'open',
    note: String(note || '').trim() || null,
  }
  const { data, error } = await supabase.from('audit_event_reviews')
    .upsert(payload, { onConflict: 'organisation_id,audit_id' }).select(REVIEW_COLS).single()
  if (error) throw new ServiceError(toUserMessage(error, 'Could not flag this event.'), error.code, error)
  return data
}

/** Move a flag to investigating or resolved. */
export async function setReviewStatus(id, status, note) {
  const patch = { status }
  if (note != null) patch.note = String(note).trim() || null
  if (status === 'resolved') patch.resolved_at = new Date().toISOString()
  const { data, error } = await supabase.from('audit_event_reviews').update(patch).eq('id', id).select(REVIEW_COLS).single()
  if (error) throw new ServiceError(toUserMessage(error, 'Could not update the review.'), error.code, error)
  return data
}
