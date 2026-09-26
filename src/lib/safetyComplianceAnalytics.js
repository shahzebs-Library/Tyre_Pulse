/**
 * Safety & Compliance analytics (pure, no I/O) behind /safety-compliance.
 *
 * Every calculation the page used to do inline lives here so the dashboard,
 * the PDF/Excel exports and the tests share one implementation.
 *
 * HONESTY RULES (pinned by src/test/safetyComplianceAnalytics.test.js):
 *  - A component with no measurement is `null` (rendered N/A), never a
 *    flattering 0% or 100%.
 *  - The overall score renormalises its weights over the MEASURED components
 *    only, and is null when nothing is measurable.
 *  - `risk_level` is unpopulated on most tyre records, so anything derived from
 *    it (critical %, accident correlation) is rated over the tyres that carry a
 *    rating, and is null when none do.
 *  - `now` is injectable so month buckets and range cut-offs are deterministic.
 */
import { normalizePosition } from './tyrePositions'

/** Minimum legal tread depth by functional position (mm). */
export const LEGAL_TREAD = { steer: 3, drive: 3, trailer: 3, default: 2 }
/** Permitted pressure deviation from the recommended pressure, in percent. */
export const PRESSURE_TOLERANCE = 10
/** Weights of the overall score components (renormalised over measured ones). */
export const SCORE_WEIGHTS = { tread: 0.35, pressure: 0.25, inspection: 0.30, risk: 0.10 }
/** Reporting windows offered by the page, in days. */
export const RANGE_DAYS = { '30d': 30, '90d': 90, '6m': 180, '1y': 365 }
export const RANGE_OPTIONS = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '6m', label: 'Last 6 months' },
  { value: '1y', label: 'Last 12 months' },
]

const RATED = (r) => r?.risk_level != null && String(r.risk_level).trim() !== ''

