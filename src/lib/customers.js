/**
 * Pure customer-domain helpers — no I/O, no Supabase, fully unit-testable.
 * Used by the Customer Management page to derive KPI tiles from a loaded set of
 * customer rows without a round-trip. Keep this side-effect free.
 */

export const CUSTOMER_STATUSES = ['active', 'inactive', 'prospect']

/**
 * Lightweight email validity check (format only — deliverability is out of
 * scope). Returns false for empty/non-string input so it doubles as a guard.
 * @param {string} value
 * @returns {boolean}
 */
export function isValidEmail(value) {
  if (typeof value !== 'string') return false
  const v = value.trim()
  if (!v || v.length > 254) return false
  // Pragmatic RFC-5322-lite: single @, no whitespace, a dotted domain.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

/**
 * Summarise a list of customer rows into the counts the dashboard header shows:
 * per-status counts, a grand total, and the number of distinct customer types.
 * Unknown/blank statuses are counted in `total` but not attributed to a status
 * bucket, so the buckets never over-report.
 *
 * @param {Array<{status?: string, customer_type?: string}>} rows
 * @returns {{ active: number, inactive: number, prospect: number,
 *             total: number, types: number }}
 */
export function summarizeCustomers(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const by = { active: 0, inactive: 0, prospect: 0 }
  const types = new Set()
  for (const r of list) {
    const status = String(r?.status || '').trim().toLowerCase()
    if (by[status] != null) by[status] += 1
    const type = String(r?.customer_type || '').trim()
    if (type) types.add(type.toLowerCase())
  }
  return { ...by, total: list.length, types: types.size }
}
