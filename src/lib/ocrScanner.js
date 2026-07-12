/**
 * OCR Scanner — pure, dependency-free domain logic for the CV Inspection / OCR
 * Scanner module (/ocr-scanner). Turns a set of scan records into confidence
 * banding, a review work-queue signal, and the KPI / breakdown roll-ups the
 * page renders.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/ocrScanner.js`) and page
 * (`src/pages/OcrScanner.jsx`) both build on these primitives so the roll-up
 * logic lives in exactly one place.
 *
 * Confidence is stored as a 0..1 fraction (an OCR/CV provider's per-extraction
 * score). `null`/absent confidence means "not yet scored by a provider".
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Review statuses that always demand a human pass, independent of confidence. */
const REVIEW_STATUSES = new Set(['needs_review', 'pending'])

/** Confidence threshold below which an extraction is not trustworthy on its own. */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.7

/** High/medium bands for a trustworthy extraction. */
export const HIGH_CONFIDENCE = 0.9
export const MEDIUM_CONFIDENCE = 0.7

/**
 * Band a scan's confidence into a coarse quality bucket:
 *   • 'high'    — confidence >= 0.90
 *   • 'medium'  — confidence >= 0.70
 *   • 'low'     — confidence  > 0
 *   • 'unknown' — confidence is null / absent / non-numeric (not yet scored)
 *
 * @param {{confidence?:number|string|null}} scan
 * @returns {'high'|'medium'|'low'|'unknown'}
 */
export function confidenceBand(scan) {
  const c = toFiniteNumber(scan?.confidence)
  if (c == null) return 'unknown'
  if (c >= HIGH_CONFIDENCE) return 'high'
  if (c >= MEDIUM_CONFIDENCE) return 'medium'
  if (c > 0) return 'low'
  return 'unknown'
}

/**
 * Does this scan need a human review pass? True when it is explicitly parked in
 * a 'needs_review'/'pending' state, or when a provider scored it below the
 * trust threshold (confidence present and < 0.7). A confirmed/rejected row, or
 * one with high confidence, does not surface in the queue.
 *
 * @param {{review_status?:string, confidence?:number|string|null}} scan
 * @returns {boolean}
 */
export function needsReview(scan) {
  const status = String(scan?.review_status || '').trim().toLowerCase()
  if (REVIEW_STATUSES.has(status)) return true
  const c = toFiniteNumber(scan?.confidence)
  if (c != null && c < REVIEW_CONFIDENCE_THRESHOLD) return true
  return false
}

/**
 * Summarise a set of scans for the KPI header:
 *   • totalScans         — number of rows
 *   • confirmedCount     — review_status === 'confirmed'
 *   • needsReviewCount   — rows where needsReview() is true
 *   • rejectedCount      — review_status === 'rejected'
 *   • autoExtractedCount — review_status === 'auto_extracted'
 *   • avgConfidence      — mean of present numeric confidences (0..1), or null
 *
 * @param {Array<object>} rows
 * @returns {{ totalScans:number, confirmedCount:number, needsReviewCount:number,
 *             rejectedCount:number, avgConfidence:number|null, autoExtractedCount:number }}
 */
export function summariseScans(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let confirmedCount = 0
  let needsReviewCount = 0
  let rejectedCount = 0
  let autoExtractedCount = 0
  let confSum = 0
  let confN = 0

  for (const r of list) {
    const status = String(r?.review_status || '').trim().toLowerCase()
    if (status === 'confirmed') confirmedCount++
    else if (status === 'rejected') rejectedCount++
    else if (status === 'auto_extracted') autoExtractedCount++

    if (needsReview(r)) needsReviewCount++

    const c = toFiniteNumber(r?.confidence)
    if (c != null) { confSum += c; confN += 1 }
  }

  return {
    totalScans: list.length,
    confirmedCount,
    needsReviewCount,
    rejectedCount,
    autoExtractedCount,
    avgConfidence: confN > 0 ? confSum / confN : null,
  }
}

/**
 * Count scans per scan_type, with a confirmed sub-count, sorted by total count
 * descending (ties broken alphabetically by type for determinism).
 *
 * @param {Array<object>} rows
 * @returns {Array<{ scan_type:string, count:number, confirmed:number }>}
 */
export function byType(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const map = new Map()
  for (const r of list) {
    const type = r?.scan_type != null && String(r.scan_type).trim() !== ''
      ? String(r.scan_type).trim()
      : 'other'
    const entry = map.get(type) || { scan_type: type, count: 0, confirmed: 0 }
    entry.count += 1
    if (String(r?.review_status || '').trim().toLowerCase() === 'confirmed') entry.confirmed += 1
    map.set(type, entry)
  }
  return [...map.values()].sort(
    (a, b) => b.count - a.count || a.scan_type.localeCompare(b.scan_type),
  )
}

/**
 * Count scans per confidence band. Always returns all four keys so the page can
 * render a stable distribution without null checks.
 *
 * @param {Array<object>} rows
 * @returns {{ high:number, medium:number, low:number, unknown:number }}
 */
export function byBand(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const counts = { high: 0, medium: 0, low: 0, unknown: 0 }
  for (const r of list) counts[confidenceBand(r)] += 1
  return counts
}
