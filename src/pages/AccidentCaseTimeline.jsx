/**
 * AccidentCaseTimeline — "Case timeline & notifications", a DEDICATED page
 * (route /accidents/:id/timeline), matching the mockup exactly: it is its own
 * screen, not a section inside the tabbed case detail page. Reachable from the
 * case detail page (a header link) and, like the case detail page itself,
 * loads its own copy of the accident row so it works as a standalone URL.
 *
 * Three sub-tabs (Timeline / Notifications / Participants) over the ONE feed
 * `loadCaseTimeline` composes from real sources - see src/lib/caseTimelineFeed.js
 * for exactly which table backs which entry and why nothing here is invented.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Bell, Users as UsersIcon, ListChecks, Mail, Truck, Clock, FileText,
  ShieldCheck, Settings, ChevronRight, PenLine, Megaphone, Circle, AlertTriangle,
  Loader2, X,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import CaseSlaHeader from '../components/accidents/CaseSlaHeader'
import { loadCase } from '../lib/api/accidentCase'
import { loadCaseTimeline } from '../lib/api/caseTimelineFeed'
import { logCommunication, COMMS_CHANNELS } from '../lib/api/accidentCommunications'
import { FILTERS, durationLabel } from '../lib/caseTimelineFeed'
import { toUserMessage } from '../lib/safeError'
import { useAuth } from '../contexts/AuthContext'

const ICON_BY_KEY = { report: FileText, workstream: ShieldCheck, mail: Mail, handover: Truck, document: FileText, sla: Clock }
const STATUS_META = {
  completed: { label: 'Completed', tone: 'text-green-400 bg-green-900/20 border-green-700/50' },
  in_progress: { label: 'In transit', tone: 'text-blue-300 bg-blue-900/20 border-blue-700/50' },
  pending: { label: 'Pending', tone: 'text-amber-400 bg-amber-900/20 border-amber-700/50' },
}
const DOT_TONE = { completed: 'bg-green-500 border-green-400', in_progress: 'bg-blue-500 border-blue-400', pending: 'bg-amber-500 border-amber-400' }

function fmtTime(iso) {
  if (!iso) return 'N/A'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return `${d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}`
}

export default function AccidentCaseTimeline() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [acc, setAcc] = useState(null)
  const [caseData, setCaseData] = useState(null)
  const [feed, setFeed] = useState({ entries: [], notifications: [], participants: [] })
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [tab, setTab] = useState('timeline')
  const [filter, setFilter] = useState('all')
  const [noteForm, setNoteForm] = useState(null) // 'note' | 'notify' | null
  const [noteText, setNoteText] = useState('')
  const [noteChannel, setNoteChannel] = useState('in_app')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const { data, error } = await supabase.from('accidents').select('*').eq('id', id).single()
      if (error || !data) { setErr(toUserMessage(error, 'Accident record not found.')); setLoading(false); return }
      setAcc(data)
      const [cd, tf] = await Promise.all([
        loadCase(id, { country: data.country }).catch(() => null),
        loadCaseTimeline(data).catch(() => ({ entries: [], notifications: [], participants: [] })),
      ])
      setCaseData(cd)
      setFeed(tf)
    } catch (e) {
      setErr(toUserMessage(e, 'Could not load the case timeline.'))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const entries = useMemo(
    () => (filter === 'all' ? feed.entries : feed.entries.filter((e) => e.category === filter)),
    [feed.entries, filter],
  )
  const notifications = useMemo(
    () => [...feed.notifications].sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at)),
    [feed.notifications],
  )

  async function submitNote(e) {
    e.preventDefault()
    if (saving || !noteText.trim()) return
    setSaving(true); setErr('')
    try {
      await logCommunication(id, {
        channel: noteForm === 'notify' ? noteChannel : 'comment',
        direction: noteForm === 'notify' ? 'outbound' : 'internal',
        subject: noteForm === 'notify' ? 'Participant notification' : 'Timeline note',
        body: noteText,
        authorName: profile?.full_name || profile?.username || null,
      })
      setNoteText(''); setNoteForm(null)
      await load()
    } catch (e2) {
      setErr(toUserMessage(e2, 'Could not save that entry.'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-[var(--text-muted)]">
        <Loader2 size={16} className="animate-spin" /> Loading the case timeline…
      </div>
    )
  }
  if (!acc) {
    return (
      <div className="p-6 space-y-3">
        <button onClick={() => navigate('/accidents')} className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"><ArrowLeft size={15} /> Back to Accidents</button>
        <p className="text-red-400">{err || 'Accident record not found.'}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-10 max-w-4xl">
      <button
        onClick={() => navigate(`/accidents/${id}`)}
        className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      >
        <ArrowLeft size={15} /> Back to case
      </button>

      <div>
        <h1 className="text-xl font-bold text-[var(--text-primary)]">Case timeline &amp; notifications</h1>
        <p className="text-sm text-[var(--text-muted)] mt-0.5 font-mono">
          {[acc.reference_no, acc.asset_no].filter(Boolean).join(' · ') || 'N/A'}
        </p>
      </div>

      <CaseSlaHeader acc={acc} workstreams={caseData?.workstreams} />

      {err && <p className="text-red-400 text-xs flex items-center gap-1.5"><AlertTriangle size={12} /> {err}</p>}

      {/* Sub-tabs */}
      <div className="flex gap-6 border-b border-[var(--input-border)]">
        {[
          { key: 'timeline', label: 'Timeline', icon: ListChecks },
          { key: 'notifications', label: 'Notifications', icon: Bell },
          { key: 'participants', label: 'Participants', icon: UsersIcon },
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`pb-2.5 text-sm font-medium flex items-center gap-1.5 border-b-2 -mb-px ${
              tab === key ? 'border-green-500 text-green-400' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'timeline' && (
        <>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                  filter === f.key ? 'bg-[var(--text-primary)] text-[var(--bg-base,#0b0f0d)] border-transparent' : 'border-[var(--input-border)] text-[var(--text-secondary)]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {entries.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] py-6 text-center">No timeline entries {filter === 'all' ? 'recorded' : `in "${FILTERS.find((f) => f.key === filter)?.label}"`} yet.</p>
          ) : (
            <ol className="mt-2">
              {entries.map((e, i) => {
                const Icon = ICON_BY_KEY[e.iconKey] || Circle
                const meta = STATUS_META[e.status] || STATUS_META.completed
                const dur = durationLabel(e.durationMs)
                return (
                  <li key={e.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <span className={`mt-1 w-3 h-3 rounded-full border-2 shrink-0 ${DOT_TONE[e.status] || DOT_TONE.completed}`} />
                      {i < entries.length - 1 && <span className="w-px flex-1 bg-[var(--input-border)] my-0.5" />}
                    </div>
                    <div className={`flex-1 min-w-0 flex items-start gap-3 ${i < entries.length - 1 ? 'pb-5' : ''}`}>
                      <div className="w-8 h-8 rounded-full bg-[var(--input-bg)] border border-[var(--input-border)] flex items-center justify-center shrink-0 mt-0.5">
                        <Icon size={14} className="text-[var(--text-muted)]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-[var(--text-primary)]">{e.title}</p>
                            {e.subtitle && <p className="text-xs text-[var(--text-muted)]">{e.subtitle}</p>}
                          </div>
                          <span className="text-[11px] text-[var(--text-muted)] whitespace-nowrap">{fmtTime(e.at)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-1 flex-wrap">
                          {e.detail && <p className="text-xs text-[var(--text-secondary)]">{e.detail}</p>}
                          <div className="flex items-center gap-2 ml-auto">
                            <span className={`badge text-[11px] border ${meta.tone}`}>{meta.label}</span>
                            {dur && <span className="text-[11px] text-[var(--text-muted)]">{dur}</span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}

          {/* Notification delivery log preview */}
          <div className="rounded-lg border border-[var(--input-border)] mt-4">
            <div className="px-3 py-2.5 border-b border-[var(--input-border)] flex items-center gap-2">
              <Mail size={14} className="text-[var(--text-muted)]" />
              <p className="text-sm font-semibold text-[var(--text-primary)]">Notification delivery log</p>
            </div>
            {notifications.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] px-3 py-4">No notifications logged for this case yet.</p>
            ) : (
              <div className="divide-y divide-[var(--input-border)]">
                {notifications.slice(0, 3).map((n) => (
                  <div key={n.id} className="px-3 py-2 flex items-center justify-between gap-3 text-xs">
                    <span className="text-[var(--text-primary)] truncate">{n.subject || n.channel}</span>
                    <span className="text-[var(--text-muted)] truncate">{n.to_party || n.from_party || n.author_name || 'N/A'}</span>
                    <span className="text-[var(--text-muted)] whitespace-nowrap">{fmtTime(n.occurred_at)}</span>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setTab('notifications')} className="w-full text-center text-xs text-blue-400 py-2 border-t border-[var(--input-border)] hover:text-blue-300">
              View all notifications
            </button>
          </div>
        </>
      )}

      {tab === 'notifications' && (
        <div className="rounded-lg border border-[var(--input-border)]">
          {notifications.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] px-3 py-6 text-center">No notifications logged for this case yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--text-muted)] border-b border-[var(--input-border)]">
                    <th className="px-3 py-2 font-medium">Trigger</th>
                    <th className="px-3 py-2 font-medium">Recipients</th>
                    <th className="px-3 py-2 font-medium">Channel</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--input-border)]">
                  {notifications.map((n) => (
                    <tr key={n.id}>
                      <td className="px-3 py-2 text-[var(--text-primary)]">{n.subject || 'N/A'}</td>
                      <td className="px-3 py-2 text-[var(--text-secondary)]">{n.to_party || n.from_party || 'N/A'}</td>
                      <td className="px-3 py-2 text-[var(--text-secondary)]">{n.channel}</td>
                      <td className="px-3 py-2 text-[var(--text-secondary)]">{n.direction === 'outbound' ? 'Sent' : n.direction === 'inbound' ? 'Received' : 'Logged'}</td>
                      <td className="px-3 py-2 text-[var(--text-muted)] whitespace-nowrap">{fmtTime(n.occurred_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'participants' && (
        <div className="rounded-lg border border-[var(--input-border)] divide-y divide-[var(--input-border)]">
          {feed.participants.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] px-3 py-6 text-center">No participants recorded for this case yet.</p>
          ) : feed.participants.map((p) => (
            <div key={p.name} className="px-3 py-2.5 flex items-center justify-between gap-3">
              <span className="text-sm text-[var(--text-primary)]">{p.name}</span>
              <span className="text-xs text-[var(--text-muted)]">{p.roles.join(', ') || 'N/A'}</span>
            </div>
          ))}
        </div>
      )}

      {/* Manage recipient groups - links to the Teams tab, the case's real
          "who's on which team" surface; no separate recipient-group config
          exists in this app, so this deliberately routes there rather than
          pretending to open a settings screen that is not built. */}
      <button
        onClick={() => navigate(`/accidents/${id}`, { state: { openTab: 'teams' } })}
        className="w-full rounded-lg border border-[var(--input-border)] px-3 py-3 flex items-center gap-3 text-left hover:border-[var(--text-muted)]"
      >
        <Settings size={16} className="text-[var(--text-muted)] shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)]">Manage recipient groups</p>
          <p className="text-xs text-[var(--text-muted)]">Recipients are set per event and role on the Teams tab.</p>
        </div>
        <ChevronRight size={16} className="text-[var(--text-muted)] shrink-0" />
      </button>

      {noteForm && (
        <form onSubmit={submitNote} className="rounded-lg border border-[var(--input-border)] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-[var(--text-primary)]">{noteForm === 'notify' ? 'Notify participants' : 'Add timeline note'}</p>
            <button type="button" onClick={() => setNoteForm(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={14} /></button>
          </div>
          {noteForm === 'notify' && (
            <select className="input w-full text-xs" value={noteChannel} onChange={(e) => setNoteChannel(e.target.value)}>
              {COMMS_CHANNELS.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
            </select>
          )}
          <textarea rows={3} className="input w-full text-xs" value={noteText} onChange={(e) => setNoteText(e.target.value)}
            placeholder={noteForm === 'notify' ? 'What should participants be told?' : 'Note for the case timeline'} />
          {noteForm === 'notify' && (
            <p className="text-[11px] text-[var(--text-muted)]">This records the notification on the case log. It does not send a live email/SMS - there is no delivery pipeline wired for this yet.</p>
          )}
          <button type="submit" className="btn-primary text-xs" disabled={saving || !noteText.trim()}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
          </button>
        </form>
      )}

      {!noteForm && (
        <div className="flex gap-2">
          <button onClick={() => setNoteForm('note')} className="btn-secondary text-xs flex-1 inline-flex items-center justify-center gap-1.5">
            <PenLine size={13} /> Add timeline note
          </button>
          <button onClick={() => setNoteForm('notify')} className="btn-primary text-xs flex-1 inline-flex items-center justify-center gap-1.5">
            <Megaphone size={13} /> Notify participants
          </button>
        </div>
      )}
    </div>
  )
}
