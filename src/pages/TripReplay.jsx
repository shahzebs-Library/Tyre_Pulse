/**
 * TripReplay (route /trip-replay): replay one trip from its ordered GPS
 * breadcrumbs, rebuilt on the Command Center kit to the owner's Trip Replay
 * mockup: trip picker, route trace with playback, speed and events chart, trip
 * summary, events panel and the stops timeline, plus the segment register with
 * add / edit / delete and Excel / PDF export.
 *
 * Source: trip_segments (V191) only. The route is drawn as a local SVG trace of
 * the recorded coordinates; no map tiles are loaded from an external host (the
 * CSP does not allow one, and no base map is licensed). Fuel, CO2, tolls,
 * geofence events, a planned route (deviation), elevation, engine RPM and tyre
 * pressure have no column on trip_segments, so they read "Not recorded".
 * Pure shaping lives in src/lib/tripReplayView.js and tripReplayAnalytics.js.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  MapPin, Gauge, Truck, AlertTriangle, Search, X, FileSpreadsheet, FileText, Plus, Pencil, Trash2,
  Milestone, Zap, Timer, Clock, RotateCcw, Play, Pause, SkipBack, SkipForward, Fuel, Leaf, Spline,
  ChevronRight, ParkingCircle, Flag, Navigation, Activity, RefreshCw, BarChart3, Download, Share2, ChevronDown,
} from 'lucide-react'
import Modal from '../components/ui/Modal'
import { Card, Kpi, Tabs, KitTable, VehicleThumb, ViewAll, fmtInt } from '../components/commandCenter/kit'
import { useSettings } from '../contexts/SettingsContext'
import {
  listTripSegments, listTripRefs, createTripSegment, updateTripSegment, deleteTripSegment,
} from '../lib/api/tripReplay'
import { orderSegments } from '../lib/tripReplay'
import {
  replayKpis, eventBreakdown, filterSegments, tripListRows, segmentExportRows,
  replayNarrative, eventLabel, isHarsh, EVENT_TYPES, EXPORT_COLS, EXPORT_HEADERS,
} from '../lib/tripReplayAnalytics'
import {
  tripsInPeriod, pathGeometry, playbackAt, fmtClock, eventsSummary, stopsTimeline, speedChart,
  tripSummary, TONE_LABEL,
} from '../lib/tripReplayView'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'
import './TripReplay.css'

const loadExportUtils = () => import('../lib/exportUtils')
const FIELD = 'input w-full min-h-[44px]'
const NA = <span className="cc-na">N/A</span>

const EMPTY_FORM = {
  trip_ref: '', asset_no: '', driver_name: '', sequence: '', latitude: '',
  longitude: '', speed_kmh: '', heading: '', event_type: '', recorded_at: '',
  address: '', notes: '',
}

const EVENT_TONE = {
  move: 'good', stop: 'info', idle: 'info', harsh_brake: 'bad', harsh_accel: 'orange', harsh_corner: 'warn', speeding: 'warn',
}
const TONE_COLOR = {
  normal: 'var(--cc-green)', slow: 'var(--cc-amber)', harsh: 'var(--cc-red)', speeding: 'var(--cc-orange)', stop: 'var(--cc-blue)',
}
const PLAY_SPEEDS = [1, 2, 4, 8]

const fmtKm = (v) => (v == null ? 'N/A' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`)
const fmtSpeed = (v) => (v == null || v === '' ? 'N/A' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} km/h`)
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
function fmtHm(v) {
  if (!v) return '--:--'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '--:--'
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function fmtCoord(lat, lng) {
  if (lat == null || lat === '' || lng == null || lng === '') return 'N/A'
  return `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`
}

function EventBadge({ type }) {
  if (!type) return NA
  return <span className={`cc-pill ${EVENT_TONE[type] || 'muted'}`}>{isHarsh(type) && <Zap size={10} aria-hidden="true" />}{eventLabel(type)}</span>
}

function NotRecorded({ children }) {
  return <span className="tr-nr" title="No column for this on trip_segments">{children || 'Not recorded'}</span>
}

export default function TripReplay() {
  const { activeCountry } = useSettings()

  const [trips, setTrips] = useState(null)
  // A shared link (?trip=<ref>) opens straight on that trip.
  const [tripRef, setTripRef] = useState(() => {
    try { return new URLSearchParams(window.location.search).get('trip') || '' } catch { return '' }
  })
  const [segments, setSegments] = useState(null)

  const [error, setError] = useState('')
  const [segError, setSegError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [segLoading, setSegLoading] = useState(false)

  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo] = useState('')
  const [tripSearch, setTripSearch] = useState('')
  const [tripAsset, setTripAsset] = useState('')
  const [tripDriver, setTripDriver] = useState('')
  const [assetFilter, setAssetFilter] = useState('')
  const [eventFilter, setEventFilter] = useState('')
  const [harshOnly, setHarshOnly] = useState(false)
  const [search, setSearch] = useState('')
  const [chartTab, setChartTab] = useState('speed')
  const [compareOpen, setCompareOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [shareNote, setShareNote] = useState('')

  const [playIdx, setPlayIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [playSpeed, setPlaySpeed] = useState(1)

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
  useEffect(() => { setPlayIdx(0); setPlaying(false) }, [tripRef])

  const reloadAll = useCallback(async () => { await loadTrips(); await loadSegments() }, [loadTrips, loadSegments])

  const segs = useMemo(() => segments || [], [segments])
  const segLoaded = Array.isArray(segments) && Array.isArray(trips)
  const k = useMemo(() => replayKpis(segs), [segs])
  const events = useMemo(() => eventBreakdown(segs), [segs])
  const ev = useMemo(() => eventsSummary(segs), [segs])
  const summary = useMemo(() => tripSummary(k), [k])
  const timeline = useMemo(() => stopsTimeline(segs), [segs])
  const geo = useMemo(() => pathGeometry(segs, { w: 800, h: 300, pad: 28 }), [segs])
  const chart = useMemo(() => speedChart(segs, { w: 800, h: 150 }), [segs])
  const play = useMemo(() => playbackAt(segs, playIdx), [segs, playIdx])

  const periodTrips = useMemo(() => tripsInPeriod(trips || [], { from: periodFrom, to: periodTo }), [trips, periodFrom, periodTo])
  const tripAssets = useMemo(() => [...new Set(periodTrips.map((t) => t.asset_no).filter(Boolean))].sort(), [periodTrips])
  const tripDrivers = useMemo(() => [...new Set(periodTrips.map((t) => t.driver_name).filter(Boolean))].sort(), [periodTrips])
  const tripRows = useMemo(
    () => tripListRows(periodTrips, { search: tripSearch })
      .filter((t) => (!tripAsset || t.asset_no === tripAsset) && (!tripDriver || t.driver_name === tripDriver)),
    [periodTrips, tripSearch, tripAsset, tripDriver],
  )
  const selectedTrip = useMemo(() => (trips || []).find((t) => t.trip_ref === tripRef) || null, [trips, tripRef])

  const assetOptions = useMemo(() => [...new Set(segs.map((r) => r.asset_no).filter(Boolean))].sort(), [segs])
  const filtered = useMemo(
    () => filterSegments(segs, { search, asset: assetFilter, event: eventFilter, harshOnly }),
    [segs, search, assetFilter, eventFilter, harshOnly],
  )

  // Playback: advance one breadcrumb per tick; stop at the end.
  useEffect(() => {
    if (!playing) return undefined
    if (play.index >= play.last) { setPlaying(false); return undefined }
    const id = setTimeout(() => setPlayIdx((i) => i + 1), Math.round(800 / playSpeed))
    return () => clearTimeout(id)
  }, [playing, play.index, play.last, playSpeed])

  const startReplay = () => {
    if (!segs.length) return
    if (play.index >= play.last) setPlayIdx(0)
    setPlaying(true)
  }

  // Exports: every matching segment of the selected trip
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

  // Modal
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

  const shareTrip = async () => {
    setShareNote('')
    try {
      const url = new URL(window.location.href)
      if (tripRef) url.searchParams.set('trip', tripRef); else url.searchParams.delete('trip')
      await navigator.clipboard.writeText(url.toString())
      setShareNote(tripRef ? `Link to ${tripRef} copied.` : 'Link to Trip Replay copied.')
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not copy the link. Copy it from the address bar instead.'))
    }
  }
  const scrollToSegments = () => document.getElementById('tr-segments')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const clearFilters = () => { setAssetFilter(''); setEventFilter(''); setHarshOnly(false); setSearch('') }
  const hasFilters = !!(assetFilter || eventFilter || harshOnly || search)
  const tripsLoaded = Array.isArray(trips)
  const noTrips = tripsLoaded && trips.length === 0
  const tripFiltersOn = !!(tripSearch || tripAsset || tripDriver)

  const tripColumns = [
    { key: 'sel', header: '', sortable: false, cell: (t) => <span className={`tr-radio ${t.trip_ref === tripRef ? 'on' : ''}`} aria-label={t.trip_ref === tripRef ? 'Selected' : undefined} /> },
    { key: 'trip_ref', header: 'Trip ID', cell: (t) => <span className="cc-strong">{t.trip_ref}</span> },
    { key: 'asset_no', header: 'Asset', cell: (t) => t.asset_no || NA },
    { key: 'driver_name', header: 'Driver', cell: (t) => t.driver_name || NA },
    { key: 'firstAt', header: 'Start time', sortValue: (t) => t.firstAt || '', cell: (t) => fmtTime(t.firstAt) },
    { key: 'lastAt', header: 'End time', sortValue: (t) => t.lastAt || '', cell: (t) => fmtTime(t.lastAt) },
    { key: 'segments', header: 'Points', numeric: true, cell: (t) => fmtInt(t.segments) },
    { key: 'durationMin', header: 'Duration', numeric: true, cell: (t) => fmtMin(t.durationMin) },
  ]

  const segColumns = [
    { key: 'sequence', header: 'Seq', numeric: true, sortValue: (r) => numOrNull(r.sequence), cell: (r) => r.sequence ?? NA },
    { key: 'recorded_at', header: 'Time', sortValue: (r) => r.recorded_at || '', cell: (r) => fmtTime(r.recorded_at) },
    { key: 'event_type', header: 'Event', sortValue: (r) => (r.event_type ? eventLabel(r.event_type) : ''), cell: (r) => <EventBadge type={r.event_type} /> },
    { key: 'speed_kmh', header: 'Speed', numeric: true, sortValue: (r) => numOrNull(r.speed_kmh), cell: (r) => fmtSpeed(r.speed_kmh) },
    { key: 'heading', header: 'Heading', numeric: true, sortValue: (r) => numOrNull(r.heading), cell: (r) => (r.heading == null ? NA : `${Math.round(r.heading)} deg`) },
    { key: 'pos', header: 'Position', sortable: false, cell: (r) => <span className="tr-mono">{fmtCoord(r.latitude, r.longitude)}</span> },
    { key: 'address', header: 'Address', cell: (r) => r.address || NA },
    {
      key: 'actions', header: '', sortable: false, align: 'right', cell: (r) => (
        <span className="tr-row-actions">
          <button type="button" className="cc-icon-btn" onClick={(e) => { e.stopPropagation(); openEdit(r) }} aria-label={`Edit segment ${r.sequence ?? ''}`}><Pencil size={14} /></button>
          <button type="button" className="cc-icon-btn tr-danger" onClick={(e) => { e.stopPropagation(); setConfirmDelete(r) }} aria-label={`Delete segment ${r.sequence ?? ''}`}><Trash2 size={14} /></button>
        </span>
      ),
    },
  ]

  const replayEmpty = notProvisioned
    ? 'Trip Replay is not enabled on this database yet. Apply MIGRATIONS_V191_TRIP_SEGMENTS.sql, then reload.'
    : noTrips ? 'No trips recorded yet. Trip breadcrumbs (trip_segments) hold no rows, so there is nothing to replay. Add a segment to start a trip.'
      : !tripRef ? 'Select a trip to replay.'
        : 'This trip has fewer than two positioned points, so no route can be drawn.'
  const cur = play.current

  return (
    <div className="cc tr-page">
      <header className="tr-head">
        <div className="tr-head-art tr-art-dark" style={{ backgroundImage: 'url(/dashboard/hero-replay-dark.webp)' }} aria-hidden="true" />
        <div className="tr-head-art tr-art-light" style={{ backgroundImage: 'url(/dashboard/hero-replay-light.webp)' }} aria-hidden="true" />
        <div className="tr-head-copy">
          <nav className="tr-crumb" aria-label="Breadcrumb">Monitoring and Logistics <ChevronRight size={12} aria-hidden="true" /> <span>Trip Replay</span></nav>
          <h1>Trip Replay</h1>
          <p>Replay recorded trips with route trace, stops, events and speed diagnostics.</p>
        </div>
        <div className="tr-head-actions">
          <label className="tr-date"><span>From</span><input type="date" className="cc-select" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} aria-label="Trips from date" /></label>
          <label className="tr-date"><span>To</span><input type="date" className="cc-select" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} aria-label="Trips to date" /></label>
          <select className="cc-select tr-site" aria-label="Site" disabled title="Trip segments carry no site column, so trips cannot be filtered by site.">
            <option>All sites</option>
          </select>
          <button type="button" className="cc-btn-primary" onClick={playing ? () => setPlaying(false) : startReplay} disabled={!geo}>
            {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />} {playing ? 'Pause' : 'Replay'}
          </button>
          <button type="button" className="cc-btn-ghost" onClick={() => setCompareOpen(true)} disabled={!tripsLoaded}><BarChart3 size={14} aria-hidden="true" /> Compare trips</button>
          <div className="tr-menu">
            <button type="button" className="cc-btn-ghost" onClick={() => setExportOpen((v) => !v)} aria-expanded={exportOpen} aria-haspopup="menu" disabled={!filtered.length}>
              <Download size={14} aria-hidden="true" /> Export <ChevronDown size={13} aria-hidden="true" />
            </button>
            {exportOpen && (
              <div className="tr-menu-pop" role="menu">
                <button type="button" role="menuitem" onClick={() => { setExportOpen(false); doExcel() }}><FileSpreadsheet size={14} aria-hidden="true" /> Excel</button>
                <button type="button" role="menuitem" onClick={() => { setExportOpen(false); doPdf() }}><FileText size={14} aria-hidden="true" /> PDF</button>
              </div>
            )}
          </div>
          <button type="button" className="cc-btn-ghost" onClick={shareTrip}><Share2 size={14} aria-hidden="true" /> Share</button>
          <button type="button" className="cc-btn-ghost" onClick={openCreate} disabled={notProvisioned || !tripsLoaded}><Plus size={14} aria-hidden="true" /> Add segment</button>
          <button type="button" className="cc-icon-btn" onClick={reloadAll} disabled={refreshing || segLoading} aria-label="Refresh"><RefreshCw size={14} className={refreshing || segLoading ? 'animate-spin' : ''} /></button>
        </div>
      </header>

      {shareNote && (
        <div className="cc-card tr-banner info" role="status">
          <Share2 size={16} aria-hidden="true" /><div>{shareNote}</div>
          <button type="button" className="cc-icon-btn" onClick={() => setShareNote('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}
      {notProvisioned && (
        <div className="cc-card tr-banner warn" role="status"><AlertTriangle size={16} aria-hidden="true" /><div>Trip Replay is not enabled on this database yet. Apply <b>MIGRATIONS_V191_TRIP_SEGMENTS.sql</b>, then reload.</div></div>
      )}
      {(error || segError) && (
        <div className="cc-card tr-banner bad" role="alert">
          <AlertTriangle size={16} aria-hidden="true" />
          <div><b>{error ? 'Could not load trips.' : 'Could not load this trip.'}</b> {error || segError}</div>
          <button type="button" className="cc-btn" onClick={error ? loadTrips : loadSegments} disabled={refreshing || segLoading}><RotateCcw size={13} aria-hidden="true" /> Retry</button>
        </div>
      )}
      {actionError && (
        <div className="cc-card tr-banner bad" role="alert">
          <AlertTriangle size={16} aria-hidden="true" /><div>{actionError}</div>
          <button type="button" className="cc-icon-btn" onClick={() => setActionError('')} aria-label="Dismiss message"><X size={14} /></button>
        </div>
      )}

      <div className="cc-kpis tr-kpis">
        <Kpi icon={Truck} tone="t-green" loading={!tripsLoaded && !error} display={error ? 'N/A' : undefined} value={periodTrips.length}
          label={<>Trips in period<small className="tr-kpi-sub">{periodFrom || periodTo ? 'Filtered by first point date' : 'All recorded trips'}</small></>} />
        <Kpi icon={AlertTriangle} tone="t-red" loading={!segLoaded && !segError} display={!tripRef ? 'N/A' : undefined} value={k.harshEvents}
          label={<>Harsh events<small className="tr-kpi-sub">Selected trip</small></>} danger={k.harshEvents > 0} />
        <Kpi icon={ParkingCircle} tone="t-amber" loading={!segLoaded && !segError} display={!tripRef ? 'N/A' : undefined} value={k.stops}
          label={<>Stops and idles<small className="tr-kpi-sub">Selected trip. Authorised stops are not recorded</small></>} />
        <Kpi icon={Spline} tone="t-purple" display="N/A" label={<>Route deviation<small className="tr-kpi-sub">No planned route is recorded</small></>} />
        <Kpi icon={Fuel} tone="t-green" display="N/A" label={<>Fuel used<small className="tr-kpi-sub">Not recorded on trip segments</small></>} />
      </div>

      <div className="tr-grid">
        <div className="tr-main">
          <Card title="Select trip to replay" sub={tripsLoaded ? `${fmtInt(tripRows.length)} of ${fmtInt(periodTrips.length)} trips` : undefined}
            action={tripFiltersOn ? <button type="button" className="cc-link cc-link-btn" onClick={() => { setTripSearch(''); setTripAsset(''); setTripDriver('') }}>Clear</button> : null}>
            <div className="cc-filters tr-filters">
              <label className="cc-search"><Search size={14} aria-hidden="true" /><span className="sr-only">Find a trip</span>
                <input type="search" value={tripSearch} onChange={(e) => setTripSearch(e.target.value)} placeholder="Search trip, asset, driver" /></label>
              <select className="cc-select" aria-label="Filter trips by asset" value={tripAsset} onChange={(e) => setTripAsset(e.target.value)}>
                <option value="">All assets</option>{tripAssets.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              <select className="cc-select" aria-label="Filter trips by driver" value={tripDriver} onChange={(e) => setTripDriver(e.target.value)}>
                <option value="">All drivers</option>{tripDrivers.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <KitTable
              columns={tripColumns}
              rows={tripRows}
              getRowId={(t) => t.trip_ref}
              loading={!tripsLoaded && !error}
              error={error && !tripsLoaded ? error : null}
              onRetry={loadTrips}
              onRowClick={(t) => setTripRef(t.trip_ref)}
              initialPageSize={5}
              empty={notProvisioned ? 'Trip Replay is not enabled on this database yet.'
                : noTrips ? 'No trips recorded yet. Use Add segment to record the first breadcrumb of a trip.'
                  : 'No trips match these filters or this period.'}
            />
          </Card>

          <Card title="Route replay" sub={selectedTrip ? `${selectedTrip.trip_ref}${selectedTrip.asset_no ? ` | ${selectedTrip.asset_no}` : ''}` : 'No trip selected'}>
            <div className="tr-map">
              {!segLoaded && !segError && tripRef ? <div className="cc-skel" style={{ height: '100%' }} />
                : segError ? <div className="cc-empty" role="alert"><div>{segError}<br /><button type="button" className="cc-btn" onClick={loadSegments}>Try again</button></div></div>
                  : !geo ? <div className="cc-empty tr-map-empty"><div><Navigation size={22} aria-hidden="true" /><br />{replayEmpty}</div></div>
                    : (
                      <svg viewBox={`0 0 ${geo.w} ${geo.h}`} role="img" aria-label={`Route trace of ${geo.points.length} positioned points`} preserveAspectRatio="xMidYMid meet">
                        {geo.lines.map((l) => (
                          <line key={l.index} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={TONE_COLOR[l.tone]} strokeWidth="4" strokeLinecap="round"
                            opacity={l.index <= play.index ? 1 : 0.35} />
                        ))}
                        {geo.points.filter((p) => p.tone === 'harsh' || p.tone === 'speeding' || p.tone === 'stop').map((p) => (
                          <circle key={`m${p.index}`} cx={p.x} cy={p.y} r="6" fill={TONE_COLOR[p.tone]} stroke="var(--cc-card-flat)" strokeWidth="2"><title>{eventLabel(p.event)}</title></circle>
                        ))}
                        <circle cx={geo.points[0].x} cy={geo.points[0].y} r="8" fill="var(--cc-green)" stroke="#fff" strokeWidth="2"><title>Start</title></circle>
                        <rect x={geo.points[geo.points.length - 1].x - 7} y={geo.points[geo.points.length - 1].y - 7} width="14" height="14" rx="3" fill="var(--cc-ink)" stroke="#fff" strokeWidth="2"><title>End</title></rect>
                        {(() => {
                          const at = geo.points.filter((p) => p.index <= play.index).pop() || geo.points[0]
                          return <circle cx={at.x} cy={at.y} r="9" fill="none" stroke="var(--cc-ink)" strokeWidth="3"><title>Playback position</title></circle>
                        })()}
                      </svg>
                    )}
              {geo && (
                <div className="tr-legend">
                  <b>Route</b>
                  {Object.entries(TONE_LABEL).map(([k2, label]) => <div key={k2}><i style={{ background: TONE_COLOR[k2] }} aria-hidden="true" />{label}</div>)}
                  <small>Approx. {geo.kmAcross} km across. No base map is loaded.</small>
                </div>
              )}
            </div>
            <div className="tr-player">
              <button type="button" className="cc-icon-btn" onClick={() => { setPlaying(false); setPlayIdx(0) }} disabled={!segs.length} aria-label="Back to start"><SkipBack size={14} /></button>
              <button type="button" className="tr-play" onClick={playing ? () => setPlaying(false) : startReplay} disabled={!segs.length} aria-label={playing ? 'Pause replay' : 'Play replay'}>
                {playing ? <Pause size={16} /> : <Play size={16} />}
              </button>
              <button type="button" className="cc-icon-btn" onClick={() => { setPlaying(false); setPlayIdx(play.last) }} disabled={!segs.length} aria-label="Jump to end"><SkipForward size={14} /></button>
              <select className="cc-select" aria-label="Playback speed" value={playSpeed} onChange={(e) => setPlaySpeed(Number(e.target.value))}>
                {PLAY_SPEEDS.map((s) => <option key={s} value={s}>{s}x</option>)}
              </select>
              <input type="range" className="tr-range" min={0} max={Math.max(0, play.last)} value={play.index} disabled={!segs.length}
                onChange={(e) => { setPlaying(false); setPlayIdx(Number(e.target.value)) }} aria-label="Playback position" />
              <span className="tr-clock">{fmtClock(play.elapsedMin)} / {fmtClock(play.totalMin)}</span>
            </div>
            {cur && (
              <p className="tr-now">Point {play.index + 1} of {play.last + 1}: {fmtTime(cur.recorded_at)} | {fmtSpeed(cur.speed_kmh)} | <EventBadge type={cur.event_type} />{cur.address ? ` | ${cur.address}` : ''}</p>
            )}
          </Card>

          <Card title="Speed and events">
            <Tabs variant="line" label="Trip charts" value={chartTab} onChange={setChartTab} tabs={[
              { key: 'speed', label: 'Speed and events' }, { key: 'events', label: 'Event breakdown' },
              { key: 'elevation', label: 'Elevation' }, { key: 'rpm', label: 'Engine RPM' }, { key: 'fuel', label: 'Fuel rate' }, { key: 'pressure', label: 'Tyre pressure' },
            ]} />
            <div className="tr-chart">
              {!segLoaded && !segError && tripRef ? <div className="cc-skel" style={{ height: 150 }} />
                : chartTab === 'speed' ? (
                  !chart ? <div className="cc-empty">{segs.length ? 'No speed readings recorded for this trip.' : 'No trip data to chart.'}</div> : (
                    <svg viewBox={`0 0 ${chart.w} ${chart.h}`} role="img" aria-label={`Speed profile, peak ${fmtSpeed(k.maxKmh)}`} preserveAspectRatio="none">
                      {chart.yTicks.map((t) => (
                        <g key={t.v}><line x1={chart.padL} x2={chart.w} y1={t.y} y2={t.y} stroke="var(--cc-track)" /><text x={chart.padL - 6} y={t.y + 3} textAnchor="end" className="cc-axis">{t.v}</text></g>
                      ))}
                      <polygon points={chart.area} fill="var(--cc-green-tint)" />
                      <polyline points={chart.line} fill="none" stroke="var(--cc-green)" strokeWidth="2" />
                      {chart.markers.map((m) => <circle key={m.index} cx={m.x} cy={m.y} r="5" fill={TONE_COLOR[m.tone]}><title>{m.label}</title></circle>)}
                      {segs.length > 0 && <line x1={chart.xOf(play.index)} x2={chart.xOf(play.index)} y1={chart.yTicks[3].y} y2={chart.h - chart.padB} stroke="var(--cc-ink-2)" strokeDasharray="4 3" />}
                    </svg>
                  )
                ) : chartTab === 'events' ? (
                  !events.length ? <div className="cc-empty">No event types recorded for this trip.</div> : (
                    <ul className="tr-ev-bars">
                      {events.map((e) => (
                        <li key={e.type}><EventBadge type={e.type} /><span className="tr-bar"><i style={{ width: `${e.pct || 0}%`, background: isHarsh(e.type) ? 'var(--cc-red)' : 'var(--cc-green)' }} /></span><b>{e.count} | {e.pct == null ? 'N/A' : `${e.pct}%`}</b></li>
                      ))}
                      <li className="tr-note">{replayNarrative(k)}</li>
                    </ul>
                  )
                ) : <div className="cc-empty">Not recorded: trip_segments has no {chartTab === 'elevation' ? 'elevation' : chartTab === 'rpm' ? 'engine RPM' : chartTab === 'fuel' ? 'fuel rate' : 'tyre pressure'} column, so this chart cannot be drawn.</div>}
            </div>
          </Card>
        </div>

        <aside className="tr-side">
          <Card title="Trip summary">
            {!tripRef ? <div className="cc-empty">No trip selected.</div> : (
              <>
                <div className="tr-sum-head">
                  <VehicleThumb row={{ asset_no: selectedTrip?.asset_no }} size="lg" />
                  <div>
                    <b>{tripRef}</b>
                    <small>{selectedTrip?.asset_no || 'No asset'} | {selectedTrip?.driver_name || 'No driver recorded'}</small>
                    <small>{fmtTime(selectedTrip?.firstAt)} to {fmtTime(selectedTrip?.lastAt)}</small>
                  </div>
                </div>
                <div className="tr-sum-grid">
                  <div><Milestone size={15} aria-hidden="true" /><b>{segLoaded ? fmtKm(summary.distanceKm) : '...'}</b><span>Distance</span></div>
                  <div><Clock size={15} aria-hidden="true" /><b>{segLoaded ? fmtMin(summary.durationMin) : '...'}</b><span>Duration</span></div>
                  <div><Gauge size={15} aria-hidden="true" /><b>{segLoaded ? fmtSpeed(summary.avgKmh) : '...'}</b><span>Avg speed</span></div>
                  <div><Fuel size={15} aria-hidden="true" /><b><NotRecorded>N/A</NotRecorded></b><span>Fuel used</span></div>
                  <div><Activity size={15} aria-hidden="true" /><b><NotRecorded>N/A</NotRecorded></b><span>Efficiency</span></div>
                  <div><Leaf size={15} aria-hidden="true" /><b><NotRecorded>N/A</NotRecorded></b><span>Est. CO2</span></div>
                </div>
                <p className="tr-foot">Fuel, efficiency and CO2 need fuel readings, which trip segments do not carry.</p>
              </>
            )}
          </Card>

          <Card title="Events and alerts" action={tripRef ? <ViewAll onClick={scrollToSegments} /> : null}>
            {!tripRef ? (
              <ul className="tr-events tr-events-idle" aria-label="Events and alerts, no trip selected">
                {[['purple', MapPin, 'Geofence events'], ['bad', Gauge, 'Speed violations'], ['warn', Zap, 'Harsh driving'], ['info', Timer, 'Idle and stop time'], ['good', Fuel, 'Fuel burn'], ['bad', Flag, 'Toll passages']].map(([tone, Ic, label]) => (
                  <li key={label}><i className={`tr-ev-ic ${tone}`}><Ic size={13} /></i><span>{label}</span><small>Select a trip</small></li>
                ))}
              </ul>
            )
              : segError ? <div className="cc-empty" role="alert"><div>{segError}<br /><button type="button" className="cc-btn" onClick={loadSegments}>Try again</button></div></div>
                : (
                  <ul className="tr-events">
                    <li><i className="tr-ev-ic purple"><MapPin size={13} /></i><span>Geofence events</span><NotRecorded /></li>
                    <li><i className="tr-ev-ic bad"><Gauge size={13} /></i><span>Speed violations</span><b>{fmtInt(ev.speeding)}</b><small>{ev.maxSpeed == null ? 'No speeds' : `Peak ${fmtSpeed(ev.maxSpeed)}`}</small></li>
                    <li><i className="tr-ev-ic warn"><Zap size={13} /></i><span>Harsh driving</span><b>{fmtInt(ev.harsh)}</b><small>{ev.harshBreakdown.harsh_brake} braking, {ev.harshBreakdown.harsh_accel} acceleration, {ev.harshBreakdown.harsh_corner} cornering</small></li>
                    <li><i className="tr-ev-ic info"><Timer size={13} /></i><span>Idle and stop time</span><b>{ev.idleMin == null ? 'N/A' : fmtMin(ev.idleMin)}</b><small>{fmtInt(ev.stops)} stop{ev.stops === 1 ? '' : 's'}</small></li>
                    <li><i className="tr-ev-ic good"><Fuel size={13} /></i><span>Fuel burn</span><NotRecorded /></li>
                    <li><i className="tr-ev-ic bad"><Flag size={13} /></i><span>Toll passages</span><NotRecorded /></li>
                  </ul>
                )}
          </Card>

          <Card title="Stops and timeline" action={tripRef ? <ViewAll onClick={scrollToSegments} /> : null}>
            {!tripRef ? <div className="cc-empty">No trip selected.</div>
              : !segLoaded ? <div className="cc-skel" style={{ height: 120 }} />
                : timeline.length === 0 ? <div className="cc-empty">This trip has no breadcrumbs yet.</div>
                  : (
                    <ol className="tr-tl">
                      {timeline.map((e) => (
                        <li key={e.key} className={e.kind}><time>{fmtHm(e.at)}</time><i aria-hidden="true" /><span>{e.label}</span><small>{e.note}</small></li>
                      ))}
                    </ol>
                  )}
          </Card>
        </aside>
      </div>

      <div id="tr-segments" />
      <Card title="Trip segments" sub={`${fmtInt(filtered.length)} of ${fmtInt(segs.length)} breadcrumbs for ${tripRef || 'no trip'}`}
        action={hasFilters ? <button type="button" className="cc-link cc-link-btn" onClick={clearFilters}><X size={13} aria-hidden="true" /> Clear filters</button> : null}>
        <div className="cc-filters tr-filters">
          <label className="cc-search"><Search size={14} aria-hidden="true" /><span className="sr-only">Search segments</span>
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Event, asset, driver, address, notes" /></label>
          <select className="cc-select" aria-label="Filter segments by asset" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)}>
            <option value="">All assets</option>{assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="cc-select" aria-label="Filter segments by event" value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}>
            <option value="">All events</option>{events.map((e) => <option key={e.type} value={e.type}>{e.label}</option>)}
          </select>
          <label className="tr-check"><input type="checkbox" checked={harshOnly} onChange={(e) => setHarshOnly(e.target.checked)} /> Harsh events only</label>
        </div>
        <KitTable
          columns={segColumns}
          rows={filtered}
          getRowId={(r) => String(r.id)}
          loading={(!segLoaded || segLoading) && !segError && !error}
          error={segError && !segLoaded ? segError : null}
          onRetry={loadSegments}
          onRowClick={(r) => { const i = segs.findIndex((s) => s.id === r.id); if (i >= 0) { setPlaying(false); setPlayIdx(i) } }}
          empty={noTrips && !notProvisioned ? 'No trips recorded yet. Add your first segment.'
            : segs.length === 0 ? 'This trip has no segments. Add one to begin the replay.' : 'No segments match these filters.'}
        />
      </Card>

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
      <Modal open={compareOpen} onClose={() => setCompareOpen(false)} size="xl" title="Compare trips"
        subtitle={`${fmtInt(tripRows.length)} trip${tripRows.length === 1 ? '' : 's'} in the current period and filters, side by side`}>
        <KitTable
          columns={[
            { key: 'trip_ref', header: 'Trip ID', cell: (t) => <span className="cc-strong">{t.trip_ref}</span> },
            { key: 'asset_no', header: 'Asset', cell: (t) => t.asset_no || NA },
            { key: 'driver_name', header: 'Driver', cell: (t) => t.driver_name || NA },
            { key: 'firstAt', header: 'Start', sortValue: (t) => t.firstAt || '', cell: (t) => fmtTime(t.firstAt) },
            { key: 'durationMin', header: 'Duration', numeric: true, cell: (t) => fmtMin(t.durationMin) },
            { key: 'segments', header: 'Points', numeric: true, cell: (t) => fmtInt(t.segments) },
            { key: 'open', header: '', sortable: false, align: 'right', cell: (t) => (
              <button type="button" className="cc-btn-ghost" onClick={() => { setTripRef(t.trip_ref); setCompareOpen(false) }}>Replay</button>
            ) },
          ]}
          rows={tripRows}
          getRowId={(t) => t.trip_ref}
          initialPageSize={10}
          empty={noTrips ? 'No trips recorded yet, so there is nothing to compare.' : 'No trips match this period and these filters.'}
        />
        <p className="tr-foot">Distance, fuel and harsh events per trip need each trip&apos;s breadcrumbs; open a trip to see them. Fuel is not recorded on trip segments.</p>
      </Modal>
    </div>
  )
}
