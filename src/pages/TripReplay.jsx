/**
 * TripReplay (route /trip-replay) - reconstructs and analyses one trip from its
 * ordered GPS breadcrumb segments: great-circle distance, stops and idles,
 * harsh driving events (brake, accel, corner, speeding) and the speed profile
 * along the path. Pick a trip, walk its timeline segment by segment and read
 * the derived KPIs.
 *
 * Runs on the `trip_segments` table (V191). All analytics live in the pure
 * `src/lib/tripReplayAnalytics.js` engine, which reuses the path maths in
 * `src/lib/tripReplay.js`. A figure with nothing to measure reads N/A.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import {
  Navigation, MapPin, Gauge, Activity, Truck, AlertTriangle, Search, X,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, Milestone, StopCircle, Zap,
  Timer, Flag, Clock, ListOrdered, RotateCcw, CheckCircle2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import StatTile from '../components/ui/StatTile'
import Modal from '../components/ui/Modal'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useSettings } from '../contexts/SettingsContext'
import {
  listTripSegments, listTripRefs, createTripSegment, updateTripSegment, deleteTripSegment,
} from '../lib/api/tripReplay'
import { orderSegments } from '../lib/tripReplay'
import {
  replayKpis, eventBreakdown, filterSegments, speedSeries, tripListRows, segmentExportRows,
  replayNarrative, eventLabel, isHarsh, EVENT_TYPES, EXPORT_COLS, EXPORT_HEADERS,
} from '../lib/tripReplayAnalytics'
import { colorAt, withAlpha } from '../lib/reportColors'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const loadExportUtils = () => import('../lib/exportUtils')
const FIELD = 'input w-full min-h-[44px]'
const HARSH_COLOR = '#ef4444'

const EMPTY_FORM = {
  trip_ref: '', asset_no: '', driver_name: '', sequence: '', latitude: '',
  longitude: '', speed_kmh: '', heading: '', event_type: '', recorded_at: '',
  address: '', notes: '',
}

const EVENT_CLS = {
  move: 'bg-sky-900/30 text-sky-400 border-sky-800/50',
  stop: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--input-border)]',
  idle: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border-[var(--input-border)]',
  harsh_brake: 'bg-red-900/30 text-red-400 border-red-800/50',
  harsh_accel: 'bg-orange-900/30 text-orange-400 border-orange-800/50',
  harsh_corner: 'bg-amber-900/30 text-amber-400 border-amber-800/50',
  speeding: 'bg-fuchsia-900/30 text-fuchsia-400 border-fuchsia-800/50',
}

const fmtKm = (v) => (v == null ? 'N/A' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })} km`)
const fmtSpeed = (v) => (v == null || v === '' ? 'N/A' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} km/h`)
const fmtNum = (v) => (v == null ? 'N/A' : Number(v).toLocaleString())
const fmtPct = (v) => (v == null ? 'N/A' : `${v}%`)
const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
const fmtMin = (v) => {
  if (v == null) return 'N/A'
  if (v < 60) return `${v} min`
  const h = Math.floor(v / 60); const m = v % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function fmtTime(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return 'N/A'
  return d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
}
function fmtCoord(lat, lng) {
  if (lat == null || lat === '' || lng == null || lng === '') return 'N/A'
  return `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`
}

function EventBadge({ type }) {
  if (!type) return <span className="text-[var(--text-muted)]">N/A</span>
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${EVENT_CLS[type] || 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]'}`}>
      {isHarsh(type) && <Zap size={10} aria-hidden="true" />}{eventLabel(type)}
    </span>
  )
}

const SPEED_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 9 }, maxTicksLimit: 12 }, grid: { display: false }, title: { display: true, text: 'Segment', color: 'var(--text-muted)' } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 10 } }, grid: { color: 'var(--panel-2)' }, beginAtZero: true, title: { display: true, text: 'km/h', color: 'var(--text-muted)' } },
  },
}

export default function TripReplay() {
  const { activeCountry } = useSettings()

  const [trips, setTrips] = useState(null)
  const [tripRef, setTripRef] = useState('')
  const [segments, setSegments] = useState(null)

  const [error, setError] = useState('')
  const [segError, setSegError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [segLoading, setSegLoading] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [tripSearch, setTripSearch] = useState('')
  const [assetFilter, setAssetFilter] = useState('')
  const [eventFilter, setEventFilter] = useState('')
  const [harshOnly, setHarshOnly] = useState(false)
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const loadTrips = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listTripRefs({ country: activeCountry })
      const list = Array.isArray(data) ? data : []
      setTrips(list)
      setUpdatedAt(new Date())
      setTripRef((cur) => (cur && list.some((t) => t.trip_ref === cur) ? cur : list[0]?.trip_ref || ''))
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setTrips([]) }
      else { setError(toUserMessage(err, 'Could not load trips.')); setTrips(null) }
      setTripRef('')
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { loadTrips() }, [loadTrips])

  const loadSegments = useCallback(async () => {
    if (!tripRef) { setSegments([]); return }
    setSegLoading(true); setSegError('')
    try {
      const data = await listTripSegments({ country: activeCountry, tripRef })
      setSegments(orderSegments(Array.isArray(data) ? data : []))
    } catch (err) {
      if (isMissingRelation(err)) { setNotProvisioned(true); setSegments([]) }
      else { setSegError(toUserMessage(err, 'Could not load trip segments.')); setSegments(null) }
    } finally {
      setSegLoading(false)
    }
  }, [tripRef, activeCountry])

  useEffect(() => { loadSegments() }, [loadSegments])

  const reloadAll = useCallback(async () => { await loadTrips(); await loadSegments() }, [loadTrips, loadSegments])

  const segs = useMemo(() => segments || [], [segments])
  const segLoaded = Array.isArray(segments) && Array.isArray(trips)
  const k = useMemo(() => replayKpis(segs), [segs])
  const events = useMemo(() => eventBreakdown(segs), [segs])
  const series = useMemo(() => speedSeries(segs), [segs])
  const tripRows = useMemo(() => tripListRows(trips || [], { search: tripSearch }), [trips, tripSearch])
  const selectedTrip = useMemo(() => (trips || []).find((t) => t.trip_ref === tripRef) || null, [trips, tripRef])

  const assetOptions = useMemo(() => [...new Set(segs.map((r) => r.asset_no).filter(Boolean))].sort(), [segs])
  const filtered = useMemo(
    () => filterSegments(segs, { search, asset: assetFilter, event: eventFilter, harshOnly }),
    [segs, search, assetFilter, eventFilter, harshOnly],
  )

  // ── Exports: every matching segment of the selected trip ─────────────────
  const exportRows = useMemo(() => segmentExportRows(filtered), [filtered])
  const fileBase = async () => {
    const { reportFileName, reportDateLabel } = await loadExportUtils()
    return reportFileName('TyrePulse Trip Replay', tripRef || null, reportDateLabel())
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
      await exportToPdf(exportRows, EXPORT_COLS.map((c, i) => ({ key: c, header: EXPORT_HEADERS[i] })), `Trip Replay ${tripRef || ''}`.trim(), await fileBase(), 'landscape')
    } catch (e) { setActionError(toUserMessage(e, 'Export failed. Please try again.')) }
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    const nextSeq = segs.reduce((m, r) => Math.max(m, Number(r.sequence) || 0), 0) + 1
    setEditing(null)
    setForm({ ...EMPTY_FORM, trip_ref: tripRef || '', sequence: String(nextSeq) })
    setFormError(''); setShowModal(true)
  }
  const openEdit = useCallback((r) => {
    setEditing(r)
    setForm({
      trip_ref: r.trip_ref || '', asset_no: r.asset_no || '', driver_name: r.driver_name || '',
      sequence: r.sequence ?? '', latitude: r.latitude ?? '', longitude: r.longitude ?? '',
      speed_kmh: r.speed_kmh ?? '', heading: r.heading ?? '', event_type: r.event_type || '',
      recorded_at: r.recorded_at ? new Date(r.recorded_at).toISOString().slice(0, 16) : '',
      address: r.address || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }, [])
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (key, v) => setForm((f) => ({ ...f, [key]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.trip_ref.trim()) { setFormError('A trip reference is required.'); return }
    const lat = numOrNull(form.latitude); const lng = numOrNull(form.longitude)
    if (lat != null && (lat < -90 || lat > 90)) { setFormError('Latitude must be between -90 and 90.'); return }
    if (lng != null && (lng < -180 || lng > 180)) { setFormError('Longitude must be between -180 and 180.'); return }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry !== 'All' ? activeCountry : null }
      if (editing) await updateTripSegment(editing.id, payload)
      else await createTripSegment(payload)
      setShowModal(false); setEditing(null)
      if (!editing && payload.trip_ref !== tripRef) setTripRef(payload.trip_ref.trim())
      await reloadAll()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the segment.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, tripRef, reloadAll])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true); setActionError('')
    try {
      await deleteTripSegment(confirmDelete.id)
      setConfirmDelete(null)
      await reloadAll()
    } catch (err) {
      setActionError(toUserMessage(err, 'Could not delete the segment.'))
      setConfirmDelete(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, reloadAll])

  const clearFilters = () => { setAssetFilter(''); setEventFilter(''); setHarshOnly(false); setSearch('') }
  const hasFilters = !!(assetFilter || eventFilter || harshOnly || search)
  const tripsLoaded = Array.isArray(trips)
  const noTrips = tripsLoaded && trips.length === 0

  // ── Tables ───────────────────────────────────────────────────────────────
  const tripColumns = useMemo(() => [
    { id: 'ref', header: 'Trip', accessorFn: (t) => t.trip_ref, size: 170,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5 font-medium text-[var(--text-primary)]">
          {row.original.trip_ref === tripRef && <CheckCircle2 size={13} className="text-[var(--accent)]" aria-label="Selected" />}
          {row.original.trip_ref}
        </span>
      ) },
    { id: 'asset', header: 'Asset', accessorFn: (t) => t.asset_no || 'N/A', size: 110 },
    { id: 'driver', header: 'Driver', accessorFn: (t) => t.driver_name || 'N/A', size: 130 },
    { id: 'points', header: 'Points', accessorFn: (t) => t.segments, size: 80, meta: { align: 'right' } },
    { id: 'first', header: 'First point', accessorFn: (t) => t.firstAt || '', size: 150, cell: ({ row }) => fmtTime(row.original.firstAt) },
    { id: 'dur', header: 'Span', accessorFn: (t) => t.durationMin, size: 90, meta: { align: 'right' }, cell: ({ row }) => fmtMin(row.original.durationMin) },
  ], [tripRef])

  const segColumns = useMemo(() => [
    { id: 'seq', header: 'Seq', accessorFn: (r) => numOrNull(r.sequence), size: 70, meta: { align: 'right' },
      cell: ({ row }) => <span className="font-mono tabular-nums text-[var(--text-secondary)]">{row.original.sequence ?? 'N/A'}</span> },
    { id: 'time', header: 'Time', accessorFn: (r) => r.recorded_at || '', size: 150, cell: ({ row }) => <span className="whitespace-nowrap">{fmtTime(row.original.recorded_at)}</span> },
    { id: 'event', header: 'Event', accessorFn: (r) => (r.event_type ? eventLabel(r.event_type) : 'N/A'), size: 130, cell: ({ row }) => <EventBadge type={row.original.event_type} /> },
    { id: 'speed', header: 'Speed', accessorFn: (r) => numOrNull(r.speed_kmh), size: 110, meta: { align: 'right' },
      cell: ({ row }) => <span className="font-semibold tabular-nums">{fmtSpeed(row.original.speed_kmh)}</span> },
    { id: 'heading', header: 'Heading', accessorFn: (r) => numOrNull(r.heading), size: 90, meta: { align: 'right' },
      cell: ({ row }) => (row.original.heading == null ? 'N/A' : `${Math.round(row.original.heading)} deg`) },
    { id: 'pos', header: 'Position', accessorFn: (r) => fmtCoord(r.latitude, r.longitude), size: 160,
      cell: ({ row }) => <span className="font-mono text-xs whitespace-nowrap">{fmtCoord(row.original.latitude, row.original.longitude)}</span> },
    { id: 'address', header: 'Address', accessorFn: (r) => r.address || 'N/A', size: 200 },
    { id: 'actions', header: '', size: 110, enableSorting: false, meta: { export: false, align: 'right' },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <button type="button" onClick={() => openEdit(row.original)} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label={`Edit segment ${row.original.sequence ?? ''}`}><Pencil size={15} /></button>
          <button type="button" onClick={() => setConfirmDelete(row.original)} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label={`Delete segment ${row.original.sequence ?? ''}`}><Trash2 size={15} /></button>
        </div>
      ) },
  ], [openEdit])

  const speedData = {
    labels: series.map((p) => String(p.seq)),
    datasets: [{
      label: 'Speed (km/h)',
      data: series.map((p) => p.speed ?? 0),
      backgroundColor: series.map((p) => (p.harsh ? HARSH_COLOR : withAlpha(colorAt(0), 0.7))),
      borderRadius: 2,
    }],
  }

  const kpis = [
    { label: 'Distance travelled', value: segLoaded ? fmtKm(k.distanceKm) : 'N/A', icon: Milestone, tone: 'info', sub: `${fmtNum(k.gpsPoints)} positioned points` },
    { label: 'Trip span', value: segLoaded ? fmtMin(k.durationMin) : 'N/A', icon: Clock, sub: 'First to last timestamp' },
    { label: 'Segments', value: segLoaded ? fmtNum(k.segments) : 'N/A', icon: ListOrdered, sub: `${fmtNum(k.speedPoints)} with a speed` },
    { label: 'Stops and idles', value: segLoaded ? fmtNum(k.stops) : 'N/A', icon: StopCircle, tone: 'warn' },
    { label: 'Harsh events', value: segLoaded ? fmtNum(k.harshEvents) : 'N/A', icon: Zap, tone: 'crit', sub: k.harshPer100Km != null ? `${k.harshPer100Km} per 100 km` : `Rate ${fmtPct(k.harshRatePct)}` },
    { label: 'Max speed', value: segLoaded ? fmtSpeed(k.maxKmh) : 'N/A', icon: Gauge, tone: 'warn' },
    { label: 'Avg speed', value: segLoaded ? fmtSpeed(k.avgKmh) : 'N/A', icon: Activity, sub: 'All speed readings' },
    { label: 'Moving avg', value: segLoaded ? fmtSpeed(k.movingAvgKmh) : 'N/A', icon: Timer, tone: 'accent', sub: 'While in motion' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trip Replay"
        subtitle="Reconstruct a journey from its ordered GPS breadcrumbs: distance travelled, stops, harsh driving events and the full speed profile, segment by segment."
        icon={Navigation}
        onRefresh={reloadAll}
        refreshing={refreshing || segLoading}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={doExcel} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}><FileSpreadsheet size={14} /> Excel</button>
            <button type="button" onClick={doPdf} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}><FileText size={14} /> PDF</button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={notProvisioned || !tripsLoaded}><Plus size={14} /> Add segment</button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Trip Replay is not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V191_TRIP_SEGMENTS.sql</span>, then reload.</p>
          </div>
        </div>
      )}

      {(error || segError) && (
        <div className="card border border-red-800/50 flex flex-wrap items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-red-300 font-medium">{error ? 'Could not load trips.' : 'Could not load this trip.'}</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">{error || segError}</p>
          </div>
          <button type="button" onClick={error ? loadTrips : loadSegments} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={refreshing || segLoading}><RotateCcw size={14} /> Retry</button>
        </div>
      )}

      {actionError && (
        <div className="card border border-red-800/50 flex items-start gap-3" role="alert">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="flex-1 text-sm text-red-300">{actionError}</p>
          <button type="button" onClick={() => setActionError('')} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Dismiss message"><X size={16} /></button>
        </div>
      )}

      {/* Trip picker */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1 sm:flex-none">
            <label htmlFor="replay-trip" className="label inline-flex items-center gap-1.5"><Flag size={13} aria-hidden="true" /> Trip</label>
            <select id="replay-trip" className={FIELD} value={tripRef} onChange={(e) => setTripRef(e.target.value)} disabled={!tripsLoaded || noTrips}>
              {!tripsLoaded && <option value="">{error ? 'Not available' : 'Loading...'}</option>}
              {noTrips && <option value="">No trips yet</option>}
              {(trips || []).map((t) => <option key={t.trip_ref} value={t.trip_ref}>{t.trip_ref} | {t.segments} pts{t.asset_no ? ` | ${t.asset_no}` : ''}</option>)}
            </select>
          </div>
          <div className="min-w-[200px] flex-1">
            <label htmlFor="replay-trip-search" className="label">Find a trip</label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input id="replay-trip-search" className={`${FIELD} pl-9`} placeholder="Trip reference, asset or driver" value={tripSearch} onChange={(e) => setTripSearch(e.target.value)} />
            </div>
          </div>
          {selectedTrip && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)] sm:ml-auto">
              {selectedTrip.asset_no && <span className="inline-flex items-center gap-1"><Truck size={13} aria-hidden="true" /> {selectedTrip.asset_no}</span>}
              {selectedTrip.driver_name && <span className="inline-flex items-center gap-1"><MapPin size={13} aria-hidden="true" /> {selectedTrip.driver_name}</span>}
              <span className="inline-flex items-center gap-1"><Clock size={13} aria-hidden="true" /> {fmtTime(selectedTrip.firstAt)} to {fmtTime(selectedTrip.lastAt)}</span>
            </div>
          )}
        </div>
        <p className="text-xs text-[var(--text-muted)]">Select a row to replay that trip. {tripsLoaded ? `${fmtNum(trips.length)} trip${trips.length === 1 ? '' : 's'} available.` : ''}</p>
        <EnterpriseTable
          columns={tripColumns}
          data={tripRows}
          getRowId={(t) => t.trip_ref}
          loading={!tripsLoaded && !error}
          error={error && !tripsLoaded ? error : null}
          onRetry={loadTrips}
          emptyMessage={noTrips ? 'No trips recorded yet. Add your first segment.' : 'No trips match this search.'}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableExport={false}
          enableColumnVisibility={false}
          initialPageSize={25}
          onRowClick={(t) => setTripRef(t.trip_ref)}
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((t, i) => <StatTile key={t.label} index={i} label={t.label} value={t.value} icon={t.icon} tone={t.tone} sub={t.sub} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="card lg:col-span-2">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-2"><Gauge size={15} aria-hidden="true" /> Speed along the path</h2>
          <p className="text-xs text-[var(--text-muted)] mb-3">Red bars mark harsh events. Long trips are sampled; every harsh point is always kept.</p>
          <div className="h-60" role="img" aria-label={`Speed profile across ${series.length} points, peak ${fmtSpeed(k.maxKmh)}`}>
            {!segLoaded ? <div className="h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : k.speedPoints > 0 ? <Bar data={speedData} options={SPEED_OPTS} />
                : <p className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">No speed readings recorded for this trip.</p>}
          </div>
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2"><Timer size={15} aria-hidden="true" /> Event breakdown</h2>
          {!segLoaded ? <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
            : !events.length ? <p className="text-sm text-[var(--text-muted)]">No event types recorded for this trip.</p>
              : (
                <ul className="space-y-2">
                  {events.map((ev, i) => (
                    <li key={ev.type} className="flex items-center gap-3">
                      <div className="w-28 shrink-0"><EventBadge type={ev.type} /></div>
                      <div className="flex-1 h-2.5 rounded-full bg-[var(--input-bg)] overflow-hidden" aria-hidden="true">
                        <div className="h-full rounded-full" style={{ width: `${ev.pct || 0}%`, background: ev.harsh ? HARSH_COLOR : colorAt(i) }} />
                      </div>
                      <span className="text-xs text-[var(--text-secondary)] w-20 text-right tabular-nums">{ev.count} | {fmtPct(ev.pct)}</span>
                    </li>
                  ))}
                  <li className="text-[11px] text-[var(--text-muted)] pt-1">{replayNarrative(k)}</li>
                </ul>
              )}
        </div>
      </div>

      <div className="card">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div className="sm:col-span-2">
            <label htmlFor="replay-search" className="label">Search segments</label>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
              <input id="replay-search" className={`${FIELD} pl-9`} placeholder="Event, asset, driver, address, notes" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="replay-asset" className="label">Asset</label>
            <select id="replay-asset" className={FIELD} value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)}>
              <option value="">All assets</option>
              {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="replay-event" className="label">Event type</label>
            <select id="replay-event" className={FIELD} value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}>
              <option value="">All events</option>
              {events.map((ev) => <option key={ev.type} value={ev.type}>{ev.label}</option>)}
            </select>
          </div>
          <label className="inline-flex items-center gap-2 min-h-[44px] text-sm text-[var(--text-secondary)] cursor-pointer">
            <input type="checkbox" className="w-4 h-4" checked={harshOnly} onChange={(e) => setHarshOnly(e.target.checked)} />
            Harsh events only
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} /> Clear filters</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{fmtNum(filtered.length)} of {fmtNum(segs.length)} segments</span>
        </div>
      </div>

      <EnterpriseTable
        columns={segColumns}
        data={filtered}
        getRowId={(r) => String(r.id)}
        loading={(!segLoaded || segLoading) && !segError && !error}
        error={segError && !segLoaded ? segError : null}
        onRetry={loadSegments}
        emptyMessage={noTrips && !notProvisioned ? 'No trips recorded yet. Add your first segment.'
          : segs.length === 0 ? 'This trip has no segments. Add one to begin the replay.' : 'No segments match these filters.'}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableExport={false}
        viewKey="trip-replay"
      />

      <Modal
        open={showModal}
        onClose={closeModal}
        title={editing ? 'Edit segment' : 'Add trip segment'}
        size="lg"
        footer={
          <div className="flex items-center justify-end gap-2 w-full">
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" form="segment-form" className="btn-primary text-sm min-h-[44px] disabled:opacity-60" disabled={saving}>{saving ? 'Saving...' : editing ? 'Save changes' : 'Add segment'}</button>
          </div>
        }
      >
        <form id="segment-form" onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="sf-ref" className="label">Trip reference <span className="text-red-400" aria-hidden="true">*</span></label>
              <input id="sf-ref" className={FIELD} placeholder="e.g. TRIP-2026-0042" value={form.trip_ref} maxLength={200} required onChange={(e) => set('trip_ref', e.target.value)} />
            </div>
            <div>
              <label htmlFor="sf-seq" className="label">Sequence</label>
              <input id="sf-seq" className={FIELD} type="number" step="1" inputMode="numeric" placeholder="1" value={form.sequence} onChange={(e) => set('sequence', e.target.value)} />
            </div>
            <div>
              <label htmlFor="sf-asset" className="label">Asset number (optional)</label>
              <input id="sf-asset" className={FIELD} placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
            </div>
            <div>
              <label htmlFor="sf-driver" className="label">Driver (optional)</label>
              <input id="sf-driver" className={FIELD} placeholder="e.g. A. Khan" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label htmlFor="sf-lat" className="label">Latitude</label>
              <input id="sf-lat" className={FIELD} type="number" step="any" inputMode="decimal" placeholder="24.7136" value={form.latitude} onChange={(e) => set('latitude', e.target.value)} />
            </div>
            <div>
              <label htmlFor="sf-lng" className="label">Longitude</label>
              <input id="sf-lng" className={FIELD} type="number" step="any" inputMode="decimal" placeholder="46.6753" value={form.longitude} onChange={(e) => set('longitude', e.target.value)} />
            </div>
            <div>
              <label htmlFor="sf-heading" className="label">Heading (degrees)</label>
              <input id="sf-heading" className={FIELD} type="number" step="any" min="0" inputMode="decimal" placeholder="180" value={form.heading} onChange={(e) => set('heading', e.target.value)} />
            </div>
            <div>
              <label htmlFor="sf-speed" className="label">Speed (km/h)</label>
              <input id="sf-speed" className={FIELD} type="number" step="any" min="0" inputMode="decimal" placeholder="80" value={form.speed_kmh} onChange={(e) => set('speed_kmh', e.target.value)} />
            </div>
            <div>
              <label htmlFor="sf-event" className="label">Event type</label>
              <select id="sf-event" className={FIELD} value={form.event_type} onChange={(e) => set('event_type', e.target.value)}>
                <option value="">None</option>
                {EVENT_TYPES.map((t) => <option key={t} value={t}>{eventLabel(t)}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="sf-at" className="label">Recorded at</label>
              <input id="sf-at" className={FIELD} type="datetime-local" value={form.recorded_at} onChange={(e) => set('recorded_at', e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="sf-address" className="label">Address or place (optional)</label>
            <input id="sf-address" className={FIELD} placeholder="e.g. King Fahd Rd, Riyadh" value={form.address} maxLength={500} onChange={(e) => set('address', e.target.value)} />
          </div>
          <div>
            <label htmlFor="sf-notes" className="label">Notes (optional)</label>
            <textarea id="sf-notes" className="input w-full min-h-[70px] resize-y" placeholder="e.g. sharp braking near junction" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
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
        title="Delete this segment?"
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
            Seq {confirmDelete.sequence ?? 'N/A'} | {confirmDelete.event_type ? eventLabel(confirmDelete.event_type) : 'No event'} | {fmtTime(confirmDelete.recorded_at)}. This cannot be undone.
          </p>
        )}
      </Modal>
    </div>
  )
}
