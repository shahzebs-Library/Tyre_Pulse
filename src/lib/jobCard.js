/**
 * jobCard.js - THE single source of truth for the workshop job card: which
 * fields a job card carries, where each one lives on `work_orders`, and the
 * availability flow a card moves through.
 *
 * WHY THIS EXISTS. The ERP job-card export carries 34 data columns (V381/V385/
 * V386 load them into `work_orders`). The Work Orders page form only ever
 * exposed 16 of them, so two thirds of every uploaded job card was in the
 * database and un-editable - most of it parked in `custom_data` jsonb where it
 * cannot be filtered, sorted or corrected. JOB_CARD_FIELDS below is the mapping,
 * measured against the live table, so the form, the detail read-out, the export
 * and the table columns all describe the SAME card instead of drifting.
 *
 * Pure + deterministic: no I/O, no implicit Date usage (every function that
 * needs "now" takes it explicitly), so it is testable and safe in a render.
 *
 * MIRROR RULE: `header` is the VERBATIM export column name that
 * `process_stg_job_cards` (V386 `_stg_pick`) reads. If that trigger mapping
 * changes, change it here in the same commit or the form will edit a different
 * field from the one the importer fills.
 */

import { WO_STATUSES, normalizeWoStatus, isClosedWoStatus } from './workOrderStatus'

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * Work types in use, measured live over 90,535 job cards:
 * Repair 73,560 / Other 9,756 / Emergency 5,846 / Preventive Maintenance 1,034
 * / Service 338 / Tyre Change 1. `work_orders.work_type` has a CHECK (V253), so
 * this list must stay a SUBSET of it - do not add a value without widening the
 * constraint first, or the save fails with a raw 23514.
 */
export const JOB_CARD_WORK_TYPES = Object.freeze([
  'Repair',
  'Emergency',
  'Preventive Maintenance',
  'Service',
  'Tyre Change',
  'Other',
])

/** Priorities the page already writes. */
export const JOB_CARD_PRIORITIES = Object.freeze(['Low', 'Medium', 'High', 'Critical'])

/**
 * Scope = who did the work. The export writes free text, so these are offered
 * as suggestions and a typed value is still accepted (freeSolo on the field).
 */
export const JOB_CARD_SCOPES = Object.freeze(['Internal', 'External', 'Warranty', 'Contract'])

/** Head / Tail marks which half of an articulated unit the card is against. */
export const JOB_CARD_HEAD_TAIL = Object.freeze(['Head', 'Tail'])

// ---------------------------------------------------------------------------
// Field catalog
// ---------------------------------------------------------------------------

/**
 * Section order drives the form layout and the detail read-out. Grouped by the
 * QUESTION each block answers, not by the export column order, because the
 * export interleaves identity, timing and money.
 */
export const JOB_CARD_SECTIONS = Object.freeze([
  { key: 'identity', label: 'Job Card Identity', hint: 'The reference numbers this card is known by.' },
  { key: 'asset', label: 'Asset', hint: 'Which machine the card is against.' },
  { key: 'classification', label: 'Classification and Location', hint: 'What kind of job, where, and how urgent.' },
  { key: 'complaint', label: 'Complaint and Work Done', hint: 'What production reported and what the workshop did.' },
  { key: 'flow', label: 'Availability Flow', hint: 'Out of production, into the workshop, and back. Downtime is measured from these.' },
  { key: 'hours', label: 'Hours', hint: 'How long, and where the waiting went.' },
  { key: 'cost', label: 'Cost', hint: 'In-app costing. ERP-reported figures are shown separately and never overwritten.' },
  { key: 'people', label: 'People and Audit', hint: 'Who raised it, who carded it, who worked it.' },
])

/**
 * Every field a job card carries.
 *
 * key        - the `work_orders` column, or a `custom_data` key when jsonbPath is set
 * header     - the VERBATIM ERP export column, or null when the field is app-only
 * type       - text | textarea | number | hours | money | datetime | select
 * section    - a JOB_CARD_SECTIONS key
 * editable   - false for anything derived or provenance-only
 * computed   - true when the DATABASE derives it. NEVER send a computed field in
 *              an insert/update payload: `total_cost` is a GENERATED column and
 *              Postgres rejects a write to it.
 * jsonbPath  - where the value ALSO lives inside `custom_data`. Used as a READ
 *              fallback: the five fields V605 promoted to typed columns keep it
 *              so a row written before that migration still reads correctly.
 * jsonbOnly  - the value lives ONLY in custom_data and there is no typed column
 *              to write to. These can never enter an insert/update payload.
 * coverage   - rows populated out of 90,535, measured live 2026-08-24. A field at
 *              0 is not proof the export lacks it: "Job Card Created By/Date" are
 *              known to have failed import on invisible NBSP whitespace (V386).
 */
