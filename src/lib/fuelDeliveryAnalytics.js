/**
 * Pure, dependency-free fuel-delivery ANALYTICS. No Supabase, no React, no I/O -
 * kept unit-testable and reusable across the /fuel-delivery page, its exports and
 * any future reporting. Complements src/lib/fuelDeliveries.js (which owns the
 * headline `summarizeDeliveries` KPI reducer) with the deeper operational
 * intelligence the deepened page needs.
 *
 * Everything is derived from the REAL columns on `fuel_deliveries` (V148):
 * delivery_no, supplier, site, tank, litres, unit_price, total_cost,
 * delivered_at (date), status (ordered|delivered|cancelled), notes. Metrics
 * degrade honestly (0 / null / []) when the data cannot support them. NOTHING is
 * fabricated.
 *
 * Cost / litre semantics: CANCELLED deliveries never physically happened, so they
 * are excluded from every litres / cost / price metric, breakdown and trend. They
 * are still counted in the raw record count so the table and tiles agree.
 */

export const STATUSES = ['ordered', 'delivered', 'cancelled']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Coerce a possibly-string/null numeric field to a finite number (else 0). */
export function num(v) {
  if (v === '' || v == null) return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** Finite number or null (preserves "not provided" vs "zero"). */
function numOrNull(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Trimmed string or '' (never null). */
const str = (v) => (v == null ? '' : String(v).trim())

/** Round to n decimals, safe. */
const round = (v, n = 2) => {
  const f = 10 ** n
  return Math.round((Number(v) || 0) * f) / f
}

/** A delivery that physically happened (excludes cancelled). */
export function isCounted(row) {
  return str(row?.status).toLowerCase() !== 'cancelled'
}

/** Parse delivered_at (date) to epoch ms, or null when unparseable. */
export function deliveryTime(row) {
  const raw = row?.delivered_at || row?.created_at
  if (!raw) return null
  const s = String(raw)
  const t = Date.parse(s.length <= 10 ? `${s.slice(0, 10)}T00:00:00Z` : s)
  return Number.isFinite(t) ? t : null
}

/**
 * Effective price per litre for a row. Prefers the realized blended rate
 * (total_cost / litres) and falls back to the recorded unit_price. Returns null
 * when neither can be derived.
 */
export function pricePerLitre(row) {
  const litres = numOrNull(row?.litres)
  const cost = numOrNull(row?.total_cost)
  if (litres != null && litres > 0 && cost != null) return cost / litres
  const unit = numOrNull(row?.unit_price)
  return unit != null ? unit : null
}

/**
 * Group counted deliveries by a string key (site / supplier). Rows with an empty
 * key are bucketed under `emptyLabel`. Sorted by cost desc then litres desc.
 * @returns {Array<{key, litres, cost, deliveries, avgPrice}>}
 */
export function groupByKey(rows = [], key = 'site', emptyLabel = 'Unspecified') {
  const map = new Map()
  for (const r of rows) {
    if (!isCounted(r)) continue
    const k = str(r?.[key]) || emptyLabel
    const cur = map.get(k) || { key: k, litres: 0, cost: 0, deliveries: 0 }
    cur.litres += num(r?.litres)
    cur.cost += num(r?.total_cost)
    cur.deliveries += 1
    map.set(k, cur)
  }
  return [...map.values()]
    .map((g) => ({
      ...g,
      litres: round(g.litres),
      cost: round(g.cost),
      avgPrice: g.litres > 0 ? round(g.cost / g.litres, 3) : null,
    }))
    .sort((a, b) => b.cost - a.cost || b.litres - a.litres)
}

/**
 * Monthly trend over the trailing `months` window ending at `now`. Each bucket
 * carries litres, cost, deliveries and the blended avg price/litre (null when no
 * litres in that month).
 * @returns {Array<{key, label, litres, cost, deliveries, avgPrice}>}
 */
export function monthlyTrend(rows = [], months = 12, now = new Date()) {
  const anchor = now instanceof Date ? now : new Date(now)
  const buckets = []
  const index = new Map()
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - i, 1))
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    const b = { key, label: `${MONTHS_SHORT[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`, litres: 0, cost: 0, deliveries: 0 }
    buckets.push(b)
    index.set(key, b)
  }
  for (const r of rows) {
    if (!isCounted(r)) continue
    const t = deliveryTime(r)
    if (t == null) continue
    const d = new Date(t)
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
    const b = index.get(key)
    if (!b) continue
    b.litres += num(r?.litres)
    b.cost += num(r?.total_cost)
    b.deliveries += 1
  }
  return buckets.map((b) => ({
    ...b,
    litres: round(b.litres),
    cost: round(b.cost),
    avgPrice: b.litres > 0 ? round(b.cost / b.litres, 3) : null,
  }))
}

