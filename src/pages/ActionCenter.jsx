/**
 * ActionCenter (route /action-center) — Action Center / Exception Dashboard.
 * A unified, prioritised queue of every operational exception and required
 * action across the fleet: safety, compliance, maintenance, cost, tyre,
 * inspection, and data-quality issues that demand a human decision. This is the
 * OS's triage surface — worst / most-urgent first — so nothing critical is lost
 * in a per-module silo.
 *
 * Runs on the `action_items` table (V186). Real data, KPI tiles, a by-category
 * breakdown, a severity distribution strip, a prioritised queue, filters,
 * search, create/edit modal, delete confirm, Excel/PDF export, and
 * loading/empty/error/not-provisioned states throughout. Prioritisation and the
 * exception roll-ups live in the pure `src/lib/actionCenter.js` helpers; the
 * current time is read once (Date.now()) and injected into every pure call so
 * ranking stays deterministic within a render.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ListChecks, AlertTriangle, ShieldAlert, Clock, CheckCircle2, Flame,
  Search, X, Filter, FileSpreadsheet, FileText, Plus, Pencil, Trash2,
  Layers, ArrowUpDown, Bell, User, Calendar, Zap,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listActionItems, createActionItem, updateActionItem, deleteActionItem,
} from '../lib/api/actionCenter'
import {
  prioritise, summariseActions, byCategory, bySeverity, isOverdue, isOpen,
} from '../lib/actionCenter'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

// ── Enum vocabularies (mirror the V186 CHECK constraints) ────────────────────
const CATEGORY_OPTS = [
  { v: 'safety', label: 'Safety' },
  { v: 'compliance', label: 'Compliance' },
  { v: 'maintenance', label: 'Maintenance' },
  { v: 'cost', label: 'Cost' },
  { v: 'tyre', label: 'Tyre' },
  { v: 'inspection', label: 'Inspection' },
  { v: 'data_quality', label: 'Data Quality' },
  { v: 'other', label: 'Other' },
]
const CATEGORY_LABEL = Object.fromEntries(CATEGORY_OPTS.map((c) => [c.v, c.label]))

const SEVERITY_OPTS = [
  { v: 'critical', label: 'Critical' },
  { v: 'high', label: 'High' },
  { v: 'medium', label: 'Medium' },
  { v: 'low', label: 'Low' },
  { v: 'info', label: 'Info' },
]
const STATUS_OPTS = [
  { v: 'open', label: 'Open' },
  { v: 'acknowledged', label: 'Acknowledged' },
  { v: 'in_progress', label: 'In progress' },
  { v: 'resolved', label: 'Resolved' },
  { v: 'dismissed', label: 'Dismissed' },
]
const STATUS_LABEL = Object.fromEntries(STATUS_OPTS.map((s) => [s.v, s.label]))

// Severity → badge classes (dark theme, no green for non-good states).
const SEVERITY_BADGE = {
  critical: 'bg-red-900/40 text-red-300 border-red-800/60',
  high: 'bg-orange-900/40 text-orange-300 border-orange-800/60',
  medium: 'bg-amber-900/30 text-amber-300 border-amber-800/50',
  low: 'bg-sky-900/30 text-sky-300 border-sky-800/50',
  info: 'bg-slate-700/40 text-slate-300 border-slate-600/50',
}
const SEVERITY_BAR = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-amber-500',
  low: 'bg-sky-500',
  info: 'bg-slate-500',
}
const STATUS_BADGE = {
  open: 'bg-blue-900/30 text-blue-300 border-blue-800/50',
  acknowledged: 'bg-indigo-900/30 text-indigo-300 border-indigo-800/50',
  in_progress: 'bg-violet-900/30 text-violet-300 border-violet-800/50',
  resolved: 'bg-green-900/30 text-green-300 border-green-800/50',
  dismissed: 'bg-slate-700/40 text-slate-400 border-slate-600/50',
}

const EMPTY_FORM = {
  title: '', category: 'other', source: '', asset_no: '', severity: 'medium',
  priority_score: '', assigned_to: '', due_date: '', status: 'open',
  impact: '', recommended_action: '', resolution: '', notes: '',
}

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

function Badge({ children, className }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${className}`}>
      {children}
    </span>
  )
}

export default function ActionCenter() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [openOnly, setOpenOnly] = useState(false)

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // Single clock read per render pass — injected into every pure helper so the
  // whole page ranks/summarises against one consistent "now".
  const nowMs = Date.now()

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listActionItems({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load action items.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const allRows = rows || []
  const summary = useMemo(() => summariseActions(allRows, nowMs), [allRows, nowMs])
  const categoryBreakdown = useMemo(() => byCategory(allRows), [allRows])
  const severityCounts = useMemo(() => bySeverity(allRows), [allRows])

  // Filter, then prioritise (worst/most-urgent first).
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = allRows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false
      if (severityFilter && r.severity !== severityFilter) return false
      if (categoryFilter && r.category !== categoryFilter) return false
      if (openOnly && !isOpen(r)) return false
      if (q) {
        const hay = `${r.title || ''} ${r.asset_no || ''} ${r.source || ''} ${r.assigned_to || ''} ${r.impact || ''} ${r.recommended_action || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    return prioritise(list, nowMs)
  }, [allRows, search, statusFilter, severityFilter, categoryFilter, openOnly, nowMs])

  // Top of the prioritised queue (worst-first triage panel).
  const topQueue = useMemo(() => filtered.filter((r) => isOpen(r)).slice(0, 6), [filtered])
  const severityTotal = SEVERITY_OPTS.reduce((s, o) => s + (severityCounts[o.v] || 0), 0)

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Total items', value: summary.totalItems, icon: ListChecks, tone: 'text-[var(--text-primary)]' },
    { label: 'Open', value: summary.openCount, icon: Bell, tone: 'text-sky-400' },
    { label: 'Critical open', value: summary.criticalOpenCount, icon: Flame, tone: 'text-red-400' },
    { label: 'Overdue', value: summary.overdueCount, icon: Clock, tone: 'text-amber-400' },
    { label: 'Resolution rate', value: `${summary.resolutionRate}%`, icon: CheckCircle2, tone: 'text-green-400' },
  ]

  // ── Export ─────────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['title', 'category', 'severity', 'status', 'asset_no', 'assigned_to', 'due_date', 'priority_score', 'source', 'recommended_action']
  const EXPORT_HEADERS = ['Title', 'Category', 'Severity', 'Status', 'Asset', 'Assigned to', 'Due date', 'Priority', 'Source', 'Recommended action']
  const exportRows = filtered.map((r) => ({
    title: r.title || '', category: CATEGORY_LABEL[r.category] || r.category || '',
    severity: r.severity || '', status: STATUS_LABEL[r.status] || r.status || '',
    asset_no: r.asset_no || '', assigned_to: r.assigned_to || '',
    due_date: r.due_date || '', priority_score: r.priority_score ?? '',
    source: r.source || '', recommended_action: r.recommended_action || '',
  }))

  // ── Modal ──────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      title: r.title || '', category: r.category || 'other', source: r.source || '',
      asset_no: r.asset_no || '', severity: r.severity || 'medium',
      priority_score: r.priority_score ?? '', assigned_to: r.assigned_to || '',
      due_date: r.due_date || '', status: r.status || 'open',
      impact: r.impact || '', recommended_action: r.recommended_action || '',
      resolution: r.resolution || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.title.trim()) { setFormError('A title is required.'); return }
    if (form.priority_score !== '' && Number(form.priority_score) < 0) {
      setFormError('Priority score cannot be negative.'); return
    }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry !== 'All' ? activeCountry : null }
      if (editing) await updateActionItem(editing.id, payload)
      else await createActionItem(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(err?.message || 'Could not save the action item.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteActionItem(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the action item.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => {
    setSearch(''); setStatusFilter(''); setSeverityFilter(''); setCategoryFilter(''); setOpenOnly(false)
  }
  const hasFilters = search || statusFilter || severityFilter || categoryFilter || openOnly

  return (
    <div className="space-y-6">
      <PageHeader
        title="Action Center"
        subtitle="A unified, prioritised queue of operational exceptions across the fleet — safety, compliance, maintenance, cost, tyre, inspection, and data-quality actions, worst-first."
        icon={ListChecks}
        badge={summary.openCount ? `${summary.openCount} open` : undefined}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'action_center')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Action Center — Exception Queue', 'action_center', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> New action
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">The Action Center isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V186_ACTION_ITEMS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load action items.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{rows === null ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Breakdown + severity distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* By category */}
        <div className="card lg:col-span-2">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Layers size={15} /> Exceptions by category
          </h3>
          {rows === null ? (
            <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : categoryBreakdown.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No action items yet.</p>
          ) : (
            <div className="space-y-2.5">
              {categoryBreakdown.map((c) => {
                const openMax = Math.max(...categoryBreakdown.map((x) => x.open), 1)
                const pct = Math.round((c.open / openMax) * 100)
                const active = categoryFilter === c.category
                return (
                  <button
                    key={c.category}
                    onClick={() => setCategoryFilter(active ? '' : c.category)}
                    className={`w-full text-left group ${active ? 'opacity-100' : ''}`}
                  >
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className={`font-medium ${active ? 'text-brand-bright' : 'text-[var(--text-secondary)]'} group-hover:text-[var(--text-primary)]`}>
                        {CATEGORY_LABEL[c.category] || c.category}
                      </span>
                      <span className="text-[var(--text-muted)]">
                        <span className="text-[var(--text-primary)] font-semibold">{c.open}</span> open / {c.total}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-[var(--input-bg)] overflow-hidden">
                      <div className={`h-full rounded-full ${c.open ? 'bg-brand-bright' : 'bg-slate-600'}`} style={{ width: `${Math.max(pct, c.open ? 6 : 3)}%` }} />
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Severity distribution strip */}
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <ShieldAlert size={15} /> Severity distribution
          </h3>
          {rows === null ? (
            <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : (
            <>
              <div className="flex h-3 w-full rounded-full overflow-hidden bg-[var(--input-bg)] mb-3">
                {SEVERITY_OPTS.map((o) => {
                  const n = severityCounts[o.v] || 0
                  if (!n || !severityTotal) return null
                  return <div key={o.v} className={SEVERITY_BAR[o.v]} style={{ width: `${(n / severityTotal) * 100}%` }} title={`${o.label}: ${n}`} />
                })}
              </div>
              <div className="space-y-1.5">
                {SEVERITY_OPTS.map((o) => {
                  const n = severityCounts[o.v] || 0
                  const active = severityFilter === o.v
                  return (
                    <button
                      key={o.v}
                      onClick={() => setSeverityFilter(active ? '' : o.v)}
                      className={`w-full flex items-center justify-between text-xs px-1.5 py-1 rounded hover:bg-[var(--input-bg)]/60 ${active ? 'bg-[var(--input-bg)]/80' : ''}`}
                    >
                      <span className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-sm ${SEVERITY_BAR[o.v]}`} />
                        <span className="text-[var(--text-secondary)]">{o.label}</span>
                      </span>
                      <span className="text-[var(--text-primary)] font-semibold tabular-nums">{n}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Priority triage queue */}
      {rows !== null && topQueue.length > 0 && (
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <ArrowUpDown size={15} /> Priority queue — act on these first
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {topQueue.map((r) => {
              const overdue = isOverdue(r, nowMs)
              return (
                <button
                  key={r.id}
                  onClick={() => openEdit(r)}
                  className={`text-left rounded-lg border p-3 hover:bg-[var(--input-bg)]/40 transition-colors ${overdue ? 'border-red-800/60 bg-red-950/20' : 'border-[var(--input-border)] bg-[var(--input-bg)]/30'}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <Badge className={SEVERITY_BADGE[r.severity] || SEVERITY_BADGE.info}>
                      {(r.severity || 'info').toUpperCase()}
                    </Badge>
                    {overdue && <Badge className="bg-red-900/40 text-red-300 border-red-800/60"><Clock size={10} className="mr-1" /> Overdue</Badge>}
                  </div>
                  <p className="text-sm font-semibold text-[var(--text-primary)] line-clamp-2">{r.title}</p>
                  <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-[var(--text-muted)]">
                    <span className="inline-flex items-center gap-1"><Zap size={11} /> {CATEGORY_LABEL[r.category] || r.category || '—'}</span>
                    {r.asset_no && <span className="inline-flex items-center gap-1">{r.asset_no}</span>}
                    {r.assigned_to && <span className="inline-flex items-center gap-1"><User size={11} /> {r.assigned_to}</span>}
                    {r.due_date && <span className={`inline-flex items-center gap-1 ${overdue ? 'text-red-400' : ''}`}><Calendar size={11} /> {fmtDate(r.due_date)}</span>}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search title, asset, owner, impact, action, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUS_OPTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
          <select className="input" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} aria-label="Severity">
            <option value="">All severities</option>
            {SEVERITY_OPTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
          <select className="input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {CATEGORY_OPTS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
          </select>
          <button
            onClick={() => setOpenOnly((v) => !v)}
            className={`text-sm inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border ${openOnly ? 'bg-brand-subtle text-brand-bright border-[rgba(22,163,74,0.3)]' : 'border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
          >
            <Bell size={14} /> Open only
          </button>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalItems}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Action', 'Category', 'Severity', 'Status', 'Asset', 'Assigned', 'Due', 'Priority', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {allRows.length === 0 && !notProvisioned ? 'No action items yet — raise your first exception.' : 'No action items match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const overdue = isOverdue(r, nowMs)
                  return (
                    <tr key={r.id} className={`border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40 ${overdue ? 'bg-red-950/15' : ''}`}>
                      <td className="px-4 py-2.5 max-w-[320px]">
                        <div className="font-medium text-[var(--text-primary)] line-clamp-1">{r.title || '—'}</div>
                        {r.recommended_action && <div className="text-[11px] text-[var(--text-muted)] line-clamp-1">{r.recommended_action}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{CATEGORY_LABEL[r.category] || r.category || '—'}</td>
                      <td className="px-4 py-2.5"><Badge className={SEVERITY_BADGE[r.severity] || SEVERITY_BADGE.info}>{(r.severity || 'info').toUpperCase()}</Badge></td>
                      <td className="px-4 py-2.5"><Badge className={STATUS_BADGE[r.status] || STATUS_BADGE.open}>{STATUS_LABEL[r.status] || r.status || 'Open'}</Badge></td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{r.asset_no || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{r.assigned_to || '—'}</td>
                      <td className={`px-4 py-2.5 whitespace-nowrap ${overdue ? 'text-red-400 font-medium' : 'text-[var(--text-secondary)]'}`}>
                        {overdue && <Clock size={12} className="inline mr-1 -mt-0.5" />}{fmtDate(r.due_date)}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] tabular-nums">{r.priority_score ?? '—'}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit action item' : 'Raise action item'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="label">Title</label>
                <input className="input w-full" placeholder="e.g. Steer tyre below legal tread on TRK-1042" value={form.title} maxLength={300} onChange={(e) => set('title', e.target.value)} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Category</label>
                  <select className="input w-full" value={form.category} onChange={(e) => set('category', e.target.value)}>
                    {CATEGORY_OPTS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Severity</label>
                  <select className="input w-full" value={form.severity} onChange={(e) => set('severity', e.target.value)}>
                    {SEVERITY_OPTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {STATUS_OPTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Asset (optional)</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Assigned to (optional)</label>
                  <input className="input w-full" placeholder="e.g. Workshop lead" value={form.assigned_to} maxLength={200} onChange={(e) => set('assigned_to', e.target.value)} />
                </div>
                <div>
                  <label className="label">Priority score (optional)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="0–100" value={form.priority_score} onChange={(e) => set('priority_score', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Due date (optional)</label>
                  <input className="input w-full" type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
                </div>
                <div>
                  <label className="label">Source (optional)</label>
                  <input className="input w-full" placeholder="e.g. TPMS / Inspection / Manual" value={form.source} maxLength={200} onChange={(e) => set('source', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Impact (optional)</label>
                <textarea className="input w-full min-h-[60px] resize-y" placeholder="Operational / cost / safety consequence if not actioned" value={form.impact} maxLength={4000} onChange={(e) => set('impact', e.target.value)} />
              </div>
              <div>
                <label className="label">Recommended action (optional)</label>
                <textarea className="input w-full min-h-[60px] resize-y" placeholder="What should be done, by whom" value={form.recommended_action} maxLength={4000} onChange={(e) => set('recommended_action', e.target.value)} />
              </div>
              {(form.status === 'resolved' || form.status === 'dismissed' || form.resolution) && (
                <div>
                  <label className="label">Resolution (optional)</label>
                  <textarea className="input w-full min-h-[60px] resize-y" placeholder="How it was resolved / why dismissed" value={form.resolution} maxLength={4000} onChange={(e) => set('resolution', e.target.value)} />
                </div>
              )}
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[60px] resize-y" placeholder="Additional context" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Raise action'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this action item?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.title || 'Action item'} · {CATEGORY_LABEL[confirmDelete.category] || confirmDelete.category || '—'}. This can’t be undone.
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
