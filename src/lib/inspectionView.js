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

import {
  resolveLayoutKey, canonicalToSlotId, BUILTIN_LAYOUT_SLOTS,
  vehicleTypeIsKnown, slotDisplayCode as slotCode, displayPositionCode,
  inspectionTypeHint,
} from './tyreBay'
import { severePositions, isSevereCondition } from './inspectionTyreFlags'

/** Condition word -> risk band. The vocabulary the WEB form writes. */
export const COND_TO_RISK = {
  Good: 'good', Wear: 'warning', Damage: 'critical', Puncture: 'critical', None: 'none',
}

/**
 * Risk band for a recorded condition, whichever surface recorded it.
 *
 * COND_TO_RISK is an EXACT match on the web form's four words, but the field
 * app writes a different set - Good / Worn / Flat / Damaged / Puncture - and
 * every word it does not share fell through to 'none', which the legend prints
 * as "No Data". Counted live: 326 Worn and 60 Flat readings, every one drawn as
 * a grey wheel nobody had looked at, when in fact an inspector had reported a
 * fault on it. ('Damaged' escaped only because the diagram separately rescued
 * it through damagedPositions.)
 *
 * So the exact map is tried first - it stays the definition for the words it
 * owns - and anything else is resolved by stem. An unrecognised word still
 * returns 'none': inventing a band for a condition nobody has defined would be
 * worse than admitting we cannot read it.
 */
