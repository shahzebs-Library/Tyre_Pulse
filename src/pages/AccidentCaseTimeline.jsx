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
 *
 * M1 parity (2026-09-16): SLA-met badge, a chevron on every row opening a
 * right-hand detail drawer (event, actor, related case tab), the delivery log
 * as Trigger | Recipients | Channel | Status | Time | row menu, honest status
 * labels (Delivered n/n only when per-recipient delivery is recorded), and the
 * "Manage recipient groups" row routing Admins to the routing rules.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft, Bell, Users as UsersIcon, ListChecks, Mail, Truck, Clock, FileText,
  ShieldCheck, Settings, ChevronRight, PenLine, Megaphone, Circle, AlertTriangle,
  Loader2, X, Copy, ExternalLink, MoreHorizontal, CheckCircle2, Search, RefreshCw,
  FileSpreadsheet, Activity, Hourglass, RotateCcw,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import CaseSlaHeader from '../components/accidents/CaseSlaHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import useAnchoredPopover from '../components/ui/useAnchoredPopover'
import { loadCase } from '../lib/api/accidentCase'
import { loadCaseTimeline } from '../lib/api/caseTimelineFeed'
import { logCommunication, COMMS_CHANNELS } from '../lib/api/accidentCommunications'
import { FILTERS, durationLabel, recipientsLabel, deliveryStatusLabel, channelLabel, relatedTabFor } from '../lib/caseTimelineFeed'
import {
  summarizeTimeline, filterEntries, sortNotifications, notificationChannels, filterNotifications,
  notificationRows, timelineExportRows, TIMELINE_EXPORT_COLS, TIMELINE_EXPORT_HEADERS, categoryLabel,
} from '../lib/accidentCaseTimelineAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { TIMELINE_TABS } from '../lib/accidentCaseVocab'
import { toUserMessage } from '../lib/safeError'
import { useAuth } from '../contexts/AuthContext'

const ICON_BY_KEY = { report: FileText, workstream: ShieldCheck, mail: Mail, handover: Truck, document: FileText, sla: Clock }
const STATUS_META = {
  completed: { label: 'Completed', tone: 'text-green-400 bg-green-900/20 border-green-700/50' },
  in_progress: { label: 'In transit', tone: 'text-blue-300 bg-blue-900/20 border-blue-700/50' },
  pending: { label: 'Pending', tone: 'text-amber-400 bg-amber-900/20 border-amber-700/50' },
}
const DOT_TONE = { completed: 'bg-green-500 border-green-400', in_progress: 'bg-blue-500 border-blue-400', pending: 'bg-amber-500 border-amber-400' }

// Tab strip keys follow TIMELINE_TABS (the shared vocabulary) so the Flutter
// screen and this page cannot drift on names or order.
const TAB_ICON = { Timeline: ListChecks, Notifications: Bell, Participants: UsersIcon }
const TABS = TIMELINE_TABS.map((label) => ({ key: label.toLowerCase(), label, icon: TAB_ICON[label] || Circle }))

const EMPTY_FEED = { entries: [], notifications: [], participants: [], groupCounts: new Map(), evidence: [] }

export function fmtTime(iso) {
  if (!iso) return 'N/A'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return `${d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}`
}

const isAdminProfile = (profile) => profile?.is_super_admin === true || String(profile?.role || '').toLowerCase() === 'admin'

async function copyText(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch { /* clipboard blocked - the caller reports it */ }
  return false
}

/** One communication row rendered as plain text for the copy action. */
function notificationText(n, groupCounts) {
  return [
    n.subject || 'Notification',
    `Recipients: ${recipientsLabel(n, groupCounts).label}`,
    `Channel: ${channelLabel(n.channel)}`,
    `Status: ${deliveryStatusLabel(n)}`,
    `Time: ${fmtTime(n.occurred_at)}`,
    n.body ? `Body: ${n.body}` : null,
  ].filter(Boolean).join('\n')
}

