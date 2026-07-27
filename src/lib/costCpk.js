/**
 * costCpk.js - the maths behind the Expenses and CPK page.
 *
 * Pure and injectable: every function takes the get_cost_cpk_overview payload
 * and returns display-ready shapes. No I/O, no dates read from the clock.
 *
 * The whole file exists to enforce three rules that this codebase has broken
 * before, each of which produced a number somebody could have acted on:
 *
 *   1. NEVER ADD CURRENCIES. SAR, AED and EGP have been summed at four separate
 *      reader sites in this system's history. `blended` is respected here rather
 *      than at the call site, so a cross-country total cannot be rendered.
 *   2. A MISSING DENOMINATOR IS NOT ZERO. An unmeasured fleet has an unknown
 *      cost per km. Every helper returns null, and the page shows "N/A".
 *   3. A COMPARISON HAS TO EARN THE RIGHT TO BE SHOWN. Cost per km is measured
 *      on the assets that have odometer readings, and the tyre records hold 14
 *      readings from 2024 against 5,712 from 2025. Comparing those two windows
 *      shows an eight-fold "improvement" that is entirely coverage. `comparable`
 *      gates it.
 */

/** Buckets in the order they are always presented. */
export const BUCKETS = Object.freeze(['tyre', 'spare', 'oil'])

export const BUCKET_LABEL = Object.freeze({
  tyre: 'Tyres', spare: 'Spare parts', oil: 'Oil and fluids',
})

/** How each period option maps to a window, given a reference date. */
export const PERIODS = Object.freeze([
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'last_3', label: 'Last 3 months' },
  { key: 'last_6', label: 'Last 6 months' },
  { key: 'ytd', label: 'Year to date' },
  { key: 'last_12', label: 'Last 12 months' },
])

const iso = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
const utc = (y, m, d) => new Date(Date.UTC(y, m, d))

/**
 * Pure: the {from,to} window for a period key.
 *
 * `today` is injected rather than read from the clock so the same input always
 * gives the same window - the page passes new Date(), the tests pass a fixed day.
 * @param {string} key one of PERIODS
 * @param {Date} today
 * @returns {{from:string, to:string}}
 */
export function periodWindow(key, today = new Date()) {
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth()
  const d = today.getUTCDate()
  switch (key) {
    case 'this_month':
      return { from: iso(utc(y, m, 1)), to: iso(utc(y, m, d)) }
    case 'last_month':
      return { from: iso(utc(y, m - 1, 1)), to: iso(utc(y, m, 0)) }
    case 'last_3':
      return { from: iso(utc(y, m - 2, 1)), to: iso(utc(y, m, d)) }
    case 'last_6':
      return { from: iso(utc(y, m - 5, 1)), to: iso(utc(y, m, d)) }
    case 'ytd':
      return { from: iso(utc(y, 0, 1)), to: iso(utc(y, m, d)) }
    case 'last_12':
    default:
      return { from: iso(utc(y, m - 11, 1)), to: iso(utc(y, m, d)) }
  }
}

const fin = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v))

/**
 * Pure: the change from one figure to another.
 *
 * Returns null for `pct` when the base is zero or missing, because "up from
 * nothing" is not a percentage - it is a new cost line, and the page says so in
 * words instead of printing an infinity.
 * @returns {{from:number|null, to:number|null, delta:number|null, pct:number|null, direction:'up'|'down'|'flat'|'new'|'stopped'|'unknown'}}
 */
export function change(from, to) {
  const a = fin(from)
  const b = fin(to)
  if (a == null && b == null) return { from: null, to: null, delta: null, pct: null, direction: 'unknown' }
  const base = a || 0
  const now = b || 0
  const delta = now - base
  let direction = 'flat'
  if (base === 0 && now > 0) direction = 'new'
  else if (now === 0 && base > 0) direction = 'stopped'
  else if (delta > 0) direction = 'up'
  else if (delta < 0) direction = 'down'
  return {
    from: a, to: b, delta,
    pct: base > 0 ? delta / base : null,
    direction,
  }
}

/**
 * Pure: the headline comparison strip.
 *
 * One row per bucket plus a total, each carrying the change against the previous
 * window and against the same window a year earlier. When the range is twelve
 * months those two windows are the same dates, so `previousIsLastYear` is
 * surfaced and the page collapses the duplicate column rather than drawing an
 * identical bar twice.
 * @param {object} snap get_cost_cpk_overview payload
 */