/**
 * Price trend across the monthly buckets: compares the most recent month that
 * has a blended price to the previous month that has one.
 * @returns {{ current:number|null, previous:number|null, changePct:number|null, direction:'up'|'down'|'flat'|'na' }}
 */
export function priceTrend(monthly = []) {
  const withPrice = monthly.filter((b) => b.avgPrice != null && b.litres > 0)
  if (withPrice.length < 1) return { current: null, previous: null, changePct: null, direction: 'na' }
  const current = withPrice[withPrice.length - 1].avgPrice
  if (withPrice.length < 2) return { current, previous: null, changePct: null, direction: 'na' }
  const previous = withPrice[withPrice.length - 2].avgPrice
  if (previous === 0) return { current, previous, changePct: null, direction: 'na' }
  const changePct = round(((current - previous) / previous) * 100, 1)
  const direction = Math.abs(changePct) < 0.05 ? 'flat' : changePct > 0 ? 'up' : 'down'
  return { current, previous, changePct, direction }
}

/** Blended-price statistics across counted rows that carry a derivable price. */
export function priceStats(rows = []) {
  const prices = []
  for (const r of rows) {
    if (!isCounted(r)) continue
    const p = pricePerLitre(r)
    if (p != null && p > 0) prices.push(p)
  }
  if (!prices.length) return { count: 0, mean: null, min: null, max: null, stdDev: null }
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length
  const variance = prices.reduce((a, b) => a + (b - mean) ** 2, 0) / prices.length
  return {
    count: prices.length,
    mean: round(mean, 3),
    min: round(Math.min(...prices), 3),
    max: round(Math.max(...prices), 3),
    stdDev: round(Math.sqrt(variance), 4),
  }
}

/**
 * Derivable data-quality / price anomalies (nothing inferred beyond the numbers):
 *  - price_outlier : blended price deviates > 2 std-dev from the fleet mean
 *                    (only when >= 4 priced rows, and always flags a >40% swing).
 *  - cost_mismatch : total_cost differs from litres x unit_price by > 5%.
 *  - missing_cost  : counted delivery has litres but no cost and no unit price.
 *  - missing_litres: counted delivery has a cost but no litres (no CPK basis).
 * @returns {Array<{id, delivery_no, supplier, site, type, severity, message, pricePerLitre}>}
 */
export function detectAnomalies(rows = []) {
  const stats = priceStats(rows)
  const out = []
  for (const r of rows) {
    if (!isCounted(r)) continue
    const litres = numOrNull(r?.litres)
    const unit = numOrNull(r?.unit_price)
    const cost = numOrNull(r?.total_cost)
    const ppl = pricePerLitre(r)
    const base = {
      id: r?.id, delivery_no: str(r?.delivery_no), supplier: str(r?.supplier),
      site: str(r?.site), pricePerLitre: ppl == null ? null : round(ppl, 3),
    }

    // Missing cost basis
    if (litres != null && litres > 0 && cost == null && unit == null) {
      out.push({ ...base, type: 'missing_cost', severity: 'warn', message: 'Litres recorded but no cost or unit price.' })
      continue
    }
    if (cost != null && cost > 0 && (litres == null || litres <= 0)) {
      out.push({ ...base, type: 'missing_litres', severity: 'warn', message: 'Cost recorded but no litres - no price per litre basis.' })
      continue
    }
    // total_cost vs litres x unit_price
    if (cost != null && litres != null && unit != null && litres > 0 && unit > 0) {
      const expected = litres * unit
      const diffPct = expected > 0 ? Math.abs(cost - expected) / expected : 0
      if (diffPct > 0.05) {
        out.push({
          ...base, type: 'cost_mismatch', severity: 'warn',
          message: `Total cost is ${round(diffPct * 100, 1)}% off litres x unit price.`,
        })
        continue
      }
    }
    // Price outlier vs fleet mean
    if (ppl != null && ppl > 0 && stats.mean != null) {
      const devFrac = stats.mean > 0 ? Math.abs(ppl - stats.mean) / stats.mean : 0
      const zHit = stats.count >= 4 && stats.stdDev != null && stats.stdDev > 0 && Math.abs(ppl - stats.mean) > 2 * stats.stdDev
      if (zHit || devFrac > 0.4) {
        out.push({
          ...base, type: 'price_outlier', severity: 'high',
          message: `Price/L ${round(ppl, 3)} vs fleet avg ${stats.mean} (${round(devFrac * 100, 0)}% off).`,
        })
      }
    }
  }
  // High severity first, then by |deviation|-driven ordering (outliers before quality flags)
  const rank = { high: 0, warn: 1 }
  return out.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9))
}

