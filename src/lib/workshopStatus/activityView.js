/**
 * Workshop Status -> Activity log and Team workload view engine (Loop 10,
 * spec section 15 "Who Worked on What"). Pure: no I/O, and every
 * clock-dependent function takes `now` so tests are deterministic.
 *
 * Source of truth is the append-only workshop_status_events table. One event
 * becomes one row: who, which vehicle, what changed (field old -> new), when,
 * which site, which action and which upload.
 *
 * Honesty rules:
 *  - a value that was never recorded reads as null (the screen shows N/A);
 *    nothing is invented.
 *  - an event with no actor was written by the system (an import trigger or a
 *    job), never attributed to a person.
 *  - workload "pending update today" is judged on the last MANUAL update, the
 *    same rule Active vehicles uses (activeView.freshness): an Excel refresh is
 *    not a person looking at the vehicle.
 */
import { freshness, FRESHNESS, fmtDay, fmtDateTime, localDay } from './activeView'

export const UNASSIGNED_KEY = '__unassigned__'
export const SYSTEM_ACTOR = '__system__'

/** Fields that hold a person (profile id). */
export const PERSON_FIELDS = Object.freeze(['responsible_user_id', 'supporting_user_id'])
/** Fields that hold an ETA. */
export const ETA_FIELDS = Object.freeze(['expected_part_date', 'expected_release_date'])
/** Fields that record the final disposition. */
export const DISPOSITION_FIELDS = Object.freeze(['final_disposition', 'final_disposition_remarks'])
/** Date-only fields (rendered as "07 Oct 2026"). */
const DATE_FIELDS = Object.freeze(['ooc_since', 'expected_part_date', 'expected_release_date'])
/** Timestamp fields (rendered with the time). */
const STAMP_FIELDS = Object.freeze(['archived_at', 'deleted_at'])

const SPECIAL_FIELDS = Object.freeze([...PERSON_FIELDS, ...ETA_FIELDS, ...DISPOSITION_FIELDS])

/**
 * Action groups, in display order. `eventTypes` (+ optional `fields` /
 * `excludeFields`) is the server filter for that group, so filtering by an
 * action never loads rows only to throw them away.
 */
export const ACTION_GROUPS = Object.freeze([
  { key: 'manual_update', eventTypes: ['manual_update'] },
  { key: 'field_change', eventTypes: ['field_change'], excludeFields: SPECIAL_FIELDS },
  { key: 'assignment', eventTypes: ['field_change'], fields: PERSON_FIELDS },
  { key: 'eta_change', eventTypes: ['field_change'], fields: ETA_FIELDS },
  { key: 'disposition', eventTypes: ['final_disposition', 'field_change'], fields: DISPOSITION_FIELDS },
  { key: 'upload_previewed', eventTypes: ['upload_previewed'] },
  { key: 'upload_confirmed', eventTypes: ['upload_confirmed'] },
  { key: 'upload_cancelled', eventTypes: ['upload_cancelled'] },
  { key: 'upload_failed', eventTypes: ['upload_failed'] },
  { key: 'excel_refresh', eventTypes: ['excel_updated'] },
  { key: 'added', eventTypes: ['added'] },
  { key: 'removed', eventTypes: ['removed', 'archived', 'soft_deleted', 'permanently_deleted'] },
  { key: 'restore', eventTypes: ['restored', 'unarchived', 'undeleted'] },
  { key: 'attachment', eventTypes: ['attachment_added', 'attachment_removed'] },
  { key: 'export', eventTypes: ['export'] },
].map(Object.freeze))

export const ACTION_GROUP_KEYS = Object.freeze(ACTION_GROUPS.map((g) => g.key))

/**
 * The server filter for an action group, or null for "any action".
 * `final_disposition` events carry no field name, so the disposition group
 * needs both halves: the event type alone OR a field_change on a disposition
 * field. Callers express that with `orFilter`.
 *
 * @returns {{ eventTypes: string[], fields?: string[], excludeFields?: string[], orFilter?: string } | null}
 */
export function serverFilterFor(groupKey) {
  const g = ACTION_GROUPS.find((x) => x.key === groupKey)
  if (!g) return null
  if (g.key === 'disposition') {
    return {
      eventTypes: g.eventTypes.slice(),
      orFilter: `event_type.eq.final_disposition,field_name.in.(${DISPOSITION_FIELDS.join(',')})`,
    }
  }
  const out = { eventTypes: g.eventTypes.slice() }
  if (g.fields) out.fields = g.fields.slice()
  if (g.excludeFields) out.excludeFields = g.excludeFields.slice()
  return out
}

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '')
const str = (v) => (blank(v) ? null : String(v).trim())

