/**
 * ocrScannerAnalytics.js - page-level analytics for the CV Inspection / OCR
 * Scanner (src/pages/OcrScanner.jsx), layered on the domain primitives in
 * ocrScanner.js (confidence banding, needsReview, summariseScans). No I/O, no
 * React; `now` is injectable.
 *
 * Honesty rules: an unscored scan has confidence null and renders "Not scored",
 * never 0%; the acceptance rate is null until a reviewer has decided at least
 * one scan; the oldest-waiting age is null when nothing is waiting.
 */
import { confidenceBand, needsReview, toFiniteNumber } from './ocrScanner'

const MS_DAY = 86400000

/** 0..1 confidence as a whole percent, or null when unscored. */
export function confidencePct(scan) {
  const c = toFiniteNumber(scan?.confidence)
  return c == null ? null : Math.round(c * 100)
}

/** Human text for a confidence value. */
export function fmtConfidence(v) {
  const c = toFiniteNumber(v)
  return c == null ? 'Not scored' : `${Math.round(c * 100)}%`
}

/** Short preview of a structured extraction, 'N/A' when there is none. */
export function fieldsPreview(fields) {
  if (!fields || typeof fields !== 'object') return 'N/A'
  const keys = Object.keys(fields)
  if (!keys.length) return 'N/A'
  return keys.slice(0, 3).map((k) => `${k}: ${String(fields[k]).slice(0, 24)}`).join(' | ')
    + (keys.length > 3 ? ` +${keys.length - 3}` : '')
}

/** The best single "what was read" string for a row. */
export function extractedSummary(scan) {
  return scan?.corrected_value || scan?.extracted_text || fieldsPreview(scan?.extracted_fields)
}

/**
 * Review queue: rows that need a human pass, lowest confidence first, with
 * unscored rows (most urgent, nothing known) ahead of every scored one and the
 * oldest first inside a tie.
 */
export function reviewQueue(rows) {
  const conf = (r) => {
    const c = toFiniteNumber(r?.confidence)
    return c == null ? -1 : c
  }
  const t = (r) => {
    const v = Date.parse(r?.created_at || '')
    return Number.isFinite(v) ? v : Infinity
  }
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => needsReview(r))
    .sort((a, b) => conf(a) - conf(b) || t(a) - t(b))
}

/**
 * Filter the register. `review` = 'needs' keeps only rows in the review queue;
 * `band` matches confidenceBand().
 */
export function filterScans(rows, { q = '', type = '', status = '', band = '', review = '' } = {}) {
  const needle = String(q || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (type && r.scan_type !== type) return false
    if (status && r.review_status !== status) return false
    if (band && confidenceBand(r) !== band) return false
    if (review === 'needs' && !needsReview(r)) return false
    if (!needle) return true
    return `${r.asset_no || ''} ${r.scan_type || ''} ${r.extracted_text || ''} ${r.corrected_value || ''} ${r.reviewed_by || ''} ${r.notes || ''}`
      .toLowerCase().includes(needle)
  })
}

/**
 * Review performance:
 *   acceptanceRate   confirmed / (confirmed + rejected), null before any decision
 *   correctedCount   decided rows a reviewer corrected (corrected_value present)
 *   oldestWaitingDays age of the oldest row in the review queue, null when empty
 *   withImage / imageCoveragePct  scans that carry an image reference
 */
export function reviewPerformance(rows, now = new Date()) {
  const list = Array.isArray(rows) ? rows : []
  let confirmed = 0, rejected = 0, corrected = 0, withImage = 0
  for (const r of list) {
    const s = String(r?.review_status || '').toLowerCase()
    if (s === 'confirmed') confirmed++
    if (s === 'rejected') rejected++
    if ((s === 'confirmed' || s === 'rejected') && String(r?.corrected_value || '').trim()) corrected++
    if (String(r?.image_url || '').trim()) withImage++
  }
  const nowMs = now instanceof Date ? now.getTime() : Date.now()
  let oldest = null
  for (const r of reviewQueue(list)) {
    const t = Date.parse(r?.created_at || '')
    if (Number.isFinite(t) && (oldest == null || t < oldest)) oldest = t
  }
  const decided = confirmed + rejected
  return {
    acceptanceRate: decided > 0 ? Math.round((confirmed / decided) * 1000) / 10 : null,
    decided,
    correctedCount: corrected,
    oldestWaitingDays: oldest == null ? null : Math.max(0, Math.floor((nowMs - oldest) / MS_DAY)),
    withImage,
    imageCoveragePct: list.length ? Math.round((withImage / list.length) * 1000) / 10 : null,
  }
}

/** Flat rows for Excel/PDF over the whole filtered set. */
export function scanExportRows(rows, { typeLabel = {}, statusLabel = {}, bandLabel = {} } = {}) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const pct = confidencePct(r)
    return {
      scan_type: typeLabel[r.scan_type] || r.scan_type || '',
      asset_no: r.asset_no || '',
      extracted: extractedSummary(r),
      confidence_band: bandLabel[confidenceBand(r)] || confidenceBand(r),
      confidence_pct: pct == null ? 'Not scored' : pct,
      review_status: statusLabel[r.review_status] || r.review_status || '',
      corrected_value: r.corrected_value || '',
      reviewed_by: r.reviewed_by || '',
      created_at: r.created_at ? String(r.created_at).slice(0, 10) : '',
    }
  })
}
