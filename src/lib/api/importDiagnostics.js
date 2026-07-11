/**
 * Import diagnostics service - read-only, post-commit intake diagnosis.
 *
 * A committed or stalled import batch can leave rows that never became live
 * records (commit failures stored in import_row_issues with issue_code
 * 'COMMIT_FAILED'). This module reads the staging tables so a diagnostics panel
 * can explain WHAT happened to a batch without touching the write path.
 *
 * Read-only by design: no inserts, updates, RPCs or storage writes live here.
 * Every method throws on a Supabase error and returns the plain data, matching
 * the throw-on-error / return-data convention of imports.js.
 */
import { supabase } from '../supabase'

// Row ids we scan to resolve issues (import_row_issues has no batch_id, so we
// bridge batch → row ids → issues). Bounded so a huge batch can't run away.
const ISSUE_ROW_SCAN_LIMIT = 2000

const BATCH_COLS =
  'id, country, module, sheet, approval_status, import_status, total_rows, ready_rows, warning_rows, error_rows, duplicate_rows, conflict_rows, imported_rows, skipped_rows, created_at, approved_at, completed_at'

const ROW_COLS = 'id, source_row_no, validation_status, dup_status, action, target_record_id, processed_at'

const ISSUE_COLS = 'row_id, source_field, target_field, severity, issue_code, message'

/**
 * Full import_batches row for one batch. Returns the row (or null when absent).
 * @param {string} batchId
 */
export async function getBatch(batchId) {
  const { data, error } = await supabase
    .from('import_batches')
    .select(BATCH_COLS)
    .eq('id', batchId)
    .single()
  if (error) throw error
  return data
}

/**
 * Staged rows for a batch, ordered by their position in the source sheet.
 * @param {string} batchId
 * @param {{ limit?: number, onlyErrors?: boolean }} [opts]
 * @returns {Promise<Array>}
 */
export async function listBatchRows(batchId, { limit = 500, onlyErrors = false } = {}) {
  let q = supabase
    .from('import_rows')
    .select(ROW_COLS)
    .eq('batch_id', batchId)
  if (onlyErrors) q = q.eq('validation_status', 'error')
  const { data, error } = await q.order('source_row_no').limit(limit)
  if (error) throw error
  return data ?? []
}

/**
 * Field-level issues for a batch, each enriched with its row's source_row_no.
 *
 * import_row_issues has no batch_id, so this is a two-step read: resolve the
 * batch's row ids first, then fetch their issues and join the source_row_no back
 * in JS. When the batch has no rows we skip the second query entirely.
 *
 * @param {string} batchId
 * @param {{ onlyErrors?: boolean, limit?: number }} [opts]
 * @returns {Promise<Array>} issues with an added `source_row_no`
 */
export async function listBatchIssues(batchId, { onlyErrors = true, limit = 500 } = {}) {
  const { data: rows, error: rowsErr } = await supabase
    .from('import_rows')
    .select('id, source_row_no')
    .eq('batch_id', batchId)
    .limit(ISSUE_ROW_SCAN_LIMIT)
  if (rowsErr) throw rowsErr

  const rowList = rows ?? []
  if (rowList.length === 0) return []

  const rowNoById = new Map(rowList.map((r) => [r.id, r.source_row_no]))
  const ids = rowList.map((r) => r.id)

  let q = supabase
    .from('import_row_issues')
    .select(ISSUE_COLS)
    .in('row_id', ids)
  if (onlyErrors) q = q.eq('severity', 'error')
  const { data: issues, error: issuesErr } = await q.limit(limit)
  if (issuesErr) throw issuesErr

  return (issues ?? []).map((i) => ({ ...i, source_row_no: rowNoById.get(i.row_id) ?? null }))
}

/**
 * Orchestrated batch health snapshot for the diagnostics panel: the batch header,
 * its rows, its error issues, and the rows that failed to land live.
 *
 * `failedRows` = rows flagged invalid, OR rows that were meant to be written
 * (not skip/reject, no target_record_id) yet were already processed - i.e. the
 * commit touched them but no live record resulted (the COMMIT_FAILED signature).
 *
 * Defensive: if any sub-call throws, it propagates so callers can surface it.
 * @param {string} batchId
 */
export async function getBatchDiagnostics(batchId) {
  const batch = await getBatch(batchId)
  const rows = await listBatchRows(batchId, { limit: 500 })
  const issues = await listBatchIssues(batchId, { onlyErrors: true })

  const failedRows = rows.filter(
    (r) =>
      r.validation_status === 'error' ||
      (r.action !== 'skip' && r.action !== 'reject' && !r.target_record_id && r.processed_at),
  )

  return { batch, rows, issues, failedRows }
}
