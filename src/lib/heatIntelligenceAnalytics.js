/**
 * Heat Intelligence analytics - pure page helpers (no I/O, deterministic).
 *
 * `src/lib/heatIntelligence.js` holds the locked engineering engine (its
 * functions are pinned by tests and may only be extended). This module sits on
 * top of it and shapes data for the /heat-intelligence page:
 *
 *   - scoreInstalledFleet   every installed tyre scored, NOT just the top 30
 *                           the engine's assessFleetRisk keeps for its cards.
 *                           The old page exported that capped list while its
 *                           own caption promised "Export for the full ranked
 *                           set".
 *   - filterRiskRows / riskSites / riskExportRows
 *   - filterReadings / readingRows / readingExportRows for the manual log.
 *
 * HONESTY NOTES
 * - Fleet risk score is null (N/A) when no installed tyre exists, never 0%.
 * - Coverage counts say how many scores rest on a real tread or pressure
 *   reading, because a tyre with neither is scored on heat and age alone.
 */
import {
  blowoutRiskScore, isInstalledTyre, targetPsiForSize, ageYearsFrom,
  toFiniteNumber, classifyTemp, tempOverAmbient, ROAD_SURFACE_DELTA,
} from './heatIntelligence'

export const RISK_LEVELS = ['extreme', 'high', 'elevated', 'medium', 'low']
export const READING_BANDS = ['critical', 'high', 'elevated', 'normal']
const BAND_LABEL = { critical: 'Critical', high: 'High', elevated: 'Elevated', normal: 'Normal' }
const LEVEL_LABEL = { extreme: 'Extreme', high: 'High', elevated: 'Elevated', medium: 'Medium', low: 'Low' }

function round1(v) {
  return v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10
}

/**
 * Score every installed tyre under the given heat condition.
 * Returns { rows, summary } where rows are sorted highest risk first.
 */
export function scoreInstalledFleet(records, { ambient_c, road_c, now = new Date() } = {}) {
  const list = Array.isArray(records) ? records : []
  const road = toFiniteNumber(road_c) ?? ((toFiniteNumber(ambient_c) ?? 0) + ROAD_SURFACE_DELTA)
  const bands = Object.fromEntries(RISK_LEVELS.map((l) => [l, 0]))
  const rows = []
  let withTread = 0
  let withPressure = 0
  for (const r of list) {
    if (!isInstalledTyre(r)) continue
    const tread = toFiniteNumber(r?.tread_depth)
    const pressure = toFiniteNumber(r?.pressure_reading)
    if (tread != null) withTread += 1
    if (pressure != null) withPressure += 1
    const { target, source } = targetPsiForSize(r?.size)
    const a = blowoutRiskScore({
      tread_mm: tread,
      pressure_psi: pressure,
      target_psi: target,
      road_c: road,
      age_years: ageYearsFrom(r, now),
      load_factor: 1.0,
    })
    bands[a.risk_level] = (bands[a.risk_level] || 0) + 1
    rows.push({
      id: r?.id ?? null,
      serial: (r?.serial_no || r?.serial_number || r?.tyre_serial || '') || null,
      asset_no: r?.asset_no || r?.asset_number || null,
      site: r?.site || null,
      position: r?.position || r?.tyre_position || null,
      brand: r?.brand || null,
      size: r?.size || null,
      tread_mm: tread,
      pressure_psi: pressure,
      target_psi: target,
      target_source: source,
      risk_score: a.risk_score,
      risk_level: a.risk_level,
      risk_label: LEVEL_LABEL[a.risk_level] || a.risk_level,
      road_surface_temp_c: a.road_surface_temp_c,
      deviation_pct: a.deviation_pct,
      factors: a.contributing_factors,
      factors_text: a.contributing_factors.map((f) => `${f.factor} (${f.value})`).join('; '),
      top_action: a.recommended_actions[0] || '',
      actions: a.recommended_actions,
      measured: tread != null || pressure != null,
    })
  }
  rows.sort((x, y) => y.risk_score - x.risk_score)
  const fleet = rows.length
  const dangerous = bands.extreme + bands.high
  return {
    rows,
    summary: {
      fleet_size: fleet,
      bands,
      at_risk: rows.filter((r) => r.risk_score >= 30).length,
      fleet_risk_score: fleet ? round1((dangerous / fleet) * 100) : null,
      with_tread: withTread,
      with_pressure: withPressure,
      unmeasured: rows.filter((r) => !r.measured).length,
      road_surface_c: road,
    },
  }
}

