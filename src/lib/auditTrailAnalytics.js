/**
 * Audit trail analytics: pure presentation engine for the Audit Trail page
 * (/audit). Turns audit_log_v2 / upload history rows into change diffs, action
 * mix, pagination labels and export rows. No I/O.
 *
 * HONESTY: a value that was not recorded renders N/A; an actor that cannot be
 * resolved renders "Unknown"; statistics that could not be read are null and
 * the page shows "Unavailable" rather than a false zero.
 */

export const AUDIT_ACTIONS = ['UPLOAD', 'CREATE', 'UPDATE', 'EDIT', 'DELETE', 'EXPORT']

export function nonEmpty(obj) {
  return Boolean(obj) && typeof obj === 'object' && Object.keys(obj).length > 0
}

/** True when a row carries anything worth opening in the change detail. */
export function hasExpandable(row) {
  if (!row) return false
  return nonEmpty(row.details) || nonEmpty(row.old_values) || nonEmpty(row.new_values) || nonEmpty(row.old_data) || nonEmpty(row.new_data)
}

export function fmtVal(v) {
  if (v === null || v === undefined || v === '') return 'N/A'
  if (typeof v === 'object') { try { return JSON.stringify(v) } catch { return String(v) } }
  return String(v)
}

/**
 * Field-level diff for one audit row: { fields:[{field, oldValue, newValue,
 * changed}], meta, details }. `_meta` is lifted out of the new values.
 */
export function changeDiff(row) {
  const oldV = nonEmpty(row?.old_values) ? row.old_values : nonEmpty(row?.old_data) ? row.old_data : null
  const newRaw = nonEmpty(row?.new_values) ? row.new_values : nonEmpty(row?.new_data) ? row.new_data : null
  const meta = newRaw && nonEmpty(newRaw._meta) ? newRaw._meta : null
  const newV = newRaw ? Object.fromEntries(Object.entries(newRaw).filter(([k]) => k !== '_meta')) : null
  const keys = [...new Set([...Object.keys(oldV || {}), ...Object.keys(newV || {})])]
  const fields = keys.map((f) => {
    const oldValue = fmtVal(oldV?.[f])
    const newValue = fmtVal(newV?.[f])
    return { field: f, oldValue, newValue, changed: oldValue !== newValue }
  })
  return { fields, meta, details: nonEmpty(row?.details) ? row.details : null }
}

/** Resolve the actor name for an audit or upload row. */
export function actorName(row, idKey = 'user_id') {
  return row?.profiles?.full_name || row?.profiles?.username || (row?.[idKey] ? 'Unknown' : 'System')
}

/** Count actions on the loaded page, sorted by count desc. */
export function actionMix(rows = []) {
  const m = new Map()
  for (const r of Array.isArray(rows) ? rows : []) {
    const a = r?.action || 'OTHER'
    m.set(a, (m.get(a) || 0) + 1)
  }
  return [...m.entries()].map(([action, count]) => ({ action, count })).sort((a, b) => b.count - a.count)
}

/** "Showing a to b of n" for a server page; N/A when the total is unknown. */
export function pageRangeLabel(pageIndex, pageSize, total) {
  if (!Number.isFinite(total)) return 'N/A'
  if (total <= 0) return 'No entries'
  const from = pageIndex * pageSize + 1
  const to = Math.min((pageIndex + 1) * pageSize, total)
  return `Showing ${from} to ${to} of ${total.toLocaleString()}`
}

export function pageCountFor(total, pageSize) {
  if (!Number.isFinite(total) || total <= 0) return 1
  return Math.ceil(total / pageSize)
}

export const AUDIT_EXPORT_COLS = ['timestamp', 'user', 'action', 'table_name', 'records', 'details', 'old_values', 'new_values']
export const AUDIT_EXPORT_HEADERS = ['Timestamp', 'User', 'Action', 'Table', 'Records', 'Details', 'Old Values', 'New Values']
export const UPLOAD_EXPORT_COLS = ['file_names', 'records_added', 'records_skipped', 'uploaded_by', 'uploaded_at', 'region', 'reversed_at', 'reversed_count']
export const UPLOAD_EXPORT_HEADERS = ['File Names', 'Records Added', 'Records Skipped', 'Uploaded By', 'Uploaded At', 'Region', 'Reversed At', 'Reversed Records']

export function auditExportRows(rows = [], fmtTs = (v) => String(v)) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    timestamp: r.created_at ? fmtTs(r.created_at) : '',
    user: r.profiles?.full_name ?? r.profiles?.username ?? r.user_id ?? '',
    action: r.action ?? '',
    table_name: r.table_name ?? '',
    records: r.record_count ?? '',
    details: r.details ? JSON.stringify(r.details) : '',
    old_values: JSON.stringify(r.old_values ?? r.old_data ?? null),
    new_values: JSON.stringify(r.new_values ?? r.new_data ?? null),
  }))
}

export function uploadExportRows(rows = [], fmtTs = (v) => String(v)) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    file_names: Array.isArray(r.file_names) ? r.file_names.join(', ') : (r.file_names ?? ''),
    records_added: r.records_added ?? 0,
    records_skipped: r.records_skipped ?? 0,
    uploaded_by: r.profiles?.full_name ?? r.profiles?.username ?? r.uploaded_by ?? '',
    uploaded_at: r.uploaded_at ? fmtTs(r.uploaded_at) : '',
    region: r.region ?? '',
    reversed_at: r.reversed_at ? fmtTs(r.reversed_at) : '',
    reversed_count: r.reversed_count ?? '',
  }))
}

/** File base name: "TyrePulse Audit Log 2026-09-27" (no dashes in words). */
export function auditFileName(kind, now = new Date()) {
  const d = now instanceof Date ? now : new Date(now)
  const stamp = Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
  return `TyrePulse ${kind === 'upload' ? 'Upload History' : 'Audit Log'} ${stamp}`.trim()
}
