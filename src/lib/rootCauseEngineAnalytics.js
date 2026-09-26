/**
 * rootCauseEngineAnalytics - pure engine behind /root-cause-engine.
 *
 * Rule-based classification of tyre records into 14 engineering root causes,
 * plus every aggregate the page shows (KPIs, frequency, cost, site heat map,
 * per-cause deep dive, worst vehicles, exports). No I/O, no clock reads: every
 * time-dependent helper takes an injectable `now`.
 *
 * HONESTY RULES
 *  - A figure that cannot be measured is null (rendered N/A), never 0.
 *    Cost is null when no record in the set carries a price; CPK is null when
 *    no record carries BOTH a price and a measurable km life.
 *  - Money is never blended across currencies. `resolveCurrency` returns null
 *    when the loaded rows span countries with different currencies; the page
 *    then withholds every money figure instead of adding SAR to AED to EGP.
 *  - No currency code is ever defaulted. An unknown country yields null.
 */

import { COUNTRY_CURRENCY } from './countryComparisonAnalytics'

export const ROOT_CAUSES = Object.freeze([
  'Under Inflation',
  'Over Inflation',
  'Alignment Issues',
  'Suspension Issues',
  'Wheel Balancing',
  'Brake Problems',
  'Driver Behavior',
  'Road Conditions',
  'Load Conditions',
  'Overloading',
  'Maintenance Quality',
  'Manufacturing Defects',
  'Rotation Compliance',
  'Operational Misuse',
])

export const PREVENTION_MAP = Object.freeze({
  'Under Inflation': 'Implement weekly pressure checks. Install TPMS sensors on all vehicles. Train drivers on visual inspection. Set a pressure alert threshold of 10 PSI either side of spec.',
  'Over Inflation': 'Review inflation procedures. Calibrate all pressure gauges quarterly. Enforce manufacturer spec inflation. Avoid inflating tyres hot.',
  'Alignment Issues': 'Schedule alignment checks every 20,000 km or after impact events. Inspect after any suspension repair. Review camber and toe settings.',
  'Suspension Issues': 'Inspect shock absorbers every 50,000 km. Implement a suspension check during tyre rotation. Replace worn components before tyre installation.',
  'Wheel Balancing': 'Balance all tyres at fitment. Re-balance at 10,000 km intervals. Inspect wheel weights after any impact.',
  'Brake Problems': 'Inspect the braking system before tyre installation on affected axles. Address brake drag immediately. Train drivers on smooth braking technique.',
  'Driver Behavior': 'Implement driver behaviour monitoring (telematics). Run defensive driving training. Review high km-loss records with fleet managers.',
  'Road Conditions': 'Map high-risk routes and apply tyre specification upgrades. Increase inspection frequency for affected routes. Carry puncture repair kits.',
  'Load Conditions': 'Audit load distribution procedures. Verify load ratings match tyre spec. Inspect tyres after heavy load runs.',
  'Overloading': 'Enforce maximum load compliance. Install load monitoring. Reject overloaded assignments until corrected.',
  'Maintenance Quality': 'Audit workshop quality standards. Implement a pre-fitment tread depth check. Enforce mandatory service intervals.',
  'Manufacturing Defects': 'Raise warranty claims for qualifying records. Audit supplier quality. Implement incoming tyre inspection before fitment.',
  'Rotation Compliance': 'Implement a rotation schedule at 10,000 km intervals. Log all rotations in the system. Audit steer position wear patterns monthly.',
  'Operational Misuse': 'Enforce tyre specification matching for vehicle type. Prohibit retread use on steer axles where policy forbids it. Audit mixed tyre usage.',
})

export const DATE_PRESETS = Object.freeze([
  { label: 'Last 30d', days: 30 },
  { label: 'Last 90d', days: 90 },
  { label: 'Last 6mo', days: 180 },
  { label: 'Last 1yr', days: 365 },
  { label: 'All Time', days: null },
])

export const RISK_LEVELS = Object.freeze(['Critical', 'High', 'Medium', 'Low'])

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

/** Free text a record carries about why it was removed. */
export function findingsText(r) {
  return String(r?.findings || r?.description || r?.remarks || '').trim()
}

/** km life of one tyre, null unless removal is measurably after fitment. */
export function kmLife(r) {
  const fit = num(r?.km_at_fitment)
  const rem = num(r?.km_at_removal)
  return fit !== null && rem !== null && rem > fit ? rem - fit : null
}

