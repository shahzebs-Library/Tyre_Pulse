/**
 * engineeringKpiAnalytics - pure presentation engine for the Engineering KPI
 * page (/engineering-kpi). The KPI MATHS stays in kpiEngine.computeAllKpis;
 * this module only shapes those results into tables, chart series, statuses
 * and export rows, and enforces the page's honesty rules:
 *
 *   - A KPI with no measurable input is null and reads "N/A", never a 0 that
 *     looks like a perfect (or catastrophic) fleet.
 *   - Failure rates are computed over RATED tyres only (risk_level recorded);
 *     nothing rated means null, not 0%.
 *   - Tyre COST totals come from the classified expense grid (governed cost
 *     split / per-asset grid map). tyre_records.cost_per_tyre is never summed
 *     for a total here: an asset missing from the grid reads null, not a
 *     partial cost_per_tyre figure.
 *   - A cost figure over more than one country is never blended into one
 *     number; the caller gets the per-country rows instead.
 *
 * No I/O, no clock reads: every date-dependent helper takes an injectable
 * `now`.
 */

/** A finite number, not null/undefined/NaN. */
export function isMeasured(v) {
  return v != null && v !== '' && Number.isFinite(Number(v))
}

const pad = (n) => String(n).padStart(2, '0')
const isoDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Date presets for the filter bar. Unknown preset clears the range. */
export function presetRange(preset, now = new Date()) {
  const base = new Date(now)
  if (preset === '30d') { const f = new Date(base); f.setDate(f.getDate() - 30); return { from: isoDay(f), to: isoDay(base) } }
  if (preset === '90d') { const f = new Date(base); f.setDate(f.getDate() - 90); return { from: isoDay(f), to: isoDay(base) } }
  if (preset === '6m')  { const f = new Date(base); f.setMonth(f.getMonth() - 6); return { from: isoDay(f), to: isoDay(base) } }
  if (preset === 'ytd') return { from: `${base.getFullYear()}-01-01`, to: isoDay(base) }
  return { from: '', to: '' }
}

export const DATE_PRESETS = [
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: '6m', label: 'Last 6 months' },
  { key: 'ytd', label: 'This year' },
]