/** Distinct non-empty values of a column, sorted. */
export function distinctValues(rows = [], key) {
  return [...new Set(rows.map((r) => str(r?.[key])).filter(Boolean))].sort((a, b) => a.localeCompare(b))
}

/**
 * Filter deliveries by status / site / supplier / date-range / free-text search.
 * `from` / `to` are 'YYYY-MM-DD' strings (inclusive) matched on delivered_at.
 */
export function filterDeliveries(rows = [], { status, site, supplier, from, to, search } = {}) {
  const q = str(search).toLowerCase()
  const fromT = from ? Date.parse(`${from}T00:00:00Z`) : null
  const toT = to ? Date.parse(`${to}T23:59:59Z`) : null
  return rows.filter((r) => {
    if (status && status !== 'all' && str(r?.status).toLowerCase() !== status) return false
    if (site && str(r?.site) !== site) return false
    if (supplier && str(r?.supplier) !== supplier) return false
    if (fromT != null || toT != null) {
      const t = deliveryTime(r)
      if (t == null) return false
      if (fromT != null && t < fromT) return false
      if (toT != null && t > toT) return false
    }
    if (q) {
      const hay = `${str(r?.delivery_no)} ${str(r?.supplier)} ${str(r?.site)} ${str(r?.tank)} ${str(r?.notes)}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/**
 * Full analytics bundle for a set of delivery rows. Single call powering the
 * page's KPI tiles, charts, anomaly panel and exports.
 *
 * @param {Array<object>} rows
 * @param {{ months?:number, now?:Date, topN?:number }} [opts]
 */
export function analyzeDeliveries(rows = [], { months = 12, now = new Date(), topN = 8 } = {}) {
  const list = Array.isArray(rows) ? rows : []
  const counted = list.filter(isCounted)

  let totalLitres = 0
  let totalCost = 0
  let costedLitres = 0 // litres that also carry a cost, for a clean blended rate
  let withPrice = 0
  for (const r of counted) {
    const l = num(r?.litres)
    const c = num(r?.total_cost)
    totalLitres += l
    totalCost += c
    if (l > 0 && c > 0) costedLitres += l
    if (pricePerLitre(r) != null) withPrice += 1
  }

  const statusCounts = STATUSES.reduce((acc, s) => {
    acc[s] = list.filter((r) => str(r?.status).toLowerCase() === s).length
    return acc
  }, {})

  const bySite = groupByKey(counted, 'site')
  const bySupplier = groupByKey(counted, 'supplier')
  const monthly = monthlyTrend(counted, months, now)
  const stats = priceStats(counted)
  const anomalies = detectAnomalies(counted)

  const avgPricePerLitre = totalLitres > 0 ? round(totalCost / totalLitres, 3) : null
  const avgDeliverySize = counted.length > 0 ? round(totalLitres / counted.length, 1) : null
  const avgDeliveryCost = counted.length > 0 ? round(totalCost / counted.length, 2) : null

  return {
    totalDeliveries: list.length,
    countedDeliveries: counted.length,
    cancelledDeliveries: statusCounts.cancelled || 0,
    orderedDeliveries: statusCounts.ordered || 0,
    totalLitres: round(totalLitres),
    totalCost: round(totalCost),
    avgPricePerLitre,
    avgDeliverySize,
    avgDeliveryCost,
    priceCoveragePct: counted.length > 0 ? round((withPrice / counted.length) * 100, 0) : null,
    statusCounts,
    priceStats: stats,
    priceTrend: priceTrend(monthly),
    monthly,
    bySite: bySite.slice(0, topN),
    bySupplier: bySupplier.slice(0, topN),
    siteCount: bySite.length,
    supplierCount: bySupplier.length,
    topSupplier: bySupplier[0] || null,
    topSite: bySite[0] || null,
    anomalies,
    anomalyCount: anomalies.length,
    _internal: { costedLitres: round(costedLitres) },
  }
}

// ─── Register / honesty helpers for the page ──────────────────────────────────

export const ANOMALY_LABELS = {
  price_outlier: 'Price outlier',
  cost_mismatch: 'Cost mismatch',
  missing_cost: 'Missing cost',
  missing_litres: 'Missing litres',
}

/** Distinct countries present on the rows (fuel_deliveries has no currency column). */
export function countriesIn(rows = []) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => str(r?.country)).filter(Boolean))].sort()
}

/**
 * Money figures that never pretend. `analyzeDeliveries().totalCost` adds 0 for
 * an uncosted delivery and divides by EVERY litre, so a half-costed log reads
 * as cheap fuel. This returns:
 *   - totalCost: sum over deliveries that carry a cost, or null when none do
 *   - blendedPrice: cost / litres over deliveries carrying BOTH (null otherwise)
 *   - costedCount / uncostedCount over counted (non-cancelled) deliveries
 *   - mixedCurrency: rows span >1 country, so money must not be totalled
 */
export function costBasis(rows = []) {
  const counted = (Array.isArray(rows) ? rows : []).filter(isCounted)
  let cost = 0
  let costed = 0
  let pairCost = 0
  let pairLitres = 0
  for (const r of counted) {
    const c = numOrNull(r?.total_cost)
    const l = numOrNull(r?.litres)
    if (c != null) { cost += c; costed += 1 }
    if (c != null && l != null && l > 0) { pairCost += c; pairLitres += l }
  }
  const mixedCurrency = countriesIn(counted).length > 1
  return {
    totalCost: costed && !mixedCurrency ? round(cost) : null,
    blendedPrice: pairLitres > 0 && !mixedCurrency ? round(pairCost / pairLitres, 3) : null,
    costedCount: costed,
    uncostedCount: counted.length - costed,
    mixedCurrency,
  }
}

/** Status tally over every row, in lifecycle order. */
export function statusBreakdown(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  return STATUSES.map((s) => ({ key: s, count: list.filter((r) => str(r?.status).toLowerCase() === s).length }))
}

/** Rows ready for the register: parsed numbers, price per litre, anomaly type. */
export function deliveryRegisterRows(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  const flags = new Map(detectAnomalies(list).map((a) => [a.id, a.type]))
  return list.map((r) => {
    const t = deliveryTime(r)
    const ppl = pricePerLitre(r)
    return {
      ...r,
      litresValue: numOrNull(r?.litres),
      unitValue: numOrNull(r?.unit_price),
      costValue: numOrNull(r?.total_cost),
      pplValue: ppl == null ? null : round(ppl, 3),
      deliveredTime: t,
      anomaly: flags.get(r?.id) || null,
    }
  })
}

export const DELIVERY_EXPORT_COLUMNS = [
  { key: 'delivery_no', header: 'Delivery No' },
  { key: 'supplier', header: 'Supplier' },
  { key: 'site', header: 'Site' },
  { key: 'tank', header: 'Tank' },
  { key: 'litres', header: 'Litres' },
  { key: 'unit_price', header: 'Unit Price' },
  { key: 'total_cost', header: 'Total Cost' },
  { key: 'price_per_litre', header: 'Price per litre' },
  { key: 'delivered_at', header: 'Delivered' },
  { key: 'status', header: 'Status' },
  { key: 'flag', header: 'Flag' },
  { key: 'country', header: 'Country' },
]

const STATUS_LABELS = { ordered: 'Ordered', delivered: 'Delivered', cancelled: 'Cancelled' }

export function deliveryExportRows(rows = []) {
  return deliveryRegisterRows(rows).map((r) => ({
    delivery_no: r.delivery_no || '',
    supplier: r.supplier || '',
    site: r.site || '',
    tank: r.tank || '',
    litres: r.litresValue ?? '',
    unit_price: r.unitValue ?? '',
    total_cost: r.costValue ?? '',
    price_per_litre: r.pplValue ?? '',
    delivered_at: r.delivered_at ? String(r.delivered_at).slice(0, 10) : '',
    status: STATUS_LABELS[str(r.status).toLowerCase()] || r.status || '',
    flag: r.anomaly ? ANOMALY_LABELS[r.anomaly] || r.anomaly : '',
    country: r.country || '',
  }))
}
