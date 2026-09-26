/**
 * complianceDashboardAnalytics - the pure engine behind /compliance.
 *
 * Three compliance areas (tread depth, pressure, inspection schedule) plus the
 * weighted overall score. No I/O; every date-dependent figure takes `now`.
 *
 * HONESTY RULES (pinned by src/test/complianceDashboardAnalytics.test.js):
 *   - An area with nothing measured has pct `null` (rendered N/A), never 0.
 *     A 0% tread score from a fleet with no tread readings is a fabrication.
 *   - The overall score re-normalises its 40/30/30 weights over the areas that
 *     WERE measured, and is null when none were. It states which areas it
 *     covers, so a two-area score is never presented as a three-area one.
 *   - A site with no pressure reading is not "0% compliant": it is absent from
 *     the by-site pressure chart, whose denominator is tyres WITH a reading.
 */

export const LEGAL_MIN_TREAD = 1.6
export const FLEET_MIN_TREAD = 3.0
export const PRESSURE_MIN_PSI = 85
export const PRESSURE_MAX_PSI = 130
export const INSPECTION_MAX_DAYS = 30
export const INSPECTION_DUE_DAYS = 45
export const AREA_WEIGHTS = { tread: 0.4, pressure: 0.3, inspection: 0.3 }
export const INSPECTION_STATUSES = ['overdue', 'due_soon', 'no_data', 'compliant']
export const INSPECTION_LABEL = { compliant: 'Compliant', due_soon: 'Due soon', overdue: 'Overdue', no_data: 'Never inspected' }

const DAY = 86400000

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const treadOf = (r) => num(r?.tread_depth)

export function daysSince(dateStr, now = new Date()) {
  if (!dateStr) return null
  const t = new Date(dateStr).getTime()
  if (!Number.isFinite(t)) return null
  return Math.floor((now.getTime() - t) / DAY)
}

export function inspectionStatus(days) {
  if (days === null || days === undefined) return 'no_data'
  if (days <= INSPECTION_MAX_DAYS) return 'compliant'
  if (days <= INSPECTION_DUE_DAYS) return 'due_soon'
  return 'overdue'
}

/** 'legal_fail' | 'below_min' | 'ok' | 'no_data' for one tyre. */
export function treadClass(r) {
  const t = treadOf(r)
  if (t == null) return 'no_data'
  if (t < LEGAL_MIN_TREAD) return 'legal_fail'
  if (t < FLEET_MIN_TREAD) return 'below_min'
  return 'ok'
}

/** 'OK' | 'Anomaly' | 'No Data' for one tyre's pressure reading. */
export function pressureFlag(r) {
  const v = num(r?.pressure_reading)
  if (v == null || v <= 0) return 'No Data'
  return v < PRESSURE_MIN_PSI || v > PRESSURE_MAX_PSI ? 'Anomaly' : 'OK'
}

export function treadStats(tyres = []) {
  const counts = { legal_fail: 0, below_min: 0, ok: 0, no_data: 0 }
  for (const r of tyres) counts[treadClass(r)] += 1
  const withData = tyres.length - counts.no_data
  return {
    total: tyres.length,
    withData,
    compliant: counts.ok,
    legalFail: counts.legal_fail,
    fleetFail: counts.legal_fail + counts.below_min,
    noData: counts.no_data,
    pct: withData > 0 ? (counts.ok / withData) * 100 : null,
  }
}

export function pressureStats(tyres = []) {
  const counts = { OK: 0, Anomaly: 0, 'No Data': 0 }
  for (const r of tyres) counts[pressureFlag(r)] += 1
  const withReading = counts.OK + counts.Anomaly
  return {
    total: tyres.length,
    withReading,
    compliant: counts.OK,
    anomalies: counts.Anomaly,
    noReading: counts['No Data'],
    pct: withReading > 0 ? (counts.OK / withReading) * 100 : null,
  }
}

/**
 * Per-asset inspection status: every asset in the scoped fleet register plus
 * any asset that has an inspection, judged on its latest scheduled date.
 */
export function inspectionCompliance(inspections = [], fleet = [], now = new Date()) {
  const latestByAsset = {}
  for (const ins of inspections) {
    if (!ins.asset_no) continue
    const ex = latestByAsset[ins.asset_no]
    if (!ex || (ins.scheduled_date || '') > (ex.scheduled_date || '')) latestByAsset[ins.asset_no] = ins
  }
  const fleetByAsset = new Map(fleet.map((v) => [v.asset_no, v]))
  const assets = [...new Set([...fleet.map(v => v.asset_no), ...Object.keys(latestByAsset)])].filter(Boolean)

  const rows = assets.map((asset_no) => {
    const ins = latestByAsset[asset_no]
    const fm = fleetByAsset.get(asset_no) || {}
    const days = ins ? daysSince(ins.scheduled_date, now) : null
    const last = ins?.scheduled_date || null
    const lastT = last ? new Date(last).getTime() : NaN
    return {
      asset_no,
      vehicle_type: fm.vehicle_type || null,
      site: ins?.site || fm.site || null,
      last_inspection: last,
      days_since: days,
      next_due: Number.isFinite(lastT) ? new Date(lastT + INSPECTION_MAX_DAYS * DAY).toISOString().slice(0, 10) : null,
      status: inspectionStatus(days),
      inspector: ins?.inspector || null,
      inspection_type: ins?.inspection_type || null,
    }
  })
  const rank = { overdue: 0, due_soon: 1, no_data: 2, compliant: 3 }
  rows.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || String(a.asset_no).localeCompare(String(b.asset_no)))
  const count = (s) => rows.filter((r) => r.status === s).length
  const compliant = count('compliant')
  return {
    rows,
    total: rows.length,
    compliant,
    dueSoon: count('due_soon'),
    overdue: count('overdue'),
    noData: count('no_data'),
    pct: rows.length > 0 ? (compliant / rows.length) * 100 : null,
  }
}

