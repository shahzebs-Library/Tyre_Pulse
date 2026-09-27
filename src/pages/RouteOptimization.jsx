/**
 * RouteOptimization (route /route-optimization) - Route Optimization. Captures
 * planned delivery/collection routes per asset and compares the entered
 * baseline distance against the planned (optimised) distance so dispatchers can
 * see the kilometres a better route would save. Fewer kilometres lower fuel
 * burn, tyre wear and CPK. Every plan is org-isolated and country-scoped.
 *
 * Runs on the `route_plans` table (V165). KPI strip, a monthly baseline vs
 * planned chart, status mix, filters + search + date range, a sortable
 * EnterpriseTable register, create/edit, delete, and Excel/PDF export. Savings
 * are recomputed from the entered distances in the pure
 * `src/lib/routeOptimizationAnalytics.js` (over `src/lib/routePlans.js`).
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend } from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Navigation, Split, Milestone, TrendingDown, Flag, AlertTriangle, Gauge, TrendingUp,
  Search, X, FileSpreadsheet, FileText, Plus, Pencil, Trash2, CalendarRange,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import { useSettings } from '../contexts/SettingsContext'
import {
  listRoutePlans, createRoutePlan, updateRoutePlan, deleteRoutePlan,
} from '../lib/api/routePlans'
import { computeSavings } from '../lib/routePlans'
import {
  ROUTE_STATUSES, EMPTY_ROUTE_FILTERS, enrichPlans, filterPlans, routeKpis, monthlyDistance,
  assetOptions, driverOptions, activeRouteFilterCount, routeExportRows, ROUTE_EXPORT_COLUMNS, statusLabel,
} from '../lib/routeOptimizationAnalytics'
import { colorAt, withAlpha } from '../lib/reportColors'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'
import useLatestRequest from '../lib/useLatestRequest'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const EMPTY_FORM = {
  plan_name: '', asset_no: '', driver_name: '', plan_date: '', stops_count: '',
  total_distance_km: '', optimized_distance_km: '', estimated_duration_min: '',
  status: 'draft', notes: '',
}

// Semantic lifecycle tints; the label always names the status.
const STATUS_STYLES = {
  draft: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--input-border)]',
  optimized: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  dispatched: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  completed: 'bg-green-500/15 text-green-300 border-green-500/40',
}
const ICON_BTN = 'inline-flex items-center justify-center w-11 h-11 rounded-lg text-[var(--text-muted)] hover:bg-[var(--input-bg)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]'

const fmtKm = (v) =>
  v == null || v === '' ? 'N/A' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`
const fmtInt = (v) => (v == null || v === '' ? 'N/A' : Number(v).toLocaleString())
function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
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

export default function RouteOptimization() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const latest = useLatestRequest()

  const [filters, setFilters] = useState(EMPTY_ROUTE_FILTERS)
  const setFilter = (k, v) => setFilters((f) => ({ ...f, [k]: v }))

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    const stale = latest.begin()
    setRows(null); setUpdatedAt(null)
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listRoutePlans({ country: activeCountry })
      if (stale()) return
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (stale()) return
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load route plans.'))
      setRows([])
    } finally {
      if (!stale()) setRefreshing(false)
    }
  }, [activeCountry, latest])

  useEffect(() => { load(); return latest.cancel }, [load, latest])

  const loading = rows === null
  const failed = Boolean(error) || notProvisioned
  const enriched = useMemo(() => enrichPlans(rows || []), [rows])
  const kpi = useMemo(() => routeKpis(enriched), [enriched])
  const assets = useMemo(() => assetOptions(rows || []), [rows])
  const drivers = useMemo(() => driverOptions(rows || []), [rows])
  const filtered = useMemo(() => filterPlans(enriched, filters), [enriched, filters])
  const monthly = useMemo(() => monthlyDistance(filtered), [filtered])
  const filterCount = activeRouteFilterCount(filters)

  const kv = (v) => (failed ? null : v)
  const kpis = [
    { label: 'Route plans', value: kv(kpi.total), icon: Split, tone: 'text-[var(--text-primary)]', sub: failed ? null : `${kpi.byStatus.completed} completed, ${kpi.byStatus.dispatched} dispatched` },
    { label: 'Baseline distance', value: failed || kpi.baselineKm == null ? null : fmtKm(kpi.baselineKm), icon: Milestone, tone: 'text-sky-400' },
    { label: 'Distance saved', value: failed || kpi.savedKm == null ? null : fmtKm(kpi.savedKm), icon: TrendingDown, tone: 'text-green-400', sub: failed ? null : `${kpi.measured} of ${kpi.total} plans measurable` },
    { label: 'Avg saving', value: failed || kpi.avgSavedPct == null ? null : `${kpi.avgSavedPct.toFixed(1)}%`, icon: Flag, tone: 'text-amber-400' },
    { label: 'Km per stop', value: failed || kpi.avgKmPerStop == null ? null : fmtKm(kpi.avgKmPerStop), icon: Gauge, tone: 'text-[var(--brand-bright)]', sub: failed ? null : `${fmtInt(kpi.totalStops)} stops planned` },
    { label: 'Plans longer than baseline', value: kv(kpi.worse), icon: TrendingUp, tone: kpi.worse ? 'text-red-400' : 'text-green-400', sub: 'Planned distance above the baseline' },
  ]

  const doExport = async (kind) => {
    const out = routeExportRows(filtered)
    const keys = ROUTE_EXPORT_COLUMNS.map(([k]) => k)
    const headers = ROUTE_EXPORT_COLUMNS.map(([, h]) => h)
    const name = reportFileName('TyrePulse Route Optimization')
    try {
      if (kind === 'excel') await exportToExcel(out, keys, headers, name)
      else await exportToPdf(out, keys.map((k, i) => ({ key: k, header: headers[i] })), 'Route Optimization', name, 'landscape')
    } catch (e) { setNotice(toUserMessage(e, 'Could not export. Try again.')) }
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      plan_name: r.plan_name || '', asset_no: r.asset_no || '',
      driver_name: r.driver_name || '', plan_date: r.plan_date || '',
      stops_count: r.stops_count ?? '', total_distance_km: r.total_distance_km ?? '',
      optimized_distance_km: r.optimized_distance_km ?? '',
      estimated_duration_min: r.estimated_duration_min ?? '',
      status: r.status || 'draft', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const previewSavings = useMemo(() => computeSavings({
    total_distance_km: form.total_distance_km,
    optimized_distance_km: form.optimized_distance_km,
  }), [form.total_distance_km, form.optimized_distance_km])

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.plan_name.trim()) { setFormError('A plan name is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateRoutePlan(editing.id, payload)
      else await createRoutePlan(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the route plan.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteRoutePlan(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setNotice(toUserMessage(err, 'Could not delete the route plan.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const columns = useMemo(() => [
    {
      id: 'plan', header: 'Plan', accessorFn: (r) => r.plan_name || '', size: 200,
      cell: ({ row }) => (
        <span className="font-medium text-[var(--text-primary)]">
          {row.original.plan_name || 'N/A'}
          {row.original.driver_name && <span className="block text-[11px] text-[var(--text-muted)] font-normal">{row.original.driver_name}</span>}
        </span>
      ),
    },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || '', size: 110, cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'date', header: 'Date', accessorFn: (r) => r._day || '', size: 110, cell: ({ row }) => fmtDate(row.original.plan_date) },
    { id: 'stops', header: 'Stops', accessorFn: (r) => r._stops, size: 80, sortUndefined: 'last', meta: { align: 'right' }, cell: ({ getValue }) => fmtInt(getValue()) },
    { id: 'total', header: 'Total', accessorFn: (r) => r._total, size: 110, sortUndefined: 'last', meta: { align: 'right' }, cell: ({ getValue }) => fmtKm(getValue()) },
    { id: 'optimized', header: 'Optimized', accessorFn: (r) => r._optimized, size: 110, sortUndefined: 'last', meta: { align: 'right' }, cell: ({ getValue }) => fmtKm(getValue()) },
    {
      id: 'saved', header: 'Saved', accessorFn: (r) => r._savedKm, size: 120, sortUndefined: 'last', meta: { align: 'right' },
      cell: ({ row }) => {
        const r = row.original
        if (r._savedKm == null) return <span className="text-[var(--text-muted)]">N/A</span>
        if (r._worse) return <span className="text-red-400">Longer than baseline</span>
        return (
          <span className="font-semibold text-green-400 whitespace-nowrap">
            {fmtKm(r._savedKm)}
            <span className="block text-[11px] text-[var(--text-muted)] font-normal">{r._savedPct.toFixed(1)}%</span>
          </span>
        )
      },
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => r._statusLabel, size: 110,
      cell: ({ row }) => (
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${STATUS_STYLES[row.original.status] || STATUS_STYLES.draft}`}>{row.original._statusLabel}</span>
      ),
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(row.original) }} className={`${ICON_BTN} hover:text-[var(--text-primary)]`} aria-label={`Edit ${row.original.plan_name || 'route plan'}`}><Pencil size={15} /></button>
          <button type="button" onClick={(e) => { e.stopPropagation(); setConfirmDelete(row.original) }} className={`${ICON_BTN} hover:text-red-400`} aria-label={`Delete ${row.original.plan_name || 'route plan'}`}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ], [openEdit])

  const monthChart = {
    labels: monthly.map((m) => m.month),
    datasets: [
      { label: 'Baseline km', data: monthly.map((m) => m.baseline), backgroundColor: withAlpha(colorAt(0), 0.85), borderRadius: 4, maxBarThickness: 28 },
      { label: 'Planned km', data: monthly.map((m) => m.planned), backgroundColor: withAlpha(colorAt(1), 0.85), borderRadius: 4, maxBarThickness: 28 },
    ],
  }
  const monthOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: 'var(--text-secondary)', boxWidth: 12 } } },
    scales: {
      x: { ticks: { color: 'var(--text-muted)' }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { color: 'var(--text-muted)' }, grid: { color: 'var(--panel-2)' }, title: { display: true, text: 'km', color: 'var(--text-muted)' } },
    },
  }
  const statusCounts = ROUTE_STATUSES.map((s) => filtered.filter((r) => (r.status || 'draft') === s).length)
  const statusChart = {
    labels: ROUTE_STATUSES.map(statusLabel),
    datasets: [{ data: statusCounts, backgroundColor: ROUTE_STATUSES.map((_, i) => colorAt(i)), borderWidth: 0 }],
  }
  const statusOpts = { responsive: true, maintainAspectRatio: false, cutout: '58%', plugins: { legend: { position: 'right', labels: { color: 'var(--text-secondary)', boxWidth: 12 } } } }

  const unavailable = <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">Unavailable: route plans could not be loaded.</div>

  return (
    <div className="space-y-6">
      <PageHeader
        title="Route Optimization"
        subtitle="Record route plans and compare entered baseline and planned distances. Savings are estimates, not verified journey results."
        icon={Navigation}
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
              <Plus size={14} aria-hidden="true" /> New plan
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-500/40 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Route optimization is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">Ask your administrator to enable route planning, then refresh.</p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-500/40 flex flex-wrap items-start justify-between gap-3" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="text-red-300 font-medium">Could not load route plans.</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">{error} The figures below are unavailable until the register loads.</p>
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

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => <Kpi key={k.label} {...k} loading={loading} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-1.5"><CalendarRange size={15} aria-hidden="true" /> Baseline vs planned distance by month</h2>
          <p className="text-xs text-[var(--text-muted)] mb-3">Only dated plans with both distances entered.</p>
          <div className="h-64">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : failed ? unavailable
                : monthly.length ? (
                  <div className="h-full" role="img" aria-label={monthly.map((m) => `${m.month}: baseline ${m.baseline} km, planned ${m.planned} km`).join('; ')}>
                    <Bar data={monthChart} options={monthOpts} />
                  </div>
                ) : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)] text-center px-4">No dated plans with both distances in this view.</div>}
          </div>
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5"><Flag size={15} aria-hidden="true" /> Status mix</h2>
          <div className="h-64">
            {loading ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : failed ? unavailable
                : filtered.length ? (
                  <div className="h-full" role="img" aria-label={ROUTE_STATUSES.map((s, i) => `${statusLabel(s)} ${statusCounts[i]}`).join(', ')}>
                    <Doughnut data={statusChart} options={statusOpts} />
                  </div>
                ) : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No plans in this view.</div>}
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(200px,2fr)_1fr_1fr_1fr_1fr_1fr] gap-3 items-end">
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Search</span>
            <div className="relative mt-1">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input className="input pl-9 w-full min-h-[44px]" placeholder="Plan, asset, driver, notes" value={filters.search} onChange={(e) => setFilter('search', e.target.value)} />
            </div>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Status</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.status} onChange={(e) => setFilter('status', e.target.value)}>
              <option value="">All statuses</option>
              {ROUTE_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Asset</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.asset} onChange={(e) => setFilter('asset', e.target.value)}>
              <option value="">All assets</option>
              {assets.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">Driver</span>
            <select className="input w-full mt-1 min-h-[44px]" value={filters.driver} onChange={(e) => setFilter('driver', e.target.value)}>
              <option value="">All drivers</option>
              {drivers.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">From</span>
            <input type="date" className="input w-full mt-1 min-h-[44px]" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs text-[var(--text-secondary)]">To</span>
            <input type="date" className="input w-full mt-1 min-h-[44px]" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
          <span className="text-xs text-[var(--text-muted)]" aria-live="polite">{filtered.length} of {kpi.total} plans</span>
          {filterCount > 0 && (
            <button type="button" onClick={() => setFilters(EMPTY_ROUTE_FILTERS)} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
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
        viewKey="route-plans"
        onRowClick={(r) => openEdit(r)}
        emptyMessage={
          failed ? 'Route plans are unavailable.'
            : kpi.total === 0 ? 'No route plans yet. Create your first plan.'
              : 'No route plans match these filters.'
        }
      />

      <Modal open={showModal} onClose={closeModal} title={editing ? 'Edit route plan' : 'New route plan'} size="md">
        <form onSubmit={submit} className="space-y-4">
          <label className="block"><span className="label">Plan name <span className="text-red-400" aria-hidden="true">*</span></span>
            <input className="input w-full min-h-[44px]" placeholder="e.g. Riyadh morning delivery loop" value={form.plan_name} maxLength={200} required onChange={(e) => set('plan_name', e.target.value)} />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block"><span className="label">Asset number (optional)</span>
              <input className="input w-full min-h-[44px]" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
            </label>
            <label className="block"><span className="label">Driver (optional)</span>
              <input className="input w-full min-h-[44px]" placeholder="e.g. A. Khan" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
            </label>
            <label className="block"><span className="label">Plan date</span>
              <input className="input w-full min-h-[44px]" type="date" value={form.plan_date} onChange={(e) => set('plan_date', e.target.value)} />
              <span className="block text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use today.</span>
            </label>
            <label className="block"><span className="label">Stops (optional)</span>
              <input className="input w-full min-h-[44px]" type="number" step="1" min="0" placeholder="12" value={form.stops_count} onChange={(e) => set('stops_count', e.target.value)} />
            </label>
            <label className="block"><span className="label">Total distance (km)</span>
              <input className="input w-full min-h-[44px]" type="number" step="0.1" min="0" placeholder="320" value={form.total_distance_km} onChange={(e) => set('total_distance_km', e.target.value)} />
            </label>
            <label className="block"><span className="label">Optimized distance (km)</span>
              <input className="input w-full min-h-[44px]" type="number" step="0.1" min="0" placeholder="278" value={form.optimized_distance_km} onChange={(e) => set('optimized_distance_km', e.target.value)} />
            </label>
            <label className="block"><span className="label">Estimated duration (min, optional)</span>
              <input className="input w-full min-h-[44px]" type="number" step="1" min="0" placeholder="240" value={form.estimated_duration_min} onChange={(e) => set('estimated_duration_min', e.target.value)} />
            </label>
            <label className="block"><span className="label">Status</span>
              <select className="input w-full min-h-[44px]" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {ROUTE_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
              </select>
            </label>
          </div>

          {previewSavings.savingsKm > 0 && (
            <div className="flex items-center gap-2 text-sm text-green-300 bg-green-500/10 border border-green-500/40 rounded-lg px-3 py-2" aria-live="polite">
              <TrendingDown size={15} className="shrink-0" aria-hidden="true" />
              Optimising saves {fmtKm(previewSavings.savingsKm)} ({previewSavings.savingsPct.toFixed(1)}%) on this route.
            </div>
          )}

          <label className="block"><span className="label">Notes (optional)</span>
            <textarea className="input w-full min-h-[80px] resize-y" placeholder="e.g. avoid the ring road before 09:00" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
          </label>

          {formError && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-500/10 border border-red-500/40 rounded-lg px-3 py-2" role="alert">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create plan'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title="Delete this route plan?"
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
            {confirmDelete.plan_name || 'Route plan'}{confirmDelete.asset_no ? `, ${confirmDelete.asset_no}` : ''}, {fmtDate(confirmDelete.plan_date)}. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
