/**
 * tyreDemandForecast - forecast tyre consumption BY SIZE from fitment history.
 *
 * WHAT IT ANSWERS: "how many tyres of each size will I need next month(s)?" It
 * counts tyres actually fitted (issue_date + qty) per size per month, then
 * projects the next N months so procurement can order ahead by size.
 *
 * HONESTY RULES (no fabrication):
 *  - The month axis is CONTIGUOUS and filled with real zeros, so a quiet month
 *    is counted as zero demand, not skipped - the trend reflects reality.
 *  - It is anchored to the LATEST month present in the data (not the clock), so
 *    the result is deterministic and always sits right after the real history.
 *  - Forecast = least-squares trend when there are >= MIN_TREND_MONTHS months of
 *    signal, else a flat recent average. Every projection is floored at 0 and
 *    ROUNDED to whole tyres (you cannot order a fraction). Confidence is stated.
 *  - A size with no history is never invented.
 *
 * Pure: no I/O, no Date.now(). Reuses linearFit (least-squares) from
 * expenseTrends so there is ONE trend-fit implementation in the app.
 */
import { linearFit } from './expenseTrends'

// Months of signal needed before we trust a trend over a flat average.
export const MIN_TREND_MONTHS = 4
// Default look-back window (months of history) and look-ahead horizon.
export const DEFAULT_WINDOW = 12
export const DEFAULT_AHEAD = 3

const monthKey = (d) => {
  const s = String(d || '').slice(0, 7)
  return /^\d{4}-\d{2}$/.test(s) ? s : null
}
const qtyOf = (r) => { const q = Number(r?.qty); return Number.isFinite(q) && q > 0 ? q : 1 }

/**
 * Canonical tyre size for grouping. The same size is often typed both spaced and
 * unspaced ("315/80 R 22.5" vs "315/80R22.5"); collapsing whitespace + uppercasing
 * merges them so demand for one size is not split across two rows. Genuinely
 * different sizes stay different. Blank -> 'Unknown'.
 */
export function normSize(v) {
  const s = String(v ?? '').replace(/\s+/g, '').toUpperCase().trim()
  return s || 'UNKNOWN'
}
const sizeOf = (r) => normSize(r?.size)

/** 'YYYY-MM' -> next month 'YYYY-MM' (rolls the year at December). */
export function nextMonthKey(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''))
  if (!m) return null
  let y = Number(m[1]); let mo = Number(m[2]) + 1
  if (mo > 12) { mo = 1; y += 1 }
  return `${y}-${String(mo).padStart(2, '0')}`
}

/** Inclusive contiguous month list from `startKey` to `endKey`. */
export function monthRange(startKey, endKey) {
  if (!startKey || !endKey || startKey > endKey) return []
  const out = []
  let k = startKey
  // Bounded to a decade of months to guarantee termination on bad input.
  for (let i = 0; i < 240 && k && k <= endKey; i++) { out.push(k); k = nextMonthKey(k) }
  return out
}

/** 'YYYY-MM' -> 'Mon YY' (e.g. 2026-07 -> Jul 26). Passthrough on bad input. */
export function monthShort(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''))
  if (!m) return String(key ?? '')
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[Number(m[2]) - 1]} ${m[1].slice(2)}`
}

/**
 * Forecast tyre demand by size.
 * @param {Array} rows  tyre records ({ size, qty, issue_date })
 * @param {object} [opt]
 * @param {number} [opt.ahead=DEFAULT_AHEAD]   months to project
 * @param {number} [opt.window=DEFAULT_WINDOW] months of history to fit over
 * @returns {{
 *   months:string[], monthLabels:string[],
 *   forecastMonths:string[], forecastLabels:string[],
 *   sizes:Array<{ size, history:number[], total:number, avgPerMonth:number,
 *                 slopePerMonth:number, forecast:number[], forecastTotal:number,
 *                 confidence:'high'|'medium'|'low'|'none', method:'trend'|'average'|'none' }>,
 *   totals:{ history:number[], forecast:number[], forecastTotal:number }
 * }}
 */
export function forecastTyreDemand(rows = [], opt = {}) {
  const ahead = Math.max(1, Math.min(12, Number(opt.ahead) || DEFAULT_AHEAD))
  const window = Math.max(3, Math.min(36, Number(opt.window) || DEFAULT_WINDOW))
  const EMPTY = {
    months: [], monthLabels: [], forecastMonths: [], forecastLabels: [],
    sizes: [], totals: { history: [], forecast: [], forecastTotal: 0 },
  }
  if (!Array.isArray(rows) || !rows.length) return EMPTY

  // size -> (month -> qty), tracking the latest month seen overall.
  const bySize = new Map()
  let maxKey = null
  for (const r of rows) {
    const mk = monthKey(r?.issue_date)
    if (!mk) continue
    if (!maxKey || mk > maxKey) maxKey = mk
    const s = sizeOf(r)
    let mm = bySize.get(s)
    if (!mm) { mm = new Map(); bySize.set(s, mm) }
    mm.set(mk, (mm.get(mk) || 0) + qtyOf(r))
  }
  if (!maxKey) return EMPTY

  // Contiguous window ending at the latest data month.
  let startKey = maxKey
  for (let i = 1; i < window; i++) { const p = prevMonthKey(startKey); if (!p) break; startKey = p }
  const months = monthRange(startKey, maxKey)
  const monthLabels = months.map(monthShort)

  const forecastMonths = []
  let fk = maxKey
  for (let a = 0; a < ahead; a++) { fk = nextMonthKey(fk); if (!fk) break; forecastMonths.push(fk) }
  const forecastLabels = forecastMonths.map(monthShort)

  const sizes = []
  for (const [size, mm] of bySize.entries()) {
    const history = months.map((k) => mm.get(k) || 0)
    const total = history.reduce((a, b) => a + b, 0)
    const nonZero = history.filter((v) => v > 0).length
    const avgPerMonth = months.length ? total / months.length : 0
    // Average of the most recent up-to-3 months for the flat fallback.
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

    sizes.push({
      size, history, total, avgPerMonth,
      slopePerMonth: fit ? fit.slope : 0,
      forecast, forecastTotal, confidence, method,
    })
  }
  sizes.sort((a, b) => b.forecastTotal - a.forecastTotal || b.total - a.total)

  const totalsHistory = months.map((_, i) => sizes.reduce((a, s) => a + (s.history[i] || 0), 0))
  const totalsForecast = forecastMonths.map((_, a) => sizes.reduce((s2, s) => s2 + (s.forecast[a] || 0), 0))
  return {
    months, monthLabels, forecastMonths, forecastLabels, sizes,
    totals: { history: totalsHistory, forecast: totalsForecast, forecastTotal: totalsForecast.reduce((a, b) => a + b, 0) },
  }
}

/** 'YYYY-MM' -> previous month 'YYYY-MM'. */
export function prevMonthKey(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''))
  if (!m) return null
  let y = Number(m[1]); let mo = Number(m[2]) - 1
  if (mo < 1) { mo = 12; y -= 1 }
  return `${y}-${String(mo).padStart(2, '0')}`
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
  }))
}
