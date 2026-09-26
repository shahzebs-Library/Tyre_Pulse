/**
 * Inspection Intelligence - pure engine behind /inspection-intelligence.
 *
 * WHAT CHANGED AND WHY (measured live 2026-09-26, 1,462 inspections):
 *  - "Pressure data coverage" counted inspections whose free-text `findings`
 *    contained a digit. findings is filled on 174 of 1,462 rows while 1,453
 *    carry real pressures in tyre_conditions, so it reported ~12% coverage of
 *    a fleet that records pressure on almost every wheel. It now uses
 *    kpiEngine.computePressureCompliance, the one pressure rule in the app.
 *  - "On-time compliance" compared completed_date with scheduled_date.
 *    completed_date is set on 112 rows and status holds only Done / In
 *    Progress, so the figure described almost nothing. What the data does
 *    record is the sign-off: Done = approved and locked. The page reports the
 *    approval rate and says so.
 *  - Duplicates were keyed on inspection_type, which is 'Routine' on every
 *    row. A duplicate is now the same vehicle inspected more than once on the
 *    same day.
 *  - The data-quality score scored a missing free-text finding as bad data.
 *    Findings are optional; missing tyre readings are not. The checks are now
 *    things an inspection is actually expected to carry.
 *
 * Coverage (has every fleet vehicle been inspected) stays in inspectorActivity
 * and is reused, not copied. Conditions are read through
 * inspectionView.normalizeTyreConditions / riskForCondition, which match both
 * vocabularies by stem.
 *
 * Pure: no I/O, no clock unless `now` is passed in.
 */
import { normalizeTyreConditions } from './inspectionView'
import { computePressureCompliance, pressureReadings, PRESSURE_MIN_READINGS } from './kpiEngine'
import { inspectorActivity } from './inspectorActivity'

const txt = (v) => (v == null ? '' : String(v).trim())
const pct = (a, b) => (b > 0 ? (a / b) * 100 : null)
const DAY = 86400000

export function inspectionDay(r) {
  return txt(r?.inspection_date || r?.scheduled_date || r?.created_at).slice(0, 10)
}

export const isApproved = (r) => r?.status === 'Done' || r?.approval_status === 'approved'
const live = (rows) => (Array.isArray(rows) ? rows : []).filter((r) => r && r.status !== 'Cancelled')

/** Per-inspection facts every other function reads. */
export function inspectionFacts(r) {
  const tc = normalizeTyreConditions(r)
  const entries = Object.values(tc)
  const recorded = entries.filter((d) => d && (d.condition || d.pressure != null || d.tread != null))
  const faults = entries.filter((d) => d && (d.risk === 'warning' || d.risk === 'critical'))
  const severe = entries.filter((d) => d && d.risk === 'critical')
  const ps = pressureReadings(r)
  return {
    positions: entries.length,
    recordedPositions: recorded.length,
    faults: faults.length,
    severe: severe.length,
    pressures: ps.length,
    pressureMeasurable: ps.length >= PRESSURE_MIN_READINGS,
    uniformPressure: ps.length >= PRESSURE_MIN_READINGS && new Set(ps).size === 1,
    hasMeter: r?.odometer_km != null || r?.hour_meter != null,
  }
}

