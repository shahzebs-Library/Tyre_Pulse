/**
 * Workshop Status -> Vehicle intake: pure logic (no I/O).
 *
 * Mirrors supabase/migrations/20261128090000_workshop_intake.sql. THE SERVER
 * DECIDES every rule (permissions, routing, the self-confirm refusal, the row
 * hash); this module only prepares rows, explains outcomes and keeps the
 * screen in step between polls. A test pins the vocab to the migration.
 */

/** Intake actions added to workshop_status_can (fail closed: missing = false). */
export const INTAKE_ACTION_KEYS = Object.freeze(['intake', 'intake_confirm', 'roster'])

export const INTAKE_SOURCES = Object.freeze(['excel_upload', 'sheet', 'phone', 'manual', 'erp'])
export const CONFIRM_STATUSES = Object.freeze(['pending_confirm', 'confirmed', 'returned'])
export const JOB_OUTCOMES = Object.freeze(['rescheduled', 'returned_parts_unavailable', 'closed_other', 'work_not_done'])
export const PRIORITIES = Object.freeze(['Low', 'Medium', 'High', 'Critical'])
export const WORK_TYPES = Object.freeze(['Repair', 'Emergency', 'Preventive Maintenance', 'Service', 'Tyre Change', 'Inspection', 'Other'])
export const RELEASE_DISPOSITIONS = Object.freeze(['repair_completed', 'returned_to_operation', 'transferred_site',
  'sent_external_workshop', 'vehicle_sold', 'vehicle_scrapped', 'wrong_entry', 'duplicate_entry', 'other'])
export const ANOMALY_KINDS = Object.freeze(['pending_too_long', 'backdated_entry', 'clock_mismatch', 'repeat_vehicle',
  'quick_release', 'outcome_flip_flop', 'bulk_confirm_many_sites'])
export const SHIFTS = Object.freeze({
  day: Object.freeze({ start: '06:00', end: '18:00' }),
  night: Object.freeze({ start: '18:00', end: '06:00' }),
  all: Object.freeze({ start: '', end: '' }),
})
/** Rows per server call (the RPC refuses more). */
export const MAX_BATCH = 200
/** Minimum reason length the server accepts. */
export const MIN_REASON = 5

/** The editable sheet columns, in order. `auto` columns are filled from the fleet register. */
export const SHEET_COLUMNS = Object.freeze([
  { key: 'asset_no', required: true },
  { key: 'reg_no', auto: true },
  { key: 'vehicle_category', auto: true },
  { key: 'site' },
  { key: 'job_card_ref' },
  { key: 'complaint' },
  { key: 'work_type', options: WORK_TYPES },
  { key: 'priority', options: PRIORITIES },
  { key: 'production_out_at', type: 'datetime' },
  { key: 'remarks' },
].map(Object.freeze))
export const EDITABLE_KEYS = Object.freeze(SHEET_COLUMNS.filter((c) => !c.auto).map((c) => c.key))

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '')
const str = (v) => (v == null ? '' : String(v).trim())

/** Same key the server uses: upper case, no spaces. */
export function assetKey(v) {
  return str(v).replace(/\s+/g, '').toUpperCase()
}

/**
 * Pick the intake flags out of workshop_status_my_permissions(). Anything that
 * is not exactly true is false.
 * @param {unknown} data
 * @returns {Readonly<Record<string, boolean>>}
 */
export function resolveIntakePermissions(data) {
  const src = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
  return Object.freeze(Object.fromEntries(INTAKE_ACTION_KEYS.map((k) => [k, src[k] === true])))
}