export default function AccidentCaseTimeline() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [acc, setAcc] = useState(null)
  const [caseData, setCaseData] = useState(null)
  const [feed, setFeed] = useState(EMPTY_FEED)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [err, setErr] = useState('')
  const [partial, setPartial] = useState('')
  const [notice, setNotice] = useState('')
  const [tab, setTab] = useState('timeline')
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [channel, setChannel] = useState('all')
  const [selected, setSelected] = useState(null) // timeline entry OR notification row shown in the dialog
  const [noteForm, setNoteForm] = useState(null) // 'note' | 'notify' | null
  const [noteText, setNoteText] = useState('')
  const [noteChannel, setNoteChannel] = useState('in_app')
  const [saving, setSaving] = useState(false)
  const loadedOnce = useRef(false)

  const load = useCallback(async () => {
    if (loadedOnce.current) setRefreshing(true)
    else setLoading(true)
    setErr(''); setPartial('')
    try {
      const { data, error } = await supabase.from('accidents').select('*').eq('id', id).single()
      if (error || !data) { setErr(toUserMessage(error, 'Accident record not found.')); return }
      setAcc(data)
      let feedFailed = false
      const [cd, tf] = await Promise.all([
        loadCase(id, { country: data.country }).catch(() => null),
        loadCaseTimeline(data).catch(() => { feedFailed = true; return EMPTY_FEED }),
      ])
      setCaseData(cd)
      setFeed({ ...EMPTY_FEED, ...(tf || {}) })
      // A failed feed read must not look like a case with no history.
      if (feedFailed) setPartial('The timeline feed could not be loaded. The lists below may be incomplete.')
      loadedOnce.current = true
    } catch (e) {
      setErr(toUserMessage(e, 'Could not load the case timeline.'))
    } finally {
      setLoading(false); setRefreshing(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  // One clock read per render so every derived figure agrees within a paint.
  const nowMs = Date.now()
  const summary = useMemo(() => summarizeTimeline(feed, nowMs), [feed, nowMs])
  const entries = useMemo(() => filterEntries(feed.entries, { category: filter, search }), [feed.entries, filter, search])
  const notifications = useMemo(() => sortNotifications(feed.notifications), [feed.notifications])
  const channelOptions = useMemo(() => notificationChannels(notifications), [notifications])
  const notificationTableRows = useMemo(
    () => notificationRows(filterNotifications(notifications, { channel }), feed.groupCounts, nowMs),
    [notifications, channel, feed.groupCounts, nowMs],
  )
  const canManageRecipients = isAdminProfile(profile)
  const caseLabel = [acc?.reference_no, acc?.asset_no].filter(Boolean).join(' ') || 'Accident case'

  const openRelatedTab = useCallback((tabKey) => {
    navigate(`/accidents/${id}?tab=${encodeURIComponent(tabKey || 'overview')}`, { state: { openTab: tabKey || 'overview' } })
  }, [navigate, id])

  const copyNotification = useCallback(async (n) => {
    const ok = await copyText(notificationText(n, feed.groupCounts))
    setNotice(ok ? 'Copied to clipboard.' : 'Could not copy - your browser blocked clipboard access.')
    setTimeout(() => setNotice(''), 2500)
  }, [feed.groupCounts])

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

  function exportTimeline(kind) {
    const rows = timelineExportRows(entries, fmtTime)
    const name = reportFileName('Case Timeline', caseLabel)
    if (kind === 'pdf') {
      exportToPdf(rows, TIMELINE_EXPORT_COLS.map((key, i) => ({ key, header: TIMELINE_EXPORT_HEADERS[i] })),
        `Case timeline ${caseLabel}`, name, 'landscape')
    } else {
      exportToExcel(rows, TIMELINE_EXPORT_COLS, TIMELINE_EXPORT_HEADERS, name, 'Timeline')
    }
  }

  const notificationColumns = useMemo(() => [
    { id: 'trigger', header: 'Trigger', accessorFn: (r) => r.trigger, size: 260,
      cell: ({ row }) => <span className="text-[var(--text-primary)]">{row.original.trigger}</span> },
    { id: 'recipients', header: 'Recipients', accessorFn: (r) => r.recipients, size: 180 },
    { id: 'channel', header: 'Channel', accessorFn: (r) => r.channelText, size: 110 },
    { id: 'status', header: 'Status', accessorFn: (r) => r.statusText, size: 130 },
    { id: 'time', header: 'Time', accessorFn: (r) => r.occurredMs ?? -1, size: 130,
      cell: ({ row }) => <span className="text-[var(--text-muted)] whitespace-nowrap">{fmtTime(row.original.occurred_at)}</span>,
      meta: { exportValue: (r) => fmtTime(r.occurred_at) } },
    { id: 'actions', header: () => <span className="sr-only">Actions</span>, enableSorting: false, size: 64,
      meta: { export: false, align: 'right' },
      cell: ({ row }) => (
        <NotificationRowMenu
          n={row.original}
          onCopy={copyNotification}
          onOpenTab={() => openRelatedTab(relatedTabFor(row.original.workstream_key, 'log'))}
          onDetails={() => setSelected({ kind: 'notification', row: row.original })}
        />
      ) },
  ], [copyNotification, openRelatedTab])

  const participantColumns = useMemo(() => [
    { id: 'name', header: 'Participant', accessorFn: (r) => r.name, size: 240,
      cell: ({ row }) => <span className="text-[var(--text-primary)]">{row.original.name}</span> },
    { id: 'roles', header: 'Roles on this case', accessorFn: (r) => (r.roles || []).join(', ') || 'Not set' },
  ], [])

  if (loading) {
    return (
      <div className="p-6 space-y-3" role="status" aria-live="polite">
        <div className="flex items-center gap-2 text-[var(--text-muted)]">
          <Loader2 size={16} className="animate-spin" /> Loading the case timeline...
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((k) => <div key={k} className="h-16 rounded-lg bg-[var(--input-bg)] animate-pulse" />)}
        </div>
      </div>
    )
  }
  if (!acc) {
    return (
      <div className="p-6 space-y-3">
        <button onClick={() => navigate('/accidents')} className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] min-h-[44px]"><ArrowLeft size={15} /> Back to Accidents</button>
        <div className="card flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="text-[var(--text-primary)] font-medium">Could not open this case timeline.</p>
            <p className="text-sm text-[var(--text-muted)] mt-1">{err || 'Accident record not found.'}</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5"><RotateCcw size={14} /> Retry</button>
        </div>
      </div>
    )
  }

  const kpis = [
    { key: 'entries', label: 'Timeline entries', value: summary.entries, icon: ListChecks, sub: `${summary.completed} completed` },
    { key: 'pending', label: 'Open steps', value: summary.pending + summary.inProgress, icon: Hourglass, sub: `${summary.pending} pending, ${summary.inProgress} in transit` },
    { key: 'sla', label: 'SLA met', value: summary.slaMetPct == null ? 'N/A' : `${summary.slaMetPct}%`, icon: CheckCircle2, sub: summary.slaEntries ? `${summary.slaMet} of ${summary.slaEntries} SLA entries` : 'No SLA entries yet' },
    { key: 'notifications', label: 'Notifications logged', value: summary.notifications, icon: Bell, sub: `${summary.outbound} outbound` },
    { key: 'participants', label: 'Participants', value: summary.participants, icon: UsersIcon, sub: 'Named across the case' },
    { key: 'last', label: 'Last activity', value: summary.sinceLastActivityLabel ? `${summary.sinceLastActivityLabel} ago` : 'N/A', icon: Activity, sub: summary.spanLabel ? `Case history spans ${summary.spanLabel}` : 'No elapsed history yet' },
  ]

  return (
    <div className="space-y-4 pb-10 max-w-5xl">
      <button
        onClick={() => navigate(`/accidents/${id}`)}
        className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] min-h-[44px]"
      >
        <ArrowLeft size={15} /> Back to case
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-[var(--text-primary)]">Case timeline &amp; notifications</h1>
          <p className="text-sm text-[var(--text-muted)] mt-0.5 font-mono break-words">
            {[acc.reference_no, acc.asset_no].filter(Boolean).join(' · ') || 'N/A'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={load} disabled={refreshing} className="btn-secondary text-xs inline-flex items-center gap-1.5 min-h-[36px]">
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} /> {refreshing ? 'Refreshing' : 'Refresh'}
          </button>
          <button type="button" onClick={() => exportTimeline('excel')} disabled={!entries.length} className="btn-secondary text-xs inline-flex items-center gap-1.5 min-h-[36px]">
            <FileSpreadsheet size={13} /> Excel
          </button>
          <button type="button" onClick={() => exportTimeline('pdf')} disabled={!entries.length} className="btn-secondary text-xs inline-flex items-center gap-1.5 min-h-[36px]">
            <FileText size={13} /> PDF
          </button>
        </div>
      </div>

      <CaseSlaHeader acc={acc} workstreams={caseData?.workstreams} />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" aria-label="Case timeline summary">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.key} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2.5 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-[var(--text-muted)] truncate">{k.label}</p>
                <Icon size={13} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" />
              </div>
              <p className="text-lg font-bold text-[var(--text-primary)] tabular-nums">{k.value}</p>
              <p className="text-[10px] text-[var(--text-muted)] truncate" title={k.sub}>{k.sub}</p>
            </div>
          )
        })}
      </div>

      {err && <p className="text-red-400 text-xs flex items-center gap-1.5" role="alert"><AlertTriangle size={12} /> {err}</p>}
      {partial && (
        <div className="rounded-lg border border-amber-700/50 px-3 py-2 flex items-center gap-2 text-xs text-[var(--text-secondary)]" role="alert">
          <AlertTriangle size={13} className="text-amber-400 shrink-0" />
          <span className="flex-1">{partial}</span>
          <button type="button" onClick={load} className="btn-secondary text-xs inline-flex items-center gap-1"><RotateCcw size={12} /> Retry</button>
        </div>
      )}
      {notice && <p className="text-xs text-[var(--text-muted)]" role="status">{notice}</p>}

      {/* Sub-tabs */}
      <div className="flex gap-6 border-b border-[var(--input-border)] overflow-x-auto" role="tablist">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`pb-2.5 pt-2 text-sm font-medium flex items-center gap-1.5 border-b-2 -mb-px whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-green-500 ${
              tab === key ? 'border-green-500 text-green-400' : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'timeline' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                aria-pressed={filter === f.key}
                className={`px-3 py-1.5 min-h-[36px] rounded-lg text-xs font-medium border ${
                  filter === f.key ? 'bg-[var(--text-primary)] text-[var(--bg-base,#0b0f0d)] border-transparent' : 'border-[var(--input-border)] text-[var(--text-secondary)]'
                }`}
              >
                {f.label}
              </button>
            ))}
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <label htmlFor="timeline-search" className="sr-only">Search the timeline</label>
              <input
                id="timeline-search"
                type="search"
                className="input pl-9 w-full text-sm"
                placeholder="Search event, actor, details"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <span className="text-xs text-[var(--text-muted)]">{entries.length} of {feed.entries.length}</span>
          </div>

          {entries.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)] py-6 text-center">
              {search.trim()
                ? 'No timeline entries match that search.'
                : `No timeline entries ${filter === 'all' ? 'recorded' : `in "${categoryLabel(filter)}"`} yet.`}
            </p>
          ) : (
            <ol className="mt-2">
              {entries.map((e, i) => {
                const Icon = ICON_BY_KEY[e.iconKey] || Circle
                const meta = STATUS_META[e.status] || STATUS_META.completed
                const dur = durationLabel(e.durationMs)
                return (
                  <li key={e.id} className="flex gap-3" data-testid="timeline-row">
                    <div className="flex flex-col items-center">
                      <span className={`mt-1 w-3 h-3 rounded-full border-2 shrink-0 ${DOT_TONE[e.status] || DOT_TONE.completed}`} aria-hidden="true" />
                      {i < entries.length - 1 && <span className="w-px flex-1 bg-[var(--input-border)] my-0.5" />}
                    </div>
                    <div className={`flex-1 min-w-0 flex items-start gap-3 ${i < entries.length - 1 ? 'pb-5' : ''}`}>
                      <div className="w-8 h-8 rounded-full bg-[var(--input-bg)] border border-[var(--input-border)] flex items-center justify-center shrink-0 mt-0.5">
                        <Icon size={14} className="text-[var(--text-muted)]" aria-hidden="true" />
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
                          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                            {e.detail && <p className="text-xs text-[var(--text-secondary)]">{e.detail}</p>}
                            {(e.chips || []).map((c) => (
                              <span key={c} className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--input-border)] text-[var(--text-secondary)]">{c}</span>
                            ))}
                          </div>
                          <div className="flex items-center gap-2 ml-auto">
                            {e.slaMet && (
                              <span className="badge text-[11px] border text-green-400 bg-green-900/20 border-green-700/50 inline-flex items-center gap-1" data-testid="sla-met-badge">
                                <CheckCircle2 size={11} /> SLA met
                              </span>
                            )}
                            <span className={`badge text-[11px] border ${meta.tone}`}>{meta.label}</span>
                            {dur && <span className="text-[11px] text-[var(--text-muted)]">{dur}</span>}
                            <button
                              type="button"
                              aria-label={`Open details for ${e.title}`}
                              onClick={() => setSelected({ kind: 'entry', row: e })}
                              className="p-2 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]"
                            >
                              <ChevronRight size={14} />
                            </button>
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
              <Mail size={14} className="text-[var(--text-muted)]" aria-hidden="true" />
              <p className="text-sm font-semibold text-[var(--text-primary)]">Notification delivery log</p>
              <span className="text-xs text-[var(--text-muted)] ml-auto">Latest {Math.min(3, notifications.length)} of {notifications.length}</span>
            </div>
            {notifications.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] px-3 py-4">No notifications logged for this case yet.</p>
            ) : (
              <div className="divide-y divide-[var(--input-border)]">
                {notifications.slice(0, 3).map((n) => (
                  <div key={n.id} className="px-3 py-2 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-0.5 text-xs">
                    <span className="text-[var(--text-primary)] truncate">{n.subject || channelLabel(n.channel)}</span>
                    <span className="text-[var(--text-muted)] truncate">{recipientsLabel(n, feed.groupCounts).label}</span>
                    <span className="text-[var(--text-muted)] whitespace-nowrap">{deliveryStatusLabel(n)}</span>
                    <span className="text-[var(--text-muted)] whitespace-nowrap">{fmtTime(n.occurred_at)}</span>
                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setTab('notifications')} className="w-full text-center text-xs text-blue-400 py-2.5 border-t border-[var(--input-border)] hover:text-blue-300">
              View all notifications
            </button>
          </div>
        </>
      )}

      {tab === 'notifications' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="notification-channel" className="text-xs text-[var(--text-muted)]">Channel</label>
            <select
              id="notification-channel"
              className="input text-xs"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            >
              <option value="all">All channels</option>
              {channelOptions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <span className="text-xs text-[var(--text-muted)] ml-auto">
              Status reads Sent, Received or Logged. Per-recipient delivery is not recorded yet.
            </span>
          </div>
          <div data-testid="delivery-log" className="rounded-lg border border-[var(--input-border)]">
            <EnterpriseTable
              columns={notificationColumns}
              data={notificationTableRows}
              getRowId={(r) => String(r.id)}
              enableColumnFilters={false}
              searchPlaceholder="Search trigger, recipients, status"
              emptyMessage={channel === 'all' ? 'No notifications logged for this case yet.' : 'No notifications on this channel.'}
              emptyIcon={<Bell size={22} className="opacity-60" />}
              initialPageSize={25}
              exportFileName={reportFileName('Case Notifications', caseLabel)}
              reportMeta={{ title: `Case notifications ${caseLabel}` }}
            />
          </div>
        </div>
      )}

      {tab === 'participants' && (
        <div className="rounded-lg border border-[var(--input-border)]">
          <EnterpriseTable
            columns={participantColumns}
            data={feed.participants || []}
            getRowId={(r, i) => `${r.name}-${i}`}
            enableColumnFilters={false}
            searchPlaceholder="Search participants or roles"
            emptyMessage="No participants recorded for this case yet."
            emptyIcon={<UsersIcon size={22} className="opacity-60" />}
            exportFileName={reportFileName('Case Participants', caseLabel)}
            reportMeta={{ title: `Case participants ${caseLabel}` }}
          />
        </div>
      )}

      {/* Manage recipient groups - recipients are set by Admin per event and
          role in the accident routing rules (/accident-workflow-settings).
          Non-admins see the row disabled with the reason, never a dead link. */}
      <button
        type="button"
        onClick={() => { if (canManageRecipients) navigate('/accident-workflow-settings') }}
        disabled={!canManageRecipients}
        aria-disabled={!canManageRecipients}
        title={canManageRecipients ? 'Open the accident routing rules' : 'Only an Admin can change recipient groups. Ask an Admin to update the routing rules.'}
        className={`w-full rounded-lg border border-[var(--input-border)] px-3 py-3 flex items-center gap-3 text-left ${canManageRecipients ? 'hover:border-[var(--text-muted)]' : 'opacity-60 cursor-not-allowed'}`}
      >
        <Settings size={16} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[var(--text-primary)]">Manage recipient groups</p>
          <p className="text-xs text-[var(--text-muted)]">Recipients are set by Admin per event and role.</p>
        </div>
        <ChevronRight size={16} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" />
      </button>

      {noteForm && (
        <form onSubmit={submitNote} className="rounded-lg border border-[var(--input-border)] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-[var(--text-primary)]">{noteForm === 'notify' ? 'Notify participants' : 'Add timeline note'}</p>
            <button type="button" onClick={() => setNoteForm(null)} aria-label="Close the note form" className="p-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={14} /></button>
          </div>
          {noteForm === 'notify' && (
            <>
              <label htmlFor="note-channel" className="sr-only">Channel</label>
              <select id="note-channel" className="input w-full text-xs" value={noteChannel} onChange={(e) => setNoteChannel(e.target.value)}>
                {COMMS_CHANNELS.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
              </select>
            </>
          )}
          <label htmlFor="note-text" className="sr-only">{noteForm === 'notify' ? 'Notification message' : 'Timeline note'}</label>
          <textarea id="note-text" rows={3} className="input w-full text-xs" value={noteText} onChange={(e) => setNoteText(e.target.value)}
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
        <div className="flex flex-col sm:flex-row gap-2">
          <button onClick={() => setNoteForm('note')} className="btn-secondary text-xs flex-1 inline-flex items-center justify-center gap-1.5 min-h-[44px]">
            <PenLine size={13} /> Add timeline note
          </button>
          <button onClick={() => setNoteForm('notify')} className="btn-primary text-xs flex-1 inline-flex items-center justify-center gap-1.5 min-h-[44px]">
            <Megaphone size={13} /> Notify participants
          </button>
        </div>
      )}

      {/* Detail dialog (shared Modal: focus trap, Escape, backdrop close) */}
      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        size="md"
        title={selected?.kind === 'entry' ? 'Timeline entry details' : 'Notification details'}
        subtitle={selected ? (selected.kind === 'entry' ? selected.row.title : (selected.row.subject || 'Notification')) : null}
        footer={selected && (
          <div className="flex flex-wrap gap-2 justify-end">
            {selected.kind === 'notification' && (
              <button type="button" onClick={() => copyNotification(selected.row)} className="btn-ghost text-xs inline-flex items-center gap-1.5">
                <Copy size={12} /> Copy
              </button>
            )}
            <button
              type="button"
              onClick={() => openRelatedTab(selected.kind === 'entry' ? selected.row.relatedTab : relatedTabFor(selected.row.workstream_key, 'log'))}
              className="btn-secondary text-xs inline-flex items-center gap-1.5"
            >
              <ExternalLink size={12} /> Open related tab
            </button>
          </div>
        )}
      >
        {selected?.kind === 'entry' && (
          <dl className="space-y-2 text-xs">
            <DrawerRow label="When" value={fmtTime(selected.row.at)} />
            <DrawerRow label="Actor" value={selected.row.actor || 'Not set'} />
            <DrawerRow label="Category" value={categoryLabel(selected.row.category)} />
            <DrawerRow label="Status" value={(STATUS_META[selected.row.status] || STATUS_META.completed).label + (selected.row.slaMet ? ' · SLA met' : '')} />
            <DrawerRow label="Details" value={selected.row.detail || 'Not set'} />
            {(selected.row.chips || []).length > 0 && <DrawerRow label="Sub-details" value={selected.row.chips.join(' · ')} />}
            <DrawerRow label="Elapsed since previous" value={durationLabel(selected.row.durationMs) || 'First entry'} />
          </dl>
        )}
        {selected?.kind === 'notification' && (
          <dl className="space-y-2 text-xs">
            <DrawerRow label="When" value={fmtTime(selected.row.occurred_at)} />
            <DrawerRow label="Recipients" value={recipientsLabel(selected.row, feed.groupCounts).label} />
            <DrawerRow label="Channel" value={channelLabel(selected.row.channel)} />
            <DrawerRow label="Status" value={deliveryStatusLabel(selected.row)} />
            <DrawerRow label="Logged by" value={selected.row.author_name || 'Not set'} />
            <DrawerRow label="Body" value={selected.row.body || 'Not set'} />
          </dl>
        )}
      </Modal>
    </div>
  )
}

/** Row menu for the notification table. Portalled so the table's scroll box
 *  cannot clip it; arrow keys and focus return come from useAnchoredPopover. */
function NotificationRowMenu({ n, onCopy, onOpenTab, onDetails }) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const { triggerRef, panelRef, coords } = useAnchoredPopover(open, { width: 200, height: 130, align: 'right', nav: 'menu', onRequestClose: close })

  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => {
      if (triggerRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return
      setOpen(false)
    }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open, triggerRef, panelRef])

  const item = 'w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-[var(--input-bg)] text-[var(--text-primary)]'
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Row actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        className="p-2 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          role="menu"
          className="tp-popover min-w-[190px] overflow-hidden"
          style={coords ? { top: coords.top, left: coords.left } : undefined}
        >
          <button role="menuitem" type="button" onClick={() => { close(); onCopy(n) }} className={item}>
            <Copy size={12} /> Copy
          </button>
          <button role="menuitem" type="button" onClick={() => { close(); onOpenTab() }} className={item}>
            <ExternalLink size={12} /> Open related tab
          </button>
          <button role="menuitem" type="button" onClick={() => { close(); onDetails() }} className={item}>
            <ChevronRight size={12} /> Details
          </button>
        </div>,
        document.body,
      )}
    </>
  )
}

function DrawerRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[var(--input-border)] pb-2">
      <dt className="text-[var(--text-muted)] shrink-0">{label}</dt>
      <dd className="text-[var(--text-primary)] text-right break-words min-w-0">{value}</dd>
    </div>
  )
}
