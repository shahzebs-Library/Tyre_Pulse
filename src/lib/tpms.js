/**
 * TPMS pure logic — pressure classification and aggregation.
 *
 * Zero I/O, framework-free and fully unit-testable. Consumed by the /tpms page
 * to band live sensor readings (tpms_readings) and the tyre_records pressure
 * baseline into under / optimal / over / critical states.
 *
 * Units: pressure is interpreted in the same unit as `target`. The fleet-wide
 * default target is 8.0 bar with a ±15% tolerance band (typical commercial
 * truck cold-inflation working range). A per-reading `target_pressure` (from a
 * sensor or a size-based spec) overrides the default when present.
 */

/** Fleet default cold-inflation target (bar) and tolerance (percent). */
export const DEFAULT_TARGET_PRESSURE = 8.0
export const DEFAULT_TOLERANCE_PCT = 15

/** The four bands persisted in tpms_readings.status, plus the null-safe 'unknown'. */
export const PRESSURE_BANDS = ['optimal', 'under', 'over', 'critical', 'unknown']

/**
 * Classify a pressure against a target band.
 *
 * Banding (tol = tolerancePct / 100):
 *   - < target * (1 - 2*tol)  → 'critical'  (severe under-inflation — blow-out risk)
 *   - < target * (1 - tol)    → 'under'
 *   - > target * (1 + tol)    → 'over'
 *   - otherwise               → 'optimal'
 * Invalid / non-numeric pressure or non-positive target → 'unknown'.
 *
 * @param {number} pressure
 * @param {number} [target=DEFAULT_TARGET_PRESSURE]
 * @param {number} [tolerancePct=DEFAULT_TOLERANCE_PCT]
 * @returns {'optimal'|'under'|'over'|'critical'|'unknown'}
 */
export function classifyPressure(pressure, target = DEFAULT_TARGET_PRESSURE, tolerancePct = DEFAULT_TOLERANCE_PCT) {
  const p = Number(pressure)
  const t = Number(target)
  if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(t) || t <= 0) return 'unknown'
  const tol = Math.abs(Number(tolerancePct)) / 100
  const lower = t * (1 - tol)
  const upper = t * (1 + tol)
  const critical = t * (1 - 2 * tol)
  if (p < critical) return 'critical'
  if (p < lower) return 'under'
  if (p > upper) return 'over'
  return 'optimal'
}

/** Absolute deviation from target, as a percentage. 0 when target invalid. */
export function deviationPct(pressure, target = DEFAULT_TARGET_PRESSURE) {
  const p = Number(pressure)
  const t = Number(target)
  if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(t) || t <= 0) return 0
  return Math.abs(((p - t) / t) * 100)
}

/**
 * Resolve the target for a row: explicit per-row target_pressure/target wins,
 * else the supplied fleet default.
 */
function targetFor(row, fallback) {
  const t = Number(row?.target_pressure ?? row?.target)
  return Number.isFinite(t) && t > 0 ? t : fallback
}

/** Pick a row's pressure from either the sensor field or the baseline field. */
function pressureOf(row) {
  return row?.pressure ?? row?.pressure_reading
}

/** Pick a row's position from either the sensor field or the baseline field. */
function positionOf(row) {
  return row?.tyre_position ?? row?.position ?? null
}

/**
 * Summarize a set of readings into band counts, plus breakdowns by site and by
 * position. Each row may carry either sensor fields (pressure, tyre_position,
 * target_pressure) or baseline fields (pressure_reading, position). Null-safe.
 *
 * @param {Array<object>} rows
 * @param {{target?:number, tolerancePct?:number}} [opts]
 * @returns {{
 *   total:number,
 *   bands:{optimal:number,under:number,over:number,critical:number,unknown:number},
 *   alerts:number,
 *   avgPressure:number|null,
 *   bySite:Array<{site:string,total:number,optimal:number,under:number,over:number,critical:number,alerts:number}>,
 *   byPosition:Array<{position:string,total:number,optimal:number,under:number,over:number,critical:number,alerts:number}>
 * }}
 */
export function summarizePressure(rows, opts = {}) {
  const target = Number.isFinite(Number(opts.target)) && Number(opts.target) > 0
    ? Number(opts.target) : DEFAULT_TARGET_PRESSURE
  const tolerancePct = Number.isFinite(Number(opts.tolerancePct))
    ? Number(opts.tolerancePct) : DEFAULT_TOLERANCE_PCT

  const bands = { optimal: 0, under: 0, over: 0, critical: 0, unknown: 0 }
  const siteMap = new Map()
  const posMap = new Map()
  let pressureSum = 0
  let pressureN = 0

  const list = Array.isArray(rows) ? rows : []
  for (const row of list) {
    const p = Number(pressureOf(row))
    const band = classifyPressure(p, targetFor(row, target), tolerancePct)
    bands[band] += 1
    if (Number.isFinite(p) && p > 0) { pressureSum += p; pressureN += 1 }

    const bump = (map, key) => {
      const k = key || 'Unspecified'
      if (!map.has(k)) map.set(k, { total: 0, optimal: 0, under: 0, over: 0, critical: 0, unknown: 0, alerts: 0 })
      const e = map.get(k)
      e.total += 1
      e[band] += 1
      if (band === 'under' || band === 'over' || band === 'critical') e.alerts += 1
    }
    bump(siteMap, row?.site)
    bump(posMap, positionOf(row))
  }

  const alerts = bands.under + bands.over + bands.critical
  const toRows = (map, key) => Array.from(map.entries())
    .map(([name, v]) => ({ [key]: name, ...v }))
    .sort((a, b) => b.alerts - a.alerts || b.total - a.total)

  return {
    total: list.length,
    bands,
    alerts,
    avgPressure: pressureN > 0 ? pressureSum / pressureN : null,
    bySite: toRows(siteMap, 'site'),
    byPosition: toRows(posMap, 'position'),
  }
}
