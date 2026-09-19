/**
 * NotifyRecipientsPanel — the reusable "notify recipients" chip control shown
 * on the Insurance Claim, Workshop Assessment and Fleet Validation tabs.
 *
 * Recipients are groups (Insurance team / Workshop / Fleet Manager / Finance),
 * not named people — profiles carry no department column, so a specific
 * person cannot be resolved server-side (the same reason the notification
 * engine documented in accidentWorkflow.js routes by ROLE, never a name).
 *
 * HONEST BY DESIGN: this writes one row to accident_case_communications via
 * the existing logCommunication() writer (channel='in_app', direction=
 * 'outbound', to_party=the chosen groups). It records that a notification was
 * raised on the case timeline; it does NOT trigger a live email/SMS/push -
 * that pipeline is the separate, gated `accident_emails_enabled` engine
 * (accidentWorkflow.js) which already fires its own automated notices on
 * stage/claim/VOR changes. Saying otherwise here would be a fabricated
 * delivery guarantee.
 */
import { useState } from 'react'
import { Megaphone, Loader2, Check } from 'lucide-react'
import { logCommunication } from '../../lib/api/accidentCommunications'
import { useAuth } from '../../contexts/AuthContext'
import { toUserMessage } from '../../lib/safeError'

const DEFAULT_RECIPIENTS = [
  { key: 'insurance', label: 'Insurance team' },
  { key: 'fleet', label: 'Fleet Manager' },
  { key: 'workshop', label: 'Workshop' },
  { key: 'finance', label: 'Finance' },
]

/**
 * @param {{accidentId:string, recipients?:{key,label}[], workstreamKey?:string,
 *   subject:string, title?:string, className?:string}} props
 */
export default function NotifyRecipientsPanel({
  accidentId, recipients = DEFAULT_RECIPIENTS, workstreamKey, subject, title = 'Notify recipients', className = '',
}) {
  const { profile } = useAuth()
  const [selected, setSelected] = useState(() => new Set())
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')

  function toggle(key) {
    setSent(false)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  async function send() {
    if (sending || selected.size === 0) return
    setSending(true); setErr(''); setSent(false)
    try {
      const toParty = recipients.filter((r) => selected.has(r.key)).map((r) => r.label).join(', ')
      await logCommunication(accidentId, {
        channel: 'in_app',
        direction: 'outbound',
        subject: subject || title,
        body: note || null,
        toParty,
        authorName: profile?.full_name || profile?.username || null,
        workstreamKey: workstreamKey || null,
      })
      setSent(true)
      setNote('')
      setSelected(new Set())
    } catch (e) {
      setErr(toUserMessage(e, 'Could not log the notification.'))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={`space-y-2.5 ${className}`}>
      <p className="text-xs font-semibold text-[var(--text-primary)] flex items-center gap-1.5"><Megaphone size={13} /> {title}</p>
      <div className="flex flex-wrap gap-1.5">
        {recipients.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => toggle(r.key)}
            className={`px-2.5 py-1 rounded-full border text-xs ${
              selected.has(r.key)
                ? 'border-green-500 bg-green-900/20 text-green-300'
                : 'border-[var(--input-border)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      {selected.size > 0 && (
        <input
          className="input w-full text-xs"
          placeholder="Optional note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}
      <div className="flex items-center gap-2">
        <button type="button" className="btn-secondary text-xs inline-flex items-center gap-1.5" disabled={sending || selected.size === 0} onClick={send}>
          {sending ? <Loader2 size={12} className="animate-spin" /> : <Megaphone size={12} />} Notify selected
        </button>
        {sent && <span className="text-xs text-green-400 inline-flex items-center gap-1"><Check size={12} /> Logged on the case timeline</span>}
      </div>
      {err && <p className="text-[11px] text-red-400">{err}</p>}
      <p className="text-[10px] text-[var(--text-muted)]">Logs a notice on the case timeline - does not send a live email or SMS.</p>
    </div>
  )
}
