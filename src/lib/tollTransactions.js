/**
 * Toll Transactions — pure, dependency-free domain logic for the Toll
 * Transactions module (/toll-transactions). Reduces a set of toll charges into a
 * finance-level KPI summary plus per-asset and per-plaza cost roll-ups.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/tollTransactions.js`) and page
 * (`src/pages/TollTransactions.jsx`) both build on these primitives so the
 * roll-up logic lives in exactly one place.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Summarise a set of toll charges for the KPI header:
 *   • totalTransactions — number of rows
 *   • totalAmount       — sum of all charge amounts
 *   • distinctAssets    — count of distinct asset numbers
 *   • disputedCount     — number of rows with status === 'disputed'
 *   • disputedAmount    — sum of amounts for disputed rows
 *   • avgAmount         — mean charge amount (0 when no rows)
 *
 * @param {Array<object>} rows
 * @returns {{ totalTransactions:number, totalAmount:number, distinctAssets:number,
 *             disputedCount:number, disputedAmount:number, avgAmount:number }}
 */
export function summariseTolls(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const assets = new Set()
  let totalAmount = 0
  let disputedCount = 0
  let disputedAmount = 0

  for (const r of list) {
    const asset = r?.asset_no != null ? String(r.asset_no).trim() : ''
    if (asset) assets.add(asset)
    const amount = toFiniteNumber(r?.amount) ?? 0
    totalAmount += amount
    if (String(r?.status || '').trim().toLowerCase() === 'disputed') {
      disputedCount += 1
      disputedAmount += amount
    }
  }

  const totalTransactions = list.length
  return {
    totalTransactions,
    totalAmount,
    distinctAssets: assets.size,
    disputedCount,
    disputedAmount,
    avgAmount: totalTransactions > 0 ? totalAmount / totalTransactions : 0,
  }
}

/**
 * Cost roll-up per asset: for each distinct `asset_no`, the number of charges
 * and the summed amount. Rows without an asset number are ignored. Returned
 * sorted by amount descending (count descending as a tiebreaker for determinism).
 *
 * @param {Array<object>} rows
 * @returns {Array<{ asset_no:string, count:number, amount:number }>}
 */
export function byAsset(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const m = new Map()
  for (const r of list) {
    const asset = r?.asset_no != null ? String(r.asset_no).trim() : ''
    if (!asset) continue
    const prev = m.get(asset) || { asset_no: asset, count: 0, amount: 0 }
    prev.count += 1
    prev.amount += toFiniteNumber(r?.amount) ?? 0
    m.set(asset, prev)
  }
  return [...m.values()].sort(
    (a, b) => b.amount - a.amount || b.count - a.count || a.asset_no.localeCompare(b.asset_no),
  )
}

/**
 * Cost roll-up per toll plaza: for each distinct `plaza_name`, the number of
 * charges and the summed amount. Rows without a plaza name are ignored.
 * Returned sorted by amount descending (count descending as a tiebreaker).
 *
 * @param {Array<object>} rows
 * @returns {Array<{ plaza:string, count:number, amount:number }>}
 */
export function byPlaza(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const m = new Map()
  for (const r of list) {
    const plaza = r?.plaza_name != null ? String(r.plaza_name).trim() : ''
    if (!plaza) continue
    const prev = m.get(plaza) || { plaza, count: 0, amount: 0 }
    prev.count += 1
    prev.amount += toFiniteNumber(r?.amount) ?? 0
    m.set(plaza, prev)
  }
  return [...m.values()].sort(
    (a, b) => b.amount - a.amount || b.count - a.count || a.plaza.localeCompare(b.plaza),
  )
}
