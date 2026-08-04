/**
 * tyreDemandForecast - forecast tyre consumption BY SIZE from fitment history,
 * with size-spelling correction and a cost view.
 *
 * WHAT IT ANSWERS: "how many tyres of each size will I need next month(s), and
 * what will they cost?" It counts tyres actually fitted (issue_date + qty) per
 * canonical size per month, then projects the next N months so procurement can
 * order ahead by size, and multiplies by the size's average unit cost so you can
 * see the projected spend and where cost data is missing.
 *
 * SIZE CORRECTION (the "misspelling" fix), data-driven and honest:
 *  - Spacing + case are normalized, so "315/80 R 22.5", "315/80R22.5",
 *    "315 /80R22.5", "315/80R 22.5" all become one size (315/80R22.5).
 *  - A bare section width ("315", "385") merges into the ONE full size that
 *    starts with that width when the data has exactly one - never guessed when
 *    ambiguous.
 *  - A dropped-leading-digit typo ("35/70R16") is repaired ONLY when the repair
 *    ("235/70R16") actually exists in the data.
 *  - Junk that is not a real tyre size ("0", "1212", "2416146991", "12*8") is
 *    bucketed as 'UNKNOWN', not treated as a size to order.
 *
 * HONESTY RULES (no fabrication):
 *  - Contiguous month axis filled with real zeros; anchored to the LATEST data
 *    month (deterministic, no clock).
 *  - Forecast = least-squares trend when there are >= MIN_TREND_MONTHS active
 *    months, else a flat recent average. Floored at 0, rounded to whole tyres.
 *  - Cost per tyre is the average of PRICED fitments only; projected spend is
 *    null when a size has no price (shown as a gap, never invented).
 *
 * Pure: no I/O, no Date.now(). Reuses linearFit (least-squares) from
 * expenseTrends so there is ONE trend-fit implementation in the app.
 */
import { linearFit } from './expenseTrends'

export const MIN_TREND_MONTHS = 4
export const DEFAULT_WINDOW = 12
export const DEFAULT_AHEAD = 3

// A real metric tyre size once spacing is stripped: 315/80R22.5, 235/70R16, ...
const METRIC_RE = /^\d{3}\/\d{2}R\d{1,2}(\.\d)?$/
// Bias / simple radial: 11R22.5, 23.5R25, 195R15, 700R16.
const SIMPLE_RE = /^\d{2,3}(\.\d)?R\d{2}(\.\d)?$/
// OTR slash form: 10-16.5/10.
const OTR_RE = /^\d{1,2}-\d{2}(\.\d)?\/\d{1,2}$/
const isValidSize = (s) => METRIC_RE.test(s) || SIMPLE_RE.test(s) || OTR_RE.test(s)

const qtyOf = (r) => { const q = Number(r?.qty); return Number.isFinite(q) && q > 0 ? q : 1 }

/** Normalize spacing + case only (the cheap, always-safe merge). */
export function normSize(v) {
  const s = String(v ?? '').replace(/\s+/g, '').toUpperCase().trim()
  return s || 'UNKNOWN'
}

/**
 * Build a raw-size -> canonical-size resolver from the WHOLE dataset, so bare
 * widths and dropped-digit typos can be resolved against the sizes that really
 * exist. Returns a function resolve(rawSize) -> canonical.
 */
export function buildSizeCanonicalizer(rawSizes = []) {
  const valid = new Set()
  for (const raw of rawSizes) {
    const n = normSize(raw)
    if (isValidSize(n)) valid.add(n)
  }
  // width ("315") -> the set of valid metric sizes with that width.
  const byWidth = new Map()
  for (const s of valid) {
    const m = /^(\d{3})\//.exec(s)
    if (!m) continue
    if (!byWidth.has(m[1])) byWidth.set(m[1], new Set())
    byWidth.get(m[1]).add(s)
  }
  return (raw) => {
    const n = normSize(raw)
    if (n === 'UNKNOWN') return 'UNKNOWN'
    if (isValidSize(n)) return n
    // Bare section width, e.g. "315" or "385": merge only when unambiguous.
    if (/^\d{2,3}$/.test(n)) {
      const set = byWidth.get(n)
      if (set && set.size === 1) return [...set][0]
      return 'UNKNOWN'
    }
    // Dropped leading digit, e.g. "35/70R16" -> try 1/2/3 + n, keep it only if
    // that full size actually exists in the data.
    if (/^\d{2}\/\d{2}R\d{2}(\.\d)?$/.test(n)) {
      for (const d of ['2', '1', '3']) { const cand = d + n; if (valid.has(cand)) return cand }
    }
    return 'UNKNOWN'
  }
}

const monthKey = (d) => {
  const s = String(d || '').slice(0, 7)
  return /^\d{4}-\d{2}$/.test(s) ? s : null
}

