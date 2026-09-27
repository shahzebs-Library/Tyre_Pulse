/**
 * fleetHealthBoardAnalytics - pure engine for the Fleet Health Board.
 *
 * HONESTY RULES
 *  - A tyre is "assessed" only when it carries a risk_level or a tread depth.
 *    The previous board scored an unassessed tyre as 50 (and a vehicle with no
 *    assessed tyre as a real 50%), so a fleet nobody had rated read as a
 *    uniform "fair". Unassessed now means null / "Not assessed".
 *  - Fleet health % counts vehicles with at least one RATED tyre; a vehicle
 *    with no rating is neither healthy nor unhealthy. No rated vehicle means
 *    null, not 100%.
 *  - Average tread is over tyres that recorded a tread; none means null, not
 *    "0.0mm".
 *
 * No I/O. Date-dependent helpers take `now` / an anchor explicitly.
 */

export const RISK_LEVELS = ['Critical', 'High', 'Medium', 'Low']
const RISK_RANK = { Critical: 4, High: 3, Medium: 2, Low: 1 }
const RISK_POINTS = { Low: 100, Medium: 65, High: 30, Critical: 0 }

export const isRated = (t) => t && RISK_RANK[t.risk_level] != null
export const hasTread = (t) => t && t.tread_depth != null && t.tread_depth !== '' && Number.isFinite(Number(t.tread_depth))
export const isAssessed = (t) => isRated(t) || hasTread(t)

/** 0-100 health for one tyre, or null when nothing about it was measured. */
export function tyreHealth(t) {
  const r = isRated(t) ? RISK_POINTS[t.risk_level] : null
  const tr = hasTread(t) ? Math.min(100, Math.max(0, (Number(t.tread_depth) / 8) * 100)) : null
  if (r != null && tr != null) return r * 0.7 + tr * 0.3
  if (r != null) return r
  if (tr != null) return tr
  return null
}

/** Mean health of a vehicle's assessed tyres; null when none assessed. */
export function vehicleHealthScore(tyres = []) {
  const vals = tyres.map(tyreHealth).filter(v => v != null)
  if (!vals.length) return null
  return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length)
}

/** Worst recorded risk level, or null when no tyre is rated. */
export function worstRisk(tyres = []) {
  let worst = null
  for (const t of tyres) {
    if (!isRated(t)) continue
    if (!worst || RISK_RANK[t.risk_level] > RISK_RANK[worst]) worst = t.risk_level
  }
  return worst
}

export function riskCounts(tyres = []) {
  const out = { Critical: 0, High: 0, Medium: 0, Low: 0, unrated: 0 }
  for (const t of tyres) {
    if (isRated(t)) out[t.risk_level] += 1
    else out.unrated += 1
  }
  return out
}

export function avgTread(tyres = []) {
  const vals = tyres.filter(hasTread).map(t => Number(t.tread_depth))
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
}

/** Group active tyre rows into vehicles keyed on asset_no. */
export function groupVehicles(records = []) {
  const map = new Map()
  for (const r of records) {
    if (!r?.asset_no) continue
    if (!map.has(r.asset_no)) map.set(r.asset_no, { asset_no: r.asset_no, site: r.site ?? null, country: r.country ?? null, tyres: [] })
    map.get(r.asset_no).tyres.push(r)
  }
  return map
}

/** Derived fields every surface (cards, list, export) reads. */
export function enrichVehicle(v) {
  const tyres = v.tyres || []
  const dates = tyres.map(t => t.issue_date).filter(Boolean).sort()
  const counts = riskCounts(tyres)
  return {
    ...v,
    score: vehicleHealthScore(tyres),
    worst: worstRisk(tyres),
    counts,
    rated: tyres.length - counts.unrated,
    avgTread: avgTread(tyres),
    lastIssue: dates.length ? dates[dates.length - 1] : null,
  }
}

/** Does a vehicle's worst risk pass the risk filter ('All' | level | 'Unrated')? */
export function matchesRiskFilter(worst, filter) {
  if (filter === 'All') return true
  if (filter === 'Unrated') return worst == null
  if (filter === 'Critical') return worst === 'Critical'
  if (filter === 'High') return worst === 'Critical' || worst === 'High'
  if (filter === 'Medium') return worst === 'Critical' || worst === 'High' || worst === 'Medium'
  if (filter === 'Low') return worst === 'Low'
  return true
}

/** Text search over asset, site and country. */
export function matchesSearch(v, q) {
  const s = String(q || '').trim().toLowerCase()
  if (!s) return true
  return [v.asset_no, v.site, v.country].some(x => String(x ?? '').toLowerCase().includes(s))
}

