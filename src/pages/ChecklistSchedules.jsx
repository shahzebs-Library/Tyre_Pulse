import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  CalendarClock, Plus, RefreshCw, AlertTriangle, Trash2, Zap, Loader2,
  CheckCircle2, X, Power, PowerOff, MapPin, Truck, Search,
  Users, ListChecks, FileSpreadsheet, FileText, PauseCircle, Clock, Target,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { compareValues, isBlank } from '../lib/consoleTable'
import {
  CADENCES, CADENCE_LABEL, DUE_STATES, DUE_SOON_DAYS, dueStateLabel, targetSummary, targetDetail,
  enrichSchedules, filterSchedules, summarizeSchedules, scheduleExportRows, SCHEDULE_EXPORT_COLUMNS,
} from '../lib/checklistSchedulesAnalytics'
import { useSettings } from '../contexts/SettingsContext'
import {
  listSchedules, createSchedule, setScheduleActive, deleteSchedule, generateNow,
} from '../lib/api/checklistSchedules'
import { listTemplates } from '../lib/api/checklists'
import { useSites } from '../hooks/useSites'
import { toUserMessage } from '../lib/safeError'
import { listAssignableRoles, ASSIGNABLE_BUILTIN_ROLES } from '../lib/api/customRoles'
import ChecklistGovernancePanel from '../components/checklists/ChecklistGovernancePanel'
import { isMissingRelation } from '../lib/api/_client'

// The friendly "tables not deployed yet" heuristic — mirrors Billing.jsx / Checklists.jsx.

// Roles a schedule can target for its generated assignments.
/**
 * Roles come from the database. The list typed here previously included
 * 'Store Keeper', which normalize_profiles_role() does not accept - nobody can
 * hold it, so scheduling a checklist to it silently reached no one - and left
 * out every custom job title this company created.
 */
const FALLBACK_ROLES = ASSIGNABLE_BUILTIN_ROLES

const CADENCE_BADGE = {
  daily: 'bg-sky-900/40 text-sky-300 border border-sky-700/50',
  weekly: 'bg-green-900/40 text-green-300 border border-green-700/50',
  monthly: 'bg-purple-900/40 text-purple-300 border border-purple-700/50',
  once: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
}
function cadenceBadge(c) {
  return CADENCE_BADGE[String(c || '').toLowerCase()] || 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]'
}

function todayISO() {
  return new Date().toISOString().slice(0, 10)
}
function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

// Semantic due-state tones; the label always travels with the colour.
const STATE_TONE = {
  overdue: 'text-red-400',
  due_soon: 'text-amber-400',
  scheduled: 'text-[var(--text-secondary)]',
  no_date: 'text-[var(--text-muted)]',
  paused: 'text-[var(--text-muted)]',
  ended: 'text-[var(--text-muted)]',
}

/** Column sorting through the shared console comparator (blanks sort last). */
const sortable = (fn) => ({
  accessorFn: (r) => { const v = fn(r); return isBlank(v) ? undefined : v },
  sortingFn: (a, b, id) => compareValues(a.getValue(id), b.getValue(id)),
  sortUndefined: 'last',
})

