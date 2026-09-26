/**
 * costPerM3Analytics - pure presentation engine for the Cost per M3 dashboard
 * (/cost-per-m3). The headline figure is computed server-side by the
 * get_cost_per_m3 RPC and is passed through untouched; this module only shapes
 * the RPC output for the page: KPI strip, region + month table rows, filters,
 * sorting, export rows and the site-manager review. No I/O and no clock.
 *
 * THE GUARD. A region (or a rolling window) with less than MIN_M3_FOR_RATE of
 * approved production does not yield a readable rate, so it is withheld with a
 * plain-English reason ("Too little production to measure") everywhere it is
 * shown or exported, never printed as a number. Money is one country at a time
 * in its own currency, never blended.
 */
import {
  fmtMoney, costPerM3Reliable, MIN_M3_FOR_RATE,
} from './costPerM3'
import { sortRows } from './consoleTableSort'

export { sortRows }

const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const r2 = (n) => (n == null ? null : Math.round(n * 100) / 100)

export const TOO_LITTLE = 'Too little production to measure'

/** Region/month cost-per-M3 as the RPC reports it, else grand / production, else null. */
export function rateOf(row) {
  const reported = num(row?.cost_per_m3)
  if (reported != null) return reported
  const prod = num(row?.production_m3)
  const grand = num(row?.grand_total)
  return prod != null && prod > 0 && grand != null ? grand / prod : null
}

/**
 * Site-manager review: honest, data-derived issues to flag for the period.
 * Every line is grounded in the passed data.
 */
export function buildSiteManagerReview({ regions = [], total = null, rejections = null, currency = '', label = '' } = {}) {
  const m = (v) => fmtMoney(v, currency)
  const withProd = regions.filter((r) => (Number(r.production_m3) || 0) > 0)
  const lines = []
  const issues = []

  if (total && (Number(total.grand_total) || Number(total.production_m3))) {
    const cpm = total.cost_per_m3 != null ? Number(total.cost_per_m3)
      : (Number(total.production_m3) > 0 ? (Number(total.grand_total) || 0) / Number(total.production_m3) : null)
    lines.push(`Total cost ${m(total.grand_total)} over ${Math.round(Number(total.production_m3) || 0).toLocaleString('en-US')} m3${cpm != null ? ` = ${m(cpm)} per m3` : ''} for ${label}.`)
    const sources = [
      ['Internal', Number(total.internal_cost) || 0], ['Tyres', Number(total.tyre_cost) || 0],
      ['SCO', Number(total.sco_cost) || 0], ['SANY', Number(total.sany_cost) || 0],
    ].sort((a, b) => b[1] - a[1])
    const grand = Number(total.grand_total) || sources.reduce((s, x) => s + x[1], 0)
    if (sources[0] && sources[0][1] > 0 && grand > 0) {
      lines.push(`Largest cost is ${sources[0][0]} at ${m(sources[0][1])} (${Math.round((sources[0][1] / grand) * 100)}% of total).`)
    }
  } else {
    lines.push(`No cost or approved production was recorded for ${label}.`)
  }

  if (withProd.length >= 2) {
    const avg = withProd.reduce((s, r) => s + (rateOf(r) || 0), 0) / withProd.length
    withProd.forEach((r) => {
      const c = rateOf(r)
      if (c != null && avg > 0 && c > avg * 1.15) {
        issues.push(`${r.region} cost/m3 is ${m(c)}, ${Math.round(((c - avg) / avg) * 100)}% above the ${label} average of ${m(avg)}.`)
      }
    })
  }
  regions.forEach((r) => {
    if ((Number(r.grand_total) || 0) > 0 && (Number(r.production_m3) || 0) === 0) {
      issues.push(`${r.region} recorded ${m(r.grand_total)} in cost but no approved production. Check the production entries.`)
    }
  })
  if (rejections && rejections.ok) {
    const rt = Number(rejections.total) || 0
    if (rt > 0) {
      const size = (x) => Number(x.rejected_m3 ?? x.value ?? x.m3) || 0
      const topSite = [...(rejections.by_site || [])].sort((a, b) => size(b) - size(a))[0]
      const topReason = [...(rejections.by_reason || [])].sort((a, b) => size(b) - size(a))[0]
      let s = `Rejected production this period: ${Math.round(rt).toLocaleString('en-US')} m3.`
      if (topSite) s += ` Most at ${topSite.site || topSite.region || 'a site'}.`
      if (topReason) s += ` Top reason: ${topReason.reason || 'unspecified'}.`
      issues.push(s)
    }
  }
  return { lines, issues }
}

