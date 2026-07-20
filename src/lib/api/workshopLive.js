/**
 * Workshop Live Control service (V291) - the data layer for the live technician
 * board, task assignment and activity logging. It returns RAW rows only; the
 * maths (segments, status, KPIs, alerts, delay rollups) live in the pure engine
 * `src/lib/workshopLive.js`, reused by web, mobile and reports so the logic sits
 * in one place.
 *
 * RLS enforces org + country + site isolation server-side; organisation_id and
 * country default via DB triggers, so inserts here NEVER set organisation_id.
 * This layer keeps explicit least-privilege column lists and null-safe country
 * scoping, mirroring pmPrograms.js / workOrders.js / shifts.js. Every lister
 * degrades to [] on a missing relation so the page can prompt for the migration
 * instead of throwing.
 */
import { supabase, unwrap, applyCountry, ServiceError } from './_client'
import { EVENT_TYPES } from '../workshopLive'

// ── Column lists (least-privilege selects) ─────────────────────────────────────

/** profiles subset used to build the technician roster. */
export const PROFILE_COLS = 'id,full_name,username,employee_id,role,site,country,avatar_url,phone'

/** work_orders incl. the V291 workshop-live columns. */
export const WO_COLS =
  'id,work_order_no,asset_no,description,status,priority,work_type,technician_name,' +
  'workshop_name,site,country,opened_at,started_at,completed_at,target_completion,' +
  'labour_hours,standard_hours,est_minutes,assigned_owner_id,qc_status,vor,vor_since,' +
  'total_cost,created_at'

export const TASK_COLS =
  'id,organisation_id,country,site,job_id,seq,title,skill,est_minutes,status,' +
  'assignee_user_id,created_by,created_at,updated_at'

export const ASSIGNMENT_COLS =
  'id,organisation_id,country,site,job_id,task_id,user_id,role,active,' +
  'assigned_by,assigned_at,released_at'

export const EVENT_COLS =
  'id,organisation_id,country,site,user_id,job_id,task_id,asset_no,event_type,' +
  'reason_code,note,device,gps_lat,gps_lng,foreman_confirmed,confirmed_by,at,created_by'

const ATTENDANCE_COLS = 'id,user_id,shift_id,check_in,check_out,source,site'

// ── Controlled vocabularies (mirror the DB CHECK constraints) ──────────────────

export const WORKSHOP_ROLES = Object.freeze(['Technician', 'Tyre Man', 'Mechanic', 'Foreman'])
export const TASK_STATUS = Object.freeze(['pending', 'in_progress', 'blocked', 'done', 'qc'])
export const ASSIGNMENT_ROLES = Object.freeze(['primary', 'helper'])

// ── Internal helpers ───────────────────────────────────────────────────────────

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

/** Coerce a value to a finite number or null (empty string / null / NaN -> null). */
function numOrNull(v) {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** Normalize a status token: lowercase, spaces -> underscores. */
function normStatus(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, '_')
}

/** The signed-in user id, or null (never throws). */
async function currentUserId() {
  try {
    const { data } = await supabase.auth.getUser()
    return data?.user?.id || null
  } catch {
    return null
  }
}

/** ISO timestamp for local midnight today (start of the activity window). */
function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

/** Today's date as YYYY-MM-DD (for shift_date matching). */
function todayDate() {
  return new Date().toISOString().slice(0, 10)
}

/** Build a parseable ISO-ish timestamp from a shift date + HH:MM(:SS) time. */
function shiftTimestamp(date, time) {
  if (!date || !time) return null
  const t = String(time).trim()
  const hhmmss = /^\d{1,2}:\d{2}(:\d{2})?$/.test(t) ? (t.length === 5 ? `${t}:00` : t) : null
  if (!hhmmss) return null
  return `${date}T${hhmmss}`
}

/** Group rows into { [key]: rows[] }. */
function groupBy(rows, key) {
  const out = {}
  for (const r of rows || []) {
    const k = r?.[key]
    if (k == null) continue
    ;(out[k] = out[k] || []).push(r)
  }
  return out
}

/** Index rows into { [key]: row } (last write wins). */
function keyBy(rows, key) {
  const out = {}
  for (const r of rows || []) {
    const k = r?.[key]
    if (k != null) out[k] = r
  }
  return out
}

