/**
 * expenseTrendsAnalytics - the presentation engine for the Expense Trends &
 * Forecast page (`/expense-trends`).
 *
 * The trend maths themselves (period grouping, YoY, CAGR, least-squares
 * forecast, findings) live in `expenseTrends.js` and are REUSED here, never
 * re-derived. This module only shapes that output into what the page renders:
 * the per-period table rows (actuals + forecast, each labelled), the scope
 * summary per country, the export rows and the label vocabulary for a grain.
 *
 * Pure: no I/O, no Date.now(). Currencies are never blended - every money row
 * carries its own country's currency and a total across currencies is left to
 * `scopeMoneyTotal`, which withholds it as N/A.
 */
import { buildCountryTrend, num } from './expenseTrends'

/** Money with its currency prefix; unmeasurable reads N/A, never 0. */
export function fmtMoney(v, cur) {
  if (num(v) == null) return 'N/A'
  return `${cur ? cur + ' ' : ''}${Math.round(Number(v)).toLocaleString()}`
}

/** Signed percentage to one decimal; N/A when not measurable. */
export function fmtPct(v) {
  if (num(v) == null) return 'N/A'
  const n = Math.round(Number(v) * 10) / 10
  return `${n > 0 ? '+' : ''}${n}%`
}

/** Labels that depend on the period grain. */
export function grainLabels(grain = 'year') {
  if (grain === 'month') return { per: 'Month', change: 'MoM', short: 'mo' }
  if (grain === 'quarter') return { per: 'Quarter', change: 'QoQ', short: 'qtr' }
  return { per: 'Year', change: 'YoY', short: 'yr' }
}

/**
 * Tyre share of one period's total, as a percent. Null (N/A) when the period
 * has no total: a share of nothing is not 0%.
 */
export function tyreSharePct(period) {
  const total = num(period?.total)
  const tyre = num(period?.tyre)
  if (!total || tyre == null) return null
  return Math.round((tyre / total) * 100)
}

/**
 * Rows for the per-period table: every measured period in chronological order,
 * then every forecast period, each tagged with `kind` so a sort can never make a
 * projection read as a measurement. `order` preserves the chronological index
 * so the default view is the natural timeline.
 */
export function periodTableRows(trend) {
  const actual = (trend?.yoy || []).map((y, i) => ({
    id: `actual-${y.period}-${i}`,
    order: i,
    kind: 'Actual',
    period: y.period,
    label: y.label,
    tyre: num(y.tyre),
    spare: num(y.spare),
    lubricant: num(y.lubricant),
    total: num(y.total),
    change: num(y.pct),
    tyreShare: tyreSharePct(y),
  }))
  const base = actual.length
  const fc = (trend?.forecast || []).map((y, i) => ({
    id: `forecast-${y.period}-${i}`,
    order: base + i,
    kind: 'Forecast',
    period: y.period,
    label: y.label,
    tyre: num(y.tyre),
    spare: num(y.spare),
    lubricant: num(y.lubricant),
    total: num(y.total),
    change: null,
    tyreShare: tyreSharePct(y),
  }))
  return [...actual, ...fc]
}

/**
 * One summary row per country in the windowed set: currency, periods, the
 * total spend and line count over the window, the latest period, its tyre
 * share, the average growth and the next forecast total.
 */
export function countrySummaryRows(countries, grain = 'year') {
  return (countries || []).map((c) => {
    const t = buildCountryTrend(c, grain)
    const years = t.years
    const last = years[years.length - 1] || null
    const sumOf = (k) => {
      let seen = 0
      let s = 0
      for (const y of years) { const v = num(y[k]); if (v != null) { s += v; seen += 1 } }
      return seen ? s : null
    }
    return {
      id: c.country,
      country: c.country,
      currency: c.currency || '',
      periods: years.length,
      total: sumOf('total'),
      tyre: sumOf('tyre'),
      spare: sumOf('spare'),
      lubricant: sumOf('lubricant'),
      lines: sumOf('lines'),
      latestLabel: last?.label ?? null,
      latestTotal: last ? num(last.total) : null,
      tyreShare: tyreSharePct(last),
      cagr: t.cagr,
      nextForecast: t.forecast[0] ? num(t.forecast[0].total) : null,
      nextForecastLabel: t.forecast[0]?.label ?? null,
    }
  })
}

/** Scope entries for `scopeMoneyTotal` / `scopeCount`. */
export function scopeEntries(countries) {
  return (countries || []).map((c) => ({
    country: c.country,
    currency: c.currency,
    total: (c.years || []).reduce((s, y) => s + (num(y.total) ?? 0), 0),
    lines: (c.years || []).reduce((s, y) => s + (num(y.lines) ?? 0), 0),
  }))
}

export const EXPORT_COLUMNS = [
  ['country', 'Country'], ['currency', 'Currency'], ['period', 'Period'], ['kind', 'Type'],
  ['tyre', 'Tyres'], ['spare', 'Spare'], ['lubricant', 'Lubricants'], ['total', 'Total'], ['lines', 'Lines'],
]

/** Flat export rows: actuals then forecasts per country, never blended. */
export function expenseExportRows(countries, grain = 'year') {
  const out = []
  for (const c of countries || []) {
    for (const y of c.years || []) {
      out.push({
        country: c.country, currency: c.currency, period: y.label, kind: 'Actual',
        tyre: y.tyre, spare: y.spare, lubricant: y.lubricant, total: y.total, lines: y.lines,
      })
    }
    for (const y of buildCountryTrend(c, grain).forecast) {
      out.push({
        country: c.country, currency: c.currency, period: y.label, kind: 'Forecast',
        tyre: y.tyre, spare: y.spare, lubricant: y.lubricant, total: y.total, lines: '',
      })
    }
  }
  return out
}
