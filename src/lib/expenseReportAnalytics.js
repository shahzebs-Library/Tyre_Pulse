/**
 * expenseReportAnalytics - pure, no-I/O engine behind /expense-report.
 *
 * Holds the tyre aggregation for the Chart Builder, the Excel export shape,
 * and the row shapers for the two register tables on the page (spend by site
 * and CPK by asset type). The page renders; this module decides.
 *
 * Honesty rules kept here so they are testable:
 *   - money in different currencies is never summed (one column per currency),
 *   - a missing amount stays null (rendered N/A), never a fabricated 0,
 *   - a store code with no site mapping is flagged, not hidden.
 */

/** Country -> currency. Mirrors SettingsContext.COUNTRY_CURRENCY. */
export const EXPENSE_COUNTRY_CURRENCY = Object.freeze({ KSA: 'SAR', UAE: 'AED', Egypt: 'EGP' })

/** Currency for one country, falling back to `fallback` for anything unmapped. */
export function currencyForCountryCode(country, fallback = 'SAR') {
  return EXPENSE_COUNTRY_CURRENCY[country] || fallback
}

const finite = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/** 'YYYY-MM' -> 'Mon YY' month label (passthrough for non date keys). */
export const monthLabel = (key) => {
  const s = String(key || '')
  if (!/^\d{4}-\d{2}/.test(s)) return s
  const [y, m] = s.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en', { month: 'short', year: '2-digit' })
}


/**
 * Aggregate tyre records for the Chart Builder: quantity by site / size / brand /
 * month and cost-per-km by site (sum cost / sum km, per site). Scoped client-side
 * to [from,to] on issue_date when given. Pure; honest zeros/N-A downstream.
 */
export function aggregateTyres(rows = [], fromISO = '', toISO = '') {
  const inRange = (d) => {
    if (!d) return !fromISO && !toISO
    const s = String(d).slice(0, 10)
    if (fromISO && s < fromISO) return false
    if (toISO && s > toISO) return false
    return true
  }
  const site = new Map(); const size = new Map(); const brand = new Map(); const month = new Map()
  const siteCost = new Map(); const siteKm = new Map()
  const remSite = new Map(); const remMonth = new Map()
  // Per-brand: total qty, cost (+ qty priced) for an average cost, km (+ count) for an average life.
  const brandCost = new Map(); const brandCostQty = new Map()
  const brandKm = new Map(); const brandKmN = new Map()
  let total = 0; let removed = 0
  for (const r of rows) {
    const s = String(r.site || 'Unspecified')
    // Removals: counted on removal_date (a tyre taken off in the window).
    if (r.removal_date && inRange(r.removal_date)) {
      const q = Number(r.qty) > 0 ? Number(r.qty) : 1
      removed += q
      remSite.set(s, (remSite.get(s) || 0) + q)
      const rmk = String(r.removal_date).slice(0, 7)
      if (/^\d{4}-\d{2}$/.test(rmk)) remMonth.set(rmk, (remMonth.get(rmk) || 0) + q)
    }
    if (!inRange(r.issue_date)) continue
    const qty = Number(r.qty) > 0 ? Number(r.qty) : 1
    total += qty
    const z = String(r.size || 'Unknown')
    const b = String(r.brand || 'Unknown')
    site.set(s, (site.get(s) || 0) + qty)
    size.set(z, (size.get(z) || 0) + qty)
    brand.set(b, (brand.get(b) || 0) + qty)
    const mk = String(r.issue_date || '').slice(0, 7)
    if (/^\d{4}-\d{2}$/.test(mk)) month.set(mk, (month.get(mk) || 0) + qty)
    const unitCost = Number(r.cost_per_tyre) || 0
    const cost = unitCost * qty
    const km = Number(r.total_km) || 0
    if (km > 0 && cost > 0) {
      siteCost.set(s, (siteCost.get(s) || 0) + cost)
      siteKm.set(s, (siteKm.get(s) || 0) + km)
    }
    if (unitCost > 0) {
      brandCost.set(b, (brandCost.get(b) || 0) + cost)
      brandCostQty.set(b, (brandCostQty.get(b) || 0) + qty)
    }
    if (km > 0) {
      brandKm.set(b, (brandKm.get(b) || 0) + km)
      brandKmN.set(b, (brandKmN.get(b) || 0) + 1)
    }
  }
  const rowsOf = (m) => [...m.entries()].map(([label, value]) => ({ label, value }))
  const cpkSite = [...siteKm.entries()]
    .map(([s, km]) => ({ label: s, value: km > 0 ? (siteCost.get(s) || 0) / km : 0 }))
    .filter((r) => r.value > 0)
  const months = [...month.keys()].sort()
  const remMonths = [...remMonth.keys()].sort()
  const avgCostByBrand = [...brandCostQty.entries()]
    .map(([b, q]) => ({ label: b, value: q > 0 ? (brandCost.get(b) || 0) / q : 0 }))
    .filter((r) => r.value > 0)
  const avgKmByBrand = [...brandKmN.entries()]
    .map(([b, n2]) => ({ label: b, value: n2 > 0 ? (brandKm.get(b) || 0) / n2 : 0 }))
    .filter((r) => r.value > 0)
  return {
    total,
    removed,
    bySite: rowsOf(site),
    bySize: rowsOf(size),
    byBrand: rowsOf(brand),
    avgCostByBrand,
    avgKmByBrand,
    cpkSite,
    removalBySite: rowsOf(remSite),
    monthLabels: months.map((mk) => monthLabel(mk)),
    monthQty: months.map((mk) => month.get(mk) || 0),
    remMonthLabels: remMonths.map((mk) => monthLabel(mk)),
    remMonthQty: remMonths.map((mk) => remMonth.get(mk) || 0),
  }
}


