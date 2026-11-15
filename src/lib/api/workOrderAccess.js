/**
 * What the signed-in person may do with work orders, asked of the server.
 *
 * After the work order permission drafts are applied the database answers in one
 * call (work_order_my_access: a scope per action). Before that the function does
 * not exist; the answer is then built from today's rules (app_user_can for
 * create and edit, the elevated roles for assigning) so the pages are right in
 * both states. A dropped request yields "unknown", never "no".
 */
import { supabase } from './_client'
import { getServerCapabilities } from './writeAccess'
import { legacyWorkOrderAccess, serverWorkOrderAccess } from '../workOrderAccess'

/** PostgREST / Postgres codes for "this function is not on the database". */
const MISSING_FUNCTION = new Set(['PGRST202', '42883'])

/**
 * @param {{role?:string, isSuperAdmin?:boolean}} who
 * @returns {Promise<object>}  see serverWorkOrderAccess / legacyWorkOrderAccess
 */
export async function getWorkOrderAccess({ role, isSuperAdmin = false } = {}) {
  try {
    const { data, error } = await supabase.rpc('work_order_my_access')
    if (!error && data && typeof data === 'object') return serverWorkOrderAccess(data)
    if (error && !MISSING_FUNCTION.has(error.code)) {
      // The resolver exists but could not be read: unknown for everything.
      return legacyWorkOrderAccess({ role, isSuperAdmin, serverCaps: null })
    }
  } catch {
    return legacyWorkOrderAccess({ role, isSuperAdmin, serverCaps: null })
  }
  const serverCaps = await getServerCapabilities('work_orders')
  return legacyWorkOrderAccess({ role, isSuperAdmin, serverCaps })
}

/**
 * Ids of the open work orders assigned to this person (active assignment or task).
 * Only needed for the "assigned" scope. A failed read returns an empty set: the
 * owner column on the row is still checked, and the database decides in the end.
 */
export async function listMyAssignedJobIds(userId) {
  const ids = new Set()
  if (!userId) return ids
  try {
    const [a, t] = await Promise.all([
      supabase.from('wo_assignments').select('job_id').eq('user_id', userId).eq('active', true).limit(500),
      supabase.from('wo_tasks').select('job_id').eq('assignee_user_id', userId).limit(500),
    ])
    for (const r of a?.data || []) if (r?.job_id) ids.add(r.job_id)
    for (const r of t?.data || []) if (r?.job_id) ids.add(r.job_id)
  } catch {
    /* empty set */
  }
  return ids
}

const MY_JOB_COLS =
  'id,work_order_no,asset_no,description,status,priority,work_type,site,country,opened_at,started_at,' +
  'target_completion,assigned_owner_id,qc_status,vor'
const MY_TASK_COLS = 'id,job_id,seq,title,status,assignee_user_id,est_minutes'
const OPEN_FILTER = '("Completed","Closed","Cancelled","completed","closed","cancelled")'

/**
 * The open work orders assigned to this person (as owner, by an active assignment
 * or through a task), with the tasks that are theirs. Used by the My Jobs screen.
 * Throws on a failed read so the screen can say so instead of showing "no jobs".
 *
 * @param {string} userId
 * @returns {Promise<{jobs: object[], tasks: object[]}>}
 */
export async function listMyJobs(userId) {
  if (!userId) return { jobs: [], tasks: [] }
  const ids = [...(await listMyAssignedJobIds(userId))].slice(0, 200)
  const byId = new Map()
  const owned = await supabase.from('work_orders').select(MY_JOB_COLS)
    .eq('assigned_owner_id', userId).not('status', 'in', OPEN_FILTER)
    .order('opened_at', { ascending: false }).order('id').limit(200)
  if (owned.error) throw owned.error
  for (const r of owned.data || []) byId.set(r.id, r)
  if (ids.length) {
    const linked = await supabase.from('work_orders').select(MY_JOB_COLS)
      .in('id', ids).not('status', 'in', OPEN_FILTER)
      .order('opened_at', { ascending: false }).order('id').limit(200)
    if (linked.error) throw linked.error
    for (const r of linked.data || []) byId.set(r.id, r)
  }
  const jobs = [...byId.values()]
  let tasks = []
  if (jobs.length) {
    const t = await supabase.from('wo_tasks').select(MY_TASK_COLS)
      .eq('assignee_user_id', userId).in('job_id', jobs.map((j) => j.id))
      .order('seq', { ascending: true, nullsFirst: true }).order('id').limit(500)
    if (!t.error) tasks = t.data || []
  }
  return { jobs, tasks }
}