/** The last `count` calendar months ending at `now`, as 'YYYY-MM', oldest first. */
export function monthAxis(count = 12, now = new Date()) {
  const out = []
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`)
  }
  return out
}

// ── Status bands (single place so cards, headline strip and exports agree) ──
export const STATUS_LABEL = { good: 'Good', warning: 'Warning', critical: 'Critical', neutral: 'Not measured' }

export function cpkStatus(cpk) {
  if (!isMeasured(cpk)) return 'neutral'
  return cpk < 1.0 ? 'good' : cpk < 2.0 ? 'warning' : 'critical'
}
export function lifeStatus(km) {
  if (!isMeasured(km) || km <= 0) return 'neutral'
  return km > 40000 ? 'good' : km > 20000 ? 'warning' : 'critical'
}
/** Higher-is-worse percentage (failure, scrap). */
export function lowerIsBetterPctStatus(pct, warnAt, critAt) {
  if (!isMeasured(pct)) return 'neutral'
  return pct > critAt ? 'critical' : pct > warnAt ? 'warning' : 'good'
}
/** Higher-is-better percentage (compliance, availability). */
export function higherIsBetterPctStatus(pct, goodAt, warnAt) {
  if (!isMeasured(pct)) return 'neutral'
  return pct > goodAt ? 'good' : pct > warnAt ? 'warning' : 'critical'
}

/**
 * The honest headline numbers the page renders. Every field is either a real
 * measurement or null, plus the basis a reader needs to trust it.
 */
export function headlineMetrics(kpis, { inspectionsLoaded = 0 } = {}) {
  if (!kpis) return null
  const fr = kpis.failureRate || {}
  const failurePct = fr.failureRate == null ? null : fr.failureRate * 100
  const ic = kpis.inspectionCompliance || {}
  const inspectionPct = inspectionsLoaded > 0 && ic.totalScheduled > 0 ? ic.compliancePct : null
  // Availability is derived from Critical risk ratings. With no tyre rated it
  // would always read 100% - a claim the data cannot support.
  const fa = kpis.fleetAvailability || {}
  const availabilityPct = (fr.ratedCount ?? 0) > 0 && fa.fleetSize > 0 ? fa.availabilityPct : null
  const cpk = kpis.cpk || {}
  const life = kpis.avgTyreLife || {}
  const scrap = kpis.scrapRate || {}
  return {
    cpk: cpk.validCount > 0 ? cpk.fleetAvgCpk : null,
    cpkCoveragePct: cpk.totalCount > 0 ? cpk.coveragePct : null,
    cpkValidCount: cpk.validCount ?? 0,
    cpkTotalCount: cpk.totalCount ?? 0,
    avgLifeKm: life.validCount > 0 ? life.avgKm : null,
    lifeValidCount: life.validCount ?? 0,
    failurePct,
    ratedCount: fr.ratedCount ?? 0,
    totalCount: fr.totalCount ?? 0,
    failureCount: fr.failureCount ?? null,
    inspectionPct,
    availabilityPct,
    unavailableCount: fa.unavailableCount ?? 0,
    scrapPct: scrap.totalCount > 0 ? scrap.scrapRate * 100 : null,
    pressurePct: isMeasured(kpis.pressureCompliance?.compliancePct) ? kpis.pressureCompliance.compliancePct : null,
  }
}

function groupBy(rows, keyFn) {
  const m = new Map()
  for (const r of rows || []) {
    const k = keyFn(r)
    if (!m.has(k)) m.set(k, [])
    m.get(k).push(r)
  }
  return m
}

const isRated = (r) => r && r.risk_level != null && String(r.risk_level).trim() !== ''
const isFailure = (r) => r.risk_level === 'High' || r.risk_level === 'Critical'

/** Failure % over RATED rows; null when none rated. */
export function ratedFailurePct(rows) {
  const rated = (rows || []).filter(isRated)
  if (!rated.length) return null
  return (rated.filter(isFailure).length / rated.length) * 100
}

function avgLifeOf(rows) {
  const lives = (rows || [])
    .map(r => Number(r.km_at_removal) - Number(r.km_at_fitment))
    .filter((v, i) => {
      const r = rows[i]
      const fit = Number(r.km_at_fitment), rem = Number(r.km_at_removal)
      return Number.isFinite(fit) && Number.isFinite(rem) && rem > fit && Number.isFinite(v)
    })
  return lives.length ? lives.reduce((s, v) => s + v, 0) / lives.length : null
}

function assetKey(v) {
  return String(v ?? '').trim().toUpperCase()
}

/**
 * Every asset with a measurable CPK, worst first. `gridMap` is the per-asset
 * expense-grid tyre cost (Map keyed on upper-cased asset_no) or null when the
 * grid is unavailable for the scope; an asset absent from it has totalCost null.
 */
export function assetCpkRows(kpis, records, gridMap = null) {
  if (!kpis?.cpkByAsset?.length) return []
  const byAsset = groupBy(records, r => r.asset_no ?? 'Unknown')
  return kpis.cpkByAsset.map((a, i) => {
    const rows = byAsset.get(a.asset_no) || []
    const grid = gridMap && typeof gridMap.get === 'function' ? gridMap.get(assetKey(a.asset_no)) : undefined
    return {
      rank: i + 1,
      assetNo: a.asset_no,
      cpk: isMeasured(a.avgCpk) ? a.avgCpk : null,
      avgLifeKm: avgLifeOf(rows),
      totalCost: isMeasured(grid) ? Number(grid) : null,
      failurePct: ratedFailurePct(rows),
      records: rows.length,
      cpkBand: cpkStatus(a.avgCpk),
    }
  })
}

/**
 * Brand scorecard from kpiEngine.vendorPerformance. The composite score is
 * kept as kpiEngine computes it; the failure % is re-derived over rated tyres
 * so an unrated brand reads N/A instead of a 0% that flatters it.
 */
export function brandScorecardRows(kpis, records) {
  const vp = kpis?.vendorPerformance || []
  if (!vp.length) return []
  const byBrand = groupBy(records, r => r.brand ?? 'Unknown')
  const total = vp.length
  const topN = Math.ceil(total * 0.3)
  const bottomFrom = total - Math.floor(total * 0.3)
  return vp.map((b, i) => ({
    rank: i + 1,
    brand: b.brand,
    avgCpk: isMeasured(b.avgCpk) && b.avgCpk > 0 ? b.avgCpk : null,
    failurePct: ratedFailurePct(byBrand.get(b.brand) || []),
    avgLifeKm: isMeasured(b.avgLife) && b.avgLife > 0 ? b.avgLife : null,
    scrapPct: isMeasured(b.scrapRate) && b.count > 0 ? b.scrapRate * 100 : null,
    score: isMeasured(b.score) ? b.score : null,
    count: b.count ?? 0,
    tier: total < 3 ? 'middle' : i < topN ? 'top' : i >= bottomFrom ? 'bottom' : 'middle',
  }))
}

/** Least-squares slope/intercept over y by index. */
export function linearFit(values) {
  const pts = values.map((y, x) => ({ x, y })).filter(p => isMeasured(p.y))
  const n = pts.length
  if (n < 2) return null
  const mx = pts.reduce((s, p) => s + p.x, 0) / n
  const my = pts.reduce((s, p) => s + p.y, 0) / n
  let num = 0, den = 0
  for (const p of pts) { num += (p.x - mx) * (p.y - my); den += (p.x - mx) ** 2 }
  const slope = den === 0 ? 0 : num / den
  return { slope, intercept: my - slope * mx }
}

/**
 * Monthly tyre (or maintenance/combined) spend trend from the governed grid
 * split. `split.byMonth` = [{ month, tyre, maintenance }]. Returns null when
 * the split is unavailable or blended across currencies.
 */
export function gridCostTrend(split, mode = 'tyres') {
  if (!split || split.blended || !Array.isArray(split.byMonth) || !split.byMonth.length) return null
  const pick = (m) => mode === 'maintenance' ? Number(m.maintenance) || 0
    : mode === 'combined' ? (Number(m.tyre) || 0) + (Number(m.maintenance) || 0)
    : Number(m.tyre) || 0
  const series = split.byMonth.map(m => ({ month: m.month, value: pick(m) }))
  const values = series.map(s => s.value)
  const fit = linearFit(values)
  const avgMonthly = values.reduce((s, v) => s + v, 0) / values.length
  // A slope under 1% of the average monthly spend is noise, not a direction.
  const threshold = Math.max(1, Math.abs(avgMonthly) * 0.01)
  const trend = !fit ? 'insufficient'
    : Math.abs(fit.slope) < threshold ? 'stable'
    : fit.slope > 0 ? 'worsening' : 'improving'
  return {
    series,
    slope: fit ? fit.slope : null,
    fitted: fit ? values.map((_, i) => Math.max(0, fit.intercept + fit.slope * i)) : null,
    forecastNextMonth: fit ? Math.max(0, fit.intercept + fit.slope * values.length) : null,
    avgMonthly,
    trend,
    currency: split.currency || null,
  }
}

/**
 * The single cost figure for the cost-mode switch, or the per-country rows
 * when the scope spans currencies. Never a blended scalar.
 */
export function costModeFigure(split, mode = 'tyres') {
  if (!split) return { amount: null, blended: false, byCountry: [], currency: null }
  if (split.blended) {
    const rows = (split.byCountry || []).map(r => ({
      country: r.country,
      currency: r.currency,
      amount: mode === 'maintenance' ? r.maintenance : mode === 'combined' ? (Number(r.tyre) || 0) + (Number(r.maintenance) || 0) : r.tyre,
    }))
    return { amount: null, blended: true, byCountry: rows, currency: null }
  }
  const t = Number(split.tyre) || 0
  const m = Number(split.maintenance) || 0
  const amount = mode === 'maintenance' ? m : mode === 'combined' ? t + m : t
  return { amount, blended: false, byCountry: [], currency: split.currency || null }
}

/** Failure % by site over rated tyres, worst first, max `limit` rows. */
export function failureBySite(kpis, limit = 12) {
  const rows = (kpis?.failureRate?.bySite || [])
    .filter(s => s.rate != null)
    .map(s => ({ site: s.site, pct: s.rate * 100, count: s.count }))
  return rows.slice(0, limit)
}

/** Inspection compliance % per axis month; null where a month has no schedule. */
export function inspectionSeries(kpis, axis) {
  const map = new Map((kpis?.inspectionCompliance?.byMonth || []).map(m => [m.month, m.compliancePct]))
  return axis.map(m => (map.has(m) ? map.get(m) : null))
}

/** Case-insensitive search + status filter over the 17 KPI cards. */
export function filterKpiCards(cards, { query = '', status = 'all' } = {}) {
  const q = String(query || '').trim().toLowerCase()
  return (cards || []).filter(c => {
    if (status !== 'all' && c.status !== status) return false
    if (!q) return true
    return [c.title, c.value, c.subValue, c.description].some(v => String(v ?? '').toLowerCase().includes(q))
  })
}

/** Count of cards per status, for the status filter chips. */
export function statusCounts(cards) {
  const out = { all: 0, good: 0, warning: 0, critical: 0, neutral: 0 }
  for (const c of cards || []) { out.all += 1; if (out[c.status] != null) out[c.status] += 1 }
  return out
}

/** Flat KPI rows for Excel/PDF. Unmeasured values are 'N/A' with status 'Not measured'. */
export function kpiExportRows(cards) {
  return (cards || []).map((c, i) => ({
    no: i + 1,
    kpi: c.title,
    value: c.value ?? 'N/A',
    status: STATUS_LABEL[c.status] || 'Not measured',
    detail: [c.subValue, c.description].filter(Boolean).join(' | '),
  }))
}
