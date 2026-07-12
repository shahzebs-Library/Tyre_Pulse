/**
 * importChecklist — turn a maintenance/inspection spreadsheet into a checklist
 * template. Pure (no I/O). Designed around the "Predictive Maintenance" layout
 * (Category · Sub Category · Date Interval · Symptoms · Requirement) but tolerant
 * of column-name variations. Produces a template whose items are grouped into
 * category sections and conditionally shown by a single "Inspection interval"
 * selector, so picking Monthly/Quarterly/… reveals only the matching points.
 */
import { newField, newFieldId } from './fieldTypes'

const HEADER_ALIASES = {
  category: ['category', 'system', 'group'],
  subcategory: ['sub category', 'subcategory', 'sub-category', 'item', 'component', 'part'],
  interval: ['date interval', 'interval', 'frequency', 'schedule'],
  symptoms: ['symptoms', 'symptom', 'check', 'checkpoint', 'check point', 'observation'],
  requirement: ['requirement', 'requirements', 'spare', 'action', 'remarks', 'notes'],
}

const INTERVAL_ORDER = ['Daily', 'Weekly', 'Monthly', 'Quarterly', 'Semi-annual', 'Annual', '2-Yearly', '4-Yearly']

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
 * Locate the header row + column indexes in a matrix of rows (array of arrays).
 * Returns { headerRow, cols:{category,subcategory,interval,symptoms,requirement} }
 * or null when no recognisable header is found in the first ~10 rows.
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
    if (cols.subcategory != null && cols.category != null) return { headerRow: r, cols }
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
    return { template: null, stats: { items: 0, categories: 0, intervals: [], error: 'No Category / Sub Category columns found.' } }
  }
  const { headerRow, cols } = detected
  const body = matrix.slice(headerRow + 1)

  const at = (row, key) => (cols[key] != null ? row[cols[key]] : undefined)
  const clean = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim()

  // Group items by category, preserving first-seen order.
  const catOrder = []
  const byCat = new Map()
  const intervalsSeen = new Set()

  for (const row of body) {
    const sub = clean(at(row, 'subcategory'))
    if (!sub) continue
    const category = clean(at(row, 'category')) || 'General'
    const interval = normalizeInterval(at(row, 'interval'))
    if (interval) intervalsSeen.add(interval)
    const symptoms = clean(at(row, 'symptoms'))
    const requirement = clean(at(row, 'requirement'))
    if (!byCat.has(category)) { byCat.set(category, []); catOrder.push(category) }
    byCat.get(category).push({ sub, interval, symptoms, requirement })
  }

  const intervals = INTERVAL_ORDER.filter((i) => intervalsSeen.has(i))
    .concat([...intervalsSeen].filter((i) => !INTERVAL_ORDER.includes(i)))

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

  let itemCount = 0
  for (const category of catOrder) {
    const items = byCat.get(category) || []
    push({ type: 'section', label: category })
    for (const it of items) {
      const helpBits = []
      if (it.symptoms) helpBits.push(`Check: ${it.symptoms}`)
      if (it.requirement) helpBits.push(it.requirement)
      if (it.interval) helpBits.push(`Interval: ${it.interval}`)
      push({
        type: 'select',
        label: it.sub,
        options: ['OK', 'Needs attention', 'Defect', 'N/A'],
        allow_photo: true,
        help: helpBits.join(' · '),
        // Show this point only when its interval is selected (rule 1 & 12).
        visibleWhen: it.interval ? { field: intervalField.id, op: '=', value: it.interval } : null,
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
  return { template, stats: { items: itemCount, categories: catOrder.length, intervals } }
}

export default { buildTemplateFromRows, detectColumns, normalizeInterval }
