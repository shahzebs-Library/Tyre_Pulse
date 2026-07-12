/**
 * importChecklist — turn a maintenance/inspection spreadsheet into a checklist
 * template. Pure (no I/O). Designed around the "Predictive Maintenance" layout
 * (Category · Sub Category · Date Interval · Symptoms · Requirement) but tolerant
 * of column-name variations. Produces a template whose items are grouped into
 * category sections and conditionally shown by an "Inspection interval" selector
 * (and, when the sheet carries per-vehicle-type columns, an "Vehicle type"
 * selector) so a point appears only when both the interval and the vehicle type
 * match. Nothing is fabricated: vehicle-type conditions are emitted only for
 * items the source data actually scopes to a subset of vehicles.
 */
import { newField, newFieldId } from './fieldTypes'

const HEADER_ALIASES = {
  category: ['category', 'system', 'group'],
  subcategory: ['sub category', 'subcategory', 'sub-category', 'item', 'component', 'part'],
  interval: ['date interval', 'interval', 'frequency', 'schedule'],
  symptoms: ['symptoms', 'symptom', 'check', 'checkpoint', 'check point', 'observation'],
  requirement: ['requirement', 'requirements', 'spare', 'action', 'remarks', 'notes'],
  vehicletype: ['vehicle type', 'asset type', 'applicable', 'applicable to', 'equipment', 'model', 'applies to'],
}

const INTERVAL_ORDER = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Semi-annual', 'Annual', '2-Yearly', '4-Yearly']

// Canonical fleet vehicle-type codes (asset-number prefixes) and their labels.
// MP = concrete pump, TM = transit mixer, LP = light pickup, BH = bus/heavy.
const VEHICLE_TYPES = [
  { code: 'MP', label: 'Concrete Pump (MP)' },
  { code: 'TM', label: 'Transit Mixer (TM)' },
  { code: 'LP', label: 'Pickup / Light (LP)' },
  { code: 'BH', label: 'Bus / Heavy (BH)' },
]
const VEHICLE_CODE_SET = new Set(VEHICLE_TYPES.map((v) => v.code))
// Word → code aliases used when a single free-text column names the vehicle.
const VEHICLE_WORD_ALIASES = [
  [/pump/, 'MP'], [/\bmp\b/, 'MP'],
  [/mixer|\btm\b|drum|agitat/, 'TM'],
  [/pickup|\blp\b|\bpl\b|light/, 'LP'],
  [/\bbus\b|\bbh\b|heavy/, 'BH'],
]

/** Map an arbitrary vehicle token/word to a canonical code, or null. */
export function normalizeVehicleCode(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  const up = s.toUpperCase().replace(/[^A-Z]/g, '')
  if (VEHICLE_CODE_SET.has(up.slice(0, 2))) return up.slice(0, 2)
  const low = s.toLowerCase()
  for (const [re, code] of VEHICLE_WORD_ALIASES) if (re.test(low)) return code
  return null
}

/** Normalise a raw "Date Interval" cell to a canonical interval label. */
export function normalizeInterval(raw) {
  const s = String(raw || '').toLowerCase()
  if (!s.trim()) return ''
  if (s.includes('daily')) return 'Daily'
  if (s.includes('week')) return 'Weekly'
  if (s.includes('month')) return 'Monthly'
  if (s.includes('quarter')) return 'Quarterly'
  if (s.includes('semi') || s.includes('half') || s.includes('bi-an')) return 'Semi-annual'
  if (/\b4\s*year|four year/.test(s)) return '4-Yearly'
  if (/\b2\s*year|two year/.test(s)) return '2-Yearly'
  if (s.includes('annual') || s.includes('year')) return 'Annual'
  return String(raw).trim()
}

function matchHeader(cell) {
  const c = String(cell || '').trim().toLowerCase()
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    if (aliases.some((a) => c === a || c.startsWith(a))) return key
  }
  return null
}

