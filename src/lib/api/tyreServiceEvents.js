/**
 * Tyre Service Events service — the single place that talks to Supabase for the
 * `tyre_service_events` table (V151). Logs discrete tyre interventions
 * (rotation / repair / inflation / inspection / replacement) against a tyre
 * serial and/or asset. Explicit column list (least-privilege selects), null-safe
 * country scoping, and graceful degradation when the relation is absent (module
 * shipped before the migration is applied). Mirrors support.js / tyreRecords.js.
 */
import { supabase, unwrap, applyCountry } from './_client'

export const COLS =
  'id,organisation_id,country,tyre_serial,asset_no,position,event_type,event_date,' +
  'tread_depth,pressure,cost,technician,site,notes,created_by,created_at,updated_at'

export const EVENT_TYPES = ['rotation', 'repair', 'inflation', 'inspection', 'replacement', 'other']

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  const code = String(err?.code || '')
  return (
    code === '42P01' ||
    m.includes('does not exist') ||
    m.includes('could not find the table') ||
    m.includes('schema cache') ||
    (m.includes('relation') && m.includes('tyre_service_events'))
  )
}

function toNumberOrNull(v) {
  if (v === '' || v == null) return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

function cleanText(v, max = 500) {
  if (v == null) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}

/**
 * List service events (newest first). Optional event-type and country filters.
 * Returns [] when the table has not been created yet so the page can prompt for
 * the migration instead of throwing.
 * @param {{ country?:string, eventType?:string, limit?:number }} [opts]
 */
export async function listServiceEvents({ country, eventType, limit = 500 } = {}) {
  try {
    let q = supabase.from('tyre_service_events').select(COLS)
    if (eventType && EVENT_TYPES.includes(eventType)) q = q.eq('event_type', eventType)
    q = applyCountry(q, country)
    return unwrap(await q.order('event_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(limit)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Create a service event. Requires a tyre serial or an asset number. */
export async function createServiceEvent(values = {}) {
  const tyreSerial = cleanText(values.tyre_serial, 100)
  const assetNo = cleanText(values.asset_no, 100)
  if (!tyreSerial && !assetNo) {
    throw new Error('Provide a tyre serial or an asset number.')
  }
  const eventType = EVENT_TYPES.includes(values.event_type) ? values.event_type : 'inspection'
  const payload = {
    tyre_serial: tyreSerial,
    asset_no: assetNo,
    position: cleanText(values.position, 60),
    event_type: eventType,
    event_date: values.event_date || null,
    tread_depth: toNumberOrNull(values.tread_depth),
    pressure: toNumberOrNull(values.pressure),
    cost: toNumberOrNull(values.cost),
    technician: cleanText(values.technician, 120),
    site: cleanText(values.site, 120),
    notes: cleanText(values.notes, 4000),
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('tyre_service_events').insert(payload).select(COLS).single())
}

/** Patch a service event. Immutable/ownership columns are stripped. */
export async function updateServiceEvent(id, patch = {}) {
  if (!id) throw new Error('A service event id is required.')
  const clean = {}
  if ('tyre_serial' in patch) clean.tyre_serial = cleanText(patch.tyre_serial, 100)
  if ('asset_no' in patch) clean.asset_no = cleanText(patch.asset_no, 100)
  if ('position' in patch) clean.position = cleanText(patch.position, 60)
  if ('event_type' in patch) {
    clean.event_type = EVENT_TYPES.includes(patch.event_type) ? patch.event_type : 'inspection'
  }
  if ('event_date' in patch) clean.event_date = patch.event_date || null
  if ('tread_depth' in patch) clean.tread_depth = toNumberOrNull(patch.tread_depth)
  if ('pressure' in patch) clean.pressure = toNumberOrNull(patch.pressure)
  if ('cost' in patch) clean.cost = toNumberOrNull(patch.cost)
  if ('technician' in patch) clean.technician = cleanText(patch.technician, 120)
  if ('site' in patch) clean.site = cleanText(patch.site, 120)
  if ('notes' in patch) clean.notes = cleanText(patch.notes, 4000)
  if ('country' in patch) clean.country = patch.country ?? null

  return unwrap(await supabase.from('tyre_service_events').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteServiceEvent(id) {
  if (!id) throw new Error('A service event id is required.')
  return unwrap(await supabase.from('tyre_service_events').delete().eq('id', id))
}
