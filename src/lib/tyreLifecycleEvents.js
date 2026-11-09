/**
 * tyreLifecycleEvents.js - the chronological event history of each PHYSICAL tyre.
 *
 * Read-only: derived from what is already stored (fitment rows, scrap marks,
 * retread jobs, service events, warranty claims, disposals). Nothing is written.
 *
 * MIRROR of SQL public.v_tyre_lifecycle_events (migration 20261110100000) -
 * change both together (pinned by src/test/tyreLifecycleEvents.test.js).
 *
 * Rules (see docs/tyre/LIFECYCLE_EVENTS.md):
 *  - physical tyre = tyreKey() of src/lib/tyreLifetime.js (country|serial for a
 *    real serial, the row itself otherwise).
 *  - the first fitment is FIT; a later one is REFIT_SAME_VEHICLE (same vehicle and
 *    position), ROTATION (same vehicle, other position) or TRANSFER (other vehicle).
 *  - a later fitment that cannot be told apart is AMBIGUOUS with its reason and is
 *    never resolved (same-day double entry, an earlier fitment still open, an
 *    overlap, no date, no vehicle, no position).
 *  - a ROTATION, TRANSFER or REFIT is never a purchase: is_purchase is true only on
 *    the FIT of a tyre priced on any of its rows (rule T1: one tyre, one price).
 */
import { isStrongSerial, tyreKey, fitmentKm, isActiveTyreStatus } from './tyreLifetime'

export const EVENT_TYPES = Object.freeze([
  'FIT', 'REFIT_SAME_VEHICLE', 'ROTATION', 'TRANSFER', 'REMOVAL', 'RETURN_TO_STORE',
  'RETREAD', 'WARRANTY_REPLACEMENT', 'SCRAP', 'DISPOSAL', 'AMBIGUOUS',
])

export const EVENT_TYPE_LABEL = Object.freeze({
  FIT: 'Fitted (first)',
  REFIT_SAME_VEHICLE: 'Refitted, same vehicle',
  ROTATION: 'Rotated',
  TRANSFER: 'Moved to another vehicle',
  REMOVAL: 'Removed',
  RETURN_TO_STORE: 'Back in store',
  RETREAD: 'Retreaded',
  WARRANTY_REPLACEMENT: 'Warranty replacement',
  SCRAP: 'Scrapped',
  DISPOSAL: 'Disposed',
  AMBIGUOUS: 'Unclear movement',
})

export const AMBIGUOUS_REASONS = Object.freeze([
  'same_day_double_entry', 'earlier_fitment_still_open', 'overlaps_earlier_fitment',
  'no_fitment_date', 'vehicle_not_recorded', 'position_not_recorded',
])

export const AMBIGUOUS_REASON_LABEL = Object.freeze({
  same_day_double_entry: 'Two fitments on the same day',
  earlier_fitment_still_open: 'The earlier fitment is still open (rotation not closed)',
  overlaps_earlier_fitment: 'Starts before the earlier fitment ended',
  no_fitment_date: 'No fitment date',
  vehicle_not_recorded: 'Vehicle not recorded',
  position_not_recorded: 'Position not recorded',
})

const num = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const day = (v) => (v ? String(v).slice(0, 10) : null)
const up = (v) => String(v ?? '').trim().toUpperCase()
const blank = (v) => !String(v ?? '').trim()
const keyOf = (country, serial) => `${up(country)}|${up(serial)}`
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000)

// Postgres orders uuids bytewise; lowercase canonical text compares the same way.
const cmpText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)
const cmpDateNullsFirst = (a, b) => {
  if (a === b) return 0
  if (a == null) return -1
  if (b == null) return 1
  return a < b ? -1 : 1
}

/** One fitment row in the shape of SQL v_tyre_lifetime_fitments. */
function shapeFitment(r, i) {
  const completed = Boolean(r?.removal_date) || num(r?.km_at_removal) != null
  const k = fitmentKm(r)
  return {
    raw: r,
    id: r?.id ?? `row${i}`,
    tyre_key: tyreKey(r, i),
    country: r?.country ?? null,
    serial_no: r?.serial_no ?? null,
    asset_no: r?.asset_no ?? null,
    position: r?.tyre_position ?? r?.position ?? null,
    status: r?.status ?? null,
    fit_date: day(r?.issue_date ?? r?.fitment_date),
    removal_date: day(r?.removal_date),
    km_at_fitment: num(r?.km_at_fitment),
    km_at_removal: num(r?.km_at_removal),
    cost: num(r?.cost_per_tyre),
    km: k != null && k > 0 ? k : null,
    completed,
    active: isActiveTyreStatus(r?.status),
  }
}

