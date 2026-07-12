/**
 * JourneyLog (route /journeys) — record and track vehicle journeys/trips across
 * the fleet: asset, driver, origin → destination, scheduled/actual times,
 * distance and purpose, with a lightweight status lifecycle (planned →
 * in_progress → completed / cancelled).
 *
 * Real data, KPI tiles, search + filters, create/edit modal, delete confirm,
 * Excel/PDF export and full loading/empty/error states. Runs on the `journeys`
 * table (MIGRATIONS_V139_JOURNEYS.sql); a missing relation surfaces an
 * "apply the migration" empty state instead of an error.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Navigation, Plus, Search, X, Filter, FileSpreadsheet, FileText,
  AlertTriangle, Loader2, Route, PlayCircle, Gauge, Pencil, Trash2, Send,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listJourneys, createJourney, updateJourney, deleteJourney,
} from '../lib/api/journeys'
import {
  summarizeJourneys, journeyDurationHours, JOURNEY_STATUSES, JOURNEY_STATUS_META,
} from '../lib/journeys'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const STATUS_BADGE = {
  planned: 'bg-sky-900/40 text-sky-300 border border-sky-700/50',
  in_progress: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  completed: 'bg-green-900/40 text-green-300 border border-green-700/50',
  cancelled: 'bg-red-900/40 text-red-300 border border-red-700/50',
}

const EMPTY_FORM = {
  asset_no: '', driver_name: '', origin: '', destination: '', purpose: '',
  start_time: '', end_time: '', distance_km: '', site: '', status: 'planned', notes: '',
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}
function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}
// A timestamptz → the value an <input type="datetime-local"> expects (local, no tz).
function toLocalInput(v) {
  if (!v) return ''
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function JourneyLog() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [assetFilter, setAssetFilter] = useState('')
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
      const data = await listJourneys({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(err?.message || 'Could not load journeys.'); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeJourneys(rows || []), [rows])
  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (assetFilter && r.asset_no !== assetFilter) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.driver_name || ''} ${r.origin || ''} ${r.destination || ''} ${r.purpose || ''} ${r.site || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, assetFilter, search])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setModalOpen(true)
  }
  const openEdit = (j) => {
    setEditing(j)
    setForm({
      asset_no: j.asset_no || '', driver_name: j.driver_name || '', origin: j.origin || '',
      destination: j.destination || '', purpose: j.purpose || '',
      start_time: toLocalInput(j.start_time), end_time: toLocalInput(j.end_time),
      distance_km: j.distance_km ?? '', site: j.site || '', status: j.status || 'planned',
      notes: j.notes || '',
    })
    setFormError(''); setModalOpen(true)
  }

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset (vehicle) number is required.'); return }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry !== 'All' ? activeCountry : null }
      if (editing) {
        const updated = await updateJourney(editing.id, payload)
        setRows((prev) => (prev || []).map((r) => (r.id === updated.id ? updated : r)))
      } else {
        const created = await createJourney(payload)
        setRows((prev) => [created, ...(prev || [])])
      }
      setModalOpen(false)
    } catch (err) {
      setFormError(err?.message || 'Could not save the journey.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteJourney(confirmDelete.id)
      setRows((prev) => (prev || []).filter((r) => r.id !== confirmDelete.id))
      setConfirmDelete(null)
    } catch (err) {
      setError(err?.message || 'Could not delete the journey.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete])

  const clearFilters = () => { setStatusFilter('all'); setAssetFilter(''); setSearch('') }
  const hasFilters = statusFilter !== 'all' || assetFilter || search

  const EXPORT_COLS = ['asset_no', 'driver_name', 'origin', 'destination', 'purpose', 'start_time', 'end_time', 'distance_km', 'site', 'status']
  const EXPORT_HEADERS = ['Asset', 'Driver', 'Origin', 'Destination', 'Purpose', 'Start', 'End', 'Distance (km)', 'Site', 'Status']
  const exportRows = filtered.map((r) => ({
    asset_no: r.asset_no || '', driver_name: r.driver_name || '', origin: r.origin || '',
    destination: r.destination || '', purpose: r.purpose || '',
    start_time: fmtDateTime(r.start_time), end_time: fmtDateTime(r.end_time),
    distance_km: r.distance_km ?? '', site: r.site || '',
    status: JOURNEY_STATUS_META[r.status]?.label || r.status || '',
  }))

  const kpis = [
    { label: 'Total journeys', value: summary.totalTrips, icon: Navigation, tone: 'text-[var(--text-primary)]' },
    { label: 'In progress', value: summary.byStatus.in_progress, icon: PlayCircle, tone: 'text-amber-400' },
    { label: 'Total distance (km)', value: summary.totalDistance, icon: Route, tone: 'text-sky-400' },
    { label: 'Avg distance (km)', value: summary.avgDistance, icon: Gauge, tone: 'text-emerald-400' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Journey Log"
        subtitle="Record and track vehicle journeys — asset, driver, route, timing, distance and purpose."
        icon={Navigation}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'journey_log')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Journey Log', 'journey_log', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> New journey
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Journey Log isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V139_JOURNEYS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load journeys.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search asset, driver, route, purpose…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {JOURNEY_STATUSES.map((s) => <option key={s} value={s}>{JOURNEY_STATUS_META[s]?.label || s}</option>)}
          </select>
          <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
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
                {['Asset', 'Driver', 'Route', 'Purpose', 'Start', 'Distance', 'Duration', 'Status', ''].map((h) => <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  {(rows.length === 0 && !missing) ? (
                    <div className="space-y-3">
                      <Navigation size={26} className="mx-auto opacity-60" />
                      <p className="text-[var(--text-primary)] font-medium">No journeys recorded yet.</p>
                      <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5"><Plus size={14} /> Log your first journey</button>
                    </div>
                  ) : (
                    <><Filter size={22} className="mx-auto mb-2 opacity-60" />No journeys match these filters.</>
                  )}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const dur = journeyDurationHours(r)
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{r.asset_no || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.driver_name || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{r.origin || '—'} <span className="text-[var(--text-muted)]">→</span> {r.destination || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.purpose || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDateTime(r.start_time)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.distance_km == null ? '—' : `${r.distance_km} km`}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{dur == null ? '—' : `${dur} h`}</td>
                      <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_BADGE[r.status] || STATUS_BADGE.planned}`}>{JOURNEY_STATUS_META[r.status]?.label || r.status}</span></td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" title="Delete"><Trash2 size={14} /></button>
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

      {/* Create / edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--input-border)] rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
            <div className="sticky top-0 bg-[var(--card-bg)] border-b border-[var(--input-border)] px-6 py-4 flex items-center justify-between">
              <h2 className="font-bold text-[var(--text-primary)]">{editing ? 'Edit journey' : 'New journey'}</h2>
              <button onClick={() => setModalOpen(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset (vehicle) no <span className="text-red-400">*</span></label>
                  <input className="input w-full" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} placeholder="e.g. DXB-A-12345" />
                </div>
                <div>
                  <label className="label">Driver</label>
                  <input className="input w-full" value={form.driver_name} maxLength={160} onChange={(e) => set('driver_name', e.target.value)} placeholder="Driver name" />
                </div>
                <div>
                  <label className="label">Origin</label>
                  <input className="input w-full" value={form.origin} maxLength={240} onChange={(e) => set('origin', e.target.value)} placeholder="Dubai Industrial Area" />
                </div>
                <div>
                  <label className="label">Destination</label>
                  <input className="input w-full" value={form.destination} maxLength={240} onChange={(e) => set('destination', e.target.value)} placeholder="Mussafah, Abu Dhabi" />
                </div>
                <div>
                  <label className="label">Start time</label>
                  <input type="datetime-local" className="input w-full" value={form.start_time} onChange={(e) => set('start_time', e.target.value)} />
                </div>
                <div>
                  <label className="label">End time</label>
                  <input type="datetime-local" className="input w-full" value={form.end_time} onChange={(e) => set('end_time', e.target.value)} />
                </div>
                <div>
                  <label className="label">Distance (km)</label>
                  <input type="number" min="0" step="0.1" className="input w-full" value={form.distance_km} onChange={(e) => set('distance_km', e.target.value)} placeholder="0" />
                </div>
                <div>
                  <label className="label">Purpose</label>
                  <input className="input w-full" value={form.purpose} maxLength={240} onChange={(e) => set('purpose', e.target.value)} placeholder="Delivery / Collection / Service…" />
                </div>
                <div>
                  <label className="label">Site</label>
                  <input className="input w-full" value={form.site} maxLength={200} onChange={(e) => set('site', e.target.value)} placeholder="Depot / branch" />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {JOURNEY_STATUSES.map((s) => <option key={s} value={s}>{JOURNEY_STATUS_META[s]?.label || s}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea className="input w-full min-h-[80px] resize-y" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} placeholder="Waypoints, load, routing constraints…" />
              </div>
              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}
              <div className="flex items-center gap-3 pt-1">
                <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary text-sm flex-1">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary text-sm flex-1 inline-flex items-center justify-center gap-2 disabled:opacity-60">
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  {saving ? 'Saving…' : (editing ? 'Save changes' : 'Create journey')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
          <div className="bg-[var(--card-bg)] border border-[var(--input-border)] rounded-2xl w-full max-w-md shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
              <div>
                <h3 className="font-bold text-[var(--text-primary)]">Delete journey?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  This permanently removes the journey for <span className="font-mono text-[var(--text-secondary)]">{confirmDelete.asset_no || 'this asset'}</span>
                  {confirmDelete.origin || confirmDelete.destination ? ` (${confirmDelete.origin || '—'} → ${confirmDelete.destination || '—'})` : ''}. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm flex-1" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} disabled={deleting} className="text-sm flex-1 inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-medium disabled:opacity-60">
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
