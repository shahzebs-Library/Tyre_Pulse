/**
 * IncidentReports (route /incidents) - the SAFETY operational incident log
 * (near-miss, damage, breakdown, safety, theft) raised against an asset/site.
 * Runs on the `incident_reports` table via `src/lib/api/incidents.js`
 * (apply MIGRATIONS_V138_INCIDENT_REPORTS.sql). Distinct from the formal
 * Accidents module AND from the console platform-incident workflow.
 *
 * KPI strip, 12-month trend, type and site breakdowns, search + status /
 * severity / type / site / date filters, a sortable EnterpriseTable register,
 * create/edit, delete confirmation, Excel/PDF export, and loading / empty /
 * error states throughout. Derived figures live in the pure
 * `src/lib/incidentReportsAnalytics.js` engine.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  AlertOctagon, Plus, Trash2, Pencil, X, Search, Filter, ShieldAlert,
  CheckCircle2, Inbox, FileSpreadsheet, FileText, AlertTriangle, Loader2,
  RefreshCw, Timer, Percent, BarChart3, Building2,
} from 'lucide-react'
import { Chart as ChartJS, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js'
import { Bar } from 'react-chartjs-2'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import {
  listIncidents, createIncident, updateIncident, deleteIncident,
  INCIDENT_TYPES, INCIDENT_SEVERITIES, INCIDENT_STATUSES,
} from '../lib/api/incidents'
import {
  incidentTableRows, filterIncidents, hasIncidentFilters, incidentKpis, incidentMonthlyTrend,
  incidentsBySite, incidentsByType, incidentExportRows, incidentSiteOptions, incidentTypeLabel,
  INCIDENT_SEVERITY_LABEL, INCIDENT_STATUS_LABEL, INCIDENT_EXPORT_COLS, INCIDENT_EXPORT_HEADERS,
} from '../lib/incidentReportsAnalytics'
import { colorAt, withAlpha } from '../lib/reportColors'
import { compareValues } from '../lib/consoleTable'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend)

// Semantic severity / status styling: every badge carries its text label too,
// so colour is never the only signal.
const SEVERITY_CLS = {
  low: 'bg-slate-700/40 text-slate-300 border border-slate-600/50',
  medium: 'bg-sky-900/40 text-sky-300 border border-sky-700/50',
  high: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  critical: 'bg-red-900/40 text-red-300 border border-red-700/50',
}
const STATUS_CLS = {
  open: 'bg-sky-900/40 text-sky-300 border border-sky-700/50',
  investigating: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  resolved: 'bg-green-900/40 text-green-300 border border-green-700/50',
  closed: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}
const STATUS_TONE = { open: 'text-sky-400', investigating: 'text-amber-400', resolved: 'text-green-400', closed: 'text-[var(--text-muted)]' }

const BAR_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { position: 'bottom', labels: { color: 'var(--text-muted)', boxWidth: 10 } } },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { display: false } },
    y: { beginAtZero: true, ticks: { color: 'var(--text-muted)', precision: 0 }, grid: { color: 'var(--panel-2)' } },
  },
}
const HBAR_OPTS = { ...BAR_OPTS, indexAxis: 'y', plugins: { legend: { display: false } } }

const sortBy = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))

const emptyForm = (country) => ({
  incident_no: '',
  incident_type: 'other',
  asset_no: '',
  site: '',
  incident_date: new Date().toISOString().slice(0, 10),
  severity: 'medium',
  reported_by: '',
  description: '',
  action_taken: '',
  status: 'open',
  country: country && country !== 'All' ? country : null,
})

export default function IncidentReports() {
  const { activeCountry } = useSettings() || {}
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  const [statusFilter, setStatusFilter] = useState('all')
  const [severityFilter, setSeverityFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm(activeCountry))
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listIncidents({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setNow(Date.now())
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setMissing(true)
      else setError(toUserMessage(err, 'Could not load incident reports.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // A failed read is not an empty log: figures read N/A, never zero.
  const known = rows !== null && !error
  const filters = { status: statusFilter, severity: severityFilter, type: typeFilter, site: siteFilter, from: fromDate, to: toDate, search }
  const hasFilters = hasIncidentFilters(filters)
  const siteOptions = useMemo(() => incidentSiteOptions(rows || []), [rows])
  const filtered = useMemo(
    () => filterIncidents(rows || [], { status: statusFilter, severity: severityFilter, type: typeFilter, site: siteFilter, from: fromDate, to: toDate, search }),
    [rows, statusFilter, severityFilter, typeFilter, siteFilter, fromDate, toDate, search],
  )
  const tableRows = useMemo(() => incidentTableRows(filtered, now), [filtered, now])
  const kpi = useMemo(() => incidentKpis(filtered, now), [filtered, now])
  const trend = useMemo(() => incidentMonthlyTrend(filtered, now, 12), [filtered, now])
  const byType = useMemo(() => incidentsByType(filtered), [filtered])
  const bySite = useMemo(() => incidentsBySite(filtered), [filtered])

  const kpis = [
    { label: 'Total incidents', value: kpi.total, icon: AlertOctagon, tone: 'text-[var(--text-primary)]' },
    { label: 'Open / investigating', value: kpi.open, icon: Inbox, tone: 'text-sky-400' },
    { label: 'High / critical', value: kpi.highCritical, icon: ShieldAlert, tone: kpi.highCritical > 0 ? 'text-red-400' : 'text-[var(--text-muted)]' },
    { label: 'Resolved / closed', value: kpi.resolved, icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'Resolution rate', value: kpi.resolutionRatePct == null ? 'N/A' : `${kpi.resolutionRatePct}%`, icon: Percent, tone: 'text-violet-400' },
    { label: 'Avg open age', value: kpi.avgOpenAgeDays == null ? 'N/A' : `${kpi.avgOpenAgeDays}d`, sub: kpi.oldestOpenDays == null ? 'no dated open incidents' : `oldest ${kpi.oldestOpenDays}d`, icon: Timer, tone: 'text-amber-400' },
  ]

  const trendData = {
    labels: trend.labels,
    datasets: [
      { label: 'All incidents', data: trend.counts, backgroundColor: withAlpha(colorAt(0), 0.75), borderRadius: 4 },
      { label: 'High / critical', data: trend.highCritical, backgroundColor: withAlpha('#ef4444', 0.75), borderRadius: 4 },
    ],
  }
  const typeData = {
    labels: byType.map((t) => t.label),
    datasets: [{ label: 'Incidents', data: byType.map((t) => t.count), backgroundColor: byType.map((_, i) => withAlpha(colorAt(i), 0.8)), borderRadius: 4 }],
  }

  const exportName = reportFileName('Incident Reports')
  const runExport = async (kind) => {
    setActionError('')
    try {
      const out = incidentExportRows(filtered, now)
      if (kind === 'excel') await exportToExcel(out, INCIDENT_EXPORT_COLS, INCIDENT_EXPORT_HEADERS, exportName)
      else await exportToPdf(out, INCIDENT_EXPORT_COLS.map((k, i) => ({ key: k, header: INCIDENT_EXPORT_HEADERS[i] })), 'Incident Reports', exportName, 'landscape')
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm(activeCountry))
    setFormError('')
    setModalOpen(true)
  }
  const openEdit = (inc) => {
    setEditing(inc)
    setForm({
      incident_no: inc.incident_no || '',
      incident_type: inc.incident_type || 'other',
      asset_no: inc.asset_no || '',
      site: inc.site || '',
      incident_date: (inc.incident_date || '').slice(0, 10),
      severity: inc.severity || 'medium',
      reported_by: inc.reported_by || '',
      description: inc.description || '',
      action_taken: inc.action_taken || '',
      status: inc.status || 'open',
      country: inc.country ?? null,
    })
    setFormError('')
    setModalOpen(true)
  }
  const closeModal = () => { if (!saving) setModalOpen(false) }

  const save = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.description.trim() && !form.asset_no.trim()) {
      setFormError('Add a description or link an asset before saving.')
      return
    }
    setSaving(true)
    try {
      if (editing) {
        const updated = await updateIncident(editing.id, form)
        setRows((prev) => (prev || []).map((r) => (r.id === updated.id ? updated : r)))
      } else {
        const created = await createIncident(form)
        setRows((prev) => [created, ...(prev || [])])
      }
      setModalOpen(false)
      setUpdatedAt(new Date())
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the incident. Please try again.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteIncident(confirmDelete.id)
      setRows((prev) => (prev || []).filter((r) => r.id !== confirmDelete.id))
      setConfirmDelete(null)
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the incident.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete])

  const clearFilters = () => {
    setStatusFilter('all'); setSeverityFilter('all'); setTypeFilter('all'); setSiteFilter(''); setFromDate(''); setToDate(''); setSearch('')
  }

  const columns = [
    { id: 'no', header: 'Incident #', accessorFn: (r) => r.incident_no || undefined, sortingFn: sortBy, sortUndefined: 'last', size: 130, cell: ({ getValue }) => <span className="font-mono text-xs text-[var(--text-primary)]">{getValue() || 'N/A'}</span> },
    { id: 'type', header: 'Type', accessorFn: (r) => r._typeLabel, sortingFn: sortBy, size: 120 },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || undefined, sortingFn: sortBy, sortUndefined: 'last', size: 120, cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || undefined, sortingFn: sortBy, sortUndefined: 'last', size: 140, cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'date', header: 'Date', accessorFn: (r) => r._date || undefined, sortingFn: sortBy, sortUndefined: 'last', size: 120, cell: ({ getValue }) => getValue() || 'N/A' },
    {
      id: 'severity', header: 'Severity', accessorFn: (r) => INCIDENT_SEVERITIES.indexOf(r.severity), size: 110,
      cell: ({ row: { original: r } }) => <span className={`badge text-[11px] px-2 py-0.5 rounded ${SEVERITY_CLS[r.severity] || SEVERITY_CLS.medium}`}>{r._severityLabel}</span>,
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => INCIDENT_STATUSES.indexOf(r.status), size: 130,
      cell: ({ row: { original: r } }) => <span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_CLS[r.status] || STATUS_CLS.open}`}>{r._statusLabel}</span>,
    },
    { id: 'age', header: 'Age', accessorFn: (r) => r._age ?? undefined, sortUndefined: 'last', size: 80, meta: { align: 'right' }, cell: ({ row: { original: r } }) => (r._age == null ? 'N/A' : `${r._age}d`) },
    { id: 'reporter', header: 'Reported by', accessorFn: (r) => r.reported_by || undefined, sortingFn: sortBy, sortUndefined: 'last', size: 140, cell: ({ getValue }) => getValue() || 'N/A' },
    {
      id: 'actions', header: '', enableSorting: false, size: 104, meta: { export: false },
      cell: ({ row: { original: r } }) => (
        <div className="flex items-center gap-1 justify-end">
          <button type="button" onClick={() => openEdit(r)} className="inline-flex items-center justify-center w-11 h-11 rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label={`Edit incident ${r.incident_no || r.asset_no || ''}`.trim()}><Pencil size={15} aria-hidden="true" /></button>
          <button type="button" onClick={() => setConfirmDelete(r)} className="inline-flex items-center justify-center w-11 h-11 rounded-lg hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label={`Delete incident ${r.incident_no || r.asset_no || ''}`.trim()}><Trash2 size={15} aria-hidden="true" /></button>
        </div>
      ),
    },
  ]
  const siteColumns = [
    { id: 'site', header: 'Site', accessorFn: (r) => r.site, sortingFn: sortBy, size: 200 },
    { id: 'total', header: 'Incidents', accessorFn: (r) => r.total, size: 100, meta: { align: 'right' } },
    { id: 'open', header: 'Open', accessorFn: (r) => r.open, size: 90, meta: { align: 'right' } },
    { id: 'hc', header: 'High / critical', accessorFn: (r) => r.highCritical, size: 130, meta: { align: 'right' } },
  ]

  const unavailable = 'Unavailable: the incident log could not be read.'
  const chartState = (hasData, node) => (
    rows === null ? <div className="h-full rounded bg-[var(--input-bg)] animate-pulse" />
      : !known ? <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">{unavailable}</div>
      : hasData ? node
      : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">{hasFilters ? 'No incidents match these filters.' : 'No incidents logged yet.'}</div>
  )

  const field = (id, label, input) => (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      {input}
    </div>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Incident Reports"
        subtitle="Operational incident log (near-miss, damage, breakdown, safety, theft), tracked from report to resolution."
        icon={AlertOctagon}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => runExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!known || !filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => runExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!known || !filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={missing}>
              <Plus size={15} aria-hidden="true" /> Report incident
            </button>
          </div>
        }
      />

      {missing && (
        <div role="status" className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Incident reports are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V138_INCIDENT_REPORTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && !missing && (
        <div role="alert" className="card border border-red-800/50 flex flex-wrap items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0"><p className="text-red-300 font-medium">Could not load incident reports.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}
      {actionError && <p role="alert" className="card text-sm text-red-300">{actionError}</p>}

      {/* KPI strip (follows the filters) */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} aria-hidden="true" />
              </div>
              <p className={`text-2xl font-bold mt-1 tabular-nums ${k.tone}`}>{known ? k.value : 'N/A'}</p>
              {k.sub && known ? <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{k.sub}</p> : null}
            </div>
          )
        })}
      </div>

      {/* Lifecycle status tiles (click to filter) */}
      <div className="card">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Lifecycle status</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {INCIDENT_STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={statusFilter === s}
              onClick={() => setStatusFilter(statusFilter === s ? 'all' : s)}
              className={`rounded-lg border border-[var(--input-border)] p-4 text-center min-h-[44px] transition-colors hover:bg-[var(--input-bg)] focus-visible:ring-2 focus-visible:ring-[var(--brand-bright)] ${statusFilter === s ? 'ring-2 ring-[var(--brand-bright)]' : ''}`}
            >
              <span className={`block text-2xl font-bold tabular-nums ${STATUS_TONE[s]}`}>{known ? kpi.byStatus[s] : 'N/A'}</span>
              <span className="block text-xs text-[var(--text-muted)] mt-1">{INCIDENT_STATUS_LABEL[s]}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-[var(--text-muted)] mt-4 flex items-center gap-1.5">
          <ShieldAlert size={12} aria-hidden="true" /> {known ? `${kpi.open} incident${kpi.open === 1 ? '' : 's'} still require attention.` : 'Open workload unavailable.'}
          {known && kpi.openUndated > 0 ? ` ${kpi.openUndated} open incident${kpi.openUndated === 1 ? ' has' : 's have'} no date, so no age.` : ''}
        </p>
      </div>

      {/* Trend + type */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <div className="flex items-center gap-2 mb-3"><BarChart3 size={15} className="text-[var(--text-muted)]" aria-hidden="true" /><h2 className="text-sm font-semibold text-[var(--text-primary)]">Incidents per month (last 12 months)</h2></div>
          <div className="h-64" role="img" aria-label={known ? `Incidents per month: ${trend.labels.map((l, i) => `${l} ${trend.counts[i]}`).join(', ')}` : 'Monthly trend unavailable'}>
            {chartState(trend.counts.some((c) => c > 0), <Bar data={trendData} options={BAR_OPTS} />)}
          </div>
          {known && trend.undated > 0 && <p className="text-[11px] text-[var(--text-muted)] mt-2">{trend.undated} incident{trend.undated === 1 ? '' : 's'} without a date are not plotted.</p>}
        </div>
        <div className="card">
          <div className="flex items-center gap-2 mb-3"><Filter size={15} className="text-[var(--text-muted)]" aria-hidden="true" /><h2 className="text-sm font-semibold text-[var(--text-primary)]">By type</h2></div>
          <div className="h-64" role="img" aria-label={known ? `Incidents by type: ${byType.map((t) => `${t.label} ${t.count}`).join(', ')}` : 'Type breakdown unavailable'}>
            {chartState(byType.some((t) => t.count > 0), <Bar data={typeData} options={HBAR_OPTS} />)}
          </div>
        </div>
      </div>

      {/* By site */}
      {known && bySite.length > 0 && (
        <div className="card !p-0 overflow-hidden">
          <div className="flex items-center gap-2 px-4 pt-4 pb-2"><Building2 size={15} className="text-[var(--text-muted)]" aria-hidden="true" /><h2 className="text-sm font-semibold text-[var(--text-primary)]">Incidents by site</h2></div>
          <EnterpriseTable columns={siteColumns} data={bySite} getRowId={(r) => r.site} enableGlobalFilter={false} enableColumnFilters={false} enableExport={false} initialPageSize={25} emptyMessage="No sites in this view." />
        </div>
      )}

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <label htmlFor="inc-search" className="sr-only">Search incidents</label>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input id="inc-search" type="search" className="input pl-9 w-full min-h-[44px]" placeholder="Search incident #, asset, site, reporter, description" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {INCIDENT_STATUSES.map((s) => <option key={s} value={s}>{INCIDENT_STATUS_LABEL[s]}</option>)}
          </select>
          <select className="input min-h-[44px]" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value)} aria-label="Severity">
            <option value="all">All severities</option>
            {INCIDENT_SEVERITIES.map((s) => <option key={s} value={s}>{INCIDENT_SEVERITY_LABEL[s]}</option>)}
          </select>
          <select className="input min-h-[44px]" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Type">
            <option value="all">All types</option>
            {INCIDENT_TYPES.map((t) => <option key={t} value={t}>{incidentTypeLabel(t)}</option>)}
          </select>
          <select className="input min-h-[44px]" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="">All sites</option>
            {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="text-xs text-[var(--text-muted)] flex flex-col gap-1">From
            <input type="date" className="input min-h-[44px]" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label className="text-xs text-[var(--text-muted)] flex flex-col gap-1">To
            <input type="date" className="input min-h-[44px]" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{known ? `${filtered.length} of ${rows.length}` : 'N/A'}</span>
        </div>
      </div>

      {/* Register */}
      <div className="card overflow-hidden !p-0">
        {known && filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-[var(--text-muted)]">
            {rows.length === 0 && !missing ? (
              <span className="inline-flex flex-col items-center gap-2">
                <AlertOctagon size={26} className="opacity-60" aria-hidden="true" />
                No incidents logged yet.
                <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 mt-1 min-h-[44px]"><Plus size={13} aria-hidden="true" /> Report the first incident</button>
              </span>
            ) : missing ? (
              <span>Incident reports are not provisioned on this database.</span>
            ) : (
              <span className="inline-flex flex-col items-center gap-2">
                <Filter size={22} className="opacity-60" aria-hidden="true" />
                No incidents match these filters.
                <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear filters</button>
              </span>
            )}
          </div>
        ) : (
          <EnterpriseTable
            columns={columns}
            data={tableRows}
            getRowId={(r) => String(r.id)}
            loading={rows === null}
            error={error || null}
            onRetry={load}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            initialPageSize={25}
            emptyMessage="No incidents to show."
          />
        )}
      </div>

      {/* Create / edit modal */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? 'Edit incident' : 'Report incident'}
        size="lg"
        footer={(
          <>
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" form="incident-form" className="btn-primary text-sm inline-flex items-center gap-2 min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}
              {saving ? 'Saving' : editing ? 'Update incident' : 'Save incident'}
            </button>
          </>
        )}
      >
        <form id="incident-form" onSubmit={save} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('inc-no', 'Incident #', <input id="inc-no" className="input w-full" placeholder="Optional reference" value={form.incident_no} maxLength={60} onChange={(e) => set('incident_no', e.target.value)} />)}
            {field('inc-type', 'Type', (
              <select id="inc-type" className="input w-full" value={form.incident_type} onChange={(e) => set('incident_type', e.target.value)}>
                {INCIDENT_TYPES.map((t) => <option key={t} value={t}>{incidentTypeLabel(t)}</option>)}
              </select>
            ))}
            {field('inc-asset', 'Asset #', <input id="inc-asset" className="input w-full" placeholder="e.g. TRK-104" value={form.asset_no} maxLength={60} onChange={(e) => set('asset_no', e.target.value)} />)}
            {field('inc-site', 'Site', <input id="inc-site" className="input w-full" placeholder="Depot / location" value={form.site} maxLength={120} onChange={(e) => set('site', e.target.value)} list="inc-site-options" />)}
            {field('inc-date', 'Incident date', <input id="inc-date" type="date" className="input w-full" value={form.incident_date || ''} onChange={(e) => set('incident_date', e.target.value)} />)}
            {field('inc-severity', 'Severity', (
              <select id="inc-severity" className="input w-full" value={form.severity} onChange={(e) => set('severity', e.target.value)}>
                {INCIDENT_SEVERITIES.map((s) => <option key={s} value={s}>{INCIDENT_SEVERITY_LABEL[s]}</option>)}
              </select>
            ))}
            {field('inc-reporter', 'Reported by', <input id="inc-reporter" className="input w-full" placeholder="Name" value={form.reported_by} maxLength={120} onChange={(e) => set('reported_by', e.target.value)} />)}
            {field('inc-status', 'Status', (
              <select id="inc-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {INCIDENT_STATUSES.map((s) => <option key={s} value={s}>{INCIDENT_STATUS_LABEL[s]}</option>)}
              </select>
            ))}
          </div>
          <datalist id="inc-site-options">{siteOptions.map((s) => <option key={s} value={s} />)}</datalist>
          {field('inc-desc', 'Description', <textarea id="inc-desc" className="input w-full min-h-[100px] resize-y" placeholder="What happened? Include the sequence of events and any contributing factors." value={form.description} maxLength={8000} onChange={(e) => set('description', e.target.value)} />)}
          {field('inc-action', 'Action taken', <textarea id="inc-action" className="input w-full min-h-[80px] resize-y" placeholder="Immediate action, containment, and any corrective steps." value={form.action_taken} maxLength={8000} onChange={(e) => set('action_taken', e.target.value)} />)}
          {formError && (
            <div role="alert" className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
        </form>
      </Modal>

      {/* Delete confirmation */}
      <Modal
        open={!!confirmDelete}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title="Delete this incident?"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-2 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              {deleting ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />}
              {deleting ? 'Deleting' : 'Delete'}
            </button>
          </>
        )}
      >
        <p className="text-sm text-[var(--text-muted)]">
          {confirmDelete ? incidentTypeLabel(confirmDelete.incident_type) : ''}{confirmDelete?.asset_no ? ` | ${confirmDelete.asset_no}` : ''}{confirmDelete?.incident_no ? ` | ${confirmDelete.incident_no}` : ''}. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
