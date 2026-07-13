/**
 * Tyre Pool — pure helpers (no I/O) for the Tyre Pool module (ported from
 * tyre_saas). The "pool" is the set of unfitted / available tyres (spare, buffer
 * or stock tyres) that are NOT currently on a vehicle and have NOT been
 * removed/scrapped — i.e. the inventory that can still be allocated to a vehicle.
 *
 * Tyre Pulse's `tyre_records` has no single canonical "pool" flag and the status
 * vocabulary varies across imported datasets, so the rule is deliberately broad
 * and documented in ONE place (`isPoolTyre`) and unit-tested. The page and
 * service consume these helpers so the definition never drifts.
 *
 * Pool rules (a record is in the pool when ALL of the following hold):
 *   1. It is NOT removed or scrapped. A record is treated as removed/scrapped
 *      when it carries a `removal_date`, a `km_at_removal`, a `Scrap` category,
 *      or a status matching /scrap|removed|disposed|retired|written.?off/i.
 *   2. AND it is available stock, meaning EITHER
 *        a. its status matches /spare|stock|pool|available|unfitted|unmounted/i,
 *        b. OR it has NO `asset_no` assigned (unassigned tyres are, by
 *           definition, not fitted to a vehicle and so sit in the pool).
 */

const REMOVED_STATUS_RE = /scrap|removed|disposed|retired|written.?off/i
const POOL_STATUS_RE = /spare|stock|pool|available|unfitted|unmounted/i

/** Effective serial across the datasets' differing column names. */
export function poolSerialOf(rec) {
  return rec?.serial_no || rec?.serial_number || rec?.tyre_serial || null
}

/** Trim a value to a non-empty string, else null (handles NULL / '' / spaces). */
function nonEmpty(v) {
  if (v == null) return null
  const s = String(v).trim()
  return s.length ? s : null
}

/** Numeric coercion for money/aggregates; non-numeric -> 0. */
function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

/** True when the record has been removed from service or scrapped. */
export function isRemovedOrScrapped(rec) {
  if (!rec) return false
  if (rec.removal_date != null && nonEmpty(rec.removal_date)) return true
  if (rec.km_at_removal != null && rec.km_at_removal !== '') return true
  if (nonEmpty(rec.category)?.toLowerCase() === 'scrap') return true
  const status = nonEmpty(rec.status)
  if (status && REMOVED_STATUS_RE.test(status)) return true
  return false
}

/**
 * True when a tyre record belongs to the available/unfitted pool.
 * Pure and side-effect free. See module header for the exact rules.
 */
export function isPoolTyre(rec) {
  if (!rec) return false
  // Rule 1: removed / scrapped tyres are never in the allocatable pool.
  if (isRemovedOrScrapped(rec)) return false
  // Rule 2a: an explicit spare/stock/available status makes it a pool tyre.
  const status = nonEmpty(rec.status)
  if (status && POOL_STATUS_RE.test(status)) return true
  // Rule 2b: otherwise, an unassigned tyre (no asset_no) sits in the pool.
  return nonEmpty(rec.asset_no) == null
}

/** Filter an array of records down to the pool tyres. */
export function filterPoolTyres(records) {
  return (Array.isArray(records) ? records : []).filter(isPoolTyre)
}

/**
 * Group an array of pool records by a keyed dimension, returning
 * `[{ key, count, value }]` sorted by count desc then key asc. `value` is the
 * summed `cost_per_tyre`. Missing/blank keys collapse into `fallback`.
 */
function groupBy(records, keyFn, fallback) {
  const m = new Map()
  for (const r of records) {
    const key = nonEmpty(keyFn(r)) || fallback
    const cur = m.get(key) || { key, count: 0, value: 0 }
    cur.count += 1
    cur.value += num(r.cost_per_tyre)
    m.set(key, cur)
  }
  return [...m.values()].sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)))
}

/**
 * Summarize the pool from a raw record list. Filters to pool tyres first, then
 * produces headline totals and by-brand / by-size / by-site breakdowns.
 *
 * @param {Array<object>} records  raw tyre_records rows
 * @returns {{
 *   pool: Array<object>, totalTyres: number, totalValue: number,
 *   distinctBrands: number, distinctSizes: number, distinctSites: number,
 *   byBrand: Array<{key:string,count:number,value:number}>,
 *   bySize: Array<{key:string,count:number,value:number}>,
 *   bySite: Array<{key:string,count:number,value:number}>,
 * }}
 */