/** Plain-text version of the review for the clipboard. */
export function reviewText({ review, country, label }) {
  return [
    `Cost per M3 review for ${country}, ${label}`,
    ...review.lines.map((l) => `- ${l}`),
    ...(review.issues.length ? ['', 'Issues to action:', ...review.issues.map((i) => `- ${i}`)] : ['', 'No issues to flag this period.']),
  ].join('\n')
}

/** Measurability class of a row: 'measurable' | 'too_little' | 'no_production'. */
export function measurability(row, minM3 = MIN_M3_FOR_RATE) {
  const prod = num(row?.production_m3)
  if (prod == null || prod <= 0) return 'no_production'
  return costPerM3Reliable(prod, minM3) ? 'measurable' : 'too_little'
}

/**
 * Region rows enriched for the table: each region's share of the period grand
 * total, its measurability, and the rate ONLY when it is readable.
 */
export function regionTableRows(regions = [], total = null) {
  const grand = num(total?.grand_total) ?? (regions || []).reduce((s, r) => s + (num(r.grand_total) || 0), 0)
  return (regions || []).map((r) => {
    const m = measurability(r)
    const g = num(r.grand_total)
    return {
      ...r,
      _measure: m,
      _rate: m === 'measurable' ? rateOf(r) : null,
      _share: grand > 0 && g != null ? (g / grand) * 100 : null,
    }
  })
}