/** Header aliases for pasting from Excel (English and Arabic). */
const HEADER_ALIASES = {
  asset_no: ['asset', 'asset code', 'asset no', 'asset number', 'vehicle', 'vehicle no', 'fleet no', 'رقم الأصل', 'الأصل', 'رقم المركبة'],
  reg_no: ['plate', 'plate no', 'reg no', 'registration', 'رقم اللوحة', 'اللوحة'],
  site: ['site', 'workshop', 'workshop site', 'location', 'الموقع', 'الورشة'],
  job_card_ref: ['job card', 'job card no', 'job card number', 'jc', 'jc no', 'بطاقة العمل', 'رقم بطاقة العمل'],
  complaint: ['complaint', 'problem', 'fault', 'issue', 'الشكوى', 'العطل'],
  work_type: ['work type', 'type', 'نوع العمل'],
  priority: ['priority', 'الأولوية'],
  production_out_at: ['production out', 'out time', 'breakdown time', 'date', 'خروج من الإنتاج', 'وقت العطل'],
  remarks: ['remarks', 'notes', 'comment', 'ملاحظات'],
}

export function headerKey(name) {
  const n = str(name).toLowerCase().replace(/[._#:]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!n) return null
  for (const [key, list] of Object.entries(HEADER_ALIASES)) {
    if (list.includes(n)) return key
  }
  return null
}

/**
 * Parse a block copied from Excel / Google Sheets (tab separated). When the
 * first line is a header row the columns are mapped by name; otherwise the
 * cells fill the editable columns from `startKey` onwards, in sheet order.
 *
 * @param {string} text
 * @param {{ startKey?: string }} [opts]
 * @returns {{ rows: Array<Record<string,string>>, mapped: string[], header: boolean }}
 */
export function parsePastedTable(text, { startKey = 'asset_no' } = {}) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim() !== '')
  if (!lines.length) return { rows: [], mapped: [], header: false }
  const cells = lines.map((l) => l.split('\t'))
  const headerKeys = cells[0].map(headerKey)
  const isHeader = headerKeys.filter(Boolean).length >= Math.min(2, cells[0].length)
  let keys
  let body
  if (isHeader) {
    keys = headerKeys
    body = cells.slice(1)
  } else {
    const start = Math.max(0, EDITABLE_KEYS.indexOf(startKey))
    keys = cells[0].map((_, i) => EDITABLE_KEYS[start + i] || null)
    body = cells
  }
  const rows = body.map((c) => {
    const o = {}
    keys.forEach((k, i) => { if (k) o[k] = str(c[i]) })
    return o
  }).filter((o) => Object.values(o).some((v) => v !== ''))
  return { rows, mapped: [...new Set(keys.filter(Boolean))], header: isHeader }
}

/**
 * Check one sheet row before it is sent. Returns { field: messageKey }.
 * `fleet` maps assetKey -> fleet row; `listed` maps assetKey -> active record.
 */
export function validateRow(row, { fleet, listed, now = new Date() } = {}) {
  const errors = {}
  const key = assetKey(row?.asset_no)
  if (!key) errors.asset_no = 'assetMissing'
  else if (fleet && !fleet.has(key)) errors.asset_no = 'assetUnknown'
  else if (listed && listed.has(key) && listed.get(key)?.id !== row?.record_id) errors.asset_no = 'alreadyListed'
  if (!blank(row?.priority) && !PRIORITIES.includes(normalPriority(row.priority))) errors.priority = 'badPriority'
  if (!blank(row?.work_type) && !WORK_TYPES.includes(row.work_type)) errors.work_type = 'badWorkType'
  if (!blank(row?.production_out_at)) {
    const d = new Date(row.production_out_at)
    if (Number.isNaN(d.getTime())) errors.production_out_at = 'badDate'
    else if (d.getTime() > now.getTime() + 60 * 60 * 1000) errors.production_out_at = 'futureDate'
  }
  return errors
}