/**
 * Detect per-vehicle-type columns in a header row. Matches headers that name a
 * vehicle code — e.g. "MP", "TM Hr", "Recommended Inspect Hr (BH)", "LP KM" —
 * where a non-empty body cell means "this item applies to that vehicle type".
 * Returns a map { code -> columnIndex } (first column per code wins).
 */
export function detectVehicleColumns(headerRow) {
  const cols = {}
  ;(Array.isArray(headerRow) ? headerRow : []).forEach((cell, i) => {
    const raw = String(cell || '').trim()
    if (!raw) return
    // Look for a standalone vehicle code as a whole word (avoids matching
    // substrings inside ordinary words).
    const codeMatch = raw.toUpperCase().match(/\b(MP|TM|LP|BH)\b/)
    const code = codeMatch ? codeMatch[1] : null
    if (code && VEHICLE_CODE_SET.has(code) && cols[code] == null) cols[code] = i
  })
  return cols
}

/**
 * Locate the header row + column indexes in a matrix of rows (array of arrays).
 * Returns { headerRow, cols:{...}, vehicleCols:{code:index} } or null when no
 * recognisable header is found in the first ~12 rows.
 */
export function detectColumns(rows) {
  const scan = Math.min(rows.length, 12)
  for (let r = 0; r < scan; r++) {
    const row = rows[r] || []
    const cols = {}
    row.forEach((cell, i) => {
      const key = matchHeader(cell)
      if (key && cols[key] == null) cols[key] = i
    })
    if (cols.subcategory != null && cols.category != null) {
      return { headerRow: r, cols, vehicleCols: detectVehicleColumns(row) }
    }
  }
  return null
}

/**
 * Build a checklist template draft from spreadsheet rows (array of arrays).
 * @param {any[][]} rows
 * @param {{ name?, description? }} [opts]
 * @returns {{ template, stats }} template = a builder-ready draft; stats = counts.
 */