/** Finite number or null (blank, text and NaN are not readings). */
export function toNum(v) {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

const round1 = (n) => (n == null ? null : Math.round(n * 10) / 10)
const pct = (num, den) => (den > 0 ? (num / den) * 100 : null)
const assetOf = (r) => String(r?.asset_number || r?.asset_no || '').trim()
const positionOf = (r) => r?.tyre_position || r?.position || ''

/** ISO cut-off for a range key, counted back from `now`. */
export function rangeCutoff(range, now = new Date()) {
  const days = RANGE_DAYS[range] ?? RANGE_DAYS['90d']
  const d = new Date(now)
  d.setDate(d.getDate() - days)
  return d.toISOString()
}

/** Map a raw position to a LEGAL_TREAD key. */
export function legalKeyFor(position) {
  const g = normalizePosition(position)
  if (g === 'Steer') return 'steer'
  if (g === 'Drive') return 'drive'
  if (g === 'Trailer') return 'trailer'
  return 'default'
}

/** Minimum legal tread (mm) for a raw position. */
export function legalMinFor(position) {
  return LEGAL_TREAD[legalKeyFor(position)] ?? LEGAL_TREAD.default
}

/** Risk component score: 100 minus five points per critical-tyre percent. */
export function riskScore(criticalPct) {
  return criticalPct == null ? null : Math.max(0, 100 - criticalPct * 5)
}

/**
 * Compliance band for a 0..100 score. Carries a text label so colour is never
 * the only signal.
 */
export function scoreBand(value) {
  if (value == null || Number.isNaN(value)) return { key: 'not_measured', label: 'Not measured' }
  if (value >= 90) return { key: 'compliant', label: 'Compliant' }
  if (value >= 75) return { key: 'warning', label: 'Warning' }
  if (value >= 60) return { key: 'attention', label: 'Attention' }
  return { key: 'non_compliant', label: 'Non-compliant' }
}

/** Distinct, sorted site names across the loaded feeds. */
export function siteOptions({ tyreRecords = [], inspections = [], accidents = [] } = {}) {
  const set = new Set()
  for (const list of [tyreRecords, inspections, accidents]) {
    for (const r of list || []) { const s = String(r?.site || '').trim(); if (s) set.add(s) }
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

/** Restrict the three feeds to one site ('' or 'all' = no filter). */
export function filterBySite(data = {}, site) {
  const { tyreRecords = [], inspections = [], accidents = [] } = data
  if (!site || site === 'all') return { tyreRecords, inspections, accidents }
  const keep = (r) => String(r?.site || '').trim() === site
  return {
    tyreRecords: tyreRecords.filter(keep),
    inspections: inspections.filter(keep),
    accidents: accidents.filter(keep),
  }
}

/** Tyres with a numeric tread reading below their legal minimum. */
export function treadFailRows(tyreRecords = []) {
  const out = []
  for (const r of tyreRecords) {
    const tread = toNum(r?.tread_depth)
    if (tread == null) continue
    const legalMin = legalMinFor(positionOf(r))
    if (tread < legalMin) {
      out.push({
        id: r.id,
        asset: assetOf(r) || null,
        serial: r.serial_number || r.serial_no || null,
        position: positionOf(r) || null,
        tread,
        legalMin,
        deficit: round1(legalMin - tread),
        risk: RATED(r) ? String(r.risk_level) : null,
        site: r.site || null,
      })
    }
  }
  return out.sort((a, b) => b.deficit - a.deficit)
}

/** Inspections with both a reading and a recommended pressure, with deviation. */
export function pressureRows(inspections = []) {
  const out = []
  for (const r of inspections) {
    const reading = toNum(r?.pressure_reading)
    const target = toNum(r?.recommended_pressure)
    if (reading == null || target == null || target === 0) continue
    const deviationPct = round1(((reading - target) / target) * 100)
    out.push({
      id: r.id,
      asset: r.asset_no || null,
      date: r.inspection_date || null,
      site: r.site || null,
      reading,
      target,
      deviationPct,
      compliant: Math.abs(deviationPct) <= PRESSURE_TOLERANCE,
    })
  }
  return out
}

/** Inspection register rows with measurement flags (text, not colour). */
export function inspectionRows(inspections = []) {
  return inspections.map((r) => ({
    id: r.id,
    asset: r.asset_no || null,
    inspector: r.inspector || null,
    date: r.inspection_date || null,
    site: r.site || null,
    treadRecorded: toNum(r?.tread_depth) != null,
    pressureRecorded: toNum(r?.pressure_reading) != null,
    status: r.status || null,
  }))
}

/** Per-site tread compliance over MEASURED tyres; null when none measured. */
export function siteTread(tyreRecords = []) {
  const bySite = new Map()
  for (const r of tyreRecords) {
    const site = String(r?.site || '').trim() || 'Unknown'
    if (!bySite.has(site)) bySite.set(site, { site, total: 0, measured: 0, fails: 0, critical: 0 })
    const s = bySite.get(site)
    s.total += 1
    if (r?.risk_level === 'Critical') s.critical += 1
    const tread = toNum(r?.tread_depth)
    if (tread != null) {
      s.measured += 1
      if (tread < legalMinFor(positionOf(r))) s.fails += 1
    }
  }
  return [...bySite.values()]
    .map((s) => ({ ...s, compliance: s.measured ? round1(((s.measured - s.fails) / s.measured) * 100) : null }))
    .sort((a, b) => (a.compliance == null) - (b.compliance == null) || (a.compliance ?? 0) - (b.compliance ?? 0))
}

/**
 * Six calendar months ending with `now`: critical-risk share over RATED tyres
 * (null when none rated) and the real inspection count per month.
 */
export function monthlyTrend(tyreRecords = [], inspections = [], now = new Date()) {
  const out = []
  const base = new Date(now)
  for (let i = 5; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    const recs = tyreRecords.filter((r) => String(r?.created_at || '').startsWith(key))
    const rated = recs.filter(RATED)
    const crit = rated.filter((r) => r.risk_level === 'Critical').length
    out.push({
      key,
      label,
      tyres: recs.length,
      rated: rated.length,
      critPct: rated.length ? round1((crit / rated.length) * 100) : null,
      inspections: inspections.filter((r) => String(r?.inspection_date || '').startsWith(key)).length,
    })
  }
  return out
}

/**
 * The full compliance model for the page. Returns null when there are no tyre
 * records in scope (the page renders an honest empty state).
 */
export function computeSafetyCompliance({ tyreRecords = [], inspections = [], accidents = [], now = new Date() } = {}) {
  const total = tyreRecords.length
  if (!total) return null

  // Tread
  const treadValues = tyreRecords.map((r) => toNum(r?.tread_depth)).filter((v) => v != null)
  const treadFails = treadFailRows(tyreRecords)
  const treadCompliance = treadValues.length ? round1(((treadValues.length - treadFails.length) / treadValues.length) * 100) : null
  const belowLimitPct = treadValues.length ? round1((treadFails.length / treadValues.length) * 100) : null
  const avgTread = treadValues.length ? round1(treadValues.reduce((a, b) => a + b, 0) / treadValues.length) : null

  // Pressure
  const pressure = pressureRows(inspections)
  const pressureFails = pressure.filter((p) => !p.compliant)
  const pressureCompliance = pressure.length ? round1(((pressure.length - pressureFails.length) / pressure.length) * 100) : null

  // Risk (rated tyres only)
  const rated = tyreRecords.filter(RATED)
  const criticalCount = tyreRecords.filter((r) => r.risk_level === 'Critical').length
  const highRiskCount = tyreRecords.filter((r) => r.risk_level === 'High').length
  const criticalPct = rated.length ? round1((criticalCount / rated.length) * 100) : null
  const riskDist = { Critical: 0, High: 0, Medium: 0, Low: 0 }
  for (const r of rated) if (riskDist[r.risk_level] !== undefined) riskDist[r.risk_level] += 1

  // Inspection coverage: tyre-carrying assets that were inspected in the window.
  const tyreAssets = new Set(tyreRecords.map(assetOf).filter(Boolean))
  const inspectedAll = new Set(inspections.map((r) => String(r?.asset_no || '').trim()).filter(Boolean))
  let inspectedAssets = 0
  for (const a of tyreAssets) if (inspectedAll.has(a)) inspectedAssets += 1
  const inspectionCompliance = tyreAssets.size ? round1((inspectedAssets / tyreAssets.size) * 100) : null

  // Accident correlation: only answerable when some tyres carry a risk rating.
  const riskyAssets = new Set(
    tyreRecords.filter((r) => r.risk_level === 'Critical' || r.risk_level === 'High').map(assetOf).filter(Boolean),
  )
  const accidentsWithTyreIssue = rated.length
    ? accidents.filter((a) => riskyAssets.has(String(a?.asset_no || a?.vehicle || '').trim())).length
    : null
  const accidentCorrelation = accidents.length && rated.length ? round1(pct(accidentsWithTyreIssue, accidents.length)) : null

  const risk = riskScore(criticalPct)
  const parts = [
    { key: 'tread', value: treadCompliance, weight: SCORE_WEIGHTS.tread },
    { key: 'pressure', value: pressureCompliance, weight: SCORE_WEIGHTS.pressure },
    { key: 'inspection', value: inspectionCompliance, weight: SCORE_WEIGHTS.inspection },
    { key: 'risk', value: risk, weight: SCORE_WEIGHTS.risk },
  ]
  const measured = parts.filter((p) => p.value != null)
  const w = measured.reduce((s, p) => s + p.weight, 0)
  const overallScore = w > 0 ? round1(measured.reduce((s, p) => s + p.value * p.weight, 0) / w) : null

  return {
    total,
    treadMeasured: treadValues.length,
    treadCompliance,
    belowLimitPct,
    avgTread,
    treadFails,
    pressure,
    pressureChecked: pressure.length,
    pressureFails: pressureFails.length,
    pressureCompliance,
    ratedCount: rated.length,
    criticalCount,
    highRiskCount,
    criticalPct,
    riskScore: risk,
    riskDist,
    tyreAssets: tyreAssets.size,
    inspectedAssets,
    inspectionsCount: inspections.length,
    inspectionCompliance,
    accidents: accidents.length,
    accidentsWithTyreIssue,
    accidentCorrelation,
    accidentSafety: accidentCorrelation == null ? null : Math.max(0, 100 - accidentCorrelation),
    overallScore,
    measuredComponents: measured.map((p) => p.key),
    siteTread: siteTread(tyreRecords),
    monthlyTrend: monthlyTrend(tyreRecords, inspections, now),
  }
}

/** Metric/score/status rows shared by the PDF and Excel exports. */
export function complianceSummaryRows(c) {
  if (!c) return []
  const f = (v) => (v == null ? 'N/A' : `${v.toFixed(1)}%`)
  const band = (v) => scoreBand(v).label
  return [
    { metric: 'Tread depth compliance', score: f(c.treadCompliance), status: band(c.treadCompliance), basis: `${c.treadMeasured} of ${c.total} tyres measured` },
    { metric: 'Pressure compliance', score: f(c.pressureCompliance), status: band(c.pressureCompliance), basis: `${c.pressureChecked} inspections with a recommended pressure` },
    { metric: 'Inspection coverage', score: f(c.inspectionCompliance), status: band(c.inspectionCompliance), basis: `${c.inspectedAssets} of ${c.tyreAssets} assets inspected` },
    { metric: 'Risk level score', score: f(c.riskScore), status: band(c.riskScore), basis: `${c.criticalCount} critical of ${c.ratedCount} rated tyres` },
    { metric: 'Accident tyre correlation', score: f(c.accidentCorrelation), status: c.accidentCorrelation == null ? 'Not measured' : c.accidentCorrelation < 30 ? 'Low' : 'Review', basis: `${c.accidents} accidents in period` },
    { metric: 'Overall score', score: f(c.overallScore), status: band(c.overallScore), basis: `Weighted over ${c.measuredComponents.length} measured components` },
  ]
}
