/**
 * driverDocumentsAnalytics - pure view-model engine for the Driver Documents
 * page (/driver-documents). Builds on the lifecycle rules in
 * `src/lib/driverDocuments.js` (docStatus / daysToExpiry / summarize) and adds
 * the page-level concerns: enrichment, search + filters, option lists, the
 * KPI strip, a type breakdown and the export shape.
 *
 * No I/O, no Date.now(): every function that needs a clock takes `now`.
 * Unmeasurable figures are null (rendered N/A), never a fabricated 0.
 */
import {
  docStatus, daysToExpiry, summarizeDriverDocuments, DOC_TYPES, DOC_TYPE_LABELS,
  DOC_STATUS_META, EXPIRING_SOON_DAYS,
} from './driverDocuments'
import { searchRows, sortRows, buildExport } from './consoleTable'

export const URGENT_DAYS = 30

export function docTypeLabel(t) {
  return DOC_TYPE_LABELS[t] || (t ? String(t).replace(/_/g, ' ') : 'N/A')
}

const norm = (s) => (typeof s === 'string' ? s.trim() : '')

/** Attach the derived lifecycle status and days-to-expiry to every row. */
export function enrichDocuments(rows = [], now) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    ...r,
    _status: docStatus(r, now),
    _days: daysToExpiry(r, now),
  }))
}

/** Document types present in the data: canonical order first, extras sorted. */
export function typeOptions(enriched = []) {
  const present = new Set(enriched.map((r) => r.doc_type).filter(Boolean))
  const ordered = DOC_TYPES.filter((t) => present.has(t))
  const extra = [...present].filter((t) => !DOC_TYPES.includes(t)).sort()
  return [...ordered, ...extra]
}

/** Distinct driver names (display spelling of the first occurrence), sorted. */
export function driverOptions(enriched = []) {
  const seen = new Map()
  for (const r of enriched) {
    const n = norm(r.driver_name)
    if (n && !seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}

/**
 * Apply search + filters. Default order: soonest expiry first (so the work
 * that needs doing is on the first screen); undated documents sort last.
 */
export function filterDocuments(enriched = [], { status = 'all', type = 'all', driver = 'all', search = '' } = {}) {
  const narrowed = enriched.filter((r) => {
    if (status !== 'all' && r._status !== status) return false
    if (type !== 'all' && r.doc_type !== type) return false
    if (driver !== 'all' && norm(r.driver_name).toLowerCase() !== String(driver).toLowerCase()) return false
    return true
  })
  const searched = searchRows(narrowed, search, [
    'driver_name', 'doc_number', 'issuer', (r) => docTypeLabel(r.doc_type),
  ])
  return sortRows(searched, { key: '_days', dir: 'asc' })
}

/**
 * KPI strip over the (unfiltered) documents.
 * compliancePct = share of drivers with NO expired document; null when there
 * are no named drivers (an empty register is not "100% compliant").
 */
export function documentKpis(rows = [], now) {
  const list = Array.isArray(rows) ? rows : []
  const summary = summarizeDriverDocuments(list, now)
  const enriched = enrichDocuments(list, now)
  const drivers = new Map()
  let urgent = 0
  let missingExpiry = 0
  let nextExpiry = null
  for (const r of enriched) {
    const key = norm(r.driver_name).toLowerCase()
    if (key) {
      const prev = drivers.get(key) || false
      drivers.set(key, prev || r._status === 'expired')
    }
    if (r._days == null) missingExpiry += 1
    else if (r._days >= 0) {
      if (r._days <= URGENT_DAYS) urgent += 1
      if (nextExpiry == null || r._days < nextExpiry.days) {
        nextExpiry = { days: r._days, driver: norm(r.driver_name) || 'N/A', type: docTypeLabel(r.doc_type), date: r.expiry_date }
      }
    }
  }
  const driverCount = drivers.size
  const driversWithExpired = [...drivers.values()].filter(Boolean).length
  return {
    total: summary.total,
    valid: summary.byStatus.valid,
    expiring: summary.byStatus.expiring,
    expired: summary.byStatus.expired,
    urgent,
    missingExpiry,
    drivers: driverCount,
    driversWithExpired,
    compliancePct: driverCount ? Math.round(((driverCount - driversWithExpired) / driverCount) * 1000) / 10 : null,
    nextExpiry,
    renewalQueue: summary.expiringSoon.length,
  }
}

/** Count of documents per type (label), largest first. */
export function typeBreakdown(enriched = []) {
  const m = new Map()
  for (const r of enriched) {
    const k = docTypeLabel(r.doc_type)
    const cur = m.get(k) || { type: k, total: 0, expiring: 0, expired: 0 }
    cur.total += 1
    if (r._status === 'expiring') cur.expiring += 1
    if (r._status === 'expired') cur.expired += 1
    m.set(k, cur)
  }
  return [...m.values()].sort((a, b) => b.total - a.total || a.type.localeCompare(b.type))
}

/** Human "in 12 days" / "3 days ago" / "today" for an expiry offset. */
export function expiryPhrase(days) {
  if (days == null) return 'No expiry date'
  if (days === 0) return 'Expires today'
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`
  return `in ${days} day${days === 1 ? '' : 's'}`
}

export const DOC_EXPORT_COLUMNS = [
  { key: 'driver_name', header: 'Driver' },
  { key: 'doc_type', header: 'Document type', value: (r) => docTypeLabel(r.doc_type) },
  { key: 'doc_number', header: 'Doc number' },
  { key: 'issuer', header: 'Issuer' },
  { key: 'issue_date', header: 'Issue date' },
  { key: 'expiry_date', header: 'Expiry date' },
  { key: 'days', header: 'Days to expiry', value: (r) => (r._days == null ? 'N/A' : r._days) },
  { key: 'status', header: 'Status', value: (r) => DOC_STATUS_META[r._status]?.label || 'N/A' },
]

export function documentExport(filtered = []) {
  return buildExport(filtered, DOC_EXPORT_COLUMNS)
}

export { EXPIRING_SOON_DAYS, DOC_STATUS_META, DOC_TYPES, DOC_TYPE_LABELS }