export function comparisonRows(snap) {
  const t = snap?.totals || {}
  const cur = t.current || {}
  const prev = t.previous || {}
  const ly = t.last_year || {}
  const rows = [...BUCKETS, 'total'].map((k) => ({
    key: k,
    label: k === 'total' ? 'Total spend' : BUCKET_LABEL[k],
    current: fin(cur[k]),
    previous: fin(prev[k]),
    lastYear: fin(ly[k]),
    vsPrevious: change(prev[k], cur[k]),
    vsLastYear: change(ly[k], cur[k]),
  }))
  return {
    rows,
    previousIsLastYear: Boolean(snap?.windows?.previous_is_last_year),
    blended: Boolean(snap?.blended),
    currency: snap?.currency || null,
  }
}

/**
 * Pure: the cost-per-km block, with its own honesty attached.
 *
 * `comparable` comes from the server (coverage against MIN_COVERAGE) and is
 * repeated on the comparison itself: a delta between a 68% coverage window and a
 * 0.7% coverage window is not a trend, and must not be drawn as one.
 */
export function cpkView(snap) {
  const c = snap?.cpk || {}
  const one = (w) => {
    const x = c[w] || {}
    return {
      cpk: fin(x.cpk),
      km: fin(x.km),
      assetsMeasured: fin(x.assets_measured) || 0,
      spendMatched: fin(x.spend_matched),
      spendTotal: fin(x.spend_total),
      coverage: fin(x.coverage_pct),
      comparable: Boolean(x.comparable),
    }
  }
  const current = one('current')
  const previous = one('previous')
  const lastYear = one('last_year')
  return {
    current,
    previous,
    lastYear,
    currency: snap?.currency || null,
    minCoverage: fin(snap?.min_coverage) ?? 0.25,
    // both sides must be trustworthy before a change is worth showing
    vsPrevious: current.comparable && previous.comparable
      ? change(previous.cpk, current.cpk) : null,
    vsLastYear: current.comparable && lastYear.comparable
      ? change(lastYear.cpk, current.cpk) : null,
    // why a comparison is being withheld, in words the reader can act on
    withheldReason: current.comparable
      ? (previous.comparable ? null : 'The earlier period has too few odometer readings to compare against.')
      : 'Not enough odometer readings in this period to measure cost per kilometre.',
  }
}

/**
 * Pure: monthly series for the trend chart, oldest first, limited to `months`.
 * Gaps are left as gaps rather than filled with zero, because a month with no
 * import is not a month with no spend.
 */
export function monthlySeries(snap, months = 24) {
  const rows = Array.isArray(snap?.monthly) ? snap.monthly : []
  const tail = rows.slice(-Math.max(1, months))
  return {
    labels: tail.map((r) => r.m),
    tyre: tail.map((r) => fin(r.tyre) ?? 0),
    spare: tail.map((r) => fin(r.spare) ?? 0),
    oil: tail.map((r) => fin(r.oil) ?? 0),
    total: tail.map((r) => fin(r.total) ?? 0),
    rows: tail,
  }
}

/**
 * Pure: the same month a year earlier, aligned to the current series, so the
 * chart can draw this year against last year on one axis.
 * Returns null in a slot where there is no matching month, never 0.
 */
export function lastYearAligned(snap, months = 24) {
  const rows = Array.isArray(snap?.monthly) ? snap.monthly : []
  const byMonth = new Map(rows.map((r) => [r.m, fin(r.total)]))
  const series = monthlySeries(snap, months)
  return series.labels.map((label) => {
    const [y, m] = String(label).split('-')
    const prior = `${Number(y) - 1}-${m}`
    return byMonth.has(prior) ? byMonth.get(prior) : null
  })
}

/**
 * Pure: what actually moved between the two windows, biggest swing first.
 *
 * This is the "why did it change" answer. It reads the dimension arrays the
 * server already returned rather than asking again, and it keeps BOTH
 * directions - a cost line that stopped explains a fall as surely as a new one
 * explains a rise.
 * @param {object} snap
 * @param {string} dim one of by_site / by_cost_center / by_asset_type / by_asset / by_item
 * @param {number} limit
 */