/** Money for one record line (price x qty), null when unpriced. */
export function lineCost(r) {
  const c = num(r?.cost_per_tyre)
  if (c === null || c <= 0) return null
  const q = num(r?.qty)
  return c * (q && q > 0 ? q : 1)
}

// ─── Classification ──────────────────────────────────────────────────────────

/** The 14-cause rule set. Returns the list of causes a record matches. */
export function classifyRootCauses(record) {
  const findings = findingsText(record).toLowerCase()
  const category = String(record?.category || '').toLowerCase()
  const removalReason = String(record?.removal_reason || '').toLowerCase()
  const position = String(record?.position || '').toLowerCase()
  const combined = findings + ' ' + category + ' ' + removalReason

  const pressure = num(record?.pressure_reading)
  const tread = num(record?.tread_depth)
  const cost = num(record?.cost_per_tyre)
  const kmFit = num(record?.km_at_fitment)
  const kmRem = num(record?.km_at_removal)
  const life = kmFit !== null && kmRem !== null ? kmRem - kmFit : null
  const riskLevel = String(record?.risk_level || '').trim()

  const matched = []

  if (/under|low pressure|under inflat|deflat|flat/.test(combined) ||
    (pressure !== null && pressure < 70) ||
    (tread !== null && tread < 2 && riskLevel === 'Critical')) matched.push('Under Inflation')

  if (/over inflat|over pressure|high pressure|burst|blowout/.test(combined) ||
    (pressure !== null && pressure > 130)) matched.push('Over Inflation')

  if (/align|toe|camber|caster|irregular wear|one-sided|feathering/.test(combined) ||
    /alignment|irregular/.test(category)) matched.push('Alignment Issues')

  if (/suspension|shock|absorber|strut|cupping|scallop/.test(combined)) matched.push('Suspension Issues')

  if (/balanc|vibrat|wobble|shimmy|cupping/.test(combined)) matched.push('Wheel Balancing')

  if (/brake|lock|flat spot|skid|drag/.test(combined)) matched.push('Brake Problems')

  if (/driver|speeding|hard brake|curb|pothole strike|impact|abuse/.test(combined) ||
    (life !== null && life < 10000 && riskLevel === 'Critical')) matched.push('Driver Behavior')

  if (/road|gravel|debris|nail|cut|puncture|kerb|pothole/.test(combined) ||
    /puncture|cut|impact/.test(category)) matched.push('Road Conditions')

  if (/\bload\b|weight|cargo/.test(combined) && !/overload/.test(combined)) matched.push('Load Conditions')

  if (/overload|excess load|over weight|over capacity/.test(combined) ||
    (life !== null && life < 20000 && cost !== null && cost > 1500)) matched.push('Overloading')

  if (/maintenan|service|neglect|worn|deteriorat|age/.test(combined) ||
    (tread !== null && tread < 1.6)) matched.push('Maintenance Quality')

  if (/defect|manufactur|warranty|delamination|bead|sidewall crack|bulge/.test(combined) ||
    /defect|warranty/.test(category)) matched.push('Manufacturing Defects')

  if (/rotat|not rotated|overdue rotation/.test(combined) ||
    (/steer/.test(position) && life !== null && life < 30000 &&
      (riskLevel === 'High' || riskLevel === 'Critical'))) matched.push('Rotation Compliance')

  if (/misuse|wrong tyre|wrong size|retread abuse|off-road|overspec/.test(combined) ||
    /misuse/.test(category)) matched.push('Operational Misuse')

  return matched
}

// ─── Scope helpers ───────────────────────────────────────────────────────────

/** ISO date (YYYY-MM-DD) the preset starts at, null for All Time / unknown. */
export function presetCutoff(label, now = new Date()) {
  const preset = DATE_PRESETS.find(p => p.label === label)
  if (!preset || preset.days == null) return null
  const d = new Date(now.getTime())
  d.setUTCDate(d.getUTCDate() - preset.days)
  return d.toISOString().slice(0, 10)
}

/**
 * The currency every money figure is in, or null when it cannot be stated:
 *  - a specific country: that country's currency (activeCurrency wins when
 *    given, it already comes from the country), else the country map;
 *  - All countries: the one currency the loaded rows share, else null (mixed).
 */
