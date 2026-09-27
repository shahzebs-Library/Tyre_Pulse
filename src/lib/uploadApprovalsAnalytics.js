/**
 * uploadApprovalsAnalytics - the pure engine behind the Upload Approvals page
 * (`/upload-approvals`).
 *
 * The page reviews two queues: the canonical Data Intake batches
 * (`import_batches`, committed by the secure `import_commit_batch` RPC) and the
 * legacy staged uploads (`pending_uploads`, decided by
 * `approve_pending_upload` / `reject_pending_upload`). This module holds every
 * calculation the page renders - the KPI strip, the per-queue row shaping, the
 * search/filter predicates, the staged-row column picks and export rows - so
 * none of it is re-derived inline. It performs no I/O and never decides a batch.
 *
 * Honest nulls: a rate with no denominator is null (N/A), never 0 or 100.
 */

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null)

export const LEGACY_TYPES = ['tyres', 'stock']

/** Legacy `upload_type` folded to a known type (unknown types read as tyres, as before). */
export function legacyType(t) {
  return LEGACY_TYPES.includes(t) ? t : 'tyres'
}

/** Status of a legacy staged upload, as a label. */
export function legacyStatusLabel(status) {
  if (status === 'approved') return 'Approved'
  if (status === 'rejected') return 'Rejected'
  if (status === 'pending') return 'Pending review'
  return status ? String(status) : 'Unknown'
}

/** Share of a batch's rows that are ready to commit (null when it has none). */
export function readyPct(batch) {
  return pct(n(batch?.ready_rows), n(batch?.total_rows))
}

/** Intake queue rows, shaped for the table. */
export function intakeRows(batches) {
  return (batches || []).map((b) => ({
    ...b,
    id: b.id,
    moduleLabel: b.module ? `${String(b.module)[0].toUpperCase()}${String(b.module).slice(1)}` : 'Unknown',
    total: n(b.total_rows),
    ready: n(b.ready_rows),
    warnings: n(b.warning_rows),
    errors: n(b.error_rows),
    duplicates: n(b.duplicate_rows),
    readyPct: readyPct(b),
    committable: n(b.ready_rows) > 0,
  }))
}

/** Legacy staged-upload rows, shaped for the table. */
export function legacyRows(uploads) {
  return (uploads || []).map((p) => ({
    ...p,
    id: p.id,
    type: legacyType(p.upload_type),
    // NOT `rows`: that field is the staged data the correction modal edits.
    rowCount: n(p.row_count),
    statusLabel: legacyStatusLabel(p.status),
  }))
}

/** Split legacy uploads into the pending queue and the decided history. */
export function splitLegacy(uploads) {
  const list = uploads || []
  return {
    pending: list.filter((p) => p.status === 'pending'),
    history: list.filter((p) => p.status !== 'pending'),
  }
}

/**
 * The KPI strip. Approval rate is approved / decided over the history the page
 * holds, null when nothing has been decided yet.
 */
export function approvalKpis({ intake = [], pending = [], history = [] } = {}) {
  const intakeRowsTotal = intake.reduce((s, b) => s + n(b.total_rows), 0)
  const intakeReady = intake.reduce((s, b) => s + n(b.ready_rows), 0)
  const intakeErrors = intake.reduce((s, b) => s + n(b.error_rows), 0)
  const pendingRows = pending.reduce((s, p) => s + n(p.row_count), 0)
  const approved = history.filter((p) => p.status === 'approved').length
  const rejected = history.filter((p) => p.status === 'rejected').length
  return {
    intakeBatches: intake.length,
    intakeRows: intakeRowsTotal,
    intakeReady,
    intakeErrors,
    intakeReadyPct: pct(intakeReady, intakeRowsTotal),
    pendingBatches: pending.length,
    pendingRows,
    approved,
    rejected,
    approvalRate: pct(approved, approved + rejected),
    awaiting: intake.length + pending.length,
  }
}

/** Distinct non-blank values of `field`, sorted, for a filter select. */
export function distinctValues(rows, field) {
  return [...new Set((rows || []).map((r) => r?.[field]).filter((v) => v != null && String(v).trim() !== ''))]
    .map(String).sort((a, b) => a.localeCompare(b))
}

/**
 * Filter queue rows. `filters` = { search, country, type, status }; 'All' or ''
 * means no restriction. Search looks at file, uploader, module, sheet, country.
 */
export function filterQueue(rows, filters = {}) {
  const q = String(filters.search || '').trim().toLowerCase()
  const on = (v) => v && v !== 'All'
  return (rows || []).filter((r) => {
    if (on(filters.country) && String(r.country || '') !== filters.country) return false
    if (on(filters.type) && r.type !== filters.type) return false
    if (on(filters.status) && r.status !== filters.status) return false
    if (!q) return true
    return [r.file_name, r.uploader_name, r.module, r.sheet, r.country]
      .some((v) => v != null && String(v).toLowerCase().includes(q))
  })
}

/** How many queue filters are active (search excluded). */
export function activeFilterCount(filters = {}) {
  return ['country', 'type', 'status'].filter((k) => filters[k] && filters[k] !== 'All').length
}

export const PREFERRED_COLS = ['issue_date', 'asset_no', 'brand', 'serial_no', 'site', 'country', 'category', 'risk_level', 'cost_per_tyre', 'qty', 'description', 'item_code', 'unit_cost']

/** Columns to show for a legacy staged batch: the preferred set when present, else the first 12. */
export function stagedColumns(rows) {
  const first = (rows || [])[0]
  if (!first || typeof first !== 'object') return []
  const present = PREFERRED_COLS.filter((k) => k in first)
  return present.length ? present : Object.keys(first).slice(0, 12)
}

/** Columns for a Data Intake batch preview: the first row carrying transformed data. */
export function intakePreviewColumns(rows) {
  const first = (rows || []).find((r) => r?.transformed_data && typeof r.transformed_data === 'object')
  return first ? Object.keys(first.transformed_data).slice(0, 12) : []
}

/** Search a staged batch (with its original index kept, so edits land on the right row). */
export function searchStaged(rows, query, cols) {
  const q = String(query || '').trim().toLowerCase()
  const withIdx = (rows || []).map((r, idx) => ({ r, idx }))
  if (!q) return withIdx
  return withIdx.filter(({ r }) => (cols || []).some((c) => String(r?.[c] ?? '').toLowerCase().includes(q)))
}

/** Validation tally for a Data Intake preview. */
export function validationTally(rows) {
  const out = { ready: 0, warning: 0, error: 0, other: 0 }
  for (const r of rows || []) {
    const s = r?.validation_status
    if (s === 'ready') out.ready += 1
    else if (s === 'warning') out.warning += 1
    else if (s === 'error') out.error += 1
    else out.other += 1
  }
  return out
}