/**
 * Rows + columns for the Excel export.
 *
 * Single country: the legacy Store / Top Item / Month rows with one Spend column,
 * in that country's currency (unchanged).
 * All countries: per-country rows only (country total, category split and the
 * per-site spend), with ONE COLUMN PER CURRENCY, so SAR, AED and EGP never land
 * in the same column and can never be added into one meaningless total.
 *
 * @param {{isAll:boolean, currency?:string, snap?:Object|null,
 *          byCountry?:Array<Object>, siteGroups?:Array<Object>}} args
 * @returns {{rows:Array<Object>, columns:string[], headers:string[]}}
 */
export function buildExpenseExport({ isAll, currency = 'SAR', snap = null, byCountry = [], siteGroups = [], currencyOf = currencyForCountryCode } = {}) {
  if (!isAll) {
    const s = snap && snap.ok ? snap : null
    const rows = []
    ;(s?.by_store || []).forEach((r) => rows.push({ section: 'Store', name: r.label, spend: Number(r.spend) || 0, count: '' }))
    ;(s?.top_items || []).forEach((r) => rows.push({ section: 'Top Item', name: r.label, spend: Number(r.spend) || 0, count: Number(r.n) || '' }))
    ;(s?.monthly || []).forEach((r) => rows.push({ section: 'Month', name: monthLabel(r.m), spend: Number(r.total) || 0, count: '' }))
    return { rows, columns: ['section', 'name', 'spend', 'count'], headers: ['Section', 'Name', 'Spend', 'Count'] }
  }

  const currencies = []
  const trackCurrency = (cur) => { if (cur && !currencies.includes(cur)) currencies.push(cur); return cur }
  const rows = []
  const push = (country, cur, section, name, amount, lines) => rows.push({
    country: country || 'N/A',
    section,
    name: name == null || name === '' ? 'N/A' : name,
    [cur]: Number(amount) || 0,
    count: lines == null || lines === '' ? '' : Number(lines) || 0,
  })

  ;(byCountry || []).forEach((c) => {
    const cur = trackCurrency(currencyOf(c.country, currency))
    push(c.country, cur, 'Country total', c.country, c.total, c.lines)
    push(c.country, cur, 'Category', 'Tyres', c.tyre, '')
    push(c.country, cur, 'Category', 'Spare parts', c.spare, '')
    push(c.country, cur, 'Category', 'Oil', c.oil, '')
  })
  ;(siteGroups || []).forEach((g) => {
    const cur = trackCurrency(g.currency || currencyOf(g.country, currency))
    ;(g.rows || []).forEach((r) => push(g.country, cur, 'Site', r.site, r.total, r.lines))
  })

  return {
    rows,
    columns: ['country', 'section', 'name', ...currencies, 'count'],
    headers: ['Country', 'Section', 'Name', ...currencies, 'Count'],
  }
}