export function filterInspections(rows = [], { site = '', inspector = '', status = '', from = '', to = '', search = '' } = {}) {
  const q = txt(search).toLowerCase()
  return live(rows).filter((r) => {
    if (site && txt(r.site) !== site) return false
    if (inspector && txt(r.inspector) !== inspector) return false
    if (status === 'approved' && !isApproved(r)) return false
    if (status === 'pending' && isApproved(r)) return false
    const d = inspectionDay(r)
    if (from && (!d || d < from)) return false
    if (to && (!d || d > to)) return false
    if (q) {
      const hay = `${txt(r.asset_no)} ${txt(r.site)} ${txt(r.inspector)} ${txt(r.vehicle_type)} ${txt(r.document_no)}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Date window helper: presets are counted back from `now`. */
export function windowFrom(days, now = Date.now()) {
  if (!days) return ''
  return new Date(now - days * DAY).toISOString().slice(0, 10)
}

/**
 * Data-quality checks an inspection is expected to pass. Each is a separate
 * figure so the page can say which one is failing; the score is their mean.
 */
export function dataQuality(rows = [], fleetAssets = null) {
  const list = live(rows)
  const inFleet = fleetAssets instanceof Set && fleetAssets.size > 0
  const checks = [
    { key: 'inspector', label: 'Inspector named', pass: (r) => Boolean(txt(r.inspector)) },
    { key: 'tyres', label: 'Tyre readings recorded', pass: (r, f) => f.recordedPositions > 0 },
    { key: 'pressure', label: `At least ${PRESSURE_MIN_READINGS} pressures`, pass: (r, f) => f.pressureMeasurable },
    { key: 'meter', label: 'Odometer or hour meter', pass: (r, f) => f.hasMeter },
  ]
  if (inFleet) checks.push({ key: 'fleet', label: 'Asset in fleet register', pass: (r) => fleetAssets.has(txt(r.asset_no).toUpperCase()) })
  const failures = Object.fromEntries(checks.map((c) => [c.key, []]))
  const uniform = []
  for (const r of list) {
    const f = inspectionFacts(r)
    for (const c of checks) if (!c.pass(r, f)) failures[c.key].push(r)
    if (f.uniformPressure) uniform.push(r)
  }
  const results = checks.map((c) => ({
    key: c.key,
    label: c.label,
    failing: failures[c.key].length,
    passPct: pct(list.length - failures[c.key].length, list.length),
    rows: failures[c.key],
  }))
  const scored = results.filter((c) => c.passPct != null)
  return {
    checks: results,
    uniform,
    score: scored.length ? scored.reduce((s, c) => s + c.passPct, 0) / scored.length : null,
  }
}

/** Headline KPIs over the filtered window. */
export function inspectionKpis(rows = []) {
  const list = live(rows)
  const comp = computePressureCompliance(list)
  let faults = 0
  let withFault = 0
  let severe = 0
  for (const r of list) {
    const f = inspectionFacts(r)
    faults += f.faults
    severe += f.severe
    if (f.faults > 0) withFault += 1
  }
  const approved = list.filter(isApproved).length
  return {
    inspections: list.length,
    vehicles: new Set(list.map((r) => txt(r.asset_no).toUpperCase()).filter(Boolean)).size,
    inspectors: new Set(list.map((r) => txt(r.inspector)).filter(Boolean)).size,
    approved,
    pending: list.length - approved,
    approvalPct: pct(approved, list.length),
    pressureMeasurablePct: pct(comp.measuredInspections, list.length),
    pressureCompliancePct: comp.compliancePct,
    faults,
    severe,
    withFaultPct: pct(withFault, list.length),
  }
}

/** Per-site summary. */
export function siteSummary(rows = []) {
  const map = new Map()
  for (const r of live(rows)) {
    const site = txt(r.site) || 'Unknown'
    const a = map.get(site) || { site, inspections: 0, approved: 0, vehicles: new Set(), faults: 0, measurable: 0 }
    const f = inspectionFacts(r)
    a.inspections += 1
    if (isApproved(r)) a.approved += 1
    if (txt(r.asset_no)) a.vehicles.add(txt(r.asset_no).toUpperCase())
    a.faults += f.faults
    if (f.pressureMeasurable) a.measurable += 1
    map.set(site, a)
  }
  return [...map.values()]
    .map((a) => ({
      site: a.site,
      inspections: a.inspections,
      vehicles: a.vehicles.size,
      approved: a.approved,
      approvalPct: pct(a.approved, a.inspections),
      faults: a.faults,
      pressureMeasurablePct: pct(a.measurable, a.inspections),
    }))
    .sort((a, b) => b.inspections - a.inspections || a.site.localeCompare(b.site))
}

/** Last N months (whole corpus, not the page window). */
export function monthlyTrend(rows = [], { now = Date.now(), months = 12 } = {}) {
  const base = new Date(now)
  const list = live(rows)
  const out = []
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const monthRows = list.filter((r) => inspectionDay(r).startsWith(key))
    const approved = monthRows.filter(isApproved).length
    out.push({
      month: key,
      label: d.toLocaleString('en', { month: 'short', year: '2-digit' }),
      inspections: monthRows.length,
      approved,
      approvalPct: pct(approved, monthRows.length),
    })
  }
  return out
}

/** Condition band mix across every recorded wheel. */
export function conditionMix(rows = []) {
  const counts = { good: 0, warning: 0, critical: 0, none: 0 }
  for (const r of live(rows)) {
    for (const d of Object.values(normalizeTyreConditions(r))) {
      const band = d?.risk && counts[d.risk] != null ? d.risk : 'none'
      counts[band] += 1
    }
  }
  return counts
}

/** Same vehicle inspected more than once on the same day. */
export function duplicateInspections(rows = []) {
  const map = new Map()
  for (const r of live(rows)) {
    const asset = txt(r.asset_no).toUpperCase()
    const day = inspectionDay(r)
    if (!asset || !day) continue
    const key = `${asset}|${day}`
    const a = map.get(key) || { key, asset_no: asset, date: day, site: txt(r.site) || null, count: 0, inspectors: new Set(), ids: [] }
    a.count += 1
    if (txt(r.inspector)) a.inspectors.add(txt(r.inspector))
    a.ids.push(r.id)
    map.set(key, a)
  }
  return [...map.values()]
    .filter((a) => a.count > 1)
    .map((a) => ({ ...a, inspectors: [...a.inspectors].sort().join(', ') }))
    .sort((a, b) => b.count - a.count || b.date.localeCompare(a.date))
}

/**
 * Inspector board: reuses inspectorActivity and adds the recording-quality
 * figures that the tyre readings make possible.
 */
export function inspectorBoard(rows = [], { now = Date.now() } = {}) {
  const list = live(rows)
  const extra = new Map()
  for (const r of list) {
    const name = txt(r.inspector)
    if (!name) continue
    const f = inspectionFacts(r)
    const a = extra.get(name) || { measurable: 0, faults: 0, uniform: 0, recorded: 0, positions: 0 }
    if (f.pressureMeasurable) a.measurable += 1
    if (f.uniformPressure) a.uniform += 1
    a.faults += f.faults
    a.recorded += f.recordedPositions
    a.positions += f.positions
    extra.set(name, a)
  }
  return inspectorActivity(list, { now }).map((a) => {
    const e = extra.get(a.inspector) || { measurable: 0, faults: 0, uniform: 0, recorded: 0, positions: 0 }
    return {
      ...a,
      pressureMeasurablePct: pct(e.measurable, a.total),
      uniformPct: pct(e.uniform, e.measurable),
      faultsReported: e.faults,
      positionsRecordedPct: pct(e.recorded, e.positions),
    }
  })
}

/** Prioritised recommendations from measured figures only. */
export function inspectionRecommendations({ kpis, coverage, dq, duplicates = [], board = [] } = {}) {
  const out = []
  if (coverage && coverage.vehicles > 0) {
    if (coverage.never > 0) out.push({ priority: 'Critical', message: `${coverage.never} fleet vehicles have never been inspected.` })
    if (coverage.coveragePct != null && coverage.coveragePct < 75) {
      out.push({ priority: 'High', message: `Only ${Math.round(coverage.coveragePct)}% of the fleet was inspected in the last 7 days (${coverage.notDone} vehicles outstanding).` })
    }
  }
  if (kpis && kpis.inspections > 0) {
    if (kpis.approvalPct != null && kpis.approvalPct < 80 && kpis.pending > 0) {
      out.push({ priority: 'High', message: `${kpis.pending} inspections in this window are still awaiting sign-off (${Math.round(kpis.approvalPct)}% approved).` })
    }
    if (kpis.pressureMeasurablePct != null && kpis.pressureMeasurablePct < 80) {
      out.push({ priority: 'Medium', message: `${Math.round(kpis.pressureMeasurablePct)}% of inspections record enough pressures to be judged. Require a pressure on every wheel.` })
    }
    if (kpis.severe > 0) out.push({ priority: 'High', message: `${kpis.severe} wheels were reported with a severe fault (damage, puncture, burst). Confirm each has a corrective action.` })
  }
  if (duplicates.length) out.push({ priority: 'Medium', message: `${duplicates.length} vehicle-days carry more than one inspection. Review for double entry.` })
  if (dq) {
    for (const c of dq.checks) {
      if (c.passPct != null && c.passPct < 70 && c.failing > 0) {
        out.push({ priority: 'Medium', message: `${c.label}: missing on ${c.failing} inspections (${Math.round(c.passPct)}% pass).` })
      }
    }
    if (dq.uniform.length >= 10) {
      out.push({ priority: 'Medium', message: `${dq.uniform.length} inspections record the identical pressure on every wheel. Confirm readings are gauged, not defaulted.` })
    }
  }
  for (const a of board) {
    if (a.total >= 10 && a.uniformPct != null && a.uniformPct >= 80) {
      out.push({ priority: 'Medium', message: `${a.inspector}: ${Math.round(a.uniformPct)}% of measured inspections show identical pressures on every wheel.` })
    }
  }
  const order = { Critical: 0, High: 1, Medium: 2 }
  return out.sort((a, b) => order[a.priority] - order[b.priority])
}

export const INSPECTION_EXPORT_COLS = ['date', 'document_no', 'asset_no', 'vehicle_type', 'site', 'inspector', 'statusLabel', 'positions', 'faults', 'pressures']
export const INSPECTION_EXPORT_HEADERS = ['Date', 'Document', 'Asset', 'Vehicle type', 'Site', 'Inspector', 'Status', 'Wheels recorded', 'Faults', 'Pressures recorded']

export function inspectionExportRows(rows = []) {
  return live(rows).map((r) => {
    const f = inspectionFacts(r)
    return {
      date: inspectionDay(r) || 'N/A',
      document_no: txt(r.document_no) || 'N/A',
      asset_no: txt(r.asset_no) || 'N/A',
      vehicle_type: txt(r.vehicle_type) || 'N/A',
      site: txt(r.site) || 'N/A',
      inspector: txt(r.inspector) || 'N/A',
      statusLabel: isApproved(r) ? 'Approved' : (txt(r.status) || 'Pending'),
      positions: f.recordedPositions,
      faults: f.faults,
      pressures: f.pressures,
    }
  })
}
