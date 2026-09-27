/**
 * tpmsPageAnalytics - pure page-side logic for /tpms. Zero I/O.
 *
 * The pressure maths (banding, KPIs, trend, site / position breakdowns,
 * worst offenders, under-inflation insight) lives in src/lib/tpms.js and
 * src/lib/tpmsAnalytics.js and is REUSED. This module owns what the page used
 * to compute inline: normalising the two data sources into one reading shape,
 * filtering, the deviation label, export rows and the honest compliance read.
 *
 * Honesty: tpmsAnalytics reports compliance 0% when NOTHING could be assessed.
 * The page must not print "0% compliant" for a set it could not measure, so
 * `honestCompliance` turns that case into null ("N/A").
 */
import { classifyPressure, DEFAULT_TARGET_PRESSURE, DEFAULT_TOLERANCE_PCT } from './tpms'

export const BAND_LABEL = {
  optimal: 'Optimal', under: 'Under-inflated', over: 'Over-inflated', critical: 'Critical', unknown: 'Not assessed',
}

const finite = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Normalise a sensor (tpms_readings) or baseline (tyre_records) row. */
export function normalizeReading(row, source) {
  const sensor = source === 'sensor'
  const pressure = finite(sensor ? row?.pressure : row?.pressure_reading)
  const tgt = finite(row?.target_pressure)
  const target = tgt != null && tgt > 0 ? tgt : DEFAULT_TARGET_PRESSURE
  return {
    id: row?.id,
    source,
    asset_no: row?.asset_no ?? null,
    serial: sensor ? (row?.tyre_serial ?? null) : (row?.serial_no ?? null),
    position: sensor ? (row?.tyre_position ?? null) : (row?.position ?? null),
    size: sensor ? null : (row?.size ?? null),
    site: row?.site ?? null,
    country: row?.country ?? null,
    pressure: pressure != null && pressure > 0 ? pressure : null,
    temperature: sensor ? finite(row?.temperature) : null,
    target,
    targetIsDefault: !(tgt != null && tgt > 0),
    band: classifyPressure(pressure, target, DEFAULT_TOLERANCE_PCT),
    date: sensor ? (row?.recorded_at ?? null) : (row?.issue_date ?? null),
  }
}

/** Signed deviation from target in percent, null when unmeasurable. */
export function deviationPct(r) {
  if (r?.pressure == null || !(r?.target > 0)) return null
  return ((r.pressure - r.target) / r.target) * 100
}

export function deviationLabel(r) {
  const d = deviationPct(r)
  if (d == null) return 'N/A'
  return `${d > 0 ? '+' : ''}${d.toFixed(0)}%`
}

/** Filter readings by band / site / position / free text. */
export function filterReadings(readings = [], { band = '', site = '', position = '', search = '' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return (readings || []).filter((r) => {
    if (!r) return false
    if (band && r.band !== band) return false
    if (site && r.site !== site) return false
    if (position && r.position !== position) return false
    if (q) {
      const hay = [r.asset_no, r.serial, r.site, r.position, r.size].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export function distinctValues(readings = [], key) {
  return [...new Set((readings || []).map((r) => r?.[key]).filter(Boolean))].sort()
}

/** Compliance % that is null when no reading could be assessed. */
export function honestCompliance(kpis) {
  if (!kpis || !(kpis.assessed > 0)) return null
  return kpis.compliancePct
}

/** Semantic tone for a compliance percentage (null stays neutral). */
export function complianceTone(pct) {
  if (pct == null) return 'neutral'
  if (pct >= 90) return 'good'
  if (pct >= 75) return 'warn'
  return 'crit'
}

/** Share of readings that carry their OWN target (vs the fleet default). */
export function targetCoverage(readings = []) {
  const list = (readings || []).filter(Boolean)
  if (!list.length) return null
  const own = list.filter((r) => !r.targetIsDefault).length
  return Math.round((own / list.length) * 100)
}

export const TPMS_EXPORT_COLUMNS = [
  { key: 'asset_no', header: 'Asset No' },
  { key: 'serial', header: 'Serial' },
  { key: 'position', header: 'Position' },
  { key: 'size', header: 'Size' },
  { key: 'pressure', header: 'Pressure (bar)' },
  { key: 'target', header: 'Target (bar)' },
  { key: 'deviation', header: 'Deviation' },
  { key: 'temperature', header: 'Temp (C)' },
  { key: 'status', header: 'Status' },
  { key: 'site', header: 'Site' },
  { key: 'country', header: 'Country' },
  { key: 'recorded', header: 'Recorded' },
  { key: 'source', header: 'Source' },
]

export function tpmsExportRows(readings = []) {
  return (readings || []).filter(Boolean).map((r) => ({
    asset_no: r.asset_no || 'N/A',
    serial: r.serial || 'N/A',
    position: r.position || 'N/A',
    size: r.size || 'N/A',
    pressure: r.pressure ?? 'N/A',
    target: r.target,
    deviation: deviationLabel(r),
    temperature: r.temperature ?? 'N/A',
    status: BAND_LABEL[r.band] || r.band,
    site: r.site || 'N/A',
    country: r.country || 'N/A',
    recorded: r.date ? String(r.date).slice(0, 10) : 'N/A',
    source: r.source === 'sensor' ? 'Sensor' : 'Tyre record baseline',
  }))
}

export { DEFAULT_TARGET_PRESSURE, DEFAULT_TOLERANCE_PCT }