// ── Technicians ────────────────────────────────────────────────────────────────

function mapTechnician(r) {
  return {
    id: r.id,
    full_name: r.full_name || r.username || null,
    employee_id: r.employee_id || null,
    role: r.role || null,
    site: r.site || null,
    avatar_url: r.avatar_url || null,
    phone: r.phone || null,
  }
}

/**
 * List workshop staff: anyone whose role is a workshop role OR who has at least
 * one technician_skills row. Country scoping is left to server-side RLS because
 * profiles.country is a text[] (a scalar OR-filter would be wrong); site (scalar)
 * is applied when given. Degrades to [] when profiles is unreadable.
 * @param {{ site?:string, country?:string }} [opts]
 * @returns {Promise<Array<{id,full_name,employee_id,role,site,avatar_url,phone}>>}
 */
export async function listTechnicians({ site } = {}) {
  const byId = new Map()

  // 1. Role-based workshop staff.
  try {
    let q = supabase.from('profiles').select(PROFILE_COLS).in('role', WORKSHOP_ROLES)
    if (site) q = q.eq('site', site)
    const rows = unwrap(await q) || []
    for (const r of rows) if (r?.id) byId.set(r.id, mapTechnician(r))
  } catch (err) {
    if (!isMissingRelation(err)) throw err
  }

  // 2. Anyone with a technician_skills row (may hold a non-workshop title).
  try {
    const skills = unwrap(await supabase.from('technician_skills').select('user_id')) || []
    const ids = [...new Set(skills.map((s) => s.user_id).filter(Boolean))].filter((id) => !byId.has(id))
    if (ids.length) {
      let q = supabase.from('profiles').select(PROFILE_COLS).in('id', ids)
      if (site) q = q.eq('site', site)
      const rows = unwrap(await q) || []
      const wanted = new Set(ids)
      for (const r of rows) if (r?.id && wanted.has(r.id)) byId.set(r.id, mapTechnician(r))
    }
  } catch (err) {
    if (!isMissingRelation(err)) throw err
  }

  return [...byId.values()]
}

// ── Jobs (work_orders) ─────────────────────────────────────────────────────────

/**
 * List open jobs: work_orders whose status is not completed/cancelled.
 * Country-scoped (null-safe) and optionally filtered by site. []-degrades.
 * @param {{ site?:string, country?:string, limit?:number }} [opts]
 */
