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
import { supabase, applyCountry, fetchAllPages, fetchAllOrThrow, isMissingRelation, ServiceError } from './_client'
import { toUserMessage } from '../safeError'

export const SHIFT_COLS =
  'id,person_name,role,shift_date,start_time,end_time,site,status,country'

export const ATTENDANCE_COLS =
  'id,user_id,shift_id,check_in,check_out,site,country,created_at'

export const STAFF_COLS = 'id,full_name,employee_id,role,site'


/** Load rostered shifts in [from,to], optionally scoped by site + country. */
async function loadShifts({ from, to, site, country }) {
  try {
    // Paged: `.limit(20000)` was not a bound - the server caps every response at
    // 1,000 rows, so a month of rostered shifts past that silently vanished and
    // those people could never read as absent. The id tiebreak keeps pages stable
    // (many shifts share a shift_date).
    return await fetchAllOrThrow((pFrom, pTo) => {
      let q = supabase.from('shifts').select(SHIFT_COLS)
      q = applyCountry(q, country)
      if (from) q = q.gte('shift_date', String(from).slice(0, 10))
      if (to) q = q.lte('shift_date', String(to).slice(0, 10))
      if (site && site !== 'All') q = q.eq('site', site)
      return q.order('shift_date', { ascending: true }).order('id', { ascending: true }).range(pFrom, pTo)
    }, { pageSize: 1000, max: 20000 })
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
    // check_in is a UTC instant while the window is in the site's local days
    // (KSA/UAE/Egypt are UTC+2..+4), so the bounds are widened by one day each
    // side. The engine matches each check-in to its rostered shift, so the extra
    // rows never count on their own.
    const lo = shiftDay(from, -1)
    if (lo) q = q.gte('check_in', lo)
    const hi = shiftDay(to, 2)
    if (hi) q = q.lt('check_in', hi)
    if (site && site !== 'All') q = q.eq('site', site)
    return q.order('check_in', { ascending: false }).order('id', { ascending: true }).range(pFrom, pTo)
  }
  try {
    const { data, error } = await fetchAllPages(pageFn, { pageSize: 1000, max: 20000 })
    if (error) throw new ServiceError(toUserMessage(error), error.code, error)
    return data || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** YYYY-MM-DD `days` after the given date (UTC arithmetic, no timezone drift), or null. */
export function shiftDay(value, days) {
  if (!value) return null
  const d = new Date(`${String(value).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Load the staff directory (RLS-scoped). Never country-filtered (text[]). */
async function loadStaff() {
  try {
    // Paged: `.limit(5000)` was not a bound - the server caps every response
    // at 1,000, so staff past it silently vanished from the absence roster.
    return await fetchAllOrThrow((from, to) => supabase
      .from('profiles').select(STAFF_COLS).order('id').range(from, to), { max: 20000 })
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
