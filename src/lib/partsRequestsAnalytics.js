/**
 * partsRequestsAnalytics.js - page-level analytics for Parts Requests
 * (src/pages/PartsRequests.jsx), layered on the lifecycle engine in
 * partsRequests.js (normalizePartsStatus, isOpenParts, partAgeHours,
 * summarizeParts). No I/O, no React; `now` is injectable.
 *
 * Owns: per-row decoration (overdue, age), the open-request ageing buckets,
 * the open-by-priority split, the fill rate and the export rows.
 *
 * Honesty rules: a request with no requested_at has age null ("N/A"), never 0;
 * the fill rate is null until at least one request reached a final outcome.
 */
import {
  normalizePartsStatus, isOpenParts, partAgeHours, PARTS_PRIORITIES,
  PARTS_STATUS_LABEL, PARTS_PRIORITY_LABEL,
} from './partsRequests'

export const AGE_BUCKETS = Object.freeze([
  { key: 'lt1d', label: 'Under 1 day', max: 24 },
  { key: 'd1to3', label: '1 to 3 days', max: 72 },
  { key: 'd3to7', label: '3 to 7 days', max: 168 },
  { key: 'gt7d', label: 'Over 7 days', max: Infinity },
])

const toMs = (v) => {
  if (!v) return null
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : null
}

/** Decorate each row: canonical status, open flag, overdue flag, age in hours. */
export function decorateRequests(rows, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Date.now()
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const status = normalizePartsStatus(r?.status)
    const open = isOpenParts(status)
    const need = toMs(r?.needed_by)
    return {
      ...r,
      _status: status,
      _open: open,
      _overdue: open && need != null && need < nowMs,
      _ageHours: partAgeHours(r, now),
    }
  })
}

/** Ageing buckets over OPEN requests only; undated requests counted apart. */
export function openAgeing(decorated) {
  const counts = Object.fromEntries(AGE_BUCKETS.map((b) => [b.key, 0]))
  let undated = 0
  for (const r of decorated || []) {
    if (!r._open) continue
    if (r._ageHours == null) { undated++; continue }
    const bucket = AGE_BUCKETS.find((b) => r._ageHours < b.max)
    counts[bucket.key] += 1
  }
  return { buckets: AGE_BUCKETS.map((b) => ({ ...b, count: counts[b.key] })), undated }
}

/** Open requests by priority, in the canonical priority order. */
export function openByPriority(decorated) {
  const counts = Object.fromEntries(PARTS_PRIORITIES.map((p) => [p, 0]))
  let other = 0
  for (const r of decorated || []) {
    if (!r._open) continue
    const p = String(r.priority || '').toLowerCase()
    if (p in counts) counts[p] += 1
    else other += 1
  }
  return { byPriority: PARTS_PRIORITIES.map((p) => ({ priority: p, label: PARTS_PRIORITY_LABEL[p] || p, count: counts[p] })), other }
}

/**
 * Fill rate: fulfilled over every request that reached a final outcome
 * (fulfilled, rejected, cancelled). Null until one has.
 */
export function fillRate(decorated) {
  let fulfilled = 0, closed = 0
  for (const r of decorated || []) {
    if (r._status === 'fulfilled') { fulfilled++; closed++ }
    else if (r._status === 'rejected' || r._status === 'cancelled') closed++
  }
  return closed > 0 ? Math.round((fulfilled / closed) * 1000) / 10 : null
}

/** Human age: hours under two days, days after. */
export function fmtAge(hours) {
  if (hours == null) return 'N/A'
  if (hours < 48) return `${Math.round(hours)} h`
  return `${Math.round(hours / 24)} d`
}

/** Flat rows for Excel/PDF over the whole filtered set. */
export function requestExportRows(decorated) {
  return (decorated || []).map((r) => ({
    requested_at: r.requested_at ? String(r.requested_at).slice(0, 16).replace('T', ' ') : '',
    part_name: r.part_name || '',
    qty: r.qty ?? '',
    asset_no: r.asset_no || '',
    site: r.site || '',
    priority: PARTS_PRIORITY_LABEL[r.priority] || r.priority || '',
    status: PARTS_STATUS_LABEL[r._status] || r.status || '',
    needed_by: r.needed_by ? String(r.needed_by).slice(0, 10) : '',
    overdue: r._overdue ? 'Yes' : 'No',
    age: fmtAge(r._ageHours),
    fulfilled_at: r.fulfilled_at ? String(r.fulfilled_at).slice(0, 16).replace('T', ' ') : '',
  }))
}