export const JOB_CARD_FIELDS = Object.freeze([
  // --- identity -----------------------------------------------------------
  { key: 'work_order_no', header: 'Job Card No', label: 'Job Card No', type: 'text', section: 'identity', editable: true, required: true, coverage: 90535,
    hint: 'Unique across the whole system. Left blank on a new card the app generates one.' },
  { key: 'rfr_no', header: 'RFR Number', label: 'RFR Number', type: 'text', section: 'identity', editable: true, coverage: 57192 },
  { key: 'mr_no', header: 'MR NO', label: 'MR No', jsonbPath: 'mr_no', type: 'text', section: 'identity', editable: true, coverage: 0,
    hint: 'Material request the card draws parts against.' },
  { key: 'sco_no', header: 'SCO NO', label: 'SCO No', jsonbPath: 'sco_no', type: 'text', section: 'identity', editable: true, coverage: 0,
    hint: 'Sub-contract order when the work is bought out.' },
  { key: 'source_row', header: '#', label: 'Import line', type: 'text', section: 'identity', editable: false, coverage: null,
    hint: 'The line number in the uploaded file. Provenance only.' },

  // --- asset --------------------------------------------------------------
  { key: 'asset_no', header: 'Asset Code', label: 'Asset Code', type: 'text', section: 'asset', editable: true, required: true, coverage: 90535,
    hint: 'Picking an asset auto-fills plate, category, description and site from the fleet register.' },
  { key: 'asset_description', header: 'Asset Description', label: 'Asset Description', jsonbPath: 'asset_description', type: 'text', section: 'asset', editable: true, coverage: 30239 },
  { key: 'plate_no', header: 'Plate No', label: 'Plate No', type: 'text', section: 'asset', editable: true, coverage: 25023 },
  { key: 'asset_category', header: 'Asset Category', label: 'Asset Category', type: 'text', section: 'asset', editable: true, coverage: 57192 },
  { key: 'truck_category', header: 'Truck Category', label: 'Truck Category', jsonbPath: 'truck_category', type: 'text', section: 'asset', editable: true, coverage: 0 },
  { key: 'head_tail', header: 'Head/Tail', label: 'Head / Tail', jsonbPath: 'head_tail', type: 'select', options: JOB_CARD_HEAD_TAIL, freeSolo: true, section: 'asset', editable: true, coverage: 0,
    hint: 'Which half of an articulated unit the job is against.' },
  { key: 'odometer', header: null, label: 'Odometer / Hour meter', type: 'number', section: 'asset', editable: true, coverage: null },

  // --- classification -----------------------------------------------------
  { key: 'status', header: 'Status', label: 'Status', type: 'select', options: WO_STATUSES, section: 'classification', editable: true, required: true, coverage: 90535 },
  { key: 'work_type', header: 'Type', label: 'Job Type', type: 'select', options: JOB_CARD_WORK_TYPES, section: 'classification', editable: true, required: true, coverage: 90535,
    hint: 'The ERP wording is preserved in the import payload; this is the canonical bucket.' },
  { key: 'priority', header: null, label: 'Priority', type: 'select', options: JOB_CARD_PRIORITIES, section: 'classification', editable: true, required: true, coverage: 90535 },
  { key: 'scope', header: 'Scope', label: 'Scope', type: 'select', options: JOB_CARD_SCOPES, freeSolo: true, section: 'classification', editable: true, coverage: 57192 },
  { key: 'site', header: 'Location', label: 'Location (Site)', type: 'text', section: 'classification', editable: true, coverage: 90535,
    hint: 'Where the asset belongs. Normalised to the site register on save.' },
  { key: 'work_location', header: 'Work Location', label: 'Work Location', type: 'text', section: 'classification', editable: true, coverage: 57192,
    hint: 'Where the work actually happened. Measured live it agrees with Location on only 31 percent of cards, so they are genuinely different facts.' },
  { key: 'country', header: null, label: 'Country', type: 'text', section: 'classification', editable: true, coverage: 90535 },

  // --- complaint / work ---------------------------------------------------
  { key: 'description', header: 'Production Complaint', label: 'Production Complaint', type: 'textarea', section: 'complaint', editable: true, coverage: null,
    hint: 'What the operator or production reported. The reason the card exists.' },
  { key: 'notes', header: 'Job Repair Description', label: 'Job Repair Description', type: 'textarea', section: 'complaint', editable: true, coverage: 88295,
    hint: 'What the workshop actually did.' },

  // --- flow ---------------------------------------------------------------
  { key: 'opened_at', header: null, label: 'Card Opened', type: 'datetime', section: 'flow', editable: true, required: true, coverage: 90535 },
  { key: 'target_completion', header: 'Excepted Job Date/Time', label: 'Expected Job Date/Time', type: 'datetime', section: 'flow', editable: true, coverage: 44329,
    hint: 'The promised date. A card past this and still open is Overdue.' },
  { key: 'production_out_at', header: 'Production Out', label: 'Production Out', type: 'datetime', section: 'flow', editable: true, coverage: 57192,
    hint: 'The asset stopped earning from here. Downtime starts.' },
  { key: 'started_at', header: 'Workshop In', label: 'Workshop In', type: 'datetime', section: 'flow', editable: true, coverage: 57191,
    hint: 'Work started. The gap before this is a scheduling problem, not a workshop one.' },
  { key: 'completed_at', header: 'Workshop Out', label: 'Workshop Out', type: 'datetime', section: 'flow', editable: true, coverage: 90284 },
  { key: 'production_in_at', header: 'Production In', label: 'Production In', type: 'datetime', section: 'flow', editable: true, coverage: 56402,
    hint: 'The asset is earning again. Downtime ends here.' },

  // --- hours --------------------------------------------------------------
  { key: 'breakdown_hours', header: 'Total Breakdown hours', label: 'Total Breakdown Hours', type: 'hours', section: 'hours', editable: true, coverage: 57103,
    hint: 'Only meaningful once the card closed. On an OPEN card the ERP counts to today, which is why the importer withholds it until Workshop Out or Production In exists.' },
  { key: 'standard_hours', header: 'STD. Hours', label: 'Standard Hours', type: 'hours', section: 'hours', editable: true, coverage: 37488 },
  { key: 'waiting_parts_hours', header: 'Waiting Part Hrs', label: 'Waiting for Parts (hrs)', type: 'hours', section: 'hours', editable: true, coverage: 1442,
    hint: 'A procurement signal.' },
  { key: 'waiting_manpower_hours', header: 'Waiting Manpower Hrs', label: 'Waiting for Manpower (hrs)', type: 'hours', section: 'hours', editable: true, coverage: 1228,
    hint: 'A scheduling signal.' },
  { key: 'manpower_hours', header: 'Manpower H', label: 'Manpower Hours', type: 'hours', section: 'hours', editable: true, coverage: 0 },
  { key: 'labour_hours', header: null, label: 'Labour Hours (in-app)', type: 'hours', section: 'hours', editable: true, coverage: null },

  // --- cost ---------------------------------------------------------------
  // The four ERP cost columns (Spare Parts / Tyre / Oil / Others) are NOT mapped
  // to these editable fields. They stay in custom_data.erp_reported_cost and are
  // shown read-only: the expense grid is the authoritative cost source, and
  // writing the ERP figures here would create a second competing one.
  { key: 'labour_rate', header: null, label: 'Labour Rate', type: 'money', section: 'cost', editable: true, coverage: null },
  { key: 'labour_cost', header: null, label: 'Labour Cost', type: 'money', section: 'cost', editable: true, coverage: null,
    hint: 'Derived from hours x rate unless overridden.' },
  { key: 'parts_cost', header: null, label: 'Parts Cost (in-app)', type: 'money', section: 'cost', editable: false, coverage: null,
    hint: 'Sum of the parts lines.' },
  { key: 'tyre_cost', header: null, label: 'Tyre Cost', type: 'money', section: 'cost', editable: true, coverage: null },
  { key: 'lubricant_cost', header: null, label: 'Lubricant Cost', type: 'money', section: 'cost', editable: true, coverage: null },
  { key: 'outside_repair_cost', header: null, label: 'Outside Repair Cost', type: 'money', section: 'cost', editable: true, coverage: null },
  { key: 'total_cost', header: 'Total Repair Cost', label: 'Total Cost', type: 'money', section: 'cost', editable: false, computed: true, coverage: null,
    hint: 'A GENERATED column (labour + parts). Never sent in a payload.' },

  // --- people / audit -----------------------------------------------------
  { key: 'technician_name', header: null, label: 'Technician', type: 'text', section: 'people', editable: true, coverage: null },
  { key: 'workshop_name', header: null, label: 'Workshop', type: 'text', section: 'people', editable: true, coverage: null },
  { key: 'raised_by', header: 'RFR Created By', label: 'RFR Raised By', type: 'text', section: 'people', editable: false, jsonbPath: 'raised_by', jsonbOnly: true, coverage: 57192 },
  { key: 'raised_at', header: 'RFR Created Date', label: 'RFR Raised On', type: 'text', section: 'people', editable: false, jsonbPath: 'raised_at', jsonbOnly: true, coverage: 57192,
    hint: 'Kept as the ERP wrote it. Not re-parsed, so it is never silently mis-dated.' },
  { key: 'card_by', header: 'Job Card Created By', label: 'Job Card Created By', type: 'text', section: 'people', editable: false, jsonbPath: 'card_by', jsonbOnly: true, coverage: 0 },
  { key: 'card_at', header: 'Job Card Created Date', label: 'Job Card Created On', type: 'text', section: 'people', editable: false, jsonbPath: 'card_at', jsonbOnly: true, coverage: 0 },
])