/** Distinct sites across the scored rows. */
export function riskSites(rows) {
  return [...new Set((Array.isArray(rows) ? rows : []).map((r) => r.site).filter(Boolean))].sort()
}

/**
 * Narrow scored rows. `level` is a risk level or 'at_risk' (score >= 30) or
 * '' for all; `site` exact; `search` over serial, asset, brand, size, position.
 */
export function filterRiskRows(rows, { level = '', site = '', search = '' } = {}) {
  const q = String(search ?? '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (level === 'at_risk' && r.risk_score < 30) return false
    if (level && level !== 'at_risk' && r.risk_level !== level) return false
    if (site && r.site !== site) return false
    if (q) {
      const hay = `${r.serial || ''} ${r.asset_no || ''} ${r.brand || ''} ${r.size || ''} ${r.position || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

export const RISK_EXPORT_COLS = ['serial', 'asset_no', 'site', 'position', 'brand', 'size', 'risk_score', 'risk_level', 'tread_mm', 'pressure_psi', 'road_surface_temp_c', 'target_psi', 'factors', 'action']
export const RISK_EXPORT_HEADERS = ['Serial', 'Asset', 'Site', 'Position', 'Brand', 'Size', 'Risk score', 'Risk level', 'Tread (mm)', 'Pressure (PSI)', 'Road °C', 'Target PSI (ref)', 'Contributing factors', 'Top action']

export function riskExportRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((t) => ({
    serial: t.serial || '',
    asset_no: t.asset_no || '',
    site: t.site || '',
    position: t.position || '',
    brand: t.brand || '',
    size: t.size || '',
    risk_score: t.risk_score,
    risk_level: t.risk_label,
    tread_mm: t.tread_mm ?? 'N/A',
    pressure_psi: t.pressure_psi ?? 'N/A',
    road_surface_temp_c: t.road_surface_temp_c,
    target_psi: t.target_psi,
    factors: t.factors_text,
    action: t.top_action,
  }))
}

/** Manual temperature log filter (asset, position, country, band, free text). */
export function filterReadings(rows, { asset = '', position = '', country = '', status = '', search = '' } = {}) {
  const q = String(search ?? '').trim().toLowerCase()
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    if (asset && r.asset_no !== asset) return false
    if (position && r.tyre_position !== position) return false
    if (country && r.country !== country) return false
    if (status && classifyTemp(r) !== status) return false
    if (q) {
      const hay = `${r.asset_no || ''} ${r.tyre_position || ''} ${r.tyre_serial || ''} ${r.location || ''} ${r.notes || ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

/** Readings shaped for a table: band, rise and numeric fields resolved once. */
export function readingRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const band = classifyTemp(r)
    return {
      ...r,
      band,
      band_label: BAND_LABEL[band] || band,
      band_rank: READING_BANDS.length - READING_BANDS.indexOf(band),
      rise_c: tempOverAmbient(r),
      temp_num: toFiniteNumber(r.temperature_c),
      ambient_num: toFiniteNumber(r.ambient_c),
      pressure_num: toFiniteNumber(r.pressure_bar),
      speed_num: toFiniteNumber(r.speed_kmh),
    }
  })
}

export const READING_EXPORT_COLS = ['asset_no', 'tyre_position', 'tyre_serial', 'temperature_c', 'ambient_c', 'rise_c', 'pressure_bar', 'speed_kmh', 'threshold_c', 'status', 'location', 'recorded_at', 'notes']
export const READING_EXPORT_HEADERS = ['Asset', 'Position', 'Serial', 'Temp (°C)', 'Ambient (°C)', 'Rise (°C)', 'Pressure (bar)', 'Speed (km/h)', 'Threshold (°C)', 'Status', 'Location', 'Recorded', 'Notes']

export function readingExportRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    asset_no: r.asset_no || '',
    tyre_position: r.tyre_position || '',
    tyre_serial: r.tyre_serial || '',
    temperature_c: r.temperature_c ?? '',
    ambient_c: r.ambient_c ?? '',
    rise_c: tempOverAmbient(r) ?? '',
    pressure_bar: r.pressure_bar ?? '',
    speed_kmh: r.speed_kmh ?? '',
    threshold_c: r.threshold_c ?? '',
    status: BAND_LABEL[classifyTemp(r)] || '',
    location: r.location || '',
    recorded_at: r.recorded_at || '',
    notes: r.notes || '',
  }))
}
