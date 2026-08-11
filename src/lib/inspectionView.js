/**
 * How a completed inspection is read - one definition, used by every surface.
 *
 * This logic lived inside exportInspectionDetailPdf. It moved here the moment a
 * second surface needed it, for the same reason checklistView.js exists: two
 * copies of "what did the inspector record" drift, and the drift is invisible -
 * the report and the on-screen viewer would quietly disagree about a reading
 * somebody signed off.
 *
 * The row is the source of truth. `tyre_conditions` arrives in three shapes
 * depending on who wrote it (web form object, mobile array, or a JSON string),
 * and mobile names its readings pressure_psi / tread_depth_mm, so normalising is
 * the whole job. Nothing here fabricates a value: an unrecorded reading stays
 * null and reads as "Not recorded", never as 0.
 */

/** Condition word -> risk band. The vocabulary the app writes. */
export const COND_TO_RISK = {
  Good: 'good', Wear: 'warning', Damage: 'critical', Puncture: 'critical', None: 'none',
}

/** Risk band -> label. 'none' is "no data", not "no risk". */
export const RISK_LABEL = {
  good: 'Good', warning: 'Warning', critical: 'Critical', none: 'No Data',
}

/** A reading is present only when it is a real positive number. */
function reading(v) {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : null
}

function firstDefined(...vals) {
  for (const v of vals) if (v !== undefined && v !== null && v !== '') return v
  return null
}

/**
 * Normalise one inspection's tyre_conditions into an object keyed by position.
 *
 * Tolerates every shape the app has ever written:
 *   - an object keyed by position, value an object or a bare condition string
 *   - an array of { position, condition, pressure, treadDepth, ... } (mobile,
 *     and the web checklist tab, which posts clPositions as an array)
 *   - a JSON string of either
 * Returns {} for anything unparseable rather than throwing.
 */
export function normalizeTyreConditions(source) {
  let tc = source && typeof source === 'object' && 'tyre_conditions' in source
    ? source.tyre_conditions
    : source
  if (typeof tc === 'string') {
    try { tc = JSON.parse(tc) } catch { return {} }
  }
  if (!tc || typeof tc !== 'object') return {}

  const entries = Array.isArray(tc)
    ? tc.map((d, i) => [d && (d.position || d.label) ? String(d.position || d.label) : String(i), d])
    : Object.entries(tc)

  const out = {}
  for (const [pos, data] of entries) {
    if (data && typeof data === 'object') {
      const condition = firstDefined(data.condition)
      out[pos] = {
        risk: data.risk ?? (condition ? (COND_TO_RISK[condition] ?? 'none') : 'none'),
        // Mobile stores pressure_psi / tread_depth_mm; the web form stores
        // pressure / treadDepth. All of them mean the same reading.
        pressure: reading(firstDefined(data.pressure, data.pressure_psi, data.psi)),
        tread: reading(firstDefined(data.tread, data.treadDepth, data.tread_depth, data.tread_depth_mm)),
        condition: condition ? String(condition) : null,
        notes: firstDefined(data.notes, data.note),
        label: firstDefined(data.label),
        photo: firstDefined(data.photo_url, data.photo_uri),
      }
    } else {
      const condition = data == null || data === '' ? null : String(data)
      out[pos] = {
        risk: condition ? (COND_TO_RISK[condition] ?? 'none') : 'none',
        pressure: null, tread: null, condition, notes: null, label: null, photo: null,
      }
    }
  }
  return out
}

