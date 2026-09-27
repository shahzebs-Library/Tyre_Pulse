/**
 * ChargingSessions (route /charging-sessions) - EV Charging Sessions. One record
 * per charging session for an electric asset: station, connector, energy
 * delivered (kWh), cost, state-of-charge start/end, duration and outcome.
 * Charging spend and energy history are the EV backbone for cost-per-km and
 * utilisation analytics, so every session is org-isolated and country-scoped.
 *
 * Runs on the `charging_sessions` table (V166). Every figure comes from the
 * pure engine src/lib/chargingSessionsAnalytics.js (itself built on
 * src/lib/chargingSessions.js). Money is only added up inside one currency.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  BatteryCharging, Zap, DollarSign, TrendingUp, Truck, AlertTriangle, Search, X,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, Plug, RefreshCw, BarChart3, Gauge, Loader2,
} from 'lucide-react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardHeader, CardBody } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import {
  listChargingSessions, createChargingSession, updateChargingSession, deleteChargingSession,
} from '../lib/api/chargingSessions'
import { costPerKwh } from '../lib/chargingSessions'
import {
  STATUS_OPTIONS, statusLabel, filterSessions, distinctValues, summarizeSessions,
  sessionsByAsset, monthlyEnergy, sessionExportRows, SESSION_EXPORT_COLUMNS,
} from '../lib/chargingSessionsAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation, probeRelation } from '../lib/api/_client'
import { colorAt, withAlpha } from '../lib/reportColors'
import { compareValues, isBlank } from '../lib/consoleTable'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

// The service reads the newest sessions up to this many; say so when it is hit.
const READ_LIMIT = 500

const EMPTY_FORM = {
  asset_no: '', station_name: '', connector_type: '', started_at: '', ended_at: '',
  energy_kwh: '', cost: '', currency: '', start_soc: '', end_soc: '', duration_min: '',
  status: '', notes: '',
}

const STATUS_TONE = {
  in_progress: 'text-sky-400',
  completed: 'text-green-400',
  interrupted: 'text-amber-400',
  failed: 'text-red-400',
}

const fmtKwh = (v) =>
  v == null || v === '' ? 'N/A' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} kWh`
const fmtMoney = (v, currency) =>
  v == null || v === '' ? 'N/A' : `${currency ? `${currency} ` : ''}${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
const fmtSoc = (v) => (v == null || v === '' ? 'N/A' : `${Number(v)}%`)
function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}

/** Column sorting through the shared console comparator (blanks sort last). */
const sortable = (fn) => ({
  accessorFn: (r) => { const v = fn(r); return isBlank(v) ? undefined : v },
  sortingFn: (a, b, id) => compareValues(a.getValue(id), b.getValue(id)),
  sortUndefined: 'last',
})

const BAR_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { display: false } },
    y: { beginAtZero: true, ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { color: 'var(--panel-2)' } },
  },
}

