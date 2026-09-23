/**
 * Shifts service (V149) — driver / technician shift roster: person, role, shift
 * date, start/end times, site, and a status lifecycle (scheduled → completed /
 * absent / cancelled). RLS enforces org isolation; any authenticated member may
 * read and maintain the roster. This layer keeps an explicit column list
 * (least-privilege select) and null-safe country scoping, mirroring
 * batteries.js / support.js.
 *
 * Read failures propagate so unavailable data is not presented as an empty list.
 */
import { supabase, unwrap, applyCountry, isMissingRelation, fetchAllPages } from './_client'

export const COLS =
  'id,organisation_id,country,person_name,role,shift_date,start_time,end_time,' +
  'site,status,notes,created_by,created_at,updated_at'

export const SHIFT_STATUS_VALUES = ['scheduled', 'completed', 'absent', 'cancelled']


/**
 * List shifts (upcoming first: by shift_date desc, then created_at desc).
 * Optional country / status filters. Read failures propagate to the page.
 */
export async function listShifts({ country, status } = {}) {
  const result = await fetchAllPages((from, to) => {
    let q = supabase.from('shifts').select(COLS)
    if (status) q = q.eq('status', status)
    return applyCountry(q, country).order('shift_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }).order('id').range(from, to)
  }, { max: 50000 })
  if (result.truncated) throw new Error('Too many shifts to load completely. Narrow the country selection.')
  return unwrap(result) || []
}

export async function getShift(id) {
  return unwrap(await supabase.from('shifts').select(COLS).eq('id', id).maybeSingle())
}

/** Create a shift. Requires a person_name. */
export async function createShift(values = {}) {
  const personName = String(values.person_name || '').trim()
  if (!personName) throw new Error('A person name is required.')
  const status = SHIFT_STATUS_VALUES.includes(values.status) ? values.status : 'scheduled'
  const payload = {
    person_name: personName.slice(0, 160),
    role: values.role ? String(values.role).slice(0, 120) : null,
    shift_date: values.shift_date || null,
    start_time: values.start_time ? String(values.start_time).slice(0, 20) : null,
    end_time: values.end_time ? String(values.end_time).slice(0, 20) : null,
    site: values.site ? String(values.site).slice(0, 120) : null,
    status,
    notes: values.notes ? String(values.notes).slice(0, 4000) : null,
    country: values.country ?? null,
  }
  return unwrap(await supabase.from('shifts').insert(payload).select(COLS).single())
}

/** Patch a shift. Immutable columns are stripped before update. */
export async function updateShift(id, patch = {}) {
  const clean = { ...patch }
  delete clean.id
  delete clean.created_at
  delete clean.created_by
  delete clean.organisation_id
  delete clean.updated_at
  if (clean.status != null && !SHIFT_STATUS_VALUES.includes(clean.status)) delete clean.status
  if (clean.person_name != null) {
    const n = String(clean.person_name).trim()
    if (!n) throw new Error('A person name is required.')
    clean.person_name = n.slice(0, 160)
  }
  if (clean.role != null) clean.role = String(clean.role).slice(0, 120) || null
  if (clean.site != null) clean.site = String(clean.site).slice(0, 120) || null
  if (clean.start_time != null) clean.start_time = String(clean.start_time).slice(0, 20) || null
  if (clean.end_time != null) clean.end_time = String(clean.end_time).slice(0, 20) || null
  if (clean.notes != null) clean.notes = String(clean.notes).slice(0, 4000) || null
  return unwrap(await supabase.from('shifts').update(clean).eq('id', id).select(COLS).single())
}

export async function deleteShift(id) {
  return unwrap(await supabase.from('shifts').delete().eq('id', id))
}
