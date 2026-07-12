/**
 * TripReplay (route /trip-replay) — Trip Replay. Reconstructs and analyses a
 * single trip from its ordered GPS breadcrumb segments: great-circle distance
 * travelled, stops/idles, harsh driving events (brake / accel / corner /
 * speeding), and a speed profile over the path. Pick a trip, walk its timeline
 * segment by segment, and read the derived KPIs — the operational lens on "what
 * actually happened on this journey", complementing live GPS Tracking and
 * Odometer Logs.
 *
 * Runs on the new `trip_segments` table (V191). Real data, KPI tiles, trip
 * selector, ordered timeline table, speed-profile + event breakdown panels,
 * filters, search, create/edit modal, delete confirm, Excel/PDF export, and
 * loading / empty / error / not-provisioned states throughout. All trip
 * analytics live in the pure `src/lib/tripReplay.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Navigation, MapPin, Gauge, Activity, TrendingUp, Truck, AlertTriangle,
  Search, X, Filter, FileSpreadsheet, FileText, Plus, Pencil, Trash2,
  Milestone, StopCircle, Zap, Timer, Flag, Clock, ListOrdered, ArrowRight,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listTripSegments, listTripRefs, createTripSegment, updateTripSegment,
  deleteTripSegment,
} from '../lib/api/tripReplay'
import {
  summariseTrip, orderSegments, countEvents, speedProfile, EVENT_TYPES,
} from '../lib/tripReplay'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const EMPTY_FORM = {
  trip_ref: '', asset_no: '', driver_name: '', sequence: '', latitude: '',
  longitude: '', speed_kmh: '', heading: '', event_type: '', recorded_at: '',
  address: '', notes: '',
}

// Presentation metadata for each event type: label, badge tone, and icon.
const EVENT_META = {
  move:         { label: 'Move',        cls: 'bg-sky-900/30 text-sky-300 border-sky-800/50' },
  stop:         { label: 'Stop',        cls: 'bg-slate-700/40 text-slate-300 border-slate-600/50' },
  idle:         { label: 'Idle',        cls: 'bg-slate-700/40 text-slate-300 border-slate-600/50' },
  harsh_brake:  { label: 'Harsh brake', cls: 'bg-red-900/30 text-red-300 border-red-800/50' },
  harsh_accel:  { label: 'Harsh accel', cls: 'bg-orange-900/30 text-orange-300 border-orange-800/50' },
  harsh_corner: { label: 'Harsh corner',cls: 'bg-amber-900/30 text-amber-300 border-amber-800/50' },
  speeding:     { label: 'Speeding',    cls: 'bg-fuchsia-900/30 text-fuchsia-300 border-fuchsia-800/50' },
  none:         { label: '—',           cls: 'bg-[var(--input-bg)] text-[var(--text-muted)] border-[var(--input-border)]' },
}

const HARSH_SET = new Set(['harsh_brake', 'harsh_accel', 'harsh_corner', 'speeding'])

const fmtKm = (v) => (v == null ? '—' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })} km`)
const fmtSpeed = (v) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })} km/h`)
const fmtNum = (v, d = 1) => (v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: d }))

function fmtTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
}
function fmtCoord(lat, lng) {
  if (lat == null || lat === '' || lng == null || lng === '') return '—'
  return `${Number(lat).toFixed(4)}, ${Number(lng).toFixed(4)}`
}

function EventBadge({ type }) {
  const meta = EVENT_META[type] || EVENT_META.none
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.cls}`}>
      {meta.label}
    </span>
  )
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

export default function TripReplay() {
  const { activeCountry } = useSettings()

  const [trips, setTrips] = useState(null)      // trip summaries for the selector
  const [tripRef, setTripRef] = useState('')     // selected trip
  const [segments, setSegments] = useState(null) // segments of the selected trip

  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [segLoading, setSegLoading] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [assetFilter, setAssetFilter] = useState('')
  const [eventFilter, setEventFilter] = useState('')
  const [search, setSearch] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // ── Load the list of trips (selector) ──────────────────────────────────────
  const loadTrips = useCallback(async () => {
    setRefreshing(true); setError(''); setNotProvisioned(false)
    try {
      const data = await listTripRefs({ country: activeCountry })
      const list = Array.isArray(data) ? data : []
      setTrips(list)
      setUpdatedAt(new Date())
      setTripRef((cur) => {
        if (cur && list.some((t) => t.trip_ref === cur)) return cur
        return list[0]?.trip_ref || ''
      })
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load trips.')
      setTrips([])
      setTripRef('')
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { loadTrips() }, [loadTrips])

  // ── Load the segments of the selected trip ─────────────────────────────────
  const loadSegments = useCallback(async () => {
    if (!tripRef) { setSegments([]); return }
    setSegLoading(true); setError('')
    try {
      const data = await listTripSegments({ country: activeCountry, tripRef })
      setSegments(orderSegments(Array.isArray(data) ? data : []))
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load trip segments.')
      setSegments([])
    } finally {
      setSegLoading(false)
    }
  }, [tripRef, activeCountry])

  useEffect(() => { loadSegments() }, [loadSegments])

  const reloadAll = useCallback(async () => {
    await loadTrips()
    await loadSegments()
  }, [loadTrips, loadSegments])

  // ── Derived analytics (pure helpers) ───────────────────────────────────────
  const summary = useMemo(() => summariseTrip(segments || []), [segments])
  const events = useMemo(() => countEvents(segments || []), [segments])
  const speed = useMemo(() => speedProfile(segments || []), [segments])

  const selectedTrip = useMemo(
    () => (trips || []).find((t) => t.trip_ref === tripRef) || null,
    [trips, tripRef],
  )

  const assetOptions = useMemo(
    () => [...new Set((segments || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [segments],
  )
  const eventOptions = useMemo(
    () => EVENT_TYPES.filter((t) => (events[t] || 0) > 0),
    [events],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (segments || []).filter((r) => {
      if (assetFilter && r.asset_no !== assetFilter) return false
      if (eventFilter && r.event_type !== eventFilter) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.driver_name || ''} ${r.address || ''} ${r.notes || ''} ${r.event_type || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [segments, assetFilter, eventFilter, search])

  // ── KPI tiles (5+) ─────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Distance travelled', value: fmtKm(summary.distanceKm), icon: Milestone, tone: 'text-sky-400' },
    { label: 'Breadcrumb segments', value: summary.segments, icon: ListOrdered, tone: 'text-[var(--text-primary)]' },
    { label: 'Stops / idles', value: summary.stops, icon: StopCircle, tone: 'text-amber-400' },
    { label: 'Harsh events', value: summary.harshEvents, icon: Zap, tone: summary.harshEvents > 0 ? 'text-red-400' : 'text-green-400' },
    { label: 'Max speed', value: fmtSpeed(summary.maxKmh), icon: Gauge, tone: 'text-violet-400' },
    { label: 'Avg speed', value: fmtSpeed(summary.avgKmh), icon: Activity, tone: 'text-teal-400' },
  ]

  // ── Export ─────────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['sequence', 'recorded_at', 'event_type', 'speed_kmh', 'heading', 'latitude', 'longitude', 'address', 'asset_no', 'driver_name', 'notes']
  const EXPORT_HEADERS = ['Seq', 'Time', 'Event', 'Speed (km/h)', 'Heading', 'Latitude', 'Longitude', 'Address', 'Asset', 'Driver', 'Notes']
  const exportRows = filtered.map((r) => ({
    sequence: r.sequence ?? '', recorded_at: r.recorded_at || '',
    event_type: r.event_type || '', speed_kmh: r.speed_kmh ?? '',
    heading: r.heading ?? '', latitude: r.latitude ?? '', longitude: r.longitude ?? '',
    address: r.address || '', asset_no: r.asset_no || '',
    driver_name: r.driver_name || '', notes: r.notes || '',
  }))
  const exportName = `trip_${(tripRef || 'replay').replace(/[^a-z0-9_-]+/gi, '_')}`

  // ── Modal ──────────────────────────────────────────────────────────────────
  const openCreate = () => {
    const nextSeq = (segments || []).reduce((m, r) => Math.max(m, Number(r.sequence) || 0), 0) + 1
    setEditing(null)
    setForm({ ...EMPTY_FORM, trip_ref: tripRef || '', sequence: String(nextSeq) })
    setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      trip_ref: r.trip_ref || '', asset_no: r.asset_no || '', driver_name: r.driver_name || '',
      sequence: r.sequence ?? '', latitude: r.latitude ?? '', longitude: r.longitude ?? '',
      speed_kmh: r.speed_kmh ?? '', heading: r.heading ?? '', event_type: r.event_type || '',
      recorded_at: r.recorded_at ? new Date(r.recorded_at).toISOString().slice(0, 16) : '',
      address: r.address || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.trip_ref.trim()) { setFormError('A trip reference is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateTripSegment(editing.id, payload)
      else await createTripSegment(payload)
      setShowModal(false); setEditing(null)
      // A new trip_ref may have been introduced — refresh the selector too.
      if (!editing && payload.trip_ref !== tripRef) setTripRef(payload.trip_ref.trim())
      await reloadAll()
    } catch (err) {
      setFormError(err?.message || 'Could not save the segment.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, tripRef, reloadAll])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteTripSegment(confirmDelete.id)
      setConfirmDelete(null)
      await reloadAll()
    } catch (err) {
      setError(err?.message || 'Could not delete the segment.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, reloadAll])

  const clearFilters = () => { setAssetFilter(''); setEventFilter(''); setSearch('') }
  const hasFilters = assetFilter || eventFilter || search

  const loadingInitial = trips === null
  const noTrips = trips !== null && trips.length === 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trip Replay"
        subtitle="Reconstruct a journey from its ordered GPS breadcrumbs — distance travelled, stops, harsh driving events, and the full speed profile, segment by segment."
        icon={Navigation}
        onRefresh={reloadAll}
        refreshing={refreshing || segLoading}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, exportName)} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), `Trip Replay — ${tripRef || ''}`.trim(), exportName, 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Add segment
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Trip Replay isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V191_TRIP_SEGMENTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Something went wrong.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* Trip selector */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Flag size={15} /> Trip
          </div>
          <select
            className="input min-w-[220px]"
            value={tripRef}
            onChange={(e) => setTripRef(e.target.value)}
            disabled={loadingInitial || noTrips}
            aria-label="Select trip"
          >
            {loadingInitial && <option value="">Loading…</option>}
            {noTrips && <option value="">No trips yet</option>}
            {(trips || []).map((t) => (
              <option key={t.trip_ref} value={t.trip_ref}>
                {t.trip_ref} · {t.segments} pts{t.asset_no ? ` · ${t.asset_no}` : ''}
              </option>
            ))}
          </select>
          {selectedTrip && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)] ml-auto">
              {selectedTrip.asset_no && <span className="inline-flex items-center gap-1"><Truck size={13} /> {selectedTrip.asset_no}</span>}
              {selectedTrip.driver_name && <span className="inline-flex items-center gap-1"><MapPin size={13} /> {selectedTrip.driver_name}</span>}
              <span className="inline-flex items-center gap-1"><Clock size={13} /> {fmtTime(selectedTrip.firstAt)}</span>
              <ArrowRight size={12} />
              <span className="inline-flex items-center gap-1">{fmtTime(selectedTrip.lastAt)}</span>
            </div>
          )}
        </div>
        {!loadingInitial && !noTrips && (
          <p className="text-xs text-[var(--text-muted)]">
            {trips.length} trip{trips.length === 1 ? '' : 's'} available · showing the reconstructed path for the selected trip below.
          </p>
        )}
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-2xl font-bold mt-1 ${k.tone}`}>{segments === null ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Speed profile + event breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Gauge size={15} /> Speed profile
          </h3>
          {segments === null ? (
            <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-3">
                <p className="text-[11px] text-[var(--text-muted)]">Peak</p>
                <p className="text-xl font-bold text-violet-400">{fmtNum(speed.maxKmh)}</p>
                <p className="text-[11px] text-[var(--text-muted)]">km/h</p>
              </div>
              <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-3">
                <p className="text-[11px] text-[var(--text-muted)]">Average</p>
                <p className="text-xl font-bold text-teal-400">{fmtNum(speed.avgKmh)}</p>
                <p className="text-[11px] text-[var(--text-muted)]">km/h all pts</p>
              </div>
              <div className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-3">
                <p className="text-[11px] text-[var(--text-muted)]">Moving avg</p>
                <p className="text-xl font-bold text-sky-400">{fmtNum(speed.movingAvgKmh)}</p>
                <p className="text-[11px] text-[var(--text-muted)]">km/h in motion</p>
              </div>
            </div>
          )}
          {/* Sparkline-style speed bars along the ordered path */}
          {segments && segments.length > 0 && (
            <div className="mt-4">
              <p className="text-[11px] text-[var(--text-muted)] mb-1.5">Speed along the path</p>
              <div className="flex items-end gap-[2px] h-16">
                {segments.slice(0, 120).map((r, i) => {
                  const spd = Number(r.speed_kmh) || 0
                  const max = speed.maxKmh || 1
                  const h = Math.max(3, Math.round((spd / max) * 100))
                  const harsh = HARSH_SET.has(r.event_type)
                  return (
                    <div
                      key={r.id || i}
                      className={`flex-1 min-w-[2px] rounded-sm ${harsh ? 'bg-red-500/70' : 'bg-sky-500/60'}`}
                      style={{ height: `${h}%` }}
                      title={`#${r.sequence ?? i + 1} · ${fmtSpeed(r.speed_kmh)}${r.event_type ? ` · ${r.event_type}` : ''}`}
                    />
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
            <Timer size={15} /> Event breakdown
          </h3>
          {segments === null ? (
            <div className="h-24 bg-[var(--input-bg)] rounded animate-pulse" />
          ) : summary.segments === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No segments for this trip yet.</p>
          ) : (
            <div className="space-y-2">
              {EVENT_TYPES.filter((t) => (events[t] || 0) > 0).map((t) => {
                const count = events[t]
                const pctv = summary.segments ? Math.round((count / summary.segments) * 100) : 0
                const meta = EVENT_META[t] || EVENT_META.none
                return (
                  <div key={t} className="flex items-center gap-3">
                    <div className="w-28 shrink-0"><EventBadge type={t} /></div>
                    <div className="flex-1 h-2.5 rounded-full bg-[var(--input-bg)] overflow-hidden">
                      <div className={`h-full rounded-full ${HARSH_SET.has(t) ? 'bg-red-500/70' : t === 'move' ? 'bg-sky-500/70' : 'bg-slate-400/60'}`} style={{ width: `${pctv}%` }} />
                    </div>
                    <span className="text-xs text-[var(--text-secondary)] w-16 text-right tabular-nums">{count} · {pctv}%</span>
                  </div>
                )
              })}
              <p className="text-[11px] text-[var(--text-muted)] pt-1">{meta_hint(summary)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search event, asset, driver, address, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="input" value={eventFilter} onChange={(e) => setEventFilter(e.target.value)} aria-label="Event type">
            <option value="">All events</option>
            {eventOptions.map((t) => <option key={t} value={t}>{(EVENT_META[t] || EVENT_META.none).label}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.segments}</span>
        </div>
      </div>

      {/* Timeline table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Seq', 'Time', 'Event', 'Speed', 'Heading', 'Position', 'Address', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {segments === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {noTrips && !notProvisioned ? 'No trips recorded yet — add your first segment.'
                    : summary.segments === 0 ? 'This trip has no segments — add one to begin the replay.'
                      : 'No segments match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 1000).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-mono text-[var(--text-secondary)] tabular-nums">{r.sequence ?? '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtTime(r.recorded_at)}</td>
                    <td className="px-4 py-2.5"><EventBadge type={r.event_type} /></td>
                    <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)] whitespace-nowrap">{fmtSpeed(r.speed_kmh)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] tabular-nums">{r.heading == null ? '—' : `${Math.round(r.heading)}°`}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)] whitespace-nowrap">{fmtCoord(r.latitude, r.longitude)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] max-w-[220px] truncate" title={r.address || ''}>{r.address || '—'}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                        <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 1000 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 1000 — refine filters or export for the full set.</p>}
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit segment' : 'Add trip segment'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Trip reference</label>
                  <input className="input w-full" placeholder="e.g. TRIP-2026-0042" value={form.trip_ref} maxLength={200} onChange={(e) => set('trip_ref', e.target.value)} />
                </div>
                <div>
                  <label className="label">Sequence</label>
                  <input className="input w-full" type="number" step="1" placeholder="1" value={form.sequence} onChange={(e) => set('sequence', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number (optional)</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Driver (optional)</label>
                  <input className="input w-full" placeholder="e.g. A. Khan" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Latitude</label>
                  <input className="input w-full" type="number" step="any" placeholder="24.7136" value={form.latitude} onChange={(e) => set('latitude', e.target.value)} />
                </div>
                <div>
                  <label className="label">Longitude</label>
                  <input className="input w-full" type="number" step="any" placeholder="46.6753" value={form.longitude} onChange={(e) => set('longitude', e.target.value)} />
                </div>
                <div>
                  <label className="label">Heading (°)</label>
                  <input className="input w-full" type="number" step="any" min="0" placeholder="180" value={form.heading} onChange={(e) => set('heading', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Speed (km/h)</label>
                  <input className="input w-full" type="number" step="any" min="0" placeholder="80" value={form.speed_kmh} onChange={(e) => set('speed_kmh', e.target.value)} />
                </div>
                <div>
                  <label className="label">Event type</label>
                  <select className="input w-full" value={form.event_type} onChange={(e) => set('event_type', e.target.value)}>
                    <option value="">—</option>
                    {EVENT_TYPES.map((t) => <option key={t} value={t}>{(EVENT_META[t] || EVENT_META.none).label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Recorded at</label>
                  <input className="input w-full" type="datetime-local" value={form.recorded_at} onChange={(e) => set('recorded_at', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Address / place (optional)</label>
                <input className="input w-full" placeholder="e.g. King Fahd Rd, Riyadh" value={form.address} maxLength={500} onChange={(e) => set('address', e.target.value)} />
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[70px] resize-y" placeholder="e.g. sharp braking near junction" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Add segment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="card w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
              <div>
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this segment?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  Seq {confirmDelete.sequence ?? '—'} · {(EVENT_META[confirmDelete.event_type] || EVENT_META.none).label} · {fmtTime(confirmDelete.recorded_at)}. This can’t be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={deleting}>
                <Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Short narrative under the event breakdown — turns counts into a takeaway.
function meta_hint(summary) {
  if (!summary.segments) return ''
  if (summary.harshEvents === 0) return 'No harsh driving events detected on this trip.'
  const rate = Math.round((summary.harshEvents / summary.segments) * 100)
  return `${summary.harshEvents} harsh event${summary.harshEvents === 1 ? '' : 's'} across ${summary.segments} segments (${rate}%) — review driver coaching if this is recurring.`
}
