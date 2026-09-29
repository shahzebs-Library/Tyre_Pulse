/**
 * VehicleReservations (route /reservations) - book and allocate pool vehicles,
 * rebuilt on the shared page kit to the owner's light reference design.
 *
 * Runs on the `vehicle_reservations` table (V175): asset, requester,
 * department, purpose, start and end, pickup and return location, expected
 * km, workflow status (requested, approved, out, returned, cancelled),
 * approver, reference and notes. The table records NO reservation type,
 * project, driver or attachment, so those parts of the mockup are omitted
 * and the page says so. Sites carry no coordinates, so the Map view is an
 * honest empty state.
 *
 * Duration and overlap logic live in src/lib/vehicleReservations.js; filters,
 * the health KPIs, department demand, the monthly trend and export rows live
 * in src/lib/vehicleReservationsAnalytics.js; the calendar grid, derived
 * status, clash check, availability and import mapping live in
 * src/lib/vehicleReservationsView.js. This page only renders them.
 *
 * Kept from the previous page: create / edit / delete, double-booking
 * detection, overdue returns, every filter, Excel and PDF export, loading /
 * error+Retry / not-provisioned states, and the stale-country guard.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  CalendarDays, CalendarCheck, CalendarClock, Clock, AlertTriangle, Ban, Plus, X, Search,
  FileSpreadsheet, FileText, Pencil, Trash2, Eye, ChevronLeft, ChevronRight, SlidersHorizontal,
  RefreshCw, Layers, Upload, SearchCheck, MapPin, Info, Loader2,
} from 'lucide-react'
import Modal from '../components/ui/Modal'
import {
  Card, CardState, Kpi, PageHero, Tabs, Donut, Pager, VehicleThumb, KitTable, fmtInt, useCard, ViewAll,
} from '../components/commandCenter/kit'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import {
  listVehicleReservations, createVehicleReservation,
  updateVehicleReservation, deleteVehicleReservation, listReservationDrivers,
} from '../lib/api/vehicleReservations'
import ReservationDrawer from '../components/reservations/ReservationDrawer'
import { listAssets } from '../lib/api/assets'
import { durationHours } from '../lib/vehicleReservations'
import {
  RESERVATION_STATUSES, RESERVATION_STATUS_LABEL, NO_DEPARTMENT,
  findConflicts, conflictIdSet, isOverdueReturn, filterReservations, reservationKpis,
  departmentDemand, monthlyBookings, RESERVATION_EXPORT_COLUMNS, reservationExportRows,
} from '../lib/vehicleReservationsAnalytics'
import {
  VIEW_STATUSES, VIEW_STATUS_META, deriveStatus, viewKpis, summarySegments, buildSlots, shiftAnchor,
  layoutCalendar, clashesFor, availability, upcomingList, mapImportRow, IMPORT_TEMPLATE_HEADERS,
  isRejected,
} from '../lib/vehicleReservationsView'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'
import useLatestRequest from '../lib/useLatestRequest'
import './VehicleReservations.css'

const EMPTY_FORM = {
  reference: '', asset_no: '', requester_name: '', department: '', purpose: '',
  start_at: '', end_at: '', pickup_location: '', return_location: '',
  expected_km: '', status: 'requested', approved_by: '', notes: '',
  project: '', cost_centre: '', driver_id: '', driver_name: '',
}
const NOT_RECORDED = 'Vehicle type, plate and site come from the fleet register. Attachments are not stored on a reservation.'
const ELEVATED_ROLES = ['admin', 'manager', 'director']
const CAL_PAGE = 8

function fmtDateTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function fmtShort(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
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
const assetKey = (v) => String(v || '').trim().toUpperCase()

function StatusPill({ row, now }) {
  const st = deriveStatus(row, { now })
  const meta = VIEW_STATUS_META[st]
  return <span className={`cc-pill ${meta.tone}`}>{meta.label}</span>
}

function Banner({ tone, icon: Icon, title, children, action }) {
  return (
    <div className={`cc-card vr-banner ${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden="true" />
      <div><b>{title}</b>{children && <p>{children}</p>}</div>
      {action}
    </div>
  )
}

export default function VehicleReservations() {
  const { activeCountry } = useSettings()
  const auth = useAuth()
  const userId = auth?.user?.id || null
  const elevated = !!auth?.isSuperAdmin || ELEVATED_ROLES.includes(String(auth?.profile?.role || '').toLowerCase())
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [asOf, setAsOf] = useState(() => new Date())
  const latest = useLatestRequest()

  // Filters (kept from the previous page, plus the mockup's bar)
  const [search, setSearch] = useState('')
  const [viewStatus, setViewStatus] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [locFilter, setLocFilter] = useState('')
  const [requesterFilter, setRequesterFilter] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [assetFilter, setAssetFilter] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [conflictsOnly, setConflictsOnly] = useState(false)
  const [overdueOnly, setOverdueOnly] = useState(false)

  // View
  const [view, setView] = useState('calendar')
  const [calMode, setCalMode] = useState('week')
  const [anchor, setAnchor] = useState(() => Date.now())
  const [calPage, setCalPage] = useState(0)

  // Form panel
  const [editing, setEditing] = useState(null)
  const [bookMode, setBookMode] = useState('single')
  const [form, setForm] = useState(EMPTY_FORM)
  const [multiAssets, setMultiAssets] = useState([])
  const [multiInput, setMultiInput] = useState('')
  const [bookAnyway, setBookAnyway] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [detail, setDetail] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [availOpen, setAvailOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const load = useCallback(async () => {
    const stale = latest.begin()
    setRows(null); setError(''); setNotProvisioned(false)
    try {
      const data = await listVehicleReservations({ country: activeCountry })
      if (stale()) return
      setRows(Array.isArray(data) ? data : [])
      setAsOf(new Date())
    } catch (err) {
      if (stale()) return
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load vehicle reservations.'))
      setRows(null)
    }
  }, [activeCountry, latest])
  useEffect(() => { load(); return latest.cancel }, [load, latest])

  const fleetCard = useCard(() => listAssets({ country: activeCountry }), [activeCountry])
  const fleet = useMemo(() => fleetCard.data || [], [fleetCard.data])
  const fleetByAsset = useMemo(() => {
    const m = new Map()
    for (const a of fleet) {
      const k = assetKey(a.asset_no)
      if (k && !m.has(k)) m.set(k, a)
    }
    return m
  }, [fleet])
  const fleetOf = useCallback((asset) => fleetByAsset.get(assetKey(asset)) || null, [fleetByAsset])
  const driversCard = useCard(() => listReservationDrivers({ country: activeCountry }), [activeCountry])
  const drivers = useMemo(() => driversCard.data || [], [driversCard.data])
  const driverByName = useMemo(() => {
    const m = new Map()
    for (const d of drivers) { const k = String(d.driver_name || '').trim().toUpperCase(); if (k && !m.has(k)) m.set(k, d) }
    return m
  }, [drivers])

  const failed = !!error || notProvisioned
  const na = rows === null
  const all = useMemo(() => rows || [], [rows])
  const conflicts = useMemo(() => findConflicts(all), [all])
  const conflictIds = useMemo(() => conflictIdSet(conflicts), [conflicts])

  const assetOptions = useMemo(() => [...new Set(all.map((r) => r.asset_no).filter(Boolean))].sort(), [all])
  const deptOptions = useMemo(() => [...new Set(all.map((r) => String(r.department || '').trim() || NO_DEPARTMENT))].sort(), [all])
  const locOptions = useMemo(() => [...new Set(all.flatMap((r) => [r.pickup_location, r.return_location]).map((s) => String(s || '').trim()).filter(Boolean))].sort(), [all])
  const requesterOptions = useMemo(() => [...new Set(all.map((r) => String(r.requester_name || '').trim()).filter(Boolean))].sort(), [all])
  const typeOptions = useMemo(() => [...new Set(all.map((r) => fleetOf(r.asset_no)?.vehicle_type).filter(Boolean))].sort(), [all, fleetOf])
  const siteOptions = useMemo(() => [...new Set(fleet.map((a) => a.site).filter(Boolean))].sort(), [fleet])

  const filtered = useMemo(() => {
    const base = filterReservations(all, {
      status: statusFilter, asset: assetFilter, department: deptFilter, from: fromDate, to: toDate,
      conflictsOnly, conflictIds, overdueOnly, now: asOf, search,
    })
    return base.filter((r) => {
      if (viewStatus && deriveStatus(r, { now: asOf }) !== viewStatus) return false
      if (typeFilter && fleetOf(r.asset_no)?.vehicle_type !== typeFilter) return false
      if (locFilter && r.pickup_location?.trim() !== locFilter && r.return_location?.trim() !== locFilter) return false
      if (requesterFilter && String(r.requester_name || '').trim() !== requesterFilter) return false
      return true
    })
  }, [all, statusFilter, assetFilter, deptFilter, fromDate, toDate, conflictsOnly, conflictIds, overdueOnly, asOf, search, viewStatus, typeFilter, locFilter, requesterFilter, fleetOf])

  const hasFilters = !!(statusFilter || assetFilter || deptFilter || fromDate || toDate || conflictsOnly || overdueOnly || search || viewStatus || typeFilter || locFilter || requesterFilter)
  const clearFilters = () => {
    setStatusFilter(''); setAssetFilter(''); setDeptFilter(''); setFromDate(''); setToDate('')
    setConflictsOnly(false); setOverdueOnly(false); setSearch(''); setViewStatus(''); setTypeFilter('')
    setLocFilter(''); setRequesterFilter('')
  }

  const kpi = useMemo(() => viewKpis(filtered, { now: asOf }), [filtered, asOf])
  const health = useMemo(() => reservationKpis(filtered, { now: asOf }), [filtered, asOf])
  const segments = useMemo(() => summarySegments(filtered, { now: asOf }), [filtered, asOf])
  const demand = useMemo(() => departmentDemand(filtered), [filtered])
  const trend = useMemo(() => monthlyBookings(filtered, { now: asOf }), [filtered, asOf])
  const upcoming = useMemo(() => upcomingList(filtered, { now: asOf, limit: 6 }), [filtered, asOf])
  const mine = useMemo(() => (userId ? filtered.filter((r) => r.created_by === userId) : []), [filtered, userId])

  const grid = useMemo(() => buildSlots(anchor, calMode, { now: asOf }), [anchor, calMode, asOf])
  const calendar = useMemo(() => layoutCalendar(filtered, grid, { now: asOf }), [filtered, grid, asOf])

  // ── Export ──────────────────────────────────────────────────────────────────
  const exportRows = useMemo(() => reservationExportRows(filtered, { conflictIds, fmtDate: fmtDateTime }), [filtered, conflictIds])
  const fileName = reportFileName('TyrePulse Vehicle Reservations', activeCountry !== 'All' ? activeCountry : null, reportDateLabel())
  const doExcel = () => exportToExcel(exportRows, RESERVATION_EXPORT_COLUMNS.map((c) => c[0]), RESERVATION_EXPORT_COLUMNS.map((c) => c[1]), fileName)
  const doPdf = () => exportToPdf(exportRows, RESERVATION_EXPORT_COLUMNS.map(([key, header]) => ({ key, header })), 'Vehicle Reservations', fileName, 'landscape')

  // ── Form ────────────────────────────────────────────────────────────────────
  const resetForm = useCallback((mode = 'single') => {
    setEditing(null); setBookMode(mode); setForm(EMPTY_FORM); setMultiAssets([]); setMultiInput('')
    setBookAnyway(false); setShowMore(false); setFormError('')
  }, [])
  const startNew = (mode = 'single') => {
    resetForm(mode)
    document.getElementById('vr-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setTimeout(() => document.getElementById('vr-asset')?.focus(), 50)
  }
  const openEdit = useCallback((r) => {
    setDetail(null)
    setEditing(r); setBookMode('single'); setBookAnyway(false); setShowMore(true); setFormError('')
    setForm({
      reference: r.reference || '', asset_no: r.asset_no || '',
      requester_name: r.requester_name || '', department: r.department || '',
      purpose: r.purpose || '', start_at: toLocalInput(r.start_at), end_at: toLocalInput(r.end_at),
      pickup_location: r.pickup_location || '', return_location: r.return_location || '',
      expected_km: r.expected_km ?? '', status: r.status || 'requested',
      approved_by: r.approved_by || '', notes: r.notes || '',
      project: r.project || '', cost_centre: r.cost_centre || '',
      driver_id: r.driver_id || '', driver_name: r.driver_name || '',
    })
    document.getElementById('vr-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])
  const set = (k, val) => { setForm((f) => ({ ...f, [k]: val })); setBookAnyway(false) }

  const singleAsset = form.asset_no.trim()
  const targetAssets = useMemo(() => (bookMode === 'multiple' ? multiAssets : (singleAsset ? [singleAsset] : [])), [bookMode, multiAssets, singleAsset])
  const clashes = useMemo(() => {
    if (!form.start_at || !form.end_at) return []
    const out = []
    for (const a of targetAssets) {
      const cand = { asset_no: a, start_at: new Date(form.start_at).toISOString(), end_at: new Date(form.end_at).toISOString() }
      for (const hit of clashesFor(cand, all, { excludeId: editing?.id })) out.push({ asset: a, hit })
    }
    return out
  }, [targetAssets, form.start_at, form.end_at, all, editing])

  const addMulti = () => {
    const v = multiInput.trim()
    if (!v) return
    if (!multiAssets.some((a) => assetKey(a) === assetKey(v))) setMultiAssets((m) => [...m, v])
    setMultiInput(''); setBookAnyway(false)
  }

  const submit = async (e) => {
    e?.preventDefault?.()
    setFormError(''); setNotice('')
    if (!targetAssets.length) { setFormError(bookMode === 'multiple' ? 'Add at least one vehicle.' : 'An asset number is required.'); return }
    if (!editing && (!form.start_at || !form.end_at)) { setFormError('Start and end date and time are required.'); return }
    if (form.start_at && form.end_at && new Date(form.end_at).getTime() <= new Date(form.start_at).getTime()) {
      setFormError('The return time must be after the pickup time.'); return
    }
    if (clashes.length && !bookAnyway) { setFormError('This clashes with an existing booking. Pick another time or vehicle, or tick "Save anyway".'); return }
    setSaving(true)
    const payloadFor = (asset) => ({
      ...form, asset_no: asset,
      expected_km: form.expected_km === '' ? null : form.expected_km,
      country: activeCountry !== 'All' ? activeCountry : null,
    })
    try {
      if (editing) {
        await updateVehicleReservation(editing.id, payloadFor(targetAssets[0]))
        setNotice('Reservation updated.')
      } else if (targetAssets.length === 1) {
        await createVehicleReservation(payloadFor(targetAssets[0]))
        setNotice('Reservation created.')
      } else {
        const failedAssets = []
        for (const a of targetAssets) {
          try { await createVehicleReservation(payloadFor(a)) } catch { failedAssets.push(a) }
        }
        const made = targetAssets.length - failedAssets.length
        setNotice(`Created ${made} of ${targetAssets.length} reservations.${failedAssets.length ? ` Not saved: ${failedAssets.join(', ')}.` : ''}`)
      }
      resetForm(bookMode)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the reservation.'))
    } finally {
      setSaving(false)
    }
  }

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true); setActionError('')
    try {
      await deleteVehicleReservation(confirmDelete.id)
      if (editing?.id === confirmDelete.id) resetForm()
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the reservation.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load, editing, resetForm])

  // ── Table columns ───────────────────────────────────────────────────────────
  const vehicleCell = useCallback((r) => {
    const f = fleetOf(r.asset_no)
    const conflicted = conflictIds.has(r.id)
    return (
      <span className="cc-vehicle">
        <VehicleThumb row={f || { asset_no: r.asset_no }} size="sm" />
        <span>
          <span className="cc-strong">{r.asset_no || 'N/A'}</span>
          {conflicted
            ? <span className="cc-sub vr-bad"><AlertTriangle size={11} aria-hidden="true" /> Double-booked</span>
            : <span className="cc-sub">{f?.vehicle_type || r.reference || 'Type not recorded'}</span>}
        </span>
      </span>
    )
  }, [fleetOf, conflictIds])
  const actionsCell = useCallback((r) => (
    <span className="vr-actions" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="cc-icon-btn" onClick={() => setDetail(r)} aria-label={`View reservation for ${r.asset_no || 'asset'}`}><Eye size={14} /></button>
      <button type="button" className="cc-icon-btn" onClick={() => openEdit(r)} aria-label={`Edit reservation for ${r.asset_no || 'asset'}`}><Pencil size={14} /></button>
      <button type="button" className="cc-icon-btn vr-danger" onClick={() => setConfirmDelete(r)} aria-label={`Delete reservation for ${r.asset_no || 'asset'}`}><Trash2 size={14} /></button>
    </span>
  ), [openEdit])

  const registerColumns = useMemo(() => [
    { key: 'asset_no', header: 'Vehicle / asset', cell: vehicleCell },
    { key: 'requester_name', header: 'Requester', cell: (r) => (
      <span>{r.requester_name || <span className="cc-na">N/A</span>}{r.department && <span className="cc-sub">{r.department}</span>}</span>
    ) },
    { key: 'driver_name', header: 'Driver', cell: (r) => (
      <span>{r.driver_name || <span className="cc-na">Not recorded</span>}{r.project && <span className="cc-sub">{r.project}</span>}</span>
    ) },
    { key: 'status', header: 'Status', sortValue: (r) => deriveStatus(r, { now: asOf }), cell: (r) => (
      <span><StatusPill row={r} now={asOf} /><span className="cc-sub">{isRejected(r) ? 'Rejected' : (RESERVATION_STATUS_LABEL[String(r.status || '').toLowerCase()] || r.status || 'N/A')}</span></span>
    ) },
    { key: 'start_at', header: 'Pickup', sortValue: (r) => (r.start_at ? Date.parse(r.start_at) : -Infinity), cell: (r) => fmtShort(r.start_at) },
    { key: 'end_at', header: 'Return', sortValue: (r) => (r.end_at ? Date.parse(r.end_at) : -Infinity), cell: (r) => (
      <span>{fmtShort(r.end_at)}{isOverdueReturn(r, { now: asOf }) && <span className="cc-sub vr-bad">Return overdue</span>}</span>
    ) },
    { key: 'duration', header: 'Duration', numeric: true, sortValue: (r) => durationHours(r) ?? -1, cell: (r) => fmtHours(durationHours(r)) },
    { key: 'route', header: 'Pickup and return', sortValue: (r) => `${r.pickup_location || ''} ${r.return_location || ''}`, cell: (r) => (
      (r.pickup_location || r.return_location)
        ? <span className="cc-site"><MapPin size={12} aria-hidden="true" />{r.pickup_location || 'N/A'} to {r.return_location || 'N/A'}</span>
        : <span className="cc-na">N/A</span>
    ) },
    { key: 'purpose', header: 'Purpose', cell: (r) => r.purpose || <span className="cc-na">N/A</span> },
    { key: 'actions', header: '', sortable: false, cell: actionsCell },
  ], [vehicleCell, actionsCell, asOf])

  const upcomingColumns = useMemo(() => [
    { key: 'start_at', header: 'Date', cell: (r) => fmtShort(r.start_at) },
    { key: 'asset_no', header: 'Vehicle / asset', cell: vehicleCell },
    { key: 'requester_name', header: 'Requester', cell: (r) => r.requester_name || <span className="cc-na">N/A</span> },
    { key: 'pickup_location', header: 'Location', cell: (r) => r.pickup_location || <span className="cc-na">N/A</span> },
    { key: 'purpose', header: 'Purpose', cell: (r) => r.purpose || <span className="cc-na">N/A</span> },
    { key: 'status', header: 'Status', cell: (r) => <StatusPill row={r} now={asOf} /> },
    { key: 'actions', header: 'Actions', cell: actionsCell },
  ], [vehicleCell, actionsCell, asOf])

  const pad2 = (n) => String(n).padStart(2, '0')
  const localInput = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}` }
  const bookSlot = (asset, slot) => {
    resetForm('single')
    const start = slot.start
    const end = calMode === 'day' ? slot.end : start + 9 * 3600000 + 8 * 3600000
    const startAt = calMode === 'day' ? start : start + 8 * 3600000
    setForm({ ...EMPTY_FORM, asset_no: asset, start_at: localInput(startAt), end_at: localInput(end) })
    document.getElementById('vr-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const pickMonth = (ym) => {
    const [y, m] = ym.split('-').map(Number)
    const last = new Date(y, m, 0).getDate()
    setFromDate(`${ym}-01`); setToDate(`${ym}-${pad2(last)}`); setMoreOpen(true); setView('list')
  }

  // ── Render helpers ──────────────────────────────────────────────────────────
  const listState = { loading: na && !failed, data: rows, error: failed ? 'Vehicle reservations are unavailable.' : null, retry: load }
  const kpiVal = (n) => (na ? 'N/A' : fmtInt(n))
  const trendMax = Math.max(1, ...trend.map((m) => m.bookings + m.cancelled))
  const trendTotal = trend.reduce((s, m) => s + m.bookings + m.cancelled, 0)
  const demandMax = Math.max(1, ...demand.map((d) => d.bookings))
  const calPages = Math.max(1, Math.ceil(calendar.vehicles.length / CAL_PAGE))
  const safeCalPage = Math.min(calPage, calPages - 1)
  const pageVehicles = calendar.vehicles.slice(safeCalPage * CAL_PAGE, (safeCalPage + 1) * CAL_PAGE)
  const selectedFleet = bookMode === 'single' ? fleetOf(form.asset_no) : null

  const calendarBody = (
    <CardState state={listState} lines={6} empty={!na && calendar.vehicles.length === 0
      ? (all.length === 0 ? 'No reservations yet. Create the first booking with the form on the right.' : `No bookings in ${grid.label}${hasFilters ? ' for these filters' : ''}.`)
      : null}>
      <div className="vr-cal-scroll">
        <div className={`vr-cal vr-cal-${calMode}`} style={{ '--vr-cols': grid.slots.length }}>
          <div className="vr-cal-head">
            <div className="vr-cal-vcol">Vehicle / asset</div>
            {grid.slots.map((s) => (
              <div key={s.start} className={`vr-cal-slot ${s.today ? 'today' : ''}`}><b>{s.label}</b>{s.sub && <span>{s.sub}</span>}</div>
            ))}
          </div>
          {pageVehicles.map((v) => {
            const f = fleetOf(v.asset)
            return (
              <div key={v.asset} className="vr-cal-row" style={{ gridTemplateRows: `repeat(${v.laneCount}, 46px)` }}>
                <button type="button" className="vr-cal-vcol vr-cal-vehicle" style={{ gridRow: `1 / span ${v.laneCount}` }}
                  onClick={() => { setAssetFilter(v.asset); setMoreOpen(true); setView('list') }}
                  title={`Show every booking for ${v.asset}`} aria-label={`Show every booking for ${v.asset}`}>
                  <VehicleThumb row={f || { asset_no: v.asset }} size="sm" />
                  <span><b>{v.asset}</b><small>{f?.vehicle_type || 'Type not recorded'}</small></span>
                </button>
                {grid.slots.map((s, i) => (
                  <button key={s.start} type="button" tabIndex={-1} className={`vr-cal-cell ${s.today ? 'today' : ''}`} style={{ gridColumn: i + 2, gridRow: `1 / span ${v.laneCount}` }}
                    onClick={() => bookSlot(v.asset, s)} title={`Book ${v.asset} for ${s.label}${s.sub ? ` ${s.sub}` : ''}`} aria-label={`Book ${v.asset} for ${s.label}`} />
                ))}
                {v.bars.map((b) => {
                  const r = b.row
                  const meta = VIEW_STATUS_META[b.status]
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className={`vr-bar st-${b.status} ${conflictIds.has(r.id) ? 'clash' : ''} ${b.clippedStart ? 'cut-l' : ''} ${b.clippedEnd ? 'cut-r' : ''}`}
                      style={{ gridColumn: `${b.startCol + 2} / span ${b.span}`, gridRow: b.lane + 1 }}
                      onClick={() => setDetail(r)}
                      title={`${r.asset_no}: ${r.purpose || 'Reservation'}, ${fmtShort(r.start_at)} to ${fmtShort(r.end_at)} (${meta.label})`}
                    >
                      <b>{r.purpose || 'Reservation'}{r.pickup_location ? `, ${r.pickup_location}` : ''}</b>
                      <span>{r.requester_name || 'Requester not recorded'}</span>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      <div className="vr-cal-foot">
        <div className="vr-cal-legend">
          {['active', 'upcoming', 'not_started', 'overdue', 'completed'].map((k) => (
            <button key={k} type="button" aria-pressed={viewStatus === k} onClick={() => setViewStatus((v) => (v === k ? '' : k))}><i style={{ background: VIEW_STATUS_META[k].color }} aria-hidden="true" />{VIEW_STATUS_META[k].label}</button>
          ))}
          <button type="button" aria-pressed={conflictsOnly} onClick={() => setConflictsOnly((c) => !c)}><i className="vr-clash-dot" aria-hidden="true" />Double-booked</button>
        </div>
        {(calendar.unplaced > 0) && <span className="cc-na">{calendar.unplaced} booking{calendar.unplaced === 1 ? '' : 's'} with no start time cannot be placed on the calendar (see List view).</span>}
      </div>
      {calendar.vehicles.length > CAL_PAGE && (
        <Pager page={safeCalPage} pageSize={CAL_PAGE} total={calendar.vehicles.length} onPage={setCalPage} noun="vehicles" />
      )}
    </CardState>
  )

  const viewBody = view === 'calendar' ? calendarBody
    : view === 'map' ? (
      <div className="cc-empty vr-map-empty">
        <div>
          <MapPin size={22} aria-hidden="true" /><br />
          Sites in the register have no map coordinates, so reservations cannot be placed on a map yet.
          <br /><span className="cc-na">Use the Calendar or List view to see where vehicles are booked.</span>
        </div>
      </div>
    ) : (
      <CardState state={listState} lines={6}>
        {view === 'mine' && !userId
          ? <div className="cc-empty">Could not tell who is signed in, so your reservations cannot be picked out.</div>
          : (
            <KitTable
              columns={registerColumns}
              rows={view === 'mine' ? mine : filtered}
              getRowId={(r) => String(r.id)}
              onRowClick={setDetail}
              loading={na}
              viewKey="vehicle-reservations"
              empty={view === 'mine'
                ? 'You have not created any reservations that match these filters.'
                : all.length === 0 ? 'No reservations yet. Create the first booking with the form on the right.' : 'No reservations match these filters.'}
            />
          )}
      </CardState>
    )

  return (
    <div className="cc vr-page">
      <PageHero
        title="Vehicle Reservations"
        lead="Book and allocate vehicles, equipment and assets for sites, projects and internal use"
        imgLight="/dashboard/hero-reservations-light.webp"
        imgDark="/dashboard/hero-reservations-dark.webp"
      />

      <div className="vr-toolbar">
        <button type="button" className="cc-btn-ghost" onClick={load} aria-label="Refresh reservations"><RefreshCw size={14} aria-hidden="true" /> Refresh</button>
        <button type="button" className="cc-btn-ghost" onClick={doExcel} disabled={!filtered.length}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
        <button type="button" className="cc-btn-ghost" onClick={doPdf} disabled={!filtered.length}><FileText size={14} aria-hidden="true" /> PDF</button>
        <button type="button" className="cc-btn-primary" onClick={() => startNew('single')} disabled={failed}><Plus size={15} aria-hidden="true" /> New Reservation</button>
      </div>

      {notProvisioned && (
        <Banner tone="warn" icon={AlertTriangle} title="Vehicle reservations are not enabled on this database yet.">
          Ask your administrator to enable vehicle reservations, then refresh.
        </Banner>
      )}
      {error && (
        <Banner tone="bad" icon={AlertTriangle} title="Could not load vehicle reservations." action={<button type="button" className="cc-btn-ghost" onClick={load}><RefreshCw size={14} aria-hidden="true" /> Retry</button>}>
          {error}
        </Banner>
      )}
      {actionError && (
        <Banner tone="bad" icon={AlertTriangle} title={actionError} action={<button type="button" className="cc-icon-btn" onClick={() => setActionError('')} aria-label="Dismiss message"><X size={14} /></button>} />
      )}
      {notice && (
        <Banner tone="good" icon={CalendarCheck} title={notice} action={<button type="button" className="cc-icon-btn" onClick={() => setNotice('')} aria-label="Dismiss message"><X size={14} /></button>} />
      )}

      <div className="cc-kpis vr-kpis">
        <Kpi icon={CalendarDays} tone="t-green" display={kpiVal(kpi.total)} label="Total reservations" onClick={() => setViewStatus('')} />
        <Kpi icon={CalendarCheck} tone="t-green" display={kpiVal(kpi.active)} label="Active (vehicle out)" onClick={() => setViewStatus('active')} />
        <Kpi icon={CalendarClock} tone="t-blue" display={kpiVal(kpi.upcoming)} label="Upcoming (next 7 days)" onClick={() => setViewStatus('upcoming')} />
        <Kpi icon={Clock} tone="t-red" display={kpiVal(kpi.overdue)} label="Overdue / not returned" danger={!na && kpi.overdue > 0} onClick={() => setViewStatus('overdue')} />
        <Kpi icon={Ban} tone="t-purple" display={kpiVal(kpi.cancelled)} label="Cancelled" onClick={() => setViewStatus('cancelled')} />
      </div>
      {hasFilters && !na && <p className="vr-note">These figures cover the {filtered.length} reservations matching the current filters.</p>}

      <div className="vr-layout">
        <div className="vr-main">
          <Card>
            <div className="vr-viewbar">
              <Tabs
                label="Reservation views"
                value={view}
                onChange={setView}
                tabs={[
                  { key: 'calendar', label: 'Calendar View' },
                  { key: 'list', label: 'List View', count: na ? null : filtered.length },
                  { key: 'map', label: 'Map View' },
                  { key: 'mine', label: 'My Reservations', count: na || !userId ? null : mine.length },
                ]}
              />
              {view === 'calendar' && (
                <div className="vr-nav">
                  <button type="button" className="cc-icon-btn" aria-label="Previous period" onClick={() => { setAnchor((a) => shiftAnchor(a, calMode, -1)); setCalPage(0) }}><ChevronLeft size={15} /></button>
                  <span className="vr-range">{grid.label}</span>
                  <button type="button" className="cc-icon-btn" aria-label="Next period" onClick={() => { setAnchor((a) => shiftAnchor(a, calMode, 1)); setCalPage(0) }}><ChevronRight size={15} /></button>
                  <button type="button" className="cc-btn-ghost" onClick={() => setAnchor(Date.now())}>Today</button>
                  <div className="vr-seg" role="group" aria-label="Calendar range">
                    {['day', 'week', 'month'].map((m) => (
                      <button key={m} type="button" aria-pressed={calMode === m} onClick={() => setCalMode(m)}>{m[0].toUpperCase() + m.slice(1)}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="cc-filters vr-filters">
              <select className="cc-select" aria-label="Vehicle type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} disabled={!typeOptions.length} title={typeOptions.length ? undefined : 'Vehicle types come from the fleet register'}>
                <option value="">All vehicle types</option>
                {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select className="cc-select" aria-label="Location" value={locFilter} onChange={(e) => setLocFilter(e.target.value)}>
                <option value="">All locations</option>
                {locOptions.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <select className="cc-select" aria-label="Status" value={viewStatus} onChange={(e) => setViewStatus(e.target.value)}>
                <option value="">All status</option>
                {VIEW_STATUSES.map((s) => <option key={s} value={s}>{VIEW_STATUS_META[s].label}</option>)}
              </select>
              <select className="cc-select" aria-label="Booked by" value={requesterFilter} onChange={(e) => setRequesterFilter(e.target.value)}>
                <option value="">All booked by</option>
                {requesterOptions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <div className="cc-search">
                <Search size={14} aria-hidden="true" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by vehicle, requester, reference, purpose" aria-label="Search reservations" />
              </div>
              <button type="button" className="cc-btn-ghost" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}><SlidersHorizontal size={14} aria-hidden="true" /> More Filters</button>
              {hasFilters && <button type="button" className="cc-btn-ghost" onClick={clearFilters}><X size={13} aria-hidden="true" /> Clear</button>}
            </div>
            {moreOpen && (
              <div className="cc-filters vr-more">
                <label className="cc-field"><span>Asset</span>
                  <select className="cc-select" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)}>
                    <option value="">All assets</option>
                    {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select></label>
                <label className="cc-field"><span>Department</span>
                  <select className="cc-select" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
                    <option value="">All departments</option>
                    {deptOptions.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select></label>
                <label className="cc-field"><span>Workflow status</span>
                  <select className="cc-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="">All workflow statuses</option>
                    {RESERVATION_STATUSES.map((s) => <option key={s} value={s}>{RESERVATION_STATUS_LABEL[s]}</option>)}
                  </select></label>
                <label className="cc-field"><span>Pickup from</span>
                  <input type="date" className="cc-select" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
                <label className="cc-field"><span>Pickup to</span>
                  <input type="date" className="cc-select" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
                <label className="vr-check"><input type="checkbox" checked={conflictsOnly} onChange={(e) => setConflictsOnly(e.target.checked)} /> Only double-booked</label>
                <label className="vr-check"><input type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} /> Only overdue returns</label>
              </div>
            )}

            {viewBody}
          </Card>

          {!na && conflicts.length > 0 && (
            <Card title={`${conflicts.length} double-booking${conflicts.length === 1 ? '' : 's'} detected`} sub="Same vehicle booked over overlapping times. Reschedule, reassign a vehicle, or cancel one booking."
              action={<ViewAll label="Show only double-booked" onClick={() => { setConflictsOnly(true); setView('list') }} />}>
              <ul className="vr-clash-list">
                {conflicts.slice(0, 6).map((c, i) => (
                  <li key={i}>
                    <AlertTriangle size={13} aria-hidden="true" />
                    <b>{c.a.asset_no}</b>
                    <button type="button" className="vr-link-btn" onClick={() => setDetail(c.a)}>{c.a.requester_name || c.a.reference || 'Reservation'} ({fmtShort(c.a.start_at)} to {fmtShort(c.a.end_at)})</button>
                    <em>overlaps</em>
                    <button type="button" className="vr-link-btn" onClick={() => setDetail(c.b)}>{c.b.requester_name || c.b.reference || 'Reservation'} ({fmtShort(c.b.start_at)} to {fmtShort(c.b.end_at)})</button>
                  </li>
                ))}
              </ul>
              {conflicts.length > 6 && <p className="cc-na">{conflicts.length - 6} more pairs are flagged in the List view.</p>}
            </Card>
          )}

          <div className="vr-row2">
            <Card title="Upcoming Reservations" sub="Bookings out now or starting next, soonest first." action={<ViewAll label="View all" onClick={() => { setView('list'); document.querySelector('.vr-viewbar')?.scrollIntoView({ behavior: 'smooth' }) }} />}>
              <CardState state={listState} lines={5} empty={!na && upcoming.length === 0 ? 'No open or upcoming bookings.' : null}>
                <KitTable compact columns={upcomingColumns} rows={upcoming} getRowId={(r) => String(r.id)} onRowClick={setDetail} empty="No open or upcoming bookings." />
              </CardState>
            </Card>
            <Card title="Reservation Summary" sub="Status read from the workflow and the clock.">
              <CardState state={listState} lines={4} empty={!na && filtered.length === 0 ? 'No reservations to summarise.' : null}>
                <Donut segments={segments} total={filtered.length} centerLabel="Total" onSelect={(s) => setViewStatus(s.key)} />
              </CardState>
            </Card>
          </div>

          <div className="vr-row3">
            <Card title="Booking health" sub="Approvals, clashes and time booked.">
              <CardState state={listState} lines={4}>
                <div className="vr-health">
                  <button type="button" onClick={() => { setStatusFilter('requested'); setMoreOpen(true); setView('list') }} title="Show reservations waiting for approval"><b className={health.pendingApproval ? 'vr-warn' : ''}>{kpiVal(health.pendingApproval)}</b><span>Pending approval</span></button>
                  <button type="button" onClick={() => { setConflictsOnly(true); setMoreOpen(true); setView('list') }} title="Show double-booked reservations"><b className={health.conflictCount ? 'vr-bad' : ''}>{kpiVal(health.conflictCount)}</b><span>Double-booked pairs</span></button>
                  <div><b>{na ? 'N/A' : fmtHours(health.bookedHours)}</b><span>Booked time{health.avgDurationHours != null ? `, average ${fmtHours(health.avgDurationHours)}` : ''}</span></div>
                  <div><b>{na || health.cancellationRate == null ? 'N/A' : `${health.cancellationRate}%`}</b><span>Cancellation rate</span></div>
                  <button type="button" onClick={() => setView('list')} title="Open the list of bookings"><b>{kpiVal(health.distinctAssets)}</b><span>Vehicles booked</span></button>
                  <div><b>{na || health.expectedKm == null ? 'N/A' : `${fmtInt(health.expectedKm)} km`}</b><span>Expected distance</span></div>
                </div>
              </CardState>
            </Card>
            <Card title="Bookings per month" sub="Last 12 months by pickup date.">
              <CardState state={listState} lines={4} empty={!na && trendTotal === 0 ? 'No pickups dated in the last 12 months.' : null}>
                <div className="vr-months" role="img" aria-label={trend.map((m) => `${m.month}: ${m.bookings} booked, ${m.cancelled} cancelled`).join('; ')}>
                  {trend.map((m) => (
                    <button type="button" key={m.month} className="vr-month" onClick={() => pickMonth(m.month)} aria-label={`Show pickups in ${m.month}: ${m.bookings} booked, ${m.cancelled} cancelled`} title={`${m.month}: ${m.bookings} booked, ${m.cancelled} cancelled. Click to filter.`}>
                      <div className="vr-month-bar">
                        <i className="c" style={{ height: `${(m.cancelled / trendMax) * 100}%` }} />
                        <i className="b" style={{ height: `${(m.bookings / trendMax) * 100}%` }} />
                      </div>
                      <span>{m.month.slice(5)}</span>
                    </button>
                  ))}
                </div>
                <div className="vr-cal-legend"><span><i style={{ background: 'var(--cc-green)' }} />Booked</span><span><i style={{ background: 'var(--cc-ink-3)' }} />Cancelled</span></div>
              </CardState>
            </Card>
            <Card title="Demand by department" sub="Bookings excluding cancelled.">
              <CardState state={listState} lines={4} empty={!na && demand.length === 0 ? 'No active bookings to rank.' : null}>
                <ul className="vr-demand">
                  {demand.map((d) => (
                    <li key={d.department}>
                      <button type="button" aria-pressed={deptFilter === d.department} onClick={() => { setDeptFilter((x) => (x === d.department ? '' : d.department)); setMoreOpen(true) }} title={`Filter to ${d.department}`}>
                        <span className="vr-demand-name">{d.department}</span>
                        <span className="cc-bar-track"><i style={{ width: `${(d.bookings / demandMax) * 100}%`, background: 'var(--cc-green)' }} /></span>
                        <b>{d.bookings}</b>
                        <small>{fmtHours(d.hours)}</small>
                      </button>
                    </li>
                  ))}
                </ul>
              </CardState>
            </Card>
          </div>
        </div>

        <aside className="vr-rail">
          <Card title={editing ? 'Edit Reservation' : 'New Reservation'} className="vr-form-card"
            action={editing ? <button type="button" className="cc-icon-btn" onClick={() => resetForm()} aria-label="Stop editing"><X size={14} /></button> : null}>
            <form id="vr-form" onSubmit={submit} noValidate className="vr-form">
              {!editing && (
                <div className="vr-seg vr-seg-wide" role="group" aria-label="Booking type">
                  <button type="button" aria-pressed={bookMode === 'single'} onClick={() => { setBookMode('single'); setBookAnyway(false) }}>Single Booking</button>
                  <button type="button" aria-pressed={bookMode === 'multiple'} onClick={() => { setBookMode('multiple'); setBookAnyway(false) }}>Multiple Booking</button>
                </div>
              )}
              <datalist id="vr-fleet-assets">
                {fleet.slice(0, 3000).map((a) => <option key={a.id || a.asset_no} value={a.asset_no}>{[a.vehicle_type, a.site].filter(Boolean).join(', ')}</option>)}
              </datalist>
              <datalist id="vr-drivers">
                {drivers.slice(0, 3000).map((d) => <option key={d.id} value={d.driver_name}>{[d.driver_id, d.site].filter(Boolean).join(', ')}</option>)}
              </datalist>
              <datalist id="vr-sites">
                {[...new Set([...siteOptions, ...locOptions])].map((s) => <option key={s} value={s} />)}
              </datalist>

              {bookMode === 'single' ? (
                <label className="vr-lbl"><span>Vehicle / asset <em>*</em></span>
                  <input id="vr-asset" className="vr-input" list="vr-fleet-assets" required placeholder="Select vehicle or asset" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </label>
              ) : (
                <div className="vr-lbl"><span>Vehicles / assets <em>*</em></span>
                  <div className="vr-multi">
                    <input id="vr-asset" className="vr-input" list="vr-fleet-assets" placeholder="Add a vehicle" value={multiInput} maxLength={120}
                      onChange={(e) => setMultiInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addMulti() } }} aria-label="Add a vehicle" />
                    <button type="button" className="cc-btn-ghost" onClick={addMulti}><Plus size={13} aria-hidden="true" /> Add</button>
                  </div>
                  {multiAssets.length > 0 && (
                    <div className="vr-chips">
                      {multiAssets.map((a) => (
                        <span key={a} className="vr-chip">{a}<button type="button" onClick={() => setMultiAssets((m) => m.filter((x) => x !== a))} aria-label={`Remove ${a}`}><X size={11} /></button></span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {fleetCard.error && <p className="vr-hint">The fleet register could not be read, so vehicles are typed by asset number. <button type="button" className="cc-link-btn cc-link" onClick={fleetCard.retry}>Retry</button></p>}
              {selectedFleet && (
                <div className="vr-picked">
                  <VehicleThumb row={selectedFleet} size="sm" />
                  <span><b>{selectedFleet.asset_no}</b><small>{[selectedFleet.vehicle_type, selectedFleet.make, selectedFleet.site].filter(Boolean).join(', ') || 'No details recorded'}</small></span>
                </div>
              )}
              {bookMode === 'single' && form.asset_no.trim() && !selectedFleet && !fleetCard.loading && !fleetCard.error && (
                <p className="vr-hint">This asset number is not in the fleet register for this country.</p>
              )}

              <div className="vr-2col">
                <label className="vr-lbl"><span>Start date and time {!editing && <em>*</em>}</span>
                  <input className="vr-input" type="datetime-local" value={form.start_at} onChange={(e) => set('start_at', e.target.value)} /></label>
                <label className="vr-lbl"><span>End date and time {!editing && <em>*</em>}</span>
                  <input className="vr-input" type="datetime-local" value={form.end_at} onChange={(e) => set('end_at', e.target.value)} /></label>
              </div>

              <label className="vr-lbl"><span>Pickup location</span>
                <input className="vr-input" list="vr-sites" placeholder="Select or type a site" value={form.pickup_location} maxLength={200} onChange={(e) => set('pickup_location', e.target.value)} /></label>
              <div className="vr-2col">
                <label className="vr-lbl"><span>Requester</span>
                  <input className="vr-input" placeholder="Who needs the vehicle" value={form.requester_name} maxLength={200} onChange={(e) => set('requester_name', e.target.value)} /></label>
                <label className="vr-lbl"><span>Department</span>
                  <input className="vr-input" placeholder="e.g. Operations" value={form.department} maxLength={200} onChange={(e) => set('department', e.target.value)} /></label>
              </div>
              <div className="vr-2col">
                <label className="vr-lbl"><span>Driver</span>
                  <input className="vr-input" list="vr-drivers" placeholder="Pick from the driver register" value={form.driver_name} maxLength={200}
                    onChange={(e) => { const name = e.target.value; const d = driverByName.get(name.trim().toUpperCase()); setForm((f) => ({ ...f, driver_name: name, driver_id: d?.id || '' })) }} /></label>
                <label className="vr-lbl"><span>Project</span>
                  <input className="vr-input" placeholder="Project or job" value={form.project} maxLength={200} onChange={(e) => set('project', e.target.value)} /></label>
              </div>
              {form.driver_name.trim() && !form.driver_id && !driversCard.loading && (
                <p className="vr-hint">{driversCard.error ? 'The driver register could not be read, so the name is saved as typed.' : 'This name is not in the driver register; it is saved as typed.'}</p>
              )}
              <label className="vr-lbl"><span>Purpose / remark</span>
                <textarea className="vr-input" rows={2} placeholder="Enter purpose of reservation" value={form.purpose} maxLength={500} onChange={(e) => set('purpose', e.target.value)} /></label>
              <label className="vr-lbl"><span>Reference no.</span>
                <input className="vr-input" placeholder="Optional" value={form.reference} maxLength={120} onChange={(e) => set('reference', e.target.value)} /></label>

              <button type="button" className="cc-link cc-link-btn vr-more-toggle" aria-expanded={showMore} onClick={() => setShowMore((s) => !s)}>
                {showMore ? 'Fewer details' : 'More details: status, cost centre, return location, distance, notes'}
              </button>
              {showMore && (
                <>
                  <div className="vr-2col">
                    <label className="vr-lbl"><span>Workflow status</span>
                      <select className="vr-input" value={form.status} onChange={(e) => set('status', e.target.value)}>
                        {RESERVATION_STATUSES.map((s) => <option key={s} value={s}>{RESERVATION_STATUS_LABEL[s]}</option>)}
                      </select></label>
                    <label className="vr-lbl"><span>Expected km</span>
                      <input className="vr-input" type="number" min="0" step="1" inputMode="numeric" value={form.expected_km} onChange={(e) => set('expected_km', e.target.value)} /></label>
                  </div>
                  <label className="vr-lbl"><span>Cost centre</span>
                    <input className="vr-input" value={form.cost_centre} maxLength={120} onChange={(e) => set('cost_centre', e.target.value)} /></label>
                  <label className="vr-lbl"><span>Return location</span>
                    <input className="vr-input" list="vr-sites" value={form.return_location} maxLength={200} onChange={(e) => set('return_location', e.target.value)} /></label>
                  <label className="vr-lbl"><span>Approved by</span>
                    <input className="vr-input" value={form.approved_by} maxLength={200} onChange={(e) => set('approved_by', e.target.value)} /></label>
                  <label className="vr-lbl"><span>Notes</span>
                    <textarea className="vr-input" rows={2} value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} /></label>
                </>
              )}

              {form.start_at && form.end_at && targetAssets.length > 0 && (
                clashes.length ? (
                  <div className="vr-clash-box" role="alert">
                    <b><AlertTriangle size={14} aria-hidden="true" /> Clashes with {clashes.length} existing booking{clashes.length === 1 ? '' : 's'}</b>
                    <ul>
                      {clashes.slice(0, 4).map(({ asset, hit }) => (
                        <li key={`${asset}-${hit.id}`}>{asset}: {hit.purpose || hit.requester_name || 'Reservation'}, {fmtShort(hit.start_at)} to {fmtShort(hit.end_at)}</li>
                      ))}
                    </ul>
                    <label className="vr-check"><input type="checkbox" checked={bookAnyway} onChange={(e) => setBookAnyway(e.target.checked)} /> Save anyway (it will be flagged as a double-booking)</label>
                  </div>
                ) : <p className="vr-ok"><CalendarCheck size={13} aria-hidden="true" /> No clash with existing bookings.</p>
              )}

              <p className="vr-hint"><Info size={12} aria-hidden="true" /> {NOT_RECORDED}</p>
              {formError && <p className="vr-form-error" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {formError}</p>}
              <div className="vr-form-actions">
                <button type="button" className="cc-btn-ghost" onClick={() => resetForm(bookMode)} disabled={saving}>Cancel</button>
                <button type="submit" className="cc-btn-primary" disabled={saving || failed}>
                  {saving ? <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Saving</> : editing ? 'Save changes' : bookMode === 'multiple' ? (multiAssets.length ? `Create ${multiAssets.length} Reservations` : 'Create Reservations') : 'Create Reservation'}
                </button>
              </div>
            </form>
          </Card>

          <Card title="Quick Actions">
            <div className="vr-quick">
              <button type="button" onClick={() => startNew('single')} disabled={failed}><CalendarDays size={17} aria-hidden="true" /><span><b>New reservation</b><small>Book a vehicle or asset</small></span></button>
              <button type="button" onClick={() => startNew('multiple')} disabled={failed}><Layers size={17} aria-hidden="true" /><span><b>Bulk reservation</b><small>Several vehicles at once</small></span></button>
              <button type="button" onClick={() => setImportOpen(true)} disabled={failed}><Upload size={17} aria-hidden="true" /><span><b>Import reservations</b><small>Upload from Excel or CSV</small></span></button>
              <button type="button" onClick={() => setAvailOpen(true)} disabled={failed}><SearchCheck size={17} aria-hidden="true" /><span><b>Availability check</b><small>Find free vehicles</small></span></button>
              <button type="button" onClick={doExcel} disabled={!filtered.length}><FileSpreadsheet size={17} aria-hidden="true" /><span><b>Reservation report</b><small>Download the filtered register</small></span></button>
            </div>
          </Card>
        </aside>
      </div>

      {detail && (
        <ReservationDrawer
          row={detail}
          fleet={fleetOf(detail.asset_no)}
          now={asOf}
          elevated={elevated}
          conflicted={conflictIds.has(detail.id)}
          onClose={() => setDetail(null)}
          onEdit={openEdit}
          onDelete={(r) => { setConfirmDelete(r); setDetail(null) }}
          onChanged={async (updated) => { if (updated) setDetail(updated); setNotice('Reservation updated.'); await load() }}
        />
      )}

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

      {availOpen && <AvailabilityModal onClose={() => setAvailOpen(false)} fleetCard={fleetCard} rows={all} onBook={(asset, from, to) => {
        setAvailOpen(false); resetForm('single')
        setForm({ ...EMPTY_FORM, asset_no: asset, start_at: from, end_at: to })
        document.getElementById('vr-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }} />}
      {importOpen && <ImportModal onClose={() => setImportOpen(false)} rows={all} country={activeCountry} onDone={async (msg) => { setNotice(msg); await load() }} />}
    </div>
  )
}

/** Free vehicles for a window, from the fleet register and live bookings. */
function AvailabilityModal({ onClose, fleetCard, rows, onBook }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [q, setQ] = useState('')
  const result = useMemo(() => (from && to ? availability(fleetCard.data || [], rows, { from, to }) : null), [from, to, fleetCard.data, rows])
  const free = useMemo(() => {
    const s = q.trim().toLowerCase()
    const list = result?.free || []
    return s ? list.filter((a) => `${a.asset_no} ${a.vehicle_type || ''} ${a.site || ''}`.toLowerCase().includes(s)) : list
  }, [result, q])
  return (
    <Modal open onClose={onClose} title="Availability check" size="lg">
      <div className="cc vr-modal">
        <div className="vr-2col">
          <label className="vr-lbl"><span>From</span><input className="vr-input" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="vr-lbl"><span>To</span><input className="vr-input" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <CardState state={fleetCard} lines={3}>
          {!from || !to ? <div className="cc-empty">Pick a start and end time to see which vehicles are free.</div>
            : !result ? <div className="cc-empty">The end must be after the start.</div> : (
              <>
                <p className="vr-note">{fmtInt(result.free.length)} free and {fmtInt(result.booked.length)} booked of {fmtInt(result.free.length + result.booked.length)} vehicles in the fleet register.</p>
                <div className="cc-search" style={{ margin: '8px 0' }}>
                  <Search size={14} aria-hidden="true" />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter free vehicles by asset, type or site" aria-label="Filter free vehicles" />
                </div>
                <ul className="vr-avail">
                  {free.slice(0, 60).map((a) => (
                    <li key={a.id || a.asset_no}>
                      <VehicleThumb row={a} size="sm" />
                      <span><b>{a.asset_no}</b><small>{[a.vehicle_type, a.site].filter(Boolean).join(', ') || 'No details recorded'}</small></span>
                      <button type="button" className="cc-btn" onClick={() => onBook(a.asset_no, from, to)}>Book</button>
                    </li>
                  ))}
                </ul>
                {free.length > 60 && <p className="cc-na">{free.length - 60} more free vehicles. Narrow the filter to find one.</p>}
                {free.length === 0 && <div className="cc-empty">No free vehicles match.</div>}
              </>
            )}
        </CardState>
      </div>
    </Modal>
  )
}