/** The action group of one event (never null: unknown types read as field_change). */
export function actionGroupOf(event) {
  const type = String(event?.event_type || '')
  const field = String(event?.field_name || '')
  if (type === 'field_change') {
    if (PERSON_FIELDS.includes(field)) return 'assignment'
    if (ETA_FIELDS.includes(field)) return 'eta_change'
    if (DISPOSITION_FIELDS.includes(field)) return 'disposition'
    return 'field_change'
  }
  if (type === 'final_disposition') return 'disposition'
  const g = ACTION_GROUPS.find((x) => x.eventTypes.includes(type) && !x.fields && !x.excludeFields)
  return g ? g.key : 'field_change'
}

/**
 * A stored text value as the person should read it. Dates become "07 Oct
 * 2026", person ids become names (via `people`, a Map id -> name), booleans
 * become Yes / No. Returns null when nothing was recorded.
 *
 * @param {string} field
 * @param {unknown} value
 * @param {{ people?: Map<string,string>, unknownPerson?: string, yes?: string, no?: string }} [opts]
 */
export function formatValue(field, value, opts = {}) {
  if (blank(value)) return null
  const v = String(value).trim()
  if (PERSON_FIELDS.includes(field)) {
    const name = opts.people?.get?.(v)
    return name || opts.unknownPerson || 'Unknown person'
  }
  if (DATE_FIELDS.includes(field)) return fmtDay(v) || v
  if (STAMP_FIELDS.includes(field)) return fmtDateTime(v) || v
  if (v === 'true') return opts.yes || 'Yes'
  if (v === 'false') return opts.no || 'No'
  return v
}

/** Profile ids referenced by events (actors and person-field values). */
export function collectPersonIds(events) {
  const out = new Set()
  for (const e of events || []) {
    if (!blank(e?.actor_id)) out.add(String(e.actor_id))
    if (PERSON_FIELDS.includes(e?.field_name)) {
      if (!blank(e.old_value)) out.add(String(e.old_value).trim())
      if (!blank(e.new_value)) out.add(String(e.new_value).trim())
    }
  }
  return [...out]
}

/**
 * One event -> one display row.
 *
 * @param {object} event  a workshop_status_events row
 * @param {{ records?: Map, uploads?: Map, people?: Map }} [lookups]
 */
export function shapeEvent(event, lookups = {}) {
  const rec = event?.record_id ? lookups.records?.get?.(String(event.record_id)) || null : null
  const up = event?.upload_id ? lookups.uploads?.get?.(String(event.upload_id)) || null : null
  const actorId = str(event?.actor_id)
  const actorName = actorId
    ? (lookups.people?.get?.(actorId) || str(event?.actor_name) || null)
    : null
  const details = event?.details && typeof event.details === 'object' ? event.details : {}
  const isField = event?.event_type === 'field_change'
  return {
    id: String(event?.id ?? ''),
    at: event?.created_at || null,
    actorId,
    actorName,
    isSystem: !actorId,
    eventType: str(event?.event_type),
    group: actionGroupOf(event),
    assetNo: str(event?.asset_no) || str(rec?.asset_no),
    recordId: str(event?.record_id),
    site: str(event?.site) || str(rec?.site),
    country: str(event?.country) || str(rec?.country),
    field: isField ? str(event?.field_name) : null,
    oldValue: isField ? str(event?.old_value) : null,
    newValue: isField ? str(event?.new_value) : null,
    reason: str(event?.reason),
    source: str(event?.source),
    details,
    uploadId: str(event?.upload_id),
    uploadNo: up?.upload_no ?? null,
    uploadFile: str(up?.file_name) || str(details.file_name),
    recordStage: str(rec?.current_stage),
    recordDelay: str(rec?.delay_reason),
    recordStatus: str(rec?.daily_report_status),
    recordActive: rec ? rec.current_active !== false && !rec.deleted_at : null,
  }
}

/** Every event shaped, keeping server order (newest first). */
export function shapeActivity(events, lookups = {}) {
  return (events || []).map((e) => shapeEvent(e, lookups))
}

/** Empty client-side filter state (server-side filters live in the panel). */
export function emptyActivityFilters() {
  return { status: '', delayReason: '' }
}

/**
 * Client-side filters on the joined record: current stage ("status") and
 * delay reason. A row with no record (an upload event) never matches an
 * active filter: it has no stage to compare.
 */
export function filterActivity(rows, filters = {}) {
  const status = str(filters.status)
  const delay = str(filters.delayReason)
  if (!status && !delay) return rows || []
  return (rows || []).filter((r) => {
    if (status && r.recordStage !== status) return false
    if (delay && r.recordDelay !== delay) return false
    return true
  })
}

/** Distinct people who acted in `rows`: [{ id, name }] sorted by name. */
export function actorOptions(rows) {
  const map = new Map()
  for (const r of rows || []) {
    if (r.actorId && !map.has(r.actorId)) map.set(r.actorId, r.actorName)
  }
  return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
}

