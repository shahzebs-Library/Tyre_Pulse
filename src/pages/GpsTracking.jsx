/**
 * GpsTracking (route /gps-tracking) - GPS Tracking / Position History. Captures
 * time-series GPS position pings per asset (telematics feeds, manual entry or
 * ERP), so movement, location, speed, idle time and route history can be
 * reconstructed. Every ping is org-isolated and country-scoped.
 *
 * Runs on the `gps_positions` table (V171). The distance and snapshot maths
 * live in `src/lib/gpsPositions.js`; everything the page derives on top (per
 * asset tracks, staleness, overspeed, coordinate coverage, filters) lives in
 * the pure, tested `src/lib/gpsTrackingAnalytics.js`. Every figure covers the
 * pings matching the current filters, and the page says so.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  MapPin, Navigation, Activity, Truck, AlertTriangle, Search, X,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, Power, RefreshCw, Gauge,
  Satellite, Milestone, Clock,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import StatTile from '../components/ui/StatTile'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import {
  listGpsPositions, createGpsPosition, updateGpsPosition, deleteGpsPosition,
} from '../lib/api/gpsPositions'
import { toFiniteNumber } from '../lib/gpsPositions'
import {
  filterPositions, assetTracks, gpsKpis, stateMix, motionOf, MOTION_LABEL,
  OVERSPEED_OPTIONS, DEFAULT_OVERSPEED_KMH, DEFAULT_STALE_HOURS,
} from '../lib/gpsTrackingAnalytics'
import { exportToExcel, exportToPdf, reportFileName, reportDateLabel } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

const EMPTY_FORM = {
  asset_no: '', driver_name: '', latitude: '', longitude: '', speed_kmh: '',
  heading: '', altitude_m: '', ignition: false, odometer_km: '', recorded_at: '',
  address: '', notes: '',
}

const WINDOW_OPTIONS = [
  { value: '1', label: 'Last 24 hours' },
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
]

const MOTION_BADGE = {
  moving: 'bg-green-900/30 text-green-300 border-green-800/50',
  idle: 'bg-amber-900/30 text-amber-300 border-amber-800/50',
  stopped: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--input-border)]',
}

const fmtSpeed = (v) => (v == null || v === '' ? 'N/A' : `${Number(v).toLocaleString()} km/h`)
const fmtKm = (v) => (v == null ? 'N/A' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`)
const fmtPct = (v) => (v == null ? 'N/A' : `${v}%`)

function fmtLatLng(lat, lng) {
  const a = toFiniteNumber(lat)
  const b = toFiniteNumber(lng)
  if (a == null || b == null) return 'N/A'
  return `${a.toFixed(5)}, ${b.toFixed(5)}`
}

function fmtDateTime(v) {
  if (v == null || v === '') return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleString()
}

function fmtAge(hours) {
  if (hours == null) return 'N/A'
  if (hours < 1) return `${Math.round(hours * 60)} min ago`
  if (hours < 48) return `${Math.round(hours)} h ago`
  return `${Math.round(hours / 24)} d ago`
}

function MotionBadge({ state }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${MOTION_BADGE[state] || MOTION_BADGE.stopped}`}>
      {MOTION_LABEL[state] || 'Stopped'}
    </span>
  )
}

const ICON_BTN = 'inline-flex items-center justify-center min-w-[44px] min-h-[44px] rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]'
const DAY_MS = 86_400_000

export default function GpsTracking() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  const [windowSel, setWindowSel] = useState('all')
  const [assetFilter, setAssetFilter] = useState('')
  const [motionFilter, setMotionFilter] = useState('')
  const [overspeedKmh, setOverspeedKmh] = useState(DEFAULT_OVERSPEED_KMH)
  const [overspeedOnly, setOverspeedOnly] = useState(false)
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
      const data = await listGpsPositions({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
      setNowMs(Date.now())
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load GPS positions.')); setRows(null) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const loading = rows === null && !error
  const all = useMemo(() => rows || [], [rows])
  const assetOptions = useMemo(() => [...new Set(all.map((r) => r.asset_no).filter(Boolean))].sort(), [all])

  const fromMs = windowSel === 'all' ? null : nowMs - Number(windowSel) * DAY_MS
  const filtered = useMemo(() => filterPositions(all, {
    asset: assetFilter, motion: motionFilter, search, fromMs, overspeedOnly, overspeedKmh,
  }), [all, assetFilter, motionFilter, search, fromMs, overspeedOnly, overspeedKmh])

  const trackOpts = useMemo(() => ({ now: nowMs, overspeedKmh, staleHours: DEFAULT_STALE_HOURS }), [nowMs, overspeedKmh])
  const kpis = useMemo(() => gpsKpis(filtered, trackOpts), [filtered, trackOpts])
  const tracks = useMemo(() => assetTracks(filtered, trackOpts), [filtered, trackOpts])
  const mix = useMemo(() => stateMix(filtered), [filtered])

  const hasFilters = windowSel !== 'all' || assetFilter || motionFilter || overspeedOnly || search
  const clearFilters = () => {
    setWindowSel('all'); setAssetFilter(''); setMotionFilter(''); setOverspeedOnly(false); setSearch('')
  }

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['asset_no', 'driver_name', 'state', 'latitude', 'longitude', 'speed_kmh', 'heading', 'ignition', 'odometer_km', 'recorded_at', 'address']
  const EXPORT_HEADERS = ['Asset', 'Driver', 'State', 'Latitude', 'Longitude', 'Speed (km/h)', 'Heading', 'Ignition', 'Odometer (km)', 'Recorded at', 'Address']
  const exportRows = () => filtered.map((r) => ({
    asset_no: r.asset_no || '', driver_name: r.driver_name || '', state: MOTION_LABEL[motionOf(r)],
    latitude: r.latitude ?? '', longitude: r.longitude ?? '',
    speed_kmh: r.speed_kmh ?? '', heading: r.heading ?? '',
    ignition: r.ignition == null ? '' : r.ignition ? 'On' : 'Off',
    odometer_km: r.odometer_km ?? '', recorded_at: r.recorded_at || '', address: r.address || '',
  }))
  const fileName = () => reportFileName('TyrePulse GPS Position History', activeCountry !== 'All' ? activeCountry : null, reportDateLabel())
  const doExcel = async () => {
    setActionError('')
    try { await exportToExcel(exportRows(), EXPORT_COLS, EXPORT_HEADERS, fileName()) }
    catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }
  const doPdf = async () => {
    setActionError('')
    try { await exportToPdf(exportRows(), EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'GPS Tracking: Position History', fileName(), 'landscape') }
    catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true) }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      asset_no: r.asset_no || '', driver_name: r.driver_name || '',
      latitude: r.latitude ?? '', longitude: r.longitude ?? '',
      speed_kmh: r.speed_kmh ?? '', heading: r.heading ?? '',
      altitude_m: r.altitude_m ?? '', ignition: r.ignition === true,
      odometer_km: r.odometer_km ?? '',
      recorded_at: r.recorded_at ? String(r.recorded_at).slice(0, 16) : '',
      address: r.address || '', notes: r.notes || '',
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
      const payload = { ...form, country: activeCountry !== 'All' ? activeCountry : null }
      if (editing) await updateGpsPosition(editing.id, payload)
      else await createGpsPosition(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the position.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteGpsPosition(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the position.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  // ── Columns ──────────────────────────────────────────────────────────────
  const trackColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (t) => t.asset_no, cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no}</span> },
    { id: 'driver', header: 'Driver', accessorFn: (t) => t.driver_name || '', cell: ({ row }) => row.original.driver_name || 'N/A' },
    { id: 'state', header: 'State', accessorFn: (t) => MOTION_LABEL[t.state], cell: ({ row }) => <MotionBadge state={row.original.state} /> },
    {
      id: 'lastSeen', header: 'Last seen', accessorFn: (t) => t.lastSeenMs, meta: { exportValue: (t) => (t.lastSeenMs ? new Date(t.lastSeenMs).toISOString() : '') },
      cell: ({ row }) => {
        const t = row.original
        return (
          <span className="inline-flex items-center gap-1.5">
            {fmtAge(t.lastSeenHours)}
            {t.stale && <span className="rounded-full border border-amber-800/50 bg-amber-900/30 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">Stale</span>}
          </span>
        )
      },
    },
    { id: 'pings', header: 'Pings', accessorFn: (t) => t.pings, meta: { align: 'right' } },
    { id: 'distance', header: 'Distance', accessorFn: (t) => t.distanceKm, meta: { align: 'right' }, cell: ({ row }) => fmtKm(row.original.distanceKm) },
    { id: 'avgSpeed', header: 'Avg moving speed', accessorFn: (t) => t.avgMovingSpeedKmh, meta: { align: 'right' }, cell: ({ row }) => fmtSpeed(row.original.avgMovingSpeedKmh) },
    { id: 'maxSpeed', header: 'Max speed', accessorFn: (t) => t.maxSpeedKmh, meta: { align: 'right' }, cell: ({ row }) => fmtSpeed(row.original.maxSpeedKmh) },
    {
      id: 'overspeed', header: `Over ${overspeedKmh} km/h`, accessorFn: (t) => t.overspeedPings, meta: { align: 'right' },
      cell: ({ row }) => <span className={row.original.overspeedPings > 0 ? 'text-red-400 font-semibold' : ''}>{row.original.overspeedPings}</span>,
    },
    { id: 'coords', header: 'Last coordinates', accessorFn: (t) => fmtLatLng(t.latitude, t.longitude), cell: ({ row }) => <span className="font-mono text-xs">{fmtLatLng(row.original.latitude, row.original.longitude)}</span> },
  ], [overspeedKmh])

  const pingColumns = useMemo(() => [
    { id: 'asset', header: 'Asset', accessorFn: (r) => r.asset_no || '', cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.asset_no || 'N/A'}</span> },
    { id: 'driver', header: 'Driver', accessorFn: (r) => r.driver_name || '', cell: ({ row }) => row.original.driver_name || 'N/A' },
    { id: 'state', header: 'State', accessorFn: (r) => MOTION_LABEL[motionOf(r)], cell: ({ row }) => <MotionBadge state={motionOf(row.original)} /> },
    {
      id: 'speed', header: 'Speed', accessorFn: (r) => toFiniteNumber(r.speed_kmh), meta: { align: 'right' },
      cell: ({ row }) => {
        const spd = toFiniteNumber(row.original.speed_kmh)
        return <span className={spd != null && spd > overspeedKmh ? 'text-red-400 font-semibold' : ''}>{fmtSpeed(row.original.speed_kmh)}</span>
      },
    },
    { id: 'coords', header: 'Coordinates', accessorFn: (r) => fmtLatLng(r.latitude, r.longitude), cell: ({ row }) => <span className="font-mono text-xs">{fmtLatLng(row.original.latitude, row.original.longitude)}</span> },
    { id: 'heading', header: 'Heading', accessorFn: (r) => toFiniteNumber(r.heading), meta: { align: 'right' }, cell: ({ row }) => (toFiniteNumber(row.original.heading) == null ? 'N/A' : `${Number(row.original.heading).toFixed(0)} deg`) },
    { id: 'recorded', header: 'Recorded at', accessorFn: (r) => r.recorded_at || '', cell: ({ row }) => fmtDateTime(row.original.recorded_at) },
    { id: 'address', header: 'Address', accessorFn: (r) => r.address || '', cell: ({ row }) => row.original.address || 'N/A' },
    {
      id: 'actions', header: '', enableSorting: false, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(row.original)} className={ICON_BTN} aria-label={`Edit position for ${row.original.asset_no || 'asset'}`}><Pencil size={15} /></button>
          <button type="button" onClick={() => setConfirmDelete(row.original)} className={`${ICON_BTN} hover:!text-red-400`} aria-label={`Delete position for ${row.original.asset_no || 'asset'}`}><Trash2 size={15} /></button>
        </div>
      ),
    },
  ], [openEdit, overspeedKmh])

  const na = (v) => (rows === null ? 'N/A' : v)
  const mixTotal = mix.moving + mix.idle + mix.stopped

  return (
    <div className="space-y-6">
      <PageHeader
        title="GPS Tracking"
        subtitle="Position history per asset: where each vehicle is, how fast it moves, how long it idles, and how far it travelled."
        icon={MapPin}
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
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned || !!error}>
              <Plus size={14} aria-hidden="true" /> Log position
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">GPS tracking is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V171_GPS_POSITIONS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex flex-wrap items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-[200px]">
            <p className="text-red-300 font-medium">Could not load GPS positions.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error} Nothing below is a reading of your data until this loads.</p>
          </div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {actionError && (
        <div className="card border border-red-800/50 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="flex-1 text-sm text-red-300">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className={ICON_BTN} aria-label="Dismiss message"><X size={15} /></button>
        </div>
      )}

      {/* Filters */}
      <section className="card space-y-3" aria-label="Filters">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="sm:col-span-2 lg:col-span-1">
            <label htmlFor="gps-search" className="label">Search</label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input id="gps-search" className="input pl-9 w-full min-h-[44px]" placeholder="Asset, driver, address, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="gps-window" className="label">Period</label>
            <select id="gps-window" className="input w-full min-h-[44px]" value={windowSel} onChange={(e) => setWindowSel(e.target.value)}>
              {WINDOW_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="gps-asset" className="label">Asset</label>
            <select id="gps-asset" className="input w-full min-h-[44px]" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)}>
              <option value="">All assets</option>
              {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="gps-motion" className="label">Motion state</label>
            <select id="gps-motion" className="input w-full min-h-[44px]" value={motionFilter} onChange={(e) => setMotionFilter(e.target.value)}>
              <option value="">All states</option>
              <option value="moving">Moving</option>
              <option value="idle">Idle</option>
              <option value="stopped">Stopped</option>
            </select>
          </div>
          <div>
            <label htmlFor="gps-overspeed" className="label">Overspeed threshold</label>
            <select id="gps-overspeed" className="input w-full min-h-[44px]" value={overspeedKmh} onChange={(e) => setOverspeedKmh(Number(e.target.value))}>
              {OVERSPEED_OPTIONS.map((v) => <option key={v} value={v}>Above {v} km/h</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 min-h-[44px] cursor-pointer text-sm text-[var(--text-secondary)]">
            <input type="checkbox" className="h-4 w-4 accent-red-500" checked={overspeedOnly} onChange={(e) => setOverspeedOnly(e.target.checked)} />
            Overspeed pings only
          </label>
          {hasFilters && (
            <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <X size={14} aria-hidden="true" /> Clear filters
            </button>
          )}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">
            {rows === null ? 'Not loaded' : `Figures below cover ${filtered.length.toLocaleString()} of ${all.length.toLocaleString()} pings`}
          </span>
        </div>
      </section>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="Pings" value={na(kpis.totalPings.toLocaleString())} icon={Activity} sub={`${kpis.distinctAssets} assets tracked`} index={0} />
        <StatTile label="Moving now" value={na(kpis.movingCount)} icon={Navigation} tone="accent" sub="latest ping per asset" index={1} />
        <StatTile label="Idle now" value={na(kpis.idleCount)} icon={Power} tone={kpis.idleCount > 0 ? 'warn' : 'neutral'} sub="ignition on, not moving" index={2} />
        <StatTile label="Stale assets" value={na(kpis.staleAssets)} icon={Clock} tone={kpis.staleAssets > 0 ? 'warn' : 'neutral'} sub={`no ping for ${DEFAULT_STALE_HOURS} h`} index={3} />
        <StatTile label="Distance traced" value={na(kpis.distanceKm == null ? 'N/A' : Math.round(kpis.distanceKm).toLocaleString())} unit={kpis.distanceKm == null ? undefined : 'km'} icon={Milestone} sub={kpis.glitchLegs ? `${kpis.glitchLegs} GPS jumps excluded` : 'from consecutive pings'} index={4} />
        <StatTile label="Overspeed pings" value={na(kpis.overspeedPings)} icon={Gauge} tone={kpis.overspeedPings > 0 ? 'crit' : 'neutral'} sub={`above ${overspeedKmh} km/h`} index={5} />
      </div>

      {/* Fleet state + data quality */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="card space-y-3" aria-labelledby="gps-state-title">
          <h3 id="gps-state-title" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Truck size={15} aria-hidden="true" /> Fleet state now
          </h3>
          {loading ? <div className="h-6 bg-[var(--input-bg)] rounded animate-pulse" /> : mixTotal === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No asset has a ping in this selection.</p>
          ) : (
            <ul className="space-y-2">
              {['moving', 'idle', 'stopped'].map((s) => (
                <li key={s} className="flex items-center gap-3 text-sm">
                  <span className="w-20 shrink-0"><MotionBadge state={s} /></span>
                  <div className="flex-1 h-2.5 rounded-full bg-[var(--input-bg)] overflow-hidden" aria-hidden="true">
                    <div className={`h-full rounded-full ${s === 'moving' ? 'bg-green-500' : s === 'idle' ? 'bg-amber-500' : 'bg-[var(--text-muted)]'}`} style={{ width: `${(mix[s] / mixTotal) * 100}%` }} />
                  </div>
                  <span className="tabular-nums text-[var(--text-primary)] w-16 text-right">{mix[s]} ({Math.round((mix[s] / mixTotal) * 100)}%)</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card space-y-2" aria-labelledby="gps-quality-title">
          <h3 id="gps-quality-title" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
            <Satellite size={15} aria-hidden="true" /> Data quality
          </h3>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-xs text-[var(--text-muted)]">Pings with valid coordinates</dt><dd className="text-lg font-semibold text-[var(--text-primary)] tabular-nums">{na(fmtPct(kpis.coordinateCoverage))}</dd></div>
            <div><dt className="text-xs text-[var(--text-muted)]">GPS jumps excluded</dt><dd className="text-lg font-semibold text-[var(--text-primary)] tabular-nums">{na(kpis.glitchLegs)}</dd></div>
            <div><dt className="text-xs text-[var(--text-muted)]">Highest speed seen</dt><dd className="text-lg font-semibold text-[var(--text-primary)] tabular-nums">{na(fmtSpeed(kpis.maxSpeedKmh))}</dd></div>
            <div><dt className="text-xs text-[var(--text-muted)]">Assets tracked</dt><dd className="text-lg font-semibold text-[var(--text-primary)] tabular-nums">{na(kpis.distinctAssets)}</dd></div>
          </dl>
          <p className="text-xs text-[var(--text-muted)]">Distance is traced only between two consecutive pings that both carry coordinates. A leg implying more than 250 km/h is treated as a GPS jump and left out.</p>
        </section>
      </div>

      {/* Per asset tracks */}
      <section className="space-y-2" aria-labelledby="gps-tracks-title">
        <h3 id="gps-tracks-title" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Navigation size={15} aria-hidden="true" /> Position and track per asset
        </h3>
        <EnterpriseTable
          columns={trackColumns}
          data={tracks}
          getRowId={(t) => t.asset_no}
          loading={loading}
          error={error || null}
          onRetry={load}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          exportFileName={reportFileName('TyrePulse GPS Asset Tracks', reportDateLabel())}
          emptyMessage={all.length === 0 ? 'No positions logged yet.' : 'No asset pings match these filters.'}
        />
      </section>

      {/* Ping log */}
      <section className="space-y-2" aria-labelledby="gps-log-title">
        <h3 id="gps-log-title" className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2">
          <Activity size={15} aria-hidden="true" /> Ping log
        </h3>
        <EnterpriseTable
          columns={pingColumns}
          data={filtered}
          getRowId={(r) => String(r.id)}
          loading={loading}
          error={error || null}
          onRetry={load}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          viewKey="gps-tracking"
          emptyMessage={all.length === 0 && !notProvisioned ? 'No positions logged yet. Log the first position.' : 'No positions match these filters.'}
        />
      </section>

      {/* Create / Edit */}
      <Modal
        open={showModal}
        onClose={closeModal}
        title={editing ? 'Edit position' : 'Log GPS position'}
        size="lg"
        footer={(
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" form="gps-form" className="btn-primary text-sm min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Log position'}
            </button>
          </div>
        )}
      >
        <form id="gps-form" onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="gps-f-asset" className="label">Asset number *</label>
              <input id="gps-f-asset" className="input w-full" required placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
            </div>
            <div>
              <label htmlFor="gps-f-driver" className="label">Driver (optional)</label>
              <input id="gps-f-driver" className="input w-full" placeholder="e.g. A. Khan" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
            </div>
            <div>
              <label htmlFor="gps-f-lat" className="label">Latitude</label>
              <input id="gps-f-lat" className="input w-full" type="number" step="any" min="-90" max="90" inputMode="decimal" placeholder="24.71355" value={form.latitude} onChange={(e) => set('latitude', e.target.value)} />
            </div>
            <div>
              <label htmlFor="gps-f-lng" className="label">Longitude</label>
              <input id="gps-f-lng" className="input w-full" type="number" step="any" min="-180" max="180" inputMode="decimal" placeholder="46.67529" value={form.longitude} onChange={(e) => set('longitude', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="gps-f-speed" className="label">Speed (km/h)</label>
              <input id="gps-f-speed" className="input w-full" type="number" step="any" min="0" inputMode="decimal" placeholder="60" value={form.speed_kmh} onChange={(e) => set('speed_kmh', e.target.value)} />
            </div>
            <div>
              <label htmlFor="gps-f-heading" className="label">Heading (degrees)</label>
              <input id="gps-f-heading" className="input w-full" type="number" step="any" min="0" max="360" inputMode="decimal" placeholder="180" value={form.heading} onChange={(e) => set('heading', e.target.value)} />
            </div>
            <div>
              <label htmlFor="gps-f-alt" className="label">Altitude (m)</label>
              <input id="gps-f-alt" className="input w-full" type="number" step="any" inputMode="decimal" placeholder="612" value={form.altitude_m} onChange={(e) => set('altitude_m', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="gps-f-odo" className="label">Odometer (km, optional)</label>
              <input id="gps-f-odo" className="input w-full" type="number" step="1" min="0" inputMode="numeric" placeholder="45000" value={form.odometer_km} onChange={(e) => set('odometer_km', e.target.value)} />
            </div>
            <div>
              <label htmlFor="gps-f-at" className="label">Recorded at</label>
              <input id="gps-f-at" className="input w-full" type="datetime-local" value={form.recorded_at} onChange={(e) => set('recorded_at', e.target.value)} />
              <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use now.</p>
            </div>
          </div>
          <label htmlFor="gps-f-ign" className="flex items-center gap-2 min-h-[44px] cursor-pointer">
            <input id="gps-f-ign" type="checkbox" className="h-4 w-4 rounded border-[var(--input-border)]" checked={!!form.ignition} onChange={(e) => set('ignition', e.target.checked)} />
            <span className="text-sm text-[var(--text-primary)]">Ignition on</span>
          </label>
          <div>
            <label htmlFor="gps-f-addr" className="label">Address (optional)</label>
            <input id="gps-f-addr" className="input w-full" placeholder="e.g. King Fahd Rd, Riyadh" value={form.address} maxLength={400} onChange={(e) => set('address', e.target.value)} />
          </div>
          <div>
            <label htmlFor="gps-f-notes" className="label">Notes (optional)</label>
            <textarea id="gps-f-notes" className="input w-full min-h-[80px] resize-y" placeholder="e.g. geofence entry, telematics fix" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
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
        onClose={() => !deleting && setConfirmDelete(null)}
        title="Delete this position?"
        size="sm"
        footer={(
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        )}
      >
        {confirmDelete && (
          <p className="text-sm text-[var(--text-muted)]">
            {confirmDelete.asset_no || 'Position'}, {fmtLatLng(confirmDelete.latitude, confirmDelete.longitude)}, {fmtDateTime(confirmDelete.recorded_at)}. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