/** Import reservations from a spreadsheet; each row is clash-checked and saved one by one. */
function ImportModal({ onClose, rows, country, onDone }) {
  const [parsed, setParsed] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [progress, setProgress] = useState(null)

  const onFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setErr(''); setParsed(null); setBusy(true)
    try {
      const { parseWorkbook } = await import('../lib/import/parseWorkbook')
      const wb = await parseWorkbook(file, { fileName: file.name })
      const sheetRows = wb.sheets?.[0]?.rows || []
      const mapped = sheetRows.map((r, i) => ({ line: i + 2, ...mapImportRow(r) }))
      const ok = mapped.filter((m) => m.values)
      const clashing = ok.filter((m) => m.values.start_at && m.values.end_at && clashesFor(m.values, rows).length > 0)
      setParsed({ total: mapped.length, ok, bad: mapped.filter((m) => m.error), clashing: clashing.length })
    } catch (ex) {
      setErr(toUserMessage(ex, 'Could not read this file.'))
    } finally {
      setBusy(false)
    }
  }

  const run = async () => {
    if (!parsed?.ok.length) return
    setBusy(true); setErr('')
    let made = 0
    const failures = []
    for (let i = 0; i < parsed.ok.length; i++) {
      setProgress(`${i + 1} of ${parsed.ok.length}`)
      const m = parsed.ok[i]
      try {
        await createVehicleReservation({ ...m.values, country: country !== 'All' ? country : null })
        made += 1
      } catch {
        failures.push(m.line)
      }
    }
    setBusy(false); setProgress(null)
    await onDone(`Imported ${made} of ${parsed.ok.length} reservations.${failures.length ? ` Rows not saved: ${failures.slice(0, 10).join(', ')}${failures.length > 10 ? ' and more' : ''}.` : ''}`)
    onClose()
  }

  return (
    <Modal open onClose={() => { if (!busy) onClose() }} title="Import reservations" size="md"
      footer={
        <>
          <button type="button" className="btn-secondary text-sm min-h-[44px]" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn-primary text-sm min-h-[44px] disabled:opacity-60" onClick={run} disabled={busy || !parsed?.ok.length}>
            {progress ? `Importing ${progress}` : `Import ${parsed?.ok.length || ''} reservations`}
          </button>
        </>
      }>
      <div className="cc vr-modal">
        <p className="vr-note">Upload an Excel or CSV file with one reservation per row. Recognised columns: {IMPORT_TEMPLATE_HEADERS.join(', ')}. Asset is required; each row is checked and saved like a booking made by hand.</p>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={onFile} disabled={busy} aria-label="Reservation file" />
        {busy && !progress && <p className="vr-note">Reading the file...</p>}
        {err && <p className="vr-form-error" role="alert"><AlertTriangle size={14} aria-hidden="true" /> {err}</p>}
        {parsed && (
          <div className="vr-health" style={{ marginTop: 10 }}>
            <div><b>{fmtInt(parsed.total)}</b><span>Rows read</span></div>
            <div><b>{fmtInt(parsed.ok.length)}</b><span>Ready to import</span></div>
            <div><b className={parsed.bad.length ? 'vr-bad' : ''}>{fmtInt(parsed.bad.length)}</b><span>Skipped</span></div>
            <div><b className={parsed.clashing ? 'vr-warn' : ''}>{fmtInt(parsed.clashing)}</b><span>Clash with existing bookings (imported and flagged)</span></div>
          </div>
        )}
        {parsed?.bad.length > 0 && (
          <ul className="vr-import-bad">
            {parsed.bad.slice(0, 8).map((b) => <li key={b.line}>Row {b.line}: {b.error}</li>)}
          </ul>
        )}
      </div>
    </Modal>
  )
}