/** Filter region rows by name search and measurability ('all' = no filter). */
export function filterRegions(rows = [], { search = '', measure = 'all' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (rows || []).filter((r) => {
    if (measure !== 'all' && r._measure !== measure) return false
    if (q && !String(r.region || '').toLowerCase().includes(q)) return false
    return true
  })
}

/** Region sort accessors (an unreadable rate sorts last in either direction). */
export const REGION_SORT_ACCESSORS = {
  region: (r) => r.region || null,
  internal: (r) => num(r.internal_cost),
  sco: (r) => num(r.sco_cost),
  sany: (r) => num(r.sany_cost),
  grand: (r) => num(r.grand_total),
  share: (r) => r._share,
  production: (r) => num(r.production_m3),
  rate: (r) => r._rate,
}

/** Percent change b vs a, null when a is missing or zero (no honest base). */
export function pctChange(prev, cur) {
  const a = num(prev); const b = num(cur)
  if (a == null || b == null || a === 0) return null
  return ((b - a) / Math.abs(a)) * 100
}

/**
 * Month rows for the monthly detail: chronological change in grand total and in
 * cost/M3 vs the previous month, and each month's share of the peak month (the
 * inline bar). A month's rate follows the same guard as a region.
 */
export function monthTableRows(months = []) {
  const list = (months || []).filter((m) => m && m.month)
  const chrono = [...list].sort((a, b) => String(a.month).localeCompare(String(b.month)))
  const prevOf = new Map(chrono.map((m, i) => [m.month, i > 0 ? chrono[i - 1] : null]))
  const maxGrand = list.reduce((mx, r) => Math.max(mx, num(r.grand_total) || 0), 0)
  return list.map((m) => {
    const prev = prevOf.get(m.month)
    const measure = measurability(m)
    const rate = measure === 'measurable' ? rateOf(m) : null
    const prevRate = prev && measurability(prev) === 'measurable' ? rateOf(prev) : null
    return {
      ...m,
      _measure: measure,
      _rate: rate,
      _momGrand: prev ? pctChange(prev.grand_total, m.grand_total) : null,
      _momRate: prevRate != null && rate != null ? pctChange(prevRate, rate) : null,
      _pctOfPeak: maxGrand > 0 ? Math.round(((num(m.grand_total) || 0) / maxGrand) * 100) : 0,
    }
  })
}

export const MONTH_SORT_ACCESSORS = {
  month: (r) => r.month || null,
  internal: (r) => num(r.internal_cost),
  sco: (r) => num(r.sco_cost),
  sany: (r) => num(r.sany_cost),
  grand: (r) => num(r.grand_total),
  mom: (r) => r._momGrand,
  production: (r) => num(r.production_m3),
  rate: (r) => r._rate,
}

/**
 * KPI strip. The period Cost/M3 is the RPC's own figure (unchanged semantics);
 * the rolling 12-month rate is withheld when its production is too thin.
 */
export function costPerM3Kpis({ total = null, regions = [], months = [], rejections = null } = {}) {
  const rows = regionTableRows(regions, total)
  const top = [...rows].filter((r) => num(r.grand_total) > 0)
    .sort((a, b) => num(b.grand_total) - num(a.grand_total))[0] || null
  const rated = rows.filter((r) => r._rate != null)
  const cheapest = rated.length ? [...rated].sort((a, b) => a._rate - b._rate)[0] : null
  const dearest = rated.length ? [...rated].sort((a, b) => b._rate - a._rate)[0] : null
  const mList = (months || []).filter((m) => m && m.month)
  const g12 = mList.reduce((s, m) => s + (num(m.grand_total) || 0), 0)
  const p12 = mList.reduce((s, m) => s + (num(m.production_m3) || 0), 0)
  const rejTotal = rejections && rejections.ok ? num(rejections.total) : null
  const prod = num(total?.production_m3)
  return {
    grandTotal: num(total?.grand_total),
    production: prod,
    costPerM3: total ? num(total.cost_per_m3) : null,
    periodMeasurable: costPerM3Reliable(prod),
    regionCount: rows.length,
    measurableRegions: rated.length,
    unmeasurableRegions: rows.length - rated.length,
    topRegion: top ? { region: top.region, grand: num(top.grand_total), share: top._share } : null,
    cheapestRegion: cheapest ? { region: cheapest.region, rate: cheapest._rate } : null,
    dearestRegion: dearest && dearest !== cheapest ? { region: dearest.region, rate: dearest._rate } : null,
    rejectedM3: rejTotal,
    rejectedShare: rejTotal != null && prod != null && prod + rejTotal > 0 ? (rejTotal / (prod + rejTotal)) * 100 : null,
    rolling: {
      months: mList.length,
      grand: mList.length ? g12 : null,
      production: mList.length ? p12 : null,
      rate: mList.length && costPerM3Reliable(p12) ? g12 / p12 : null,
      measurable: mList.length > 0 && costPerM3Reliable(p12),
    },
  }
}

/** Export cell for a rate: the value, "Too little production to measure", or N/A. */
function rateCell(row) {
  if (row._measure === 'no_production') return 'N/A'
  if (row._measure === 'too_little') return TOO_LITTLE
  return row._rate == null ? 'N/A' : r2(row._rate).toFixed(2)
}

export const REGION_EXPORT_COLS = ['region', 'internal', 'tyre', 'sco', 'sany', 'grand_total', 'share', 'production_m3', 'cost_per_m3']
export function regionExportHeaders(currency) {
  return ['Region', `Internal (${currency})`, `Tyre (${currency})`, `SCO (${currency})`, `SANY (${currency})`, `Grand Total (${currency})`, 'Share of total', 'Production M3', `Cost/M3 (${currency})`]
}

/**
 * Region export rows, guarded exactly like the screen (a spreadsheet or PDF
 * outlives the page it came from, so it must not be the one place an
 * unreadable rate survives). The TOTAL row carries the RPC's own figure.
 */
export function regionExportRows(tableRows = [], total = null) {
  const out = (tableRows || []).map((r) => ({
    region: r.region,
    internal: Math.round(num(r.internal_cost) || 0), tyre: Math.round(num(r.tyre_cost) || 0),
    sco: Math.round(num(r.sco_cost) || 0), sany: Math.round(num(r.sany_cost) || 0),
    grand_total: Math.round(num(r.grand_total) || 0),
    share: r._share == null ? 'N/A' : `${r._share.toFixed(1)}%`,
    production_m3: Math.round(num(r.production_m3) || 0),
    cost_per_m3: rateCell(r),
  }))
  if (total) {
    out.push({
      region: 'TOTAL',
      internal: Math.round(num(total.internal_cost) || 0), tyre: Math.round(num(total.tyre_cost) || 0),
      sco: Math.round(num(total.sco_cost) || 0), sany: Math.round(num(total.sany_cost) || 0),
      grand_total: Math.round(num(total.grand_total) || 0),
      share: num(total.grand_total) > 0 ? '100%' : 'N/A',
      production_m3: Math.round(num(total.production_m3) || 0),
      cost_per_m3: num(total.cost_per_m3) == null ? 'N/A' : Number(total.cost_per_m3).toFixed(2),
    })
  }
  return out
}

export const MONTH_EXPORT_COLS = ['month', 'internal', 'tyre', 'sco', 'sany', 'grand_total', 'mom', 'production_m3', 'cost_per_m3']
export function monthExportHeaders(currency) {
  return ['Month', `Internal (${currency})`, `Tyre (${currency})`, `SCO (${currency})`, `SANY (${currency})`, `Grand Total (${currency})`, 'Change vs prior month', 'Production M3', `Cost/M3 (${currency})`]
}

export function monthExportRows(tableRows = []) {
  return (tableRows || []).map((r) => ({
    month: r.month,
    internal: Math.round(num(r.internal_cost) || 0), tyre: Math.round(num(r.tyre_cost) || 0),
    sco: Math.round(num(r.sco_cost) || 0), sany: Math.round(num(r.sany_cost) || 0),
    grand_total: Math.round(num(r.grand_total) || 0),
    mom: r._momGrand == null ? 'N/A' : `${r._momGrand >= 0 ? '+' : ''}${r._momGrand.toFixed(1)}%`,
    production_m3: Math.round(num(r.production_m3) || 0),
    cost_per_m3: rateCell(r),
  }))
}

/** Chart Builder catalog over the region + month rows (money never blended). */
export function studioCatalogFor(regions = [], months = []) {
  const out = []
  if (regions.length) {
    out.push({ key: 'grand_region', label: 'Grand total by region', kind: 'flat', valueKind: 'money',
      rows: regions.map((r) => ({ label: r.region, value: Number(r.grand_total) || 0 })) })
    // An untagged region's rate is dozens of times the fleet figure; one bar that
    // tall flattens every real one, so unreadable regions are left out.
    out.push({ key: 'cpm3_region', label: 'Cost per M3 by region', kind: 'flat', valueKind: 'money',
      rows: regions.filter((r) => costPerM3Reliable(r.production_m3)).map((r) => ({ label: r.region, value: Number(r.cost_per_m3) || 0 })) })
    out.push({ key: 'm3_region', label: 'Production M3 by region', kind: 'flat', valueKind: 'count',
      rows: regions.map((r) => ({ label: r.region, value: Number(r.production_m3) || 0 })) })
    out.push({ key: 'split_region', label: 'Cost source by region (Internal/SCO/SANY)', kind: 'series', valueKind: 'money', allowTotal: true,
      labels: regions.map((r) => r.region),
      series: [
        { name: 'Internal', data: regions.map((r) => Number(r.internal_cost) || 0) },
        { name: 'SCO', data: regions.map((r) => Number(r.sco_cost) || 0) },
        { name: 'SANY', data: regions.map((r) => Number(r.sany_cost) || 0) },
      ] })
  }
  if (months.length) {
    out.push({ key: 'grand_month', label: 'Grand total by month', kind: 'series', valueKind: 'money',
      labels: months.map((r) => r.month), series: [{ name: 'Grand total', data: months.map((r) => Number(r.grand_total) || 0) }] })
    out.push({ key: 'cpm3_month', label: 'Cost per M3 by month', kind: 'series', valueKind: 'money',
      labels: months.map((r) => r.month), series: [{ name: 'Cost per M3', data: months.map((r) => Number(r.cost_per_m3) || 0) }] })
    out.push({ key: 'm3_month', label: 'Production M3 by month', kind: 'series', valueKind: 'count',
      labels: months.map((r) => r.month), series: [{ name: 'Production M3', data: months.map((r) => Number(r.production_m3) || 0) }] })
  }
  return out
}
