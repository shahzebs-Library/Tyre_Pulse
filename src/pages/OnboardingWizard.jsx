/**
 * OnboardingWizard (route /onboarding) — guided tenant setup checklist. Walks a
 * new organisation through the phases required to go live on Tyre Pulse (account
 * setup, data import, configuration, team & roles, integrations, go-live) and
 * tracks activation progress so it is measurable and resumable across sessions.
 *
 * Runs on the new `onboarding_tasks` table (V199). Real data, an overall
 * completion ring + required-completion gauge + go-live readiness badge, KPI
 * tiles, a per-phase progress panel, a "what's next" queue, a grouped-by-phase
 * task list with inline status changes, create/edit modal, filters, search,
 * delete confirm, Excel/PDF export, and loading/empty/error/not-provisioned
 * states throughout. Progress roll-ups live in the pure `src/lib/onboarding.js`
 * helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Rocket, ListChecks, CheckCircle2, Ban, ClipboardCheck, Flag, ArrowRight,
  AlertTriangle, Search, X, Filter, FileSpreadsheet, FileText, Plus, Pencil,
  Trash2, Circle, PlayCircle, SkipForward, ExternalLink,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listOnboardingTasks, createOnboardingTask, updateOnboardingTask, deleteOnboardingTask,
} from '../lib/api/onboarding'
import {
  summariseOnboarding, phaseProgress, nextTasks, requiredCompletionPct,
  PHASE_ORDER, PHASE_LABELS,
} from '../lib/onboarding'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { safeHref } from '../lib/safeUrl'
import { toUserMessage } from '../lib/safeError'

const EMPTY_FORM = {
  title: '', phase: 'setup', description: '', sort_order: '', required: true,
  status: 'not_started', owner: '', due_date: '', help_url: '', notes: '',
}

const STATUS_META = {
  not_started: { label: 'Not started', icon: Circle, dot: 'text-[var(--text-muted)]', badge: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]' },
  in_progress: { label: 'In progress', icon: PlayCircle, dot: 'text-sky-400', badge: 'bg-sky-900/30 text-sky-300 border-sky-800/50' },
  completed: { label: 'Completed', icon: CheckCircle2, dot: 'text-green-400', badge: 'bg-green-900/30 text-green-300 border-green-800/50' },
  skipped: { label: 'Skipped', icon: SkipForward, dot: 'text-amber-400', badge: 'bg-amber-900/20 text-amber-300 border-amber-800/50' },
  blocked: { label: 'Blocked', icon: Ban, dot: 'text-red-400', badge: 'bg-red-900/30 text-red-300 border-red-800/50' },
}
const STATUS_OPTIONS = Object.keys(STATUS_META)

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

/** SVG progress ring. size/stroke in px, pct 0..100. */
function ProgressRing({ pct = 0, size = 128, stroke = 12, tone = '#22c55e', label }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, pct))
  const offset = c - (clamped / 100) * c
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--input-border)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 600ms ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold text-[var(--text-primary)]">{clamped}%</span>
        {label && <span className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mt-0.5">{label}</span>}
      </div>
    </div>
  )
}

