/**
 * Workshop Status vehicle history engine (Loop 9, spec section 14).
 *
 * Pure: turns the append-only rows of public.workshop_status_events for ONE
 * record into a readable timeline. No I/O, no clock.
 *
 * How the events are written (migrations 20261007090000 / 110000 / 120000):
 *   - Every change to a tracked column of a record writes one `field_change`
 *     row (field_name, old_value, new_value) from the record audit trigger.
 *   - A manual save (workshop_status_update_record) adds ONE `manual_update`
 *     summary row beside its field changes.
 *   - An upload confirm adds `added` / `excel_updated` / `removed` rows beside
 *     the field changes it causes, all carrying the upload_id.
 *   - actor_id, actor_name and created_at are forced by the event stamp
 *     trigger. created_at is now(), i.e. the TRANSACTION time, so every row
 *     written by one action shares one created_at. That is the grouping key.
 *
 * One action = one entry: rows with the same created_at, actor, source and
 * upload are folded together, the summary row supplies the kind of action
 * and the field changes supply the old -> new lines.
 */
import { FIELD_LABELS as EXCEL_FIELD_LABELS } from './compareUpload.js'

/** Filter chip order. 'other' collects rows nothing else claims (rare). */
export const HISTORY_CATEGORIES = Object.freeze([
  'import', 'manual', 'assignment', 'eta', 'attachment', 'removal', 'restore', 'disposition', 'deletion', 'other',
])

export const CATEGORY_LABELS = Object.freeze({
  import: 'Excel import',
  manual: 'Manual update',
  assignment: 'Assignment',
  eta: 'ETA change',
  attachment: 'Attachment',
  removal: 'Removal / release',
  restore: 'Restore',
  disposition: 'Final disposition',
  deletion: 'Deletion',
  other: 'Other',
})

export const SOURCE_LABELS = Object.freeze({ excel: 'Excel upload', manual: 'Manual', system: 'System' })

export const PERSON_FIELDS = Object.freeze(['responsible_user_id', 'supporting_user_id'])
export const ETA_FIELDS = Object.freeze(['expected_part_date', 'expected_release_date'])
const DATE_FIELDS = new Set(['ooc_since', 'expected_part_date', 'expected_release_date'])
const TIMESTAMP_FIELDS = new Set(['archived_at', 'deleted_at'])
const BOOLEAN_FIELDS = new Set(['current_active'])

/** English labels for every tracked field (the record audit trigger list). */
export const HISTORY_FIELD_LABELS = Object.freeze({
  ...EXCEL_FIELD_LABELS,
  vehicle_id: 'Linked vehicle',
  asset_breakdown_id: 'Linked breakdown',
  current_stage: 'Current stage',
  delay_reason: 'Delay reason',
  detailed_reason: 'Detailed reason',
  work_done: 'Work done',
  action_taken: 'Action taken',
  next_action: 'Next action',
  parts_status: 'Parts status',
  mr_number: 'MR number',
  po_number: 'PO number',
  responsible_user_id: 'Responsible person',
  supporting_user_id: 'Supporting person',
  expected_part_date: 'Expected part date',
  expected_release_date: 'Expected release date',
  blocker: 'Blocker',
  remarks: 'Remarks (workshop)',
  current_active: 'On current report',
  daily_report_status: 'Report status',
  final_disposition: 'Final disposition',
  final_disposition_remarks: 'Disposition remarks',
  archived_at: 'Archived',
  deleted_at: 'Deleted',
})

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '')

export function fieldLabel(field) {
  return HISTORY_FIELD_LABELS[field] || String(field || '')
}

export function sourceLabel(source) {
  return SOURCE_LABELS[source] || SOURCE_LABELS.system
}

function pad(n) { return String(n).padStart(2, '0') }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 'YYYY-MM-DD' -> '20 Oct 2026' without a timezone shift; anything else unchanged. */
export function formatDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''))
  if (!m) return String(value ?? '')
  const mi = Number(m[2]) - 1
  if (mi < 0 || mi > 11) return String(value)
  return `${pad(Number(m[3]))} ${MONTHS[mi]} ${m[1]}`
}

