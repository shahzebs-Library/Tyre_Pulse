/**
 * Workshop Status - the latest manual update of each vehicle, for printed and
 * exported reports (owner: "while printing the data the latest update must be
 * added there"). Pure: no I/O.
 *
 * Source: the newest 'manual_update' event of the record (append-only
 * workshop_status_events), whose details.changed_fields lists what that save
 * changed. The VALUES printed are the record's current values of those fields,
 * which is what that save left behind unless a later Excel refresh touched an
 * Excel-owned field (the manual fields are never written by Excel).
 */
import { DATE_FIELDS, PEOPLE_FIELDS } from './updateForm.js'

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '')

/**
 * Newest manual_update event per record id from a list of events (any order).
 * @returns {Map<string, object>}
 */
export function latestManualUpdateByRecord(events) {
  const out = new Map()
  for (const e of events || []) {
    if (!e || e.event_type !== 'manual_update' || blank(e.record_id)) continue
    const k = String(e.record_id)
    const cur = out.get(k)
    const t = Date.parse(e.created_at)
    if (!cur || t > Date.parse(cur.created_at) || (t === Date.parse(cur.created_at) && String(e.id) > String(cur.id))) out.set(k, e)
  }
  return out
}

/**
 * One line describing the latest update, e.g.
 * "Sajid, 07 Oct 2026 09:30 - Current stage: Waiting for Parts; Work done: Removed cover".
 *
 * @param {object} record   workshop_status_records row
 * @param {object|null} event  newest manual_update event of that record
 * @param {object} fmt
 * @param {(field: string) => string} fmt.label         field label
 * @param {(id: string) => string|null} [fmt.personName] profile id -> name
 * @param {(v: string) => string} [fmt.day]             date formatter
 * @param {(v: string) => string} [fmt.stamp]           timestamp formatter
 * @param {string} [fmt.cleared]                        text for a cleared field
 * @param {string} [fmt.system]                         actor text when unknown
 * @returns {string|null} null when the vehicle has never been updated by hand
 */
export function latestUpdateText(record, event, fmt) {
  if (!record || !event) return null
  const label = fmt?.label || ((f) => f)
  const fields = Array.isArray(event?.details?.changed_fields) ? event.details.changed_fields : []
  const parts = fields.map((f) => {
    const raw = record[f]
    let v
    if (blank(raw)) v = fmt?.cleared || '-'
    else if (PEOPLE_FIELDS.includes(f)) v = (fmt?.personName && fmt.personName(String(raw))) || fmt?.cleared || '-'
    else if (DATE_FIELDS.includes(f)) v = fmt?.day ? fmt.day(raw) : String(raw)
    else v = String(raw).replace(/\s+/g, ' ').trim()
    return `${label(f)}: ${v}`
  })
  const who = event.actor_name || fmt?.system || ''
  const when = fmt?.stamp ? fmt.stamp(event.created_at) : String(event.created_at || '')
  const head = [who, when].filter(Boolean).join(', ')
  return parts.length ? `${head} - ${parts.join('; ')}` : head || null
}