function Bar({ pct = 0, tone = 'bg-green-500' }) {
  const w = Math.max(0, Math.min(100, pct))
  return (
    <div className="h-2 rounded-full bg-[var(--input-bg)] overflow-hidden">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${w}%`, transition: 'width 500ms ease' }} />
    </div>
  )
}

export default function OnboardingWizard() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [phaseFilter, setPhaseFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listOnboardingTasks({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load onboarding tasks.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseOnboarding(rows || []), [rows])
  const reqPct = useMemo(() => requiredCompletionPct(rows || []), [rows])
  const phases = useMemo(() => phaseProgress(rows || []), [rows])
  const queue = useMemo(() => nextTasks(rows || []).slice(0, 8), [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (phaseFilter && r.phase !== phaseFilter) return false
      if (statusFilter && r.status !== statusFilter) return false
      if (q) {
        const hay = `${r.title || ''} ${r.description || ''} ${r.owner || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, phaseFilter, statusFilter, search])

  // Grouped by phase in canonical order (only phases with visible tasks show).
  const grouped = useMemo(() => {
    return PHASE_ORDER.map((phase) => ({
      phase,
      tasks: filtered
        .filter((r) => r.phase === phase)
        .slice()
        .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)),
    })).filter((g) => g.tasks.length > 0)
  }, [filtered])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Total tasks', value: summary.totalTasks, icon: ListChecks, tone: 'text-[var(--text-primary)]' },
    { label: 'Completed', value: summary.completedCount, icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'Blocked', value: summary.blockedCount, icon: Ban, tone: 'text-red-400' },
    { label: 'Required remaining', value: summary.requiredRemaining, icon: ClipboardCheck, tone: 'text-amber-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['phase', 'title', 'status', 'required', 'owner', 'due_date', 'sort_order', 'notes']
  const EXPORT_HEADERS = ['Phase', 'Task', 'Status', 'Required', 'Owner', 'Due date', 'Order', 'Notes']
  const exportRows = filtered.map((r) => ({
    phase: PHASE_LABELS[r.phase] || r.phase || '',
    title: r.title || '',
    status: STATUS_META[r.status]?.label || r.status || '',
    required: r.required === false ? 'Optional' : 'Required',
    owner: r.owner || '',
    due_date: r.due_date || '',
    sort_order: r.sort_order ?? '',
    notes: r.notes || '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    const nextOrder = (rows || []).reduce((m, r) => Math.max(m, Number(r.sort_order) || 0), 0) + 1
    setEditing(null); setForm({ ...EMPTY_FORM, sort_order: String(nextOrder) }); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      title: r.title || '', phase: r.phase || 'setup', description: r.description || '',
      sort_order: r.sort_order ?? '', required: r.required !== false,
      status: r.status || 'not_started', owner: r.owner || '',
      due_date: r.due_date || '', help_url: r.help_url || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.title.trim()) { setFormError('A task title is required.'); return }
    if (form.sort_order !== '' && Number(form.sort_order) < 0) { setFormError('Sort order cannot be negative.'); return }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry !== 'All' ? activeCountry : null }
      if (editing) await updateOnboardingTask(editing.id, payload)
      else await createOnboardingTask(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the task.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  // Inline status change straight from the list.
  const changeStatus = useCallback(async (task, status) => {
    if (task.status === status) return
    setBusyId(task.id); setError('')
    try {
      await updateOnboardingTask(task.id, { status })
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not update the task status.'))
    } finally {
      setBusyId(null)
    }
  }, [load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteOnboardingTask(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the task.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setPhaseFilter(''); setStatusFilter(''); setSearch('') }
  const hasFilters = phaseFilter || statusFilter || search
  const ringTone = summary.readyForGoLive ? '#22c55e' : summary.completionPct >= 50 ? '#38bdf8' : '#f59e0b'

  return (
    <div className="space-y-6">
      <PageHeader
        title="Onboarding Wizard"
        subtitle="Guide your organisation through tenant setup — track every activation task by phase and go live with confidence."
        icon={Rocket}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'onboarding_tasks')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Onboarding Checklist', 'onboarding_tasks', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Add task
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Onboarding isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V199_ONBOARDING_TASKS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Something went wrong.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* Progress hero */}
      <div className="card">
        <div className="flex flex-col lg:flex-row items-center gap-6 lg:gap-10">
          <ProgressRing pct={rows === null ? 0 : summary.completionPct} tone={ringTone} label="Complete" />
          <div className="flex-1 w-full space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">Activation progress</h3>
              {rows !== null && (
                summary.readyForGoLive ? (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-green-900/30 text-green-300 border border-green-800/50">
                    <Flag size={13} /> Ready to go live
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-900/20 text-amber-300 border border-amber-800/50">
                    <Flag size={13} /> {summary.requiredRemaining} required task{summary.requiredRemaining === 1 ? '' : 's'} to go
                  </span>
                )
              )}
            </div>
            <div>
              <div className="flex items-center justify-between text-xs text-[var(--text-muted)] mb-1">
                <span>Required tasks completed</span>
                <span className="font-semibold text-[var(--text-primary)]">{rows === null ? '—' : `${reqPct}%`}</span>
              </div>
              <Bar pct={rows === null ? 0 : reqPct} tone={summary.readyForGoLive ? 'bg-green-500' : 'bg-amber-500'} />
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {kpis.map((k) => {
                const Icon = k.icon
                return (
                  <div key={k.label} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2.5">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] text-[var(--text-muted)]">{k.label}</p>
                      <Icon size={14} className={k.tone} />
                    </div>
                    <p className={`text-2xl font-bold mt-0.5 ${k.tone}`}>{rows === null ? '—' : k.value}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Per-phase progress + what's next */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <ListChecks size={15} /> Progress by phase
          </h3>
          {rows === null ? (
            <div className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="h-8 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
          ) : (
            <div className="space-y-3">
              {phases.map((p) => (
                <div key={p.phase}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium text-[var(--text-secondary)]">{PHASE_LABELS[p.phase]}</span>
                    <span className="text-[var(--text-muted)]">{p.completed}/{p.total} · {p.pct}%</span>
                  </div>
                  <Bar pct={p.pct} tone={p.pct === 100 ? 'bg-green-500' : p.total === 0 ? 'bg-[var(--input-border)]' : 'bg-indigo-500'} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <ArrowRight size={15} /> What’s next
          </h3>
          {rows === null ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-10 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
          ) : queue.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">{summary.totalTasks === 0 ? 'No tasks yet — add your first setup task.' : 'Nothing open — every task is completed or resolved.'}</p>
          ) : (
            <ul className="space-y-2">
              {queue.map((t) => {
                const meta = STATUS_META[t.status] || STATUS_META.not_started
                const Icon = meta.icon
                return (
                  <li key={t.id}>
                    <button onClick={() => openEdit(t)} className="w-full text-left rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2 hover:border-[var(--text-muted)] transition-colors">
                      <div className="flex items-center gap-2">
                        <Icon size={14} className={meta.dot} />
                        <span className="text-sm font-medium text-[var(--text-primary)] truncate">{t.title}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-[var(--text-muted)]">
                        <span>{PHASE_LABELS[t.phase]}</span>
                        {t.required !== false && <span className="text-amber-400">Required</span>}
                        {t.due_date && <span>· Due {fmtDate(t.due_date)}</span>}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search task, owner, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value)} aria-label="Phase">
            <option value="">All phases</option>
            {PHASE_ORDER.map((p) => <option key={p} value={p}>{PHASE_LABELS[p]}</option>)}
          </select>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalTasks}</span>
        </div>
      </div>

      {/* Grouped task list */}
      {rows === null ? (
        <div className="card space-y-3">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-12 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
      ) : grouped.length === 0 ? (
        <div className="card text-center py-12 text-[var(--text-muted)]">
          <Filter size={22} className="mx-auto mb-2 opacity-60" />
          {summary.totalTasks === 0 && !notProvisioned ? 'No onboarding tasks yet — add your first setup task.' : 'No tasks match these filters.'}
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map((g) => (
            <div key={g.phase} className="card !p-0 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--input-border)]">
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">{PHASE_LABELS[g.phase]}</h3>
                <span className="text-xs text-[var(--text-muted)]">{g.tasks.filter((t) => t.status === 'completed').length}/{g.tasks.length} done</span>
              </div>
              <ul>
                {g.tasks.map((t) => {
                  const meta = STATUS_META[t.status] || STATUS_META.not_started
                  const Icon = meta.icon
                  const busy = busyId === t.id
                  return (
                    <li key={t.id} className="flex items-start gap-3 px-4 py-3 border-b border-[var(--input-border)]/50 last:border-b-0 hover:bg-[var(--input-bg)]/40">
                      <Icon size={18} className={`mt-0.5 shrink-0 ${meta.dot}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-sm font-medium ${t.status === 'completed' ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)]'}`}>{t.title}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${meta.badge}`}>{meta.label}</span>
                          {t.required === false
                            ? <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--input-border)] text-[var(--text-muted)]">Optional</span>
                            : <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-800/50 text-amber-300">Required</span>}
                        </div>
                        {t.description && <p className="text-xs text-[var(--text-muted)] mt-1 line-clamp-2">{t.description}</p>}
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-[var(--text-muted)]">
                          {t.owner && <span>Owner: <span className="text-[var(--text-secondary)]">{t.owner}</span></span>}
                          {t.due_date && <span>Due {fmtDate(t.due_date)}</span>}
                          {t.completed_at && <span>Completed {fmtDate(t.completed_at)}</span>}
                          {safeHref(t.help_url) && (
                            <a href={safeHref(t.help_url)} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-sky-400 hover:underline">
                              <ExternalLink size={11} /> Help
                            </a>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <select
                          className="input !py-1 !text-xs" value={t.status} disabled={busy}
                          onChange={(e) => changeStatus(t, e.target.value)} aria-label="Change status"
                        >
                          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                        </select>
                        <button onClick={() => openEdit(t)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                        <button onClick={() => setConfirmDelete(t)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit task' : 'Add onboarding task'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="label">Task title</label>
                <input className="input w-full" placeholder="e.g. Import vehicle fleet" value={form.title} maxLength={300} onChange={(e) => set('title', e.target.value)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Phase</label>
                  <select className="input w-full" value={form.phase} onChange={(e) => set('phase', e.target.value)}>
                    {PHASE_ORDER.map((p) => <option key={p} value={p}>{PHASE_LABELS[p]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Description (optional)</label>
                <textarea className="input w-full min-h-[70px] resize-y" placeholder="What needs to happen for this task to be done?" value={form.description} maxLength={8000} onChange={(e) => set('description', e.target.value)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Owner (optional)</label>
                  <input className="input w-full" placeholder="e.g. Fleet Admin" value={form.owner} maxLength={200} onChange={(e) => set('owner', e.target.value)} />
                </div>
                <div>
                  <label className="label">Due date (optional)</label>
                  <input className="input w-full" type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Order</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="0" value={form.sort_order} onChange={(e) => set('sort_order', e.target.value)} />
                </div>
                <div className="flex items-end pb-1">
                  <label className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                    <input type="checkbox" className="accent-indigo-500 w-4 h-4" checked={form.required} onChange={(e) => set('required', e.target.checked)} />
                    Required for go-live
                  </label>
                </div>
              </div>
              <div>
                <label className="label">Help link (optional)</label>
                <input className="input w-full" type="url" placeholder="https://…" value={form.help_url} maxLength={1000} onChange={(e) => set('help_url', e.target.value)} />
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[60px] resize-y" placeholder="Any context for whoever picks this up" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Add task'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
              <div>
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this task?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.title || 'Task'} · {PHASE_LABELS[confirmDelete.phase] || confirmDelete.phase}. This can’t be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
