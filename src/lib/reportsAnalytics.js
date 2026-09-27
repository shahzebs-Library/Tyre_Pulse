/**
 * reportsAnalytics - pure engine behind the Reports wizard (/reports).
 *
 * The wizard used to shape its rows inline; this is that logic in one tested
 * place, with one honesty change: an unpriced tyre (no cost_per_tyre) is not a
 * tyre that cost 0. Its cost is null, group totals sum only priced lines, and
 * every group says how many of its lines were priced. A group with no priced
 * line reports N/A (null), never a fabricated 0. No I/O.
 */

const HIGH = new Set(['High', 'Critical'])

function num(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** cost_per_tyre x qty (qty defaults to 1), or null when the tyre is unpriced. */
export function lineCost(r) {
  const unit = num(r?.cost_per_tyre)
  if (unit == null) return null
  const q = num(r?.qty)
  return unit * (q == null ? 1 : q)
}

/** Human interval for a PM program ("3 months", "10000 km"), '' when undefined. */
export function pmIntervalSummary(p) {
  const v = p?.interval_value
  if (v != null && v !== '' && p?.interval_type) return `${v} ${p.interval_type}`
  if (p?.meter_interval != null && p?.meter_interval !== '' && p?.meter_source && p.meter_source !== 'none') {
    const unit = p.meter_source === 'engine_hours' ? 'hours' : 'km'
    return `${p.meter_interval} ${unit}`
  }
  return ''
}

function roundOrNull(v) {
  return v == null ? null : Math.round(v)
}

/** One row per asset, most expensive first. */
export function groupVehicleHistory(raw) {
  const grouped = new Map()
  for (const r of Array.isArray(raw) ? raw : []) {
    const key = r.asset_no ?? 'Unknown'
    let g = grouped.get(key)
    if (!g) {
      g = { asset_no: key, site: r.site ?? '', country: r.country ?? '', count: 0, cost: 0, priced: 0, brands: new Set(), last_date: '', high: 0 }
      grouped.set(key, g)
    }
    g.count += 1
    const c = lineCost(r)
    if (c != null) { g.cost += c; g.priced += 1 }
    if (r.brand) g.brands.add(r.brand)
    if (r.issue_date && (!g.last_date || r.issue_date > g.last_date)) g.last_date = r.issue_date
    if (HIGH.has(r.risk_level)) g.high += 1
  }
  return [...grouped.values()].map(g => ({
    asset_no: g.asset_no,
    site: g.site,
    country: g.country,
    count: g.count,
    priced_count: g.priced,
    total_cost: g.priced ? Math.round(g.cost) : null,
    avg_cost: g.priced ? Math.round(g.cost / g.priced) : null,
    brands: [...g.brands].join(', '),
    last_date: g.last_date,
    high_risk_count: g.high,
  })).sort((a, b) => (b.total_cost ?? -1) - (a.total_cost ?? -1) || String(a.asset_no).localeCompare(String(b.asset_no)))
}

/** One row per site and brand, most expensive first. */
export function groupCostAnalysis(raw) {
  const grouped = new Map()
  for (const r of Array.isArray(raw) ? raw : []) {
    const key = `${r.site ?? ''}|${r.brand ?? ''}`
    let g = grouped.get(key)
    if (!g) {
      g = { site: r.site ?? '', brand: r.brand ?? '', country: r.country ?? '', count: 0, cost: 0, priced: 0 }
      grouped.set(key, g)
    }
    g.count += 1
    const c = lineCost(r)
    if (c != null) { g.cost += c; g.priced += 1 }
  }
  return [...grouped.values()].map(g => ({
    site: g.site,
    brand: g.brand,
    country: g.country,
    count: g.count,
    priced_count: g.priced,
    total_cost: g.priced ? Math.round(g.cost) : null,
    avg_cost: g.priced ? Math.round(g.cost / g.priced) : null,
  })).sort((a, b) => (b.total_cost ?? -1) - (a.total_cost ?? -1) || a.site.localeCompare(b.site))
}

/** Row-level tyre reports: cost is the line cost, null when unpriced. */
export function tyreLineRows(raw) {
  return (Array.isArray(raw) ? raw : []).map(r => {
    const c = lineCost(r)
    return { ...r, cost: c == null ? null : Math.round(c * 100) / 100 }
  })
}

const COST_KEY = {
  'Vehicle History': 'total_cost',
  'Cost Analysis': 'total_cost',
  'Tyre Replacement Log': 'cost',
  'Risk Summary': 'cost',
  'Preventive Maintenance': 'estimated_cost',
  'PM Service History': 'total_cost',
}

const COUNT_KEY = {
  'Vehicle History': 'count',
  'Cost Analysis': 'count',
}

/**
 * Headline figures for the preview KPI strip. `records` is the number of
 * underlying source records (a grouped report sums its counts), `rows` the
 * number of lines in the report. Cost is null when nothing is priced.
 */
export function summarizeReport(type, rows) {
  const list = Array.isArray(rows) ? rows : []
  const costKey = COST_KEY[type]
  const countKey = COUNT_KEY[type]
  let records = 0
  let cost = 0
  let priced = 0
  const assets = new Set()
  const sites = new Set()
  let highRisk = 0
  for (const r of list) {
    records += countKey ? (Number(r[countKey]) || 0) : 1
    if (costKey) {
      const v = num(r[costKey])
      if (v != null) { cost += v; priced += 1 }
    }
    if (r.asset_no) assets.add(String(r.asset_no))
    if (r.site) sites.add(String(r.site))
    if (type === 'Vehicle History') highRisk += Number(r.high_risk_count) || 0
    else if (HIGH.has(r.risk_level)) highRisk += 1
  }
  return {
    rows: list.length,
    records,
    totalCost: costKey && priced ? Math.round(cost) : null,
    pricedRows: priced,
    hasCost: !!costKey,
    assets: assets.size,
    sites: sites.size,
    highRisk,
  }
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

/** Escaped HTML table for the print window. */
export function printableTableHtml(rows, cols, labelFor) {
  const head = cols.map(c => `<th>${escapeHtml(labelFor(c))}</th>`).join('')
  const body = (Array.isArray(rows) ? rows : [])
    .map(r => `<tr>${cols.map(c => `<td>${escapeHtml(r[c] == null || r[c] === '' ? 'N/A' : r[c])}</td>`).join('')}</tr>`)
    .join('')
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
}
