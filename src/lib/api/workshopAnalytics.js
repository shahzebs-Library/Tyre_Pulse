/**
 * Workshop Analytics (history / trends) service. Read-only loader that gathers the
 * inputs the pure `workshopAnalytics` engine needs over a DATE RANGE:
 *   - events       tech_activity_events in [from,to] by `at` (the productivity log)
 *   - jobs         work_orders touched in the window (completed_at OR opened_at)
 *   - shifts       the roster, to reconstruct each day's on-duty window
 *   - technicians  the workshop roster (name -> user_id match for shifts + names)
 *
 * Conventions mirror workshopLive.js / workshopAbsence.js: explicit least-privilege
 * column lists, null-safe country scoping via applyCountry, scalar site filtering,
 * fetchAllPages for the potentially large event/job sets, and each read
 * []-degrades when its relation is not deployed yet so the page shows an honest
 * empty state instead of throwing.
 *
 * IMPORTANT: profiles.country is a text[] (V114) and is NEVER scalar-filtered here
 * - RLS is the authoritative country boundary for staff. We reuse listTechnicians
 * from the live service (single source for the roster).
 */
import { supabase, unwrap, applyCountry, fetchAllPages, isMissingRelation, ServiceError } from './_client'
import { toUserMessage } from '../safeError'
import { listTechnicians, EVENT_COLS as LIVE_EVENT_COLS, WO_COLS as LIVE_WO_COLS } from './workshopLive'

export const EVENT_COLS =
  'id,user_id,job_id,task_id,asset_no,event_type,reason_code,site,country,at'

export const WO_COLS =
  'id,work_order_no,asset_no,description,status,priority,work_type,technician_name,' +
  'assigned_owner_id,site,country,opened_at,started_at,completed_at,target_completion,' +
  'labour_hours,standard_hours,est_minutes,labour_rate,total_cost'

export const SHIFT_COLS =
  'id,person_name,role,shift_date,start_time,end_time,site,status,country'


