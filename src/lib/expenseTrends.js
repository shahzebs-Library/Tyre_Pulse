/**
 * expenseTrends — the single pure engine behind the Expense Trends & Forecast
 * surface (`/expense-trends`) and any module that wants year-over-year expense
 * intelligence.
 *
 * Input is the per (country, year) rows from `get_expense_yearly_trend` (V413):
 * { country, year, currency, lines, tyre, spare, lubricant, total }. Categories
 * are the classifier's buckets — tyre / spare / lubricant (oil).
 *
 * Deterministic, no I/O, no Date.now(). Currencies are NEVER blended: everything
 * is grouped by country, each carrying its own currency. Forecasts are an honest
 * least-squares extrapolation of the observed years and are labelled as
 * estimates; an unforecastable series (fewer than 2 points) returns null rather
 * than a fabricated number.
 */

export const CATEGORIES = ['tyre', 'spare', 'lubricant']
export const CATEGORY_LABEL = { tyre: 'Tyres', spare: 'Spare parts', lubricant: 'Lubricants', total: 'Total' }

export function num(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const n0 = (v) => num(v) ?? 0

export const GRAINS = ['year', 'quarter', 'month']

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** Human label for a period key: '2024' | '2024-Q1' -> 'Q1 2024' | '2024-01' -> 'Jan 2024'. */
export function periodLabel(period) {
  const s = String(period || '')
  const q = s.match(/^(\d{4})-Q([1-4])$/)
  if (q) return `Q${q[2]} ${q[1]}`
  const mo = s.match(/^(\d{4})-(\d{2})$/)
  if (mo) return `${MONTHS[Number(mo[2]) - 1] || mo[2]} ${mo[1]}`
  return s
}

/** The next period key after `period` for the given grain. */
export function nextPeriod(period, grain = 'year') {
  const s = String(period || '')
  if (grain === 'month') {
    const m = s.match(/^(\d{4})-(\d{2})$/); if (!m) return s
    let y = Number(m[1]); let mo = Number(m[2]) + 1
    if (mo > 12) { mo = 1; y += 1 }
    return `${y}-${String(mo).padStart(2, '0')}`
  }
  if (grain === 'quarter') {
    const m = s.match(/^(\d{4})-Q([1-4])$/); if (!m) return s
    let y = Number(m[1]); let q = Number(m[2]) + 1
    if (q > 4) { q = 1; y += 1 }
    return `${y}-Q${q}`
  }
  const y = Number(s); return Number.isFinite(y) ? String(y + 1) : s
}

/**
 * Group the flat RPC rows by country: { country, currency, years:[...sorted] }.
 * Accepts either `period` (year/quarter/month key) or the legacy `year` field.
 */
export function byCountry(rows) {
  const m = new Map()
  for (const r of rows || []) {
    const c = r.country || 'Unknown'
    if (!m.has(c)) m.set(c, { country: c, currency: r.currency || '', years: [] })
    const e = m.get(c)
    if (!e.currency && r.currency) e.currency = r.currency
    const key = String(r.period ?? r.year)
    e.years.push({
      period: key, year: key, label: periodLabel(key),
      tyre: n0(r.tyre), spare: n0(r.spare), lubricant: n0(r.lubricant),
      total: n0(r.total), lines: n0(r.lines),
    })
  }
  for (const e of m.values()) e.years.sort((a, b) => a.period.localeCompare(b.period))
  return [...m.values()].sort((a, b) => a.country.localeCompare(b.country))
}

/** Year-over-year table for one country's year series (delta + pct vs prior year). */
export function yoyTable(years) {
  return (years || []).map((y, i) => {
    const prev = i > 0 ? years[i - 1] : null
    const delta = prev ? y.total - prev.total : null
    const pct = prev && prev.total ? (delta / prev.total) * 100 : null
    return { ...y, delta, pct }
  })
}

/** Category share of the latest year (percent), for a doughnut. */
export function latestShare(years) {
  const last = (years || [])[years.length - 1]
  if (!last || !last.total) return CATEGORIES.map((k) => ({ category: k, value: last ? last[k] : 0, pct: null }))
  return CATEGORIES.map((k) => ({ category: k, value: last[k], pct: (last[k] / last.total) * 100 }))
}

/**
 * Least-squares slope/intercept over (index, value). Returns null when fewer
 * than 2 measurable points. `predict(i)` extrapolates.
 */
export function linearFit(values) {
  const pts = (values || []).map((v, i) => [i, num(v)]).filter(([, v]) => v != null)
  if (pts.length < 2) return null
  const n = pts.length
  const sx = pts.reduce((a, [x]) => a + x, 0)
  const sy = pts.reduce((a, [, y]) => a + y, 0)
  const sxx = pts.reduce((a, [x]) => a + x * x, 0)
  const sxy = pts.reduce((a, [x, y]) => a + x * y, 0)
  const denom = n * sxx - sx * sx
  if (denom === 0) return null
  const slope = (n * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / n
  return { slope, intercept, predict: (i) => intercept + slope * i }
}

/** Compound annual growth rate (%) between first and last measurable totals. */
export function cagr(years) {
  const vals = (years || []).map((y) => y.total).filter((v) => v > 0)
  if (vals.length < 2) return null
  const first = vals[0], last = vals[vals.length - 1]
  const periods = vals.length - 1
  return (Math.pow(last / first, 1 / periods) - 1) * 100
}

/**
 * Forecast the next `ahead` years per category + total via least-squares.
 * Returns [] when the history is too short. Negative extrapolations are floored
 * at 0 (spend cannot go below zero). Each row is flagged forecast:true.
 */
export function forecast(years, ahead = 2, grain = 'year') {
  const hist = years || []
  if (hist.length < 2) return []
  const fits = {}
  for (const k of [...CATEGORIES, 'total']) fits[k] = linearFit(hist.map((y) => y[k]))
  const out = []
  let key = hist[hist.length - 1].period ?? hist[hist.length - 1].year
  for (let a = 1; a <= ahead; a++) {
    key = nextPeriod(key, grain)
    const idx = hist.length - 1 + a
    const row = { period: key, year: key, label: periodLabel(key), forecast: true }
    for (const k of [...CATEGORIES, 'total']) {
      row[k] = fits[k] ? Math.max(0, Math.round(fits[k].predict(idx))) : null
    }
    out.push(row)
  }
  return out
}

/** Plain-language findings for one country's series. Honest + empty-safe. */
export function insights(years, grain = 'year') {
  const out = []
  if (!years || years.length < 2) return out
  const first = years[0], last = years[years.length - 1]
  const per = grain === 'month' ? 'month' : grain === 'quarter' ? 'quarter' : 'year'
  const g = cagr(years)
  if (g != null) {
    out.push({
      tone: g > 0 ? 'warning' : 'good',
      text: `Total spend ${g >= 0 ? 'grew' : 'fell'} ${Math.abs(Math.round(g))}% per ${per} on average from ${first.label || first.year} to ${last.label || last.year}.`,
    })
  }
  // fastest-growing category by CAGR
  let fastest = null
  for (const k of CATEGORIES) {
    const c = cagr(years.map((y) => ({ year: y.year, total: y[k] })))
    if (c != null && (fastest == null || c > fastest.c)) fastest = { k, c }
  }
  if (fastest && fastest.c > 0) {
    out.push({ tone: 'info', text: `${CATEGORY_LABEL[fastest.k]} is the fastest-growing category (${Math.round(fastest.c)}%/yr).` })
  }
  const f = forecast(years, 1, grain)[0]
  if (f && f.total != null) {
    out.push({ tone: 'accent', text: `On the current trend, ${f.label || f.year} total spend is projected near ${f.total.toLocaleString()}.` })
  }
  return out
}

/** How many periods ahead to forecast for a given grain. */
export function forecastAhead(grain) {
  return grain === 'month' ? 6 : grain === 'quarter' ? 4 : 2
}

/** Everything a country panel needs, in one call. */
export function buildCountryTrend(entry, grain = 'year') {
  const years = entry?.years || []
  const ahead = forecastAhead(grain)
  return {
    country: entry?.country, currency: entry?.currency || '', grain,
    years,
    yoy: yoyTable(years),
    share: latestShare(years),
    cagr: cagr(years),
    forecast: forecast(years, ahead, grain),
    insights: insights(years, grain),
  }
}