/** Fitment-derived events for one tyre's ordered fitments. */
function fitmentEvents(rows, replacementByTyreId) {
  const out = []
  let prevEnd = null // latest end of any earlier fitment; Infinity = still open
  const pricedIdx = rows.findIndex((f) => (f.cost ?? 0) > 0)
  rows.forEach((f, i) => {
    const seq = i + 1
    const prev = rows[i - 1]
    const next = rows[i + 1]
    const isOverlap = f.fit_date != null && prevEnd != null && (prevEnd === Infinity || f.fit_date < prevEnd)
    let amb = null
    if (seq > 1) {
      if (f.fit_date != null && f.fit_date === prev.fit_date) amb = 'same_day_double_entry'
      else if (isOverlap && prevEnd === Infinity) amb = 'earlier_fitment_still_open'
      else if (isOverlap) amb = 'overlaps_earlier_fitment'
      else if (f.fit_date == null) amb = 'no_fitment_date'
      else if (blank(f.asset_no) || blank(prev.asset_no)) amb = 'vehicle_not_recorded'
      else if (up(f.asset_no) === up(prev.asset_no) && (blank(f.position) || blank(prev.position))) amb = 'position_not_recorded'
    }
    let type = 'FIT'
    if (seq > 1) {
      if (amb) type = 'AMBIGUOUS'
      else if (up(f.asset_no) !== up(prev.asset_no)) type = 'TRANSFER'
      else if (up(f.position) === up(prev.position)) type = 'REFIT_SAME_VEHICLE'
      else type = 'ROTATION'
    }
    let detail = null
    if (seq === 1 && pricedIdx > 0) detail = `purchase price is recorded on a later fitment row (${rows[pricedIdx].id})`
    else if (seq > 1 && prev.removal_date == null && !prev.completed && !prev.active) detail = 'previous fitment has no removal date'
    out.push({
      ...base(f), event_date: f.fit_date, _ord: seq * 10,
      event_type: type, ambiguous_reason: amb,
      asset_no: f.asset_no, position: f.position,
      from_asset_no: seq > 1 ? prev.asset_no : null,
      from_position: seq > 1 ? prev.position : null,
      odometer_km: f.km_at_fitment, km: null,
      is_purchase: seq === 1 && pricedIdx >= 0,
      fitment_id: f.id, source_table: 'tyre_records', source_id: String(f.id), detail,
    })
    if (f.completed) {
      const rl = replacementByTyreId.get(String(f.id))
      const notes = [
        isOverlap ? 'km not counted in life: overlaps an earlier fitment' : null,
        rl ? `closed by system reconcile (${rl.source}, log ${rl.id})` : null,
      ].filter(Boolean)
      out.push({
        ...base(f), event_date: f.removal_date, _ord: seq * 10 + 1,
        event_type: 'REMOVAL', ambiguous_reason: null,
        asset_no: f.asset_no, position: f.position, from_asset_no: null, from_position: null,
        odometer_km: f.km_at_removal, km: f.km,
        is_purchase: false, fitment_id: f.id, source_table: 'tyre_records', source_id: String(f.id),
        detail: notes.length ? notes.join('; ') : null,
      })
    }
    if (f.removal_date != null && next?.fit_date != null && next.fit_date > f.removal_date) {
      out.push({
        ...base(f), event_date: f.removal_date, _ord: seq * 10 + 2,
        event_type: 'RETURN_TO_STORE', ambiguous_reason: null,
        asset_no: null, position: null, from_asset_no: f.asset_no, from_position: f.position,
        odometer_km: null, km: null, is_purchase: false, fitment_id: f.id,
        source_table: 'tyre_records', source_id: String(f.id),
        detail: `inferred: off a vehicle ${daysBetween(f.removal_date, next.fit_date)} day(s) before refit`,
      })
    }
    const end = f.removal_date != null ? f.removal_date : (!f.completed && f.active ? Infinity : null)
    if (end != null) {
      if (prevEnd == null || end === Infinity) prevEnd = end
      else if (prevEnd !== Infinity && end > prevEnd) prevEnd = end
    }
  })
  return out
}

