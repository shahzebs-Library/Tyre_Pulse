/**
 * VehicleCheckInOut (route /vehicle-checkinout) - vehicle handovers. A driver
 * checks a vehicle OUT (odometer, fuel level, condition) and later back IN.
 * Full CRUD on the org and country scoped `vehicle_checkinout` table.
 *
 * Handover analytics (pairing each check-out with its return, time out, km
 * driven, overdue returns, daily trend) live in the pure
 * `src/lib/vehicleCheckInOutAnalytics.js` engine, which builds on
 * `summarizeCheckInOut` in `src/lib/vehicleCheckInOut.js`. Degrades gracefully
 * when the table is absent, prompting for MIGRATIONS_V144_VEHICLE_CHECKINOUT.sql.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import {
  ArrowRightLeft, LogIn, LogOut, Search, X, Pencil, Trash2, FileSpreadsheet, FileText,
  AlertTriangle, Loader2, Car, Gauge, CheckCircle2, Clock, Fuel, RotateCcw, Hourglass,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import StatTile from '../components/ui/StatTile'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import { listCheckInOut, createEntry, updateEntry, deleteEntry } from '../lib/api/vehicleCheckInOut'
import { probeRelation } from '../lib/api/_client'
import {
  filterHandovers, handoverKpis, pairHandovers, currentlyOut, dailyTrend, handoverExportRows,
  DIRECTIONS, STATUSES, DIRECTION_LABEL, STATUS_LABEL, OVERDUE_HOURS, EXPORT_COLS, EXPORT_HEADERS,
} from '../lib/vehicleCheckInOutAnalytics'
import { colorAt, withAlpha } from '../lib/reportColors'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const loadExportUtils = () => import('../lib/exportUtils')
const FIELD = 'input w-full min-h-[44px]'
const READ_LIMIT = 500

const DIRECTION_META = {
  out: { icon: LogOut, cls: 'bg-sky-900/30 text-sky-400 border border-sky-700/50' },
  in: { icon: LogIn, cls: 'bg-green-900/30 text-green-400 border border-green-700/50' },
}
const STATUS_CLS = {
  open: 'bg-amber-900/30 text-amber-400 border border-amber-700/50',
  closed: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}
const FUEL_LEVELS = ['Empty', '1/4', '1/2', '3/4', 'Full']
const EMPTY_FORM = {
  asset_no: '', driver_name: '', direction: 'out', odometer_km: '',
  fuel_level: '', condition_notes: '', site: '', status: 'open',
}

const fmtNum = (v) => (v == null ? 'N/A' : Number(v).toLocaleString())
const fmtPct = (v) => (v == null ? 'N/A' : `${v}%`)
const fmtHours = (h) => {
  if (h == null) return 'N/A'
  if (h < 24) return `${h} h`
  const d = Math.floor(h / 24); const r = Math.round(h % 24)
  return r ? `${d}d ${r}h` : `${d}d`
}
function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}
function toLocalInput(v) {
  const d = v ? new Date(v) : new Date()
  if (Number.isNaN(d.getTime())) return ''
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}

const BAR_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { position: 'bottom', labels: { color: 'var(--text-secondary)', boxWidth: 12, font: { size: 11 } } } },
  scales: {
    x: { stacked: false, ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { display: false } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 10 }, precision: 0 }, grid: { color: 'var(--panel-2)' }, beginAtZero: true },
  },
}

function DirectionBadge({ direction }) {
  const meta = DIRECTION_META[direction]
  if (!meta) return <span className="text-[var(--text-muted)]">N/A</span>
  const Icon = meta.icon
  return <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded ${meta.cls}`}><Icon size={11} aria-hidden="true" /> {DIRECTION_LABEL[direction]}</span>
}

export default function VehicleCheckInOut() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [directionFilter, setDirectionFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [assetFilter, setAssetFilter] = useState('')
  const [siteFilter, setSiteFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listCheckInOut({ country: activeCountry, limit: READ_LIMIT })
      const list = Array.isArray(data) ? data : []
      setRows(list)
      // listCheckInOut degrades a missing table to [], so the catch below never
      // sees it. Probe only when empty, and believe only a definite answer.
      if (list.length === 0) {
        const { exists, checked } = await probeRelation('vehicle_checkinout')
        setMissing(checked && !exists)
      }
      setUpdatedAt(new Date())
    } catch (err) {
      setError(toUserMessage(err, 'Could not load check-in and check-out entries.'))
      setRows(null)
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loaded = Array.isArray(rows)
  const all = useMemo(() => rows || [], [rows])
  const filtered = useMemo(() => filterHandovers(all, {
    direction: directionFilter, status: statusFilter, asset: assetFilter, site: siteFilter,
    from: fromDate, to: toDate, search,
  }), [all, directionFilter, statusFilter, assetFilter, siteFilter, fromDate, toDate, search])
  const k = useMemo(() => handoverKpis(filtered, { now: Date.now() }), [filtered])
  const pairs = useMemo(() => pairHandovers(filtered), [filtered])
  const outNow = useMemo(() => currentlyOut(all, { now: Date.now() }), [all])
  const trend = useMemo(() => dailyTrend(filtered, { now: Date.now() }), [filtered])

  const assetOptions = useMemo(() => [...new Set(all.map((r) => r.asset_no).filter(Boolean))].sort(), [all])
  const siteOptions = useMemo(() => [...new Set(all.map((r) => r.site).filter(Boolean))].sort(), [all])
  const truncated = loaded && all.length >= READ_LIMIT

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = (direction = 'out', prefill = {}) => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, direction, ...prefill, checked_at: toLocalInput() })
    setFormError(''); setModalOpen(true)
  }
  const openEdit = useCallback((row) => {
    setEditing(row)
    setForm({
      asset_no: row.asset_no || '', driver_name: row.driver_name || '', direction: row.direction || 'out',
      odometer_km: row.odometer_km ?? '', fuel_level: row.fuel_level || '', condition_notes: row.condition_notes || '',
      site: row.site || '', status: row.status || 'open', checked_at: toLocalInput(row.checked_at),
    })
    setFormError(''); setModalOpen(true)
  }, [])
  const setField = (key, v) => setForm((f) => ({ ...f, [key]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    if (form.odometer_km !== '' && (!Number.isFinite(Number(form.odometer_km)) || Number(form.odometer_km) < 0)) {
      setFormError('Odometer must be zero or more.'); return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        country: activeCountry !== 'All' ? activeCountry : null,
        checked_at: form.checked_at ? new Date(form.checked_at).toISOString() : undefined,
      }
      if (editing) {
        const updated = await updateEntry(editing.id, payload)
        setRows((prev) => (prev || []).map((r) => (r.id === updated.id ? updated : r)))
      } else {
        const created = await createEntry(payload)
        setRows((prev) => [created, ...(prev || [])])
      }
      setModalOpen(false)
      setUpdatedAt(new Date())
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save this entry.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true); setActionError('')
    try {
      await deleteEntry(confirmDelete.id)
      setRows((prev) => (prev || []).filter((r) => r.id !== confirmDelete.id))
      setConfirmDelete(null)
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete this entry.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete])

  // ── Exports ──────────────────────────────────────────────────────────────
  const exportRows = useMemo(() => handoverExportRows(filtered, fmtDateTime), [filtered])
  const runExport = async (format) => {
    try {
      const u = await loadExportUtils()
      const name = u.reportFileName('TyrePulse Vehicle Check In Out', activeCountry !== 'All' ? activeCountry : null, u.reportDateLabel())
      if (format === 'pdf') await u.exportToPdf(exportRows, EXPORT_COLS.map((c, i) => ({ key: c, header: EXPORT_HEADERS[i] })), 'Vehicle Check In/Out', name, 'landscape')
      else await u.exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, name)
    } catch (e) { setActionError(toUserMessage(e, 'Export failed. Please try again.')) }
  }

  const clearFilters = () => {
    setDirectionFilter('all'); setStatusFilter('all'); setAssetFilter(''); setSiteFilter('')
    setFromDate(''); setToDate(''); setSearch('')
  }
  const hasFilters = directionFilter !== 'all' || statusFilter !== 'all' || !!(assetFilter || siteFilter || fromDate || toDate || search)

  // ── Tables ───────────────────────────────────────────────────────────────
  const columns = useMemo(() => [
    { id: 'when', header: 'Date/Time', accessorFn: (r) => r.checked_at || '', size: 170, cell: ({ row }) => <span className="whitespace-nowrap text-[var(--text-secondary)]">{fmtDateTime(row.original.checked_at)}</span> },
    { id: 'direction', header: 'Direction', accessorFn: (r) => DIRECTION_LABEL[r.direction] || 'N/A', size: 130, cell: ({ row }) => <DirectionBadge direction={row.original.direction} /> },
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || 'N/A', size: 110, cell: ({ row }) => <span className="font-mono text-xs text-[var(--text-primary)]">{row.original.asset_no || 'N/A'}</span> },
    { id: 'driver', header: 'Driver', accessorFn: (r) => r.driver_name || 'N/A', size: 140 },
    { id: 'odo', header: 'Odometer', accessorFn: (r) => (r.odometer_km == null || r.odometer_km === '' ? null : Number(r.odometer_km)), size: 120, meta: { align: 'right' },
      cell: ({ row }) => (row.original.odometer_km == null || row.original.odometer_km === '' ? 'N/A' : <span className="inline-flex items-center gap-1 tabular-nums"><Gauge size={12} className="text-[var(--text-muted)]" aria-hidden="true" />{Number(row.original.odometer_km).toLocaleString()} km</span>) },
    { id: 'fuel', header: 'Fuel', accessorFn: (r) => r.fuel_level || 'N/A', size: 80 },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A', size: 120 },
    { id: 'status', header: 'Status', accessorFn: (r) => STATUS_LABEL[r.status] || 'N/A', size: 100,
      cell: ({ row }) => (STATUS_LABEL[row.original.status] ? <span className={`text-[11px] px-2 py-0.5 rounded ${STATUS_CLS[row.original.status]}`}>{STATUS_LABEL[row.original.status]}</span> : <span className="text-[var(--text-muted)]">N/A</span>) },
    { id: 'notes', header: 'Condition notes', accessorFn: (r) => r.condition_notes || '', size: 200, cell: ({ row }) => <span className="text-xs text-[var(--text-secondary)]">{row.original.condition_notes || ''}</span> },
    { id: 'actions', header: '', size: 110, enableSorting: false, meta: { export: false, align: 'right' },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(row.original)} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label={`Edit handover for ${row.original.asset_no || 'asset'}`}><Pencil size={15} /></button>
          <button type="button" onClick={() => setConfirmDelete(row.original)} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label={`Delete handover for ${row.original.asset_no || 'asset'}`}><Trash2 size={15} /></button>
        </div>
      ) },
  ], [openEdit])

  const outColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || 'N/A', size: 110 },
    { id: 'driver', header: 'Driver', accessorFn: (r) => r.driver_name || 'N/A', size: 140 },
    { id: 'since', header: 'Out since', accessorFn: (r) => r.checked_at || '', size: 170, cell: ({ row }) => fmtDateTime(row.original.checked_at) },
    { id: 'hours', header: 'Time out', accessorFn: (r) => r.hoursOut, size: 110, meta: { align: 'right' },
      cell: ({ row }) => (
        <span className={`tabular-nums inline-flex items-center gap-1 ${row.original.overdue ? 'text-red-400 font-semibold' : ''}`}>
          {row.original.overdue && <AlertTriangle size={12} aria-label="Overdue" />}{fmtHours(row.original.hoursOut)}
        </span>
      ) },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || 'N/A', size: 110 },
    { id: 'return', header: '', size: 150, enableSorting: false, meta: { export: false, align: 'right' },
      cell: ({ row }) => (
        <button type="button" onClick={() => openCreate('in', { asset_no: row.original.asset_no || '', driver_name: row.original.driver_name || '', site: row.original.site || '' })}
          className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" aria-label={`Record return of ${row.original.asset_no || 'vehicle'}`}>
          <LogIn size={13} /> Record return
        </button>
      ) },
  ], [])

  const pairColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (p) => p.asset_no || 'N/A', size: 110 },
    { id: 'driver', header: 'Driver', accessorFn: (p) => p.driver_name || 'N/A', size: 140 },
    { id: 'out', header: 'Out', accessorFn: (p) => p.outAt || '', size: 160, cell: ({ row }) => fmtDateTime(row.original.outAt) },
    { id: 'in', header: 'Returned', accessorFn: (p) => p.inAt || '', size: 160, cell: ({ row }) => fmtDateTime(row.original.inAt) },
    { id: 'hours', header: 'Time out', accessorFn: (p) => p.hoursOut, size: 100, meta: { align: 'right' }, cell: ({ row }) => fmtHours(row.original.hoursOut) },
    { id: 'km', header: 'Km driven', accessorFn: (p) => p.kmDriven, size: 110, meta: { align: 'right' },
      cell: ({ row }) => (row.original.odometerBackwards
        ? <span className="text-amber-400 inline-flex items-center gap-1"><AlertTriangle size={12} aria-hidden="true" /> Odometer went back</span>
        : row.original.kmDriven == null ? 'N/A' : `${fmtNum(row.original.kmDriven)} km`) },
    { id: 'fuel', header: 'Fuel out / in', accessorFn: (p) => `${p.fuelOut || 'N/A'} / ${p.fuelIn || 'N/A'}`, size: 120 },
  ], [])

  const trendData = {
    labels: trend.map((d) => d.day.slice(5)),
    datasets: [
      { label: 'Checked out', data: trend.map((d) => d.out), backgroundColor: withAlpha(colorAt(0), 0.75), borderRadius: 3 },
      { label: 'Checked in', data: trend.map((d) => d.in), backgroundColor: withAlpha(colorAt(1), 0.75), borderRadius: 3 },
    ],
  }

  const tiles = [
    { label: 'Handovers', value: loaded ? fmtNum(k.total) : 'N/A', icon: ArrowRightLeft, sub: `${fmtNum(k.todayCount)} today` },
    { label: 'Currently out', value: loaded ? fmtNum(k.currentlyOut) : 'N/A', icon: LogOut, tone: 'info', sub: `${fmtNum(k.overdueCount)} over ${OVERDUE_HOURS} h` },
    { label: 'Returned', value: loaded ? fmtNum(k.returned) : 'N/A', icon: LogIn, tone: 'accent', sub: `${fmtNum(k.completedHandovers)} paired trips` },
    { label: 'Avg time out', value: loaded ? fmtHours(k.avgHoursOut) : 'N/A', icon: Clock, sub: 'Check-out to return' },
    { label: 'Km driven', value: loaded ? (k.totalKmDriven == null ? 'N/A' : `${fmtNum(k.totalKmDriven)} km`) : 'N/A', icon: Gauge, tone: 'warn', sub: k.odometerBackwards ? `${k.odometerBackwards} odometer went back` : 'Across paired trips' },
    { label: 'Assets tracked', value: loaded ? fmtNum(k.assets) : 'N/A', icon: Car },
    { label: 'Odometer recorded', value: loaded ? fmtPct(k.odometerCoveragePct) : 'N/A', icon: Hourglass, sub: 'Of handovers' },
    { label: 'Fuel recorded', value: loaded ? fmtPct(k.fuelCoveragePct) : 'N/A', icon: Fuel, sub: 'Of handovers' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vehicle Check In/Out"
        subtitle="Log vehicle handovers: odometer, fuel level and condition on every check-out and return."
        icon={ArrowRightLeft}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => runExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}><FileSpreadsheet size={14} /> Excel</button>
            <button type="button" onClick={() => runExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}><FileText size={14} /> PDF</button>
            <button type="button" onClick={() => openCreate('out')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={missing || !loaded}><LogOut size={14} /> Check out</button>
            <button type="button" onClick={() => openCreate('in')} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={missing || !loaded}><LogIn size={14} /> Check in</button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Vehicle check-in and check-out is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V144_VEHICLE_CHECKINOUT.sql</span>, then reload.</p>
          </div>
        </div>
      )}
      {error && (
        <div className="card border border-red-800/50 flex flex-wrap items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0"><p className="text-red-300 font-medium">Could not load handovers.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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
        {tiles.map((t, i) => <StatTile key={t.label} index={i} label={t.label} value={t.value} icon={t.icon} tone={t.tone} sub={t.sub} />)}
      </div>
      {loaded && (
        <p className="text-xs text-[var(--text-muted)] -mt-3">
          These figures cover the {fmtNum(filtered.length)} handover{filtered.length === 1 ? '' : 's'} matching the current filters
          {truncated ? `. Only the most recent ${READ_LIMIT} handovers are loaded, so older ones are not included.` : '.'}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Handovers per day, last 14 days</h2>
          <div className="h-60" role="img" aria-label="Check-outs and check-ins per day over the last 14 days">
            {!loaded ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : trend.some((d) => d.out || d.in) ? <Bar data={trendData} options={BAR_OPTS} />
                : <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No handovers in the last 14 days.</p>}
          </div>
        </div>
        <div className="card space-y-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><LogOut size={15} aria-hidden="true" /> Vehicles still out</h2>
          <p className="text-xs text-[var(--text-muted)]">Open check-outs across the whole register, longest first. Over {OVERDUE_HOURS} hours is flagged overdue.</p>
          <EnterpriseTable
            columns={outColumns}
            data={outNow}
            getRowId={(r) => String(r.id)}
            loading={!loaded && !error}
            emptyMessage="Every vehicle has been returned."
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            enableColumnVisibility={false}
            initialPageSize={25}
          />
        </div>
      </div>

      <div className="card space-y-2">
        <h2 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2"><CheckCircle2 size={15} aria-hidden="true" /> Completed handovers</h2>
        <p className="text-xs text-[var(--text-muted)]">Each check-out matched to the next check-in of the same asset. Km driven reads N/A when either odometer is missing.</p>
        <EnterpriseTable
          columns={pairColumns}
          data={pairs}
          getRowId={(p, i) => `${p.asset_no}-${p.outAt}-${i}`}
          loading={!loaded && !error}
          emptyMessage="No check-out has a matching return in this scope yet."
          enableColumnFilters={false}
          enableExport={false}
          searchPlaceholder="Search handovers"
        />
      </div>

      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-3 items-end">
          <div className="sm:col-span-2">
            <label htmlFor="cio-search" className="label">Search</label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input id="cio-search" className={`${FIELD} pl-9`} placeholder="Asset, driver, site, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="cio-direction" className="label">Direction</label>
            <select id="cio-direction" className={FIELD} value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)}>
              <option value="all">All directions</option>
              {DIRECTIONS.map((d) => <option key={d} value={d}>{DIRECTION_LABEL[d]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="cio-status" className="label">Status</label>
            <select id="cio-status" className={FIELD} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="cio-asset" className="label">Asset</label>
            <select id="cio-asset" className={FIELD} value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)}>
              <option value="">All assets</option>
              {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="cio-site" className="label">Site</label>
            <select id="cio-site" className={FIELD} value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
              <option value="">All sites</option>
              {siteOptions.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="cio-from" className="label">From</label>
            <input id="cio-from" type="date" className={FIELD} value={fromDate} max={toDate || undefined} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div>
            <label htmlFor="cio-to" className="label">To</label>
            <input id="cio-to" type="date" className={FIELD} value={toDate} min={fromDate || undefined} onChange={(e) => setToDate(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} /> Clear filters</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{fmtNum(filtered.length)} of {fmtNum(all.length)} handovers</span>
        </div>
      </div>

      <EnterpriseTable
        columns={columns}
        data={filtered}
        getRowId={(r) => String(r.id)}
        loading={!loaded && !error}
        error={error && !loaded ? error : null}
        onRetry={load}
        emptyMessage={all.length === 0 && !missing ? 'No handovers logged yet. Use Check out or Check in to record one.' : 'No entries match these filters.'}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableExport={false}
        viewKey="vehicle-checkinout"
      />

      <Modal
        open={modalOpen}
        onClose={() => { if (!saving) setModalOpen(false) }}
        title={editing ? 'Edit handover' : (form.direction === 'in' ? 'Vehicle check-in' : 'Vehicle check-out')}
        size="md"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" form="handover-form" className="btn-primary text-sm inline-flex items-center gap-2 min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
              {saving ? 'Saving...' : (editing ? 'Save changes' : 'Record handover')}
            </button>
          </div>
        }
      >
        <form id="handover-form" onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="hf-asset" className="label">Asset number <span className="text-red-400" aria-hidden="true">*</span></label>
              <input id="hf-asset" className={FIELD} placeholder="e.g. TRK-045" value={form.asset_no} maxLength={120} required onChange={(e) => setField('asset_no', e.target.value)} />
            </div>
            <div>
              <label htmlFor="hf-driver" className="label">Driver</label>
              <input id="hf-driver" className={FIELD} placeholder="Driver name" value={form.driver_name} maxLength={200} onChange={(e) => setField('driver_name', e.target.value)} />
            </div>
            <div>
              <label htmlFor="hf-direction" className="label">Direction</label>
              <select id="hf-direction" className={FIELD} value={form.direction} onChange={(e) => setField('direction', e.target.value)}>
                {DIRECTIONS.map((d) => <option key={d} value={d}>{DIRECTION_LABEL[d]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="hf-status" className="label">Status</label>
              <select id="hf-status" className={FIELD} value={form.status} onChange={(e) => setField('status', e.target.value)}>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="hf-odo" className="label">Odometer (km)</label>
              <input id="hf-odo" type="number" min={0} inputMode="numeric" className={FIELD} placeholder="45000" value={form.odometer_km} onChange={(e) => setField('odometer_km', e.target.value)} />
            </div>
            <div>
              <label htmlFor="hf-fuel" className="label">Fuel level</label>
              <select id="hf-fuel" className={FIELD} value={form.fuel_level} onChange={(e) => setField('fuel_level', e.target.value)}>
                <option value="">Not recorded</option>
                {FUEL_LEVELS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="hf-site" className="label">Site</label>
              <input id="hf-site" className={FIELD} placeholder="Depot or branch" value={form.site} maxLength={200} onChange={(e) => setField('site', e.target.value)} />
            </div>
            <div>
              <label htmlFor="hf-when" className="label">Date and time</label>
              <input id="hf-when" type="datetime-local" className={FIELD} value={form.checked_at || ''} onChange={(e) => setField('checked_at', e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="hf-notes" className="label">Condition notes</label>
            <textarea id="hf-notes" className="input w-full min-h-[90px] resize-y" placeholder="Damage, defects, cleanliness or other remarks" value={form.condition_notes} maxLength={4000} onChange={(e) => setField('condition_notes', e.target.value)} />
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
        title="Delete this handover?"
        size="sm"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-2 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        }
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-secondary)]">
            {DIRECTION_LABEL[confirmDelete.direction] || 'Entry'} for <span className="font-mono">{confirmDelete.asset_no || 'N/A'}</span> on {fmtDateTime(confirmDelete.checked_at)}. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