export function buildTemplateFromRows(rows, opts = {}) {
  const matrix = Array.isArray(rows) ? rows.filter((r) => Array.isArray(r)) : []
  const detected = detectColumns(matrix)
  if (!detected) {
    return { template: null, stats: { items: 0, categories: 0, intervals: [], vehicleTypes: [], error: 'No Category / Sub Category columns found.' } }
  }
  const { headerRow, cols, vehicleCols } = detected
  const body = matrix.slice(headerRow + 1)

  const at = (row, key) => (cols[key] != null ? row[cols[key]] : undefined)
  const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim()
  const cellFilled = (v) => {
    const s = clean(v).toLowerCase()
    return !!s && !['-', 'na', 'n/a', 'no', '0', 'x'].includes(s)
  }

  // Which vehicle-type codes does this item apply to?
  // Priority: explicit per-vehicle columns (non-empty cell) → single free-text
  // "vehicle type" column → none (applies to all).
  const vehicleCodesForRow = (row) => {
    const codes = new Set()
    for (const [code, idx] of Object.entries(vehicleCols || {})) {
      if (cellFilled(row[idx])) codes.add(code)
    }
    if (codes.size === 0 && cols.vehicletype != null) {
      const raw = clean(row[cols.vehicletype])
      raw.split(/[,/;|&+]+|\band\b/i).forEach((tok) => {
        const c = normalizeVehicleCode(tok)
        if (c) codes.add(c)
      })
    }
    return [...codes]
  }

  // Group items by category, preserving first-seen order.
  const catOrder = []
  const byCat = new Map()
  const intervalsSeen = new Set()
  const vehicleTypesSeen = new Set()

  for (const row of body) {
    const sub = clean(at(row, 'subcategory'))
    if (!sub) continue
    const category = clean(at(row, 'category')) || 'General'
    const interval = normalizeInterval(at(row, 'interval'))
    if (interval) intervalsSeen.add(interval)
    const vehicleCodes = vehicleCodesForRow(row)
    vehicleCodes.forEach((c) => vehicleTypesSeen.add(c))
    const symptoms = clean(at(row, 'symptoms'))
    const requirement = clean(at(row, 'requirement'))
    if (!byCat.has(category)) { byCat.set(category, []); catOrder.push(category) }
    byCat.get(category).push({ sub, interval, symptoms, requirement, vehicleCodes })
  }

  const intervals = INTERVAL_ORDER.filter((i) => intervalsSeen.has(i))
    .concat([...intervalsSeen].filter((i) => !INTERVAL_ORDER.includes(i)))
  // Only expose vehicle filtering when the sheet actually scoped some items.
  const usesVehicleTypes = vehicleTypesSeen.size > 0
  const vehicleTypes = VEHICLE_TYPES.filter((v) => vehicleTypesSeen.has(v.code))

  // ── Assemble fields ──
  const fields = []
  const push = (preset) => { const f = { ...newField(preset.type || 'text'), ...preset, id: newFieldId() }; fields.push(f); return f }

  // Header block — locked auto fields + asset context per the rules.
  push({ type: 'user', label: 'Inspector', required: true, autoValue: 'current_user' })
  push({ type: 'date', label: 'Date', required: true, autoValue: 'today' })
  push({ type: 'asset', label: 'Asset / Vehicle', required: true })
  push({ type: 'site', label: 'Site' })
  push({ type: 'number', label: 'KM meter (km)', min: 0 })
  push({ type: 'number', label: 'Hour meter (hrs)', min: 0 })

  // The interval selector that drives which points appear.
  const intervalField = push({
    type: 'select',
    label: 'Inspection interval',
    required: true,
    options: intervals.length ? intervals : ['Monthly', 'Quarterly', 'Semi-annual', 'Annual'],
    help: 'Pick the interval — only the checks due for it are shown.',
  })

  // The vehicle-type selector (only when the sheet scopes items by vehicle).
  let vehicleField = null
  if (usesVehicleTypes) {
    vehicleField = push({
      type: 'select',
      label: 'Vehicle type',
      required: true,
      options: vehicleTypes.map((v) => v.label),
      help: 'Pick the vehicle type — points specific to other vehicles stay hidden.',
    })
  }
  const labelForCode = (code) => (VEHICLE_TYPES.find((v) => v.code === code)?.label || code)

  let itemCount = 0
  let scopedCount = 0
  for (const category of catOrder) {
    const items = byCat.get(category) || []
    push({ type: 'section', label: category })
    for (const it of items) {
      const helpBits = []
      if (it.symptoms) helpBits.push(`Check: ${it.symptoms}`)
      if (it.requirement) helpBits.push(it.requirement)
      if (it.interval) helpBits.push(`Interval: ${it.interval}`)
      if (it.vehicleCodes.length) helpBits.push(`Vehicles: ${it.vehicleCodes.join(', ')}`)

      // Compose the visibility rule: interval AND (vehicle type is one of …).
      // A single clause stays an object; multiple clauses become an ANDed array.
      const clauses = []
      if (it.interval) clauses.push({ field: intervalField.id, op: '=', value: it.interval })
      if (vehicleField && it.vehicleCodes.length) {
        clauses.push({ field: vehicleField.id, op: 'in', value: it.vehicleCodes.map(labelForCode) })
        scopedCount++
      }
      const visibleWhen = clauses.length === 0 ? null : clauses.length === 1 ? clauses[0] : clauses

      push({
        type: 'select',
        label: it.sub,
        options: ['OK', 'Needs attention', 'Defect', 'N/A'],
        allow_photo: true,
        help: helpBits.join(' · '),
        visibleWhen,
      })
      itemCount++
    }
  }

  const template = {
    name: opts.name || 'Predictive Maintenance Checklist',
    description: opts.description || 'Imported from spreadsheet. Select an interval to see the checks due.',
    category: 'Maintenance',
    status: 'draft',
    require_signature: true,
    require_approval: true,
    scored: false,
    pass_threshold: null,
    fields,
  }
  return {
    template,
    stats: {
      items: itemCount,
      categories: catOrder.length,
      intervals,
      vehicleTypes: vehicleTypes.map((v) => v.code),
      vehicleScopedItems: scopedCount,
    },
  }
}

export default { buildTemplateFromRows, detectColumns, detectVehicleColumns, normalizeInterval, normalizeVehicleCode }
