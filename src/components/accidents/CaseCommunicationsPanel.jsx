/**
 * CaseCommunicationsPanel — the "notification delivery log" from the case
 * timeline mockup: every notice sent about this case (in-app / email / an
 * external-portal reply / a comment) plus manually logged contact (a phone
 * call, an in-person note), newest first. Backed by accident_case_communications
 * (accidentCommunications.js) - automated deliveries are inserted by the
 * notification pipeline server-side; the one write this panel exposes is a
 * manual log entry, same convention as the service module's own header.
 *
 * Mounted directly under CaseSlaHeader/CaseTimelineSection in the Overview tab
 * (not a separate top-level tab) - the mockup shows the timeline and the
 * delivery log together on one case-overview screen.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Bell, Mail, Phone, Globe, MessageCircle, ArrowDownLeft, ArrowUpRight,
  Circle, Loader2, RefreshCw, AlertCircle, Plus,
} from 'lucide-react'
import { listCommunications, logCommunication, COMMS_CHANNELS, COMMS_DIRECTIONS } from '../../lib/api/accidentCommunications'
import { toUserMessage } from '../../lib/safeError'

const CHANNEL_META = {
  in_app: { label: 'In-app notice', icon: Bell },
  email_out: { label: 'Email sent', icon: Mail },
  email_in: { label: 'Email received', icon: Mail },
  comment: { label: 'Comment', icon: MessageCircle },
  call: { label: 'Phone call', icon: Phone },
  external_portal: { label: 'External portal', icon: Globe },
}
const DIRECTION_META = {
  outbound: { label: 'Sent', icon: ArrowUpRight, tone: 'text-blue-300' },
  inbound: { label: 'Received', icon: ArrowDownLeft, tone: 'text-green-400' },
  internal: { label: 'Internal', icon: Circle, tone: 'text-[var(--text-muted)]' },
}

function timeAgo(iso) {
  if (!iso) return 'N/A'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString()
}

export default function CaseCommunicationsPanel({ accidentId, elevated, onChanged }) {
  const [rows, setRows] = useState(null) // null = loading
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ channel: 'call', direction: 'outbound', toParty: '', subject: '', body: '' })

  const load = useCallback(async () => {
    setRows(null); setErr('')
    try {
      const data = await listCommunications(accidentId)
      setRows(data)
    } catch (e) {
      setErr(toUserMessage(e, 'Could not load the notification delivery log.'))
      setRows([])
    }
  }, [accidentId])

  useEffect(() => { load() }, [load])

  async function submitLog(e) {
    e.preventDefault()
    if (saving) return
    setSaving(true); setErr('')
    try {
      const saved = await logCommunication(accidentId, {
        channel: form.channel,
        direction: form.direction,
        subject: form.subject || null,
        body: form.body || null,
        toParty: form.toParty || null,
      })
      setRows((prev) => [saved, ...(prev || [])])
      setForm({ channel: 'call', direction: 'outbound', toParty: '', subject: '', body: '' })
      setAdding(false)
      onChanged?.()
    } catch (e) {
      setErr(toUserMessage(e, 'Could not log the entry.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="border-t border-gray-800 pt-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-400 flex items-center gap-1.5">
          <Bell size={13} /> Notification delivery log
        </p>
        <div className="flex items-center gap-2">
          {rows !== null && rows.length > 0 && <span className="text-[11px] text-gray-500 whitespace-nowrap">{rows.length} {rows.length === 1 ? 'entry' : 'entries'}</span>}
          {elevated && (
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className="text-[11px] text-green-400 hover:text-green-300 inline-flex items-center gap-1"
            >
              <Plus size={12} /> Log contact
            </button>
          )}
        </div>
      </div>

      {adding && (
        <form onSubmit={submitLog} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-lg border border-gray-800 bg-gray-900/40 p-3">
          <div>
            <label className="text-[11px] text-gray-500">Channel</label>
            <select className="input w-full text-xs" value={form.channel} onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}>
              {COMMS_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_META[c]?.label || c}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-gray-500">Direction</label>
            <select className="input w-full text-xs" value={form.direction} onChange={(e) => setForm((f) => ({ ...f, direction: e.target.value }))}>
              {COMMS_DIRECTIONS.map((d) => <option key={d} value={d}>{DIRECTION_META[d]?.label || d}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-gray-500">To / with</label>
            <input className="input w-full text-xs" value={form.toParty} onChange={(e) => setForm((f) => ({ ...f, toParty: e.target.value }))} placeholder="e.g. the vendor, the insurer" />
          </div>
          <div>
            <label className="text-[11px] text-gray-500">Subject</label>
            <input className="input w-full text-xs" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-[11px] text-gray-500">Notes</label>
            <textarea rows={2} className="input w-full text-xs" value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
          </div>
          <div className="sm:col-span-2 flex gap-2">
            <button type="submit" className="btn-primary text-xs" disabled={saving}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : 'Save'}
            </button>
            <button type="button" className="btn-secondary text-xs" onClick={() => setAdding(false)} disabled={saving}>Cancel</button>
          </div>
        </form>
      )}

      {err && (
        <p className="text-xs text-red-400 mt-2 flex items-center gap-1.5">
          <AlertCircle size={11} /> {err}
          <button className="underline inline-flex items-center gap-1" onClick={load}><RefreshCw size={10} /> Retry</button>
        </p>
      )}

      {rows === null ? (
        <div className="space-y-2 animate-pulse mt-3">
          {[0, 1].map((i) => <div key={i} className="h-10 bg-gray-800/60 rounded" />)}
        </div>
      ) : rows.length === 0 && !err ? (
        <p className="text-xs text-gray-500 mt-2">No notifications or contact logged for this case yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => {
            const channel = CHANNEL_META[r.channel] || { label: r.channel, icon: Circle }
            const direction = DIRECTION_META[r.direction] || { label: r.direction, icon: Circle, tone: 'text-gray-400' }
            const ChannelIcon = channel.icon
            const DirIcon = direction.icon
            return (
              <li key={r.id} className="flex items-start gap-3 rounded-lg border border-gray-800 px-3 py-2">
                <ChannelIcon size={14} className="text-gray-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-sm text-gray-200 font-medium truncate">{r.subject || channel.label}</p>
                    <span className="text-[11px] text-gray-500 whitespace-nowrap">{timeAgo(r.occurred_at)}</span>
                  </div>
                  <p className={`text-[11px] flex items-center gap-1 mt-0.5 ${direction.tone}`}>
                    <DirIcon size={10} /> {direction.label}
                    {r.to_party ? ` · to ${r.to_party}` : ''}
                    {r.from_party ? ` · from ${r.from_party}` : ''}
                    {r.author_name ? ` · by ${r.author_name}` : ''}
                  </p>
                  {r.body && <p className="text-xs text-gray-400 mt-1 whitespace-pre-wrap">{r.body}</p>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