/** How many ERP export columns this catalog maps. */
export const JOB_CARD_EXPORT_COLUMN_COUNT = JOB_CARD_FIELDS.filter(f => f.header).length

const FIELD_BY_KEY = Object.freeze(
  JOB_CARD_FIELDS.reduce((acc, f) => { acc[f.key] = f; return acc }, {}),
)

/** Look up one field descriptor by key. */
export function jobCardField(key) {
  return FIELD_BY_KEY[key] || null
}

/** The fields belonging to one section, in catalog order. */
export function fieldsForSection(sectionKey) {
  return JOB_CARD_FIELDS.filter(f => f.section === sectionKey)
}

/** Every editable, non-computed field: exactly what a form may write. */
export function editableFields() {
  return JOB_CARD_FIELDS.filter(f => f.editable && !f.computed)
}

/**
 * The typed `work_orders` columns a payload may carry. Excludes computed columns
 * and anything still living in custom_data (those are provenance, not input).
 */
export function payloadColumns() {
  return editableFields().filter(f => !f.jsonbOnly).map(f => f.key)
}

// ---------------------------------------------------------------------------
// Reading a row
// ---------------------------------------------------------------------------

/**
 * Read a field off a work_orders row, following the custom_data path when the
 * value has not been promoted to a typed column yet. Returns null (never
 * undefined, never '') for an absent value so callers can render "not recorded"
 * rather than an empty cell that reads like a zero.
 */
