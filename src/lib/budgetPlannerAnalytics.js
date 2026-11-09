/**
 * budgetPlannerAnalytics - the pure engine behind the Annual Budget Planner.
 *
 * Every figure the page shows (monthly actuals, YTD, variance, projection,
 * per-site allocation, brand analysis, quarters, the historical trend and the
 * what-if scenario) is computed here from already-read tyre rows and budget
 * rows, so the rules are tested once and the page only renders.
 *
 * No I/O. Time is injected: `currentYear` / `currentMonth` come from the
 * caller's clock, never Date.now() in here.
 *
 * HONEST NULLS: a percentage of a zero budget, or a CPK with no measured
 * distance, is null (N/A) - never a 0% that reads as "nothing spent".
 *
 * PHYSICAL TYRES (src/lib/tyreLifetime.js): normaliseRecords drops a refit's
 * repeat price (one tyre one price, rule T1) so spend buckets never buy the same
 * tyre twice, and tags each physical tyre's LATEST fitment row with `_tyre`.
 * averageCpk is the WEIGHTED lifetime CPK (total purchase cost / total tyre-km,
 * rule T8) of the tyres whose latest fitment is in the given rows; a tyre's km
 * spans all its fitments, not only the ones inside the year slice.
 *
 * SPEND SOURCE (Phase 2, rule T9): the fleet spend figures (monthly actuals, YTD,
 * projection, quarters, historical trend, derived budget) come from the EXPENSE
 * GRID tyre bucket via gridTyreSpend() over loadCostSplit's monthly series, ONE
 * country at a time (rule T10). The tyre-record price is used only for the site
 * and brand split and for CPK, and is labelled as such on the page. When the grid
 * has no data for the scope the spend is null (N/A), never a tyre-record sum.
 */
import {
  withOnePricePerTyre, toLifetimeTyres, tyreKey, weightedCpk, CPK_KIND, CPK_KIND_LABEL,
} from './tyreLifetime'

export const BUDGET_CPK_KIND = CPK_KIND.FLEET_AGGREGATE
export const BUDGET_CPK_KIND_LABEL = CPK_KIND_LABEL[CPK_KIND.FLEET_AGGREGATE]

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const GROWTH_ASSUMPTION = 1.05
export const WARNING_PCT = 90

const n = (v) => {
  const x = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(x) ? x : 0
}

/** Parse each row once: cost, year, month (local calendar), km pair. */
const dateOf = (r) => String(r?.issue_date ?? r?.fitment_date ?? '').slice(0, 10)

export function normaliseRecords(records = []) {
  const src = withOnePricePerTyre((records || []).filter(Boolean))
  const rows = src.map((r) => {
    let year = null
    let month = null
    if (r.issue_date) {
      const s = String(r.issue_date)
      const m = /^(\d{4})-(\d{2})/.exec(s)
      if (m) { year = Number(m[1]); month = Number(m[2]) - 1 } else {
        const d = new Date(s)
        if (!Number.isNaN(d.getTime())) { year = d.getFullYear(); month = d.getMonth() }
      }
    }
    return { ...r, cost: n(r.cost_per_tyre), year, month, kmFit: n(r.km_at_fitment), kmRem: n(r.km_at_removal), _tyre: null }
  })
  // Tag the latest fitment row of each physical tyre with its lifetime figures.
  const byKey = new Map()
  src.forEach((r, i) => {
    const k = tyreKey(r, i)
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k).push(i)
  })
  for (const t of toLifetimeTyres(src)) {
    const idxs = byKey.get(t._key) || []
    let pick = t.id != null ? idxs.find((i) => src[i].id === t.id) : undefined
    if (pick == null) pick = idxs.reduce((best, i) => (best == null || dateOf(src[i]) >= dateOf(src[best]) ? i : best), null)
    if (pick != null) rows[pick]._tyre = t
  }
  return rows
}

export const recordsForYear = (rows, year) => rows.filter((r) => r.year === year)

/** Twelve monthly spend buckets. */
export function monthlyActuals(rows = []) {
  const arr = Array(12).fill(0)
  for (const r of rows) if (r.month != null && r.month >= 0 && r.month < 12) arr[r.month] += r.cost
  return arr
}

