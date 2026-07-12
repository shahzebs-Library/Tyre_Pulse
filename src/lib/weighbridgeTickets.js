/**
 * Weighbridge Tickets — pure, dependency-free domain logic for the Weighbridge
 * module (/weighbridge). Derives net weight, overload amounts, and a fleet-level
 * KPI summary from a set of weighbridge tickets.
 *
 * Keeping this here (no Supabase, no React) makes it deterministic and
 * unit-tested; the service (`src/lib/api/weighbridgeTickets.js`) and page
 * (`src/pages/Weighbridge.jsx`) both build on these primitives so the weight
 * math lives in exactly one place.
 */

/** Parse a value to a finite number, or null when it isn't numeric. */
export function toFiniteNumber(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Net (payload) weight for a ticket, in kg. Prefers an explicit net_weight_kg;
 * otherwise derives gross − tare when both are numeric. Returns null when it
 * cannot be resolved.
 *
 * @param {object} t
 * @returns {number|null}
 */
export function netWeight(t) {
  const explicit = toFiniteNumber(t?.net_weight_kg)
  if (explicit != null) return explicit
  const gross = toFiniteNumber(t?.gross_weight_kg)
  const tare = toFiniteNumber(t?.tare_weight_kg)
  if (gross != null && tare != null) return gross - tare
  return null
}

/**
 * Overload amount for a ticket, in kg: gross_weight_kg − gross_limit_kg when
 * both are present and the vehicle is over its limit. Returns 0 when within
 * limit or when either value is missing.
 *
 * @param {object} t
 * @returns {number}
 */
export function overloadKg(t) {
  const gross = toFiniteNumber(t?.gross_weight_kg)
  const limit = toFiniteNumber(t?.gross_limit_kg)
  if (gross == null || limit == null) return 0
  const over = gross - limit
  return over > 0 ? over : 0
}

/**
 * True when a ticket exceeds its gross weight limit.
 * @param {object} t
 * @returns {boolean}
 */
export function isOverweight(t) {
  return overloadKg(t) > 0
}

/**
 * Summarise a set of tickets for the KPI header:
 *   • totalTickets    — number of rows
 *   • totalNetKg      — sum of resolved net weight across all rows
 *   • overweightCount — count of rows exceeding their gross limit
 *   • maxOverloadKg   — single largest overload across all rows
 *   • avgNetKg        — average net weight over rows with a resolvable net
 *   • distinctAssets  — count of distinct asset numbers
 *
 * @param {Array<object>} rows
 * @returns {{ totalTickets:number, totalNetKg:number, overweightCount:number,
 *             maxOverloadKg:number, avgNetKg:number, distinctAssets:number }}
 */
export function summariseTickets(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const assets = new Set()
  let totalNetKg = 0
  let netRows = 0
  let overweightCount = 0
  let maxOverloadKg = 0

  for (const t of list) {
    const asset = t?.asset_no != null ? String(t.asset_no).trim() : ''
    if (asset) assets.add(asset)

    const net = netWeight(t)
    if (net != null) { totalNetKg += net; netRows += 1 }

    const over = overloadKg(t)
    if (over > 0) {
      overweightCount += 1
      if (over > maxOverloadKg) maxOverloadKg = over
    }
  }

  return {
    totalTickets: list.length,
    totalNetKg,
    overweightCount,
    maxOverloadKg,
    avgNetKg: netRows > 0 ? totalNetKg / netRows : 0,
    distinctAssets: assets.size,
  }
}
