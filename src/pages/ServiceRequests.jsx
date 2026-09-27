/**
 * ServiceRequests (route /service-requests) - Service Requests. A ticketed
 * request queue that precedes work orders: customers or internal staff raise a
 * request against an asset (tyre, mechanical, electrical, bodywork,
 * inspection, breakdown, or other), it is triaged, worked, and resolved/closed.
 *
 * Runs on the `service_requests` table (V174). KPI strip (open, urgent, past
 * response target, unassigned, resolution time), a status strip that doubles as
 * a filter, monthly raised vs resolved and category charts, filters + search, a
 * sortable EnterpriseTable register, create/edit, delete, and Excel/PDF export.
 * All derived figures live in the pure `src/lib/serviceRequestsAnalytics.js`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'
import { Bar } from 'react-chartjs-2'
import {
  Wrench, ClipboardList, Inbox, Flame, Timer, AlertTriangle, Search, X, AlarmClock,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, UserX, CheckCheck, Layers,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import {
  listServiceRequests, createServiceRequest, updateServiceRequest, deleteServiceRequest,
} from '../lib/api/serviceRequests'
import {
  SR_CATEGORIES, SR_PRIORITIES, SR_STATUSES, RESPONSE_TARGET_HOURS, EMPTY_SR_FILTERS,
  enrichRequests, filterRequests, srKpis, monthlyFlow, categoryMix, assigneeOptions,
  activeSrFilterCount, srExportRows, SR_EXPORT_COLUMNS, statusLabel, cap,
} from '../lib/serviceRequestsAnalytics'
import { colorAt, withAlpha } from '../lib/reportColors'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

/** The service returns the newest rows up to this cap; the page says so when it is reached. */
const LIST_CAP = 500

const EMPTY_FORM = {
  request_no: '', asset_no: '', requester_name: '', contact: '', category: 'tyre',
  priority: 'medium', status: 'new', subject: '', description: '',
  requested_at: '', resolved_at: '', assigned_to: '', resolution: '', notes: '',
}

// Semantic tints: the label always names the value, colour only reinforces it.
const PRIORITY_BADGE = {
  low: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--input-border)]',
  medium: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  high: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  urgent: 'bg-red-500/15 text-red-300 border-red-500/40',
}
const STATUS_BADGE = {
  new: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40',
  triaged: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  in_progress: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  resolved: 'bg-green-500/15 text-green-300 border-green-500/40',
  closed: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--input-border)]',
  cancelled: 'bg-red-500/15 text-red-300 border-red-500/40',
}
const ICON_BTN = 'inline-flex items-center justify-center w-11 h-11 rounded-lg text-[var(--text-muted)] hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]'

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}
function fmtHours(v) {
  if (v == null) return 'N/A'
  if (v < 24) return `${v.toFixed(1)} h`
  return `${(v / 24).toFixed(1)} d`
}