/** 'YYYY-MM' -> next month, rolling the year at December. */
export function nextMonthKey(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''))
  if (!m) return null
  let y = Number(m[1]); let mo = Number(m[2]) + 1
  if (mo > 12) { mo = 1; y += 1 }
  return `${y}-${String(mo).padStart(2, '0')}`
}
/** 'YYYY-MM' -> previous month, rolling the year at January. */
export function prevMonthKey(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''))
  if (!m) return null
  let y = Number(m[1]); let mo = Number(m[2]) - 1
  if (mo < 1) { mo = 12; y -= 1 }
  return `${y}-${String(mo).padStart(2, '0')}`
}
/** Inclusive contiguous month list. */
export function monthRange(startKey, endKey) {
  if (!startKey || !endKey || startKey > endKey) return []
  const out = []; let k = startKey
  for (let i = 0; i < 240 && k && k <= endKey; i++) { out.push(k); k = nextMonthKey(k) }
  return out
}
/** 'YYYY-MM' -> 'Mon YY'. Passthrough on bad input. */
export function monthShort(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''))
  if (!m) return String(key ?? '')
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[Number(m[2]) - 1]} ${m[1].slice(2)}`
}

/**
 * Forecast tyre demand by canonical size (+ cost).
 * @param {Array} rows  tyre records ({ size, qty, issue_date, cost_per_tyre })
 * @param {object} [opt]  { ahead, window }
 */
export function forecastTyreDemand(rows = [], opt = {}) {
  const ahead = Math.max(1, Math.min(12, Number(opt.ahead) || DEFAULT_AHEAD))
  const window = Math.max(3, Math.min(36, Number(opt.window) || DEFAULT_WINDOW))
  const EMPTY = {
    months: [], monthLabels: [], forecastMonths: [], forecastLabels: [],
    sizes: [], totals: { history: [], forecast: [], forecastTotal: 0, projectedSpend: null },
  }
  if (!Array.isArray(rows) || !rows.length) return EMPTY

  const canon = buildSizeCanonicalizer(rows.map((r) => r?.size))
  // size -> { months: Map(month->qty), pricedQty, costSum }, tracking latest month.
  const bySize = new Map()
  let maxKey = null
  for (const r of rows) {
    const mk = monthKey(r?.issue_date)
    if (!mk) continue
    if (!maxKey || mk > maxKey) maxKey = mk
    const s = canon(r?.size)
    let e = bySize.get(s)
    if (!e) { e = { months: new Map(), pricedQty: 0, costSum: 0 }; bySize.set(s, e) }
    const q = qtyOf(r)
    e.months.set(mk, (e.months.get(mk) || 0) + q)
    const unit = Number(r?.cost_per_tyre)
    if (Number.isFinite(unit) && unit > 0) { e.pricedQty += q; e.costSum += unit * q }
  }
  if (!maxKey) return EMPTY

  let startKey = maxKey
  for (let i = 1; i < window; i++) { const p = prevMonthKey(startKey); if (!p) break; startKey = p }
  const months = monthRange(startKey, maxKey)
  const monthLabels = months.map(monthShort)

  const forecastMonths = []
  let fk = maxKey
  for (let a = 0; a < ahead; a++) { fk = nextMonthKey(fk); if (!fk) break; forecastMonths.push(fk) }
  const forecastLabels = forecastMonths.map(monthShort)

  const sizes = []
  for (const [size, e] of bySize.entries()) {
    const history = months.map((k) => e.months.get(k) || 0)
    const total = history.reduce((a, b) => a + b, 0)
    const nonZero = history.filter((v) => v > 0).length
    const avgPerMonth = months.length ? total / months.length : 0
    const recent = history.slice(-3)
    const recentAvg = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : avgPerMonth

    const fit = nonZero >= MIN_TREND_MONTHS ? linearFit(history) : null
    const method = fit ? 'trend' : (total > 0 ? 'average' : 'none')
    const forecast = forecastMonths.map((_, a) => {
      const idx = history.length + a
      const v = fit ? fit.predict(idx) : recentAvg
      return Math.max(0, Math.round(Number.isFinite(v) ? v : 0))
    })
    const forecastTotal = forecast.reduce((a, b) => a + b, 0)
    const confidence = nonZero >= MIN_TREND_MONTHS ? (nonZero >= 8 ? 'high' : 'medium')
      : (nonZero >= 1 ? 'low' : 'none')

    const avgUnitCost = e.pricedQty > 0 ? e.costSum / e.pricedQty : null
    const pricedPct = total > 0 ? Math.round((e.pricedQty / total) * 100) : null
    const projectedSpend = avgUnitCost != null ? avgUnitCost * forecastTotal : null

    sizes.push({
      size, history, total, avgPerMonth,
      slopePerMonth: fit ? fit.slope : 0,
      forecast, forecastTotal, confidence, method,
      avgUnitCost, pricedQty: e.pricedQty, pricedPct, projectedSpend,
    })
  }
  sizes.sort((a, b) => b.forecastTotal - a.forecastTotal || b.total - a.total)

  const totalsHistory = months.map((_, i) => sizes.reduce((a, s) => a + (s.history[i] || 0), 0))
  const totalsForecast = forecastMonths.map((_, a) => sizes.reduce((s2, s) => s2 + (s.forecast[a] || 0), 0))
  const spendVals = sizes.map((s) => s.projectedSpend).filter((v) => v != null)
  return {
    months, monthLabels, forecastMonths, forecastLabels, sizes,
    totals: {
      history: totalsHistory,
      forecast: totalsForecast,
      forecastTotal: totalsForecast.reduce((a, b) => a + b, 0),
      projectedSpend: spendVals.length ? spendVals.reduce((a, b) => a + b, 0) : null,
    },
  }
}

/** Rows for a numbers table / Excel export: one line per size. */
export function forecastTableRows(fc) {
  if (!fc || !Array.isArray(fc.sizes)) return []
  return fc.sizes.map((s) => ({
    size: s.size,
    total: s.total,
    avgPerMonth: Math.round(s.avgPerMonth * 10) / 10,
    trend: s.method === 'trend' ? (s.slopePerMonth > 0.05 ? 'Rising' : s.slopePerMonth < -0.05 ? 'Falling' : 'Flat') : 'Flat (avg)',
    forecast: s.forecast,
    forecastTotal: s.forecastTotal,
    confidence: s.confidence,
    avgUnitCost: s.avgUnitCost,
    pricedPct: s.pricedPct,
    projectedSpend: s.projectedSpend,
  }))
}
