/**
 * budgetsAnalytics - the pure engine behind the Budgets & Cost page
 * (/budgets): monthly budget-vs-spend per site and the 12-month planner grid.
 *
 * The page used to fold the tyre spend into a key map, compute utilisation,
 * remaining and the cumulative planner series inline. Every figure is now
 * derived here so the rules are tested once and the page only renders.
 *
 * No I/O. No clock: the year/month under review is always passed in.
 *
 * HONEST NULLS
 *   - Utilisation of a zero or missing budget is null (N/A). A green "0%"
 *     would read as "nothing spent" when there is simply nothing to be a
 *     percentage of.
 *   - Spend at a site with NO budget row is reported separately
 *     (`unbudgetedSpend`) rather than silently dropped from the totals.
 */

export const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Utilisation bands, in display order. The label always carries the meaning. */
export const UTIL_BANDS = [
  { key: 'over', label: 'Over budget' },
  { key: 'warn', label: 'Near limit (80%+)' },
  { key: 'ok', label: 'On track' },
  { key: 'none', label: 'No budget set' },
]
export const WARN_PCT = 80

const num = (v) => {
  const x = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(x) ? x : 0
}

/** Year + 1-based month of an ISO-ish date string, read from the text (no TZ drift). */
export function yearMonthOf(value) {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})/.exec(String(value))
  if (m) return { year: Number(m[1]), month: Number(m[2]) }
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

export const spendKey = (site, year, month) => `${site ?? ''}~${year}~${month}`

/** Cost of one tyre row: cost_per_tyre x qty (a missing qty counts as one tyre). */
export function tyreRowCost(row) {
  const qty = row?.qty == null ? 1 : num(row.qty)
  return num(row?.cost_per_tyre) * qty
}

/**
 * Fold tyre spend rows into { 'site~year~month': amount }. When `month` is
 * given every row is attributed to that month (the caller already bounded the
 * read to it); otherwise each row's own issue_date month is used and rows with
 * no readable date are skipped.
 */
export function buildSpendIndex(rows = [], { year, month = null } = {}) {
  const out = {}
  for (const r of Array.isArray(rows) ? rows : []) {
    let m = month
    if (m == null) {
      const ym = yearMonthOf(r?.issue_date)
      if (!ym) continue
      m = ym.month
    }
    const k = spendKey(r?.site, year, m)
    out[k] = (out[k] ?? 0) + tyreRowCost(r)
  }
  return out
}

export function spendFor(index, site, year, month) {
  return (index && index[spendKey(site, year, month)]) ?? 0
}

/** Spent / budget as a percentage, or null when there is no budget to measure. */
export function utilization(budget, spent) {
  const b = num(budget)
  if (!(b > 0)) return null
  return (num(spent) / b) * 100
}

export function utilBand(pct) {
  if (pct == null) return 'none'
  if (pct >= 100) return 'over'
  if (pct >= WARN_PCT) return 'warn'
  return 'ok'
}

export const bandLabel = (key) => UTIL_BANDS.find((b) => b.key === key)?.label || key

/** One row per budget for the month under review, with spend and utilisation. */
export function monthlyRows(budgets = [], index = {}, year, month) {
  return (Array.isArray(budgets) ? budgets : []).map((b) => {
    const budget = num(b?.monthly_budget)
    const spent = spendFor(index, b?.site, year, month)
    const utilPct = utilization(budget, spent)
    return {
      ...b,
      status: b?.status || 'Draft',
      budget,
      spent,
      remaining: budget - spent,
      utilPct,
      band: utilBand(utilPct),
    }
  })
}

/** Headline figures for a set of monthly rows. */
export function summarizeMonth(rows = []) {
  const list = Array.isArray(rows) ? rows : []
  let totalBudget = 0
  let totalSpend = 0
  let over = 0
  let warn = 0
  let none = 0
  for (const r of list) {
    totalBudget += num(r.budget)
    totalSpend += num(r.spent)
    if (r.band === 'over') over += 1
    else if (r.band === 'warn') warn += 1
    else if (r.band === 'none') none += 1
  }
  return {
    sites: list.length,
    totalBudget,
    totalSpend,
    remaining: totalBudget - totalSpend,
    utilPct: utilization(totalBudget, totalSpend),
    overCount: over,
    warnCount: warn,
    noBudgetCount: none,
  }
}