/** ISO timestamp -> '20 Oct 2026 14:05' in local time; unparseable stays as given. */
export function formatStamp(value) {
  if (blank(value)) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * A stored history value as a person reads it.
 * opts.userNames: { [uuid]: name }; opts.labels: { blank, yes, no, unknownPerson }.
 */
export function formatValue(field, value, opts = {}) {
  const labels = { blank: '(blank)', yes: 'Yes', no: 'No', unknownPerson: 'Unknown person', ...(opts.labels || {}) }
  if (blank(value)) return labels.blank
  const v = String(value)
  if (PERSON_FIELDS.includes(field)) {
    const names = opts.userNames || {}
    return names[v] || labels.unknownPerson
  }
  if (BOOLEAN_FIELDS.has(field)) {
    if (v === 'true') return labels.yes
    if (v === 'false') return labels.no
    return v
  }
  if (DATE_FIELDS.has(field)) return formatDay(v)
  if (TIMESTAMP_FIELDS.has(field)) return formatStamp(v)
  return v
}

/** Person ids named in field changes (old or new), for one name lookup. */
export function collectPersonIds(events) {
  const out = new Set()
  for (const e of events || []) {
    if (e?.event_type !== 'field_change' || !PERSON_FIELDS.includes(e.field_name)) continue
    for (const v of [e.old_value, e.new_value]) if (!blank(v) && UUID_RE.test(String(v))) out.add(String(v))
  }
  return [...out]
}

// The exact stored timestamp as text. PostgREST sends the ISO string with
// microseconds (kept as is); a Date (a direct driver read) becomes ISO.
const stampKey = (v) => (v instanceof Date ? v.toISOString() : String(v ?? ''))
const groupKey = (e) => [stampKey(e.created_at), e.actor_id || '', e.source || 'system', e.upload_id || ''].join('|')

/** Newest first; id breaks ties so the order is stable between reads. */
function sortEvents(events) {
  return [...events].sort((a, b) => {
    const ta = Date.parse(a.created_at) || 0
    const tb = Date.parse(b.created_at) || 0
    if (ta !== tb) return tb - ta
    const sa = stampKey(a.created_at)
    const sb = stampKey(b.created_at)
    if (sa !== sb) return sa < sb ? 1 : -1
    return String(a.id || '') < String(b.id || '') ? 1 : -1
  })
}

const fieldChangedTo = (changes, field, to) => changes.some((c) => c.field === field && String(c.newValue) === to)

/**
 * Categories of one entry, primary first. A manual save that names a person
 * is BOTH a manual update and an assignment, so filtering by either finds it.
 */
export function classifyEntry(entry) {
  const types = new Set(entry.eventTypes)
  const fields = new Set(entry.changes.map((c) => c.field))
  const cats = []
  const add = (c) => { if (!cats.includes(c)) cats.push(c) }

  if (types.has('permanently_deleted') || types.has('soft_deleted') || types.has('undeleted') || fields.has('deleted_at')) add('deletion')
  const archivedSet = entry.changes.some((c) => c.field === 'archived_at' && !blank(c.newValue))
  const archivedCleared = entry.changes.some((c) => c.field === 'archived_at' && blank(c.newValue))
  if (types.has('removed') || types.has('archived') || archivedSet || fieldChangedTo(entry.changes, 'current_active', 'false')) add('removal')
  if (types.has('restored') || types.has('unarchived') || archivedCleared || fieldChangedTo(entry.changes, 'current_active', 'true')) add('restore')
  if (types.has('final_disposition') || fields.has('final_disposition') || fields.has('final_disposition_remarks')) add('disposition')
  if (types.has('attachment_added') || types.has('attachment_removed')) add('attachment')
  if (types.has('added') || types.has('excel_updated') || (entry.source === 'excel' && !cats.length)) add('import')
  if (types.has('manual_update') || (entry.source === 'manual' && !cats.length)) add('manual')
  if (PERSON_FIELDS.some((f) => fields.has(f))) add('assignment')
  if (ETA_FIELDS.some((f) => fields.has(f))) add('eta')
  if (!cats.length) add(entry.changes.length ? 'manual' : 'other')
  return cats
}

/**
 * Fold events into entries, newest first.
 * Entry: { key, at, actorId, actorName, source, uploadId, reason, message,
 *          eventTypes, changes: [{ field, oldValue, newValue }], events,
 *          categories, category }
 */
export function groupHistory(events) {
  const sorted = sortEvents((events || []).filter(Boolean))
  const byKey = new Map()
  const order = []
  for (const e of sorted) {
    const k = groupKey(e)
    let g = byKey.get(k)
    if (!g) {
      g = {
        key: k,
        at: e.created_at ? stampKey(e.created_at) : null,
        actorId: e.actor_id || null,
        actorName: e.actor_name || '',
        source: e.source || 'system',
        uploadId: e.upload_id || null,
        reason: null,
        message: null,
        eventTypes: [],
        changes: [],
        events: [],
      }
      byKey.set(k, g)
      order.push(g)
    }
    g.events.push(e)
    if (!g.eventTypes.includes(e.event_type)) g.eventTypes.push(e.event_type)
    if (!g.actorName && e.actor_name) g.actorName = e.actor_name
    if (e.event_type === 'field_change' && e.field_name) {
      g.changes.push({ field: e.field_name, oldValue: e.old_value ?? null, newValue: e.new_value ?? null })
    } else {
      if (!g.reason && !blank(e.reason)) g.reason = e.reason
      const msg = e.details && typeof e.details === 'object' ? e.details.message : null
      if (!g.message && !blank(msg)) g.message = msg
    }
  }
  // Field changes in the order of the tracked-field list, so two reads of
  // one save always print the same lines in the same order.
  const rank = Object.keys(HISTORY_FIELD_LABELS)
  for (const g of order) {
    g.changes.sort((a, b) => {
      const ra = rank.indexOf(a.field); const rb = rank.indexOf(b.field)
      return (ra < 0 ? 999 : ra) - (rb < 0 ? 999 : rb) || String(a.field).localeCompare(String(b.field))
    })
    if (!g.reason) g.reason = g.events.find((e) => !blank(e.reason))?.reason || null
    g.categories = classifyEntry(g)
    g.category = g.categories[0]
  }
  return order
}

/** Entries that carry `category` (all when category is falsy or 'all'). */
export function filterEntries(entries, category) {
  if (!category || category === 'all') return entries || []
  return (entries || []).filter((e) => e.categories.includes(category))
}

/** Count per category, for the chip badges. */
export function categoryCounts(entries) {
  const out = Object.fromEntries(HISTORY_CATEGORIES.map((c) => [c, 0]))
  for (const e of entries || []) for (const c of e.categories) out[c] = (out[c] || 0) + 1
  return out
}

/**
 * Flat rows for an Excel export: one row per field change, or one row per
 * entry when the action changed no field (a removal, an import).
 */
export function historyExportRows(entries, opts = {}) {
  const lbl = opts.fieldLabel || fieldLabel
  const cat = opts.categoryLabel || ((c) => CATEGORY_LABELS[c] || c)
  const src = opts.sourceLabel || sourceLabel
  const rows = []
  for (const e of entries || []) {
    const base = {
      at: formatStamp(e.at),
      actor: e.actorName || 'System',
      source: src(e.source),
      category: e.categories.map(cat).join(', '),
      reason: e.reason || e.message || '',
    }
    if (!e.changes.length) { rows.push({ ...base, field: '', old_value: '', new_value: '' }); continue }
    for (const c of e.changes) {
      rows.push({
        ...base,
        field: lbl(c.field),
        old_value: formatValue(c.field, c.oldValue, opts),
        new_value: formatValue(c.field, c.newValue, opts),
      })
    }
  }
  return rows
}
