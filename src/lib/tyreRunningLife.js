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
    daysOn: num(r.days_on),
    expectedDays: num(r.expected_days),
    daySample: num(r.day_sample),
    remainingDays: num(r.remaining_days),
    lifeBasis: r.life_basis || null,
    kmAtFitment: num(r.km_at_fitment),
    currentKm: num(r.current_km),
    kmRun: num(r.km_run),
    hoursAtFitment: num(r.hours_at_fitment),
    currentHours: num(r.current_hours),
    hoursRun: num(r.hours_run),
    expectedLifeKm: num(r.expected_life_km),
    expectedLifeHours: num(r.expected_life_hours),
    lifeSample: num(r.life_sample),
    remainingKm: num(r.remaining_km),
    remainingHours: num(r.remaining_hours),
    lifeUsedPct: num(r.life_used_pct),
    hoursUsedPct: num(r.hours_used_pct),
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
  const measurableKm = rows.filter((r) => r.kmRun != null).length
  const measurableHours = rows.filter((r) => r.hoursRun != null).length
  // Tiles and row badges share ONE judgement (bandFor) so they can never disagree.
  const overdue = rows.filter((r) => bandFor(r) === 'overdue').length
  const dueSoon = rows.filter((r) => bandFor(r) === 'due-soon').length
  const pcts = rows.map((r) => (r.lifeUsedPct != null ? r.lifeUsedPct : r.hoursUsedPct)).filter((v) => v != null)
  const avgUsedPct = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null
  return { total, measurableKm, measurableHours, overdue, dueSoon, avgUsedPct }
}

/**
 * Traffic-light band for a row (drives the row badge). Judged in km when the
 * tyre has a km reading; an hour-metered tyre with only an hours target is
 * judged against that target instead (never 'unknown' just because the asset
 * runs on the hour meter).
 */
export function bandFor(row) {
  if (!row) return 'unknown'
  let rem = row.remainingKm
  let used = row.lifeUsedPct
  let soon = rem != null && rem < 10000
  if (rem == null && row.remainingHours != null) {
    rem = row.remainingHours
    used = row.hoursUsedPct
    soon = rem < 500
  }
  if (rem == null) return 'unknown'
  if (rem === 0) return 'overdue'
  if (soon || (used != null && used >= 90)) return 'due-soon'
  if (used != null && used >= 60) return 'mid-life'
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
      || r.vehicleType.toLowerCase().includes(q)
  })
}

export const fmtNum = (v) => (v == null ? 'N/A' : Math.round(v).toLocaleString('en-US'))

/** "60,000 km / 8,000 hrs" - whichever of the two dimensions is set; N/A when neither. */
export function lifeDisplay(kmVal, hoursVal) {
  const parts = []
  if (kmVal != null) parts.push(`${fmtNum(kmVal)} km`)
  if (hoursVal != null) parts.push(`${fmtNum(hoursVal)} hrs`)
  return parts.length ? parts.join(' / ') : 'N/A'
}

/** Binary due flag from the band: Due / Not due / Unknown. */
export function dueLabel(row) {
  const b = bandFor(row)
  if (b === 'overdue' || b === 'due-soon') return 'Due'
  if (b === 'unknown') return 'Unknown'
  return 'Not due'
}

/** Plain-English label for what an expected life is based on. */
export const BASIS_META = {
  manual: { label: 'Your target', tone: 'info' },
  measured_type: { label: 'Type avg', tone: 'good' },
  measured_size: { label: 'Size avg', tone: 'quiet' },
}
export function basisLabel(row) {
  if (!row || !row.lifeBasis) return 'No baseline'
  const meta = BASIS_META[row.lifeBasis]
  if (!meta) return 'No baseline'
  if (row.lifeBasis === 'manual') return meta.label
  return row.lifeSample != null ? `${meta.label} (${row.lifeSample})` : meta.label
}