/** Exclusive upper bound (day after `to`, YYYY-MM-DD) for an inclusive [from,to]. */
function dayAfter(to) {
  const d = new Date(String(to).slice(0, 10))
  if (Number.isNaN(d.getTime())) return null
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Load activity events in [from,to] by `at`. Paginated, country + site scoped. */
async function loadEvents({ from, to, site, country }) {
  const upper = to ? dayAfter(to) : null
  const pageFn = (pFrom, pTo) => {
    let q = supabase.from('tech_activity_events').select(EVENT_COLS)
    q = applyCountry(q, country)
    if (from) q = q.gte('at', String(from).slice(0, 10))
    if (upper) q = q.lt('at', upper)
    if (site && site !== 'All') q = q.eq('site', site)
    return q.order('at', { ascending: true }).order('id', { ascending: true }).range(pFrom, pTo)
  }
  try {
    const { data, error } = await fetchAllPages(pageFn, { pageSize: 1000, max: 100000 })
    if (error) throw new ServiceError(toUserMessage(error), error.code, error)
    return data || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Load work_orders that were completed OR opened within [from,to]. Two bounded
 * reads (one on completed_at, one on opened_at) merged + de-duped, so a job
 * completed in-range but opened long before is still counted, and vice versa.
 */
async function loadJobs({ from, to, site, country }) {
  const upper = to ? dayAfter(to) : null
  const readOn = async (col) => {
    const pageFn = (pFrom, pTo) => {
      let q = supabase.from('work_orders').select(WO_COLS)
      q = applyCountry(q, country)
      if (from) q = q.gte(col, String(from).slice(0, 10))
      if (upper) q = q.lt(col, upper)
      if (site && site !== 'All') q = q.eq('site', site)
      return q.order(col, { ascending: false }).order('id', { ascending: true }).range(pFrom, pTo)
    }
    const { data, error } = await fetchAllPages(pageFn, { pageSize: 1000, max: 100000 })
    if (error) throw new ServiceError(toUserMessage(error), error.code, error)
    return data || []
  }
  try {
    const [completed, opened] = await Promise.all([
      readOn('completed_at').catch((e) => { if (isMissingRelation(e)) return []; throw e }),
      readOn('opened_at').catch((e) => { if (isMissingRelation(e)) return []; throw e }),
    ])
    const byId = new Map()
    for (const r of [...completed, ...opened]) if (r?.id != null) byId.set(r.id, r)
    return [...byId.values()]
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Load rostered shifts overlapping [from,to]. Country + site scoped. []-degrades. */
async function loadShifts({ from, to, site, country }) {
  try {
    let q = supabase.from('shifts').select(SHIFT_COLS)
    q = applyCountry(q, country)
    if (from) q = q.gte('shift_date', String(from).slice(0, 10))
    if (to) q = q.lte('shift_date', String(to).slice(0, 10))
    if (site && site !== 'All') q = q.eq('site', site)
    return unwrap(await q.order('shift_date', { ascending: true }).limit(20000)) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Load everything the workshop history report needs in one call. Each sub-read
 * degrades to [] independently, so a missing table never sinks the whole load.
 *
 * @param {{ from?:string, to?:string, site?:string, country?:string }} [opts]
 * @returns {Promise<{ events:object[], jobs:object[], shifts:object[], technicians:object[] }>}
 */
export async function loadWorkshopHistory({ from, to, site, country } = {}) {
  const [events, jobs, shifts, technicians] = await Promise.all([
    loadEvents({ from, to, site, country }),
    loadJobs({ from, to, site, country }),
    loadShifts({ from, to, site, country }),
    listTechnicians({ site, country }).catch(() => []),
  ])
  return { events, jobs, shifts, technicians }
}

/** Distinct non-empty site values across the loaded rows (sorted). */
export function distinctSites(events, jobs, shifts) {
  const set = new Set()
  for (const rows of [events, jobs, shifts]) {
    for (const r of Array.isArray(rows) ? rows : []) {
      const v = r && r.site
      if (v != null && String(v).trim() !== '') set.add(String(v).trim())
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b))
}

// ── Workshop Live Control date range ─────────────────────────────────────────

/** Events past this many rows in one range are not read; the page says so. */
export const RANGE_EVENT_MAX = 50000
/** Completed job cards past this many rows in one range are not read. */
export const RANGE_JOB_MAX = 20000

/** Local-midnight ISO instant for a YYYY-MM-DD key (the live board's day edge). */
function localMidnightIso(key, addDays = 0) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || '').slice(0, 10))
  if (!m) return null
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + addDays).toISOString()
}

/**
 * Raw rows for the Workshop Live measured strip over a LOCAL [from,to] day range:
 *   - events          tech_activity_events with `at` inside the range (paged, id tiebreak)
 *   - completedJobs   work_orders completed inside the range (paged, id tiebreak)
 *   - shifts          the roster for those days (to rebuild each day's duty window)
 * The technician roster is NOT re-read: the page passes the live board's roster
 * so the range and the live view measure the same people. Day edges are LOCAL
 * midnight, matching the live board's "today". Each read []-degrades when its
 * relation is missing; a real error throws a sanitised ServiceError.
 *
 * @param {{ from:string, to:string, site?:string, country?:string }} opts
 * @returns {Promise<{ events:object[], completedJobs:object[], shifts:object[],
 *   eventsTruncated:boolean, jobsTruncated:boolean }>}
 */
export async function loadRangeActivity({ from, to, site, country } = {}) {
  const lo = localMidnightIso(from)
  const hi = localMidnightIso(to, 1)
  if (!lo || !hi) return { events: [], completedJobs: [], shifts: [], eventsTruncated: false, jobsTruncated: false }

  const readEvents = async () => {
    const pageFn = (pFrom, pTo) => {
      let q = supabase.from('tech_activity_events').select(LIVE_EVENT_COLS).gte('at', lo).lt('at', hi)
      q = applyCountry(q, country)
      if (site && site !== 'All') q = q.eq('site', site)
      return q.order('at', { ascending: true }).order('id', { ascending: true }).range(pFrom, pTo)
    }
    try {
      const { data, error, truncated } = await fetchAllPages(pageFn, { pageSize: 1000, max: RANGE_EVENT_MAX })
      if (error) throw new ServiceError(toUserMessage(error), error.code, error)
      return { rows: data || [], truncated: !!truncated }
    } catch (err) {
      if (isMissingRelation(err)) return { rows: [], truncated: false }
      throw err
    }
  }

  const readCompleted = async () => {
    const pageFn = (pFrom, pTo) => {
      let q = supabase.from('work_orders').select(LIVE_WO_COLS)
        .in('status', ['Completed', 'completed', 'Closed', 'closed'])
        .gte('completed_at', lo).lt('completed_at', hi)
      q = applyCountry(q, country)
      if (site && site !== 'All') q = q.eq('site', site)
      return q.order('completed_at', { ascending: false }).order('id', { ascending: true }).range(pFrom, pTo)
    }
    try {
      const { data, error, truncated } = await fetchAllPages(pageFn, { pageSize: 1000, max: RANGE_JOB_MAX })
      if (error) throw new ServiceError(toUserMessage(error), error.code, error)
      return { rows: data || [], truncated: !!truncated }
    } catch (err) {
      if (isMissingRelation(err)) return { rows: [], truncated: false }
      throw err
    }
  }

  const [ev, jobs, shifts] = await Promise.all([
    readEvents(),
    readCompleted(),
    loadShifts({ from, to, site, country }),
  ])
  return {
    events: ev.rows,
    completedJobs: jobs.rows,
    shifts,
    eventsTruncated: ev.truncated,
    jobsTruncated: jobs.truncated,
  }
}
