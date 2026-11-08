import { useCallback, useEffect, useState } from 'react'
import { Key, X } from 'lucide-react'
import { Panel, PanelHeader, Btn, ErrorState } from '../../components/ui'
import { supabase } from '../../../lib/supabase'
import { toUserMessage } from '../../../lib/safeError'

/**
 * People who pressed "Forgot password" and cannot receive an email or SMS.
 * Rows come from request_password_reset (20261108120000). Setting a password
 * through the normal Reset password dialog closes the request automatically
 * (trigger on access_audit); Dismiss closes it without a change.
 */
export default function PasswordRequestsPanel({ onSetPassword }) {
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const { data: reqs, error: e1 } = await supabase.from('password_reset_requests')
        .select('id,user_id,requested_at')
        .eq('status', 'pending').order('requested_at', { ascending: false }).limit(50)
      if (e1) throw e1
      const ids = [...new Set((reqs || []).map((r) => r.user_id))]
      let people = []
      if (ids.length) {
        const { data, error: e2 } = await supabase.from('profiles')
          .select('id,full_name,username,email,role,site').in('id', ids).limit(50)
        if (e2) throw e2
        people = data || []
      }
      const byId = new Map(people.map((p) => [p.id, p]))
      setRows((reqs || []).map((r) => ({ ...r, person: byId.get(r.user_id) || null })).filter((r) => r.person))
    } catch (e) {
      setError(toUserMessage(e, 'Could not load password requests.'))
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function dismiss(id) {
    setBusyId(id)
    try {
      const { error: e } = await supabase.from('password_reset_requests')
        .update({ status: 'dismissed', handled_at: new Date().toISOString() }).eq('id', id)
      if (e) throw e
      setRows((prev) => prev.filter((r) => r.id !== id))
    } catch (e) {
      setError(toUserMessage(e, 'Could not dismiss the request.'))
    } finally { setBusyId(null) }
  }

  if (!rows.length && !error) return null
  return (
    <Panel>
      <PanelHeader icon={Key} tone="warning" title={`Password requests (${rows.length})`}
        subtitle="These people cannot sign in and asked for a new password. Set one, then tell them in person or by phone." />
      <ErrorState message={error} onRetry={load} />
      <ul className="divide-y divide-gray-800">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2 px-1 text-sm">
            <span>
              <b>{r.person.full_name || r.person.username || 'User'}</b>
              <span className="text-gray-400"> {r.person.username ? `(${r.person.username})` : ''} {r.person.role || ''}{r.person.site ? `, ${r.person.site}` : ''}</span>
              <span className="text-gray-500 text-xs block">Asked {new Date(r.requested_at).toLocaleString('en-GB')}</span>
            </span>
            <span className="flex gap-2">
              <Btn size="xs" variant="primary" icon={Key} onClick={() => { onSetPassword(r.person); setTimeout(load, 4000) }}>Set password</Btn>
              <Btn size="xs" icon={X} disabled={busyId === r.id} onClick={() => dismiss(r.id)}>Dismiss</Btn>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
