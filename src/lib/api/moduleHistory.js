/**
 * Module status history + the reasoned module status writer
 * (migration 20261004103000_module_status_history).
 *
 * setModuleStatusWithReason goes through admin_set_module_status so the reason
 * is stored beside the old and new status. When that function is not there yet
 * (older database) it falls back to the plain table writers and says so, so a
 * change still applies and is still audited by the caller.
 */
import { supabase } from './_client'
import { setModuleStatus, bulkSetStatus } from './modulesRegistry'
import { toUserMessage } from '../safeError'

const HISTORY_COLS = 'id,module_id,old_status,new_status,old_until,new_until,note,changed_by,reason,changed_at'

function notProvisioned(err) {
  const code = err?.code || ''
  return code === '42883' || code === 'PGRST202' || code === '42P01' || code === 'PGRST205'
}

/** Newest first. Throws a ServiceError-like Error on a real failure. */
export async function listModuleHistory({ moduleId = null, limit = 300 } = {}) {
  let q = supabase.from('module_status_history').select(HISTORY_COLS)
    .order('changed_at', { ascending: false }).order('id', { ascending: false })
    .limit(Math.min(Math.max(1, limit), 999))
  if (moduleId) q = q.eq('module_id', moduleId)
  const { data, error } = await q
  if (error) {
    const e = new Error(toUserMessage(error, 'Module history could not be read.'))
    e.code = error.code
    throw e
  }
  return data || []
}

/**
 * @returns {Promise<{ok:true, updated:number, recorded:boolean}>}
 * recorded is false when the fallback writer was used (no reason stored).
 */
export async function setModuleStatusWithReason(ids, status, { until = null, note = null, reason }) {
  const list = (ids || []).filter(Boolean)
  let untilIso = null
  if (status === 'maintenance' && until) {
    const d = new Date(until)
    if (!Number.isNaN(d.getTime())) untilIso = d.toISOString()
  }
  try {
    const { data, error } = await supabase.rpc('admin_set_module_status', {
      p_ids: list, p_status: status, p_until: untilIso, p_note: note || null, p_reason: reason,
    })
    if (error) throw error
    return { ok: true, updated: data?.updated ?? list.length, recorded: true }
  } catch (err) {
    if (!notProvisioned(err) && typeof supabase.rpc === 'function') {
      const e = new Error(toUserMessage(err, 'The module status could not be changed.'))
      e.code = err?.code
      throw e
    }
    if (status === 'maintenance' || list.length === 1) {
      for (const id of list) await setModuleStatus(id, status, { until, note })
    } else {
      await bulkSetStatus(list, status)
    }
    return { ok: true, updated: list.length, recorded: false }
  }
}
