/**
 * Trips (route /trips) - Trip History. Completed and in-flight journeys per
 * asset, entered manually, imported from an ERP or read off a telematics feed.
 * Trip history feeds utilisation, driver-behaviour, CPK and tyre-life
 * analytics, so every trip is org-isolated and country-scoped.
 *
 * Runs on the `trips` table (V164). All analytics live in the pure
 * `src/lib/tripsAnalytics.js` engine, which reuses the fleet roll-ups in
 * `src/lib/trips.js`. Distance or time that was never recorded reads N/A.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Navigation, Clock, TrendingUp, Play, Users, Gauge, Timer, AlertTriangle, Search, X,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, RotateCcw, Truck, ArrowRight,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import StatTile from '../components/ui/StatTile'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import { listTrips, createTrip, updateTrip, deleteTrip } from '../lib/api/trips'
import {
  filterTrips, tripKpis, monthlyDistance, statusMix, driverTotals, perAssetTotals,
  tripExportRows, statusLabel, TRIP_STATUSES, SPEED_REVIEW_KMH, EXPORT_COLS, EXPORT_HEADERS,
} from '../lib/tripsAnalytics'
import { colorAt, categorical, withAlpha } from '../lib/reportColors'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const loadExportUtils = () => import('../lib/exportUtils')
const READ_LIMIT = 500
const FIELD = 'input w-full min-h-[44px]'

const EMPTY_FORM = {
  asset_no: '', driver_name: '', origin: '', destination: '',
  started_at: '', ended_at: '', distance_km: '', duration_min: '',
  max_speed_kmh: '', avg_speed_kmh: '', idle_min: '', status: '', notes: '',
}

const STATUS_STYLES = {
  planned: 'bg-slate-500/15 text-[var(--text-secondary)] border-slate-500/30',
  in_progress: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  completed: 'bg-green-500/15 text-green-400 border-green-500/30',
  cancelled: 'bg-red-500/15 text-red-400 border-red-500/30',
}

const fmtKm = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? 'N/A' : `${Math.round(Number(v)).toLocaleString()} km`)
const fmtMin = (v) => {
  if (v == null || v === '') return 'N/A'
  const n = Number(v)
  if (!Number.isFinite(n)) return 'N/A'
  if (n < 60) return `${Math.round(n)} min`
  const h = Math.floor(n / 60)
  const m = Math.round(n % 60)
  return m ? `${h}h ${m}m` : `${h}h`
}
const fmtSpeed = (v) => (v == null || v === '' ? 'N/A' : `${Number(v).toLocaleString()} km/h`)
const fmtNum = (v) => (v == null ? 'N/A' : Number(v).toLocaleString())
const fmtPct = (v) => (v == null ? 'N/A' : `${v}%`)
const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}
function toLocalInput(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}

const BAR_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { display: false } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { color: 'var(--panel-2)' }, beginAtZero: true },
  },
}
const DONUT_OPTS = {
  responsive: true, maintainAspectRatio: false, cutout: '60%',
  plugins: { legend: { position: 'right', labels: { color: 'var(--text-secondary)', boxWidth: 12, font: { size: 11 } } } },
}

export default function Trips() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [assetFilter, setAssetFilter] = useState('')
  const [driverFilter, setDriverFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [search, setSearch] = useState('')
  const [rollupView, setRollupView] = useState('asset') // asset | driver

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
      const data = await listTrips({ country: activeCountry, limit: READ_LIMIT })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load trips.')); setRows(null) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loaded = Array.isArray(rows)
  const all = useMemo(() => rows || [], [rows])
  const filtered = useMemo(() => filterTrips(all, {
    search, asset: assetFilter, driver: driverFilter, status: statusFilter, from: fromDate, to: toDate,
  }), [all, search, assetFilter, driverFilter, statusFilter, fromDate, toDate])

  const k = useMemo(() => tripKpis(filtered, { now: Date.now() }), [filtered])
  const trend = useMemo(() => monthlyDistance(filtered, { now: Date.now() }), [filtered])
  const statuses = useMemo(() => statusMix(filtered), [filtered])
  const byAsset = useMemo(() => perAssetTotals(filtered), [filtered])
  const byDriver = useMemo(() => driverTotals(filtered), [filtered])

  const assetOptions = useMemo(() => [...new Set(all.map((r) => r.asset_no).filter(Boolean))].sort(), [all])
  const driverOptions = useMemo(() => [...new Set(all.map((r) => (r.driver_name || '').trim()).filter(Boolean))].sort(), [all])
  const truncated = loaded && all.length >= READ_LIMIT

  // ── Exports: whole filtered set ──────────────────────────────────────────
  const exportRows = useMemo(() => tripExportRows(filtered), [filtered])
  const fileBase = async () => {
    const { reportFileName, reportDateLabel } = await loadExportUtils()
    return reportFileName('TyrePulse Trip History', activeCountry !== 'All' ? activeCountry : null, reportDateLabel())
  }
  const doExcel = async () => {
    try {
      const { exportToExcel } = await loadExportUtils()
      await exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, await fileBase())
    } catch (e) { setActionError(toUserMessage(e, 'Export failed. Please try again.')) }
  }
  const doPdf = async () => {
    try {
      const { exportToPdf } = await loadExportUtils()
      await exportToPdf(exportRows, EXPORT_COLS.map((c, i) => ({ key: c, header: EXPORT_HEADERS[i] })), 'Trip History', await fileBase(), 'landscape')
    } catch (e) { setActionError(toUserMessage(e, 'Export failed. Please try again.')) }
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', driver_name: r.driver_name || '',
      origin: r.origin || '', destination: r.destination || '',
      started_at: toLocalInput(r.started_at), ended_at: toLocalInput(r.ended_at),
      distance_km: r.distance_km ?? '', duration_min: r.duration_min ?? '',
      max_speed_kmh: r.max_speed_kmh ?? '', avg_speed_kmh: r.avg_speed_kmh ?? '',
      idle_min: r.idle_min ?? '', status: r.status || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (key, v) => setForm((f) => ({ ...f, [key]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    if (form.started_at && form.ended_at && new Date(form.ended_at) < new Date(form.started_at)) {
      setFormError('The end time cannot be before the start time.'); return
    }
    setSaving(true)
    try {
      const payload = { ...form, status: form.status || null, country: activeCountry !== 'All' ? activeCountry : null }
      if (editing) await updateTrip(editing.id, payload)
      else await createTrip(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the trip.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true); setActionError('')
    try {
      await deleteTrip(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the trip.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => {
    setAssetFilter(''); setDriverFilter(''); setStatusFilter(''); setFromDate(''); setToDate(''); setSearch('')
  }
  const hasFilters = !!(assetFilter || driverFilter || statusFilter || fromDate || toDate || search)

  // ── Tables ───────────────────────────────────────────────────────────────
  const columns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || 'N/A', size: 110,
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no || 'N/A'}</span> },
    { id: 'driver', header: 'Driver', accessorFn: (r) => r.driver_name || 'N/A', size: 140 },
    { id: 'route', header: 'Route', accessorFn: (r) => `${r.origin || 'N/A'} to ${r.destination || 'N/A'}`, size: 220,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5 text-[var(--text-secondary)]">
          {row.original.origin || 'N/A'}<ArrowRight size={12} className="text-[var(--text-muted)] shrink-0" aria-label="to" />{row.original.destination || 'N/A'}
        </span>
      ) },
    { id: 'started', header: 'Started', accessorFn: (r) => r.started_at || '', size: 170,
      cell: ({ row }) => <span className="whitespace-nowrap text-[var(--text-secondary)]">{fmtDateTime(row.original.started_at)}</span> },
    { id: 'distance', header: 'Distance', accessorFn: (r) => numOrNull(r.distance_km), size: 110, meta: { align: 'right' },
      cell: ({ row }) => <span className="font-semibold tabular-nums">{fmtKm(row.original.distance_km)}</span> },
    { id: 'duration', header: 'Duration', accessorFn: (r) => numOrNull(r.duration_min), size: 100, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtMin(row.original.duration_min)}</span> },
    { id: 'avg', header: 'Avg speed', accessorFn: (r) => numOrNull(r.avg_speed_kmh), size: 110, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{fmtSpeed(row.original.avg_speed_kmh)}</span> },
    { id: 'max', header: 'Max speed', accessorFn: (r) => numOrNull(r.max_speed_kmh), size: 120, meta: { align: 'right' },
      cell: ({ row }) => {
        const v = numOrNull(row.original.max_speed_kmh)
        return (
          <span className={`tabular-nums inline-flex items-center gap-1 ${v != null && v > SPEED_REVIEW_KMH ? 'text-red-400 font-semibold' : ''}`}>
            {v != null && v > SPEED_REVIEW_KMH && <AlertTriangle size={12} aria-label="Over speed review threshold" />}
            {fmtSpeed(row.original.max_speed_kmh)}
          </span>
        )
      } },
    { id: 'status', header: 'Status', accessorFn: (r) => statusLabel(r.status), size: 120,
      cell: ({ row }) => (row.original.status ? (
        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[row.original.status] || 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--input-border)]'}`}>
          {statusLabel(row.original.status)}
        </span>
      ) : <span className="text-[var(--text-muted)]">N/A</span>) },
    { id: 'actions', header: '', size: 110, enableSorting: false, meta: { export: false, align: 'right' },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(row.original)} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label={`Edit trip for ${row.original.asset_no || 'asset'}`}><Pencil size={15} /></button>
          <button type="button" onClick={() => setConfirmDelete(row.original)} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label={`Delete trip for ${row.original.asset_no || 'asset'}`}><Trash2 size={15} /></button>
        </div>
      ) },
  ], [openEdit])

  const rollupColumns = useMemo(() => [
    { id: 'key', header: rollupView === 'asset' ? 'Asset' : 'Driver', accessorFn: (r) => r.asset_no || r.driver, size: 160 },
    { id: 'trips', header: 'Trips', accessorFn: (r) => r.trips, size: 80, meta: { align: 'right' } },
    { id: 'km', header: 'Distance', accessorFn: (r) => r.distanceKm, size: 120, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.distanceKm > 0 ? fmtKm(row.original.distanceKm) : 'N/A'}</span> },
    { id: 'time', header: 'Drive time', accessorFn: (r) => r.durationMin, size: 120, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.durationMin > 0 ? fmtMin(row.original.durationMin) : 'N/A'}</span> },
    { id: 'avgKm', header: 'Km per trip', accessorFn: (r) => (r.distanceKm > 0 ? r.distanceKm / r.trips : null), size: 120, meta: { align: 'right' },
      cell: ({ row }) => <span className="tabular-nums">{row.original.distanceKm > 0 ? fmtKm(row.original.distanceKm / row.original.trips) : 'N/A'}</span> },
  ], [rollupView])

  const trendData = {
    labels: trend.map((t) => t.month),
    datasets: [{ label: 'Distance (km)', data: trend.map((t) => Math.round(t.distanceKm)), backgroundColor: withAlpha(colorAt(1), 0.75), borderRadius: 4 }],
  }
  const statusData = {
    labels: statuses.map((s) => s.label),
    datasets: [{ data: statuses.map((s) => s.count), backgroundColor: categorical(statuses.length), borderWidth: 0 }],
  }

  const kpis = [
    { label: 'Trips logged', value: loaded ? fmtNum(k.totalTrips) : 'N/A', icon: Navigation, sub: `${fmtNum(k.last7Count)} in the last 7 days` },
    { label: 'Total distance', value: loaded ? (k.withDistance ? fmtKm(k.totalDistanceKm) : 'N/A') : 'N/A', icon: TrendingUp, tone: 'info', sub: k.missingDistance ? `${k.missingDistance} trips without distance` : 'All trips measured' },
    { label: 'Km per trip', value: loaded ? fmtKm(k.avgTripKm) : 'N/A', icon: Truck, sub: `Across ${fmtNum(k.withDistance)} measured trips` },
    { label: 'Drive time', value: loaded ? (k.totalDurationMin > 0 ? fmtMin(k.totalDurationMin) : 'N/A') : 'N/A', icon: Clock, tone: 'warn', sub: `Avg speed ${fmtSpeed(k.avgSpeedKmh)}` },
    { label: 'Idle share', value: loaded ? fmtPct(k.idleSharePct) : 'N/A', icon: Timer, tone: 'warn', sub: 'Idle minutes over drive time' },
    { label: 'Speed review', value: loaded ? fmtNum(k.speedReviewCount) : 'N/A', icon: Gauge, tone: 'crit', sub: `Peak over ${SPEED_REVIEW_KMH} km/h` },
    { label: 'Active now', value: loaded ? fmtNum(k.activeCount) : 'N/A', icon: Play, tone: 'accent', sub: `Completion ${fmtPct(k.completionPct)}` },
    { label: 'Drivers', value: loaded ? fmtNum(k.distinctDrivers) : 'N/A', icon: Users, sub: `${fmtNum(k.distinctAssets)} assets` },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trip History"
        subtitle="Journeys per asset: origin, destination, distance, timing and speed. The basis for utilisation, driver-behaviour and CPK analytics."
        icon={Navigation}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={doExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}><FileSpreadsheet size={14} /> Excel</button>
            <button type="button" onClick={doPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}><FileText size={14} /> PDF</button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned || !loaded}><Plus size={14} /> Log trip</button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Trip history is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V164_TRIPS.sql</span>, then reload.</p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex flex-wrap items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0"><p className="text-red-300 font-medium">Could not load trips.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={refreshing}><RotateCcw size={14} /> Retry</button>
        </div>
      )}

      {actionError && (
        <div className="card border border-red-800/50 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="flex-1 text-sm text-red-300">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Dismiss message"><X size={16} /></button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((t, i) => <StatTile key={t.label} index={i} label={t.label} value={t.value} icon={t.icon} tone={t.tone} sub={t.sub} />)}
      </div>
      {loaded && (
        <p className="text-xs text-[var(--text-muted)] -mt-3">
          These figures cover the {fmtNum(filtered.length)} trip{filtered.length === 1 ? '' : 's'} matching the current filters
          {truncated ? `. Only the most recent ${READ_LIMIT} trips are loaded, so older trips are not included.` : '.'}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Monthly distance, last 12 months</h2>
          <div className="h-60" role="img" aria-label="Distance travelled per month for the last 12 months">
            {!loaded ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : trend.some((t) => t.distanceKm > 0) ? <Bar data={trendData} options={BAR_OPTS} />
                : <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No measured distance in the last 12 months.</p>}
          </div>
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Trip status</h2>
          <div className="h-60" role="img" aria-label="Trips by status">
            {!loaded ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : statuses.length ? <Doughnut data={statusData} options={DONUT_OPTS} />
                : <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No trips to break down.</p>}
          </div>
        </div>
      </div>

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            {rollupView === 'asset' ? <Truck size={15} aria-hidden="true" /> : <Users size={15} aria-hidden="true" />}
            Distance by {rollupView}
          </h2>
          <div className="inline-flex rounded-lg border border-[var(--input-border)] overflow-hidden text-sm" role="group" aria-label="Roll up by">
            {['asset', 'driver'].map((v) => (
              <button type="button" key={v} onClick={() => setRollupView(v)} aria-pressed={rollupView === v}
                className={`px-4 min-h-[44px] capitalize ${rollupView === v ? 'bg-[var(--input-bg)] text-[var(--text-primary)] font-semibold' : 'text-[var(--text-muted)]'}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
        <EnterpriseTable
          columns={rollupColumns}
          data={rollupView === 'asset' ? byAsset : byDriver}
          getRowId={(r) => r.asset_no || r.driver}
          loading={!loaded && !error}
          emptyMessage={rollupView === 'asset' ? 'No trips carry an asset number.' : 'No trips carry a driver name.'}
          enableExport={false}
          enableColumnFilters={false}
          enableColumnVisibility={false}
          searchPlaceholder={`Search ${rollupView}s`}
        />
      </div>

      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3 items-end">
          <div className="sm:col-span-2">
            <label htmlFor="trip-search" className="label">Search</label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input id="trip-search" className={`${FIELD} pl-9`} placeholder="Asset, driver, origin, destination, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="trip-asset" className="label">Asset</label>
            <select id="trip-asset" className={FIELD} value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)}>
              <option value="">All assets</option>
              {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="trip-driver" className="label">Driver</label>
            <select id="trip-driver" className={FIELD} value={driverFilter} onChange={(e) => setDriverFilter(e.target.value)}>
              <option value="">All drivers</option>
              {driverOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="trip-status" className="label">Status</label>
            <select id="trip-status" className={FIELD} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {TRIP_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="trip-from" className="label">Started from</label>
            <input id="trip-from" type="date" className={FIELD} value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <label htmlFor="trip-to" className="label">Started to</label>
            <input id="trip-to" type="date" className={FIELD} value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} /> Clear filters</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{fmtNum(filtered.length)} of {fmtNum(all.length)} trips</span>
        </div>
      </div>

      <EnterpriseTable
        columns={columns}
        data={filtered}
        getRowId={(r) => String(r.id)}
        loading={!loaded && !error}
        error={error && !loaded ? error : null}
        onRetry={load}
        emptyMessage={all.length === 0 && !notProvisioned ? 'No trips logged yet. Log your first trip.' : 'No trips match these filters.'}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableExport={false}
        viewKey="trips"
      />

      <Modal
        open={showModal}
        onClose={closeModal}
        title={editing ? 'Edit trip' : 'Log trip'}
        size="lg"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" form="trip-form" className="btn-primary text-sm min-h-[44px] disabled:opacity-60" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save changes' : 'Log trip'}</button>
          </div>
        }
      >
        <form id="trip-form" onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="trf-asset" className="label">Asset number <span className="text-red-400" aria-hidden="true">*</span></label>
              <input id="trf-asset" className={FIELD} placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} required onChange={(e) => set('asset_no', e.target.value)} />
            </div>
            <div>
              <label htmlFor="trf-driver" className="label">Driver (optional)</label>
              <input id="trf-driver" className={FIELD} placeholder="e.g. A. Khan" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
            </div>
            <div>
              <label htmlFor="trf-origin" className="label">Origin (optional)</label>
              <input id="trf-origin" className={FIELD} placeholder="e.g. Riyadh depot" value={form.origin} maxLength={300} onChange={(e) => set('origin', e.target.value)} />
            </div>
            <div>
              <label htmlFor="trf-dest" className="label">Destination (optional)</label>
              <input id="trf-dest" className={FIELD} placeholder="e.g. Dammam yard" value={form.destination} maxLength={300} onChange={(e) => set('destination', e.target.value)} />
            </div>
            <div>
              <label htmlFor="trf-start" className="label">Started (optional)</label>
              <input id="trf-start" className={FIELD} type="datetime-local" value={form.started_at} onChange={(e) => set('started_at', e.target.value)} />
            </div>
            <div>
              <label htmlFor="trf-end" className="label">Ended (optional)</label>
              <input id="trf-end" className={FIELD} type="datetime-local" value={form.ended_at} onChange={(e) => set('ended_at', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            {[
              ['distance_km', 'Distance (km)', '0.1', '320'],
              ['duration_min', 'Duration (min)', '1', '240'],
              ['idle_min', 'Idle (min)', '1', '30'],
              ['max_speed_kmh', 'Max speed (km/h)', '1', '95'],
              ['avg_speed_kmh', 'Avg speed (km/h)', '1', '80'],
            ].map(([key, label, step, ph]) => (
              <div key={key}>
                <label htmlFor={`trf-${key}`} className="label">{label}</label>
                <input id={`trf-${key}`} className={FIELD} type="number" step={step} min="0" inputMode="decimal" placeholder={ph} value={form[key]} onChange={(e) => set(key, e.target.value)} />
              </div>
            ))}
            <div>
              <label htmlFor="trf-status" className="label">Status</label>
              <select id="trf-status" className={FIELD} value={form.status} onChange={(e) => set('status', e.target.value)}>
                <option value="">None</option>
                {TRIP_STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="trf-notes" className="label">Notes (optional)</label>
            <textarea id="trf-notes" className="input w-full min-h-[80px] resize-y" placeholder="e.g. detour via ring road, heavy traffic" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
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
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title="Delete this trip?"
        size="sm"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}><Trash2 size={14} /> {deleting ? 'Deleting...' : 'Delete'}</button>
          </div>
        }
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-secondary)]">
            {confirmDelete.asset_no || 'Trip'} | {confirmDelete.origin || 'N/A'} to {confirmDelete.destination || 'N/A'} | {fmtKm(confirmDelete.distance_km)}. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