/**
 * Weighted overall score over the MEASURED areas only. Returns
 * { score, covered: ['tread', ...], missing: [...] } with score null when no
 * area was measured.
 */
export function overallScore({ tread, pressure, inspection }) {
  const areas = { tread, pressure, inspection }
  let wsum = 0
  let acc = 0
  const covered = []
  const missing = []
  for (const [k, v] of Object.entries(areas)) {
    if (v == null || !Number.isFinite(v)) { missing.push(k); continue }
    wsum += AREA_WEIGHTS[k]
    acc += v * AREA_WEIGHTS[k]
    covered.push(k)
  }
  return { score: wsum > 0 ? Math.round(acc / wsum) : null, covered, missing }
}

export function scoreBand(pct) {
  if (pct == null || !Number.isFinite(pct)) return 'unknown'
  if (pct >= 80) return 'good'
  if (pct >= 60) return 'marginal'
  return 'poor'
}
export const BAND_LABEL = { good: 'Compliant', marginal: 'Marginal', poor: 'Non-compliant', unknown: 'Not measured' }

export const criticalCount = (tyres = []) =>
  tyres.filter((r) => String(r.risk_level || '').toLowerCase() === 'critical').length

/** Vehicles whose every measured tyre meets the fleet tread minimum and none is critical. */
export function fullyCompliantVehicles(tyres = []) {
  const ok = new Set()
  const bad = new Set()
  for (const r of tyres) {
    if (!r.asset_no) continue
    const t = treadOf(r)
    const crit = String(r.risk_level || '').toLowerCase() === 'critical'
    if ((t != null && t < FLEET_MIN_TREAD) || crit) bad.add(r.asset_no)
    else if (t != null) ok.add(r.asset_no)
  }
  return [...ok].filter((a) => !bad.has(a)).length
}

/** Monthly tread compliance % for the last `n` months (null where no reading). */
export function monthlyTreadTrend(tyres = [], now = new Date(), n = 6) {
  const months = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const values = months.map((m) => {
    const measured = tyres.filter((r) => String(r.issue_date || '').startsWith(m) && treadOf(r) != null)
    if (!measured.length) return null
    return (measured.filter((r) => treadOf(r) >= FLEET_MIN_TREAD).length / measured.length) * 100
  })
  const current = values[values.length - 1]
  const previous = values[values.length - 2]
  return { months, values, trend: current != null && previous != null ? current - previous : null }
}

export const TREAD_BANDS = [
  { label: '0-2 mm', min: 0, max: 2 },
  { label: '2-4 mm', min: 2, max: 4 },
  { label: '4-6 mm', min: 4, max: 6 },
  { label: '6-8 mm', min: 6, max: 8 },
  { label: '8 mm+', min: 8, max: Infinity },
]
export function treadDistribution(tyres = []) {
  return TREAD_BANDS.map((b) => ({
    ...b,
    count: tyres.filter((r) => { const t = treadOf(r); return t != null && t >= b.min && t < b.max }).length,
  }))
}

/** Tread compliance per site over tyres WITH a tread reading. */
export function treadBySite(tyres = []) {
  const map = new Map()
  for (const r of tyres) {
    const t = treadOf(r)
    if (!r.site || t == null) continue
    const s = map.get(r.site) || { site: r.site, ok: 0, total: 0 }
    s.total += 1
    if (t >= FLEET_MIN_TREAD) s.ok += 1
    map.set(r.site, s)
  }
  return [...map.values()].map((s) => ({ ...s, pct: (s.ok / s.total) * 100 })).sort((a, b) => b.pct - a.pct || a.site.localeCompare(b.site))
}

/** Pressure compliance per site over tyres WITH a reading. */
export function pressureBySite(tyres = []) {
  const map = new Map()
  for (const r of tyres) {
    const f = pressureFlag(r)
    if (!r.site || f === 'No Data') continue
    const s = map.get(r.site) || { site: r.site, ok: 0, total: 0 }
    s.total += 1
    if (f === 'OK') s.ok += 1
    map.set(r.site, s)
  }
  return [...map.values()].map((s) => ({ ...s, pct: (s.ok / s.total) * 100 })).sort((a, b) => b.pct - a.pct || a.site.localeCompare(b.site))
}

export function inspectionBySite(rows = []) {
  const map = new Map()
  for (const r of rows) {
    if (!r.site) continue
    const s = map.get(r.site) || { site: r.site, compliant: 0, due_soon: 0, overdue: 0, no_data: 0 }
    s[r.status] += 1
    map.set(r.site, s)
  }
  return [...map.values()].sort((a, b) => a.site.localeCompare(b.site))
}

/** Tyres below the fleet minimum or with no reading, worst first. */
export function nonCompliantTyres(tyres = [], now = new Date()) {
  return tyres
    .filter((r) => treadClass(r) !== 'ok')
    .map((r) => ({ ...r, tread_class: treadClass(r), days_in_service: daysSince(r.issue_date, now) }))
    .sort((a, b) => (treadOf(a) ?? -1) - (treadOf(b) ?? -1))
}

/** Tyres with an out-of-band reading or no reading, anomalies first. */
export function pressureExceptions(tyres = []) {
  return tyres
    .map((r) => ({ ...r, pressureFlag: pressureFlag(r) }))
    .filter((r) => r.pressureFlag !== 'OK')
    .sort((a, b) => (a.pressureFlag === 'Anomaly' ? 0 : 1) - (b.pressureFlag === 'Anomaly' ? 0 : 1))
}