export function readField(row, key) {
  if (!row) return null
  const f = FIELD_BY_KEY[key]
  if (!f) return null
  // A promoted typed column always wins; custom_data is the fallback so a row
  // loaded before the promotion migration still reads correctly.
  const direct = row[key]
  if (direct !== undefined && direct !== null && direct !== '') return direct
  if (f.jsonbPath) {
    const cd = row.custom_data
    if (cd && typeof cd === 'object') {
      const v = cd[f.jsonbPath]
      if (v !== undefined && v !== null && v !== '') return v
    }
  }
  return null
}

/**
 * The ERP OWN reported cost block, read-only. Deliberately separate from the
 * app costing: these are what the ERP said, the expense grid is what is true,
 * and the two must never be added together.
 */
export function erpReportedCost(row) {
  const c = row && row.custom_data ? row.custom_data.erp_reported_cost : null
  if (!c || typeof c !== 'object') return null
  const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
  const out = {
    spareParts: num(c.spare_parts),
    tyre: num(c.tyre),
    oil: num(c.oil),
    others: num(c.others),
    manpower: num(c.manpower),
    totalParts: num(c.total_parts),
    totalRepair: num(c.total_repair),
  }
  return Object.values(out).some(v => v !== null) ? out : null
}

/** The job card repair task lines as the ERP recorded them, if any. */
export function erpLineItems(row) {
  const items = row && row.custom_data ? row.custom_data.line_items : null
  return Array.isArray(items) ? items : []
}

