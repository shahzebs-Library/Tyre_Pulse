/**
 * workshopStatus/uploadHistory.js - pure view helpers for the Daily upload
 * history (Loop 15): the register of past daily Excel uploads and the
 * read-only row-level detail of one upload. No I/O.
 *
 * Source tables (migration 20261007090000 + 20261011140000):
 *   workshop_status_uploads      one row per file (status previewed | confirmed
 *                                | cancelled | failed, counts, who / when)
 *   workshop_status_upload_rows  the parsed rows of a file and their outcome
 *                                (append-only evidence)
 *
 * Owner rule: a vehicle missing from the daily Excel is RELEASED. The DB token
 * stays 'removed' / removed_count; only the UI says "Released".
 */

/** Upload status -> display state. A previewed upload never confirmed is abandoned. */
export const HISTORY_STATES = Object.freeze(['confirmed', 'abandoned', 'failed'])

export function historyState(upload) {
  const s = String(upload?.status ?? '').toLowerCase()
  if (s === 'confirmed') return 'confirmed'
  if (s === 'failed') return 'failed'
  return 'abandoned' // cancelled, or previewed and left without confirming
}

const num = (v) => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** One upload register row for the table. */
export function historyRow(u) {
  const state = historyState(u)
  return {
    id: u?.id ?? null,
    uploadNo: u?.upload_no ?? null,
    fileName: u?.file_name || null,
    sheet: u?.sheet_name || null,
    reportDate: u?.report_date || null,
    country: u?.country || null,
    rows: num(u?.total_rows),
    newCount: num(u?.new_count),
    changedCount: num(u?.updated_count),
    unchangedCount: num(u?.unchanged_count),
    releasedCount: num(u?.removed_count),
    invalidCount: num(u?.invalid_count),
    duplicateCount: num(u?.duplicate_count),
    conflictCount: num(u?.conflict_count),
    keptManualCount: num(u?.kept_manual_count),
    uploadedBy: u?.uploaded_by_name || null,
    uploadedAt: u?.uploaded_at || null,
    confirmedBy: u?.confirmed_by_name || null,
    confirmedAt: u?.confirmed_at || null,
    cancelledAt: u?.cancelled_at || null,
    status: u?.status || null,
    state,
    duplicateOf: u?.duplicate_of_upload_id || null,
  }
}

/**
 * Inclusive yyyy-mm-dd day range -> ISO bounds [gte, lt) in the browser's
 * local time, for filtering uploaded_at. Bad or blank input -> null bound.
 * A range given backwards is swapped rather than returning nothing.
 */
export function dayRangeBounds(from, to) {
  const ok = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
  let a = ok(from) ? from : null
  let b = ok(to) ? to : null
  if (a && b && a > b) [a, b] = [b, a]
  const start = a ? new Date(`${a}T00:00:00`) : null
  let end = null
  if (b) {
    end = new Date(`${b}T00:00:00`)
    end.setDate(end.getDate() + 1)
  }
  return {
    gte: start && !Number.isNaN(start.getTime()) ? start.toISOString() : null,
    lt: end && !Number.isNaN(end.getTime()) ? end.toISOString() : null,
  }
}

/** Upload register export columns (keys of historyExportRows rows). */
export const HISTORY_EXPORT_KEYS = Object.freeze([
  'uploadNo', 'fileName', 'sheet', 'reportDate', 'country', 'rows', 'newCount', 'changedCount',
  'unchangedCount', 'releasedCount', 'conflictCount', 'keptManualCount', 'invalidCount',
  'duplicateCount', 'uploadedBy', 'uploadedAt', 'state', 'confirmedBy', 'confirmedAt',
])

/** Flatten register rows for Excel. `stateLabel` maps a state to display text. */
export function historyExportRows(rows, stateLabel = (s) => s) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const h = r && r.state ? r : historyRow(r)
    const out = {}
    for (const k of HISTORY_EXPORT_KEYS) {
      const v = k === 'state' ? stateLabel(h.state) : h[k]
      out[k] = v == null ? '' : v
    }
    return out
  })
}

