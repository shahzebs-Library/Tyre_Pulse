/**
 * tyreRunningLife - pure shaping for the "Running & Remaining" view
 * (per active tyre: km/hours run against the asset's current meters, and the
 * projected remaining km from the fleet's own measured life for that size).
 *
 * Every figure may be null (no meter, placeholder fitment km, no baseline) -
 * callers render N/A, never a fabricated number.
 */

const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Normalise one RPC row. */
export function shapeRow(r = {}) {
  return {
    serial: r.serial_no || '',
    asset: r.asset_no || '',
    position: r.position || '',
    vehicleType: r.vehicle_type || '',
    unit: r.unit === 'engine_hours' ? 'hours' : 'km',
    site: r.site || '',
    country: r.country || '',
    brand: r.brand || '',
    size: r.size || '',
    fittedOn: r.fitted_on || null,
    kmAtFitment: num(r.km_at_fitment),
    currentKm: num(r.current_km),
    kmRun: num(r.km_run),
    hoursAtFitment: num(r.hours_at_fitment),
    currentHours: num(r.current_hours),
    hoursRun: num(r.hours_run),
    expectedLifeKm: num(r.expected_life_km),
    lifeSample: num(r.life_sample),
    remainingKm: num(r.remaining_km),
    lifeUsedPct: num(r.life_used_pct),
  }
}

/** Shape the whole RPC payload -> { ok, rows, summary }. */
export function shapeRunningLife(payload) {
  if (!payload || payload.ok === false) return { ok: false, rows: [], summary: emptySummary() }
  const rows = (Array.isArray(payload.rows) ? payload.rows : []).map(shapeRow)
  return { ok: true, rows, summary: summarize(rows) }
}

function emptySummary() {
  return { total: 0, measurableKm: 0, measurableHours: 0, overdue: 0, dueSoon: 0, avgUsedPct: null }
}

/**
 * Summary tiles. "Due soon" = remaining under 10,000 km or >= 90% of expected
 * life used; "overdue" = past the expected life entirely (remaining 0).
 */
export function summarize(rows = []) {
  const total = rows.length
  const withRemaining = rows.filter((r) => r.remainingKm != null)
  const measurableKm = rows.filter((r) => r.kmRun != null).length
  const measurableHours = rows.filter((r) => r.hoursRun != null).length
  const overdue = withRemaining.filter((r) => r.remainingKm === 0).length
  const dueSoon = withRemaining.filter((r) => r.remainingKm > 0
    && (r.remainingKm < 10000 || (r.lifeUsedPct != null && r.lifeUsedPct >= 90))).length
  const pcts = rows.map((r) => r.lifeUsedPct).filter((v) => v != null)
  const avgUsedPct = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null
  return { total, measurableKm, measurableHours, overdue, dueSoon, avgUsedPct }
}

/** Traffic-light band for a row (drives the row badge). */
export function bandFor(row) {
  if (!row || row.remainingKm == null) return 'unknown'
  if (row.remainingKm === 0) return 'overdue'
  if (row.remainingKm < 10000 || (row.lifeUsedPct != null && row.lifeUsedPct >= 90)) return 'due-soon'
  if (row.lifeUsedPct != null && row.lifeUsedPct >= 60) return 'mid-life'
  return 'healthy'
}

export const BAND_META = {
  overdue: { label: 'Past expected life', tone: 'danger' },
  'due-soon': { label: 'Due soon', tone: 'warning' },
  'mid-life': { label: 'Mid life', tone: 'info' },
  healthy: { label: 'Healthy', tone: 'good' },
  unknown: { label: 'Not measurable', tone: 'quiet' },
}

/** Search + band + unit filter over shaped rows. */
export function filterRows(rows = [], { search = '', band = 'all', unit = 'all' } = {}) {
  const q = String(search || '').trim().toLowerCase()
  return rows.filter((r) => {
    if (unit !== 'all' && r.unit !== unit) return false
    if (band !== 'all' && bandFor(r) !== band) return false
    if (!q) return true
    return r.serial.toLowerCase().includes(q)
      || r.asset.toLowerCase().includes(q)
      || r.site.toLowerCase().includes(q)
      || r.brand.toLowerCase().includes(q)
      || r.size.toLowerCase().includes(q)
  })
}

export const fmtNum = (v) => (v == null ? 'N/A' : Math.round(v).toLocaleString('en-US'))
