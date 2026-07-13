// ─────────────────────────────────────────────────────────────────────────────
// tyreIntelligence.js - Pure, deterministic tyre-engineering intelligence engine.
//
// Operates over an array of raw `tyre_records` rows and derives the KPIs required
// by the "Automatic Tyre KPI Analysis" standard: CPK, tyre life, removal/failure
// rate, root-cause breakdown, brand/vendor CPK ranking, position intelligence and
// best-effort predictive removals.
//
// Contract:
//   • No I/O, no Date.now(), no randomness  → fully deterministic & unit-testable.
//   • Every numeric guard rejects null/undefined/NaN and never divides by zero.
//   • Functions accept possibly-dirty rows (mixed string/number fields from ERP
//     imports) and coerce defensively via toFiniteNumber.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Coerce an arbitrary value to a finite number, or return null.
 * Accepts numbers and numeric strings (stripping thousands separators / currency
 * noise). Anything non-finite → null so callers can guard cleanly.
 * @param {*} v
 * @returns {number|null}
 */
export function toFiniteNumber(v) {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return null
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/**
 * Kilometres of service life for a single record.
 * Preference order:
 *   1. km_at_removal − km_at_fitment  (when both present and the delta > 0)
 *   2. total_km                        (when present and > 0)
 *   3. null                            (life unknown)
 * @param {object} r
 * @returns {number|null}
 */
export function lifeKm(r) {
  if (!r) return null
  const fit = toFiniteNumber(r.km_at_fitment)
  const rem = toFiniteNumber(r.km_at_removal)
  if (fit != null && rem != null) {
    const delta = rem - fit
    if (delta > 0) return delta
  }
  const total = toFiniteNumber(r.total_km)
  if (total != null && total > 0) return total
  return null
}

/**
 * Cost per kilometre for a single record.
 * @param {object} r
 * @returns {number|null} cost_per_tyre / lifeKm, or null when life unknown/zero.
 */
export function cpk(r) {
  if (!r) return null
  const cost = toFiniteNumber(r.cost_per_tyre)
  if (cost == null) return null
  const life = lifeKm(r)
  if (life == null || life <= 0) return null
  return cost / life
}

const REMOVED_STATUS = new Set([
  'removed', 'scrapped', 'scrap', 'disposed', 'retired', 'failed', 'replaced', 'discarded',
])

/**
 * Whether a record represents a removed / scrapped tyre.
 * True when the status indicates removal OR a removal_date / removal reason is set.
 * @param {object} r
 * @returns {boolean}
 */
export function isRemoved(r) {
  if (!r) return false
  const status = typeof r.status === 'string' ? r.status.trim().toLowerCase() : ''
  if (status && REMOVED_STATUS.has(status)) return true
  if (r.removal_date != null && String(r.removal_date).trim() !== '') return true
  const reason = r.reason_for_removal ?? r.removal_reason
  if (reason != null && String(reason).trim() !== '') return true
  return false
}

function safeMean(values) {
  if (!values.length) return null
  return values.reduce((s, v) => s + v, 0) / values.length
}

/**
 * Fleet-level intelligence summary over a set of rows.
 * @param {object[]} rows
 * @returns {{
 *   totalTyres:number, removedCount:number, removalRate:number,
 *   avgLifeKm:number|null, fleetAvgCpk:number|null,
 *   avgTreadDepth:number|null, criticalCount:number
 * }}
 */
export function summariseIntelligence(rows) {
  const list = Array.isArray(rows) ? rows : []
  const totalTyres = list.length

  let removedCount = 0
  let criticalCount = 0
  let totalCost = 0
  let totalKnownLifeKm = 0
  const lifeSamples = []
  const treadSamples = []

  for (const r of list) {
    if (isRemoved(r)) removedCount++

    const risk = typeof r.risk_level === 'string' ? r.risk_level.trim().toLowerCase() : ''
    if (risk === 'critical' || risk === 'high') criticalCount++

    const life = lifeKm(r)
    if (life != null && life > 0) {
      lifeSamples.push(life)
      const cost = toFiniteNumber(r.cost_per_tyre)
      if (cost != null) {
        totalCost += cost
        totalKnownLifeKm += life
      }
    }

    const tread = toFiniteNumber(r.tread_depth)
    if (tread != null && tread >= 0) treadSamples.push(tread)
  }

  return {
    totalTyres,
    removedCount,
    removalRate: totalTyres > 0 ? (removedCount / totalTyres) * 100 : 0,
    avgLifeKm: safeMean(lifeSamples),
    fleetAvgCpk: totalKnownLifeKm > 0 ? totalCost / totalKnownLifeKm : null,
    avgTreadDepth: safeMean(treadSamples),
    criticalCount,
  }
}

function normaliseLabel(v, fallback) {
  if (v == null) return fallback
  const s = String(v).trim()
  return s === '' ? fallback : s
}

/**
 * Root-cause breakdown from reason_for_removal || removal_reason.
 * @param {object[]} rows
 * @returns {{ reason:string, count:number, pct:number }[]} sorted by count desc.
 */
export function rootCauseBreakdown(rows) {
  const list = Array.isArray(rows) ? rows : []
  const counts = new Map()
  let total = 0
  for (const r of list) {
    const reason = normaliseLabel(r.reason_for_removal ?? r.removal_reason, 'Unspecified')
    counts.set(reason, (counts.get(reason) || 0) + 1)
    total++
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({
      reason,
      count,
      pct: total > 0 ? (count / total) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
}

/**
 * Internal: aggregate CPK + life by an arbitrary key accessor.
 * @param {object[]} rows
 * @param {(r:object)=>string} keyFn
 * @param {string} keyName  output property name ('brand' | 'supplier'…)
 * @param {string} fallback label for blank keys
 */
function aggregateCpk(rows, keyFn, keyName, fallback) {
  const list = Array.isArray(rows) ? rows : []
  const groups = new Map()
  for (const r of list) {
    const key = normaliseLabel(keyFn(r), fallback)
    if (!groups.has(key)) groups.set(key, { tyres: 0, cpks: [], lives: [] })
    const g = groups.get(key)
    g.tyres++
    const c = cpk(r)
    if (c != null) g.cpks.push(c)
    const life = lifeKm(r)
    if (life != null && life > 0) g.lives.push(life)
  }
  return [...groups.entries()].map(([key, g]) => ({
    [keyName]: key,
    tyres: g.tyres,
    avgCpk: safeMean(g.cpks),
    avgLifeKm: safeMean(g.lives),
  }))
}

/** Sort helper: known avgCpk ascending (best first); null CPK sinks to the end. */
function byAvgCpkAsc(a, b) {
  if (a.avgCpk == null && b.avgCpk == null) return b.tyres - a.tyres
  if (a.avgCpk == null) return 1
  if (b.avgCpk == null) return -1
  return a.avgCpk - b.avgCpk
}

/**
 * CPK ranking by brand (best/lowest CPK first).
 * @returns {{ brand:string, tyres:number, avgCpk:number|null, avgLifeKm:number|null }[]}
 */
export function cpkByBrand(rows) {
  return aggregateCpk(rows, r => r.brand, 'brand', 'Unknown').sort(byAvgCpkAsc)
}

/**
 * CPK ranking by vendor/supplier (best/lowest CPK first).
 * @returns {{ supplier:string, tyres:number, avgCpk:number|null, avgLifeKm:number|null }[]}
 */
export function cpkByVendor(rows) {
  return aggregateCpk(rows, r => r.supplier, 'supplier', 'Unknown').sort(byAvgCpkAsc)
}

/**
 * Position-level intelligence from tyre_position || position.
 * @returns {{ position:string, tyres:number, avgLifeKm:number|null,
 *             removalRate:number, avgCpk:number|null }[]} sorted removalRate desc.
 */
export function positionIntelligence(rows) {
  const list = Array.isArray(rows) ? rows : []
  const groups = new Map()
  for (const r of list) {
    const key = normaliseLabel(r.tyre_position ?? r.position, 'Unknown')
    if (!groups.has(key)) groups.set(key, { tyres: 0, removed: 0, cpks: [], lives: [] })
    const g = groups.get(key)
    g.tyres++
    if (isRemoved(r)) g.removed++
    const c = cpk(r)
    if (c != null) g.cpks.push(c)
    const life = lifeKm(r)
    if (life != null && life > 0) g.lives.push(life)
  }
  return [...groups.entries()]
    .map(([position, g]) => ({
      position,
      tyres: g.tyres,
      avgLifeKm: safeMean(g.lives),
      removalRate: g.tyres > 0 ? (g.removed / g.tyres) * 100 : 0,
      avgCpk: safeMean(g.cpks),
    }))
    .sort((a, b) => b.removalRate - a.removalRate || b.tyres - a.tyres)
}

const LOW_TREAD_MM = 4          // regulatory / practical replacement threshold
const LIFE_PROXIMITY_RATIO = 0.9 // within 10% of brand average life → due soon

/**
 * Best-effort predictive removals for tyres still fitted.
 * A tyre is flagged when EITHER:
 *   • tread_depth is present and below LOW_TREAD_MM, OR
 *   • its accumulated life is within 10% of its brand's average life.
 * Honest: if there is no usable signal for a row it is skipped; an empty array is
 * a valid, truthful result.
 *
 * @param {object[]} rows
 * @param {number} nowMs  injected clock (kept for signature stability / future
 *                        date-based projections); no Date.now() used internally.
 * @returns {{ asset_no?:string, brand:string, position:string,
 *             tread_depth:number|null, note:string }[]}
 */
export function predictiveRemovals(rows, nowMs) {
  const list = Array.isArray(rows) ? rows : []

  // Brand average life over the whole set (fitted + removed) for the proximity test.
  const brandLife = new Map()
  for (const r of list) {
    const brand = normaliseLabel(r.brand, 'Unknown')
    const life = lifeKm(r)
    if (life != null && life > 0) {
      if (!brandLife.has(brand)) brandLife.set(brand, [])
      brandLife.get(brand).push(life)
    }
  }
  const brandAvg = new Map()
  for (const [brand, lives] of brandLife.entries()) {
    brandAvg.set(brand, safeMean(lives))
  }

  const out = []
  for (const r of list) {
    if (isRemoved(r)) continue // only tyres still in service

    const brand = normaliseLabel(r.brand, 'Unknown')
    const position = normaliseLabel(r.tyre_position ?? r.position, 'Unknown')
    const tread = toFiniteNumber(r.tread_depth)

    const lowTread = tread != null && tread >= 0 && tread < LOW_TREAD_MM

    let nearEol = false
    const avg = brandAvg.get(brand)
    const life = lifeKm(r)
    if (avg != null && avg > 0 && life != null && life > 0) {
      nearEol = life >= avg * LIFE_PROXIMITY_RATIO
    }

    if (!lowTread && !nearEol) continue

    let note
    if (lowTread && nearEol) note = `Low tread (${tread}mm) and nearing brand-average life`
    else if (lowTread) note = `Tread ${tread}mm below ${LOW_TREAD_MM}mm threshold`
    else note = `Accumulated life within 10% of ${brand} average`

    const entry = { brand, position, tread_depth: tread, note }
    const assetNo = normaliseLabel(r.asset_no, '')
    if (assetNo) entry.asset_no = assetNo
    out.push(entry)
  }
  return out
}