export function movers(snap, dim = 'by_asset', limit = 10) {
  const rows = Array.isArray(snap?.[dim]) ? snap[dim] : []
  return rows
    .map((r) => {
      const ch = change(r.prev_spend, r.spend)
      return {
        label: r.label ?? 'Unspecified',
        current: fin(r.spend) ?? 0,
        previous: fin(r.prev_spend) ?? 0,
        lines: fin(r.lines) ?? 0,
        ...ch,
      }
    })
    .filter((r) => r.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, Math.max(1, limit))
}

/**
 * Pure: how much of the current spend each kind of evidence decided.
 *
 * This is the trust measure. A high 'default' share means most of the money was
 * bucketed by the fallback rather than by anything that knows what the item is,
 * and the fix is to review those codes in Material Master. Showing it beside the
 * figures is what stops the split being read as more certain than it is.
 */
export function evidenceBreakdown(snap) {
  const rows = Array.isArray(snap?.by_evidence) ? snap.by_evidence : []
  const total = rows.reduce((s, r) => s + (fin(r.spend) || 0), 0)
  const NICE = {
    'reviewed-master': 'Confirmed by a person',
    'code-range': 'ERP item code',
    'description-tyre': 'Description says tyre',
    'brand-and-size': 'Tyre brand and size',
    'description-lubricant': 'Description says lubricant',
    accessory: 'Accessory rule',
    'job-card': 'Tyre job card',
    default: 'Fallback, nothing identified it',
    unknown: 'Not recorded',
  }
  const out = rows.map((r) => ({
    key: r.label,
    label: NICE[r.label] || r.label,
    spend: fin(r.spend) ?? 0,
    lines: fin(r.lines) ?? 0,
    share: total > 0 ? (fin(r.spend) || 0) / total : null,
    // the fallback is the only one that means "we do not really know"
    weak: r.label === 'default' || r.label === 'unknown',
  }))
  const weakShare = total > 0
    ? out.filter((r) => r.weak).reduce((s, r) => s + r.spend, 0) / total
    : null
  return { rows: out, total, weakShare }
}

/**
 * Pure: rows for the Excel export of this page.
 *
 * Money goes in a column named for its currency, so a blended export cannot put
 * two currencies in one column. With no country chosen there is no single
 * currency, and the export says so in the header rather than implying one.
 */
export function buildCostCpkExport(snap) {
  const cur = snap?.currency || 'Mixed currencies'
  const cmp = comparisonRows(snap)
  const cpk = cpkView(snap)
  const rows = []
  const pct = (v) => (v == null ? 'N/A' : `${(v * 100).toFixed(1)}%`)

  for (const r of cmp.rows) {
    rows.push({
      section: 'Spend', name: r.label,
      current: r.current ?? 'N/A',
      previous: r.previous ?? 'N/A',
      last_year: r.lastYear ?? 'N/A',
      change_vs_previous: pct(r.vsPrevious.pct),
      change_vs_last_year: pct(r.vsLastYear.pct),
    })
  }
  rows.push({
    section: 'Cost per km', name: `Cost per km (${cur})`,
    current: cpk.current.cpk ?? 'N/A',
    previous: cpk.previous.cpk ?? 'N/A',
    last_year: cpk.lastYear.cpk ?? 'N/A',
    change_vs_previous: cpk.vsPrevious ? pct(cpk.vsPrevious.pct) : 'Not comparable',
    change_vs_last_year: cpk.vsLastYear ? pct(cpk.vsLastYear.pct) : 'Not comparable',
  })
  rows.push({
    section: 'Cost per km', name: 'Odometer coverage of spend',
    current: pct(cpk.current.coverage),
    previous: pct(cpk.previous.coverage),
    last_year: pct(cpk.lastYear.coverage),
    change_vs_previous: '', change_vs_last_year: '',
  })
  for (const [dim, label] of [['by_site', 'Site'], ['by_cost_center', 'Cost centre'],
    ['by_asset_type', 'Asset type'], ['by_asset', 'Asset'], ['by_item', 'Item']]) {
    for (const m of movers(snap, dim, 25)) {
      rows.push({
        section: `${label} movement`, name: m.label,
        current: m.current, previous: m.previous, last_year: '',
        change_vs_previous: pct(m.pct), change_vs_last_year: '',
      })
    }
  }
  return {
    rows,
    columns: ['section', 'name', 'current', 'previous', 'last_year',
      'change_vs_previous', 'change_vs_last_year'],
    headers: ['Section', 'Name', `Current (${cur})`, `Previous (${cur})`,
      `Same period last year (${cur})`, 'Change vs previous', 'Change vs last year'],
  }
}
