/**
 * Pressure Intelligence - pure engine behind /pressure-intelligence.
 *
 * WHY THIS WAS REBUILT. The old page read `inspections.pressure_reading` and
 * `tyre_records.pressure_reading`. Measured live on 2026-09-26 both columns
 * are NULL on every row (0 of 1,462 inspections, 0 of 11,284 tyre records),
 * so the page could only ever show "no readings". The pressures the fleet
 * actually records live in `inspections.tyre_conditions` (pressure_psi per
 * wheel, 1,453 of 1,462 inspections carry at least one).
 *
 * It also judged every reading against invented targets (Steer 120 / Drive
 * 110 / Trailer 100 PSI). No target pressure is stored anywhere in the schema.
 * The single rule the app uses - and the one the inspection PDF prints - is
 * each reading against ITS OWN VEHICLE'S MEDIAN at that inspection, >15% off
 * = check, and an inspection with fewer than 4 readings is not measured.
 * That rule lives in kpiEngine.computePressureCompliance and
 * inspectionView.pressureDeviation; this module calls them and never restates
 * the thresholds. It measures CONSISTENCY across a vehicle's tyres, not
 * conformance to a manufacturer spec, and the page says so.
 *
 * Pure: no I/O, no clock unless `now` is passed in.
 */
import {
  normalizeTyreConditions, inspectionStats, pressureDeviation,
  PRESSURE_MIN_READINGS, PRESSURE_TOLERANCE,
} from './inspectionView'
import { computePressureCompliance } from './kpiEngine'
import { positionGroup, AXLE_GROUPS } from './positionIntelligenceAnalytics'

export { PRESSURE_MIN_READINGS, PRESSURE_TOLERANCE }

const txt = (v) => (v == null ? '' : String(v).trim())
const pct = (a, b) => (b > 0 ? (a / b) * 100 : null)
/**
 * Typical PSI is a MEDIAN, not a mean: one mistyped 130130 PSI reading (it
 * exists in the live data) would drag a mean into nonsense.
 */
const median = (a) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** The business date of an inspection (YYYY-MM-DD) or ''. */
export function inspectionDay(r) {
  return txt(r?.inspection_date || r?.scheduled_date || r?.created_at).slice(0, 10)
}

export const STATUS_META = {
  ok: { label: 'Within 15% of vehicle median', short: 'Consistent', tone: 'good' },
  under: { label: 'More than 15% below vehicle median', short: 'Low', tone: 'crit' },
  over: { label: 'More than 15% above vehicle median', short: 'High', tone: 'warn' },
  unmeasured: { label: 'Fewer than 4 readings on this inspection', short: 'Not measured', tone: 'neutral' },
}

const live = (rows) => (Array.isArray(rows) ? rows : []).filter((r) => r && r.status !== 'Cancelled')

/**
 * One row per recorded wheel pressure.
 * Status is null-safe: an inspection without a trustworthy median yields
 * 'unmeasured', never a reassuring 'ok'.
 */
export function buildReadings(inspections = []) {
  const out = []
  for (const ins of live(inspections)) {
    const tc = normalizeTyreConditions(ins)
    const stats = inspectionStats(tc)
    for (const [position, d] of Object.entries(tc)) {
      if (d?.pressure == null) continue
      const dev = pressureDeviation(d.pressure, stats)
      out.push({
        key: `${ins.id ?? ins.asset_no ?? 'x'}:${position}`,
        inspectionId: ins.id ?? null,
        asset_no: txt(ins.asset_no) || null,
        vehicle_type: txt(ins.vehicle_type) || null,
        site: txt(ins.site) || null,
        country: txt(ins.country) || null,
        inspector: txt(ins.inspector) || null,
        date: inspectionDay(ins) || null,
        position,
        group: positionGroup(position),
        pressure: d.pressure,
        median: dev ? stats.medianPressure : null,
        deviationPct: dev ? Math.round(dev.dev * 1000) / 10 : null,
        status: dev ? (dev.check ? dev.direction : 'ok') : 'unmeasured',
        condition: d.condition,
      })
    }
  }
  return out
}