const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null)
const median = (a) => {
  if (!a.length) return null
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Counts and recorded-only averages over a normalised condition map.
 * Averages are null when nothing was recorded - an average of no readings is
 * not zero.
 */
export function inspectionStats(normTc) {
  const counts = { good: 0, warning: 0, critical: 0, none: 0 }
  const pressures = []
  const treads = []
  let lowTread = null
  for (const [pos, d] of Object.entries(normTc || {})) {
    const r = d?.risk ?? 'none'
    counts[r] = (counts[r] || 0) + 1
    if (d?.pressure != null) pressures.push(d.pressure)
    if (d?.tread != null) {
      treads.push(d.tread)
      if (!lowTread || d.tread < lowTread.value) lowTread = { pos, value: d.tread }
    }
  }
  return {
    total: Object.keys(normTc || {}).length,
    counts,
    avgPressure: avg(pressures),
    avgTread: avg(treads),
    lowTread,
    medianPressure: median(pressures),
    recordedPressures: pressures.length,
  }
}

/** Below this many readings there is no meaningful median to compare against. */
export const PRESSURE_MIN_READINGS = 4
/** How far off that vehicle's own median counts as worth checking. */
export const PRESSURE_TOLERANCE = 0.15

/**
 * Is the pressure column comparable at all?
 *
 * There is no stored target pressure anywhere in the schema, so the only
 * defensible reference is the vehicle's own median - and a median of one or two
 * readings is noise, which is why it takes four.
 */
export function pressureFlagAvailable(stats) {
  return Boolean(stats && stats.recordedPressures >= PRESSURE_MIN_READINGS && stats.medianPressure > 0)
}

/**
 * One position's pressure against the vehicle's own median.
 * Returns null when there is nothing to compare, so a caller can omit the
 * column rather than print a reassuring "OK" it did not measure.
 */
export function pressureDeviation(pressure, stats) {
  if (!pressureFlagAvailable(stats)) return null
  const n = Number(pressure)
  if (!Number.isFinite(n) || n <= 0) return null
  const dev = (n - stats.medianPressure) / stats.medianPressure
  return {
    dev,
    pct: Math.round(Math.abs(dev) * 100),
    check: Math.abs(dev) > PRESSURE_TOLERANCE,
    direction: dev > 0 ? 'over' : 'under',
  }
}

/**
 * The per-position rows worth showing.
 *
 * A position appears only when something was actually recorded against it,
 * which drops the untouched wheels of a part-completed inspection without ever
 * hiding a reading. A recorded condition of "Damage" with no numbers is still
 * content, and so is a note on its own.
 */
export function tyreReadingRows(row) {
  const normTc = normalizeTyreConditions(row)
  const stats = inspectionStats(normTc)
  const rows = Object.entries(normTc)
    .filter(([, d]) => d && (d.condition || d.pressure != null || d.tread != null || d.notes))
    .map(([position, d]) => ({
      position,
      label: d.label || null,
      condition: d.condition || RISK_LABEL[d.risk] || null,
      risk: d.risk || 'none',
      pressure: d.pressure,
      tread: d.tread,
      notes: d.notes || null,
      photo: d.photo || null,
      pressureFlag: pressureDeviation(d.pressure, stats),
    }))
  return { rows, stats, normTc }
}

/** Render a recorded number, or say plainly that it was not recorded. */
export function readingText(value, unit = '') {
  if (value == null) return 'Not recorded'
  return `${value}${unit}`
}

/**
 * The header facts of an inspection, as label/value pairs.
 * Mirrors the report's meta grid so the screen and the PDF name the same things.
 */
export function inspectionMeta(row) {
  if (!row) return []
  const meters = [
    row.odometer_km != null && row.odometer_km !== '' ? `${Number(row.odometer_km).toLocaleString('en-US')} km` : null,
    row.hour_meter != null && row.hour_meter !== '' ? `${Number(row.hour_meter).toLocaleString('en-US')} hrs` : null,
  ].filter(Boolean).join('  |  ')
  return [
    ['Inspection date', row.inspection_date || row.scheduled_date || null],
    ['Asset', row.asset_no || null],
    ['Site', row.site || null],
    ['Vehicle type', row.vehicle_type || null],
    ['Tyreman', row.inspector || row.attendees || null],
    ['Meters', meters || null],
    ['Status', row.status || null],
    ['Severity', row.severity || null],
  ].filter(([, v]) => v != null && v !== '')
}

/** True when the record itself says the inspection was finished. */
export function isComplete(row) {
  return /^(done|completed|approved)$/i.test(String(row?.status || ''))
}

/**
 * A short headline for the viewer. Nulls rather than zeros for a missing row -
 * "we have not loaded it" and "it recorded nothing" are different statements.
 */
export function inspectionSummary(row) {
  if (!row) return { positions: null, recorded: null, damaged: null, avgPressure: null, lowTread: null }
  const { rows, stats } = tyreReadingRows(row)
  return {
    positions: stats.total,
    recorded: rows.length,
    damaged: stats.counts.critical || 0,
    avgPressure: stats.avgPressure,
    lowTread: stats.lowTread,
  }
}