/**
 * Weighted lifetime CPK of the physical tyres represented by `rows`; null when
 * none has both a price and a measured km. Rows from normaliseRecords carry
 * `_tyre`; raw rows are collapsed here.
 */
export function averageCpk(rows = []) {
  const tagged = rows.some((r) => r && '_tyre' in r)
  const tyres = tagged ? rows.filter((r) => r._tyre).map((r) => r._tyre) : toLifetimeTyres(rows)
  return weightedCpk(tyres)
}

/** Spend per calendar year. */
export function spendByYear(rows = []) {
  const map = {}
  for (const r of rows) if (r.year) map[r.year] = (map[r.year] || 0) + r.cost
  return map
}

/**
 * Tyre spend from the expense grid's monthly series ([{ month:'YYYY-MM', tyre }],
 * the shape loadCostSplit returns). A year is present only when at least one of its
 * months carries spend: a zero-filled month before the data starts is "no data",
 * not "spent nothing", and must not drag a history average down.
 * @returns {{ byYear: Record<number, number>, byYearMonth: Record<number, number[]> }}
 */
export function gridTyreSpend(byMonth = []) {
  const byYearMonth = {}
  const seen = new Set()
  for (const m of byMonth || []) {
    const k = /^(\d{4})-(\d{2})/.exec(String(m?.month ?? ''))
    if (!k) continue
    const y = Number(k[1]); const mi = Number(k[2]) - 1
    const v = Number(m.tyre)
    if (!Number.isFinite(v) || mi < 0 || mi > 11) continue
    if (!byYearMonth[y]) byYearMonth[y] = Array(12).fill(0)
    byYearMonth[y][mi] += v
    if (v !== 0) seen.add(y)
  }
  const byYear = {}
  for (const y of seen) byYear[y] = byYearMonth[y].reduce((s, v) => s + v, 0)
  return { byYear, byYearMonth }
}

/** Twelve monthly grid buckets for one year; null when the grid has nothing for that year. */
export function gridMonthlyActuals(grid, year) {
  if (!grid || !grid.byYearMonth) return null
  const arr = grid.byYearMonth[year]
  if (!arr || !(year in (grid.byYear || {}))) return null
  return arr.slice()
}

/** Suggested annual budget from a { year: spend } map (up to 3 prior years x growth). */
export function derivedAnnualBudgetFromYears(years = {}, selectedYear) {
  const prev = Object.keys(years || {}).map(Number).filter((y) => y < selectedYear).sort((a, b) => a - b).slice(-3)
  if (!prev.length) return null
  const avg = prev.reduce((s, y) => s + years[y], 0) / prev.length
  return Math.round(avg * GROWTH_ASSUMPTION)
}

/** Suggested annual budget: average of up to the last 3 prior years x growth. Null when no history. */
export function derivedAnnualBudget(rows = [], selectedYear) {
  return derivedAnnualBudgetFromYears(spendByYear(rows), selectedYear)
}

/** Month index the YTD runs through: the live month for the current year, else December. */
export function ytdThroughMonth(selectedYear, currentYear, currentMonth) {
  if (selectedYear === currentYear) return currentMonth
  if (selectedYear > currentYear) return -1 // a future year has no actuals yet
  return 11
}

/** Headline budget position. pctUsed / projection null when not measurable. */
export function budgetPosition({ actuals = [], annualBudget = null, throughMonth = 11 }) {
  const monthsElapsed = throughMonth + 1
  if (!Array.isArray(actuals)) {
    // Spend unknown (no grid data for this scope): every spend-derived figure is N/A.
    const hasB = Number.isFinite(annualBudget) && annualBudget > 0
    const mb = hasB ? annualBudget / 12 : 0
    return {
      ytdActual: null, monthlyBudget: mb, ytdBudget: mb * Math.max(0, monthsElapsed),
      monthsElapsed: Math.max(0, monthsElapsed), variance: null, pctUsed: null, projectedYearEnd: null,
    }
  }
  const ytdActual = monthsElapsed > 0 ? actuals.slice(0, monthsElapsed).reduce((s, v) => s + v, 0) : 0
  const hasBudget = Number.isFinite(annualBudget) && annualBudget > 0
  const monthlyBudget = hasBudget ? annualBudget / 12 : 0
  const ytdBudget = monthlyBudget * Math.max(0, monthsElapsed)
  return {
    ytdActual,
    monthlyBudget,
    ytdBudget,
    monthsElapsed: Math.max(0, monthsElapsed),
    variance: hasBudget ? ytdBudget - ytdActual : null,
    pctUsed: hasBudget ? (ytdActual / annualBudget) * 100 : null,
    projectedYearEnd: monthsElapsed > 0 ? (ytdActual / monthsElapsed) * 12 : null,
  }
}