export function summarizePool(records) {
  const pool = filterPoolTyres(records)
  const byBrand = groupBy(pool, (r) => r.brand, 'Unspecified')
  const bySize = groupBy(pool, (r) => r.size, 'Unspecified')
  const bySite = groupBy(pool, (r) => r.site, 'Unassigned')
  const totalValue = pool.reduce((s, r) => s + num(r.cost_per_tyre), 0)
  return {
    pool,
    totalTyres: pool.length,
    totalValue: Math.round(totalValue * 100) / 100,
    distinctBrands: byBrand.length,
    distinctSizes: bySize.length,
    distinctSites: bySite.length,
    byBrand,
    bySize,
    bySite,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Hot-spare POOL MANAGER helpers (V209). These operate on managed `tyre_pool`
// entries (a curated hot-spare/buffer inventory with a tracked lifecycle),
// NOT on raw `tyre_records`. Formulas ported verbatim from the original
// tyre_saas Pool Manager so the numbers match one canonical definition and are
// unit-tested in one place. Kept pure and side-effect free.
// ─────────────────────────────────────────────────────────────────────────────

/** The lifecycle status vocabulary for a managed pool entry (matches the DB CHECK). */
export const POOL_ENTRY_STATUSES = ['available', 'reserved', 'deployed', 'maintenance', 'retired']

/** The reasons a tyre may be held in a managed pool (matches the DB CHECK). */
export const POOL_REASONS = [
  'hot_spare', 'seasonal_rotation', 'buffer_stock', 'warranty_replacement', 'retreat_return',
]

/** Round to `dp` decimal places, guarding non-finite input. */
function round(n, dp = 0) {
  const f = 10 ** dp
  return Math.round((Number(n) || 0) * f) / f
}

/**
 * Headline counts + utilisation for a set of managed pool entries. Utilisation
 * is the share of the pool currently deployed to vehicles; the UI flags a value
 * above 80% (pool running thin) in red.
 *
 * @param {Array<{status?:string}>} entries
 * @returns {{ total:number, available:number, deployed:number, maintenance:number,
 *   reserved:number, retired:number, utilisationPct:number }}
 */
export function poolStats(entries) {
  const list = Array.isArray(entries) ? entries : []
  const count = (s) => list.filter((e) => nonEmpty(e?.status) === s).length
  const total = list.length
  const deployed = count('deployed')
  return {
    total,
    available: count('available'),
    deployed,
    maintenance: count('maintenance'),
    reserved: count('reserved'),
    retired: count('retired'),
    utilisationPct: total > 0 ? round((deployed / total) * 100, 1) : 0,
  }
}

/**
 * Available stock grouped by pool location, `[{ location, count }]` sorted by
 * count desc. Only `available` entries count (they are the deployable spares);
 * blank locations collapse into 'Unassigned'.
 *
 * @param {Array<{status?:string, pool_location?:string}>} entries
 * @returns {Array<{location:string, count:number}>}
 */
export function byLocation(entries) {
  const list = Array.isArray(entries) ? entries : []
  const m = new Map()
  for (const e of list) {
    if (nonEmpty(e?.status) !== 'available') continue
    const location = nonEmpty(e?.pool_location) || 'Unassigned'
    m.set(location, (m.get(location) || 0) + 1)
  }
  return [...m.entries()]
    .map(([location, count]) => ({ location, count }))
    .sort((a, b) => b.count - a.count || a.location.localeCompare(b.location))
}

/**
 * Pool replenishment recommendation. Industry rule-of-thumb: a spare pool of
 * ~10% of fleet axles (4 axles/vehicle assumed), with a floor of 4 spares.
 * The `gap` is how many more available spares are needed; the `status` bands
 * it (adequate / low / critical) and `advice` is a ready-to-render sentence.
 *
 * @param {number} activeVehicleCount  count of active vehicles in scope
 * @param {number} availableCount      count of currently-available pool spares
 * @returns {{ recommended:number, gap:number, status:'adequate'|'low'|'critical',
 *   advice:string, current:number }}
 */
export function replenishment(activeVehicleCount, availableCount) {
  const vehicles = Math.max(0, Number(activeVehicleCount) || 0)
  const available = Math.max(0, Number(availableCount) || 0)
  const recommended = Math.max(4, round(vehicles * 4 * 0.10))
  const gap = Math.max(0, recommended - available)
  const status = gap === 0 ? 'adequate' : gap <= 4 ? 'low' : 'critical'
  const advice = gap === 0
    ? 'Pool is adequately stocked.'
    : `Add ${gap} more ${gap === 1 ? 'tyre' : 'tyres'} to reach the recommended spare level of ${recommended}.`
  return { recommended, gap, status, advice, current: available }
}

/**
 * Map a return-inspection condition to the resulting pool status: a good tyre
 * goes back to available stock, a worn one to maintenance, anything else
 * (damaged / unusable) is retired out of the pool.
 *
 * @param {string} condition  'good' | 'worn' | anything else
 * @returns {'available'|'maintenance'|'retired'}
 */
export function returnConditionToStatus(condition) {
  const c = nonEmpty(condition)?.toLowerCase()
  if (c === 'good') return 'available'
  if (c === 'worn') return 'maintenance'
  return 'retired'
}
