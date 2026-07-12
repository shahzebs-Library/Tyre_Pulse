/**
 * Digital Twin — pure builder (no I/O) that assembles a vehicle's "digital twin"
 * from the tyre_records currently in service on one asset. Each fitted position
 * gets a per-tyre health score (0-100) blended from tread depth, age band and
 * pressure; the vehicle rolls those up into an overall health score plus the
 * single worst position to act on. Ported concept from tyre_saas's Digital Twin,
 * wired to Tyre Pulse's existing data — deterministic (the clock is injected) and
 * unit-tested; the page consumes it directly.
 */
import { tyreAgeBand, tyreAgeYears } from './tyreAge'
import { classifyPressure } from './tpms'

// Tread model (mm): a new commercial tyre starts ~20mm; ~1.6mm is the legal floor.
export const NEW_TREAD_MM = 20
export const MIN_TREAD_MM = 1.6

// Age model (years): full marks under the advisory threshold, zero at end-of-life.
const AGE_HEALTHY_YEARS = 3
const AGE_DEAD_YEARS = 6

// Blend weights for the per-position health score (renormalised over the signals
// that are actually present, so a missing reading never fabricates a penalty).
const SIGNAL_WEIGHTS = { tread: 0.5, age: 0.3, pressure: 0.2 }

// Overall-score band → tone, so page and tests share one classification.
export const HEALTH_BANDS = [
  { min: 80, key: 'good', label: 'Healthy', tone: 'green' },
  { min: 60, key: 'fair', label: 'Monitor', tone: 'amber' },
  { min: 0, key: 'poor', label: 'At risk', tone: 'red' },
]

export function healthBand(score) {
  if (score == null) return { key: 'unknown', label: 'No data', tone: 'slate' }
  return HEALTH_BANDS.find((b) => score >= b.min) || HEALTH_BANDS[HEALTH_BANDS.length - 1]
}

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}
const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n)

export const serialOfRecord = (r) =>
  (r?.serial_no || r?.serial_number || r?.tyre_serial || '').toString().trim()
export const positionOfRecord = (r) =>
  (r?.position || r?.tyre_position || '').toString().trim()
export const assetOfRecord = (r) =>
  (r?.asset_no || r?.asset_number || '').toString().trim()

/** Tread → 0..100 (null when no reading). */
export function treadHealth(tread) {
  const t = num(tread)
  if (t == null) return null
  return Math.round(clamp01((t - MIN_TREAD_MM) / (NEW_TREAD_MM - MIN_TREAD_MM)) * 100)
}

/** Age (years) → 0..100 (null when no usable date). */
export function ageHealth(ageYears) {
  if (ageYears == null) return null
  if (ageYears <= AGE_HEALTHY_YEARS) return 100
  if (ageYears >= AGE_DEAD_YEARS) return 0
  return Math.round(((AGE_DEAD_YEARS - ageYears) / (AGE_DEAD_YEARS - AGE_HEALTHY_YEARS)) * 100)
}

/** Pressure band → 0..100 (null when unreadable). */
export function pressureHealth(pressure) {
  const band = classifyPressure(pressure)
  switch (band) {
    case 'optimal': return 100
    case 'over': return 65
    case 'under': return 55
    case 'critical': return 20
    default: return null
  }
}

/** Weighted blend of the available signals → 0..100, or null when none present. */
function blendHealth({ tread, age, pressure }) {
  const parts = [
    [tread, SIGNAL_WEIGHTS.tread],
    [age, SIGNAL_WEIGHTS.age],
    [pressure, SIGNAL_WEIGHTS.pressure],
  ].filter(([v]) => v != null)
  if (!parts.length) return null
  const wTotal = parts.reduce((a, [, w]) => a + w, 0)
  const score = parts.reduce((a, [v, w]) => a + v * w, 0) / wTotal
  return Math.round(score)
}

/** CPK for a record: lifetime cost / km. Null when km is absent/zero. */
function cpkOf(r) {
  const cost = num(r.cost_per_tyre)
  const km = num(r.total_km)
  if (cost == null || km == null || km <= 0) return null
  return Math.round((cost / km) * 1000) / 1000
}

/**
 * @param {object[]} tyresOnAsset  in-service tyre_records rows for ONE asset
 * @param {{ now?: number|Date }} [opts]  injected clock for deterministic ages
 * @returns {object} twin: { asset_no, tyreCount, positions[], healthScore, worstPosition }
 */
export function buildTwin(tyresOnAsset, { now } = {}) {
  const rows = (Array.isArray(tyresOnAsset) ? tyresOnAsset : []).filter(Boolean)
  const asOf = now == null ? Date.now() : now
  const asset_no = assetOfRecord(rows.find((r) => assetOfRecord(r)) || rows[0] || {}) || null

  const positions = rows.map((r) => {
    const ageYears = tyreAgeYears(r, asOf)
    const ageBand = tyreAgeBand(r, asOf)
    const tread = num(r.tread_depth)
    const pressure = num(r.pressure_reading)
    const signals = {
      tread: treadHealth(tread),
      age: ageHealth(ageYears),
      pressure: pressureHealth(pressure),
    }
    const health = blendHealth(signals)
    return {
      id: r.id,
      position: positionOfRecord(r) || null,
      serial: serialOfRecord(r) || null,
      brand: r.brand || null,
      size: r.size || null,
      tread,
      pressure,
      ageBand,
      ageYears,
      cpk: cpkOf(r),
      health,
      signals,
    }
  })

  // Overall score = mean of positions that carry any signal. Null when none do.
  const scored = positions.filter((p) => p.health != null)
  const healthScore = scored.length
    ? Math.round(scored.reduce((a, p) => a + p.health, 0) / scored.length)
    : null

  // Worst actionable position = lowest health among scored tyres.
  const worstPosition = scored.length
    ? scored.reduce((worst, p) => (p.health < worst.health ? p : worst)).position
    : null

  return { asset_no, tyreCount: rows.length, positions, healthScore, worstPosition }
}