export function riskForCondition(condition) {
  const s = condition == null ? '' : String(condition).trim()
  if (!s) return 'none'
  if (COND_TO_RISK[s]) return COND_TO_RISK[s]
  // Wear is tested before the fault stems so "worn" is a warning, not a
  // critical - the same order, and the same reason, as conditionCounts.
  if (/wear|worn/i.test(s)) return 'warning'
  if (isSevereCondition(s)) return 'critical'
  if (/good|\bok\b/i.test(s)) return 'good'
  return 'none'
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
        risk: data.risk ?? riskForCondition(condition),
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
        risk: riskForCondition(condition),
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
  // The name to PRINT for each wheel. Without it a row keyed by the mobile
  // capture id would head a column "R2Ri" while every tyre record for the same
  // wheel says RHRI.
  const labels = positionLabelMap(row)
  const rows = Object.entries(normTc)
    .filter(([, d]) => d && (d.condition || d.pressure != null || d.tread != null || d.notes))
    .map(([position, d]) => ({
      position,
      label: d.label || labels[position] || null,
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

// ── The wheel map ────────────────────────────────────────────────────────────
// Everything below turns one inspection into the props VehicleTyreDiagram
// needs. It lives here, beside the reading helpers, because the map and the
// table are two views of the SAME answer - splitting them is how a wheel ends
// up green while the row beneath it says "Damage".

// `vehicleTypeIsKnown` and the slot -> canonical-code conversion now live with
// the layout tables in tyreBay.js, so every screen that has to NAME a wheel
// reads one definition. Re-exported here because this module was their original
// home and the inspection surfaces import them from it.
export { vehicleTypeIsKnown, inspectionTypeHint }

/** Short reading printed inside the wheel. Never prints a zero it did not read. */
function wheelSubLabel(pressure, tread) {
  if (pressure != null) return `${Math.round(pressure)} PSI`
  if (tread != null) return `${tread} mm`
  return null
}

/**
 * What each recorded position should be CALLED on screen, keyed by the position
 * as it is stored.
 *
 * Two vocabularies exist in the data and both are correct in their own place:
 * the app stores the diagram's internal slot id ('F1L', 'R1Lo') as the key, and
 * displays the canonical GCC code ('LHF1', 'LHCO'). The diagram and the position
 * summary lines already relabel through `legacyPositionCode`, so anything that
 * prints the raw key beside them - a photo caption, for one - names the same
 * wheel differently on the same screen, and the reader has to pair them up by
 * hand on a safety record.
 *
 * This is NOT a new mapping. It is `displayPositionCode` - the one conversion
 * the diagram itself uses. The web form proves the pairing by storing both
 * itself, e.g. { position: 'R1Lo', label: 'LHCO' } on a tri-mixer.
 *
 * Order of preference, most trustworthy first:
 *   1. the label the inspector's own record carries
 *   2. the layout conversion, when this vehicle has a known wheel layout
 *   3. the stored key, unchanged
 * Step 3 is the honest floor: for a vehicle type with no defined layout there is
 * no conversion, and an invented label would point somebody at the wrong tyre.
 *
 * @param {object|null} row inspection row (tyre_conditions in any stored shape)
 * @returns {Object<string,string>} stored position -> display label
 */
export function positionLabelMap(row) {
  const normTc = normalizeTyreConditions(row)
  const positions = Object.keys(normTc)
  if (!positions.length) return {}

  const typeHint = inspectionTypeHint(row)
  const out = {}
  for (const position of positions) {
    const recorded = normTc[position]?.label
    out[position] = recorded ? String(recorded) : displayPositionCode(typeHint, position)
  }
  return out
}


/**
 * Turn one inspection row into the wheel map.
 *
 * @param {object} row  the inspection (tyre_conditions in any stored shape)
 * @param {object} [opts]
 * @param {Function} [opts.isTyreless]  predicate "this type has no tyres".
 *   Injected rather than imported so this module stays free of the React
 *   component that owns that list - one list, still only one place.
 *
 * @returns {{
 *   renderable: boolean, reason: string|null, vehicleType: string|null,
 *   layoutKey: string|null, slots: string[],
 *   tyreData: Object<string,{risk:string,condition:string|null}>,
 *   subLabels: Object<string,string>,
 *   readings: Array<{slot,code,condition,risk,pressure,tread}>,
 *   unrecorded: string[], unmatched: Array<{position,condition}>,
 *   stats: object|null
 * }}
 */
export function inspectionDiagramModel(row, { isTyreless } = {}) {
  const blank = {
    renderable: false, reason: null, vehicleType: null, layoutKey: null,
    slots: [], tyreData: {}, subLabels: {}, readings: [],
    unrecorded: [], unmatched: [], stats: null,
  }
  if (!row) return { ...blank, reason: 'Inspection not loaded.' }

  const recordedType = String(row.vehicle_type || '').trim()
  // The asset code carries the class (TM, MP, WL ...) when nobody filled the
  // vehicle type in, and the layout resolver already reads that prefix.
  const typeHint = inspectionTypeHint(row)

  if (recordedType && typeof isTyreless === 'function' && isTyreless(recordedType)) {
    return { ...blank, vehicleType: recordedType, reason: `${recordedType} has no tyres to inspect.` }
  }
  if (!vehicleTypeIsKnown(typeHint)) {
    return {
      ...blank,
      vehicleType: recordedType || null,
      reason: typeHint
        ? `No wheel layout is defined for "${typeHint}", so the tyre map cannot be drawn.`
        : 'Vehicle type was not recorded, so the tyre map cannot be drawn.',
    }
  }

  const layoutKey = resolveLayoutKey(typeHint)
  const slots = BUILTIN_LAYOUT_SLOTS[layoutKey] || []
  const normTc = normalizeTyreConditions(row)
  const stats = inspectionStats(normTc)

  // The red set is severePositions - the stop-the-vehicle subset of the same
  // detection that raises the register's flag and the corrective action. A word
  // it catches that the exact-match condition map does not ("Damaged") must
  // still burn the wheel red, or the map would contradict the flag on a safety
  // item. Wear is deliberately NOT here: it is a fault and it is tracked, but
  // the ladder puts it at warning and riskForCondition already colours it.
  const damagedSlots = new Set()
  for (const d of severePositions(row)) {
    const slot = canonicalToSlotId(typeHint, d.position)
    if (slot) damagedSlots.add(slot)
  }

  const tyreData = {}
  const subLabels = {}
  const readings = []
  const unmatched = []

  for (const [position, d] of Object.entries(normTc)) {
    // A position with nothing against it is not a reading; it stays unrecorded
    // so the wheel renders as "No Data" rather than as a silent pass.
    if (!d || !(d.condition || d.pressure != null || d.tread != null)) continue
    const slot = canonicalToSlotId(typeHint, position)
    if (!slot) { unmatched.push({ position, condition: d.condition || null }); continue }

    const risk = damagedSlots.has(slot) ? 'critical' : (d.risk || 'none')
    tyreData[slot] = { risk, condition: d.condition || null }
    const sub = wheelSubLabel(d.pressure, d.tread)
    if (sub) subLabels[slot] = sub
    readings.push({
      slot,
      code: slotCode(layoutKey, slot),
      condition: d.condition || RISK_LABEL[risk] || null,
      risk,
      pressure: d.pressure,
      tread: d.tread,
    })
  }

  // Layout order, so the caption reads front to rear like the picture.
  readings.sort((a, b) => slots.indexOf(a.slot) - slots.indexOf(b.slot))

  return {
    renderable: true,
    reason: null,
    vehicleType: typeHint,
    layoutKey,
    slots,
    tyreData,
    subLabels,
    readings,
    unrecorded: slots.filter((s) => !(s in tyreData)),
    unmatched,
    stats,
  }
}