// ---------------------------------------------------------------------------
// The availability flow
// ---------------------------------------------------------------------------

/**
 * The stages a job card moves through. This is the ERP own availability cycle
 * and it is the reason the four timestamps were imported at all: a single
 * "downtime" number cannot tell a scheduling problem from a workshop one.
 *
 * `field` is the timestamp that PROVES the stage was reached. A stage with no
 * timestamp has not happened, and is never inferred from a later one.
 */
export const JOB_CARD_STAGES = Object.freeze([
  { key: 'rfr_raised', label: 'RFR Raised', field: 'raised_at', tone: 'quiet',
    hint: 'Production asked for the work.' },
  { key: 'card_created', label: 'Job Card Created', field: 'card_at', tone: 'quiet',
    hint: 'The workshop accepted it onto a card.' },
  { key: 'production_out', label: 'Out of Production', field: 'production_out_at', tone: 'warning',
    hint: 'The asset stopped earning. Downtime starts here.' },
  { key: 'workshop_in', label: 'In Workshop', field: 'started_at', tone: 'info',
    hint: 'Work started.' },
  { key: 'workshop_out', label: 'Workshop Complete', field: 'completed_at', tone: 'good',
    hint: 'Work finished.' },
  { key: 'production_in', label: 'Back in Production', field: 'production_in_at', tone: 'good',
    hint: 'The asset is earning again. Downtime ends here.' },
])

/** Parse a value to epoch ms, or null. Accepts ISO strings and Date objects. */
function ts(v) {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  const n = d.getTime()
  return Number.isFinite(n) ? n : null
}

/**
 * The furthest stage this card has evidence for, plus whether it is closed.
 * Returns { key, index, label, closed, reached }.
 * A card with no timestamps at all sits at index -1, which renders as "not
 * started" rather than being pushed onto a stage it cannot prove.
 */
export function jobCardStage(row) {
  const reached = []
  let index = -1
  JOB_CARD_STAGES.forEach((s, i) => {
    if (ts(readField(row, s.field)) !== null) { reached.push(s.key); index = i }
  })
  const closed = isClosedWoStatus(normalizeWoStatus(row && row.status))
  const stage = index >= 0 ? JOB_CARD_STAGES[index] : null
  return {
    key: stage ? stage.key : null,
    index,
    label: stage ? stage.label : 'Not started',
    closed,
    reached,
  }
}

/** Stage timestamps that run out of order: a data-quality flag, never a fix. */
export function stageChronologyIssues(row) {
  const issues = []
  const pairs = [
    ['production_out_at', 'started_at', 'Workshop In is before Production Out'],
    ['started_at', 'completed_at', 'Workshop Out is before Workshop In'],
    ['completed_at', 'production_in_at', 'Production In is before Workshop Out'],
  ]
  for (const [a, b, message] of pairs) {
    const x = ts(readField(row, a))
    const y = ts(readField(row, b))
    if (x !== null && y !== null && y < x) issues.push({ from: a, to: b, message })
  }
  return issues
}

const HOUR_MS = 3600000

/**
 * The three gaps that make up downtime, in hours.
 *
 * Each is null when its START timestamp is missing - an unmeasurable gap is not
 * a zero-hour gap, and reporting 0 would flatter every average. When the END
 * timestamp is missing and the card is still OPEN the gap is measured to `now`
 * and flagged `running`, because an asset that went out three weeks ago and was
 * never booked in is exactly what this panel exists to surface.
 *
 * @param {object} row work_orders row
 * @param {number|Date|string} now explicit clock, so the function stays deterministic
 */
export function jobCardDurations(row, now) {
  const nowMs = ts(now)
  const closed = isClosedWoStatus(normalizeWoStatus(row && row.status))

  const gap = (startKey, endKey) => {
    const start = ts(readField(row, startKey))
    if (start === null) return null
    const end = ts(readField(row, endKey))
    if (end !== null) {
      const h = (end - start) / HOUR_MS
      // A reversed pair is a data error, not a negative duration.
      return { hours: h < 0 ? null : h, running: false, reversed: h < 0 }
    }
    if (closed || nowMs === null) return null
    const h = (nowMs - start) / HOUR_MS
    return { hours: h < 0 ? null : h, running: true, reversed: false }
  }

  return {
    // Asset is down and nobody has started: a SCHEDULING gap.
    awaitingWorkshop: gap('production_out_at', 'started_at'),
    // Work in progress: the WORKSHOP own time.
    inWorkshop: gap('started_at', 'completed_at'),
    // Repaired but not handed back: a RELEASE gap.
    awaitingRelease: gap('completed_at', 'production_in_at'),
    // The whole availability loss.
    totalDown: gap('production_out_at', 'production_in_at'),
  }
}

