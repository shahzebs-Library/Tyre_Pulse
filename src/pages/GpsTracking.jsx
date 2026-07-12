/**
 * GpsTracking (route /gps-tracking) — GPS Tracking / Position History. Captures
 * time-series GPS position pings per asset (from telematics feeds, manual entry
 * or ERP), so movement, location, speed, idle time and route history can be
 * reconstructed. Position history underpins utilisation, idle-cost and route
 * analytics, so every ping is org-isolated and country-scoped.
 *
 * Runs on the new `gps_positions` table (V171). Real data, KPI tiles, a
 * latest-position-per-asset snapshot, the full ping log, create/edit modal,
 * filters, search, delete confirm, Excel/PDF export, and loading/empty/error
 * states throughout. Per-asset roll-ups and the fleet KPI summary live in the
 * pure `src/lib/gpsPositions.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  MapPin, Navigation, Activity, Truck, AlertTriangle, Search, X, Filter,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, Power,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listGpsPositions, createGpsPosition, updateGpsPosition, deleteGpsPosition,
} from '../lib/api/gpsPositions'
import { summarisePositions, latestPerAsset, toFiniteNumber } from '../lib/gpsPositions'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const EMPTY_FORM = {
  asset_no: '', driver_name: '', latitude: '', longitude: '', speed_kmh: '',
  heading: '', altitude_m: '', ignition: false, odometer_km: '', recorded_at: '',
  address: '', notes: '',
}

const fmtSpeed = (v) =>
  v == null || v === '' ? '—' : `${Number(v).toLocaleString()} km/h`

const fmtLatLng = (r) => {
  const lat = toFiniteNumber(r?.latitude)
  const lng = toFiniteNumber(r?.longitude)
  if (lat == null || lng == null) return '—'
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

/** Motion state of a single ping: moving | idle | stopped. */
function motionOf(r) {
  const spd = toFiniteNumber(r?.speed_kmh) ?? 0
  if (spd > 0) return 'moving'
  if (r?.ignition === true) return 'idle'
  return 'stopped'
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

const MOTION_BADGE = {
  moving: 'bg-green-900/30 text-green-300 border-green-800/50',
  idle: 'bg-amber-900/30 text-amber-300 border-amber-800/50',
  stopped: 'bg-slate-700/40 text-[var(--text-muted)] border-[var(--input-border)]',
}
const MOTION_LABEL = { moving: 'Moving', idle: 'Idle', stopped: 'Stopped' }

export default function GpsTracking() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [assetFilter, setAssetFilter] = useState('')
  const [motionFilter, setMotionFilter] = useState('') // '', 'moving', 'idle'
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
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load GPS positions.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarisePositions(rows || []), [rows])
  const latest = useMemo(() => latestPerAsset(rows || []), [rows])

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (assetFilter && r.asset_no !== assetFilter) return false
      if (motionFilter && motionOf(r) !== motionFilter) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.driver_name || ''} ${r.address || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, assetFilter, motionFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Total pings', value: summary.totalPings, icon: Activity, tone: 'text-[var(--text-primary)]' },
    { label: 'Tracked assets', value: summary.distinctAssets, icon: Truck, tone: 'text-sky-400' },
    { label: 'Moving now', value: summary.movingCount, icon: Navigation, tone: 'text-green-400' },
    { label: 'Idle now', value: summary.idleCount, icon: Power, tone: 'text-amber-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['asset_no', 'driver_name', 'latitude', 'longitude', 'speed_kmh', 'heading', 'ignition', 'odometer_km', 'recorded_at', 'address']
  const EXPORT_HEADERS = ['Asset', 'Driver', 'Latitude', 'Longitude', 'Speed (km/h)', 'Heading', 'Ignition', 'Odometer (km)', 'Recorded at', 'Address']
  const exportRows = filtered.map((r) => ({
    asset_no: r.asset_no || '', driver_name: r.driver_name || '',
    latitude: r.latitude ?? '', longitude: r.longitude ?? '',
    speed_kmh: r.speed_kmh ?? '', heading: r.heading ?? '',
    ignition: r.ignition == null ? '' : r.ignition ? 'On' : 'Off',
    odometer_km: r.odometer_km ?? '', recorded_at: r.recorded_at || '',
    address: r.address || '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
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
  }
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
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateGpsPosition(editing.id, payload)
      else await createGpsPosition(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(err?.message || 'Could not save the position.')
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
      setError(err?.message || 'Could not delete the position.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setAssetFilter(''); setMotionFilter(''); setSearch('') }
  const hasFilters = assetFilter || motionFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="GPS Tracking"
        subtitle="Capture and track GPS position history per asset over time — the location, speed and idle basis for utilisation, idle-cost and route analytics."
        icon={MapPin}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'gps_positions')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'GPS Tracking — Position History', 'gps_positions', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Log position
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">GPS tracking isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V171_GPS_POSITIONS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load GPS positions.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} />
              </div>
              <p className={`text-3xl font-bold mt-1 ${k.tone}`}>{rows === null ? '—' : k.value}</p>
            </div>
          )
        })}
      </div>

      {/* Latest-per-asset snapshot */}
      <div className="card">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <Navigation size={15} /> Latest position per asset
        </h3>
        {rows === null ? (
          <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : latest.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No positions logged yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                  {['Asset', 'Driver', 'State', 'Speed', 'Coordinates', 'Last seen'].map((h, i) => <th key={i} className="px-4 py-2.5 font-semibold whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {latest
                  .slice()
                  .sort((a, b) => (new Date(b.recorded_at || 0)) - (new Date(a.recorded_at || 0)))
                  .slice(0, 50)
                  .map((r) => {
                    const m = motionOf(r)
                    return (
                      <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                        <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.asset_no || '—'}</td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.driver_name || '—'}</td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${MOTION_BADGE[m]}`}>{MOTION_LABEL[m]}</span>
                        </td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtSpeed(r.speed_kmh)}</td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap font-mono text-xs">{fmtLatLng(r)}</td>
                        <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.recorded_at)}</td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, driver, address, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="input" value={motionFilter} onChange={(e) => setMotionFilter(e.target.value)} aria-label="Motion state">
            <option value="">All states</option>
            <option value="moving">Moving</option>
            <option value="idle">Idle</option>
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalPings}</span>
        </div>
      </div>

      {/* Ping log table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Asset', 'Driver', 'State', 'Speed', 'Coordinates', 'Heading', 'Recorded at', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No positions logged yet — log your first position.' : 'No positions match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const m = motionOf(r)
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.asset_no || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.driver_name || '—'}</td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${MOTION_BADGE[m]}`}>{MOTION_LABEL[m]}</span>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtSpeed(r.speed_kmh)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap font-mono text-xs">{fmtLatLng(r)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{r.heading == null || r.heading === '' ? '—' : `${Number(r.heading).toFixed(0)}°`}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.recorded_at)}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit position' : 'Log GPS position'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Driver (optional)</label>
                  <input className="input w-full" placeholder="e.g. A. Khan" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Latitude</label>
                  <input className="input w-full" type="number" step="any" min="-90" max="90" placeholder="24.71355" value={form.latitude} onChange={(e) => set('latitude', e.target.value)} />
                </div>
                <div>
                  <label className="label">Longitude</label>
                  <input className="input w-full" type="number" step="any" min="-180" max="180" placeholder="46.67529" value={form.longitude} onChange={(e) => set('longitude', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Speed (km/h)</label>
                  <input className="input w-full" type="number" step="any" min="0" placeholder="60" value={form.speed_kmh} onChange={(e) => set('speed_kmh', e.target.value)} />
                </div>
                <div>
                  <label className="label">Heading (°)</label>
                  <input className="input w-full" type="number" step="any" min="0" max="360" placeholder="180" value={form.heading} onChange={(e) => set('heading', e.target.value)} />
                </div>
                <div>
                  <label className="label">Altitude (m)</label>
                  <input className="input w-full" type="number" step="any" placeholder="612" value={form.altitude_m} onChange={(e) => set('altitude_m', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Odometer (km) (optional)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="45000" value={form.odometer_km} onChange={(e) => set('odometer_km', e.target.value)} />
                </div>
                <div>
                  <label className="label">Recorded at</label>
                  <input className="input w-full" type="datetime-local" value={form.recorded_at} onChange={(e) => set('recorded_at', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use now.</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <input id="gps-ignition" type="checkbox" className="h-4 w-4 rounded border-[var(--input-border)]" checked={!!form.ignition} onChange={(e) => set('ignition', e.target.checked)} />
                <label htmlFor="gps-ignition" className="label !mb-0 cursor-pointer">Ignition on</label>
              </div>
              <div>
                <label className="label">Address (optional)</label>
                <input className="input w-full" placeholder="e.g. King Fahd Rd, Riyadh" value={form.address} maxLength={400} onChange={(e) => set('address', e.target.value)} />
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="e.g. geofence entry, telematics fix" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Log position'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this position?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.asset_no || 'Position'} · {fmtLatLng(confirmDelete)} · {fmtDateTime(confirmDelete.recorded_at)}. This can’t be undone.
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
