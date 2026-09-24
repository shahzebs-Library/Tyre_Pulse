/**
 * auditSeals.js - pure helpers for the tamper-evident audit log console page.
 *
 * The database seals each closed UTC day of every audit source once
 * (public.audit_seals, migration 20260924102000). These helpers shape the seal
 * rows, the verification result and the export rows. No I/O here.
 */

export const AUDIT_SOURCES = [
  { value: 'audit_log_v2', label: 'Data change log' },
  { value: 'access_audit', label: 'Access changes' },
  { value: 'console_sessions', label: 'Console actions' },
]

export const EXPORT_PAGE_SIZE = 5000
export const EXPORT_WARN_ROWS = 100000

export function sourceLabel(source) {
  return AUDIT_SOURCES.find((s) => s.value === source)?.label || String(source || '')
}

/** Per-source rollup of the seal rows: sealed days, last day, last seal time, rows. */
export function sealsBySource(seals = []) {
  const out = {}
  for (const s of AUDIT_SOURCES) out[s.value] = { days: 0, rows: 0, firstDay: null, lastDay: null, lastSealedAt: null }
  for (const r of seals || []) {
    const b = out[r.source]
    if (!b) continue
    b.days += 1
    b.rows += Number(r.row_count) || 0
    if (!b.firstDay || r.day < b.firstDay) b.firstDay = r.day
    if (!b.lastDay || r.day > b.lastDay) b.lastDay = r.day
    if (r.sealed_at && (!b.lastSealedAt || r.sealed_at > b.lastSealedAt)) b.lastSealedAt = r.sealed_at
  }
  return out
}

/** Daily volume series for one source from the seals, oldest first, last `days`. */
export function volumeTrend(seals = [], source, days = 90) {
  const rows = (seals || [])
    .filter((r) => r.source === source)
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
    .slice(-days)
  return {
    labels: rows.map((r) => String(r.day).slice(5)),
    values: rows.map((r) => Number(r.row_count) || 0),
  }
}

/**
 * Summarise a verification run. `passed` is true only when every day matched
 * (a day purged by the retention policy counts as expected, not as tampering).
 */
export function summarizeVerify(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const mismatched = list.filter((r) => r.match === false || r.status === 'mismatch')
  const purged = list.filter((r) => r.status === 'purged_by_retention')
  const matched = list.filter((r) => r.status === 'match')
  return {
    checked: list.length,
    matched: matched.length,
    purged: purged.length,
    mismatched,
    passed: list.length > 0 && mismatched.length === 0,
    empty: list.length === 0,
  }
}

/** Explain one mismatched day in plain words. */
export function mismatchReason(row) {
  if (!row) return ''
  if (row.chain_ok === false) return 'The seal record itself was altered (the chain link does not add up).'
  const then = Number(row.row_count_then) || 0
  const now = Number(row.row_count_now) || 0
  if (now < then) return `${then - now} row(s) were deleted after sealing.`
  if (now > then) return `${now - then} row(s) were added after sealing.`
  return 'Row content was changed after sealing.'
}

/** Page offsets needed to pull `total` rows `size` at a time. */
export function pageOffsets(total, size = EXPORT_PAGE_SIZE) {
  const n = Math.max(0, Number(total) || 0)
  const s = Math.max(1, Number(size) || EXPORT_PAGE_SIZE)
  const out = []
  for (let o = 0; o < n; o += s) out.push(o)
  return out
}

/** Flatten one export row: objects become JSON text so a spreadsheet cell can hold them. */
export function flattenExportRow(row) {
  const data = row?.data && typeof row.data === 'object' ? row.data : {}
  const flat = {}
  for (const [k, v] of Object.entries(data)) {
    flat[k] = v !== null && typeof v === 'object' ? JSON.stringify(v) : v
  }
  return flat
}

/** Stable column list: union of keys across rows, in first-seen order. */
export function exportColumns(flatRows = []) {
  const seen = new Set()
  const cols = []
  for (const r of flatRows) {
    for (const k of Object.keys(r || {})) {
      if (!seen.has(k)) { seen.add(k); cols.push(k) }
    }
  }
  return cols
}

export function exportWarning(count) {
  const n = Number(count) || 0
  if (n > EXPORT_WARN_ROWS) {
    return `This is ${n.toLocaleString('en-GB')} rows. The download will take a while and produce a very large file. Narrow the date range if you can.`
  }
  return null
}
