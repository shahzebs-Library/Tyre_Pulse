/**
 * OnboardingWizard (route /onboarding-wizard) - tenant activation and go-live
 * readiness, rebuilt on the Command Center kit to the owner's mockup.
 *
 * Two real sources, kept apart so neither pretends to be the other:
 *   1. Go-live readiness is MEASURED from the live system by
 *      `src/lib/api/onboardingReadiness.js` (company profile, sites and regions,
 *      fleet register, approved users, role matrix and custom roles, user data
 *      scope, tyre records, job cards, expense lines, imports, API keys, phones,
 *      inspections). Each check is pass, warning, fail or "could not check".
 *      The checks and the phase roll-up live in `src/lib/onboardingReadinessView.js`.
 *   2. The activation task board is the hand-kept `onboarding_tasks` checklist
 *      (V199): create, edit, delete, inline status, filters, Excel/PDF export.
 *
 * Training and UAT and management sign-off have no system source, so they are
 * read from Training and Go Live tasks in the checklist and say "not tracked"
 * when there are none. The Training phase and the "Depends on" column need
 * migration 20261005151000; before it is applied the page explains a refused
 * Training save and hides the dependency field.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Rocket, Ban, CalendarClock, ShieldAlert, Gauge, Plus, Pencil, Trash2, Search, X,
  FileSpreadsheet, FileText, RefreshCw, CheckCircle2, AlertTriangle, XCircle, HelpCircle,
  ChevronRight, ExternalLink, Info,
} from 'lucide-react'
import Modal from '../components/ui/Modal'
import { Card, CardState, Kpi, KitTable, fmtInt } from '../components/commandCenter/kit'
import { useSettings } from '../contexts/SettingsContext'
import {
  listOnboardingTasks, createOnboardingTask, updateOnboardingTask, deleteOnboardingTask,
  dependencySupported,
} from '../lib/api/onboarding'
import { loadReadinessFacts } from '../lib/api/onboardingReadiness'
import { PHASE_ORDER, PHASE_LABELS } from '../lib/onboarding'
import {
  evaluateChecks, readinessScore, criticalOpen, phaseReadiness, taskKpis, nextActions,
  dependencyTitles,
} from '../lib/onboardingReadinessView'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { safeHref } from '../lib/safeUrl'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'
import './OnboardingWizard.css'

const EMPTY_FORM = {
  title: '', phase: 'setup', description: '', sort_order: '', required: true,
  status: 'not_started', owner: '', due_date: '', help_url: '', notes: '', depends_on: '',
}

const STATUS_META = {
  not_started: { label: 'Not started', tone: 'muted' },
  in_progress: { label: 'In progress', tone: 'info' },
  completed: { label: 'Done', tone: 'good' },
  skipped: { label: 'Skipped', tone: 'muted' },
  blocked: { label: 'Blocked', tone: 'bad' },
}
const STATUS_OPTIONS = Object.keys(STATUS_META)

const CHECK_META = {
  pass: { icon: CheckCircle2, cls: 'pass', label: 'Passed' },
  warn: { icon: AlertTriangle, cls: 'warn', label: 'Needs attention' },
  fail: { icon: XCircle, cls: 'fail', label: 'Failing' },
  unknown: { icon: HelpCircle, cls: 'unknown', label: 'Could not check' },
}

function fmtDate(v) {
  if (!v) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v))
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}
function isOverdue(t) {
  if (!t?.due_date || t.status === 'completed' || t.status === 'skipped') return false
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(t.due_date))
  if (!m) return false
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const today = new Date(); today.setHours(0, 0, 0, 0)
  return d < today
}

function useReadiness(country) {
  const [state, setState] = useState({ loading: true, data: null, error: null })
  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const data = await loadReadinessFacts(country)
      setState({ loading: false, data, error: null })
    } catch (e) {
      setState({ loading: false, data: null, error: toUserMessage(e, 'Could not run the readiness checks.') })
    }
  }, [country])
  useEffect(() => { run() }, [run])
  return { ...state, retry: run }
}

export default function OnboardingWizard() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const [phaseFilter, setPhaseFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [checkFilter, setCheckFilter] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [busyId, setBusyId] = useState(null)

  const readiness = useReadiness(activeCountry)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listOnboardingTasks({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load onboarding tasks.')); setRows(null) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])
  useEffect(() => { load() }, [load])

  const refreshAll = () => { load(); readiness.retry() }

  const tasks = useMemo(() => rows || [], [rows])
  const hasDeps = dependencySupported()
  const depTitles = useMemo(() => dependencyTitles(tasks), [tasks])
  const checks = useMemo(() => (readiness.data ? evaluateChecks(readiness.data, tasks) : []), [readiness.data, tasks])
  const score = useMemo(() => readinessScore(checks), [checks])
  const critical = useMemo(() => criticalOpen(checks), [checks])
  const phases = useMemo(() => phaseReadiness(checks, tasks), [checks, tasks])
  const tk = useMemo(() => taskKpis(tasks), [tasks])
  const actions = useMemo(() => nextActions(checks, tasks), [checks, tasks])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasks.filter((r) => {
      if (phaseFilter && r.phase !== phaseFilter) return false
      if (statusFilter && r.status !== statusFilter) return false
      if (q) {
        const hay = `${r.title || ''} ${r.description || ''} ${r.owner || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [tasks, phaseFilter, statusFilter, search])

  const visibleChecks = checkFilter ? checks.filter((c) => c.phase === checkFilter) : checks

  // ── Export ─────────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['phase', 'title', 'status', 'required', 'owner', 'due_date', 'depends_on', 'notes']
  const EXPORT_HEADERS = ['Phase', 'Task', 'Status', 'Required', 'Owner', 'Due date', 'Depends on', 'Notes']
  const exportRows = filtered.map((r) => ({
    phase: PHASE_LABELS[r.phase] || r.phase || '',
    title: r.title || '',
    status: STATUS_META[r.status]?.label || r.status || '',
    required: r.required === false ? 'Optional' : 'Required',
    owner: r.owner || '',
    due_date: r.due_date || '',
    depends_on: r.depends_on ? (depTitles.get(r.depends_on) || '') : '',
    notes: r.notes || '',
  }))
  const exportName = reportFileName('Onboarding Tasks')

  // ── Modal ──────────────────────────────────────────────────────────────────
  const openCreate = () => {
    const nextOrder = tasks.reduce((m, r) => Math.max(m, Number(r.sort_order) || 0), 0) + 1
    setEditing(null); setForm({ ...EMPTY_FORM, sort_order: String(nextOrder) }); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      title: r.title || '', phase: r.phase || 'setup', description: r.description || '',
      sort_order: r.sort_order ?? '', required: r.required !== false,
      status: r.status || 'not_started', owner: r.owner || '',
      due_date: r.due_date || '', help_url: r.help_url || '', notes: r.notes || '',
      depends_on: r.depends_on || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.title.trim()) { setFormError('A task title is required.'); return }
    if (form.sort_order !== '' && Number(form.sort_order) < 0) { setFormError('Order cannot be negative.'); return }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry !== 'All' ? activeCountry : null }
      if (!hasDeps) delete payload.depends_on
      if (editing) await updateOnboardingTask(editing.id, payload)
      else await createOnboardingTask(payload)
      setShowModal(false); setEditing(null)
      await load()
      readiness.retry()
    } catch (err) {
      const code = err?.code || err?.cause?.code
      if (form.phase === 'training' && code === '23514') {
        setFormError('The Training and UAT phase is not set up on this database yet. Pick another phase, or ask an administrator to apply the onboarding update.')
      } else {
        setFormError(toUserMessage(err, 'Could not save the task.'))
      }
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load, hasDeps, readiness])

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
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setPhaseFilter(''); setStatusFilter(''); setSearch('') }
  const hasFilters = phaseFilter || statusFilter || search
  const tasksLoading = rows === null && !error
  const rLoading = readiness.loading && !readiness.data

  // ── Columns ────────────────────────────────────────────────────────────────
  const taskColumns = [
    {
      key: 'title', header: 'Task',
      cell: (r) => (
        <div className="ow-task">
          <span className={`ow-task-title ${r.status === 'completed' ? 'done' : ''}`}>{r.title}</span>
          <span className="ow-task-meta">
            {r.required === false ? 'Optional' : 'Required'}
            {safeHref(r.help_url) && (
              <a href={safeHref(r.help_url)} target="_blank" rel="noopener noreferrer" className="ow-help"><ExternalLink size={11} aria-hidden="true" /> Help</a>
            )}
          </span>
        </div>
      ),
      sortValue: (r) => r.title || '',
    },
    { key: 'phase', header: 'Phase', cell: (r) => PHASE_LABELS[r.phase] || r.phase, sortValue: (r) => PHASE_ORDER.indexOf(r.phase) },
    { key: 'owner', header: 'Owner', cell: (r) => r.owner || <span className="cc-na">Not assigned</span> },
    {
      key: 'due', header: 'Due', sortValue: (r) => r.due_date || '9999',
      cell: (r) => (fmtDate(r.due_date)
        ? <span className={isOverdue(r) ? 'ow-overdue' : undefined} title={isOverdue(r) ? 'Past due' : undefined}>{fmtDate(r.due_date)}</span>
        : <span className="cc-na">No date</span>),
    },
    {
      key: 'status', header: 'Status', sortValue: (r) => STATUS_OPTIONS.indexOf(r.status),
      cell: (r) => (
        <select
          className={`cc-select ow-status ow-st-${STATUS_META[r.status]?.tone || 'muted'}`}
          value={r.status} disabled={busyId === r.id}
          onChange={(e) => changeStatus(r, e.target.value)} aria-label={`Status of ${r.title}`}
        >
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
      ),
    },
    ...(hasDeps ? [{
      key: 'depends', header: 'Depends on', sortValue: (r) => (r.depends_on ? depTitles.get(r.depends_on) || '' : ''),
      cell: (r) => (r.depends_on ? (depTitles.get(r.depends_on) || <span className="cc-na">Removed task</span>) : <span className="cc-na">None</span>),
    }] : []),
    {
      key: 'actions', header: '', sortable: false,
      cell: (r) => (
        <div className="ow-row-actions">
          <button type="button" className="cc-icon-btn" onClick={() => openEdit(r)} aria-label={`Edit ${r.title}`} title="Edit"><Pencil size={14} /></button>
          <button type="button" className="cc-icon-btn ow-danger" onClick={() => setConfirmDelete(r)} aria-label={`Delete ${r.title}`} title="Delete"><Trash2 size={14} /></button>
        </div>
      ),
    },
  ]

  const actionColumns = [
    { key: 'id', header: 'ID', cell: (r) => <span className="ow-code">{r.id}</span> },
    { key: 'title', header: 'Risk or action', cell: (r) => <span className="ow-wrap">{r.title}</span>, sortValue: (r) => r.title },
    { key: 'area', header: 'Area', cell: (r) => r.area || <span className="cc-na">N/A</span> },
    {
      key: 'priority', header: 'Priority', sortValue: (r) => (r.priority === 'High' ? 0 : 1),
      cell: (r) => <span className={`cc-pill ${r.priority === 'High' ? 'ow-pill-bad' : 'warn'}`}>{r.priority}</span>,
    },
    { key: 'owner', header: 'Owner', cell: (r) => r.owner || <span className="cc-na">Not assigned</span> },
    { key: 'due', header: 'Due', cell: (r) => fmtDate(r.due) || <span className="cc-na">No date</span>, sortValue: (r) => r.due || '9999' },
    {
      key: 'step', header: 'Next step', sortable: false,
      cell: (r) => {
        if (r.kind === 'task') return <button type="button" className="cc-link cc-link-btn" onClick={() => openEdit(r.task)}>{r.step} <ChevronRight size={13} aria-hidden="true" /></button>
        if (r.to) return <Link className="cc-link" to={r.to}>{r.step} <ChevronRight size={13} aria-hidden="true" /></Link>
        return <span className="ow-wrap">{r.step}</span>
      },
    },
  ]

  const scoreTone = score.score == null ? 'unknown' : score.score >= 85 ? 'pass' : score.score >= 60 ? 'warn' : 'fail'

  return (
    <div className="cc ow-page">
      <header className="ow-head">
        <div className="ow-head-copy">
          <nav aria-label="Breadcrumb" className="ow-crumb">Administration <ChevronRight size={13} aria-hidden="true" /> <span aria-current="page">Onboarding Wizard</span></nav>
          <h1>Onboarding Wizard</h1>
          <p>Take each tenant through setup, checks and go-live. Readiness is measured from live data{activeCountry && activeCountry !== 'All' ? ` for ${activeCountry}` : ''}; tasks are your team&apos;s own checklist.</p>
        </div>
        <div className="ow-head-actions">
          <button type="button" className="cc-btn-ghost" onClick={refreshAll} disabled={refreshing || readiness.loading} aria-label="Refresh">
            <RefreshCw size={14} className={refreshing || readiness.loading ? 'ow-spin' : undefined} aria-hidden="true" /> Refresh
          </button>
          <button type="button" className="cc-btn-ghost" disabled={!filtered.length} onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, exportName)}>
            <FileSpreadsheet size={14} aria-hidden="true" /> Excel
          </button>
          <button type="button" className="cc-btn-ghost" disabled={!filtered.length} onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Onboarding Checklist', exportName, 'landscape')}>
            <FileText size={14} aria-hidden="true" /> PDF
          </button>
          <button type="button" className="cc-btn-primary" onClick={openCreate} disabled={notProvisioned}>
            <Plus size={15} aria-hidden="true" /> Add task
          </button>
        </div>
      </header>

      {notProvisioned && (
        <div className="cc-card ow-banner warn" role="status">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>The onboarding task checklist is not set up on this database yet, so the task board is empty. The readiness checks below still run on live data.</span>
        </div>
      )}
      {error && rows !== null && (
        <div className="cc-card ow-banner bad" role="alert">
          <AlertTriangle size={16} aria-hidden="true" /><span>{error}</span>
          <button type="button" className="cc-icon-btn" onClick={() => setError('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      <div className="cc-kpis ow-kpis">
        <Kpi
          icon={Rocket} tone="t-green" loading={tasksLoading}
          display={tk.completionPct == null ? 'N/A' : `${tk.completionPct}%`}
          label={tk.total ? `Activation progress, ${tk.completed} of ${tk.total} tasks` : 'Activation progress, no tasks yet'}
          title="Share of checklist tasks marked Done"
        />
        <Kpi
          icon={Ban} tone="t-red" loading={tasksLoading} value={tk.blocked}
          label="Blocked tasks, need owner action" danger={tk.blocked > 0}
          onClick={() => { setStatusFilter('blocked'); setPhaseFilter('') }}
          title="Show blocked tasks"
        />
        <Kpi
          icon={CalendarClock} tone="t-amber" loading={tasksLoading} value={tk.dueThisWeek}
          label={tk.overdue ? `Due this week, ${tk.overdue} overdue` : `Due this week, across ${tk.dueThisWeekPhases} ${tk.dueThisWeekPhases === 1 ? 'phase' : 'phases'}`}
          title="Open tasks due in the next 7 days"
        />
        <Kpi
          icon={ShieldAlert} tone="t-orange" loading={rLoading}
          display={readiness.data ? fmtInt(critical.length) : 'N/A'}
          label="Critical setup gaps, prevent go-live" danger={critical.length > 0}
          title="Critical readiness checks that are failing"
        />
        <Kpi
          icon={Gauge} tone="t-blue" loading={rLoading}
          display={score.score == null ? 'N/A' : `${score.score}%`}
          label={score.measured ? `Go-live readiness, ${score.passed} of ${score.measured} checks` : 'Go-live readiness'}
          title={score.unknown ? `${score.unknown} checks could not be measured and are left out` : 'Share of measured checks that pass'}
        />
      </div>

      <div className="ow-grid">
        <Card title="Implementation phases" sub="Measured checks passed per phase" className="ow-phases">
          <CardState state={readiness} lines={8}>
            <ul className="ow-phase-list">
              {phases.map((p) => (
                <li key={p.key}>
                  <button
                    type="button" className="ow-phase" aria-pressed={checkFilter === p.key}
                    onClick={() => setCheckFilter(checkFilter === p.key ? '' : p.key)}
                    title={p.pct == null ? 'Nothing measurable in this phase yet' : `${p.passed} of ${p.measured} measured checks pass`}
                  >
                    <span className="ow-phase-name">{p.label}</span>
                    <span className={`ow-phase-pct ${p.pct == null ? 'unknown' : p.pct === 100 ? 'pass' : p.pct >= 50 ? 'warn' : 'fail'}`}>
                      {p.pct == null ? 'N/A' : `${p.pct}%`}
                    </span>
                    <span className="ow-phase-track" aria-hidden="true"><i style={{ width: `${p.pct ?? 0}%` }} className={p.pct == null ? '' : p.pct === 100 ? 'pass' : p.pct >= 50 ? 'warn' : 'fail'} /></span>
                    <span className="ow-phase-sub">
                      {p.measured ? `${p.passed}/${p.measured} checks` : 'Not measured'}
                      {p.tasksTotal ? `, ${p.tasksDone}/${p.tasksTotal} tasks done` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </CardState>
        </Card>

        <section className="cc-card ow-board" aria-label="Activation task board">
          <div className="cc-card-head">
            <div>
              <h2 className="cc-card-title">Activation task board</h2>
              <p className="cc-card-sub">{rows ? `${filtered.length} of ${tasks.length} tasks` : 'Your team checklist'}</p>
            </div>
          </div>
          <div className="cc-filters ow-filters">
            <label className="cc-search">
              <Search size={15} aria-hidden="true" />
              <input placeholder="Search task, owner, notes" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search tasks" />
            </label>
            <select className="cc-select" value={phaseFilter} onChange={(e) => setPhaseFilter(e.target.value)} aria-label="Phase">
              <option value="">All phases</option>
              {PHASE_ORDER.map((p) => <option key={p} value={p}>{PHASE_LABELS[p]}</option>)}
            </select>
            <select className="cc-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
            </select>
            {hasFilters && <button type="button" className="cc-btn-ghost" onClick={clearFilters}><X size={14} aria-hidden="true" /> Clear</button>}
          </div>
          {error && rows === null ? (
            <div className="cc-empty" role="alert"><div>{error}<br /><button type="button" className="cc-btn" onClick={load}>Try again</button></div></div>
          ) : (
            <KitTable
              columns={taskColumns}
              rows={filtered}
              loading={tasksLoading}
              scroll
              empty={tasks.length === 0
                ? (notProvisioned ? 'The task checklist is not set up yet.' : 'No tasks yet. Add the first setup task to start tracking activation.')
                : 'No tasks match these filters.'}
            />
          )}
        </section>

        <Card
          title="Go-live readiness"
          sub={checkFilter ? `Showing ${phases.find((p) => p.key === checkFilter)?.label}` : 'Live checks on your data'}
          className="ow-ready"
          action={checkFilter ? <button type="button" className="cc-link cc-link-btn" onClick={() => setCheckFilter('')}>Show all</button> : null}
        >
          <CardState state={readiness} lines={8}>
            <ul className="ow-check-list">
              {visibleChecks.map((c) => {
                const meta = CHECK_META[c.status]
                const Icon = meta.icon
                return (
                  <li key={c.id} className={`ow-check ${meta.cls}`}>
                    <span className="ow-check-icon" title={meta.label}><Icon size={15} aria-hidden="true" /><span className="sr-only">{meta.label}</span></span>
                    <div className="ow-check-body">
                      <span className="ow-check-label">{c.label}{c.critical && <span className="ow-crit" title="Blocks go-live when failing">Critical</span>}</span>
                      <span className="ow-check-detail">{c.detail}</span>
                    </div>
                    {c.to && c.status !== 'pass' && (
                      <Link className="cc-icon-btn ow-check-go" to={c.to} aria-label={c.action} title={c.action}><ChevronRight size={14} /></Link>
                    )}
                  </li>
                )
              })}
            </ul>
            <div className={`ow-score ${scoreTone}`}>
              <span>Readiness score</span>
              <b>{score.score == null ? 'N/A' : `${score.score} / 100`}</b>
              {score.unknown > 0 && <small><Info size={12} aria-hidden="true" /> {score.unknown} not measured</small>}
            </div>
          </CardState>
        </Card>
      </div>

      <Card title="Next actions and risks" sub="Failing checks first, then blocked and overdue tasks">
        <CardState state={readiness} lines={5}>
          <KitTable
            columns={actionColumns}
            rows={actions}
            empty="Nothing needs action. Every measured check passes and no task is blocked or overdue."
          />
        </CardState>
      </Card>

      <Modal
        open={showModal}
        onClose={saving ? undefined : closeModal}
        title={editing ? 'Edit task' : 'Add onboarding task'}
        size="md"
        footer={(
          <>
            <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
            <button type="submit" form="onboarding-task-form" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Add task'}
            </button>
          </>
        )}
      >
        <form id="onboarding-task-form" onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="onb-task-title" className="label">Task title</label>
            <input id="onb-task-title" className="input w-full" placeholder="e.g. Import vehicle master" value={form.title} maxLength={300} onChange={(e) => set('title', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="onb-phase" className="label">Phase</label>
              <select id="onb-phase" className="input w-full" value={form.phase} onChange={(e) => set('phase', e.target.value)}>
                {PHASE_ORDER.map((p) => <option key={p} value={p}>{PHASE_LABELS[p]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="onb-status" className="label">Status</label>
              <select id="onb-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="onb-description-optional" className="label">Description (optional)</label>
            <textarea id="onb-description-optional" className="input w-full min-h-[70px] resize-y" placeholder="What needs to happen for this task to be done?" value={form.description} maxLength={8000} onChange={(e) => set('description', e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="onb-owner-optional" className="label">Owner (optional)</label>
              <input id="onb-owner-optional" className="input w-full" placeholder="e.g. Fleet Admin" value={form.owner} maxLength={200} onChange={(e) => set('owner', e.target.value)} />
            </div>
            <div>
              <label htmlFor="onb-due-date-optional" className="label">Due date (optional)</label>
              <input id="onb-due-date-optional" className="input w-full" type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
            </div>
          </div>
          {hasDeps && (
            <div>
              <label htmlFor="onb-depends" className="label">Depends on (optional)</label>
              <select id="onb-depends" className="input w-full" value={form.depends_on} onChange={(e) => set('depends_on', e.target.value)}>
                <option value="">No dependency</option>
                {tasks.filter((t) => t.id !== editing?.id).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="onb-order" className="label">Order</label>
              <input id="onb-order" className="input w-full" type="number" step="1" min="0" placeholder="0" value={form.sort_order} onChange={(e) => set('sort_order', e.target.value)} />
            </div>
            <div className="flex items-end pb-1">
              <label className="inline-flex items-center gap-2 text-sm text-[var(--text-secondary)] cursor-pointer">
                <input type="checkbox" className="accent-green-600 w-4 h-4" checked={form.required} onChange={(e) => set('required', e.target.checked)} />
                Required for go-live
              </label>
            </div>
          </div>
          <div>
            <label htmlFor="onb-help-link-optional" className="label">Help link (optional)</label>
            <input id="onb-help-link-optional" className="input w-full" type="url" placeholder="https://" value={form.help_url} maxLength={1000} onChange={(e) => set('help_url', e.target.value)} />
          </div>
          <div>
            <label htmlFor="onb-notes-optional" className="label">Notes (optional)</label>
            <textarea id="onb-notes-optional" className="input w-full min-h-[60px] resize-y" placeholder="Any context for whoever picks this up" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
          </div>
          {formError && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2" role="alert">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
        </form>
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={deleting ? undefined : () => setConfirmDelete(null)}
        title="Delete this task?"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting...' : 'Delete task'}
            </button>
          </>
        )}
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-muted)]">
            {confirmDelete.title || 'Task'} in {PHASE_LABELS[confirmDelete.phase] || confirmDelete.phase}. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
