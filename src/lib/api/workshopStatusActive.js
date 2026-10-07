/**
 * Workshop Status -> Active Vehicles reads (Loop 7).
 *
 * Read-only. Everything goes through RLS (org, country and site isolation plus
 * the workshop view permission), so a country-less read returns only the
 * countries the caller may see. Writes stay in workshopStatus.js / the update
 * drawer service; this file never mutates.
 *
 * Every read pages past the 1000-row server cap with fetchAllPages and an `id`
 * tiebreak so a page boundary can never drop or repeat a row.
 */
import { supabase, fetchAllPages, toServiceError } from './_client'
import { RECORD_COLS } from './workshopStatus'

const MAX_ROWS = 20000
const LOOKUP_CHUNK = 200

const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '')

/** Distinct, non-blank values, in first-seen order. */
function uniqueIds(values) {
  const out = []
  const seen = new Set()
  for (const v of values || []) {
    if (blank(v)) continue
    const s = String(v)
    if (!seen.has(s)) { seen.add(s); out.push(s) }
  }
  return out
}

function chunks(list, size) {
  const out = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/**
 * Active (current report) records. `country` blank or 'All' = every country the
 * caller may see (RLS decides); otherwise that country only.
 *
 * @returns {Promise<{ rows: object[], truncated: boolean }>}
 */
export async function listActiveVehicles({ country } = {}) {
  const c = blank(country) || country === 'All' ? null : String(country).trim()
  const { data, error, truncated } = await fetchAllPages((from, to) => {
    let q = supabase
      .from('workshop_status_records')
      .select(RECORD_COLS)
      .eq('current_active', true)
      .is('deleted_at', null)
    if (c) q = q.eq('country', c)
    return q
      .order('asset_no', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  }, { max: MAX_ROWS })
  if (error) throw toServiceError(error, 'Could not load the workshop vehicles.')
  return { rows: data || [], truncated: Boolean(truncated) }
}

/**
 * Display names for the given profile ids: Map(id -> name). Best effort: a
 * failed read returns an empty map so the list still renders (the cell then
 * reads "Not assigned"/unknown rather than breaking the screen).
 */
export async function loadPeopleNames(ids) {
  const list = uniqueIds(ids)
  const out = new Map()
  if (!list.length) return out
  for (const part of chunks(list, LOOKUP_CHUNK)) {
    const { data, error } = await fetchAllPages((from, to) =>
      supabase
        .from('profiles')
        .select('id,full_name,username')
        .in('id', part)
        .order('id', { ascending: true })
        .range(from, to), { max: LOOKUP_CHUNK })
    if (error) return out
    for (const p of data || []) {
      const name = (p.full_name && String(p.full_name).trim()) || (p.username && String(p.username).trim()) || null
      if (name) out.set(String(p.id), name)
    }
  }
  return out
}

/**
 * Upload register entries for the given ids: Map(id -> { upload_no, uploaded_at,
 * confirmed_at }). Best effort like loadPeopleNames.
 */
export async function loadUploadsById(ids) {
  const list = uniqueIds(ids)
  const out = new Map()
  if (!list.length) return out
  for (const part of chunks(list, LOOKUP_CHUNK)) {
    const { data, error } = await fetchAllPages((from, to) =>
      supabase
        .from('workshop_status_uploads')
        .select('id,upload_no,uploaded_at,confirmed_at,report_date')
        .in('id', part)
        .order('id', { ascending: true })
        .range(from, to), { max: LOOKUP_CHUNK })
    if (error) return out
    for (const u of data || []) out.set(String(u.id), u)
  }
  return out
}

/**
 * The full Active Vehicles payload: records plus the responsible-person names
 * and the last Excel upload of each record, joined client-side.
 *
 * @returns {Promise<{ rows: object[], truncated: boolean }>}
 */
export async function loadActiveVehicles({ country } = {}) {
  const { rows, truncated } = await listActiveVehicles({ country })
  const [people, uploads] = await Promise.all([
    loadPeopleNames(rows.flatMap((r) => [r.responsible_user_id, r.supporting_user_id])),
    loadUploadsById(rows.map((r) => r.last_seen_upload_id)),
  ])
  const enriched = rows.map((r) => ({
    ...r,
    responsible_name: r.responsible_user_id ? people.get(String(r.responsible_user_id)) || null : null,
    supporting_name: r.supporting_user_id ? people.get(String(r.supporting_user_id)) || null : null,
    last_upload: r.last_seen_upload_id ? uploads.get(String(r.last_seen_upload_id)) || null : null,
  }))
  return { rows: enriched, truncated }
}