export async function listOpenJobs({ site, country, limit = 500 } = {}) {
  try {
    let q = supabase.from('work_orders').select(WO_COLS)
    if (site) q = q.eq('site', site)
    q = applyCountry(q, country)
    const rows = unwrap(await q.order('opened_at', { ascending: false, nullsFirst: false }).limit(limit)) || []
    const closed = new Set(['completed', 'cancelled'])
    return rows.filter((r) => !closed.has(normStatus(r.status)))
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Set a job's status. Returns the updated row. */
export async function setJobStatus(jobId, status) {
  if (!jobId) throw new ServiceError('A job is required.')
  return unwrap(await supabase.from('work_orders').update({ status }).eq('id', jobId).select(WO_COLS).single())
}

/** Set a job's priority. Returns the updated row. */
export async function setJobPriority(jobId, priority) {
  if (!jobId) throw new ServiceError('A job is required.')
  return unwrap(await supabase.from('work_orders').update({ priority }).eq('id', jobId).select(WO_COLS).single())
}

/** Flag / clear a job as Vehicle Off Road; stamps vor_since when turned on. */
export async function setVor(jobId, on) {
  if (!jobId) throw new ServiceError('A job is required.')
  const patch = on ? { vor: true, vor_since: new Date().toISOString() } : { vor: false, vor_since: null }
  return unwrap(await supabase.from('work_orders').update(patch).eq('id', jobId).select(WO_COLS).single())
}

// ── Tasks (wo_tasks) ─────────────────────────────────────────────────────────

/** List a job's tasks (by seq asc). []-degrades. */
export async function listTasks(jobId) {
  if (!jobId) return []
  try {
    return (
      unwrap(
        await supabase
          .from('wo_tasks')
          .select(TASK_COLS)
          .eq('job_id', jobId)
          .order('seq', { ascending: true, nullsFirst: true }),
      ) || []
    )
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Create a task under a job. Requires a title. Returns the inserted row. */
export async function createTask(jobId, { title, skill, est_minutes, seq, assignee_user_id } = {}) {
  if (!jobId) throw new ServiceError('A job is required to add a task.')
  const t = String(title || '').trim()
  if (!t) throw new ServiceError('A task title is required.')
  const payload = {
    job_id: jobId,
    title: t.slice(0, 200),
    skill: skill ? String(skill).slice(0, 120) : null,
    est_minutes: numOrNull(est_minutes),
    seq: numOrNull(seq),
    assignee_user_id: assignee_user_id || null,
    status: 'pending',
  }
  return unwrap(await supabase.from('wo_tasks').insert(payload).select(TASK_COLS).single())
}

/** Patch a task. Immutable / structural columns are stripped before update. */
export async function updateTask(id, patch = {}) {
  const clean = { ...patch }
  for (const k of ['id', 'created_at', 'created_by', 'organisation_id', 'updated_at', 'job_id']) delete clean[k]
  if (clean.status != null && !TASK_STATUS.includes(clean.status)) delete clean.status
  if ('est_minutes' in clean) clean.est_minutes = numOrNull(clean.est_minutes)
  if ('seq' in clean) clean.seq = numOrNull(clean.seq)
  if (clean.title != null) {
    const t = String(clean.title).trim()
    if (!t) throw new ServiceError('A task title is required.')
    clean.title = t.slice(0, 200)
  }
  if (clean.skill != null) clean.skill = String(clean.skill).slice(0, 120) || null
  return unwrap(await supabase.from('wo_tasks').update(clean).eq('id', id).select(TASK_COLS).single())
}

/** Set a task's status (validated against TASK_STATUS). Returns the updated row. */
export async function setTaskStatus(id, status) {
  if (!TASK_STATUS.includes(status)) throw new ServiceError('Unknown task status.')
  return unwrap(await supabase.from('wo_tasks').update({ status }).eq('id', id).select(TASK_COLS).single())
}

// ── Assignments (wo_assignments) ───────────────────────────────────────────────

/** List assignments (active-only by default). Country-scoped. []-degrades. */
export async function listAssignments({ active = true, site, country } = {}) {
  try {
    let q = supabase.from('wo_assignments').select(ASSIGNMENT_COLS)
    if (active != null) q = q.eq('active', active)
    if (site) q = q.eq('site', site)
    q = applyCountry(q, country)
    return unwrap(await q.order('assigned_at', { ascending: false })) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/**
 * Best-effort: stamp the job's owner + technician name, and move a brand-new /
 * awaiting job to 'assigned'. Never throws (the assignment row is authoritative).
 */
async function stampJobOwner(jobId, userId) {
  const patch = { assigned_owner_id: userId }
  try {
    const prof = unwrap(
      await supabase.from('profiles').select('full_name,username').eq('id', userId).maybeSingle(),
    )
    const techName = prof?.full_name || prof?.username || null
    if (techName) patch.technician_name = techName
  } catch {
    // Name lookup is optional; the owner id below is the important part.
  }
  try {
    const job = unwrap(await supabase.from('work_orders').select('status').eq('id', jobId).maybeSingle())
    const st = normStatus(job?.status)
    if (st === '' || st === 'new' || st === 'awaiting_assignment' || st === 'open') patch.status = 'assigned'
  } catch {
    // If the status read fails we still set the owner without moving status.
  }
  await supabase.from('work_orders').update(patch).eq('id', jobId)
}

/**
 * Assign a technician to a job (and optionally a specific task). Inserts a
 * wo_assignments row, then best-effort stamps work_orders.assigned_owner_id +
 * technician_name and promotes a new/awaiting job to 'assigned'. The stamp is
 * fully swallowed on error so the assignment always succeeds. Returns the row.
 */
export async function assignJob({ job_id, task_id = null, user_id, role = 'primary' } = {}) {
  if (!job_id) throw new ServiceError('A job is required to assign.')
  if (!user_id) throw new ServiceError('A technician is required to assign.')
  const validRole = ASSIGNMENT_ROLES.includes(role) ? role : 'primary'
  const assignedBy = await currentUserId()
  const payload = {
    job_id,
    task_id: task_id || null,
    user_id,
    role: validRole,
    active: true,
    assigned_by: assignedBy,
  }
  const row = unwrap(await supabase.from('wo_assignments').insert(payload).select(ASSIGNMENT_COLS).single())
  try {
    await stampJobOwner(job_id, user_id)
  } catch {
    // Owner stamp is a convenience; the assignment row already committed.
  }
  return row
}

/** Release an assignment (active=false, released_at=now). Returns the row. */
export async function releaseAssignment(id) {
  if (!id) throw new ServiceError('An assignment is required.')
  return unwrap(
    await supabase
      .from('wo_assignments')
      .update({ active: false, released_at: new Date().toISOString() })
      .eq('id', id)
      .select(ASSIGNMENT_COLS)
      .single(),
  )
}

/**
 * Reassign a job from one technician to another: release the old active
 * assignment(s) for that job (optionally scoped to from_user_id), then create a
 * fresh assignment for the new technician. Returns the new assignment row.
 */
export async function reassignJob({ job_id, from_user_id, to_user_id, role = 'primary' } = {}) {
  if (!job_id) throw new ServiceError('A job is required to reassign.')
  if (!to_user_id) throw new ServiceError('A new technician is required to reassign.')
  let q = supabase
    .from('wo_assignments')
    .update({ active: false, released_at: new Date().toISOString() })
    .eq('job_id', job_id)
    .eq('active', true)
  if (from_user_id) q = q.eq('user_id', from_user_id)
  await q
  return assignJob({ job_id, user_id: to_user_id, role })
}

// ── Activity events (tech_activity_events) ─────────────────────────────────────

/**
 * Record a technician activity event. `user_id` is optional (falls back to the
 * signed-in user); a foreman passes it explicitly to log for someone else.
 * event_type is validated against the engine's EVENT_TYPES. Returns the row.
 */
export async function recordEvent({
  user_id,
  job_id,
  task_id,
  asset_no,
  event_type,
  reason_code,
  note,
  device,
  gps_lat,
  gps_lng,
} = {}) {
  if (!EVENT_TYPES.includes(event_type)) throw new ServiceError('Unknown activity type.')
  const uid = user_id || (await currentUserId())
  const payload = {
    user_id: uid || null,
    job_id: job_id || null,
    task_id: task_id || null,
    asset_no: asset_no ? String(asset_no).slice(0, 120) : null,
    event_type,
    reason_code: reason_code ? String(reason_code).slice(0, 60) : null,
    note: note ? String(note).slice(0, 2000) : null,
    device: device ? String(device).slice(0, 120) : null,
    gps_lat: numOrNull(gps_lat),
    gps_lng: numOrNull(gps_lng),
  }
  return unwrap(await supabase.from('tech_activity_events').insert(payload).select(EVENT_COLS).single())
}

/** Foreman-confirm an event (foreman_confirmed=true, confirmed_by=caller). */
export async function confirmEvent(id) {
  if (!id) throw new ServiceError('An event is required.')
  const uid = await currentUserId()
  return unwrap(
    await supabase
      .from('tech_activity_events')
      .update({ foreman_confirmed: true, confirmed_by: uid })
      .eq('id', id)
      .select(EVENT_COLS)
      .single(),
  )
}

/**
 * List activity events in a [from,to] window (default: today 00:00 to now),
 * ordered by `at` ascending. Country-scoped (null-safe), optional site / user.
 * []-degrades when the table is missing.
 * @param {{ site?:string, country?:string, from?:string, to?:string, user_id?:string }} [opts]
 */
export async function listEvents({ site, country, from, to, user_id } = {}) {
  try {
    const start = from || startOfToday()
    const end = to || new Date().toISOString()
    let q = supabase.from('tech_activity_events').select(EVENT_COLS).gte('at', start).lte('at', end)
    if (user_id) q = q.eq('user_id', user_id)
    if (site) q = q.eq('site', site)
    q = applyCountry(q, country)
    return unwrap(await q.order('at', { ascending: true })) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

// ── Attendance (workshop_attendance) ───────────────────────────────────────────

/** Check a technician in (records a workshop_attendance row for today). */
export async function checkIn({ user_id, shift_id, site } = {}) {
  const uid = user_id || (await currentUserId())
  if (!uid) throw new ServiceError('A technician is required to check in.')
  const payload = {
    user_id: uid,
    shift_id: shift_id || null,
    site: site ? String(site).slice(0, 120) : null,
    check_in: new Date().toISOString(),
    source: 'workshop_live',
  }
  return unwrap(await supabase.from('workshop_attendance').insert(payload).select(ATTENDANCE_COLS).single())
}

/** Check a technician out (closes today's open attendance row). */
export async function checkOut({ user_id } = {}) {
  const uid = user_id || (await currentUserId())
  if (!uid) throw new ServiceError('A technician is required to check out.')
  return unwrap(
    await supabase
      .from('workshop_attendance')
      .update({ check_out: new Date().toISOString() })
      .eq('user_id', uid)
      .is('check_out', null)
      .gte('check_in', startOfToday())
      .select(ATTENDANCE_COLS),
  )
}

// ── Internal loaders for the orchestrator ──────────────────────────────────────

/** Today's shift roster (best effort). []-degrades. */
async function loadTodayShifts({ site, country } = {}) {
  try {
    let q = supabase
      .from('shifts')
      .select('person_name,role,shift_date,start_time,end_time,site,status')
      .eq('shift_date', todayDate())
    if (site) q = q.eq('site', site)
    q = applyCountry(q, country)
    return unwrap(await q) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Today's attendance rows (check_in today). []-degrades. */
async function loadTodayAttendance({ site } = {}) {
  try {
    let q = supabase
      .from('workshop_attendance')
      .select('user_id,check_in,check_out')
      .gte('check_in', startOfToday())
    if (site) q = q.eq('site', site)
    return unwrap(await q) || []
  } catch (err) {
    if (isMissingRelation(err)) return []
    throw err
  }
}

/** Map today's shifts onto technicians by name -> { [user_id]: { start, end, label } }. */
function buildShiftByUser(technicians, shifts) {
  const byName = {}
  for (const s of shifts || []) {
    const name = String(s?.person_name || '').trim().toLowerCase()
    if (name) byName[name] = s
  }
  const out = {}
  for (const t of technicians || []) {
    const name = String(t?.full_name || '').trim().toLowerCase()
    const s = name ? byName[name] : null
    if (!s) continue
    const label =
      s.start_time && s.end_time
        ? `${s.start_time} to ${s.end_time}`
        : s.start_time || s.end_time || null
    out[t.id] = {
      start: shiftTimestamp(s.shift_date, s.start_time),
      end: shiftTimestamp(s.shift_date, s.end_time),
      label,
    }
  }
  return out
}

/** { [user_id]: bool } present = an attendance row checked in but not out. */
function buildPresentByUser(attendance) {
  const out = {}
  for (const a of attendance || []) {
    if (!a?.user_id) continue
    const present = Boolean(a.check_in) && !a.check_out
    out[a.user_id] = out[a.user_id] === true ? true : present === true
  }
  return out
}

/**
 * ORCHESTRATOR: load everything the live board needs in one call. Each sub-read
 * degrades independently ([] / {}), so one missing table never sinks the load.
 * The pure engine (buildBoard/computeKpis/deriveAlerts) consumes this shape.
 * @param {{ site?:string, country?:string }} [opts]
 * @returns {Promise<{ technicians:object[], eventsByUser:object, jobs:object[],
 *   jobsById:object, assignments:object[], shiftByUser:object, presentByUser:object }>}
 */
export async function loadLiveBoard({ site, country } = {}) {
  const [technicians, jobs, events, assignments, shifts, attendance] = await Promise.all([
    listTechnicians({ site, country }).catch(() => []),
    listOpenJobs({ site, country }).catch(() => []),
    listEvents({ site, country }).catch(() => []),
    listAssignments({ active: true, site, country }).catch(() => []),
    loadTodayShifts({ site, country }).catch(() => []),
    loadTodayAttendance({ site }).catch(() => []),
  ])

  return {
    technicians,
    eventsByUser: groupBy(events, 'user_id'),
    jobs,
    jobsById: keyBy(jobs, 'id'),
    assignments,
    shiftByUser: buildShiftByUser(technicians, shifts),
    presentByUser: buildPresentByUser(attendance),
  }
}
