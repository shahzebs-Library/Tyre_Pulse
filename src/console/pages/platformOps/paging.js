/**
 * Pure paging + time helpers for the platform/ops console pages. Kept apart
 * from the React pieces in kit.jsx so the arithmetic is testable without a DOM.
 */

/** Clamp a requested page to the pages that exist (1-based). */
export function clampPage(page, total, size) {
  const pages = Math.max(1, Math.ceil((Number(total) || 0) / Math.max(1, size)))
  const p = Math.floor(Number(page) || 1)
  return Math.min(Math.max(1, p), pages)
}

/**
 * One page of `rows`. Returns the slice plus the numbers a pager prints:
 * `start`/`end` are 1-based and inclusive, and both are 0 for an empty list so
 * the pager can say "0 of 0" instead of "1-0 of 0".
 */
export function pageSlice(rows, page, size = 25) {
  const list = Array.isArray(rows) ? rows : []
  const n = Math.max(1, Math.floor(size) || 25)
  const total = list.length
  const pages = Math.max(1, Math.ceil(total / n))
  const current = clampPage(page, total, n)
  const from = (current - 1) * n
  const slice = list.slice(from, from + n)
  return {
    rows: slice,
    page: current,
    pages,
    total,
    start: total ? from + 1 : 0,
    end: total ? from + slice.length : 0,
  }
}

/**
 * Relative age in plain English ("just now", "4 min ago", "3 h ago", "2 days
 * ago"). Returns null for a missing or unparseable time, so a caller prints
 * "never" or "N/A" rather than "NaN min ago".
 */
export function ageText(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') return null
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime()
  if (!Number.isFinite(t)) return null
  const s = Math.round((now - t) / 1000)
  if (s < 0) return 'in the future'
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 36) return `${h} h ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

/** A date-time for tables, or 'N/A' when the value is missing or junk. */
export function whenText(value) {
  if (!value) return 'N/A'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}
