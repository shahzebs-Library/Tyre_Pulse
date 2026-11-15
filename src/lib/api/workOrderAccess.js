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
