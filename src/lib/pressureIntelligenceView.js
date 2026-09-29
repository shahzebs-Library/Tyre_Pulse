/**
 * Pressure Intelligence view shaping (pure). Sits on top of the engine in
 * pressureIntelligenceAnalytics.js, which owns the one pressure rule: every
 * reading against its own vehicle median at that inspection, more than 15% off
 * is flagged, fewer than 4 readings is not judged. Nothing here restates it.
 *
 * "Current" means the wheels on each asset's most recent inspection in scope,
 * so the fleet view shows today's picture rather than every reading ever taken.
 *
 * Honest limits, stated in the UI:
 *   - Temperature: no source records it (tpms_readings is empty), so N/A.
 *   - Fuel saving: no fuel-versus-pressure data exists, so N/A.
 *   - Recommended: the vehicle median is the reference the verdict uses. A
 *     tyre specification value is shown beside it only where one exists for
 *     that exact vehicle type and axle; it never changes the verdict.
 *   - Critical: a wheel recorded flat, burst or damaged (the app's single
 *     severe-condition rule). No PSI threshold is invented.
 */
import { AXLE_GROUPS } from './positionIntelligenceAnalytics'

const txt = (v) => (v == null ? '' : String(v).trim())
const median = (a) => {
  const s = a.filter((v) => Number.isFinite(v)).sort((x, y) => x - y)
  if (!s.length) return null
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export const VIEW_STATUS = {
  ok: { label: 'Normal', tone: 'good', color: 'var(--cc-green)' },
  under: { label: 'Under inflated', tone: 'warn', color: 'var(--cc-amber)' },
  over: { label: 'Over inflated', tone: 'info', color: 'var(--cc-blue)' },
  critical: { label: 'Critical', tone: 'bad', color: 'var(--cc-red)' },
  unmeasured: { label: 'Not measured', tone: 'muted', color: 'var(--cc-ink-3)' },
}
export const VIEW_STATUS_ORDER = ['ok', 'under', 'over', 'critical', 'unmeasured']

/** Display status: a severe recorded condition outranks the pressure verdict. */
export function viewStatus(r) {
  if (!r) return 'unmeasured'
  if (r.critical) return 'critical'
  return VIEW_STATUS[r.status] ? r.status : 'unmeasured'
}

/** Distinct vehicle types on the loaded inspections. */
export function vehicleTypesOf(inspections = []) {
  return [...new Set(inspections.map((r) => txt(r.vehicle_type)).filter(Boolean))].sort()
}

/** Filter readings by vehicle type, axle group and display status. */
export function filterView(readings = [], { vehicleType = '', group = '', status = '' } = {}) {
  const vt = txt(vehicleType).toUpperCase()
  return readings.filter((r) => (!vt || txt(r.vehicle_type).toUpperCase() === vt)
    && (!group || r.group === group)
    && (!status || viewStatus(r) === status))
}

/** The readings on each asset's most recent inspection. */
export function latestPerAsset(readings = []) {
  const best = new Map()
  for (const r of readings) {
    const a = txt(r.asset_no)
    if (!a) continue
    const k = `${r.date || ''}|${r.inspectionId ?? ''}`
    const cur = best.get(a)
    if (!cur || k > cur) best.set(a, k)
  }
  return readings.filter((r) => {
    const a = txt(r.asset_no)
    return a && best.get(a) === `${r.date || ''}|${r.inspectionId ?? ''}`
  })
}

/** Spec lookup: (vehicle type, axle group) -> PSI, from tyre_specifications. */
export function specLookup(specs = []) {
  const map = new Map()
  for (const s of specs) {
    const vt = txt(s.vehicle_type).toUpperCase()
    const pos = txt(s.position)
    const n = Number(String(s.recommended_pressure ?? '').replace(/[^0-9.]/g, ''))
    if (!vt || !pos || !Number.isFinite(n) || n <= 0) continue
    map.set(`${vt}|${pos.toLowerCase()}`, n)
  }
  return (vehicleType, group) => map.get(`${txt(vehicleType).toUpperCase()}|${txt(group).toLowerCase()}`) ?? null
}

/** Adds the reference pressure, the PSI gap and the display status to each reading. */
export function decorate(readings = [], lookup = () => null) {
  return readings.map((r) => {
    const spec = lookup(r.vehicle_type, r.group)
    return {
      ...r,
      spec,
      psiDiff: r.median == null ? null : Math.round((r.pressure - r.median) * 10) / 10,
      specDiff: spec == null ? null : Math.round((r.pressure - spec) * 10) / 10,
      viewStatus: viewStatus(r),
    }
  })
}

/** Headline counts for the current wheels. Percentages are of wheels monitored. */
export function fleetKpis(current = []) {
  const counts = { ok: 0, under: 0, over: 0, critical: 0, unmeasured: 0 }
  for (const r of current) counts[viewStatus(r)] += 1
  const total = current.length
  const pct = (n) => (total ? Math.round((n / total) * 100) : null)
  return {
    total,
    vehicles: new Set(current.map((r) => r.asset_no).filter(Boolean)).size,
    ...counts,
    okPct: pct(counts.ok), underPct: pct(counts.under), overPct: pct(counts.over), criticalPct: pct(counts.critical),
    typicalPsi: median(current.map((r) => r.pressure).filter((p) => p > 0 && p < 300)),
  }
}

export function distributionSegments(k) {
  return VIEW_STATUS_ORDER
    .filter((s) => s !== 'unmeasured' || k.unmeasured > 0)
    .map((s) => ({ key: s, label: VIEW_STATUS[s].label, count: k[s] || 0, color: VIEW_STATUS[s].color }))
}

/** Per axle group: median current PSI against the median vehicle-median reference. */
export function positionBars(current = []) {
  return AXLE_GROUPS.map((group) => {
    const rows = current.filter((r) => r.group === group)
    if (!rows.length) return null
    return {
      group,
      readings: rows.length,
      current: median(rows.map((r) => r.pressure).filter((p) => p > 0 && p < 300)),
      reference: median(rows.map((r) => r.median).filter((v) => v != null)),
      spec: median(rows.map((r) => r.spec).filter((v) => v != null)),
    }
  }).filter(Boolean)
}

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Median PSI per day per axle group over the 7 days ending on the latest
 * reading date in scope (not the clock, so a quiet week is not a blank chart
 * that looks like a fault). A day with no reading is null, never 0.
 */
export function dailyTrend(readings = [], { days = 7 } = {}) {
  const dated = readings.filter((r) => r.date && r.pressure > 0 && r.pressure < 300)
  if (!dated.length) return { labels: [], series: [], end: null, start: null }
  const end = dated.reduce((m, r) => (r.date > m ? r.date : m), '')
  const start = addDays(end, -(days - 1))
  const labels = Array.from({ length: days }, (_, i) => addDays(start, i))
  const series = AXLE_GROUPS.map((group) => {
    const rows = dated.filter((r) => r.group === group && r.date >= start && r.date <= end)
    if (!rows.length) return null
    return { group, values: labels.map((day) => median(rows.filter((r) => r.date === day).map((r) => r.pressure))) }
  }).filter(Boolean)
  return { labels, series, end, start }
}

const RANK = { critical: 0, under: 1, over: 2 }
/** Current wheels that need attention, critical first then by size of deviation. */
export function alertRows(current = []) {
  return current
    .filter((r) => RANK[viewStatus(r)] != null)
    .sort((a, b) => (RANK[viewStatus(a)] - RANK[viewStatus(b)])
      || (Math.abs(b.deviationPct ?? 0) - Math.abs(a.deviationPct ?? 0)))
}

/** One row per asset for the vehicle view. */
export function vehicleRows(current = []) {
  const map = new Map()
  for (const r of current) {
    const a = txt(r.asset_no)
    if (!a) continue
    if (!map.has(a)) map.set(a, { asset_no: a, vehicle_type: r.vehicle_type, site: r.site, date: r.date, inspector: r.inspector, wheels: 0, measured: 0, under: 0, over: 0, critical: 0, psis: [], worst: null })
    const v = map.get(a)
    v.wheels += 1
    if (r.status !== 'unmeasured') v.measured += 1
    const s = viewStatus(r)
    if (s === 'under') v.under += 1
    if (s === 'over') v.over += 1
    if (s === 'critical') v.critical += 1
    v.psis.push(r.pressure)
    if (r.deviationPct != null && (v.worst == null || Math.abs(r.deviationPct) > Math.abs(v.worst))) v.worst = r.deviationPct
  }
  return [...map.values()].map(({ psis, ...v }) => ({
    ...v,
    medianPsi: median(psis),
    state: v.critical ? 'critical' : (v.under || v.over) ? (v.under >= v.over ? 'under' : 'over') : v.measured ? 'ok' : 'unmeasured',
  })).sort((a, b) => (b.critical - a.critical) || ((b.under + b.over) - (a.under + a.over)) || a.asset_no.localeCompare(b.asset_no))
}

export const FLEET_EXPORT_COLS = ['asset_no', 'vehicle_type', 'site', 'serial', 'position', 'pressure', 'median', 'spec', 'psiDiff', 'deviationPct', 'statusLabel', 'date']
export const FLEET_EXPORT_HEADERS = ['Asset', 'Vehicle type', 'Site', 'Serial', 'Position', 'Current PSI', 'Vehicle median PSI', 'Specification PSI', 'Deviation from median PSI', 'Deviation %', 'Status', 'Last updated']

export function fleetExportRows(rows = []) {
  return rows.map((r) => ({
    asset_no: r.asset_no || 'N/A',
    vehicle_type: r.vehicle_type || 'N/A',
    site: r.site || 'N/A',
    serial: r.serial || 'N/A',
    position: r.position,
    pressure: r.pressure,
    median: r.median ?? 'N/A',
    spec: r.spec ?? 'N/A',
    psiDiff: r.psiDiff ?? 'N/A',
    deviationPct: r.deviationPct ?? 'N/A',
    statusLabel: VIEW_STATUS[viewStatus(r)].label,
    date: r.date || 'N/A',
  }))
}