export default function ChargingSessions() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [now, setNow] = useState(() => Date.now())

  const [assetFilter, setAssetFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [stationFilter, setStationFilter] = useState('')
  const [search, setSearch] = useState('')

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
      const data = await listChargingSessions({ country: activeCountry, limit: READ_LIMIT })
      const list = Array.isArray(data) ? data : []
      setRows(list)
      // The service degrades a missing table to [] instead of throwing, so the
      // catch below can never see it. Probe on an empty list and believe only
      // a DEFINITE answer: an unknown result must not claim "not installed".
      if (list.length === 0) {
        const { exists, checked } = await probeRelation('charging_sessions')
        setNotProvisioned(checked && !exists)
      }
      setNow(Date.now())
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load charging sessions.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loading = rows === null
  const assetOptions = useMemo(() => distinctValues(rows || [], 'asset_no'), [rows])
  const stationOptions = useMemo(() => distinctValues(rows || [], 'station_name'), [rows])

  const filtered = useMemo(
    () => filterSessions(rows || [], { asset: assetFilter, status: statusFilter, station: stationFilter, query: search }),
    [rows, assetFilter, statusFilter, stationFilter, search],
  )
  // The tiles and charts cover the sessions matching the asset, station and
  // search filters. The status filter is held out: the tiles report the
  // completed/failed mix, and narrowing them by status would only restate it.
  const kpiScope = useMemo(
    () => filterSessions(rows || [], { asset: assetFilter, station: stationFilter, query: search }),
    [rows, assetFilter, stationFilter, search],
  )
  const summary = useMemo(() => summarizeSessions(kpiScope), [kpiScope])
  const byAsset = useMemo(() => sessionsByAsset(kpiScope).slice(0, 10), [kpiScope])
  const monthly = useMemo(() => monthlyEnergy(kpiScope, now, 12), [kpiScope, now])
  const currencyLabel = summary.currency || ''
  const truncated = (rows || []).length >= READ_LIMIT

  const kpis = [
    { label: 'Sessions logged', value: summary.totalSessions, icon: BatteryCharging, tone: 'text-[var(--text-primary)]',
      sub: `${summary.distinctAssets} asset${summary.distinctAssets === 1 ? '' : 's'}` },
    { label: 'Total energy', value: `${Math.round(summary.totalKwh).toLocaleString()} kWh`, icon: Zap, tone: 'text-sky-400',
      sub: `${summary.measuredSessions} with a meter reading` },
    { label: 'Total cost', value: summary.totalCost == null ? 'N/A' : fmtMoney(summary.totalCost, currencyLabel), icon: DollarSign, tone: 'text-amber-400',
      sub: summary.mixedCurrency ? `Mixed currencies (${summary.currencies.join(', ')})` : `${summary.costedSessions} costed` },
    { label: 'Avg cost / kWh', value: summary.avgCostPerKwh == null ? 'N/A' : fmtMoney(summary.avgCostPerKwh, currencyLabel), icon: TrendingUp, tone: 'text-green-400',
      sub: summary.mixedCurrency ? 'Pick one asset or station' : undefined },
    { label: 'Avg SoC gain', value: summary.avgSocGainPct == null ? 'N/A' : `${Math.round(summary.avgSocGainPct)}%`, icon: Gauge, tone: 'text-violet-400' },
    { label: 'Failed or interrupted', value: summary.issueRatePct == null ? 'N/A' : `${Math.round(summary.issueRatePct)}%`, icon: AlertTriangle,
      tone: summary.issueRatePct > 0 ? 'text-red-400' : 'text-[var(--text-primary)]',
      sub: `${summary.statusCounts.failed + summary.statusCounts.interrupted} of ${summary.totalSessions}` },
  ]

  const energyChart = useMemo(() => ({
    labels: monthly.buckets.map((b) => b.label),
    datasets: [{ label: 'Energy (kWh)', data: monthly.buckets.map((b) => Math.round(b.kwh)), backgroundColor: withAlpha(colorAt(0), 0.8), borderRadius: 4 }],
  }), [monthly])
  const assetChart = useMemo(() => ({
    labels: byAsset.map((a) => a.asset),
    datasets: [{ label: 'Energy (kWh)', data: byAsset.map((a) => Math.round(a.kwh)), backgroundColor: byAsset.map((_, i) => withAlpha(colorAt(i), 0.8)), borderRadius: 4 }],
  }), [byAsset])

  // ── Export ───────────────────────────────────────────────────────────────
  const exportRows = useMemo(() => sessionExportRows(filtered), [filtered])
  const exportName = reportFileName('EV charging sessions', new Date().toISOString().slice(0, 10))
  const doExport = async (kind) => {
    try {
      if (kind === 'excel') await exportToExcel(exportRows, SESSION_EXPORT_COLUMNS.map((c) => c.key), SESSION_EXPORT_COLUMNS.map((c) => c.header), exportName)
      else await exportToPdf(exportRows, SESSION_EXPORT_COLUMNS, 'EV Charging Sessions', exportName, 'landscape')
    } catch (e) {
      setError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', station_name: r.station_name || '',
      connector_type: r.connector_type || '',
      started_at: toLocalInput(r.started_at), ended_at: toLocalInput(r.ended_at),
      energy_kwh: r.energy_kwh ?? '', cost: r.cost ?? '', currency: r.currency || '',
      start_soc: r.start_soc ?? '', end_soc: r.end_soc ?? '',
      duration_min: r.duration_min ?? '', status: r.status || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        status: form.status || null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateChargingSession(editing.id, payload)
      else await createChargingSession(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the session.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteChargingSession(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the session.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setAssetFilter(''); setStatusFilter(''); setStationFilter(''); setSearch('') }
  const hasFilters = assetFilter || statusFilter || stationFilter || search

  const columns = useMemo(() => [
    { id: 'asset', header: 'Asset', ...sortable((r) => r.asset_no), size: 120,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no || 'N/A'}</span> },
    { id: 'station', header: 'Station', ...sortable((r) => r.station_name), size: 180,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
          {row.original.connector_type ? <Plug size={13} className="text-[var(--text-muted)]" aria-hidden="true" /> : null}
          {row.original.station_name || 'N/A'}
          {row.original.connector_type && <span className="text-xs text-[var(--text-muted)]">({row.original.connector_type})</span>}
        </span>
      ) },
    { id: 'started', header: 'Started', ...sortable((r) => r.started_at), size: 170,
      cell: ({ row }) => <span className="text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(row.original.started_at)}</span> },
    { id: 'energy', header: 'Energy', ...sortable((r) => (r.energy_kwh == null || r.energy_kwh === '' ? null : Number(r.energy_kwh))), size: 110, meta: { align: 'right' },
      cell: ({ row }) => <span className="font-semibold tabular-nums text-[var(--text-primary)]">{fmtKwh(row.original.energy_kwh)}</span> },
    { id: 'cost', header: 'Cost', ...sortable((r) => (r.cost == null || r.cost === '' ? null : Number(r.cost))), size: 120, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums text-[var(--text-secondary)] whitespace-nowrap">{fmtMoney(row.original.cost, row.original.currency)}</span> },
    { id: 'cpk', header: 'Cost/kWh', ...sortable((r) => costPerKwh(r)), size: 110, meta: { align: 'right' },
      cell: ({ row }) => {
        const cpk = costPerKwh(row.original)
        return <span className="tabular-nums text-[var(--text-secondary)] whitespace-nowrap">{cpk == null ? 'N/A' : fmtMoney(cpk, row.original.currency)}</span>
      } },
    { id: 'soc', header: 'SoC', accessorFn: (r) => r.end_soc, enableSorting: false, size: 120,
      cell: ({ row }) => <span className="text-[var(--text-secondary)] whitespace-nowrap">{fmtSoc(row.original.start_soc)} to {fmtSoc(row.original.end_soc)}</span> },
    { id: 'status', header: 'Status', ...sortable((r) => statusLabel(r.status)), size: 120,
      cell: ({ row }) => <span className={`text-xs font-medium ${STATUS_TONE[row.original.status] || 'text-[var(--text-muted)]'}`}>{statusLabel(row.original.status)}</span> },
    { id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false },
      cell: ({ row }) => {
        const r = row.original
        const who = `session for ${r.asset_no || 'this asset'}`
        return (
          <div className="flex items-center justify-end gap-1">
            <button type="button" onClick={() => openEdit(r)} className="w-11 h-11 inline-flex items-center justify-center rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-blue-500" aria-label={`Edit ${who}`}><Pencil size={15} /></button>
            <button type="button" onClick={() => setConfirmDelete(r)} className="w-11 h-11 inline-flex items-center justify-center rounded-lg hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400 focus-visible:ring-2 focus-visible:ring-red-500" aria-label={`Delete ${who}`}><Trash2 size={15} /></button>
          </div>
        )
      } },
  ], [openEdit])

  return (
    <div className="space-y-6">
      <PageHeader
        title="EV Charging Sessions"
        subtitle="Log and track EV charging sessions: energy (kWh), cost, state-of-charge and duration per asset. The energy-cost basis for EV cost-per-km and utilisation analytics."
        icon={BatteryCharging}
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
              <Plus size={14} aria-hidden="true" /> Log session
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <Card tone="warn" className="items-start gap-3" style={{ flexDirection: 'row' }}>
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-[var(--text-primary)] font-medium">EV charging sessions are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V166_CHARGING_SESSIONS.sql</span>, then reload.
            </p>
          </div>
        </Card>
      )}

      {error && (
        <Card tone="crit" className="items-start gap-3" style={{ flexDirection: 'row' }} role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-[var(--text-primary)] font-medium">Something went wrong with charging sessions.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </Card>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <Card key={k.label}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} aria-hidden="true" />
              </div>
              {loading
                ? <div className="h-7 w-16 mt-2 rounded bg-[var(--input-bg)] animate-pulse" />
                : <p className={`text-2xl font-bold mt-1 tabular-nums ${k.tone}`}>{k.value}</p>}
              {k.sub && !loading && <p className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate" title={k.sub}>{k.sub}</p>}
            </Card>
          )
        })}
      </div>
      {!loading && (kpiScope.length !== (rows || []).length || truncated) && (
        <p className="text-xs text-[var(--text-muted)] -mt-3">
          {kpiScope.length !== (rows || []).length && (
            <>These figures cover the {kpiScope.length} session{kpiScope.length === 1 ? '' : 's'} matching your asset, station and search filters, of {(rows || []).length}. The status filter is not applied here. </>
          )}
          {truncated && <>Only the newest {READ_LIMIT} sessions are loaded; older sessions are not in these figures.</>}
        </p>
      )}

      {/* Charts */}
      {!loading && !notProvisioned && (rows || []).length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader title="Energy delivered by month (12 months)" icon={BarChart3} />
            <CardBody style={{ height: '15rem' }}>
              {monthly.buckets.some((b) => b.kwh > 0)
                ? <Bar data={energyChart} options={BAR_OPTS} role="img" aria-label="Energy delivered by month" />
                : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No metered energy in the last 12 months.</div>}
            </CardBody>
            {monthly.undated > 0 && <p className="text-[11px] text-[var(--text-muted)] px-4 pb-3">{monthly.undated} session{monthly.undated === 1 ? '' : 's'} with no start time are not charted.</p>}
          </Card>
          <Card>
            <CardHeader title="Top assets by energy" icon={Truck} />
            <CardBody style={{ height: '15rem' }}>
              {byAsset.some((a) => a.kwh > 0)
                ? <Bar data={assetChart} options={{ ...BAR_OPTS, indexAxis: 'y' }} role="img" aria-label="Top assets by energy delivered" />
                : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No metered energy recorded yet.</div>}
            </CardBody>
          </Card>
        </div>
      )}

      {/* Filters */}
      <Card className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input className="input pl-9 w-full" placeholder="Search asset, station, connector, notes" aria-label="Search charging sessions" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="input" value={stationFilter} onChange={(e) => setStationFilter(e.target.value)} aria-label="Station" disabled={!stationOptions.length}>
            <option value="">All stations</option>
            {stationOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <X size={14} aria-hidden="true" /> Clear
            </button>
          )}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{filtered.length} of {(rows || []).length}</span>
        </div>
      </Card>

      {/* Register */}
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
          emptyMessage={(rows || []).length === 0
            ? (notProvisioned ? 'Charging sessions are not enabled yet.' : 'No charging sessions logged yet. Use "Log session" to record the first one.')
            : 'No sessions match these filters.'}
        />
      </Card>

      {/* Create / edit. Every close path runs through ONE guarded onClose. */}
      <Modal open={showModal} onClose={closeModal} title={editing ? 'Edit charging session' : 'Log charging session'} size="lg">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label" htmlFor="cs-asset">Asset number <span className="text-red-400">*</span></label>
              <input id="cs-asset" className="input w-full" placeholder="e.g. EV-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="cs-status">Status</label>
              <select id="cs-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                <option value="">Not set</option>
                {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="cs-station">Station (optional)</label>
              <input id="cs-station" className="input w-full" placeholder="e.g. Riyadh depot fast charger" value={form.station_name} maxLength={200} onChange={(e) => set('station_name', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="cs-connector">Connector (optional)</label>
              <input id="cs-connector" className="input w-full" placeholder="CCS2 / CHAdeMO / Type 2" value={form.connector_type} maxLength={60} onChange={(e) => set('connector_type', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="cs-start">Started at</label>
              <input id="cs-start" className="input w-full" type="datetime-local" value={form.started_at} onChange={(e) => set('started_at', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="cs-end">Ended at</label>
              <input id="cs-end" className="input w-full" type="datetime-local" value={form.ended_at} onChange={(e) => set('ended_at', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="label" htmlFor="cs-kwh">Energy (kWh)</label>
              <input id="cs-kwh" className="input w-full" type="number" inputMode="decimal" step="0.01" min="0" placeholder="42.5" value={form.energy_kwh} onChange={(e) => set('energy_kwh', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="cs-cost">Cost</label>
              <input id="cs-cost" className="input w-full" type="number" inputMode="decimal" step="0.01" min="0" placeholder="63.75" value={form.cost} onChange={(e) => set('cost', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="cs-currency">Currency</label>
              <input id="cs-currency" className="input w-full" placeholder="SAR" value={form.currency} maxLength={8} onChange={(e) => set('currency', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="cs-ssoc">Start SoC (%)</label>
              <input id="cs-ssoc" className="input w-full" type="number" inputMode="numeric" step="1" min="0" max="100" placeholder="20" value={form.start_soc} onChange={(e) => set('start_soc', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="cs-esoc">End SoC (%)</label>
              <input id="cs-esoc" className="input w-full" type="number" inputMode="numeric" step="1" min="0" max="100" placeholder="90" value={form.end_soc} onChange={(e) => set('end_soc', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="cs-dur">Duration (min)</label>
              <input id="cs-dur" className="input w-full" type="number" inputMode="numeric" step="1" min="0" placeholder="45" value={form.duration_min} onChange={(e) => set('duration_min', e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="cs-notes">Notes (optional)</label>
            <textarea id="cs-notes" className="input w-full min-h-[80px] resize-y" placeholder="e.g. overnight depot charge" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
          </div>

          {formError && (
            <div role="alert" className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {saving ? 'Saving' : editing ? 'Save changes' : 'Log session'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title="Delete this session?"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting' : 'Delete'}
            </button>
          </>
        )}
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-muted)]">
            {confirmDelete.asset_no || 'Session'}, {fmtKwh(confirmDelete.energy_kwh)}, {fmtDateTime(confirmDelete.started_at)}. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}

/** Convert an ISO timestamp to the value a <input type="datetime-local"> expects. */
function toLocalInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