const base = (f) => ({ tyre_key: f.tyre_key, country: f.country, serial_no: f.serial_no })

const blankEvent = {
  ambiguous_reason: null, asset_no: null, position: null, from_asset_no: null, from_position: null,
  odometer_km: null, km: null, is_purchase: false, fitment_id: null, detail: null,
}

/**
 * Build the lifecycle events. Input (all optional arrays):
 *   fitments        tyre_records rows
 *   marks           tyre_status_marks rows ({ id, serial, mark_type, country, created_at, reason })
 *   retreadJobs     retread_jobs rows
 *   serviceEvents   tyre_service_events rows
 *   warrantyClaims  warranty_claims rows
 *   disposals       tyre_disposals rows
 *   replacementLog  tyre_replacement_log rows (annotates system-closed removals)
 * Returns events ordered per tyre (tyre_key, then event_seq), each with the same
 * columns as the SQL view.
 */
export function buildLifecycleEvents(input = {}) {
  const {
    fitments = [], marks = [], retreadJobs = [], serviceEvents = [],
    warrantyClaims = [], disposals = [], replacementLog = [],
  } = input
  const shaped = (fitments || []).map(shapeFitment)
  const byKey = new Map()
  shaped.forEach((f) => {
    if (!byKey.has(f.tyre_key)) byKey.set(f.tyre_key, [])
    byKey.get(f.tyre_key).push(f)
  })
  const byId = new Map(shaped.map((f) => [String(f.id), f]))
  const repl = new Map()
  ;(replacementLog || []).forEach((l) => {
    if (l?.undone_at || l?.tyre_id == null) return
    const cur = repl.get(String(l.tyre_id))
    if (!cur || Number(l.id) > Number(cur.id)) repl.set(String(l.tyre_id), l)
  })

  const events = []
  for (const rows of byKey.values()) {
    rows.sort((a, b) => cmpDateNullsFirst(a.fit_date, b.fit_date) || cmpText(String(a.id), String(b.id)))
    events.push(...fitmentEvents(rows, repl))
  }

  const scrapMarkKeys = new Set()
  ;(marks || []).forEach((m) => {
    if (m?.mark_type !== 'scrap' || !isStrongSerial(m.serial)) return
    const k = keyOf(m.country, m.serial)
    scrapMarkKeys.add(k)
    events.push({
      ...blankEvent, tyre_key: k, country: m.country ?? null, serial_no: m.serial,
      event_date: day(m.created_at), _ord: 1000000, event_type: 'SCRAP',
      source_table: 'tyre_status_marks', source_id: String(m.id ?? ''),
      detail: blank(m.reason) ? null : String(m.reason).trim(),
    })
  })
  for (const rows of byKey.values()) {
    rows.forEach((f, i) => {
      if (!/scrap/i.test(String(f.status ?? '')) || scrapMarkKeys.has(f.tyre_key)) return
      events.push({
        ...blankEvent, ...base(f), event_date: f.removal_date, _ord: (i + 1) * 10 + 3,
        event_type: 'SCRAP', asset_no: f.asset_no, position: f.position, fitment_id: f.id,
        source_table: 'tyre_records', source_id: String(f.id), detail: 'status Scrapped, no scrap mark',
      })
    })
  }

  ;(retreadJobs || []).forEach((j) => {
    const date = day(j?.returned_at ?? j?.sent_at)
    if (!date) return
    const fr = j.tyre_record_id != null ? byId.get(String(j.tyre_record_id)) : null
    const k = isStrongSerial(j.casing_serial) ? keyOf(j.country, j.casing_serial) : fr?.tyre_key
    if (!k) return
    events.push({
      ...blankEvent, tyre_key: k, country: j.country ?? null, serial_no: j.casing_serial ?? fr?.serial_no ?? null,
      event_date: date, _ord: 2000000, event_type: 'RETREAD', asset_no: j.last_asset_no ?? null,
      fitment_id: j.tyre_record_id ?? null, source_table: 'retread_jobs', source_id: String(j.id ?? ''),
      detail: [j.vendor_name, j.status].filter((v) => !blank(v)).join(', ') || null,
    })
  })

  ;(serviceEvents || []).forEach((s) => {
    if (!isStrongSerial(s?.tyre_serial)) return
    const t = String(s.event_type ?? '')
    const retread = /retread/i.test(t)
    if (!retread && !/rotat/i.test(t)) return
    events.push({
      ...blankEvent, tyre_key: keyOf(s.country, s.tyre_serial), country: s.country ?? null, serial_no: s.tyre_serial,
      event_date: day(s.event_date), _ord: retread ? 2000000 : 1500000,
      event_type: retread ? 'RETREAD' : 'ROTATION', asset_no: s.asset_no ?? null, position: s.position ?? null,
      odometer_km: num(s.odometer_km), source_table: 'tyre_service_events', source_id: String(s.id ?? ''),
      detail: blank(s.notes) ? null : String(s.notes).trim(),
    })
  })

  ;(warrantyClaims || []).forEach((w) => {
    if (!isStrongSerial(w?.serial_number)) return
    if (!['Approved', 'Credit Issued', 'Closed'].includes(w.claim_status) || w.rejection_reason != null) return
    events.push({
      ...blankEvent, tyre_key: keyOf(w.country, w.serial_number), country: w.country ?? null, serial_no: w.serial_number,
      event_date: day(w.decision_date ?? w.credit_date ?? w.removal_date), _ord: 3000000,
      event_type: 'WARRANTY_REPLACEMENT', asset_no: w.asset_no ?? null,
      odometer_km: num(w.km_at_removal), km: num(w.km_run),
      source_table: 'warranty_claims', source_id: String(w.id ?? ''),
      detail: [w.claim_no, w.claim_status].filter((v) => !blank(v)).join(', ') || null,
    })
  })

  ;(disposals || []).forEach((d) => {
    if (!d?.disposed_on) return
    const fr = byId.get(String(d.tyre_record_id))
    if (!fr) return
    events.push({
      ...blankEvent, ...base(fr), event_date: day(d.disposed_on), _ord: 4000000,
      event_type: 'DISPOSAL', fitment_id: d.tyre_record_id, source_table: 'tyre_disposals',
      source_id: String(d.tyre_record_id),
      detail: [d.disposal_method, d.disposal_vendor].filter((v) => !blank(v)).join(', ') || null,
    })
  })

  events.sort((a, b) => cmpText(a.tyre_key, b.tyre_key)
    || cmpDateNullsFirst(a.event_date, b.event_date)
    || a._ord - b._ord
    || cmpText(a.source_table, b.source_table)
    || cmpText(a.source_id, b.source_id))
  let lastKey = null
  let seq = 0
  return events.map(({ _ord, ...e }) => {
    seq = e.tyre_key === lastKey ? seq + 1 : 1
    lastKey = e.tyre_key
    return { ...e, event_seq: seq }
  })
}

