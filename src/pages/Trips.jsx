/**
 * Trips (route /trips) — Trip History / Trip Replay. Records completed and
 * in-flight journeys per asset, whether entered manually, imported from an ERP,
 * or read off a telematics feed. Trip history is the basis for utilisation,
 * driver-behaviour, CPK, and tyre-life analytics, so every trip is org-isolated
 * and country-scoped.
 *
 * Runs on the new `trips` table (V164). Real data, KPI tiles, create/edit modal,
 * filters, search, delete confirm, Excel/PDF export, and loading/empty/error
 * states throughout. Fleet KPI roll-ups and per-asset totals live in the pure
 * `src/lib/trips.js` helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Navigation, MapPin, Clock, TrendingUp, Truck, Play,
  AlertTriangle, Search, X, Filter, FileSpreadsheet, FileText, Plus, Pencil, Trash2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listTrips, createTrip, updateTrip, deleteTrip,
} from '../lib/api/trips'
import { summariseTrips, perAssetTotals } from '../lib/trips'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const EMPTY_FORM = {
  asset_no: '', driver_name: '', origin: '', destination: '',
  started_at: '', ended_at: '', distance_km: '', duration_min: '',
  max_speed_kmh: '', avg_speed_kmh: '', idle_min: '', status: '', notes: '',
}

const STATUS_OPTIONS = [
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

const STATUS_STYLES = {
  planned: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  in_progress: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  completed: 'bg-green-500/15 text-green-300 border-green-500/30',
  cancelled: 'bg-red-500/15 text-red-300 border-red-500/30',
}

const fmtKm = (v) =>
  v == null || v === '' ? '—' : `${Number(v).toLocaleString()} km`

const fmtMin = (v) => {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  if (n < 60) return `${Math.round(n)} min`
  const h = Math.floor(n / 60)
  const m = Math.round(n % 60)
  return m ? `${h}h ${m}m` : `${h}h`
}

const fmtSpeed = (v) =>
  v == null || v === '' ? '—' : `${Number(v).toLocaleString()} km/h`

function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

function statusLabel(v) {
  return STATUS_OPTIONS.find((s) => s.value === v)?.label || (v || '—')
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

export default function Trips() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [assetFilter, setAssetFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
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
      const data = await listTrips({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(err?.message || 'Could not load trips.')
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseTrips(rows || []), [rows])
  const byAsset = useMemo(() => perAssetTotals(rows || []), [rows])

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (assetFilter && r.asset_no !== assetFilter) return false
      if (statusFilter && r.status !== statusFilter) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.driver_name || ''} ${r.origin || ''} ${r.destination || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, assetFilter, statusFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Trips logged', value: summary.totalTrips, icon: Navigation, tone: 'text-[var(--text-primary)]' },
    { label: 'Total distance', value: `${Math.round(summary.totalDistanceKm).toLocaleString()} km`, icon: TrendingUp, tone: 'text-sky-400' },
    { label: 'Total drive time', value: fmtMin(summary.totalDurationMin), icon: Clock, tone: 'text-amber-400' },
    { label: 'Active now', value: summary.activeCount, icon: Play, tone: 'text-green-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['asset_no', 'driver_name', 'origin', 'destination', 'started_at', 'ended_at', 'distance_km', 'duration_min', 'max_speed_kmh', 'avg_speed_kmh', 'idle_min', 'status', 'notes']
  const EXPORT_HEADERS = ['Asset', 'Driver', 'Origin', 'Destination', 'Started', 'Ended', 'Distance (km)', 'Duration (min)', 'Max speed (km/h)', 'Avg speed (km/h)', 'Idle (min)', 'Status', 'Notes']
  const exportRows = filtered.map((r) => ({
    asset_no: r.asset_no || '', driver_name: r.driver_name || '',
    origin: r.origin || '', destination: r.destination || '',
    started_at: r.started_at || '', ended_at: r.ended_at || '',
    distance_km: r.distance_km ?? '', duration_min: r.duration_min ?? '',
    max_speed_kmh: r.max_speed_kmh ?? '', avg_speed_kmh: r.avg_speed_kmh ?? '',
    idle_min: r.idle_min ?? '', status: statusLabel(r.status), notes: r.notes || '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const toLocalInput = (v) => {
    if (!v) return ''
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return ''
    const off = d.getTimezoneOffset()
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
  }
  const openEdit = (r) => {
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
        status: form.status || null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateTrip(editing.id, payload)
      else await createTrip(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(err?.message || 'Could not save the trip.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteTrip(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Could not delete the trip.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setAssetFilter(''); setStatusFilter(''); setSearch('') }
  const hasFilters = assetFilter || statusFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trip History"
        subtitle="Record and replay journeys per asset — origin, destination, distance, timing, and speed. The basis for utilisation, driver-behaviour, and CPK analytics."
        icon={Navigation}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'trips')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Trip History', 'trips', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Log trip
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Trip history isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V164_TRIPS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load trips.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Per-asset distance snapshot */}
      <div className="card">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <Truck size={15} /> Distance by asset
        </h3>
        {rows === null ? (
          <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : byAsset.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No trips logged yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {byAsset.slice(0, 24).map((a) => (
              <div key={a.asset_no} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)]/40 px-3 py-2">
                <p className="text-xs text-[var(--text-muted)]">{a.asset_no}</p>
                <p className="text-sm font-semibold text-[var(--text-primary)]">{fmtKm(a.distanceKm)}</p>
                <p className="text-[11px] text-[var(--text-muted)]">{a.trips} trip{a.trips === 1 ? '' : 's'} · {fmtMin(a.durationMin)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, driver, origin, destination, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalTrips}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Asset', 'Route', 'Started', 'Distance', 'Duration', 'Avg speed', 'Status', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No trips logged yet — log your first trip.' : 'No trips match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.asset_no || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                        <MapPin size={13} className="text-[var(--text-muted)]" />
                        {(r.origin || '—')}<span className="text-[var(--text-muted)]">→</span>{(r.destination || '—')}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.started_at)}</td>
                    <td className="px-4 py-2.5 font-semibold text-[var(--text-primary)]">{fmtKm(r.distance_km)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtMin(r.duration_min)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtSpeed(r.avg_speed_kmh)}</td>
                    <td className="px-4 py-2.5">
                      {r.status ? (
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[r.status] || 'bg-slate-500/15 text-slate-300 border-slate-500/30'}`}>
                          {statusLabel(r.status)}
                        </span>
                      ) : <span className="text-[var(--text-muted)]">—</span>}
                    </td>
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
        {filtered.length > 500 && <p className="px-4 py-2 text-xs text-[var(--text-muted)] border-t border-[var(--input-border)]">Showing first 500 — refine filters or export for the full set.</p>}
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={closeModal}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit trip' : 'Log trip'}</h3>
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
                  <label className="label">Origin (optional)</label>
                  <input className="input w-full" placeholder="e.g. Riyadh depot" value={form.origin} maxLength={300} onChange={(e) => set('origin', e.target.value)} />
                </div>
                <div>
                  <label className="label">Destination (optional)</label>
                  <input className="input w-full" placeholder="e.g. Dammam yard" value={form.destination} maxLength={300} onChange={(e) => set('destination', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Started (optional)</label>
                  <input className="input w-full" type="datetime-local" value={form.started_at} onChange={(e) => set('started_at', e.target.value)} />
                </div>
                <div>
                  <label className="label">Ended (optional)</label>
                  <input className="input w-full" type="datetime-local" value={form.ended_at} onChange={(e) => set('ended_at', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Distance (km)</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="320" value={form.distance_km} onChange={(e) => set('distance_km', e.target.value)} />
                </div>
                <div>
                  <label className="label">Duration (min)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="240" value={form.duration_min} onChange={(e) => set('duration_min', e.target.value)} />
                </div>
                <div>
                  <label className="label">Idle (min)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="30" value={form.idle_min} onChange={(e) => set('idle_min', e.target.value)} />
                </div>
                <div>
                  <label className="label">Max speed (km/h)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="95" value={form.max_speed_kmh} onChange={(e) => set('max_speed_kmh', e.target.value)} />
                </div>
                <div>
                  <label className="label">Avg speed (km/h)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="80" value={form.avg_speed_kmh} onChange={(e) => set('avg_speed_kmh', e.target.value)} />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    <option value="">—</option>
                    {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="e.g. detour via ring road, heavy traffic" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Log trip'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this trip?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.asset_no || 'Trip'} · {(confirmDelete.origin || '—')} → {(confirmDelete.destination || '—')} · {fmtKm(confirmDelete.distance_km)}. This can’t be undone.
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