export const UNMAPPED_PREFIX = 'Unmapped: '

/**
 * Shape one site group's rows for the site register table. Each row gains
 * `unmapped` + `storeCode`, and amounts stay null when the source omitted them.
 * @param {Array<object>} rows
 * @returns {Array<object>}
 */
export function siteTableRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((r, i) => {
    const site = String(r?.site ?? '')
    const unmapped = site.startsWith(UNMAPPED_PREFIX)
    return {
      key: `${site}-${i}`,
      site,
      unmapped,
      storeCode: unmapped ? site.slice(UNMAPPED_PREFIX.length) : null,
      label: unmapped ? site.slice(UNMAPPED_PREFIX.length) : site,
      tyre: finite(r?.tyre),
      spare: finite(r?.spare),
      oil: finite(r?.oil),
      total: finite(r?.total),
      lines: finite(r?.lines),
    }
  })
}

/**
 * Headline figures for one site group. All amounts belong to ONE currency (a
 * group is one country), so summing inside the group is legitimate.
 * `total` is null when no row carried a measurable total.
 */
export function siteTableSummary(rows = []) {
  const list = siteTableRows(rows)
  let total = null
  let lines = 0
  let unmapped = 0
  let unmappedSpend = null
  let top = null
  for (const r of list) {
    if (r.total != null) {
      total = (total ?? 0) + r.total
      if (!top || r.total > top.total) top = r
    }
    if (r.lines != null) lines += r.lines
    if (r.unmapped) {
      unmapped += 1
      if (r.total != null) unmappedSpend = (unmappedSpend ?? 0) + r.total
    }
  }
  return {
    sites: list.length,
    total,
    lines,
    unmapped,
    unmappedSpend,
    unmappedShare: total && unmappedSpend != null ? unmappedSpend / total : (total ? 0 : null),
    topSite: top ? top.label : null,
    topSpend: top ? top.total : null,
  }
}

/**
 * Filter site rows by a free-text search and a mapping state
 * ('all' | 'mapped' | 'unmapped').
 */
export function filterSiteRows(rows = [], { search = '', mapping = 'all' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (mapping === 'mapped' && r.unmapped) return false
    if (mapping === 'unmapped' && !r.unmapped) return false
    if (!q) return true
    return String(r.label || '').toLowerCase().includes(q) || String(r.site || '').toLowerCase().includes(q)
  })
}

/**
 * CPK-by-asset-type register rows (get_fleet_cpk by_type), keyed and with the
 * currency resolved per row. CPK stays null when there is no denominator.
 */
export function cpkTypeRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).map((r, i) => ({
    key: `${r?.country ?? ''}-${r?.vehicle_type ?? ''}-${r?.unit ?? ''}-${i}`,
    vehicle_type: r?.vehicle_type ?? 'N/A',
    country: r?.country ?? null,
    currency: r?.currency || r?.country || '',
    unit: r?.unit || 'km',
    distance_or_hours: finite(r?.distance_or_hours),
    tyre_cost: finite(r?.tyre_cost),
    total_cost: finite(r?.total_cost),
    cpk_tyre: finite(r?.cpk_tyre),
    cpk_total: finite(r?.cpk_total),
  }))
}

/** Summary over CPK-by-type rows: how many types are measurable, and the worst. */
export function cpkTypeSummary(rows = []) {
  const list = cpkTypeRows(rows)
  const measured = list.filter((r) => r.cpk_total != null)
  const worst = measured.reduce((w, r) => (!w || r.cpk_total > w.cpk_total ? r : w), null)
  return {
    types: list.length,
    measured: measured.length,
    unmeasured: list.length - measured.length,
    worstType: worst ? worst.vehicle_type : null,
    worstCountry: worst ? worst.country : null,
  }
}