/** Outcome order for the detail view (DB tokens). */
export const ROW_OUTCOMES = Object.freeze(['new', 'changed', 'unchanged', 'removed', 'closed', 'invalid', 'duplicate'])

const shown = (v) => (v == null || (typeof v === 'string' && v.trim() === '') ? '(blank)' : String(v).trim())

/** "Complaint: X -> Y" lines from a staged row's `changes` jsonb. */
export function changeLines(changes, labels = {}) {
  if (!changes || typeof changes !== 'object') return []
  return Object.entries(changes).map(([f, c]) => {
    const from = c && typeof c === 'object' ? c.from : null
    const to = c && typeof c === 'object' ? c.to : c
    return `${labels[f] || f}: ${shown(from)} -> ${shown(to)}`
  })
}

/**
 * The conflict choice a confirmed upload actually applied, keyed by asset,
 * from the upload_confirmed event details (conflict_rows). Upload rows are
 * append-only, so the staged `resolution` is only what was REQUESTED.
 */
export function appliedConflicts(confirmDetails) {
  const out = new Map()
  const list = Array.isArray(confirmDetails?.conflict_rows) ? confirmDetails.conflict_rows : []
  for (const c of list) {
    if (c && c.asset_no && !out.has(c.asset_no)) out.set(c.asset_no, c)
  }
  return out
}

/** One parsed row of an upload, for the read-only detail table. */
export function uploadRowView(r, { labels = {}, applied } = {}) {
  const asset = r?.asset_no || null
  const hit = applied && asset ? applied.get(asset) : null
  return {
    id: r?.id ?? `${asset}-${r?.row_number ?? ''}`,
    rowNumber: r?.row_number ?? null,
    section: r?.section || null,
    asset,
    site: r?.site || r?.data?.site || null,
    outcome: r?.outcome || null,
    jobCard: r?.data?.job_card_ref || null,
    complaint: r?.data?.complaint || null,
    changes: changeLines(r?.changes, labels),
    errors: Array.isArray(r?.errors) ? r.errors.filter(Boolean) : [],
    releaseReason: r?.outcome === 'removed' ? (r?.raw?.removal_reason || null) : null,
    conflict: r?.conflict || (hit ? 'manual_newer' : null),
    requested: r?.resolution || null,
    applied: hit?.resolution || null,
    manualAt: r?.conflict_details?.last_manual_update_at || hit?.last_manual_update_at || null,
    manualBy: r?.conflict_details?.last_updated_by_name || hit?.last_updated_by_name || null,
  }
}

/** Counts per outcome (+ conflicts) over a detail list. */
export function summariseRows(views) {
  const out = Object.fromEntries(ROW_OUTCOMES.map((k) => [k, 0]))
  out.conflict = 0
  for (const v of Array.isArray(views) ? views : []) {
    if (v?.outcome && out[v.outcome] != null) out[v.outcome] += 1
    if (v?.conflict) out.conflict += 1
  }
  return out
}

/** Detail export columns. */
export const DETAIL_EXPORT_KEYS = Object.freeze([
  'rowNumber', 'section', 'asset', 'site', 'outcome', 'jobCard', 'complaint', 'changes',
  'releaseReason', 'conflict', 'requested', 'applied', 'manualAt', 'manualBy', 'errors',
])

export function detailExportRows(views, outcomeLabel = (o) => o) {
  return (Array.isArray(views) ? views : []).map((v) => {
    const out = {}
    for (const k of DETAIL_EXPORT_KEYS) {
      let val = v?.[k]
      if (k === 'outcome') val = outcomeLabel(val)
      if (Array.isArray(val)) val = val.join('; ')
      out[k] = val == null ? '' : val
    }
    return out
  })
}
