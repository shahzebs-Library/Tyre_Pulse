/**
 * Sign-in lockout panel for one user (TEN-9f), shown inside the console's
 * Reset password window: an account locked after repeated failed sign-ins can be
 * cleared with a recorded reason. Renders nothing until the database change is
 * installed, and nothing when the account is not locked.
 */
import { useEffect, useState } from 'react'
import { Unlock, AlertTriangle } from 'lucide-react'
import { Note, Btn } from '../../components/ui'
import { adminLoginLockStatus, adminClearLoginLock } from '../../../lib/api/adminAccess'
import { toUserMessage } from '../../../lib/safeError'

const INPUT = 'w-full h-9 bg-gray-900 border border-gray-800 rounded-lg px-3 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:border-gray-700 focus-visible:ring-2 focus-visible:ring-orange-500'

export default function LoginLockPanel({ userId, onCleared }) {
  const [state, setState] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    let live = true
    setState(null); setReason(''); setError(''); setDone(false)
    if (!userId) return undefined
    adminLoginLockStatus(userId)
      .then((s) => { if (live) setState(s) })
      .catch(() => { if (live) setState(null) })
    return () => { live = false }
  }, [userId])

  if (done) {
    return <Note icon={Unlock} tone="accent">Sign-in lockout cleared. They can try again now.</Note>
  }
  if (!state?.ok || !state.locked) return null

  const minutes = Math.max(1, Math.ceil((Number(state.retry_after_seconds) || 0) / 60))
  const tooShort = reason.trim().length < 5

  async function clear() {
    setBusy(true); setError('')
    try {
      const r = await adminClearLoginLock(userId, reason.trim())
      if (!r.ok) {
        setError(r.reason === 'reason_required' ? 'Write a reason of at least 5 characters.'
          : r.reason === 'forbidden' ? 'You can only clear accounts in your own company.'
            : 'Could not clear the lockout.')
        return
      }
      setDone(true)
      onCleared?.()
    } catch (e) {
      setError(toUserMessage(e, 'Could not clear the lockout.'))
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-2 rounded-lg border border-gray-800 p-3">
      <Note icon={AlertTriangle} tone="warning">
        Sign-in is locked after {state.failed_attempts} failed attempts. It unlocks by itself in about {minutes} minute{minutes === 1 ? '' : 's'}.
      </Note>
      <label className="block">
        <span className="text-[11px] uppercase tracking-wide text-gray-400">Reason (recorded in the audit trail)</span>
        <input type="text" value={reason} maxLength={500}
          onChange={(e) => { setReason(e.target.value); setError('') }}
          placeholder="For example: confirmed by phone it was the user"
          aria-describedby={error ? 'login-lock-error' : undefined}
          className={`${INPUT} mt-1`} />
      </label>
      {error && <p id="login-lock-error" role="alert" className="text-[11px] text-amber-400">{error}</p>}
      <Btn icon={Unlock} onClick={clear} busy={busy} disabled={tooShort}>
        {busy ? 'Clearing' : 'Clear lockout now'}
      </Btn>
    </div>
  )
}