/** Traffic-light status for a spend-vs-budget percentage. */
export function budgetStatus(pct) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return 'No Budget'
  if (pct > 100) return 'Over Budget'
  if (pct >= WARNING_PCT) return 'Warning'
  return 'On Track'
}

/**
 * Per-site allocation. A site with no stored budget receives an even share of
 * the annual budget; with no annual budget either, its budget is null.
 */
export function siteAllocation({ yearRows = [], prevYearRows = [], siteBudgets = {}, annualBudget = null, monthsElapsed = 12 }) {
  const map = new Map()
  for (const r of yearRows) {
    if (!r.site) continue
    if (!map.has(r.site)) map.set(r.site, { site: r.site, actual: 0, count: 0, fitments: 0 })
    const s = map.get(r.site)
    s.actual += r.cost
    // count = fitment rows (kept for existing readers); fitments says so explicitly.
    s.count += 1
    s.fitments += 1
  }
  const prevMap = {}
  for (const r of prevYearRows) if (r.site) prevMap[r.site] = (prevMap[r.site] || 0) + r.cost
  const siteCount = map.size
  return [...map.values()].map((s) => {
    const stored = siteBudgets[s.site]
    let budget = null
    if (stored !== undefined && stored !== null && Number.isFinite(parseFloat(stored))) budget = parseFloat(stored)
    else if (Number.isFinite(annualBudget) && annualBudget > 0 && siteCount > 0) budget = annualBudget / siteCount
    const pct = budget > 0 ? (s.actual / budget) * 100 : null
    return {
      ...s,
      budget,
      budgetSource: stored !== undefined && stored !== null ? 'stored' : budget === null ? 'none' : 'even-share',
      variance: budget === null ? null : budget - s.actual,
      pct,
      projection: monthsElapsed > 0 ? (s.actual / monthsElapsed) * 12 : null,
      prevActual: prevMap[s.site] || 0,
      cpk: averageCpk(yearRows.filter((r) => r.site === s.site)),
      prevCpk: averageCpk(prevYearRows.filter((r) => r.site === s.site)),
      status: budgetStatus(pct),
    }
  }).sort((a, b) => b.actual - a.actual)
}

/** Brand spend + CPK this year vs last. */
export function brandAnalysis(yearRows = [], prevYearRows = []) {
  const ty = {}
  const ly = {}
  for (const r of yearRows) { const b = r.brand || 'Unknown'; ty[b] = (ty[b] || 0) + r.cost }
  for (const r of prevYearRows) { const b = r.brand || 'Unknown'; ly[b] = (ly[b] || 0) + r.cost }
  const brands = [...new Set([...Object.keys(ty), ...Object.keys(ly)])]
  return brands.map((b) => {
    const thisYear = ty[b] || 0
    const lastYear = ly[b] || 0
    const match = (r) => (r.brand || 'Unknown') === b
    const cpk = averageCpk(yearRows.filter(match))
    const prevCpk = averageCpk(prevYearRows.filter(match))
    return {
      brand: b,
      thisYear,
      lastYear,
      change: lastYear > 0 ? ((thisYear - lastYear) / lastYear) * 100 : null,
      cpk,
      prevCpk,
      cpkChange: prevCpk && cpk ? ((cpk - prevCpk) / prevCpk) * 100 : null,
    }
  }).sort((a, b) => b.thisYear - a.thisYear)
}

/** Ordinary least-squares line through equally spaced points. */
export function linearRegression(values = []) {
  const k = values.length
  if (k === 0) return { slope: 0, intercept: 0, predict: () => 0 }
  const xs = values.map((_, i) => i)
  const mx = xs.reduce((s, x) => s + x, 0) / k
  const my = values.reduce((s, y) => s + y, 0) / k
  const num = xs.reduce((s, x, i) => s + (x - mx) * (values[i] - my), 0)
  const den = xs.reduce((s, x) => s + (x - mx) ** 2, 0)
  const slope = den === 0 ? 0 : num / den
  const intercept = my - slope * mx
  return { slope, intercept, predict: (x) => intercept + slope * x }
}