/** Distinct non-blank values of `key` in rows, sorted. */
export function distinctOf(rows, key) {
  const set = new Set()
  for (const r of rows || []) if (!blank(r?.[key])) set.add(String(r[key]))
  return [...set].sort((a, b) => a.localeCompare(b))
}

/** Per-person event counts and distinct vehicles touched (spec: how many vehicles did each user update). */
export function actorSummary(rows) {
  const map = new Map()
  for (const r of rows || []) {
    const key = r.actorId || SYSTEM_ACTOR
    let s = map.get(key)
    if (!s) { s = { id: key, name: r.actorId ? r.actorName : null, isSystem: !r.actorId, events: 0, assets: new Set() }; map.set(key, s) }
    s.events += 1
    if (r.assetNo) s.assets.add(r.assetNo)
  }
  return [...map.values()]
    .map((s) => ({ id: s.id, name: s.name, isSystem: s.isSystem, events: s.events, vehicles: s.assets.size }))
    .sort((a, b) => b.events - a.events || String(a.name || '').localeCompare(String(b.name || '')))
}

/**
 * Local day range as ISO bounds for the server: `from` = local midnight of
 * the from day, `to` = local midnight of the day AFTER the to day (exclusive).
 * A blank or invalid day leaves that side open.
 */
export function dayRangeToIso(fromDay, toDay) {
  const parse = (v) => {
    const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (!m) return null
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const f = parse(fromDay)
  const t = parse(toDay)
  let toIso = null
  if (t) { const n = new Date(t); n.setDate(n.getDate() + 1); toIso = n.toISOString() }
  return { from: f ? f.toISOString() : null, to: toIso }
}

/** yyyy-mm-dd of `now` minus `days`, local. */
export function daysAgo(now, days) {
  const d = new Date(now instanceof Date ? now.getTime() : now ?? Date.now())
  d.setDate(d.getDate() - days)
  return localDay(d)
}

// ── Team workload ───────────────────────────────────────────────────────────

/** Parts statuses that mean the vehicle is still waiting for a part. */
export const PARTS_WAITING = Object.freeze([
  'Required', 'Checking Store', 'MR Pending', 'MR Raised', 'MR Approved', 'PO Pending', 'PO Issued',
  'Supplier Confirmed', 'In Transit', 'Partially Received', 'Not Available', 'Alternative Part Under Review',
])
const REPAIR_STAGES = Object.freeze(['Repair in Progress', 'External Repair'])
const APPROVAL_DELAYS = Object.freeze(['Waiting for Approval', 'Waiting for Budget Approval'])

export const WORKLOAD_METRICS = Object.freeze(['assigned', 'inProgress', 'waitingParts', 'waitingApproval', 'pendingToday'])

/** Which workload buckets one record falls into. */
export function workloadFlags(record, now) {
  const stage = str(record?.current_stage)
  const parts = str(record?.parts_status)
  const delay = str(record?.delay_reason)
  return {
    assigned: true,
    inProgress: REPAIR_STAGES.includes(stage),
    waitingParts: stage === 'Waiting for Parts' || PARTS_WAITING.includes(parts),
    waitingApproval: stage === 'Waiting for Approval' || APPROVAL_DELAYS.includes(delay),
    pendingToday: freshness(record, now) !== FRESHNESS.TODAY,
  }
}

const zero = () => ({ assigned: 0, inProgress: 0, waitingParts: 0, waitingApproval: 0, pendingToday: 0 })

/**
 * Workload per responsible person over the ACTIVE records (archived, removed
 * and deleted records are not workload). Records with no responsible person
 * form the Unassigned bucket, always listed last.
 *
 * @returns {{ rows: Array<{ id: string, name: string|null, unassigned: boolean } & Record<string, number>>, totals: Record<string, number> }}
 */
export function workload(records, { now } = {}) {
  const map = new Map()
  const totals = zero()
  for (const r of records || []) {
    if (r?.current_active === false || r?.deleted_at) continue
    const id = str(r?.responsible_user_id) || UNASSIGNED_KEY
    let w = map.get(id)
    if (!w) {
      w = { id, name: id === UNASSIGNED_KEY ? null : (str(r.responsible_name) || null), unassigned: id === UNASSIGNED_KEY, ...zero() }
      map.set(id, w)
    }
    if (!w.name && id !== UNASSIGNED_KEY && str(r.responsible_name)) w.name = str(r.responsible_name)
    const f = workloadFlags(r, now)
    for (const k of WORKLOAD_METRICS) if (f[k]) { w[k] += 1; totals[k] += 1 }
  }
  const people = [...map.values()].filter((w) => !w.unassigned)
    .sort((a, b) => b.assigned - a.assigned || String(a.name || '').localeCompare(String(b.name || '')))
  const un = map.get(UNASSIGNED_KEY)
  return { rows: un ? [...people, un] : people, totals }
}