function Badge({ value, map, label }) {
  if (!value) return <span className="text-[var(--text-muted)]">N/A</span>
  const cls = map[value] || 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--input-border)]'
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${cls}`}>
      {label ? label(value) : cap(value)}
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

export default function ServiceRequests() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const [filters, setFilters] = useState(EMPTY_SR_FILTERS)
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listServiceRequests({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
      setNowMs(Date.now())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load service requests.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loading = rows === null
  const failed = Boolean(error) || notProvisioned
  const enriched = useMemo(() => enrichRequests(rows || [], nowMs), [rows, nowMs])
  const kpi = useMemo(() => srKpis(enriched), [enriched])
  const assignees = useMemo(() => assigneeOptions(rows || []), [rows])
  const filtered = useMemo(() => filterRequests(enriched, filters), [enriched, filters])
  const flow = useMemo(() => monthlyFlow(filtered).slice(-12), [filtered])
  const categories = useMemo(() => categoryMix(enriched), [enriched])
  const filterCount = activeSrFilterCount(filters)
  const capped = (rows || []).length >= LIST_CAP

  const kv = (v) => (failed ? null : v)
  const kpis = [
    { label: 'Total requests', value: kv(kpi.total), icon: ClipboardList, tone: 'text-[var(--text-primary)]', sub: failed || kpi.resolvedPct == null ? null : `${kpi.resolvedPct}% resolved or closed` },
    { label: 'Open', value: kv(kpi.open), icon: Inbox, tone: 'text-sky-400', sub: failed || kpi.avgOpenAgeHours == null ? null : `Average wait ${fmtHours(kpi.avgOpenAgeHours)}` },
    { label: 'Urgent open', value: kv(kpi.urgentOpen), icon: Flame, tone: 'text-red-400' },
    { label: 'Past response target', value: kv(kpi.overdue), icon: AlarmClock, tone: kpi.overdue ? 'text-orange-400' : 'text-green-400', sub: 'Open longer than the priority target' },
    { label: 'Unassigned open', value: kv(kpi.unassignedOpen), icon: UserX, tone: 'text-amber-400' },
    { label: 'Avg resolution', value: failed ? null : fmtHours(kpi.avgResolutionHours), icon: Timer, tone: 'text-green-400', sub: failed ? null : `${kpi.resolutionSample} with both dates` },
  ]

  const doExport = async (kind) => {
    const out = srExportRows(filtered)
    const keys = SR_EXPORT_COLUMNS.map(([k]) => k)
    const headers = SR_EXPORT_COLUMNS.map(([, h]) => h)
    const name = reportFileName('TyrePulse Service Requests')
    try {
      if (kind === 'excel') await exportToExcel(out, keys, headers, name)
      else await exportToPdf(out, keys.map((k, i) => ({ key: k, header: headers[i] })), 'Service Requests', name, 'landscape')
    } catch (e) { setNotice(toUserMessage(e, 'Could not export. Try again.')) }
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      request_no: r.request_no || '', asset_no: r.asset_no || '',
      requester_name: r.requester_name || '', contact: r.contact || '',
      category: r.category || 'tyre', priority: r.priority || 'medium',
      status: r.status || 'new', subject: r.subject || '', description: r.description || '',
      requested_at: r.requested_at ? String(r.requested_at).slice(0, 16) : '',
      resolved_at: r.resolved_at ? String(r.resolved_at).slice(0, 16) : '',
      assigned_to: r.assigned_to || '', resolution: r.resolution || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.subject.trim()) { setFormError('A subject is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        requested_at: form.requested_at || null,
        resolved_at: form.resolved_at || null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateServiceRequest(editing.id, payload)
      else await createServiceRequest(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the request.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteServiceRequest(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setNotice(toUserMessage(err, 'Could not delete the request.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const columns = useMemo(() => [
    { id: 'request', header: 'Request', accessorFn: (r) => r.request_no || '', size: 120, cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)] whitespace-nowrap">{getValue() || 'N/A'}</span> },
    { id: 'subject', header: 'Subject', accessorFn: (r) => r.subject || '', size: 260, cell: ({ getValue }) => <span className="text-[var(--text-primary)] break-words">{getValue() || 'N/A'}</span> },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || '', size: 110, cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'category', header: 'Category', accessorFn: (r) => cap(r.category), size: 110 },
    {
      id: 'priority', header: 'Priority', accessorFn: (r) => SR_PRIORITIES.indexOf(String(r.priority || '').toLowerCase()), size: 100,
      cell: ({ row }) => <Badge value={row.original.priority} map={PRIORITY_BADGE} />,
    },
    { id: 'status', header: 'Status', accessorFn: (r) => r._statusLabel, size: 120, cell: ({ row }) => <Badge value={row.original.status} map={STATUS_BADGE} label={statusLabel} /> },
    { id: 'assigned', header: 'Assigned to', accessorFn: (r) => r.assigned_to || '', size: 140, cell: ({ getValue }) => getValue() || <span className="text-amber-400">Unassigned</span> },
    { id: 'requested', header: 'Requested', accessorFn: (r) => (r.requested_at ? new Date(r.requested_at).getTime() : null), size: 170, sortUndefined: 'last', cell: ({ row }) => <span className="whitespace-nowrap">{fmtDateTime(row.original.requested_at)}</span> },
    {
      id: 'age', header: 'Open age', accessorFn: (r) => r._age, size: 130, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ row }) => {
        const r = row.original
        if (!r._open) return <span className="text-[var(--text-muted)]">{r._resolution == null ? 'Closed' : `Resolved in ${fmtHours(r._resolution)}`}</span>
        if (r._age == null) return <span className="text-[var(--text-muted)]">N/A</span>
        return (
          <span className={r._overdue ? 'text-orange-400 font-medium' : 'text-[var(--text-secondary)]'}>
            {fmtHours(r._age)}{r._overdue && <span className="block text-[11px]">Past target</span>}
          </span>
        )
      },
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false },
      cell: ({ row }) => {
        const who = row.original.request_no || row.original.subject || 'request'
        return (
          <div className="flex items-center justify-end gap-1">
            <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(row.original) }} className={`${ICON_BTN} hover:text-[var(--text-primary)]`} aria-label={`Edit ${who}`}><Pencil size={15} /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDelete(row.original) }} className={`${ICON_BTN} hover:text-red-400`} aria-label={`Delete ${who}`}><Trash2 size={15} /></button>
          </div>
        )
      },
    },
  ], [openEdit])

  const flowChart = {
    labels: flow.map((m) => m.month),
    datasets: [
      { label: 'Raised', data: flow.map((m) => m.raised), backgroundColor: withAlpha(colorAt(0), 0.85), borderRadius: 4, maxBarThickness: 26 },
      { label: 'Resolved', data: flow.map((m) => m.resolved), backgroundColor: withAlpha(colorAt(2), 0.85), borderRadius: 4, maxBarThickness: 26 },
    ],
  }
  const flowOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: 'var(--text-secondary)', boxWidth: 12 } } },
    scales: {
      x: { ticks: { color: 'var(--text-muted)' }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { color: 'var(--text-muted)', precision: 0 }, grid: { color: 'var(--panel-2)' } },
    },
  }
  const catChart = {
    labels: categories.map((c) => cap(c.category)),
    datasets: [{ label: 'Requests', data: categories.map((c) => c.count), backgroundColor: categories.map((_, i) => colorAt(i)), borderRadius: 4, maxBarThickness: 28 }],
  }
  const catOpts = {
    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: {
      x: { beginAtZero: true, ticks: { color: 'var(--text-muted)', precision: 0 }, grid: { color: 'var(--panel-2)' } },
      y: { ticks: { color: 'var(--text-secondary)' }, grid: { display: false } },
    },
  }
  const unavailable = <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">Unavailable: requests could not be loaded.</div>

  return (
    <div className="space-y-6">
      <PageHeader
        title="Service Requests"
        subtitle="Intake queue for customer and internal service requests: triage, prioritise, assign, and resolve tickets before they become work orders."
        icon={Wrench}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => doExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => doExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned}>
              <Plus size={14} aria-hidden="true" /> New request
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-500/40 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Service requests are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V174_SERVICE_REQUESTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-500/40 flex flex-wrap items-start justify-between gap-3" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-red-300 font-medium">Could not load service requests.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">{error} The figures below are unavailable until the queue loads.</p>
            </div>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm min-h-[44px]" disabled={refreshing}>Retry</button>
        </div>
      )}

      {capped && !failed && (
        <div className="card border border-sky-500/40 flex items-start gap-3" role="status">
          <Layers size={18} className="text-sky-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-sm text-[var(--text-secondary)]">
            Showing the newest {LIST_CAP} requests. Older requests are not included in these figures or exports.
          </p>
        </div>
      )}

      {notice && (
        <div className="card border border-amber-500/40 flex items-start justify-between gap-3" role="status">
          <p className="text-sm text-amber-300">{notice}</p>
          <button type="button" onClick={() => setNotice('')} className={ICON_BTN} aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => <Kpi key={k.label} {...k} loading={loading} />)}
      </div>

      {/* Status strip - each tile filters the register */}
      <section className="card" aria-labelledby="sr-status-heading">
        <h2 id="sr-status-heading" className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <ClipboardList size={15} aria-hidden="true" /> Requests by status
        </h2>
        {loading ? (
          <div className="h-14 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : failed ? (
          <p className="text-sm text-[var(--text-muted)]">Unavailable: requests could not be loaded.</p>
        ) : kpi.total === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No requests raised yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            {SR_STATUSES.map((s) => {
              const active = filters.status === s
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter('status', active ? '' : s)}
                  className={`rounded-lg border px-3 py-2 text-left min-h-[44px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${active ? 'border-[var(--accent)] bg-[var(--input-bg)]' : 'border-[var(--input-border)] hover:bg-[var(--input-bg)]'}`}
                >
                  <span className="block text-[11px] text-[var(--text-muted)]">{statusLabel(s)}</span>
                  <span className="block text-lg font-bold text-[var(--text-primary)] tabular-nums">{kpi.byStatus[s]}</span>
                </button>
              )
            })}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-1.5"><CheckCheck size={15} aria-hidden="true" /> Raised vs resolved by month</h2>
          <p className="text-xs text-[var(--text-muted)] mb-3">Last 12 months in this view.</p>
          <div className="h-64">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : failed ? unavailable
                : flow.length ? (
                  <div className="h-full" role="img" aria-label={flow.map((m) => `${m.month}: ${m.raised} raised, ${m.resolved} resolved`).join('; ')}>
                    <Bar data={flowChart} options={flowOpts} />
                  </div>
                ) : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No dated requests in this view.</div>}
          </div>
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5"><Layers size={15} aria-hidden="true" /> By category</h2>
          <div className="h-64">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : failed ? unavailable
                : categories.length ? (
                  <div className="h-full" role="img" aria-label={categories.map((c) => `${cap(c.category)} ${c.count}`).join(', ')}>
                    <Bar data={catChart} options={catOpts} />
                  </div>
                ) : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No requests raised yet.</div>}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(200px,2fr)_1fr_1fr_1fr_1fr] gap-3 items-end">
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Search</span>
            <div className="relative mt-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input className="input pl-9 w-full min-h-[44px]" placeholder="Request #, subject, asset, requester, notes" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
            </div>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Status</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">All statuses</option>
              {SR_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Priority</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.priority} onChange={(e) => setFilter('priority', e.target.value)}>
              <option value="">All priorities</option>
              {SR_PRIORITIES.map((p) => <option key={p} value={p}>{cap(p)} (target {RESPONSE_TARGET_HOURS[p]} h)</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Category</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.category} onChange={(e) => setFilter('category', e.target.value)}>
              <option value="">All categories</option>
              {SR_CATEGORIES.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Assigned to</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.assignee} onChange={(e) => setFilter('assignee', e.target.value)}>
              <option value="">Anyone</option>
              <option value="__none">Unassigned</option>
              {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFilter('openOnly', !filters.openOnly)}
              aria-pressed={filters.openOnly}
              className={`text-sm inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg border ${filters.openOnly ? 'bg-brand-subtle text-brand-bright border-[var(--accent)]' : 'border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            >
              <Inbox size={14} aria-hidden="true" /> Open only
            </button>
            <button
              type="button"
              onClick={() => setFilter('overdueOnly', !filters.overdueOnly)}
              aria-pressed={filters.overdueOnly}
              className={`text-sm inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-lg border ${filters.overdueOnly ? 'bg-brand-subtle text-brand-bright border-[var(--accent)]' : 'border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
            >
              <AlarmClock size={14} aria-hidden="true" /> Past target
            </button>
            <span className="text-xs text-[var(--text-muted)]" aria-live="polite">{filtered.length} of {kpi.total} requests</span>
          </div>
          {filterCount > 0 && (
            <button type="button" onClick={() => setFilters(EMPTY_SR_FILTERS)} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <X size={14} aria-hidden="true" /> Clear filters
            </button>
          )}
        </div>
      </div>

      <EnterpriseTable
        columns={columns}
        data={filtered}
        getRowId={(r) => String(r.id)}
        loading={loading}
        enableGlobalFilter={false}
        enableExport={false}
        initialPageSize={25}
        viewKey="service-requests"
        onRowClick={(r) => openEdit(r)}
        emptyMessage={
          failed ? 'Service requests are unavailable.'
            : kpi.total === 0 ? 'No requests raised yet. Create your first request.'
              : 'No requests match these filters.'
        }
      />

      <Modal open={showModal} onClose={closeModal} title={editing ? 'Edit request' : 'New service request'} size="lg">
        <form onSubmit={submit} className="space-y-4">
          <label className="block"><span className="label">Subject <span className="text-red-400" aria-hidden="true">*</span></span>
            <input className="input w-full min-h-[44px]" placeholder="e.g. Front-left tyre losing pressure" value={form.subject} maxLength={300} required onChange={(e) => set('subject', e.target.value)} />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="block"><span className="label">Category</span>
              <select className="input w-full min-h-[44px]" value={form.category} onChange={(e) => set('category', e.target.value)}>
                {SR_CATEGORIES.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
              </select>
            </label>
            <label className="block"><span className="label">Priority</span>
              <select className="input w-full min-h-[44px]" value={form.priority} onChange={(e) => set('priority', e.target.value)}>
                {SR_PRIORITIES.map((p) => <option key={p} value={p}>{cap(p)}</option>)}
              </select>
            </label>
            <label className="block"><span className="label">Status</span>
              <select className="input w-full min-h-[44px]" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {SR_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block"><span className="label">Request # (optional)</span>
              <input className="input w-full min-h-[44px]" placeholder="e.g. SR-2026-0142" value={form.request_no} maxLength={60} onChange={(e) => set('request_no', e.target.value)} />
            </label>
            <label className="block"><span className="label">Asset number (optional)</span>
              <input className="input w-full min-h-[44px]" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="block"><span className="label">Requester (optional)</span>
              <input className="input w-full min-h-[44px]" placeholder="Name" value={form.requester_name} maxLength={200} onChange={(e) => set('requester_name', e.target.value)} />
            </label>
            <label className="block"><span className="label">Contact (optional)</span>
              <input className="input w-full min-h-[44px]" placeholder="Phone or email" value={form.contact} maxLength={200} onChange={(e) => set('contact', e.target.value)} />
            </label>
            <label className="block"><span className="label">Assigned to (optional)</span>
              <input className="input w-full min-h-[44px]" placeholder="Technician or team" value={form.assigned_to} maxLength={200} onChange={(e) => set('assigned_to', e.target.value)} />
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block"><span className="label">Requested at</span>
              <input className="input w-full min-h-[44px]" type="datetime-local" value={form.requested_at} onChange={(e) => set('requested_at', e.target.value)} />
              <span className="block text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use now.</span>
            </label>
            <label className="block"><span className="label">Resolved at (optional)</span>
              <input className="input w-full min-h-[44px]" type="datetime-local" value={form.resolved_at} onChange={(e) => set('resolved_at', e.target.value)} />
            </label>
          </div>
          <label className="block"><span className="label">Description (optional)</span>
            <textarea className="input w-full min-h-[70px] resize-y" placeholder="What is being requested, symptoms, context" value={form.description} maxLength={8000} onChange={(e) => set('description', e.target.value)} />
          </label>
          <label className="block"><span className="label">Resolution (optional)</span>
            <textarea className="input w-full min-h-[60px] resize-y" placeholder="How it was resolved, parts and labour, outcome" value={form.resolution} maxLength={8000} onChange={(e) => set('resolution', e.target.value)} />
          </label>
          <label className="block"><span className="label">Notes (optional)</span>
            <textarea className="input w-full min-h-[60px] resize-y" placeholder="Internal notes" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
          </label>

          {formError && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2" role="alert">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create request'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title="Delete this request?"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </>
        )}
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-muted)]">
            {confirmDelete.request_no || confirmDelete.subject || 'Request'}, {cap(confirmDelete.category)}, {statusLabel(confirmDelete.status)}. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