/** Healthy = has a rating and nothing High/Critical. null when unrated. */
export function isVehicleHealthy(v) {
  if (!v.tyres?.some(isRated)) return null
  return !v.tyres.some(t => t.risk_level === 'Critical' || t.risk_level === 'High')
}

/** The KPI tiles from counts the page already scoped. */
export function fleetHealthSummary({ total, criticalVehicles, healthyVehicles, ratedVehicles, scopedTyres = [] }) {
  const assessedTyres = scopedTyres.filter(isAssessed).length
  const ratedTyres = scopedTyres.filter(isRated).length
  const atRiskCount = scopedTyres.filter(t => t.risk_level === 'Critical' || t.risk_level === 'High').length
  const tread = avgTread(scopedTyres)
  return {
    total,
    criticalVehicles,
    ratedVehicles,
    fleetHealth: ratedVehicles > 0 ? Math.round((healthyVehicles / ratedVehicles) * 100) : null,
    atRiskCount: ratedTyres > 0 ? atRiskCount : null,
    ratedTyres,
    assessedTyres,
    tyreCount: scopedTyres.length,
    avgTread: tread == null ? null : Number(tread.toFixed(1)),
    treadCount: scopedTyres.filter(hasTread).length,
  }
}

/** Latest issue_date in a set of rows as a local Date, or null. */
export function latestIssueDate(rows = []) {
  let max = null
  for (const r of rows) if (r?.issue_date && (!max || r.issue_date > max)) max = r.issue_date
  return max ? new Date(`${String(max).slice(0, 10)}T00:00:00`) : null
}

/**
 * Monthly share of rated vehicles with no High/Critical tyre, for the 12 months
 * ending at `anchor`. A month with no rated vehicle is null (gap), not 100.
 */
export function monthlyHealthTrend(rows = [], anchor = new Date()) {
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() - 11 + i, 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
  const byMonth = new Map(months.map(m => [m, new Map()]))
  for (const r of rows) {
    const k = r?.issue_date ? String(r.issue_date).slice(0, 7) : null
    if (!k || !byMonth.has(k) || !r.asset_no) continue
    const assets = byMonth.get(k)
    if (!assets.has(r.asset_no)) assets.set(r.asset_no, [])
    assets.get(r.asset_no).push(r)
  }
  const values = months.map(m => {
    const vehicles = [...byMonth.get(m).values()].filter(tyres => tyres.some(isRated))
    if (!vehicles.length) return null
    const healthy = vehicles.filter(tyres => !tyres.some(t => t.risk_level === 'Critical' || t.risk_level === 'High')).length
    return Math.round((healthy / vehicles.length) * 100)
  })
  return { months, values }
}

/** Vehicles with a Critical tyre, lowest recorded tread first (unknown tread last). */
export function criticalVehicles(vehicles = []) {
  return vehicles
    .filter(v => v.tyres.some(t => t.risk_level === 'Critical'))
    .map(v => {
      const crit = v.tyres.filter(t => t.risk_level === 'Critical')
      const withTread = crit.filter(hasTread).sort((a, b) => Number(a.tread_depth) - Number(b.tread_depth))
      const worst = withTread[0] || crit[0]
      return { ...v, worstTread: hasTread(worst) ? Number(worst.tread_depth) : null, worstPos: worst?.position ?? null }
    })
    .sort((a, b) => (a.worstTread ?? Infinity) - (b.worstTread ?? Infinity))
}

/** Last six RATED readings for one asset, oldest first. */
export function assetRiskTrend(rows = [], assetNo) {
  const pts = rows
    .filter(r => r.asset_no === assetNo && r.issue_date && isRated(r))
    .sort((a, b) => String(a.issue_date).localeCompare(String(b.issue_date)))
    .slice(-6)
  return pts.map(r => ({ date: String(r.issue_date).slice(0, 10), value: { Critical: 0, High: 33, Medium: 66, Low: 100 }[r.risk_level] }))
}

/** Whole days since `issueDate` at `now`, or null. */
export function daysSince(issueDate, now = new Date()) {
  if (!issueDate) return null
  const t = new Date(issueDate).getTime()
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((now.getTime() - t) / 86400000))
}

/** Flat rows for Excel/PDF. */
export function vehicleExportRows(vehicles = []) {
  return vehicles.map(v => ({
    asset_no: v.asset_no,
    site: v.site ?? 'N/A',
    country: v.country ?? 'N/A',
    health: v.score == null ? 'Not assessed' : v.score,
    worst: v.worst ?? 'Not rated',
    critical: v.counts.Critical,
    high: v.counts.High,
    medium: v.counts.Medium,
    low: v.counts.Low,
    unrated: v.counts.unrated,
    tyres: v.tyres.length,
    avgTread: v.avgTread == null ? 'N/A' : Number(v.avgTread.toFixed(1)),
    lastIssue: v.lastIssue ?? 'N/A',
  }))
}