/** Last up-to-4 years of spend + a projection for the next one (null under 2 points). */
export function historicalTrend(rows = []) {
  return historicalTrendFromYears(spendByYear(rows))
}

/** Same as historicalTrend over a { year: spend } map (e.g. gridTyreSpend().byYear). */
export function historicalTrendFromYears(years = {}) {
  years = years || {}
  const trendYears = Object.keys(years).map(Number).sort((a, b) => a - b).slice(-4)
  const trendValues = trendYears.map((y) => years[y] || 0)
  const nextYearProjection = trendValues.length < 2 ? null : Math.max(0, linearRegression(trendValues).predict(trendValues.length))
  return { trendYears, trendValues, nextYearProjection }
}

/** What-if: CPK target, volume change and a partial brand switch applied to the projection. */
export function scenarioProjection({ projectedYearEnd, currentAvgCpk, cpkTarget, volumeChange = 0, brandSwitchPct = 0, brandSwitchSaving = 0 }) {
  if (!Number.isFinite(projectedYearEnd) || projectedYearEnd <= 0) return null
  let adjusted = projectedYearEnd
  if (currentAvgCpk && Number.isFinite(cpkTarget) && cpkTarget > 0 && cpkTarget < currentAvgCpk) adjusted *= cpkTarget / currentAvgCpk
  adjusted *= 1 + n(volumeChange) / 100
  adjusted *= 1 - (n(brandSwitchPct) / 100) * (n(brandSwitchSaving) / 100)
  const projected = Math.max(0, adjusted)
  return { projected, saving: projectedYearEnd - projected, currentAvgCpk: currentAvgCpk ?? null }
}

/** Four quarters of budget vs actual with a status per quarter. */
export function quarterSummary({ actuals = [], monthlyBudget = 0, selectedYear, currentYear, currentMonth }) {
  return [0, 1, 2, 3].map((q) => {
    const months = [q * 3, q * 3 + 1, q * 3 + 2]
    const known = Array.isArray(actuals)
    const actual = known ? months.reduce((s, m) => s + (actuals[m] || 0), 0) : null
    const budget = monthlyBudget * 3
    const pct = budget > 0 && known ? (actual / budget) * 100 : null
    const isComplete = selectedYear < currentYear || (selectedYear === currentYear && months[2] <= currentMonth)
    const inProgress = selectedYear === currentYear && months.includes(currentMonth)
    let status
    if (pct !== null && pct > 100) status = 'Over'
    else if (pct !== null && pct >= WARNING_PCT) status = 'Warning'
    else status = isComplete ? 'Complete' : inProgress ? 'Active' : 'Pending'
    return { label: `Q${q + 1}`, months, actual, budget, variance: budget > 0 && known ? budget - actual : null, pct, status, isComplete }
  })
}

/** Potential saving if an over-budget site's CPK improved by `improvement` (0.15 = 15%). */
export function cpkImprovementSaving(site, improvement = 0.15) {
  if (!site?.cpk || site.cpk <= 0) return { target: null, saving: null }
  const target = site.cpk * (1 - improvement)
  const km = site.actual / site.cpk
  return { target, saving: km * (site.cpk - target) }
}

/** Monthly rows for the export workbook. */
export function monthlyExportRows(actuals = [], monthlyBudget = 0) {
  const known = Array.isArray(actuals)
  return MONTHS.map((m, i) => ({
    month: m,
    budget: Math.round(monthlyBudget),
    actual: known ? Math.round(actuals[i] || 0) : 'N/A',
    variance: monthlyBudget > 0 && known ? Math.round(monthlyBudget - (actuals[i] || 0)) : 'N/A',
    used: monthlyBudget > 0 && known ? `${(((actuals[i] || 0) / monthlyBudget) * 100).toFixed(1)}%` : 'N/A',
  }))
}

/** Search + status filter over site rows. */
export function filterSites(rows = [], { query = '', status = 'all' } = {}) {
  const q = String(query || '').trim().toLowerCase()
  return rows.filter((s) => (status === 'all' || s.status === status) && (!q || String(s.site).toLowerCase().includes(q)))
}