/** One row per inspection with its pressure picture. */
export function inspectionPressureRows(inspections = []) {
  return live(inspections).map((ins) => {
    const tc = normalizeTyreConditions(ins)
    const stats = inspectionStats(tc)
    const ps = Object.values(tc).map((d) => d?.pressure).filter((v) => v != null)
    const measured = ps.length >= PRESSURE_MIN_READINGS && stats.medianPressure > 0
    let flagged = 0
    if (measured) {
      for (const p of ps) if (pressureDeviation(p, stats)?.check) flagged += 1
    }
    const distinct = new Set(ps).size
    return {
      id: ins.id ?? null,
      asset_no: txt(ins.asset_no) || null,
      site: txt(ins.site) || null,
      inspector: txt(ins.inspector) || null,
      date: inspectionDay(ins) || null,
      positions: Object.keys(tc).length,
      readings: ps.length,
      median: measured ? stats.medianPressure : null,
      measured,
      flagged: measured ? flagged : null,
      // Every wheel on the truck read exactly the same value. Possible, but it
      // is also what a pre-filled or copied form looks like, so it is shown as
      // a data-quality signal and never treated as proof of anything.
      uniform: measured && distinct === 1,
    }
  })
}

/** Filter inspections (the page's unit of scope). */
export function filterInspections(rows = [], { site = '', inspector = '', from = '', to = '', search = '' } = {}) {
  const q = txt(search).toLowerCase()
  return rows.filter((r) => {
    if (site && txt(r.site) !== site) return false
    if (inspector && txt(r.inspector) !== inspector) return false
    const d = inspectionDay(r)
    if (from && (!d || d < from)) return false
    if (to && (!d || d > to)) return false
    if (q) {
      const hay = `${txt(r.asset_no)} ${txt(r.site)} ${txt(r.inspector)} ${txt(r.vehicle_type)}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Filter the per-wheel readings (group / status). */
export function filterReadings(readings = [], { group = '', status = '' } = {}) {
  return readings.filter((r) => (!group || r.group === group) && (!status || r.status === status))
}

/** Headline KPIs. Compliance comes straight from kpiEngine. */
export function pressureKpis(inspections = []) {
  const rows = live(inspections)
  const comp = computePressureCompliance(rows)
  const readings = buildReadings(rows)
  const insp = inspectionPressureRows(rows)
  const measuredReadings = readings.filter((r) => r.status !== 'unmeasured')
  const flaggedAssets = new Set(readings.filter((r) => r.status === 'under' || r.status === 'over').map((r) => r.asset_no).filter(Boolean))
  const devs = measuredReadings.map((r) => Math.abs(r.deviationPct))
  return {
    inspections: rows.length,
    withPressure: insp.filter((i) => i.readings > 0).length,
    measuredInspections: comp.measuredInspections,
    notMeasuredInspections: comp.notMeasuredInspections,
    measurableCoveragePct: pct(comp.measuredInspections, rows.length),
    readings: readings.length,
    measuredReadings: comp.readings,
    compliancePct: comp.compliancePct,
    basis: comp.basis,
    under: readings.filter((r) => r.status === 'under').length,
    over: readings.filter((r) => r.status === 'over').length,
    flaggedVehicles: flaggedAssets.size,
    medianPsi: median(readings.map((r) => r.pressure)),
    medianAbsDeviationPct: median(devs),
    uniformInspections: insp.filter((i) => i.uniform).length,
    uniformPct: pct(insp.filter((i) => i.uniform).length, comp.measuredInspections),
  }
}

/** Per-site compliance (kpiEngine) joined with reading counts. */
export function siteCompliance(inspections = []) {
  const rows = live(inspections)
  const comp = computePressureCompliance(rows)
  const readings = buildReadings(rows)
  return comp.bySite.map((s) => {
    const siteRows = readings.filter((r) => (r.site || 'Unknown') === s.site)
    return {
      site: s.site,
      inspections: s.count,
      readings: s.readings,
      compliancePct: s.compliancePct,
      under: siteRows.filter((r) => r.status === 'under').length,
      over: siteRows.filter((r) => r.status === 'over').length,
      medianPsi: median(siteRows.map((r) => r.pressure)),
    }
  })
}

/** Per axle group, same rule applied to the readings in that group. */
export function groupBreakdown(readings = []) {
  return AXLE_GROUPS
    .map((group) => {
      const rows = readings.filter((r) => r.group === group)
      if (!rows.length) return null
      const measured = rows.filter((r) => r.status !== 'unmeasured')
      const ok = measured.filter((r) => r.status === 'ok').length
      return {
        group,
        readings: rows.length,
        measured: measured.length,
        compliancePct: pct(ok, measured.length),
        under: rows.filter((r) => r.status === 'under').length,
        over: rows.filter((r) => r.status === 'over').length,
        medianPsi: median(rows.map((r) => r.pressure)),
      }
    })
    .filter(Boolean)
}

/**
 * PSI distribution in fixed-width bands.
 *
 * The live data carries entry errors (a 130130 PSI reading exists). Spanning
 * the raw min to max would collapse every real reading into one bar, so the
 * bands span the 1st to 99th percentile and anything outside lands in an
 * explicit "below" / "above" band - counted, never dropped.
 */
export function psiHistogram(readings = [], { width = 10, maxBins = 30 } = {}) {
  const ps = readings.map((r) => r.pressure).filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (!ps.length) return []
  const at = (q) => ps[Math.min(ps.length - 1, Math.max(0, Math.floor(q * (ps.length - 1))))]
  const pLo = at(0.01)
  const pHi = at(0.99)
  while ((pHi - pLo) / width > maxBins) width *= 2
  const lo = Math.floor(pLo / width) * width
  const hi = Math.floor(pHi / width) * width + width
  const bins = []
  if (ps[0] < lo) bins.push({ from: null, to: lo, label: `Below ${lo}`, count: 0, outlier: true })
  for (let b = lo; b < hi; b += width) bins.push({ from: b, to: b + width, label: `${b} to ${b + width}`, count: 0 })
  if (ps[ps.length - 1] >= hi) bins.push({ from: hi, to: null, label: `${hi} and above`, count: 0, outlier: true })
  const first = bins[0].outlier ? 1 : 0
  for (const p of ps) {
    if (p < lo) bins[0].count += 1
    else if (p >= hi) bins[bins.length - 1].count += 1
    else bins[first + Math.floor((p - lo) / width)].count += 1
  }
  return bins
}

/** Last N months: readings, average PSI and compliance of measured readings. */
export function monthlyTrend(readings = [], { now = Date.now(), months = 12 } = {}) {
  const base = new Date(now)
  const out = []
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const rows = readings.filter((r) => (r.date || '').startsWith(key))
    const measured = rows.filter((r) => r.status !== 'unmeasured')
    out.push({
      month: key,
      label: d.toLocaleString('en', { month: 'short', year: '2-digit' }),
      readings: rows.length,
      medianPsi: median(rows.map((r) => r.pressure)),
      compliancePct: pct(measured.filter((r) => r.status === 'ok').length, measured.length),
    })
  }
  return out
}

/** How well each inspector records pressure. */
export function inspectorPressureQuality(inspections = []) {
  const rows = inspectionPressureRows(inspections)
  const map = new Map()
  for (const r of rows) {
    const name = r.inspector || 'Not recorded'
    const a = map.get(name) || { inspector: name, inspections: 0, withPressure: 0, measured: 0, uniform: 0, readings: 0, flagged: 0, sites: new Set() }
    a.inspections += 1
    if (r.readings > 0) a.withPressure += 1
    if (r.measured) a.measured += 1
    if (r.uniform) a.uniform += 1
    a.readings += r.readings
    a.flagged += r.flagged || 0
    if (r.site) a.sites.add(r.site)
    map.set(name, a)
  }
  return [...map.values()]
    .map((a) => ({
      inspector: a.inspector,
      inspections: a.inspections,
      readings: a.readings,
      measuredPct: pct(a.measured, a.inspections),
      uniformPct: pct(a.uniform, a.measured),
      flagged: a.flagged,
      sites: [...a.sites].sort().join(', '),
    }))
    .sort((x, y) => y.inspections - x.inspections || x.inspector.localeCompare(y.inspector))
}

/**
 * The same wheel off its vehicle median on two or more inspections. A
 * repeated LOW reading on one wheel is the classic slow-leak / valve pattern;
 * it is labelled a POSSIBLE cause because pressure alone cannot prove it.
 */
export function repeatDeviations(readings = [], { minOccurrences = 2 } = {}) {
  const map = new Map()
  for (const r of readings) {
    if (r.status !== 'under' && r.status !== 'over') continue
    if (!r.asset_no) continue
    const key = `${r.asset_no}|${r.position}`
    const a = map.get(key) || { asset_no: r.asset_no, position: r.position, site: r.site, occurrences: 0, lows: 0, highs: 0, lastDate: null, lastPsi: null, lastDeviationPct: null }
    a.occurrences += 1
    if (r.status === 'under') a.lows += 1
    else a.highs += 1
    if (!a.lastDate || (r.date && r.date > a.lastDate)) {
      a.lastDate = r.date
      a.lastPsi = r.pressure
      a.lastDeviationPct = r.deviationPct
    }
    map.set(key, a)
  }
  return [...map.values()]
    .filter((a) => a.occurrences >= minOccurrences)
    .map((a) => ({
      ...a,
      likelyCause: a.lows >= a.highs ? 'Possible slow leak or valve fault' : 'Possible over-inflation practice',
    }))
    .sort((a, b) => b.occurrences - a.occurrences || a.asset_no.localeCompare(b.asset_no))
}

/** Findings derived only from measured numbers. */
export function pressureInsights(inspections = [], { minSample = 20 } = {}) {
  const k = pressureKpis(inspections)
  const out = []
  if (!k.inspections) return out
  if (k.measurableCoveragePct != null && k.measurableCoveragePct < 80) {
    out.push({ priority: 'High', message: `Only ${Math.round(k.measurableCoveragePct)}% of inspections record at least ${PRESSURE_MIN_READINGS} pressures, so the rest cannot be judged. Require a pressure on every wheel.` })
  }
  if (k.compliancePct != null && k.measuredReadings >= minSample && k.compliancePct < 95) {
    out.push({ priority: k.compliancePct < 85 ? 'Critical' : 'High', message: `${(100 - k.compliancePct).toFixed(1)}% of measured readings sit more than 15% off their vehicle median (${k.under} low, ${k.over} high across ${k.flaggedVehicles} vehicles). Re-inflate and check valves on the flagged wheels.` })
  }
  if (k.uniformPct != null && k.measuredInspections >= minSample && k.uniformPct >= 50) {
    out.push({ priority: 'Medium', message: `${Math.round(k.uniformPct)}% of measured inspections record the identical pressure on every wheel. Confirm readings are gauged, not copied from a default.` })
  }
  const repeats = repeatDeviations(buildReadings(inspections))
  if (repeats.length) {
    out.push({ priority: 'High', message: `${repeats.length} wheel positions were off median on two or more inspections. Check these for slow leaks or valve faults first.` })
  }
  for (const s of siteCompliance(inspections)) {
    if (s.compliancePct != null && s.readings >= minSample && s.compliancePct < 85) {
      out.push({ priority: 'Medium', message: `${s.site}: ${s.compliancePct.toFixed(1)}% of ${s.readings} readings within tolerance.` })
    }
  }
  const order = { Critical: 0, High: 1, Medium: 2 }
  return out.sort((a, b) => order[a.priority] - order[b.priority])
}

export const READING_EXPORT_COLS = ['date', 'asset_no', 'site', 'inspector', 'position', 'group', 'pressure', 'median', 'deviationPct', 'statusLabel']
export const READING_EXPORT_HEADERS = ['Date', 'Asset', 'Site', 'Inspector', 'Position', 'Axle group', 'PSI', 'Vehicle median PSI', 'Deviation %', 'Status']

export function readingExportRows(readings = []) {
  return readings.map((r) => ({
    ...r,
    median: r.median ?? 'N/A',
    deviationPct: r.deviationPct ?? 'N/A',
    statusLabel: STATUS_META[r.status]?.short || r.status,
    date: r.date || 'N/A',
    site: r.site || 'N/A',
    inspector: r.inspector || 'N/A',
  }))
}