export function normalPriority(v) {
  const s = str(v).toLowerCase()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

/** A row is worth sending when it has an asset and no blocking error. */
export function isSendable(row, errors) {
  return !blank(row?.asset_no) && !errors?.asset_no && Object.keys(errors || {}).length === 0
}

/** Turn sheet rows into the RPC payload (only known keys; times as ISO). */
export function toPayload(rows, { now = new Date() } = {}) {
  return (rows || []).map((r) => {
    const out = { source_key: r.source_key }
    for (const k of EDITABLE_KEYS) {
      if (blank(r[k])) continue
      out[k] = k === 'priority' ? normalPriority(r[k]) : str(r[k])
    }
    if (out.production_out_at) {
      const d = new Date(out.production_out_at)
      out.production_out_at = Number.isNaN(d.getTime()) ? out.production_out_at : d.toISOString()
    }
    out.client_entered_at = now.toISOString()
    return out
  })
}

/** Split a list into server-sized batches. */
export function batches(list, size = MAX_BATCH) {
  const out = []
  for (let i = 0; i < (list || []).length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** Add up several ingest results. */
export function mergeIngestResults(results) {
  const total = { new: 0, updated: 0, unchanged: 0, already_listed: 0, invalid: 0, released: 0, rows: [] }
  for (const r of results || []) {
    for (const k of ['new', 'updated', 'unchanged', 'already_listed', 'invalid', 'released']) total[k] += Number(r?.[k] || 0)
    total.rows.push(...(r?.rows || []))
  }
  return total
}

/**
 * Merge a poll page into the current list by id. A row whose updated_at did
 * not move is kept as is (no re-render churn). Released or deleted rows drop
 * out of an "active" list.
 */
export function mergePolled(current, incoming, { activeOnly = true } = {}) {
  const map = new Map((current || []).map((r) => [r.id, r]))
  for (const r of incoming || []) {
    const old = map.get(r.id)
    if (activeOnly && (!r.current_active || r.deleted_at)) { map.delete(r.id); continue }
    if (old && old.updated_at === r.updated_at) continue
    map.set(r.id, r)
  }
  return [...map.values()]
}

/** Newest updated_at in a list (the next poll cursor). */
export function cursorOf(rows, prev = null) {
  let best = prev
  for (const r of rows || []) {
    if (r?.updated_at && (!best || r.updated_at > best)) best = r.updated_at
  }
  return best
}

/** Is this record waiting for this person to confirm? */
export function isWaitingFor(record, userId) {
  return Boolean(record && userId && record.current_active && record.confirm_status === 'pending_confirm'
    && Array.isArray(record.routed_to) && record.routed_to.includes(userId))
}

/** May this person press Confirm (the server checks again)? */
export function canConfirm(record, userId, { override = false } = {}) {
  if (!record || record.confirm_status !== 'pending_confirm' || !record.current_active) return false
  if (record.submitted_by && record.submitted_by === userId) return false
  return override || isWaitingFor(record, userId)
}

/** Mirror of workshop_intake_in_shift: a shift ending before it starts crosses midnight. */
export function inShift(time, start, end) {
  const t = toMinutes(time)
  const s = toMinutes(start)
  const e = toMinutes(end)
  if (s == null || e == null || s === e) return true
  if (t == null) return false
  return s < e ? t >= s && t < e : t >= s || t < e
}

function toMinutes(v) {
  const m = /^(\d{1,2}):(\d{2})/.exec(str(v))
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/** Validate a reason the same way the server does. */
export function reasonOk(reason) {
  return str(reason).length >= MIN_REASON
}

/** Group intake records for the list view. */
export function groupIntake(records, userId) {
  const g = { waiting: [], pending: [], returned: [], confirmed: [] }
  for (const r of records || []) {
    if (!r?.current_active) continue
    if (r.confirm_status === 'returned') g.returned.push(r)
    else if (r.confirm_status === 'pending_confirm') (isWaitingFor(r, userId) ? g.waiting : g.pending).push(r)
    else if (r.intake_source !== 'excel_upload') g.confirmed.push(r)
  }
  const byTime = (a, b) => String(b.submitted_at || b.first_seen_at || '').localeCompare(String(a.submitted_at || a.first_seen_at || ''))
  for (const k of Object.keys(g)) g[k].sort(byTime)
  return g
}

/** A blank sheet row with a stable client id (used as source_key). */
export function blankRow(makeId = defaultId) {
  return { source_key: makeId(), asset_no: '', site: '', job_card_ref: '', complaint: '', work_type: '', priority: '', production_out_at: '', remarks: '' }
}

function defaultId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