/** Spend booked against sites that have no budget row for that month. */
export function unbudgetedSpend(index = {}, budgets = [], year, month) {
  const budgeted = new Set((budgets || []).map((b) => String(b?.site ?? '')))
  const out = []
  for (const [k, amount] of Object.entries(index || {})) {
    const [site, y, m] = k.split('~')
    if (Number(y) !== year || Number(m) !== month) continue
    if (budgeted.has(site) || !(amount > 0)) continue
    out.push({ site: site || 'Unassigned', spent: amount })
  }
  return out.sort((a, b) => b.spent - a.spent)
}

/**
 * Narrow monthly rows. `query` matches the site; `band` and `status` are the
 * utilisation band and the workflow status.
 */
export function filterMonthlyRows(rows = [], { query = '', band = 'all', status = 'all' } = {}) {
  const q = String(query || '').trim().toLowerCase()
  return (rows || []).filter((r) => {
    if (band !== 'all' && r.band !== band) return false
    if (status !== 'all' && (r.status || 'Draft') !== status) return false
    if (q && !String(r.site || '').toLowerCase().includes(q)) return false
    return true
  })
}

/** Sites carrying at least one budget in the year, sorted. */
export function plannerSites(budgets = []) {
  return [...new Set((budgets || []).map((b) => b?.site).filter((s) => s != null && s !== ''))].sort()
}

/**
 * The 12-month planner grid: one row per site, one cell per month carrying the
 * (possibly edited) budget, the actual spend and whether it overran.
 */
export function annualGrid(budgets = [], index = {}, year, edits = {}) {
  return plannerSites(budgets).map((site) => {
    let budgetTotal = 0
    let spendTotal = 0
    const cells = Array.from({ length: 12 }, (_, i) => {
      const month = i + 1
      const editKey = `${site}~${month}`
      const edited = edits && edits[editKey] !== undefined
      const found = (budgets || []).find((b) => b?.site === site && Number(b?.month) === month)
      const value = edited ? edits[editKey] : (found ? found.monthly_budget : '')
      const budget = num(value)
      const spent = spendFor(index, site, year, month)
      budgetTotal += budget
      spendTotal += spent
      return { month, value, budget, spent, over: budget > 0 && spent > budget, edited }
    })
    return { site, cells, budgetTotal, spendTotal, utilPct: utilization(budgetTotal, spendTotal) }
  })
}

/** Year roll-up of the planner grid. */
export function annualSummary(grid = []) {
  let budget = 0
  let spend = 0
  let overCells = 0
  for (const row of grid || []) {
    budget += row.budgetTotal
    spend += row.spendTotal
    overCells += row.cells.filter((c) => c.over).length
  }
  return { sites: (grid || []).length, budget, spend, remaining: budget - spend, utilPct: utilization(budget, spend), overCells }
}

/** Monthly and cumulative budget vs spend series across the grid. */
export function cumulativeSeries(grid = []) {
  const budget = Array(12).fill(0)
  const spend = Array(12).fill(0)
  for (const row of grid || []) {
    row.cells.forEach((c, i) => { budget[i] += c.budget; spend[i] += c.spent })
  }
  let cb = 0
  let cs = 0
  return {
    budget,
    spend,
    cumBudget: budget.map((v) => (cb += v)),
    cumSpend: spend.map((v) => (cs += v)),
  }
}

/** Flat export rows for the monthly register. */
export function monthlyExportRows(rows = []) {
  return (rows || []).map((r) => ({
    site: r.site || '',
    budget: Math.round(r.budget),
    spent: Math.round(r.spent),
    remaining: Math.round(r.remaining),
    util: r.utilPct == null ? 'N/A' : `${r.utilPct.toFixed(1)}%`,
    band: bandLabel(r.band),
    status: r.status || 'Draft',
  }))
}

/** Flat export rows for the planner: budget and actual per month. */
export function annualExportRows(grid = []) {
  return (grid || []).map((row) => {
    const out = { site: row.site }
    row.cells.forEach((c, i) => {
      out[`b${i + 1}`] = Math.round(c.budget)
      out[`a${i + 1}`] = Math.round(c.spent)
    })
    out.budgetTotal = Math.round(row.budgetTotal)
    out.spendTotal = Math.round(row.spendTotal)
    return out
  })
}

export function annualExportColumns() {
  const keys = ['site']
  const headers = ['Site']
  MONTH_LABELS.forEach((m, i) => {
    keys.push(`b${i + 1}`, `a${i + 1}`)
    headers.push(`${m} Budget`, `${m} Actual`)
  })
  keys.push('budgetTotal', 'spendTotal')
  headers.push('Budget total', 'Actual total')
  return { keys, headers }
}
