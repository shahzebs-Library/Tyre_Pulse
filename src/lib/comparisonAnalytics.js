/**
 * Period Comparison analytics - pure engine behind /comparison.
 *
 * Compares two period selections (a year plus chosen months) of tyre_records,
 * overall by month or broken down by site / brand, on replacement count or
 * tyre cost (cost via analyticsEngine.recordCost = cost_per_tyre x qty, the
 * same maths used across the app).
 *
 * Honesty rules, each a defect in the inline version this replaces:
 *  - A percentage change from a zero base is undefined. The old helper printed
 *    +100% for "nothing then something" and 0% for "nothing then nothing".
 *    `pct` is now null and the row is classified New / Stopped / Flat instead.
 *  - Records with no site / brand were silently dropped from a breakdown, so
 *    the breakdown total disagreed with the Overall total. They now land in a
 *    "Not recorded" bucket.
 *  - On the cost metric an unpriced tyre adds 0; the report states the priced
 *    share of each period so a low figure is not mistaken for low spend.
 *  - Cost is a PURCHASE per physical tyre: rows go through withOnePricePerTyre
 *    (over the whole record set, before the period split) so a refit of a tyre
 *    already bought is not counted as a second purchase. avgCostA/B divide by
 *    priced physical tyres (qty honoured).
 *  - The count metric is replacements = fitment EVENTS, per row on purpose.
 * No I/O.
 */
import { recordCost } from './analyticsEngine'
import { withOnePricePerTyre } from './tyreLifetime'

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const UNRECORDED = 'Not recorded'
export const MOVEMENTS = ['Up', 'Down', 'Flat', 'New', 'Stopped']

/** Percent change, null when the base is zero. */
export function pctChange(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  if (a === 0) return null
  return Math.round(((b - a) / a) * 100)
}

export function movement(a, b) {
  if (a === 0 && b === 0) return 'Flat'
  if (a === 0) return 'New'
  if (b === 0) return 'Stopped'
  if (b > a) return 'Up'
  if (b < a) return 'Down'
  return 'Flat'
}

function inPeriod(dateStr, period) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return null
  return d.getFullYear() === period.year && period.months.includes(d.getMonth()) ? d.getMonth() : null
}

function priced(r) {
  const c = Number(r?.cost_per_tyre)
  return Number.isFinite(c) && c > 0
}

/**
 * @param {object[]} records tyre_records rows (issue_date, cost_per_tyre, qty, site, brand)
 * @param {{periodA:{year:number,months:number[]}, periodB:{year:number,months:number[]},
 *          metric:'count'|'cost', dimension:'overall'|'site'|'brand'}} opts
 */
