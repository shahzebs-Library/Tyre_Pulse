/**
 * countryComparisonAnalytics - pure helpers for Country Comparison.
 *
 * Each country reports money in its OWN currency (KSA SAR, UAE AED, Egypt EGP).
 * A money metric is therefore only comparable across countries that share a
 * currency; the "best value" highlight and any cross-country total are refused
 * otherwise, and the page says why instead of crowning a number that is not a
 * like-for-like figure.
 */

export const COUNTRY_CURRENCY = Object.freeze({ KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' })

/** Currency for a country, or null when unknown (never guessed). */
export function currencyFor(country) {
  return COUNTRY_CURRENCY[String(country || '').trim()] || null
}

const MONEY = new Set(['currency', 'cpk'])

/**
 * Can a metric be compared across these countries?
 * @returns {{comparable:boolean, reason:string}}
 */
export function comparability(format, countries = []) {
  if (!MONEY.has(format) || countries.length < 2) return { comparable: true, reason: '' }
  const cur = countries.map(currencyFor)
  if (cur.some(c => !c)) return { comparable: false, reason: 'Currency unknown for at least one country' }
  if (new Set(cur).size > 1) return { comparable: false, reason: `Different currencies (${[...new Set(cur)].join(', ')})` }
  return { comparable: true, reason: '' }
}

/** Best value in a row, or null when not comparable / fewer than 2 values. */
export function bestValue(values = [], lowerIsBetter = false, comparable = true) {
  if (!comparable) return null
  const v = values.filter(x => x != null && Number.isFinite(x))
  if (v.length < 2) return null
  return lowerIsBetter ? Math.min(...v) : Math.max(...v)
}

/**
 * Share of tyre records per country carrying a unit price. A cost KPI resting
 * on a small priced share is a partial figure and the page flags it.
 */
export function pricedCoverage(records = []) {
  const out = {}
  for (const r of records) {
    const c = String(r.country || '').trim(); if (!c) continue
    const row = out[c] || (out[c] = { country: c, records: 0, priced: 0 })
    row.records += 1
    if (Number(r.cost_per_tyre) > 0) row.priced += 1
  }
  for (const row of Object.values(out)) row.pct = row.records ? Math.round((row.priced / row.records) * 1000) / 10 : null
  return out
}

/**
 * Group expense-trend rows ({country, period, currency, tyre, spare, lubricant, total})
 * into one series per country, sorted by period, keeping each country's currency.
 * @param {Array} rows
 * @param {{countries?:string[], last?:number}} opts
 */
export function trendByCountry(rows = [], { countries = [], last = 12 } = {}) {
  const map = new Map()
  for (const r of rows) {
    const c = String(r.country || '').trim()
    if (!c || (countries.length && !countries.includes(c))) continue
    const s = map.get(c) || { country: c, currency: r.currency || currencyFor(c), points: [] }
    s.points.push({ period: String(r.period ?? r.year), tyre: Number(r.tyre) || 0, spare: Number(r.spare) || 0, lubricant: Number(r.lubricant) || 0, total: Number(r.total) || 0 })
    map.set(c, s)
  }
  const out = []
  for (const s of map.values()) {
    s.points.sort((a, b) => a.period.localeCompare(b.period))
    s.points = last ? s.points.slice(-last) : s.points
    const n = s.points.length
    const cur = n ? s.points[n - 1].total : null
    const prev = n > 1 ? s.points[n - 2].total : null
    s.latest = cur
    s.changePct = prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : null
    s.periodTotal = s.points.reduce((sum, p) => sum + p.total, 0)
    out.push(s)
  }
  return out.sort((a, b) => a.country.localeCompare(b.country))
}

/** Rows for the KPI export: one row per KPI, one column per country. */
export function comparisonExportRows(kpis = [], metrics = [], fmt = v => v) {
  const countries = metrics.map(m => m.country)
  return kpis.map(k => {
    const row = { metric: k.label }
    for (const m of metrics) row[m.country] = fmt(k, m[k.key], m.country)
    row.comparable = comparability(k.format, countries).comparable ? 'Yes' : 'No'
    return row
  })
}