export function resolveCurrency(records = [], activeCountry, activeCurrency) {
  if (activeCountry && activeCountry !== 'All') {
    return COUNTRY_CURRENCY[activeCountry] || activeCurrency || null
  }
  const countries = [...new Set((records || []).map(r => r?.country).filter(Boolean))]
  const currencies = [...new Set(countries.map(c => COUNTRY_CURRENCY[c] || `?${c}`))]
  if (currencies.length !== 1 || currencies[0].startsWith('?')) return null
  return currencies[0]
}

/** Records inside the filters. Rows with no issue_date survive a date window (they cannot be placed). */
export function filterRecords(records = [], { cutoff = null, site = 'all', risk = 'all', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (records || []).filter(r => {
    if (cutoff && r.issue_date && String(r.issue_date).slice(0, 10) < cutoff) return false
    if (site !== 'all' && r.site !== site) return false
    if (risk !== 'all' && String(r.risk_level || '').trim() !== risk) return false
    if (q) {
      const hay = [r.asset_no, r.site, r.brand, r.tyre_serial, r.category, findingsText(r), r.removal_reason]
        .filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function classifyAll(records = []) {
  return (records || []).map(r => ({ ...r, rootCauses: classifyRootCauses(r) }))
}

// ─── Aggregates ──────────────────────────────────────────────────────────────

function sumOrNull(values) {
  const v = values.filter(x => x !== null)
  return v.length ? v.reduce((a, b) => a + b, 0) : null
}

/** CPK over records carrying BOTH a price and a km life: sum cost / sum km. */
export function cpkOf(records = []) {
  let cost = 0; let km = 0; let n = 0
  for (const r of records) {
    const c = lineCost(r); const k = kmLife(r)
    if (c !== null && k !== null) { cost += c; km += k; n++ }
  }
  return n > 0 && km > 0 ? cost / km : null
}

/** Per-cause stats: count, cost (null when none priced), priced count, records. */
export function computeCauseStats(classified = []) {
  const stats = {}
  ROOT_CAUSES.forEach(c => { stats[c] = { cause: c, count: 0, records: [] } })
  for (const r of classified) {
    for (const cause of r.rootCauses || []) {
      if (stats[cause]) { stats[cause].count++; stats[cause].records.push(r) }
    }
  }
  for (const c of ROOT_CAUSES) {
    const costs = stats[c].records.map(lineCost)
    stats[c].totalCost = sumOrNull(costs)
    stats[c].pricedCount = costs.filter(x => x !== null).length
  }
  return stats
}

export function sortCauses(stats = {}, minRecords = 1) {
  return ROOT_CAUSES
    .map(c => stats[c] || { cause: c, count: 0, totalCost: null, records: [] })
    .filter(c => c.count >= Math.max(1, minRecords))
    .sort((a, b) => b.count - a.count || a.cause.localeCompare(b.cause))
}

export function pct(part, whole) {
  return whole > 0 ? (part / whole) * 100 : null
}

/** Headline KPIs. Coverage is null on an empty set (nothing to cover). */
export function summarize(classified = [], sorted = []) {
  const total = classified.length
  const withCause = classified.filter(r => (r.rootCauses || []).length > 0)
  const costs = withCause.map(lineCost)
  const critical = classified.filter(r => String(r.risk_level || '').trim() === 'Critical').length
  return {
    total,
    classified: withCause.length,
    unclassified: total - withCause.length,
    coveragePct: pct(withCause.length, total),
    topCause: sorted[0] || null,
    causesActive: sorted.length,
    // Distinct-record cost (a tyre matching 3 causes is counted once here).
    classifiedCost: sumOrNull(costs),
    pricedShare: pct(costs.filter(c => c !== null).length, withCause.length),
    critical,
    avgCausesPerRecord: withCause.length
      ? withCause.reduce((s, r) => s + r.rootCauses.length, 0) / withCause.length
      : null,
  }
}

export function topN(records = [], key, n = 5) {
  const counts = {}
  for (const r of records) {
    const val = r?.[key]
    if (val) counts[val] = (counts[val] || 0) + 1
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([name, count]) => ({ name, count }))
}

/** Site x cause matrix over the top causes; sites with no match are dropped. */
export function buildHeatmap(classified = [], sorted = [], topCount = 8) {
  const topCauses = sorted.slice(0, topCount).map(c => c.cause)
  const matrix = {}
  for (const r of classified) {
    if (!r.site) continue
    for (const cause of r.rootCauses || []) {
      if (!topCauses.includes(cause)) continue
      matrix[r.site] = matrix[r.site] || {}
      matrix[r.site][cause] = (matrix[r.site][cause] || 0) + 1
    }
  }
  const sites = Object.keys(matrix).sort()
  const rows = sites.map(site => {
    const row = { site, total: 0 }
    for (const c of topCauses) { row[c] = matrix[site][c] || 0; row.total += row[c] }
    return row
  }).sort((a, b) => b.total - a.total || a.site.localeCompare(b.site))
  const maxVal = Math.max(0, ...rows.flatMap(r => topCauses.map(c => r[c])))
  return { topCauses, rows, maxVal }
}

/** Intensity band for a heat cell, 0..4 (0 = empty). */
export function heatBand(count, max) {
  if (!count || !max) return 0
  const ratio = count / max
  if (ratio > 0.75) return 4
  if (ratio > 0.5) return 3
  if (ratio > 0.25) return 2
  return 1
}

/** Everything the deep-dive panel shows for one cause. */
export function deepDive(stat, totalRecords) {
  const recs = stat?.records || []
  return {
    cause: stat?.cause || null,
    count: stat?.count || 0,
    pct: pct(stat?.count || 0, totalRecords),
    totalCost: stat?.totalCost ?? null,
    pricedCount: stat?.pricedCount || 0,
    avgCPK: cpkOf(recs),
    topAssets: topN(recs, 'asset_no', 5),
    topBrands: topN(recs, 'brand', 5),
    topSites: topN(recs, 'site', 5),
    prevention: PREVENTION_MAP[stat?.cause] || '',
    records: recs,
  }
}

/** Vehicles with the most cause matches. */
export function worstVehicles(classified = [], limit = 15) {
  const map = {}
  for (const r of classified) {
    if (!r.asset_no || !(r.rootCauses || []).length) continue
    const v = map[r.asset_no] || (map[r.asset_no] = {
      asset_no: r.asset_no, site: r.site || null, incidents: 0, records: 0, causeCounts: {}, recs: [],
    })
    v.incidents += r.rootCauses.length
    v.records += 1
    v.recs.push(r)
    for (const c of r.rootCauses) v.causeCounts[c] = (v.causeCounts[c] || 0) + 1
  }
  return Object.values(map).map(v => {
    const top = Object.entries(v.causeCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
    return {
      asset_no: v.asset_no,
      site: v.site,
      incidents: v.incidents,
      records: v.records,
      topCause: top ? top[0] : null,
      causes: Object.keys(v.causeCounts).length,
      totalCost: sumOrNull(v.recs.map(lineCost)),
      avgCPK: cpkOf(v.recs),
    }
  })
    .sort((a, b) => b.incidents - a.incidents || String(a.asset_no).localeCompare(String(b.asset_no)))
    .slice(0, limit)
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const RECORD_EXPORT_COLS = ['asset_no', 'site', 'brand', 'issue_date', 'risk_level', 'root_causes', 'cost', 'km_life', 'findings']

export function recordExportRows(classified = []) {
  return classified.map(r => ({
    asset_no: r.asset_no || '',
    site: r.site || '',
    brand: r.brand || '',
    issue_date: r.issue_date ? String(r.issue_date).slice(0, 10) : '',
    risk_level: r.risk_level || '',
    root_causes: (r.rootCauses || []).join('; ') || 'Unclassified',
    cost: lineCost(r) ?? '',
    km_life: kmLife(r) ?? '',
    findings: findingsText(r).slice(0, 200),
  }))
}

export function causeSummaryRows(sorted = [], total = 0) {
  return sorted.map(c => {
    const p = pct(c.count, total)
    return {
      cause: c.cause,
      count: c.count,
      pct: p === null ? 'N/A' : `${p.toFixed(1)}%`,
      total_cost: c.totalCost === null || c.totalCost === undefined ? 'N/A' : Math.round(c.totalCost),
      cpk: (() => { const v = cpkOf(c.records || []); return v === null ? 'N/A' : v.toFixed(4) })(),
      top_asset: topN(c.records || [], 'asset_no', 1)[0]?.name || 'N/A',
    }
  })
}
