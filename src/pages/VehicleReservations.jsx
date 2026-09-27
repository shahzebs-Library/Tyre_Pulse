/**
 * VehicleReservations (route /vehicle-reservations) - Vehicle Reservations /
 * Motor Pool Booking. Captures bookings of shared pool vehicles per requester
 * over a [start, end) window. Detecting double-bookings (same asset,
 * overlapping windows), overdue returns and what is currently out is the
 * backbone of pool utilisation and availability, so every reservation is
 * org-isolated and country-scoped.
 *
 * Runs on the `vehicle_reservations` table (V175). Duration and conflict logic
 * live in `src/lib/vehicleReservations.js`; filtering, KPIs, status mix,
 * department demand, the monthly trend and export rows live in
 * `src/lib/vehicleReservationsAnalytics.js`. This page only renders them.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, BarElement, CategoryScale, LinearScale, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import {
  CalendarClock, CalendarCheck, Car, LogOut, AlertTriangle, X, FileSpreadsheet, FileText,
  Plus, Pencil, Trash2, MapPin, Clock, Hourglass, Timer, RotateCw, BarChart3, Users, Ban,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import {
  listVehicleReservations, createVehicleReservation,
  updateVehicleReservation, deleteVehicleReservation,
} from '../lib/api/vehicleReservations'
import { durationHours } from '../lib/vehicleReservations'
import {
  RESERVATION_STATUSES, RESERVATION_STATUS_LABEL, NO_DEPARTMENT,
  findConflicts, conflictIdSet, isOverdueReturn, filterReservations, reservationKpis,
  reservationStatusMix, departmentDemand, monthlyBookings,
  RESERVATION_EXPORT_COLUMNS, reservationExportRows,
} from '../lib/vehicleReservationsAnalytics'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { colorAt } from '../lib/reportColors'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'
import useLatestRequest from '../lib/useLatestRequest'

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend)

const EMPTY_FORM = {
  reference: '', asset_no: '', requester_name: '', department: '', purpose: '',
  start_at: '', end_at: '', pickup_location: '', return_location: '',
  expected_km: '', status: 'requested', approved_by: '', notes: '',
}

const STATUS_CLS = {
  requested: 'bg-sky-900/40 text-sky-300 border-sky-800/50',
  approved: 'bg-indigo-900/40 text-indigo-300 border-indigo-800/50',
  out: 'bg-amber-900/40 text-amber-300 border-amber-800/50',
  returned: 'bg-green-900/40 text-green-300 border-green-800/50',
  cancelled: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]',
}

const ICON_BTN = 'inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'

function StatusBadge({ status }) {
  const key = String(status || '').toLowerCase()
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${STATUS_CLS[key] || STATUS_CLS.cancelled}`}>
      {RESERVATION_STATUS_LABEL[key] || status || 'N/A'}
    </span>
  )
}

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}
function fmtHours(h) {
  if (h == null) return 'N/A'
  if (h < 24) return `${Math.round(h * 10) / 10} h`
  return `${Math.round((h / 24) * 10) / 10} d`
}
// ISO/timestamptz to the local YYYY-MM-DDTHH:mm a datetime-local input expects.
function toLocalInput(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function KpiTile({ label, value, icon: Icon, tone = 'text-[var(--text-primary)]', sub }) {
  return (
    <div className="card !p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-[var(--text-muted)]">{label}</p>
        <Icon size={16} className={tone} aria-hidden="true" />
      </div>
      <p className={`text-2xl font-bold mt-1 tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

const barOpts = (stacked, legend = true) => ({
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: legend, labels: { color: 'var(--text-muted)', boxWidth: 12 } } },
  scales: {
    x: { stacked, ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { display: false } },
    y: { stacked, beginAtZero: true, ticks: { color: 'var(--text-muted)', precision: 0 }, grid: { color: 'var(--panel-2)' } },
  },
})

export default function VehicleReservations() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [asOf, setAsOf] = useState(() => new Date())
  const latest = useLatestRequest()

  const [statusFilter, setStatusFilter] = useState('')
  const [assetFilter, setAssetFilter] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [conflictsOnly, setConflictsOnly] = useState(false)
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [search, setSearch] = useState('')

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
      const data = await listVehicleReservations({ country: activeCountry })
      if (stale()) return
      setRows(Array.isArray(data) ? data : [])
      setAsOf(new Date())
      setUpdatedAt(new Date())
    } catch (err) {
      if (stale()) return
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load vehicle reservations.'))
      setRows(null)
    } finally {
      if (!stale()) setRefreshing(false)
    }
  }, [activeCountry, latest])

  useEffect(() => { load(); return latest.cancel }, [load, latest])

  const failed = !!error || notProvisioned
  const na = rows === null
  const all = useMemo(() => rows || [], [rows])
  const conflicts = useMemo(() => findConflicts(all), [all])
  const conflictIds = useMemo(() => conflictIdSet(conflicts), [conflicts])
  const assetOptions = useMemo(() => [...new Set(all.map((r) => r.asset_no).filter(Boolean))].sort(), [all])
  const deptOptions = useMemo(() => [...new Set(all.map((r) => String(r.department || '').trim() || NO_DEPARTMENT))].sort(), [all])

  const filtered = useMemo(() => filterReservations(all, {
    status: statusFilter, asset: assetFilter, department: deptFilter, from: fromDate, to: toDate,
    conflictsOnly, conflictIds, overdueOnly, now: asOf, search,
  }), [all, statusFilter, assetFilter, deptFilter, fromDate, toDate, conflictsOnly, conflictIds, overdueOnly, asOf, search])

  const kpi = useMemo(() => reservationKpis(filtered, { now: asOf }), [filtered, asOf])
  const statusMix = useMemo(() => reservationStatusMix(filtered), [filtered])
  const demand = useMemo(() => departmentDemand(filtered), [filtered])
  const trend = useMemo(() => monthlyBookings(filtered, { now: asOf }), [filtered, asOf])

  const hasFilters = !!(statusFilter || assetFilter || deptFilter || fromDate || toDate || conflictsOnly || overdueOnly || search)
  const clearFilters = () => {
    setStatusFilter(''); setAssetFilter(''); setDeptFilter(''); setFromDate(''); setToDate('')
    setConflictsOnly(false); setOverdueOnly(false); setSearch('')
  }

  const v = (x) => (na ? 'N/A' : x)
  const kpis = [
    { label: 'Total reservations', value: v(kpi.totalReservations.toLocaleString()), icon: CalendarClock, sub: na ? null : `${kpi.distinctAssets} vehicles` },
    { label: 'Currently out', value: v(kpi.activeOutCount), icon: LogOut, tone: 'text-amber-400' },
    { label: 'Overdue returns', value: v(kpi.overdueReturns), icon: Timer, tone: kpi.overdueReturns ? 'text-red-400' : 'text-green-400', sub: 'Out past the return time' },
    { label: 'Upcoming', value: v(kpi.upcomingCount), icon: CalendarCheck, tone: 'text-sky-400' },
    { label: 'Pending approval', value: v(kpi.pendingApproval), icon: Hourglass, tone: kpi.pendingApproval ? 'text-amber-400' : 'text-[var(--text-primary)]' },
    { label: 'Double-bookings', value: v(kpi.conflictCount), icon: AlertTriangle, tone: kpi.conflictCount > 0 ? 'text-red-400' : 'text-green-400', sub: 'Overlapping pairs' },
    { label: 'Booked time', value: v(kpi.bookedHours == null ? 'N/A' : fmtHours(kpi.bookedHours)), icon: Clock, sub: na || kpi.avgDurationHours == null ? null : `Average ${fmtHours(kpi.avgDurationHours)} per booking` },
    { label: 'Cancellation rate', value: v(kpi.cancellationRate == null ? 'N/A' : `${kpi.cancellationRate}%`), icon: Ban, tone: 'text-[var(--text-secondary)]' },
  ]

  // ── Export ──────────────────────────────────────────────────────────────────
  const exportRows = useMemo(() => reservationExportRows(filtered, { conflictIds, fmtDate: fmtDateTime }), [filtered, conflictIds])
  const fileName = reportFileName('TyrePulse Vehicle Reservations', activeCountry !== 'All' ? activeCountry : null, reportDateLabel())
  const doExcel = () => exportToExcel(exportRows, RESERVATION_EXPORT_COLUMNS.map((c) => c[0]), RESERVATION_EXPORT_COLUMNS.map((c) => c[1]), fileName)
  const doPdf = () => exportToPdf(exportRows, RESERVATION_EXPORT_COLUMNS.map(([key, header]) => ({ key, header })), 'Vehicle Reservations', fileName, 'landscape')

  // ── Charts ──────────────────────────────────────────────────────────────────
  const trendTotal = trend.reduce((s, m) => s + m.bookings + m.cancelled, 0)
  const trendData = {
    labels: trend.map((m) => m.month),
    datasets: [
      { label: 'Bookings', data: trend.map((m) => m.bookings), backgroundColor: colorAt(0), borderRadius: 3 },
      { label: 'Cancelled', data: trend.map((m) => m.cancelled), backgroundColor: colorAt(3), borderRadius: 3 },
    ],
  }
  const statusData = {
    labels: statusMix.map((s) => s.label),
    datasets: [{ label: 'Reservations', data: statusMix.map((s) => s.count), backgroundColor: statusMix.map((_, i) => colorAt(i)), borderRadius: 4 }],
  }

  // ── Modal ───────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      reference: r.reference || '', asset_no: r.asset_no || '',
      requester_name: r.requester_name || '', department: r.department || '',
      purpose: r.purpose || '', start_at: toLocalInput(r.start_at), end_at: toLocalInput(r.end_at),
      pickup_location: r.pickup_location || '', return_location: r.return_location || '',
      expected_km: r.expected_km ?? '', status: r.status || 'requested',
      approved_by: r.approved_by || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, val) => setForm((f) => ({ ...f, [k]: val }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    if (form.start_at && form.end_at && new Date(form.end_at).getTime() <= new Date(form.start_at).getTime()) {
      setFormError('The return time must be after the pickup time.'); return
    }
    setSaving(true)
    try {
      const payload = {
        ...form,
        expected_km: form.expected_km === '' ? null : form.expected_km,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateVehicleReservation(editing.id, payload)
      else await createVehicleReservation(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the reservation.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true); setActionError('')
    try {
      await deleteVehicleReservation(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the reservation.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  // ── Table ───────────────────────────────────────────────────────────────────
  const columns = useMemo(() => [
    {
      id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || '', size: 160,
      meta: { exportValue: (r) => r.asset_no || '' },
      cell: ({ row }) => {
        const r = row.original
        const conflicted = conflictIds.has(r.id)
        return (
          <div>
            <div className="flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
              {conflicted && <AlertTriangle size={13} className="text-red-400 shrink-0" aria-hidden="true" />}
              {r.asset_no || 'N/A'}
            </div>
            {conflicted && <span className="block text-[11px] text-red-400">Double-booked</span>}
            {r.reference && <span className="block text-[11px] text-[var(--text-muted)]">{r.reference}</span>}
          </div>
        )
      },
    },
    {
      id: 'requester', header: 'Requester', accessorFn: (r) => r.requester_name || '', size: 170,
      cell: ({ row }) => (
        <div className="text-[var(--text-secondary)]">
          {row.original.requester_name || 'N/A'}
          {row.original.department && <span className="block text-[11px] text-[var(--text-muted)]">{row.original.department}</span>}
        </div>
      ),
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => RESERVATION_STATUS_LABEL[String(r.status || '').toLowerCase()] || r.status || '', size: 130,
      cell: ({ row }) => (
        <div>
          <StatusBadge status={row.original.status} />
          {isOverdueReturn(row.original, { now: asOf }) && <span className="block text-[11px] text-red-400 mt-0.5">Return overdue</span>}
        </div>
      ),
    },
    {
      id: 'start', header: 'Pickup', accessorFn: (r) => (r.start_at ? new Date(r.start_at).getTime() : -Infinity), size: 170,
      meta: { exportValue: (r) => fmtDateTime(r.start_at) },
      cell: ({ row }) => <span className="whitespace-nowrap text-[var(--text-secondary)]">{fmtDateTime(row.original.start_at)}</span>,
    },
    {
      id: 'end', header: 'Return', accessorFn: (r) => (r.end_at ? new Date(r.end_at).getTime() : -Infinity), size: 170,
      meta: { exportValue: (r) => fmtDateTime(r.end_at) },
      cell: ({ row }) => <span className="whitespace-nowrap text-[var(--text-secondary)]">{fmtDateTime(row.original.end_at)}</span>,
    },
    { id: 'duration', header: 'Duration', accessorFn: (r) => durationHours(r) ?? -1, size: 100, meta: { align: 'right', exportValue: (r) => fmtHours(durationHours(r)) }, cell: ({ row }) => <span className="tabular-nums">{fmtHours(durationHours(row.original))}</span> },
    {
      id: 'route', header: 'Pickup and return', accessorFn: (r) => `${r.pickup_location || ''} ${r.return_location || ''}`, size: 220,
      meta: { exportValue: (r) => `${r.pickup_location || 'N/A'} to ${r.return_location || 'N/A'}` },
      cell: ({ row }) => (row.original.pickup_location || row.original.return_location)
        ? <span className="flex items-center gap-1 text-xs text-[var(--text-secondary)]"><MapPin size={12} className="text-[var(--text-muted)] shrink-0" aria-hidden="true" />{row.original.pickup_location || 'N/A'} to {row.original.return_location || 'N/A'}</span>
        : <span className="text-[var(--text-muted)]">N/A</span>,
    },
    {
      id: 'actions', header: '', enableSorting: false, size: 110, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(row.original)} className={ICON_BTN} aria-label={`Edit reservation for ${row.original.asset_no || 'asset'}`}><Pencil size={15} /></button>
          <button type="button" onClick={() => setConfirmDelete(row.original)} className={`${ICON_BTN} hover:text-red-400`} aria-label={`Delete reservation for ${row.original.asset_no || 'asset'}`}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ], [conflictIds, asOf, openEdit])

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vehicle Reservations"
        subtitle="Book and track shared motor-pool vehicles: approvals, check-out and return, overdue returns, and automatic double-booking detection for pool utilisation and availability."
        icon={CalendarClock}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={doExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={doPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={failed}>
              <Plus size={14} aria-hidden="true" /> New reservation
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Vehicle reservations are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">Ask your administrator to enable vehicle reservations, then refresh.</p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex flex-wrap items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-red-300 font-medium">Could not load vehicle reservations.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error}</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><RotateCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}

      {actionError && (
        <div className="card border border-red-800/50 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="flex-1 text-sm text-red-300">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className={ICON_BTN} aria-label="Dismiss message"><X size={16} /></button>
        </div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => <KpiTile key={k.label} {...k} />)}
      </div>
      {hasFilters && !na && (
        <p className="text-xs text-[var(--text-muted)] -mt-3">These figures cover the {filtered.length} reservations matching the current filters.</p>
      )}

      {/* Double-booking strip */}
      {!na && conflicts.length > 0 && (
        <div className="card border border-red-800/50">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <AlertTriangle size={16} className="text-red-400 shrink-0" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-red-300">
              {conflicts.length} double-booking{conflicts.length === 1 ? '' : 's'} detected
            </h2>
            <button type="button" onClick={() => setConflictsOnly(true)} className="btn-secondary text-xs ml-auto min-h-[44px]">Show only double-booked</button>
          </div>
          <p className="text-xs text-[var(--text-muted)] mb-3">Same asset booked over overlapping time windows. Resolve by rescheduling, reassigning a vehicle, or cancelling one booking.</p>
          <ul className="space-y-1.5">
            {conflicts.slice(0, 8).map((c, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 text-xs bg-red-900/15 border border-red-800/40 rounded-lg px-3 py-2">
                <Car size={13} className="text-red-400 shrink-0" aria-hidden="true" />
                <span className="font-semibold text-[var(--text-primary)]">{c.a.asset_no}</span>
                <span className="text-[var(--text-secondary)]">{c.a.requester_name || c.a.reference || 'Reservation'} ({fmtDateTime(c.a.start_at)} to {fmtDateTime(c.a.end_at)})</span>
                <span className="text-red-400">overlaps</span>
                <span className="text-[var(--text-secondary)]">{c.b.requester_name || c.b.reference || 'Reservation'} ({fmtDateTime(c.b.start_at)} to {fmtDateTime(c.b.end_at)})</span>
              </li>
            ))}
          </ul>
          {conflicts.length > 8 && <p className="text-xs text-[var(--text-muted)] mt-2">{conflicts.length - 8} more conflicting pairs are flagged in the register below.</p>}
        </div>
      )}

      {/* Charts + demand */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><BarChart3 size={15} aria-hidden="true" /> Bookings per month</h2>
          <div className="h-56">
            {na ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" aria-hidden="true" />
              : trendTotal === 0 ? <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)] text-center">No pickups dated in the last 12 months.</p>
                : <Bar data={trendData} options={barOpts(true)} role="img" aria-label="Bookings and cancellations per month" />}
          </div>
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><CalendarCheck size={15} aria-hidden="true" /> Reservations by status</h2>
          <div className="h-56">
            {na ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" aria-hidden="true" />
              : filtered.length === 0 ? <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No reservations to show.</p>
                : <Bar data={statusData} options={barOpts(false, false)} role="img" aria-label="Reservations by status" />}
          </div>
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><Users size={15} aria-hidden="true" /> Demand by department</h2>
          {na ? <div className="h-56 bg-[var(--input-bg)] rounded animate-pulse" aria-hidden="true" />
            : demand.length === 0 ? <p className="text-sm text-[var(--text-muted)]">No active bookings to rank.</p> : (
              <ul className="divide-y divide-[var(--input-border)]/60">
                {demand.map((d) => (
                  <li key={d.department} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="text-[var(--text-primary)] truncate">{d.department}</span>
                    <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">{d.bookings} bookings, {fmtHours(d.hours)}</span>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="block"><span className="label">Search</span>
            <input className="input w-full min-h-[44px]" placeholder="Asset, requester, reference, purpose" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          <label className="block"><span className="label">Status</span>
            <select className="input w-full min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All statuses</option>
              {RESERVATION_STATUSES.map((s) => <option key={s} value={s}>{RESERVATION_STATUS_LABEL[s]}</option>)}
            </select></label>
          <label className="block"><span className="label">Asset</span>
            <select className="input w-full min-h-[44px]" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)}>
              <option value="">All assets</option>
              {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select></label>
          <label className="block"><span className="label">Department</span>
            <select className="input w-full min-h-[44px]" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
              <option value="">All departments</option>
              {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
            </select></label>
          <label className="block"><span className="label">Pickup from</span>
            <input type="date" className="input w-full min-h-[44px]" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
          <label className="block"><span className="label">Pickup to</span>
            <input type="date" className="input w-full min-h-[44px]" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
          <label className="flex items-center gap-2 self-end min-h-[44px] text-sm text-[var(--text-secondary)] cursor-pointer">
            <input type="checkbox" className="h-4 w-4" checked={conflictsOnly} onChange={(e) => setConflictsOnly(e.target.checked)} /> Only double-booked
          </label>
          <label className="flex items-center gap-2 self-end min-h-[44px] text-sm text-[var(--text-secondary)] cursor-pointer">
            <input type="checkbox" className="h-4 w-4" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Only overdue returns
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear filters</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{na ? 'Not loaded' : `${filtered.length} of ${all.length} reservations`}</span>
        </div>
      </div>

      {/* Register */}
      {failed ? (
        <div className="card text-center py-10 text-sm text-[var(--text-muted)]">Vehicle reservations are unavailable.</div>
      ) : (
        <EnterpriseTable
          columns={columns}
          data={filtered}
          getRowId={(r) => String(r.id)}
          loading={na}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          exportFileName={fileName}
          viewKey="vehicle-reservations"
          initialPageSize={25}
          emptyMessage={all.length === 0 ? 'No reservations yet. Create your first booking.' : 'No reservations match these filters.'}
        />
      )}

      {/* Create / Edit */}
      <Modal open={showModal} onClose={closeModal} title={editing ? 'Edit reservation' : 'New reservation'} size="lg">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block"><span className="label">Asset number *</span>
              <input className="input w-full" required placeholder="e.g. POOL-07" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} /></label>
            <label className="block"><span className="label">Reference (optional)</span>
              <input className="input w-full" placeholder="e.g. RES-2026-014" value={form.reference} maxLength={120} onChange={(e) => set('reference', e.target.value)} /></label>
            <label className="block"><span className="label">Requester (optional)</span>
              <input className="input w-full" placeholder="e.g. A. Rahman" value={form.requester_name} maxLength={200} onChange={(e) => set('requester_name', e.target.value)} /></label>
            <label className="block"><span className="label">Department (optional)</span>
              <input className="input w-full" placeholder="e.g. Operations" value={form.department} maxLength={200} onChange={(e) => set('department', e.target.value)} /></label>
            <label className="block"><span className="label">Pickup (start)</span>
              <input className="input w-full" type="datetime-local" value={form.start_at} onChange={(e) => set('start_at', e.target.value)} /></label>
            <label className="block"><span className="label">Return (end)</span>
              <input className="input w-full" type="datetime-local" value={form.end_at} onChange={(e) => set('end_at', e.target.value)} /></label>
            <label className="block"><span className="label">Pickup location (optional)</span>
              <input className="input w-full" placeholder="e.g. Riyadh depot" value={form.pickup_location} maxLength={200} onChange={(e) => set('pickup_location', e.target.value)} /></label>
            <label className="block"><span className="label">Return location (optional)</span>
              <input className="input w-full" placeholder="e.g. Riyadh depot" value={form.return_location} maxLength={200} onChange={(e) => set('return_location', e.target.value)} /></label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <label className="block"><span className="label">Status</span>
              <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {RESERVATION_STATUSES.map((s) => <option key={s} value={s}>{RESERVATION_STATUS_LABEL[s]}</option>)}
              </select></label>
            <label className="block"><span className="label">Expected distance (km)</span>
              <input className="input w-full" type="number" step="1" min="0" inputMode="numeric" placeholder="120" value={form.expected_km} onChange={(e) => set('expected_km', e.target.value)} /></label>
            <label className="block"><span className="label">Approved by (optional)</span>
              <input className="input w-full" placeholder="e.g. Fleet manager" value={form.approved_by} maxLength={200} onChange={(e) => set('approved_by', e.target.value)} /></label>
          </div>
          <label className="block"><span className="label">Purpose (optional)</span>
            <input className="input w-full" placeholder="e.g. Site inspection run" value={form.purpose} maxLength={500} onChange={(e) => set('purpose', e.target.value)} /></label>
          <label className="block"><span className="label">Notes (optional)</span>
            <textarea className="input w-full min-h-[80px] resize-y" placeholder="e.g. driver to collect keys from reception" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} /></label>

          {formError && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2" role="alert">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" className="btn-primary text-sm min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create reservation'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={() => { if (!deleting) setConfirmDelete(null) }}
        title="Delete this reservation?"
        size="sm"
        footer={
          <>
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </>
        }
      >
        <p className="text-sm text-[var(--text-muted)]">
          {confirmDelete?.asset_no || 'Reservation'}, {confirmDelete?.requester_name || confirmDelete?.reference || 'N/A'}, {fmtDateTime(confirmDelete?.start_at)}. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
