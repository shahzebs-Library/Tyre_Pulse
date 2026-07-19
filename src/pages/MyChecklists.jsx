import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ClipboardCheck, Play, SkipForward, Eye, RefreshCw, AlertTriangle,
  CheckCircle2, Clock, CalendarClock, ListChecks, Zap, MapPin, Boxes,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { listAssignments, skipAssignment, generateNow } from '../lib/api/checklistSchedules'
import { toUserMessage } from '../lib/safeError'

// "Tables not deployed yet" heuristic — mirrors Billing.jsx / Checklists.jsx.
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

// ── Date helpers (null-safe) ────────────────────────────────────────────────
const MS_DAY = 86400000

function startOfDay(d) {
  const x = new Date(d)
  if (Number.isNaN(x.getTime())) return null
  x.setHours(0, 0, 0, 0)
  return x
}

/** Whole-day delta between a due date and today. Negative ⇒ overdue. Null-safe. */
function dueDeltaDays(due) {
  if (!due) return null
  const d = startOfDay(due)
  const today = startOfDay(new Date())
  if (!d || !today) return null
  return Math.round((d.getTime() - today.getTime()) / MS_DAY)
}

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Human relative hint for a due date. Returns { text, tone }. */
function dueHint(due, status) {
  if (status === 'completed') return { text: 'Completed', tone: 'green' }
  if (status === 'skipped') return { text: 'Skipped', tone: 'muted' }
  const delta = dueDeltaDays(due)
  if (delta == null) return { text: 'No due date', tone: 'muted' }
  if (delta < 0) {
    const n = Math.abs(delta)
    return { text: `${n} day${n === 1 ? '' : 's'} overdue`, tone: 'red' }
  }
  if (delta === 0) return { text: 'Due today', tone: 'amber' }
  if (delta === 1) return { text: 'Due tomorrow', tone: 'amber' }
  return { text: `Due in ${delta} days`, tone: 'muted' }
}

// A pending assignment whose due date has already passed is effectively overdue,
// even if the nightly generator hasn't restamped its status yet.
function effectiveStatus(a) {
  const s = String(a?.status || 'pending').toLowerCase()
  if (s === 'pending') {
    const delta = dueDeltaDays(a?.due_date)
    if (delta != null && delta < 0) return 'overdue'
  }
  return s
}

const TONE_TEXT = {
  red: 'text-red-400',
  amber: 'text-amber-400',
  green: 'text-green-400',
  muted: 'text-[var(--text-muted)]',
}

const STATUS_BADGE = {
  overdue: 'bg-red-900/40 text-red-300 border border-red-700/50',
  pending: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  completed: 'bg-green-900/40 text-green-300 border border-green-700/50',
  skipped: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}
function statusBadge(s) {
  return STATUS_BADGE[s] || STATUS_BADGE.skipped
}
function prettyStatus(s) {
  return String(s || '').replace(/\b\w/g, (c) => c.toUpperCase())
}

