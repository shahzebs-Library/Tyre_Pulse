import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getServerCapabilities } from '../lib/api/writeAccess'
import { WRITE_RULES, resolveWriteAccess, writeRefusalReason } from '../lib/writeAccessRules'

/**
 * What the database will let this user do on a table, for hiding or disabling
 * controls. Mirrors the live policies (writeAccessRules.js) and asks the server
 * for the capability answer where the table has a capability policy.
 *
 * While the answer is loading, and when it cannot be read, create and edit are
 * true: a control is never hidden on a guess. The save path reports a refusal.
 *
 * @param {string} table  key of WRITE_RULES
 * @returns {{create:boolean, edit:boolean, delete:boolean, known:boolean, loading:boolean,
 *            reason:(cap:'create'|'edit'|'delete')=>string}}
 */
export function useWriteAccess(table) {
  // `|| {}`: a page rendered outside the auth provider (some tests, public
  // boards) gets the not-signed-in answer instead of a crash.
  const { profile, isSuperAdmin } = useAuth() || {}
  const capability = WRITE_RULES[table]?.capability || null
  const [serverCaps, setServerCaps] = useState(null)
  const [loading, setLoading] = useState(Boolean(capability))
  const userId = profile?.id || null
  const role = profile?.role || null

  useEffect(() => {
    let live = true
    if (!capability || !userId) { setServerCaps(null); setLoading(false); return undefined }
    setLoading(true)
    getServerCapabilities(capability).then((caps) => {
      if (!live) return
      setServerCaps(caps)
      setLoading(false)
    })
    return () => { live = false }
  }, [capability, userId, role])

  return useMemo(() => {
    const access = resolveWriteAccess(table, { role, isSuperAdmin, serverCaps })
    return { ...access, loading, reason: (cap) => writeRefusalReason(table, cap) }
  }, [table, role, isSuperAdmin, serverCaps, loading])
}
