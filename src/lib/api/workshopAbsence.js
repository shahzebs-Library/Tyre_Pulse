/**
 * Workshop Absence & Attendance service. Read-only loader that gathers the three
 * inputs the pure `workshopAbsence` engine needs:
 *   - shifts             the roster (who was scheduled, when, where)
 *   - workshop_attendance the check-in / check-out evidence (V291)
 *   - profiles           staff directory, to resolve an attendance user_id to a
 *                        person name for the roster match
 *
 * Conventions mirror shifts.js / washRecords.js: explicit least-privilege column
 * lists, null-safe country scoping via applyCountry, scalar site filtering, and
 * each read []-degrades when its relation is not deployed yet (so the page shows
 * an honest empty state rather than throwing).
 *
 * IMPORTANT: profiles.country is a text[] (V114) and is NEVER scalar-filtered
 * here - RLS is the authoritative country boundary for staff. We scope shifts /
 * attendance by their scalar country column only.
 */
import { supabase, unwrap, applyCountry, fetchAllPages } from './_client'

export const SHIFT_COLS =
  'id,person_name,role,shift_date,start_time,end_time,site,status,country'

export const ATTENDANCE_COLS =
  'id,user_id,shift_id,check_in,check_out,site,country,created_at'

export const STAFF_COLS = 'id,full_name,employee_id,role,site'

/** True when a Supabase error means the table/relation is not deployed yet. */
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return (
    m.includes('does not exist') ||
    m.includes('relation') ||
    m.includes('schema cache') ||
    m.includes('could not find the table')
  )
}

/** Load rostered shifts in [from,to], optionally scoped by site + country. */
async function loadShifts({ from, to, site, country }) {
  try {
    let q = supabase.from('shifts').select(SHIFT_COLS)
    q = applyCountry(q, country)
    if (from) q = q.gte('shift_date', String(from).slice(0, 10))
    if (to) q = q.lte('shift_date', String(to).slice(0, 10))
    if (site && site !== 'All') q = q.eq('site', site)
    return (
      unwrap(await q.order('shift_date', { ascending: true }).limit(20000)) || []
    )
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Load attendance evidence overlapping [from,to]. Bounded on the check_in date so
 * the set stays small; paginated for safety. Scoped by site + country.
 */
async function loadAttendance({ from, to, site, country }) {
  const pageFn = (pFrom, pTo) => {
    let q = supabase.from('workshop_attendance').select(ATTENDANCE_COLS)
    q = applyCountry(q, country)
    if (from) q = q.gte('check_in', String(from).slice(0, 10))
    // Inclusive upper bound: strictly-less-than the day after `to`.
    if (to) {
      const d = new Date(String(to).slice(0, 10))
      if (!Number.isNaN(d.getTime())) {
        d.setDate(d.getDate() + 1)
        q = q.lt('check_in', d.toISOString().slice(0, 10))
      }
    }
    if (site && site !== 'All') q = q.eq('site', site)
    return q.order('check_in', { ascending: false }).range(pFrom, pTo)
  }
  try {
    const { data, error } = await fetchAllPages(pageFn, { pageSize: 1000, max: 20000 })
    if (error) throw error
    return data || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Load the staff directory (RLS-scoped). Never country-filtered (text[]). */
async function loadStaff() {
  try {
    return (
      unwrap(await supabase.from('profiles').select(STAFF_COLS).limit(5000)) || []
    )
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Load everything the absence report needs in one call. Each sub-read degrades to
 * [] independently, so a missing attendance table still lets the roster render.
 *
 * @param {{ from?:string, to?:string, site?:string, country?:string }} [opts]
 * @returns {Promise<{ shifts:object[], attendance:object[], staff:object[] }>}
 */
export async function loadAbsenceData({ from, to, site, country } = {}) {
  const [shifts, attendance, staff] = await Promise.all([
    loadShifts({ from, to, site, country }),
    loadAttendance({ from, to, site, country }),
    loadStaff(),
  ])
  return { shifts, attendance, staff }
}

/**
 * Enrich attendance rows with a resolved `person_name` from the staff directory
 * (attendance carries only user_id). Returns a new array; rows without a known
 * user keep their existing person_name (usually undefined) so the engine falls
 * back to shift_id matching for them.
 *
 * @param {object[]} attendance
 * @param {object[]} staff  profiles rows (id, full_name)
 */
export function enrichAttendanceWithNames(attendance, staff) {
  const byId = new Map()
  for (const p of Array.isArray(staff) ? staff : []) {
    if (p && p.id != null) byId.set(String(p.id), p.full_name || p.employee_id || '')
  }
  return (Array.isArray(attendance) ? attendance : []).map((a) => {
    if (!a) return a
    const name = a.user_id != null ? byId.get(String(a.user_id)) : ''
    return name ? { ...a, person_name: name } : a
  })
}

/** Distinct non-empty site values across shifts + attendance (sorted). */
export function distinctSites(shifts, attendance) {
  const set = new Set()
  for (const arr of [shifts, attendance]) {
    for (const r of Array.isArray(arr) ? arr : []) {
      const v = r && r.site
      if (v != null && String(v).trim() !== '') set.add(String(v).trim())
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}