/** Counts per event type (and per ambiguity reason) - same shape as the counts RPC. */
export function countLifecycleEvents(events = []) {
  const byType = {}
  const ambiguous = {}
  for (const e of events) {
    byType[e.event_type] = (byType[e.event_type] ?? 0) + 1
    if (e.event_type === 'AMBIGUOUS' && e.ambiguous_reason) ambiguous[e.ambiguous_reason] = (ambiguous[e.ambiguous_reason] ?? 0) + 1
  }
  return { byType, ambiguous }
}

/** A plain-English one-line description of an event, for timelines and exports. */
export function describeLifecycleEvent(e = {}) {
  const label = EVENT_TYPE_LABEL[e.event_type] || 'Event'
  const where = [e.asset_no, e.position].filter(Boolean).join(' / ')
  const from = [e.from_asset_no, e.from_position].filter(Boolean).join(' / ')
  if (e.event_type === 'AMBIGUOUS') {
    return `${label}: ${AMBIGUOUS_REASON_LABEL[e.ambiguous_reason] || 'reason not stated'}${where ? ` (${where})` : ''}`
  }
  if ((e.event_type === 'TRANSFER' || e.event_type === 'ROTATION') && from && where) return `${label}: ${from} to ${where}`
  if (e.event_type === 'RETURN_TO_STORE' && from) return `${label} from ${from}`
  return where ? `${label} on ${where}` : label
}