export function buildComparison(records = [], { periodA, periodB, metric = 'count', dimension = 'overall' } = {}) {
  const buckets = new Map()
  const stats = {
    a: { records: 0, priced: 0, pricedTyres: 0, cost: 0 },
    b: { records: 0, priced: 0, pricedTyres: 0, cost: 0 },
  }
  const ensure = (key, order) => {
    if (!buckets.has(key)) buckets.set(key, { label: key, order, a: { count: 0, cost: 0 }, b: { count: 0, cost: 0 } })
    return buckets.get(key)
  }

  if (dimension === 'overall') {
    const months = [...new Set([...(periodA?.months || []), ...(periodB?.months || [])])].sort((x, y) => x - y)
    for (const m of months) ensure(MONTHS[m], m)
  }

  for (const r of withOnePricePerTyre(records || [])) {
    for (const [side, period] of [['a', periodA], ['b', periodB]]) {
      if (!period) continue
      const mo = inPeriod(r.issue_date, period)
      if (mo == null) continue
      const key = dimension === 'overall'
        ? MONTHS[mo]
        : (String(r[dimension] || '').trim() || UNRECORDED)
      const b = ensure(key, dimension === 'overall' ? mo : 0)
      const c = recordCost(r)
      b[side].count += 1
      b[side].cost += c
      stats[side].records += 1
      stats[side].cost += c
      // A refit whose price was dropped is not "unpriced": the tyre was bought
      // once, earlier. It counts toward the priced share but adds no money.
      if (r._refit_price_dropped) stats[side].priced += 1
      if (priced(r)) {
        stats[side].priced += 1
        const q = Number(r?.qty)
        stats[side].pricedTyres += Number.isFinite(q) && q > 0 ? q : 1
      }
    }
  }

  const val = (o) => (metric === 'cost' ? Math.round(o.cost) : o.count)
  let rows = [...buckets.values()].map((b) => {
    const a = val(b.a)
    const bv = val(b.b)
    return {
      label: b.label,
      order: b.order,
      a,
      b: bv,
      diff: bv - a,
      pct: pctChange(a, bv),
      movement: movement(a, bv),
      shareB: 0,
    }
  })
  if (dimension === 'overall') rows.sort((x, y) => x.order - y.order)
  else rows.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff) || x.label.localeCompare(y.label))

  const totalA = rows.reduce((s, r) => s + r.a, 0)
  const totalB = rows.reduce((s, r) => s + r.b, 0)
  rows = rows.map((r) => ({ ...r, shareB: totalB > 0 ? (r.b / totalB) * 100 : null }))

  const moving = rows.filter((r) => r.diff !== 0)
  const riser = moving.filter((r) => r.diff > 0).sort((x, y) => y.diff - x.diff)[0] || null
  const faller = moving.filter((r) => r.diff < 0).sort((x, y) => x.diff - y.diff)[0] || null
  const count = (m) => rows.filter((r) => r.movement === m).length

  return {
    rows,
    totals: { a: totalA, b: totalB, diff: totalB - totalA, pct: pctChange(totalA, totalB) },
    up: count('Up'),
    down: count('Down'),
    added: count('New'),
    stopped: count('Stopped'),
    biggestRiser: riser ? { label: riser.label, diff: riser.diff } : null,
    biggestFaller: faller ? { label: faller.label, diff: faller.diff } : null,
    pricedPctA: stats.a.records > 0 ? Math.round((stats.a.priced / stats.a.records) * 100) : null,
    pricedPctB: stats.b.records > 0 ? Math.round((stats.b.priced / stats.b.records) * 100) : null,
    avgCostA: stats.a.pricedTyres > 0 ? stats.a.cost / stats.a.pricedTyres : null,
    avgCostB: stats.b.pricedTyres > 0 ? stats.b.cost / stats.b.pricedTyres : null,
    recordsA: stats.a.records,
    recordsB: stats.b.records,
  }
}

export function filterRows(rows = [], { search = '', movement: mv = 'all' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return rows.filter((r) => {
    if (mv !== 'all' && r.movement !== mv) return false
    if (q && !String(r.label).toLowerCase().includes(q)) return false
    return true
  })
}

export function formatPct(p) {
  if (p == null) return 'N/A'
  return `${p > 0 ? '+' : ''}${p}%`
}

export function periodText(period) {
  if (!period?.months?.length) return `${period?.year ?? ''} (no months)`
  if (period.months.length === 12) return `${period.year} (full year)`
  return `${period.months.map((m) => MONTHS[m]).join(', ')} ${period.year}`
}

export function comparisonExportRows(rows = []) {
  return rows.map((r) => ({
    label: r.label,
    period_a: r.a,
    period_b: r.b,
    difference: `${r.diff > 0 ? '+' : ''}${r.diff}`,
    pct_change: formatPct(r.pct),
    movement: r.movement,
  }))
}

/**
 * The metric the comparison may actually use for a country scope. Each country
 * reports in its own currency (KSA SAR, UAE AED, Egypt EGP), so a COST total
 * over "All" countries adds three currencies and labels the sum with one of
 * them - a figure that is not a quantity of anything. Cost is therefore only
 * offered for a single country; the All view falls back to replacement counts,
 * which are currency-free.
 */
export function comparisonMetricFor(country, requested) {
  if (requested === 'cost' && (!country || country === 'All')) return 'count'
  return requested === 'cost' ? 'cost' : 'count'
}
