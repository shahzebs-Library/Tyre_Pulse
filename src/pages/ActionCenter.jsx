/**
 * ActionCenter (route /action-center) - Action Center / Exception Dashboard.
 * A unified, prioritised queue of every operational exception and required
 * action across the fleet: safety, compliance, maintenance, cost, tyre,
 * inspection, and data-quality issues that demand a human decision. This is the
 * OS's triage surface - worst / most-urgent first - so nothing critical is lost
 * in a per-module silo.
 *
 * Runs on the `action_items` table (V186). Real data, KPI tiles, a by-category
 * breakdown, a severity distribution strip, a prioritised triage queue, filters,
 * search, a sortable EnterpriseTable register, create/edit dialog, delete
 * confirm, Excel/PDF export, and loading/empty/error/not-provisioned states.
 *
 * All arithmetic lives in pure engines: prioritisation and roll-ups in
 * `src/lib/actionCenter.js`, and the page shaping (filters, KPI strip with
 * honest nulls, bars, table + export rows) in `src/lib/actionCenterAnalytics.js`.
 * The current time is read once per render and injected into every pure call so
 * ranking stays deterministic within a render.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ListChecks, AlertTriangle, ShieldAlert, Clock, CheckCircle2, Flame,
  Search, X, FileSpreadsheet, FileText, Plus, Pencil, Trash2,
  Layers, ArrowUpDown, Bell, User, Calendar, Zap, UserX,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import {
  listActionItems, createActionItem, updateActionItem, deleteActionItem,
} from '../lib/api/actionCenter'
import { byCategory, bySeverity, isOpen } from '../lib/actionCenter'
import {
  ACTION_CATEGORIES, ACTION_SEVERITIES, ACTION_STATUSES, EMPTY_ACTION_FILTERS,
  activeActionFilterCount, filterActions, actionKpis, categoryBars, severityShares,
  actionTableRows, actionExportRows, ACTION_EXPORT_COLUMNS, categoryLabel,
} from '../lib/actionCenterAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

// Semantic tints. A 500/15 wash reads as a tint on BOTH themes, and every
// text-*-300/400 used here has an html.light override in index.css, so the
// label keeps contrast in light mode. The label text always names the state,
// so colour is never the only signal.
const SEVERITY_BADGE = {
  critical: 'bg-red-500/15 text-red-300 border-red-500/40',
  high: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
  medium: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  low: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  info: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--input-border)]',
}
const SEVERITY_BAR = {
  critical: 'bg-red-500', high: 'bg-orange-500', medium: 'bg-amber-500', low: 'bg-sky-500', info: 'bg-[var(--text-dim)]',
}
const STATUS_BADGE = {
  open: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  acknowledged: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40',
  in_progress: 'bg-violet-500/15 text-violet-300 border-violet-500/40',
  resolved: 'bg-green-500/15 text-green-300 border-green-500/40',
  dismissed: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
}

const EMPTY_FORM = {
  title: '', category: 'other', source: '', asset_no: '', severity: 'medium',
  priority_score: '', assigned_to: '', due_date: '', status: 'open',
  impact: '', recommended_action: '', resolution: '', notes: '',
}

const ICON_BTN = 'inline-flex items-center justify-center w-11 h-11 rounded-lg text-[var(--text-muted)] hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]'

function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}

function Badge({ children, className }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${className}`}>
      {children}
    </span>
  )
}

function Kpi({ label, value, icon: Icon, tone, sub, loading }) {
  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-3xl font-bold mt-1 tabular-nums ${tone}`}>
        {loading ? <span className="inline-block h-8 w-16 rounded bg-[var(--input-bg)] animate-pulse" aria-label="Loading" /> : (value ?? 'N/A')}
      </p>
      {sub && !loading && <p className="text-[11px] text-[var(--text-dim)] mt-0.5">{sub}</p>}
    </div>
  )
}

export default function ActionCenter() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [filters, setFilters] = useState(EMPTY_ACTION_FILTERS)
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // Single clock read per load - injected into every pure helper so the whole
  // page ranks/summarises against one consistent "now".
  const [nowMs, setNowMs] = useState(() => Date.now())

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listActionItems({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
      setNowMs(Date.now())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load action items.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // The first render intentionally uses null to distinguish loading from an
  // empty result. All derived collections must still receive an array; the
  // production route previously crashed here before its request completed.
  const allRows = useMemo(() => (Array.isArray(rows) ? rows : []), [rows])
  const loading = rows === null
  // A failed read is NOT "no action items": the tiles say N/A, never 0.
  const failed = Boolean(error)
  const kpi = useMemo(() => actionKpis(allRows, nowMs), [allRows, nowMs])
  const bars = useMemo(() => categoryBars(byCategory(allRows)), [allRows])
  const shares = useMemo(() => severityShares(bySeverity(allRows)), [allRows])

  const filtered = useMemo(() => filterActions(allRows, filters, nowMs), [allRows, filters, nowMs])
  const tableRows = useMemo(() => actionTableRows(filtered, nowMs), [filtered, nowMs])
  const topQueue = useMemo(() => tableRows.filter((r) => isOpen(r)).slice(0, 6), [tableRows])
  const filterCount = activeActionFilterCount(filters)

  const kv = (v) => (failed ? null : v)
  const kpis = [
    { label: 'Total items', value: kv(kpi.totalItems), icon: ListChecks, tone: 'text-[var(--text-primary)]' },
    { label: 'Open', value: kv(kpi.openCount), icon: Bell, tone: 'text-sky-400' },
    { label: 'Critical open', value: kv(kpi.criticalOpenCount), icon: Flame, tone: 'text-red-400' },
    {
      label: 'Overdue', value: kv(kpi.overdueCount), icon: Clock, tone: 'text-amber-400',
      sub: kpi.overdueShare == null || failed ? 'Nothing open' : `${kpi.overdueShare}% of open items`,
    },
    { label: 'Open, unassigned', value: kv(kpi.unassignedOpen), icon: UserX, tone: 'text-orange-400' },
    {
      label: 'Resolution rate', value: failed || kpi.resolutionRate == null ? null : `${kpi.resolutionRate}%`,
      icon: CheckCircle2, tone: 'text-green-400', sub: `${failed ? 'N/A' : kpi.resolvedCount} resolved`,
    },
  ]

  // ── Export (full filtered set, never just the visible page) ────────────────
  const doExport = async (kind) => {
    const out = actionExportRows(filtered, nowMs)
    const keys = ACTION_EXPORT_COLUMNS.map(([k]) => k)
    const headers = ACTION_EXPORT_COLUMNS.map(([, h]) => h)
    const name = reportFileName('TyrePulse Action Center')
    try {
      if (kind === 'excel') await exportToExcel(out, keys, headers, name)
      else await exportToPdf(out, keys.map((k, i) => ({ key: k, header: headers[i] })), 'Action Center: Exception Queue', name, 'landscape')
    } catch (e) {
      setNotice(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  // ── Dialog ─────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
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
  }, [])
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
      setFormError(toUserMessage(err, 'Could not save the action item.'))
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
      setNotice(toUserMessage(err, 'Could not delete the action item.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  // ── Register columns ───────────────────────────────────────────────────────
  const columns = useMemo(() => [
    {
      id: 'title', header: 'Action', accessorFn: (r) => r.title || '', size: 320,
      cell: ({ row }) => (
        <div className="min-w-0 max-w-[340px]">
          <div className="font-medium text-[var(--text-primary)] line-clamp-1">{row.original.title || 'N/A'}</div>
          {row.original.recommended_action && <div className="text-[11px] text-[var(--text-muted)] line-clamp-1">{row.original.recommended_action}</div>}
        </div>
      ),
    },
    { id: 'category', header: 'Category', accessorFn: (r) => r._categoryLabel, size: 130 },
    {
      id: 'severity', header: 'Severity', accessorFn: (r) => r._score, size: 110,
      meta: { exportValue: (r) => r._severityLabel },
      cell: ({ row }) => <Badge className={SEVERITY_BADGE[row.original.severity] || SEVERITY_BADGE.info}>{row.original._severityLabel}</Badge>,
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => r._statusLabel, size: 120,
      cell: ({ row }) => <Badge className={STATUS_BADGE[row.original.status] || STATUS_BADGE.open}>{row.original._statusLabel}</Badge>,
    },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || '', size: 110, cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'assigned', header: 'Assigned', accessorFn: (r) => r.assigned_to || '', size: 140, cell: ({ getValue }) => getValue() || <span className="text-[var(--text-muted)]">Unassigned</span> },
    {
      id: 'due', header: 'Due', accessorFn: (r) => r.due_date || '', size: 140,
      cell: ({ row }) => (
        <span className={`whitespace-nowrap ${row.original._overdue ? 'text-red-400 font-medium' : 'text-[var(--text-secondary)]'}`}>
          {row.original._overdue && <Clock size={12} className="inline mr-1 -mt-0.5" aria-hidden="true" />}
          {fmtDate(row.original.due_date)}
          {row.original._overdue && <span className="block text-[11px]">{row.original._daysOverdue} days late</span>}
        </span>
      ),
    },
    {
      id: 'priority', header: 'Priority', accessorFn: (r) => (r.priority_score == null || r.priority_score === '' ? null : Number(r.priority_score)),
      size: 90, meta: { align: 'right' }, sortUndefined: 'last',
      cell: ({ getValue }) => <span className="tabular-nums">{getValue() ?? 'N/A'}</span>,
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(row.original) }} className={`${ICON_BTN} hover:text-[var(--text-primary)]`} aria-label={`Edit ${row.original.title || 'action item'}`}><Pencil size={15} /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDelete(row.original) }} className={`${ICON_BTN} hover:text-red-400`} aria-label={`Delete ${row.original.title || 'action item'}`}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ], [openEdit])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Action Center"
        subtitle="A unified, prioritised queue of operational exceptions across the fleet: safety, compliance, maintenance, cost, tyre, inspection, and data-quality actions, worst first."
        icon={ListChecks}
        badge={kpi.openCount && !failed ? `${kpi.openCount} open` : undefined}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => doExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button type="button" onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned}>
              <Plus size={14} /> New action
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-500/40 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">The Action Center is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V186_ACTION_ITEMS.sql</span>, then reload. Nothing has been lost.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-500/40 flex flex-wrap items-start justify-between gap-3" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-red-300 font-medium">Could not load action items.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">{error} The figures below are unavailable until the queue loads.</p>
            </div>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm min-h-[44px]" disabled={refreshing}>Retry</button>
        </div>
      )}

      {notice && (
        <div className="card border border-amber-500/40 flex items-start justify-between gap-3" role="status">
          <p className="text-sm text-amber-300">{notice}</p>
          <button type="button" onClick={() => setNotice('')} className={ICON_BTN} aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => <Kpi key={k.label} {...k} loading={loading} />)}
      </div>

      {/* Breakdown + severity distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Layers size={15} aria-hidden="true" /> Exceptions by category
          </h2>
          {loading ? (
            <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : failed ? (
            <p className="text-sm text-[var(--text-muted)]">Unavailable: the queue could not be loaded.</p>
          ) : bars.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No action items yet.</p>
          ) : (
            <div className="space-y-1">
              {bars.map((c) => {
                const active = filters.category === c.category
                return (
                  <button
                    type="button"
                    key={c.category}
                    onClick={() => setFilter('category', active ? '' : c.category)}
                    aria-pressed={active}
                    className="w-full text-left group rounded-lg px-2 py-1.5 min-h-[44px] hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                  >
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className={`font-medium ${active ? 'text-brand-bright' : 'text-[var(--text-secondary)]'}`}>{c.label}</span>
                      <span className="text-[var(--text-muted)]">
                        <span className="text-[var(--text-primary)] font-semibold">{c.open}</span> open / {c.total}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-[var(--input-bg)] overflow-hidden">
                      <div className={`h-full rounded-full ${c.open ? 'bg-brand-bright' : 'bg-[var(--text-dim)]'}`} style={{ width: `${c.widthPct}%` }} />
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <ShieldAlert size={15} aria-hidden="true" /> Severity distribution
          </h2>
          {loading ? (
            <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : failed ? (
            <p className="text-sm text-[var(--text-muted)]">Unavailable: the queue could not be loaded.</p>
          ) : (
            <>
              <div className="flex h-3 w-full rounded-full overflow-hidden bg-[var(--input-bg)] mb-3" role="img"
                aria-label={shares.map((s) => `${s.label} ${s.count}`).join(', ')}>
                {shares.map((s) => (s.count ? <div key={s.key} className={SEVERITY_BAR[s.key]} style={{ width: `${s.pct}%` }} /> : null))}
              </div>
              <div className="space-y-0.5">
                {shares.map((s) => {
                  const active = filters.severity === s.key
                  return (
                    <button
                      type="button"
                      key={s.key}
                      onClick={() => setFilter('severity', active ? '' : s.key)}
                      aria-pressed={active}
                      className={`w-full flex items-center justify-between text-xs px-2 min-h-[36px] rounded-lg hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${active ? 'bg-[var(--input-bg)]' : ''}`}
                    >
                      <span className="flex items-center gap-2">
                        <span className={`w-2.5 h-2.5 rounded-sm ${SEVERITY_BAR[s.key]}`} aria-hidden="true" />
                        <span className="text-[var(--text-secondary)]">{s.label}</span>
                      </span>
                      <span className="text-[var(--text-primary)] font-semibold tabular-nums">{s.count}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Priority triage queue */}
      {!loading && topQueue.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <ArrowUpDown size={15} aria-hidden="true" /> Priority queue: act on these first
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {topQueue.map((r) => (
              <button
                type="button"
                key={r.id}
                onClick={() => openEdit(r)}
                className={`text-left rounded-lg border p-3 hover:bg-[var(--input-bg)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${r._overdue ? 'border-red-500/50 bg-red-500/5' : 'border-[var(--input-border)] bg-[var(--input-bg)]/30'}`}
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <Badge className={SEVERITY_BADGE[r.severity] || SEVERITY_BADGE.info}>{r._severityLabel}</Badge>
                  {r._overdue && <Badge className="bg-red-500/15 text-red-300 border-red-500/40"><Clock size={10} className="mr-1" aria-hidden="true" /> {r._daysOverdue} days overdue</Badge>}
                </div>
                <p className="text-sm font-semibold text-[var(--text-primary)] line-clamp-2">{r.title}</p>
                <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-[var(--text-muted)]">
                  <span className="inline-flex items-center gap-1"><Zap size={11} aria-hidden="true" /> {r._categoryLabel}</span>
                  {r.asset_no && <span>{r.asset_no}</span>}
                  <span className="inline-flex items-center gap-1"><User size={11} aria-hidden="true" /> {r.assigned_to || 'Unassigned'}</span>
                  {r.due_date && <span className={`inline-flex items-center gap-1 ${r._overdue ? 'text-red-400' : ''}`}><Calendar size={11} aria-hidden="true" /> {fmtDate(r.due_date)}</span>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(220px,2fr)_1fr_1fr_1fr_auto] gap-3 items-end">
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Search</span>
            <div className="relative mt-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input className="input pl-9 w-full min-h-[44px]" placeholder="Title, asset, owner, impact, action, notes" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
            </div>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Status</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">All statuses</option>
              {ACTION_STATUSES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Severity</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.severity} onChange={(e) => setFilter('severity', e.target.value)}>
              <option value="">All severities</option>
              {ACTION_SEVERITIES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Category</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.category} onChange={(e) => setFilter('category', e.target.value)}>
              <option value="">All categories</option>
              {ACTION_CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setFilter('openOnly', !filters.openOnly)}
            aria-pressed={filters.openOnly}
            className={`text-sm inline-flex items-center justify-center gap-1.5 px-3 min-h-[44px] rounded-lg border ${filters.openOnly ? 'bg-brand-subtle text-brand-bright border-[var(--accent)]' : 'border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
          >
            <Bell size={14} aria-hidden="true" /> Open only
          </button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
          <span className="text-xs text-[var(--text-muted)]" aria-live="polite">
            {filtered.length} of {allRows.length} action items{filterCount ? `, ${filterCount} filter${filterCount === 1 ? '' : 's'} applied` : ''}. Ranked worst first.
          </span>
          {filterCount > 0 && (
            <button type="button" onClick={() => setFilters(EMPTY_ACTION_FILTERS)} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <X size={14} /> Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Register */}
      <EnterpriseTable
        columns={columns}
        data={tableRows}
        getRowId={(r) => String(r.id)}
        loading={loading}
        error={failed ? error : null}
        onRetry={load}
        enableGlobalFilter={false}
        enableExport={false}
        initialPageSize={25}
        viewKey="action-center"
        onRowClick={(r) => openEdit(r)}
        emptyMessage={
          notProvisioned ? 'Enable the Action Center to start raising exceptions.'
            : allRows.length === 0 ? 'No action items yet. Raise your first exception with New action.'
              : 'No action items match these filters.'
        }
      />

      {/* Create / Edit dialog */}
      <Modal
        open={showModal}
        onClose={closeModal}
        title={editing ? 'Edit action item' : 'Raise action item'}
        size="lg"
      >
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="label">Title</span>
            <input className="input w-full" required placeholder="e.g. Steer tyre below legal tread on TRK-1042" value={form.title} maxLength={300} onChange={(e) => set('title', e.target.value)} />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="block">
              <span className="label">Category</span>
              <select className="input w-full" value={form.category} onChange={(e) => set('category', e.target.value)}>
                {ACTION_CATEGORIES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Severity</span>
              <select className="input w-full" value={form.severity} onChange={(e) => set('severity', e.target.value)}>
                {ACTION_SEVERITIES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">Status</span>
              <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {ACTION_STATUSES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="block">
              <span className="label">Asset (optional)</span>
              <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
            </label>
            <label className="block">
              <span className="label">Assigned to (optional)</span>
              <input className="input w-full" placeholder="e.g. Workshop lead" value={form.assigned_to} maxLength={200} onChange={(e) => set('assigned_to', e.target.value)} />
            </label>
            <label className="block">
              <span className="label">Priority score (optional)</span>
              <input className="input w-full" type="number" step="1" min="0" placeholder="0 to 100" value={form.priority_score} onChange={(e) => set('priority_score', e.target.value)} />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="label">Due date (optional)</span>
              <input className="input w-full" type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
            </label>
            <label className="block">
              <span className="label">Source (optional)</span>
              <input className="input w-full" placeholder="e.g. TPMS / Inspection / Manual" value={form.source} maxLength={200} onChange={(e) => set('source', e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="label">Impact (optional)</span>
            <textarea className="input w-full min-h-[60px] resize-y" placeholder="Operational, cost or safety consequence if not actioned" value={form.impact} maxLength={4000} onChange={(e) => set('impact', e.target.value)} />
          </label>
          <label className="block">
            <span className="label">Recommended action (optional)</span>
            <textarea className="input w-full min-h-[60px] resize-y" placeholder="What should be done, by whom" value={form.recommended_action} maxLength={4000} onChange={(e) => set('recommended_action', e.target.value)} />
          </label>
          {(form.status === 'resolved' || form.status === 'dismissed' || form.resolution) && (
            <label className="block">
              <span className="label">Resolution (optional)</span>
              <textarea className="input w-full min-h-[60px] resize-y" placeholder="How it was resolved or why it was dismissed" value={form.resolution} maxLength={4000} onChange={(e) => set('resolution', e.target.value)} />
            </label>
          )}
          <label className="block">
            <span className="label">Notes (optional)</span>
            <textarea className="input w-full min-h-[60px] resize-y" placeholder="Additional context" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
          </label>

          {formError && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2" role="alert">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Raise action'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title="Delete this action item?"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} /> {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </>
        )}
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-muted)]">
            {confirmDelete.title || 'Action item'} ({categoryLabel(confirmDelete.category)}). This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