const TABS = [
  { key: 'todo', label: 'To do' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'pending', label: 'Pending' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
]

export default function MyChecklists() {
  const navigate = useNavigate()
  const { activeCountry } = useSettings()

  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [tab, setTab] = useState('todo')
  const [generating, setGenerating] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [toast, setToast] = useState(null) // { kind:'success'|'error', msg }

  const showToast = useCallback((kind, msg) => {
    setToast({ kind, msg })
    window.clearTimeout(showToast._t)
    showToast._t = window.setTimeout(() => setToast(null), 4000)
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError(''); setMissing(false)
    try {
      const rows = await listAssignments({ country: activeCountry })
      setAssignments(Array.isArray(rows) ? rows : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setMissing(true)
      else setError(toUserMessage(err, 'Could not load your checklists.'))
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Decorate with derived status + sort once, reuse everywhere.
  const decorated = useMemo(() => {
    const rank = { overdue: 0, pending: 1, completed: 2, skipped: 3 }
    return (assignments || [])
      .map((a) => ({ ...a, _status: effectiveStatus(a) }))
      .sort((x, y) => {
        const r = (rank[x._status] ?? 9) - (rank[y._status] ?? 9)
        if (r !== 0) return r
        // Within a status: oldest due date first (most urgent on top).
        const dx = x.due_date ? new Date(x.due_date).getTime() : Infinity
        const dy = y.due_date ? new Date(y.due_date).getTime() : Infinity
        return dx - dy
      })
  }, [assignments])

  const kpis = useMemo(() => {
    let overdue = 0, pending = 0, completed = 0
    for (const a of decorated) {
      if (a._status === 'overdue') overdue++
      else if (a._status === 'pending') pending++
      else if (a._status === 'completed') completed++
    }
    return { overdue, pending, completed, total: decorated.length }
  }, [decorated])

  const visible = useMemo(() => {
    switch (tab) {
      case 'overdue': return decorated.filter((a) => a._status === 'overdue')
      case 'pending': return decorated.filter((a) => a._status === 'pending')
      case 'completed': return decorated.filter((a) => a._status === 'completed')
      case 'all': return decorated
      case 'todo':
      default: return decorated.filter((a) => a._status === 'overdue' || a._status === 'pending')
    }
  }, [decorated, tab])

  const handleGenerate = useCallback(async () => {
    setGenerating(true); setError('')
    try {
      const res = await generateNow()
      const count = typeof res === 'number' ? res : (res?.count ?? res?.generated ?? null)
      await load()
      showToast('success', count != null
        ? `Generated ${count} due checklist${count === 1 ? '' : 's'}.`
        : 'Due checklists refreshed.')
    } catch (err) {
      if (isMissingRelation(err)) setMissing(true)
      showToast('error', toUserMessage(err, 'Could not generate due checklists.'))
    } finally {
      setGenerating(false)
    }
  }, [load, showToast])

  const handleSkip = useCallback(async (a) => {
    if (!a?.id) return
    if (!window.confirm(`Skip "${a.template_name || 'this checklist'}"? It will be marked skipped and removed from your to-do list.`)) return
    setBusyId(a.id); setError('')
    try {
      await skipAssignment(a.id)
      setAssignments((prev) => prev.map((r) => r.id === a.id ? { ...r, status: 'skipped' } : r))
      showToast('success', 'Assignment skipped.')
    } catch (err) {
      showToast('error', toUserMessage(err, 'Could not skip this assignment.'))
    } finally {
      setBusyId(null)
    }
  }, [showToast])

  const start = useCallback((a) => {
    if (!a?.template_id || !a?.id) return
    navigate(`/checklists/${a.template_id}/run?assignment=${a.id}`)
  }, [navigate])

  const kpiCards = [
    { key: 'overdue', label: 'Overdue', value: kpis.overdue, icon: AlertTriangle, tone: 'red',
      cls: 'text-red-400', ring: 'border-red-700/40 bg-red-900/10' },
    { key: 'pending', label: 'Due (pending)', value: kpis.pending, icon: Clock, tone: 'amber',
      cls: 'text-amber-400', ring: 'border-amber-700/40 bg-amber-900/10' },
    { key: 'completed', label: 'Completed', value: kpis.completed, icon: CheckCircle2, tone: 'green',
      cls: 'text-green-400', ring: 'border-green-700/40 bg-green-900/10' },
  ]

  const headerActions = (
    <button
      onClick={handleGenerate}
      disabled={generating || missing}
      className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-50"
      title="Materialise any checklist assignments that are due right now"
    >
      <Zap size={15} className={generating ? 'animate-pulse' : ''} />
      {generating ? 'Generating…' : 'Generate due now'}
    </button>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Checklists"
        subtitle="Checklist assignments due to you — start, complete, or skip scheduled inspections."
        icon={ClipboardCheck}
        badge={!loading && !missing ? `${kpis.overdue + kpis.pending} to do` : undefined}
        actions={headerActions}
        onRefresh={load}
        refreshing={loading}
        updatedAt={updatedAt}
      />

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-50 max-w-sm rounded-xl px-4 py-3 text-sm shadow-lg border flex items-start gap-2 ${
            toast.kind === 'success'
              ? 'bg-green-900/80 border-green-700/60 text-green-100'
              : 'bg-red-900/80 border-red-700/60 text-red-100'
          }`}
        >
          {toast.kind === 'success'
            ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
          <span>{toast.msg}</span>
        </div>
      )}

      {/* KPI strip */}
      {!missing && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {kpiCards.map(({ key, label, value, icon: Icon, cls, ring }) => (
            <div key={key} className={`card flex items-center gap-4 border ${ring}`}>
              <div className="w-11 h-11 rounded-xl bg-[var(--surface-2)] flex items-center justify-center shrink-0">
                <Icon size={20} className={cls} />
              </div>
              <div>
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">{label}</p>
                {loading
                  ? <div className="h-7 w-10 mt-1 bg-[var(--input-bg)] rounded animate-pulse" />
                  : <p className={`text-3xl font-bold ${cls}`}>{value}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Status tabs */}
      {!missing && (
        <div className="flex items-center gap-1 border-b border-[var(--border-dim)] overflow-x-auto">
          {TABS.map(({ key, label }) => {
            const count =
              key === 'overdue' ? kpis.overdue
              : key === 'pending' ? kpis.pending
              : key === 'completed' ? kpis.completed
              : key === 'todo' ? kpis.overdue + kpis.pending
              : kpis.total
            return (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`px-4 py-2.5 text-sm font-medium flex items-center gap-2 border-b-2 -mb-px whitespace-nowrap transition-colors ${
                  tab === key
                    ? 'border-green-500 text-green-400'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {label}
                {!loading && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--surface-2)] text-[var(--text-muted)]">{count}</span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* Migration hint (tables not deployed) */}
      {missing && (
        <div className="card border border-amber-800/50">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-amber-300 font-medium">Checklist scheduling isn't enabled on this database yet.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">
                Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V124_CHECKLIST_SCHEDULES.sql</span> to create the
                {' '}<span className="font-mono">checklist_schedules</span> and <span className="font-mono">checklist_assignments</span> tables, then reload.
              </p>
              <button onClick={load} className="btn-secondary text-sm mt-3 inline-flex items-center gap-2">
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && !missing && (
        <div className="card border border-red-800/50">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-red-300 font-medium">Couldn't load your checklists.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
              <button onClick={load} className="btn-secondary text-sm mt-3 inline-flex items-center gap-2">
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !missing && !error && (
        <div className="card p-0 overflow-hidden">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-4 p-4 border-t border-[var(--border-dim)] first:border-t-0 animate-pulse">
              <div className="h-4 w-48 bg-[var(--input-bg)] rounded" />
              <div className="h-4 w-28 bg-[var(--input-bg)] rounded ml-auto" />
              <div className="h-8 w-20 bg-[var(--input-bg)] rounded" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && !missing && !error && visible.length === 0 && (
        <div className="card text-center py-16 space-y-3">
          {kpis.overdue + kpis.pending === 0 ? (
            <>
              <CheckCircle2 size={36} className="mx-auto text-green-400" />
              <p className="text-[var(--text-primary)] font-semibold">You're all caught up — no checklists due</p>
              <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">
                Scheduled assignments will appear here as they come due. Browse published checklists to run one on demand.
              </p>
            </>
          ) : (
            <>
              <ListChecks size={34} className="mx-auto text-[var(--text-muted)]" />
              <p className="text-[var(--text-primary)] font-semibold">Nothing in this view</p>
              <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">
                Try the <button onClick={() => setTab('todo')} className="text-green-400 hover:underline">To do</button> tab to see what's due.
              </p>
            </>
          )}
          <Link to="/checklists" className="btn-secondary text-sm inline-flex items-center gap-2 mx-auto">
            <ListChecks size={15} /> Browse checklists
          </Link>
        </div>
      )}

      {/* Assignment table */}
      {!loading && !missing && !error && visible.length > 0 && (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-header text-left">Checklist</th>
                <th className="table-header text-left">Target</th>
                <th className="table-header text-left">Due</th>
                <th className="table-header text-left">Status</th>
                <th className="table-header text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => {
                const status = a._status
                const hint = dueHint(a.due_date, status)
                const actionable = status === 'overdue' || status === 'pending'
                const rowBusy = busyId === a.id
                return (
                  <tr key={a.id} className="border-t border-[var(--border-dim)] align-top">
                    <td className="table-cell">
                      <div className="font-medium text-[var(--text-primary)]">{a.template_name || 'Checklist'}</div>
                      {a.assignee_role && (
                        <div className="text-xs text-[var(--text-muted)] mt-0.5">Role: {a.assignee_role}</div>
                      )}
                    </td>
                    <td className="table-cell">
                      <div className="flex flex-col gap-0.5 text-xs">
                        {a.site && (
                          <span className="inline-flex items-center gap-1 text-[var(--text-primary)]">
                            <MapPin size={12} className="text-[var(--text-muted)]" /> {a.site}
                          </span>
                        )}
                        {a.asset_no && (
                          <span className="inline-flex items-center gap-1 text-[var(--text-muted)]">
                            <Boxes size={12} /> {a.asset_no}
                          </span>
                        )}
                        {!a.site && !a.asset_no && <span className="text-[var(--text-muted)]">—</span>}
                      </div>
                    </td>
                    <td className="table-cell whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5 text-[var(--text-primary)]">
                        <CalendarClock size={13} className="text-[var(--text-muted)]" /> {fmtDate(a.due_date)}
                      </div>
                      <div className={`text-xs mt-0.5 ${TONE_TEXT[hint.tone] || TONE_TEXT.muted}`}>{hint.text}</div>
                    </td>
                    <td className="table-cell">
                      <span className={`badge text-xs ${statusBadge(status)}`}>{prettyStatus(status)}</span>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center justify-end gap-2">
                        {actionable && (
                          <>
                            <button
                              onClick={() => start(a)}
                              disabled={rowBusy}
                              className="btn-primary text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
                            >
                              <Play size={13} /> Start
                            </button>
                            <button
                              onClick={() => handleSkip(a)}
                              disabled={rowBusy}
                              className="btn-secondary text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
                              title="Skip this assignment"
                            >
                              {rowBusy ? <RefreshCw size={13} className="animate-spin" /> : <SkipForward size={13} />} Skip
                            </button>
                          </>
                        )}
                        {status === 'completed' && (
                          a.submission_id ? (
                            <Link
                              to={`/checklists/submission/${a.submission_id}`}
                              className="btn-secondary text-xs inline-flex items-center gap-1.5"
                            >
                              <Eye size={13} /> View
                            </Link>
                          ) : (
                            <span className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1.5">
                              <CheckCircle2 size={13} className="text-green-400" /> Done
                            </span>
                          )
                        )}
                        {status === 'skipped' && (
                          <button
                            onClick={() => start(a)}
                            className="btn-secondary text-xs inline-flex items-center gap-1.5"
                            title="Run this checklist anyway"
                          >
                            <Play size={13} /> Run anyway
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