/**
 * Split the waiting time by CAUSE. This is the question the four timestamps
 * cannot answer on their own: they give the LENGTH of a wait, the two waiting
 * columns give the REASON.
 *
 * `unexplained` is the part of the pre-start gap that neither waiting column
 * accounts for. It is null when the gap is unmeasurable, and floored at 0 so a
 * card whose waiting columns exceed the gap reads as fully accounted rather than
 * negative.
 */
export function waitingSplit(row, now) {
  const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
  const parts = num(readField(row, 'waiting_parts_hours'))
  const manpower = num(readField(row, 'waiting_manpower_hours'))
  const d = jobCardDurations(row, now)
  const gapHours = d.awaitingWorkshop && d.awaitingWorkshop.hours !== null ? d.awaitingWorkshop.hours : null
  const accounted = (parts === null ? 0 : parts) + (manpower === null ? 0 : manpower)
  return {
    parts,
    manpower,
    gapHours,
    accounted: parts === null && manpower === null ? null : accounted,
    unexplained: gapHours === null ? null : Math.max(0, gapHours - accounted),
    // Nothing was recorded either way: say so instead of showing three zeros.
    recorded: parts !== null || manpower !== null,
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a form payload. Returns { ok, errors, warnings }.
 *
 * Errors block the save. Warnings never do: a job card is often filled in over
 * days and a half-complete flow is the NORMAL state, so an out-of-order pair or
 * a missing timestamp is surfaced and left to the user.
 */
export function validateJobCard(values) {
  const v = values || {}
  const errors = {}
  const warnings = []

  for (const f of JOB_CARD_FIELDS) {
    if (!f.required) continue
    // work_order_no is generated by the app on a new card, so it is required on
    // the ROW, not on the form. Everything else must be typed.
    if (f.key === 'work_order_no') continue
    const raw = v[f.key]
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      errors[f.key] = f.label + ' is required'
    }
  }

  for (const issue of stageChronologyIssues(v)) warnings.push(issue.message)

  const closed = isClosedWoStatus(normalizeWoStatus(v.status))
  if (closed && !v.completed_at) {
    warnings.push('The card is closed but Workshop Out is empty, so repair time cannot be measured.')
  }
  if (closed && v.production_out_at && !v.production_in_at) {
    warnings.push('The card is closed but Production In is empty, so downtime is still open-ended.')
  }

  return { ok: Object.keys(errors).length === 0, errors, warnings }
}

/**
 * Build the insert/update payload from form values: only editable, non-computed,
 * typed columns, with blanks normalised to null and numbers coerced.
 *
 * `total_cost` can never appear here (it is GENERATED and Postgres rejects a
 * write to it) and neither can a custom_data-only field.
 */
export function toPayload(values) {
  const v = values || {}
  const out = {}
  for (const f of editableFields()) {
    if (f.jsonbOnly) continue
    const raw = v[f.key]
    if (raw === undefined) continue
    if (raw === null || String(raw).trim() === '') { out[f.key] = null; continue }
    if (f.type === 'number' || f.type === 'hours' || f.type === 'money') {
      const n = Number(raw)
      out[f.key] = Number.isFinite(n) ? n : null
    } else if (f.type === 'datetime') {
      const d = new Date(raw)
      out[f.key] = Number.isFinite(d.getTime()) ? d.toISOString() : null
    } else if (f.key === 'status') {
      out[f.key] = normalizeWoStatus(raw)
    } else {
      out[f.key] = String(raw).trim()
    }
  }
  return out
}

/** How many catalog fields a row actually carries: the completeness read. */
export function jobCardCompleteness(row) {
  const fields = JOB_CARD_FIELDS.filter(f => !f.computed)
  const missing = fields.filter(f => readField(row, f.key) === null).map(f => f.key)
  const filled = fields.length - missing.length
  return {
    filled,
    total: fields.length,
    pct: fields.length ? Math.round((filled / fields.length) * 100) : null,
    missing,
  }
}