export default function ChecklistSchedules() {
  const { activeCountry } = useSettings()
  const { options: siteOptions } = useSites(activeCountry)

  const [schedules, setSchedules] = useState([])
  const [templates, setTemplates] = useState([])
  const [templatesError, setTemplatesError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const [search, setSearch] = useState('')
  const [cadenceFilter, setCadenceFilter] = useState('all')
  const [stateFilter, setStateFilter] = useState('all')
  const [roleFilter, setRoleFilter] = useState('all')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [roles, setRoles] = useState(FALLBACK_ROLES)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [rowBusyId, setRowBusyId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [formError, setFormError] = useState('')

  // Lightweight self-contained toast (no external dependency).
  const [toast, setToast] = useState(null) // { kind:'success'|'error', text }
  const toastTimer = useRef(null)
  const showToast = useCallback((kind, text) => {
    setToast({ kind, text })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4500)
  }, [])
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])

  // ── Create-schedule form ────────────────────────────────────────────────────
  const emptyForm = useMemo(() => ({
    template_id: '', name: '', cadence: 'weekly',
    targetMode: 'sites', sites: [], asset_nos: [],
    assignee_role: '', start_date: todayISO(), end_date: '', pilot: false,
  }), [])
  const [form, setForm] = useState(emptyForm)
  const [assetInput, setAssetInput] = useState('')
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const load = useCallback(async () => {
    setLoading(true); setError(''); setMissing(false); setTemplatesError('')
    try {
      // A failed template read must not read as "no published templates":
      // it is recorded and said so beside the form.
      let tplErr = null
      const [rows, tpls, ro] = await Promise.all([
        listSchedules({ country: activeCountry }),
        listTemplates({ status: 'published', country: activeCountry }).catch((e) => { tplErr = e; return [] }),
        listAssignableRoles().catch(() => FALLBACK_ROLES),
      ])
      setSchedules(Array.isArray(rows) ? rows : [])
      setTemplates(Array.isArray(tpls) ? tpls : [])
      setTemplatesError(tplErr ? toUserMessage(tplErr, 'Could not load checklist templates.') : '')
      setRoles(Array.isArray(ro) && ro.length ? ro : FALLBACK_ROLES)
      setNow(Date.now())
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setMissing(true)
      else setError(toUserMessage(err, 'Could not load checklist schedules.'))
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const templateName = useCallback((id) => {
    const t = templates.find((x) => x?.id === id)
    return t?.name || 'Unknown template'
  }, [templates])

  // ── Asset chip handling ─────────────────────────────────────────────────────
  function addAssetsFromInput() {
    const parts = String(assetInput || '')
      .split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
    if (!parts.length) { setAssetInput(''); return }
    setForm((f) => {
      const set = new Set([...(f.asset_nos || []), ...parts])
      return { ...f, asset_nos: Array.from(set) }
    })
    setAssetInput('')
  }
  function onAssetKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addAssetsFromInput() }
  }
  function removeAsset(a) {
    setForm((f) => ({ ...f, asset_nos: (f.asset_nos || []).filter((x) => x !== a) }))
  }

  function toggleSite(site) {
    setForm((f) => {
      const has = (f.sites || []).includes(site)
      return { ...f, sites: has ? f.sites.filter((s) => s !== site) : [...(f.sites || []), site] }
    })
  }

  function resetForm() {
    setForm({ ...emptyForm, start_date: todayISO() })
    setAssetInput('')
    setFormError('')
  }

  // ── Create ──────────────────────────────────────────────────────────────────
  async function onSubmit(e) {
    e.preventDefault()
    setFormError('')
    if (!form.template_id) { setFormError('Choose a published checklist template.'); return }
    if (!form.name.trim()) { setFormError('Give this schedule a name.'); return }
    if (!form.start_date) { setFormError('Pick a start date.'); return }

    // Fold any half-typed asset text into the list before saving.
    const typed = String(assetInput || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
    const assetNos = form.targetMode === 'assets'
      ? Array.from(new Set([...(form.asset_nos || []), ...typed]))
      : []
    const sites = form.targetMode === 'sites' ? (form.sites || []) : []
    if (!sites.length && !assetNos.length) {
      setFormError('Choose at least one site or asset. Unscoped schedules are not allowed.')
      return
    }

    setSaving(true)
    try {
      await createSchedule({
        template_id: form.template_id,
        name: form.name.trim(),
        cadence: form.cadence,
        sites,
        asset_nos: assetNos,
        assignee_role: form.assignee_role || null,
        country: activeCountry && activeCountry !== 'All' ? activeCountry : null,
        start_date: form.start_date,
        end_date: form.end_date || null,
        next_due: form.start_date,
        pilot: Boolean(form.pilot),
        active: true,
      })
      resetForm()
      showToast('success', 'Schedule created.')
      await load()
    } catch (err) {
      if (isMissingRelation(err)) setMissing(true)
      setFormError(toUserMessage(err, 'Could not create the schedule.'))
    } finally {
      setSaving(false)
    }
  }

  // ── Row actions ─────────────────────────────────────────────────────────────
  async function onToggleActive(s) {
    if (rowBusyId) return
    setRowBusyId(s.id)
    const next = !s.active
    // Optimistic flip; reverted on failure.
    setSchedules((rows) => rows.map((r) => (r.id === s.id ? { ...r, active: next } : r)))
    try {
      await setScheduleActive(s.id, next)
      showToast('success', next ? 'Schedule activated.' : 'Schedule paused.')
    } catch (err) {
      setSchedules((rows) => rows.map((r) => (r.id === s.id ? { ...r, active: s.active } : r)))
      showToast('error', toUserMessage(err, 'Could not update the schedule.'))
    } finally {
      setRowBusyId(null)
    }
  }

  async function onDelete(s) {
    if (rowBusyId || !s) return
    setRowBusyId(s.id)
    try {
      await deleteSchedule(s.id)
      setSchedules((rows) => rows.filter((r) => r.id !== s.id))
      setConfirmDelete(null)
      showToast('success', 'Schedule deleted.')
    } catch (err) {
      showToast('error', toUserMessage(err, 'Could not delete the schedule.'))
    } finally {
      setRowBusyId(null)
    }
  }

  async function onGenerateNow() {
    if (generating) return
    setGenerating(true)
    try {
      const res = await generateNow()
      const count = typeof res === 'number' ? res : (res?.count ?? res?.generated ?? 0)
      const n = Number.isFinite(Number(count)) ? Number(count) : 0
      showToast('success', `${n} assignment${n === 1 ? '' : 's'} created.`)
      await load()
    } catch (err) {
      if (isMissingRelation(err)) setMissing(true)
      showToast('error', toUserMessage(err, 'Could not generate assignments.'))
    } finally {
      setGenerating(false)
    }
  }

  const activeCount = useMemo(() => schedules.filter((s) => s?.active).length, [schedules])

  const templateNames = useMemo(() => new Map(templates.map((t) => [t?.id, t?.name || 'Untitled'])), [templates])
  const enriched = useMemo(
    () => enrichSchedules(schedules, now, (id) => templateNames.get(id) || (templatesError ? 'Template unavailable' : 'Unknown template')),
    [schedules, now, templateNames, templatesError],
  )
  // The tiles cover the schedules matching search, cadence and role. The due
  // state filter is held out: the tiles ARE the due-state reading.
  const kpiScope = useMemo(
    () => filterSchedules(enriched, { query: search, cadence: cadenceFilter, role: roleFilter }),
    [enriched, search, cadenceFilter, roleFilter],
  )
  const summary = useMemo(() => summarizeSchedules(kpiScope), [kpiScope])
  const filtered = useMemo(
    () => filterSchedules(enriched, { query: search, cadence: cadenceFilter, state: stateFilter, role: roleFilter }),
    [enriched, search, cadenceFilter, stateFilter, roleFilter],
  )
  const roleOptions = useMemo(
    () => [...new Set(schedules.map((s) => s?.assignee_role).filter(Boolean))].sort(),
    [schedules],
  )
  const hasFilters = search || cadenceFilter !== 'all' || stateFilter !== 'all' || roleFilter !== 'all'
  const clearFilters = () => { setSearch(''); setCadenceFilter('all'); setStateFilter('all'); setRoleFilter('all') }

  const exportName = reportFileName('Checklist schedules', new Date().toISOString().slice(0, 10))
  async function doExport(kind) {
    try {
      const rows = scheduleExportRows(filtered)
      if (kind === 'excel') await exportToExcel(rows, SCHEDULE_EXPORT_COLUMNS.map((c) => c.key), SCHEDULE_EXPORT_COLUMNS.map((c) => c.header), exportName)
      else await exportToPdf(rows, SCHEDULE_EXPORT_COLUMNS, 'Checklist Schedules', exportName, 'landscape')
    } catch (err) {
      showToast('error', toUserMessage(err, 'Could not export. Try again.'))
    }
  }

  const columns = useMemo(() => [
    { id: 'name', header: 'Schedule', ...sortable((s) => s.name), size: 240,
      cell: ({ row }) => (
        <div>
          <div className="font-medium text-[var(--text-primary)] flex items-center gap-1.5">
            <ListChecks size={14} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" />
            {row.original.name || 'Untitled schedule'}
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-0.5">{row.original._template}</div>
        </div>
      ) },
    { id: 'cadence', header: 'Cadence', ...sortable((s) => CADENCE_LABEL[s.cadence] || s.cadence), size: 110,
      cell: ({ row }) => <span className={`badge text-xs ${cadenceBadge(row.original.cadence)}`}>{CADENCE_LABEL[row.original.cadence] || row.original.cadence || 'N/A'}</span> },
    { id: 'target', header: 'Target', ...sortable((s) => targetSummary(s)), size: 170,
      cell: ({ row }) => (
        <div title={targetDetail(row.original) || undefined}>
          <span className="text-[var(--text-primary)]">{targetSummary(row.original)}</span>
          {row.original.assignee_role && (
            <div className="text-xs text-[var(--text-muted)] inline-flex items-center gap-1 mt-0.5 ml-2">
              <Users size={11} aria-hidden="true" /> {row.original.assignee_role}
            </div>
          )}
        </div>
      ) },
    { id: 'next_due', header: 'Next due', ...sortable((s) => s.next_due), size: 150,
      cell: ({ row }) => {
        const s = row.original
        return (
          <div className="whitespace-nowrap">
            <span className={STATE_TONE[s._state] || 'text-[var(--text-muted)]'}>{fmtDate(s.next_due)}</span>
            <div className={`text-[11px] ${STATE_TONE[s._state] || ''}`}>{dueStateLabel(s._state)}</div>
          </div>
        )
      } },
    { id: 'active', header: 'Active', ...sortable((s) => (s.active ? 1 : 0)), size: 120, meta: { export: false },
      cell: ({ row }) => {
        const s = row.original
        const busy = rowBusyId === s.id
        return (
          <button
            type="button"
            onClick={() => onToggleActive(s)}
            disabled={busy}
            aria-pressed={Boolean(s.active)}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 min-h-[36px] rounded-lg border transition-colors disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-green-500 ${
              s.active
                ? 'bg-green-900/30 border-green-700/50 text-green-300 hover:bg-green-900/50'
                : 'bg-[var(--surface-2)] border-[var(--border-dim)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
            title={s.active ? 'Pause this schedule' : 'Activate this schedule'}
          >
            {busy ? <Loader2 size={12} className="animate-spin" aria-hidden="true" />
              : s.active ? <Power size={12} aria-hidden="true" /> : <PowerOff size={12} aria-hidden="true" />}
            {s.active ? 'Active' : 'Paused'}
          </button>
        )
      } },
    { id: 'actions', header: '', enableSorting: false, size: 70, meta: { export: false },
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => setConfirmDelete(row.original)}
          disabled={rowBusyId === row.original.id}
          className="w-11 h-11 inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-red-900/20 disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-red-500"
          aria-label={`Delete schedule ${row.original.name || ''}`.trim()}
        >
          <Trash2 size={15} />
        </button>
      ) },
  // onToggleActive reads the row it is handed and sets state; rowBusyId is the
  // only render input it depends on.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [rowBusyId])

  const kpis = [
    { label: 'Schedules', value: summary.total, icon: CalendarClock, tone: 'text-[var(--text-primary)]', sub: `${summary.active} active` },
    { label: 'Overdue', value: summary.overdue, icon: AlertTriangle, tone: summary.overdue > 0 ? 'text-red-400' : 'text-[var(--text-primary)]', sub: 'Next due more than a day ago' },
    { label: `Due in ${DUE_SOON_DAYS} days`, value: summary.dueSoon, icon: Clock, tone: 'text-amber-400' },
    { label: 'On time', value: summary.onTimePct == null ? 'N/A' : `${summary.onTimePct}%`, icon: CheckCircle2, tone: 'text-green-400', sub: 'Of running schedules' },
    { label: 'Paused', value: summary.paused, icon: PauseCircle, tone: 'text-[var(--text-muted)]', sub: summary.ended ? `${summary.ended} ended` : undefined },
    { label: 'Unscoped', value: summary.unscoped, icon: Target, tone: summary.unscoped > 0 ? 'text-amber-400' : 'text-[var(--text-primary)]', sub: 'No site or asset set' },
  ]

  const headerActions = (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => doExport('excel')} disabled={!filtered.length} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50">
        <FileSpreadsheet size={14} aria-hidden="true" /> Excel
      </button>
      <button type="button" onClick={() => doExport('pdf')} disabled={!filtered.length} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-50">
        <FileText size={14} aria-hidden="true" /> PDF
      </button>
      <button
        type="button"
        onClick={onGenerateNow}
        disabled={generating || missing || loading}
        className="btn-primary text-sm inline-flex items-center gap-2 min-h-[44px] disabled:opacity-50"
        title="Materialise any due assignments now"
      >
        {generating ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Zap size={15} aria-hidden="true" />}
        Generate due now
      </button>
    </div>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Checklist Schedules"
        subtitle="Automate recurring compliance: assign checklists to sites and assets on a cadence."
        icon={CalendarClock}
        badge={!loading && !missing ? `${activeCount} active` : undefined}
        actions={headerActions}
        onRefresh={load}
        refreshing={loading}
        updatedAt={updatedAt}
      />

      <ChecklistGovernancePanel activeCountry={activeCountry} siteOptions={siteOptions} />

      {/* Toast */}
      {toast && (
        <div
          role="status"
          className={`fixed z-50 bottom-6 right-6 max-w-sm rounded-xl px-4 py-3 shadow-lg border flex items-start gap-2.5 text-sm ${
            toast.kind === 'success'
              ? 'bg-green-950/90 border-green-700/60 text-green-200'
              : 'bg-red-950/90 border-red-700/60 text-red-200'
          }`}
        >
          {toast.kind === 'success'
            ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
            : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
          <span className="flex-1">{toast.text}</span>
          <button type="button" onClick={() => setToast(null)} aria-label="Dismiss message" className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-1">
            <X size={14} />
          </button>
        </div>
      )}

      {/* How it works */}
      <div className="card border border-[var(--border-dim)] bg-[var(--surface-1)]">
        <div className="flex items-start gap-3">
          <Zap size={18} className="text-brand-bright mt-0.5 shrink-0" />
          <p className="text-sm text-[var(--text-muted)]">
            Schedules generate checklist assignments automatically every day. Use
            {' '}<span className="text-[var(--text-primary)] font-medium">Generate due now</span> to materialise any that are already due
            without waiting for the daily run. Assignments appear on the{' '}
            <Link to="/checklists" className="text-brand-bright hover:underline">Checklists</Link> workspace.
          </p>
        </div>
      </div>

      {/* Migration hint */}
      {missing && (
        <div className="card border border-amber-800/50">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-amber-300 font-medium">Checklist scheduling isn't enabled on this database yet.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">
                Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V124_CHECKLIST_SCHEDULES.sql</span> to create the
                {' '}<span className="font-mono">checklist_schedules</span> and <span className="font-mono">checklist_assignments</span> tables
                and the <span className="font-mono">generate_checklist_assignments()</span> function, then reload.
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
              <p className="text-red-300 font-medium">Couldn't load checklist schedules.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
              <button onClick={load} className="btn-secondary text-sm mt-3 inline-flex items-center gap-2">
                <RefreshCw size={14} /> Retry
              </button>
            </div>
          </div>
        </div>
      )}

      {!missing && !error && (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Create form */}
          <div className="xl:col-span-1">
            <form onSubmit={onSubmit} className="card space-y-4">
              <div className="flex items-center gap-2">
                <Plus size={16} className="text-brand-bright" />
                <h2 className="text-[var(--text-primary)] font-semibold">Schedule a checklist</h2>
              </div>

              {templatesError && !loading && (
                <div role="alert" className="rounded-lg border border-red-800/40 bg-red-900/15 px-3 py-2.5 text-xs text-red-300 flex items-start gap-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>Published templates could not be loaded: {templatesError}</span>
                  <button type="button" onClick={load} className="underline ml-auto shrink-0">Retry</button>
                </div>
              )}
              {templates.length === 0 && !loading && !templatesError && (
                <div className="rounded-lg border border-amber-800/40 bg-amber-900/15 px-3 py-2.5 text-xs text-amber-300 flex items-start gap-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>
                    No published templates for {activeCountry || 'this scope'}.{' '}
                    <Link to="/checklists" className="underline hover:text-amber-200">Publish one first</Link> to schedule it.
                  </span>
                </div>
              )}

              <div>
                <label className="label" htmlFor="cs-template">Template</label>
                <select
                  id="cs-template"
                  className="input"
                  value={form.template_id}
                  onChange={(e) => setField('template_id', e.target.value)}
                  disabled={loading}
                >
                  <option value="">Select a published template…</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>{t.name || 'Untitled'}{t.version ? ` (v${t.version})` : ''}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label" htmlFor="cs-name">Schedule name</label>
                <input
                  id="cs-name"
                  className="input"
                  placeholder="e.g. Weekly steer-tyre safety check"
                  value={form.name}
                  onChange={(e) => setField('name', e.target.value)}
                  maxLength={120}
                />
              </div>

              <div>
                <p className="label" id="cs-cadence-label">Cadence</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {CADENCES.map((c) => (
                    <button
                      type="button"
                      key={c.key}
                      onClick={() => setField('cadence', c.key)}
                      aria-pressed={form.cadence === c.key}
                      className={`px-2 min-h-[44px] rounded-lg text-xs font-medium border transition-colors ${
                        form.cadence === c.key
                          ? 'bg-green-600 border-green-600 text-white'
                          : 'bg-[var(--surface-1)] border-[var(--border-dim)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Target */}
              <div>
                <p className="label">Target</p>
                <div className="flex gap-1.5 mb-2">
                  {[
                    { key: 'sites', label: 'Sites', icon: MapPin },
                    { key: 'assets', label: 'Assets', icon: Truck },
                  ].map(({ key, label, icon: Icon }) => (
                    <button
                      type="button"
                      key={key}
                      onClick={() => setField('targetMode', key)}
                      aria-pressed={form.targetMode === key}
                      className={`flex-1 px-2 min-h-[44px] rounded-lg text-xs font-medium border inline-flex items-center justify-center gap-1.5 transition-colors ${
                        form.targetMode === key
                          ? 'bg-brand-subtle border-[rgba(22,163,74,0.4)] text-brand-bright'
                          : 'bg-[var(--surface-1)] border-[var(--border-dim)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <Icon size={13} /> {label}
                    </button>
                  ))}
                </div>

                {form.targetMode === 'sites' && (
                  <div className="rounded-lg border border-[var(--border-dim)] max-h-44 overflow-y-auto divide-y divide-[var(--border-dim)]">
                    {siteOptions.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-[var(--text-muted)]">No sites available for this country.</p>
                    ) : siteOptions.map((site) => {
                      const checked = (form.sites || []).includes(site)
                      return (
                        <label key={site} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[var(--surface-2)]">
                          <input type="checkbox" checked={checked} onChange={() => toggleSite(site)} className="accent-green-600" />
                          <span className="text-sm text-[var(--text-primary)] truncate">{site}</span>
                        </label>
                      )
                    })}
                  </div>
                )}

                {form.targetMode === 'assets' && (
                  <div>
                    <input
                      className="input"
                      placeholder="Type asset no, comma or Enter to add"
                      value={assetInput}
                      onChange={(e) => setAssetInput(e.target.value)}
                      onKeyDown={onAssetKeyDown}
                      onBlur={addAssetsFromInput}
                    />
                    {(form.asset_nos || []).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {form.asset_nos.map((a) => (
                          <span key={a} className="inline-flex items-center gap-1 text-xs bg-[var(--surface-2)] border border-[var(--border-dim)] rounded-full px-2 py-1 text-[var(--text-primary)]">
                            {a}
                            <button type="button" onClick={() => removeAsset(a)} aria-label={`Remove ${a}`} className="text-[var(--text-muted)] hover:text-red-400 p-1">
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

              </div>

              <div>
                <label className="label" htmlFor="cs-role">Assignee role <span className="text-[var(--text-dim)]">(optional)</span></label>
                <select
                  id="cs-role"
                  className="input"
                  value={form.assignee_role}
                  onChange={(e) => setField('assignee_role', e.target.value)}
                >
                  <option value="">Anyone</option>
                  {roles.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              <div>
                <label className="label" htmlFor="cs-start">Start date</label>
                <input
                  id="cs-start"
                  type="date"
                  className="input"
                  value={form.start_date}
                  min={todayISO()}
                  onChange={(e) => setField('start_date', e.target.value)}
                />
              </div>

              <div>
                <label className="label" htmlFor="cs-end">End date <span className="text-[var(--text-dim)]">(optional)</span></label>
                <input
                  id="cs-end"
                  type="date"
                  className="input"
                  value={form.end_date}
                  min={form.start_date || todayISO()}
                  onChange={(e) => setField('end_date', e.target.value)}
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                <input
                  type="checkbox"
                  checked={form.pilot}
                  onChange={(e) => setField('pilot', e.target.checked)}
                />
                Pilot schedule (must match the configured pilot site and dates)
              </label>

              {formError && (
                <div className="rounded-lg border border-red-800/50 bg-red-900/15 px-3 py-2 text-xs text-red-300 flex items-start gap-2">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={saving || templates.length === 0}
                  className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-50 flex-1 justify-center"
                >
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                  {saving ? 'Saving…' : 'Create schedule'}
                </button>
                <button type="button" onClick={resetForm} disabled={saving} className="btn-secondary text-sm disabled:opacity-50">
                  Reset
                </button>
              </div>
            </form>
          </div>

          {/* Schedules register */}
          <div className="xl:col-span-2 space-y-4 min-w-0">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {kpis.map((k) => {
                const Icon = k.icon
                return (
                  <Card key={k.label}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                      <Icon size={16} className={k.tone} aria-hidden="true" />
                    </div>
                    {loading
                      ? <div className="h-7 w-12 mt-2 rounded bg-[var(--input-bg)] animate-pulse" />
                      : <p className={`text-2xl font-bold mt-1 tabular-nums ${k.tone}`}>{k.value}</p>}
                    {k.sub && !loading && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{k.sub}</p>}
                  </Card>
                )
              })}
            </div>
            {!loading && kpiScope.length !== enriched.length && (
              <p className="text-xs text-[var(--text-muted)] -mt-1">
                These figures cover the {kpiScope.length} schedule{kpiScope.length === 1 ? '' : 's'} matching your search, cadence and role filters, of {enriched.length}.
                The due state filter is not applied here.
              </p>
            )}

            <Card className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[180px]">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                  <input className="input pl-9 w-full" placeholder="Search schedule, template, role, site" aria-label="Search schedules" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <select className="input w-auto" aria-label="Cadence" value={cadenceFilter} onChange={(e) => setCadenceFilter(e.target.value)}>
                  <option value="all">All cadences</option>
                  {CADENCES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
                <select className="input w-auto" aria-label="Due state" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}>
                  <option value="all">Any due state</option>
                  {DUE_STATES.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
                <select className="input w-auto" aria-label="Assignee role" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
                  <option value="all">Any role</option>
                  <option value="anyone">Anyone (no role)</option>
                  {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                {hasFilters && (
                  <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
                    <X size={14} aria-hidden="true" /> Clear
                  </button>
                )}
                <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{filtered.length} of {enriched.length}</span>
              </div>
            </Card>

            <Card pad="none" clip>
              <EnterpriseTable
                columns={columns}
                data={filtered}
                getRowId={(r) => String(r.id)}
                loading={loading}
                enableGlobalFilter={false}
                enableColumnFilters={false}
                enableSorting
                enableExport={false}
                initialPageSize={25}
                pageSizeOptions={[25, 50, 100]}
                emptyMessage={schedules.length === 0
                  ? 'No schedules yet. Schedule your first recurring checklist using the form; it will generate assignments on the cadence you choose.'
                  : 'No schedules match these filters.'}
              />
            </Card>

            {!loading && schedules.length > 0 && (
              <p className="text-xs text-[var(--text-muted)]">
                {schedules.length} schedule{schedules.length === 1 ? '' : 's'}, {activeCount} active. Assignments generate daily; use Generate due now to run immediately.
              </p>
            )}
          </div>
        </div>
      )}

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => { if (!rowBusyId) setConfirmDelete(null) }}
        title="Delete this schedule?"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setConfirmDelete(null)} disabled={Boolean(rowBusyId)} className="btn-secondary text-sm min-h-[44px]">Cancel</button>
            <button type="button" onClick={() => onDelete(confirmDelete)} disabled={Boolean(rowBusyId)} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60">
              {rowBusyId ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Trash2 size={14} aria-hidden="true" />} Delete
            </button>
          </>
        )}
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-muted)]">
            <span className="font-medium text-[var(--text-secondary)]">{confirmDelete.name || 'This schedule'}</span> will be deleted.
            Existing generated assignments are kept; no new ones will be created.
          </p>
        )}
      </Modal>
    </div>
  )
}
