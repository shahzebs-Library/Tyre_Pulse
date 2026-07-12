/**
 * Proof of Delivery (POD) — pure, dependency-free domain logic for the Proof of
 * Delivery module (/proof-of-delivery). Reduces a set of delivery records into
 * fleet-level delivery KPIs, a per-status breakdown, and per-driver performance.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/podRecords.js`) and page
 * (`src/pages/ProofOfDelivery.jsx`) both build on these primitives so the
 * roll-up logic lives in exactly one place.
 */

/** The canonical POD status values (matches the DB CHECK constraint). */
export const POD_STATUSES = ['pending', 'delivered', 'partial', 'failed', 'returned']

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Summarise a set of POD records for the KPI header:
 *   • totalPods        — number of rows
 *   • deliveredCount   — rows with status === 'delivered'
 *   • failedCount      — rows with status === 'failed'
 *   • pendingCount     — rows with status === 'pending'
 *   • deliveryRate     — deliveredCount / totalPods as a 0..100 percentage
 *   • distinctCustomers— count of distinct (trimmed) customer names
 *
 * @param {Array<object>} rows
 * @returns {{ totalPods:number, deliveredCount:number, failedCount:number,
 *             pendingCount:number, deliveryRate:number, distinctCustomers:number }}
 */
export function summarisePods(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const customers = new Set()
  let deliveredCount = 0
  let failedCount = 0
  let pendingCount = 0

  for (const r of list) {
    const status = r?.status != null ? String(r.status).trim().toLowerCase() : ''
    if (status === 'delivered') deliveredCount += 1
    else if (status === 'failed') failedCount += 1
    else if (status === 'pending') pendingCount += 1

    const customer = r?.customer_name != null ? String(r.customer_name).trim() : ''
    if (customer) customers.add(customer.toLowerCase())
  }

  const totalPods = list.length
  const deliveryRate = totalPods > 0
    ? Math.round((deliveredCount / totalPods) * 100)
    : 0

  return {
    totalPods,
    deliveredCount,
    failedCount,
    pendingCount,
    deliveryRate,
    distinctCustomers: customers.size,
  }
}

/**
 * Count POD records by status. Returns an object with a numeric count for every
 * canonical status (zero when absent), so the UI can render a stable strip.
 * Rows whose status is missing or outside the enum are ignored.
 *
 * @param {Array<object>} rows
 * @returns {Record<string, number>}
 */
export function byStatus(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const out = {}
  for (const s of POD_STATUSES) out[s] = 0
  for (const r of list) {
    const status = r?.status != null ? String(r.status).trim().toLowerCase() : ''
    if (status && Object.prototype.hasOwnProperty.call(out, status)) out[status] += 1
  }
  return out
}

/**
 * Per-driver delivery performance. For each distinct (trimmed) driver_name,
 * counts successful deliveries (status === 'delivered') and failures
 * (status === 'failed'). Rows without a driver name are ignored. Sorted by
 * deliveries desc, then driver_name asc for deterministic ordering.
 *
 * @param {Array<object>} rows
 * @returns {Array<{ driver_name:string, deliveries:number, failed:number }>}
 */
export function byDriver(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const map = new Map()
  for (const r of list) {
    const driver = r?.driver_name != null ? String(r.driver_name).trim() : ''
    if (!driver) continue
    const entry = map.get(driver) || { driver_name: driver, deliveries: 0, failed: 0 }
    const status = r?.status != null ? String(r.status).trim().toLowerCase() : ''
    if (status === 'delivered') entry.deliveries += 1
    else if (status === 'failed') entry.failed += 1
    map.set(driver, entry)
  }
  return [...map.values()].sort(
    (a, b) => b.deliveries - a.deliveries || a.driver_name.localeCompare(b.driver_name),
  )
}
