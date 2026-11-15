import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getWorkOrderAccess, listMyAssignedJobIds } from '../lib/api/workOrderAccess'
import { canWorkOrder, checkWorkOrderChange, workOrderRefusalReason } from '../lib/workOrderAccess'

/**
 * Work order rights for the signed-in person, for disabling controls with the
 * reason beside them. The database is the boundary; this only mirrors it.
 *
 * `can(action, row)` returns false only when the answer is known to be no. While
 * loading, or when the server could not be read, it returns true: a control is
 * never hidden on a guess, and the save path reports a refusal honestly.
 *
 * @returns {{
 *   access: object|null, loading: boolean,
 *   can: (action:string, row?:object) => boolean,
 *   reason: (action:string, row?:object) => string,
 *   check: (row:object, changedKeys:string[], opts?:{newStatus?:string}) => {ok:boolean|null, reason:string},
 * }}
 */
export function useWorkOrderAccess() {
  const { profile, isSuperAdmin } = useAuth() || {}
  const userId = profile?.id || null
  const role = profile?.role || null
  const [access, setAccess] = useState(null)
  const [assignedJobIds, setAssignedJobIds] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    if (!userId) { setAccess(null); setLoading(false); return undefined }
    setLoading(true)
    getWorkOrderAccess({ role, isSuperAdmin }).then(async (a) => {
      if (!live) return
      setAccess(a)
      setLoading(false)
      const scoped = ['edit', 'assign', 'progress', 'qc'].some((k) => a?.[k] === 'assigned')
      if (scoped) {
        const ids = await listMyAssignedJobIds(userId)
        if (live) setAssignedJobIds(ids)
      }
    })
    return () => { live = false }
  }, [userId, role, isSuperAdmin])

  const ctx = useMemo(() => ({ userId, assignedJobIds }), [userId, assignedJobIds])
  const can = useCallback((action, row) => canWorkOrder(action, access, row, ctx) !== false, [access, ctx])
  const reason = useCallback((action, row) => workOrderRefusalReason(action, access, row, ctx), [access, ctx])
  const check = useCallback(
    (row, changedKeys, opts = {}) => checkWorkOrderChange(access, row, changedKeys, { ...opts, ctx }),
    [access, ctx],
  )
  return useMemo(() => ({ access, loading, can, reason, check }), [access, loading, can, reason, check])
}
