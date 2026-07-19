/**
 * Tachograph (route /tachograph) — Tachograph Records. Captures EU driver
 * tachograph download records (driver card or vehicle unit) with aggregated
 * driving / rest / work / availability minutes, distance, and infringements.
 * This is the compliance backbone for driver-hours (EC 561/2006) analytics, so
 * every record is org-isolated and country-scoped.
 *
 * Runs on the new `tachograph_records` table (V183). Real data, KPI tiles, a
 * per-driver infringement roll-up, create/edit modal, filters, search, delete
 * confirm, Excel/PDF export, and loading/empty/error states throughout. The
 * infringement logic and roll-ups live in the pure `src/lib/tachographRecords.js`
 * helpers.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  FileClock, Users, ShieldAlert, BadgeAlert, AlertTriangle, Search, X, Filter,
  FileSpreadsheet, FileText, Plus, Pencil, Trash2, Clock,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listTachographRecords, createTachographRecord, updateTachographRecord,
  deleteTachographRecord,
} from '../lib/api/tachographRecords'
import { summariseTachograph, byDriver, hasInfringement } from '../lib/tachographRecords'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

const EMPTY_FORM = {
  driver_name: '', asset_no: '', card_number: '', record_date: '',
  download_type: '', driving_min: '', rest_min: '', work_min: '',
  available_min: '', distance_km: '', infringement_count: '',
  infringement_types: '', status: '', notes: '',
}

const DOWNLOAD_TYPES = [
  { value: 'driver_card', label: 'Driver card' },
  { value: 'vehicle_unit', label: 'Vehicle unit' },
]
const STATUSES = [
  { value: 'downloaded', label: 'Downloaded' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: 'flagged', label: 'Flagged' },
  { value: 'archived', label: 'Archived' },
]

const STATUS_BADGE = {
  downloaded: 'bg-sky-900/30 text-sky-300 border-sky-800/50',
  reviewed: 'bg-emerald-900/30 text-emerald-300 border-emerald-800/50',
  flagged: 'bg-red-900/30 text-red-300 border-red-800/50',
  archived: 'bg-slate-800/40 text-slate-400 border-slate-700/50',
}
const DL_LABEL = { driver_card: 'Driver card', vehicle_unit: 'Vehicle unit' }

const fmtHrs = (min) => {
  if (min == null || min === '') return '—'
  const n = Number(min)
  if (!Number.isFinite(n)) return '—'
  const h = Math.floor(n / 60)
  const m = Math.round(n % 60)
  return `${h}h ${String(m).padStart(2, '0')}m`
}
const fmtKm = (v) => (v == null || v === '' ? '—' : `${Number(v).toLocaleString()} km`)

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function fmtInfringementTypes(v) {
  if (v == null) return ''
  if (Array.isArray(v)) return v.join(', ')
  if (typeof v === 'object') {
    try { return JSON.stringify(v) } catch { return '' }
  }
  return String(v)
}

/** Parse the free-text infringement types field into an array (or null). */
function parseInfringementTypes(raw) {
  if (raw == null) return null
  const s = String(raw).trim()
  if (!s) return null
  if (s.startsWith('[') || s.startsWith('{')) {
    try { return JSON.parse(s) } catch { /* fall through to CSV */ }
  }
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean)
  return parts.length ? parts : null
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') ||
    m.includes('schema cache') || m.includes('could not find the table')
}

export default function Tachograph() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [notProvisioned, setNotProvisioned] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [countryFilter, setCountryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
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
      const data = await listTachographRecords({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) setNotProvisioned(true)
      else setError(toUserMessage(err, 'Could not load tachograph records.'))
      setRows([])
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summariseTachograph(rows || []), [rows])
  const drivers = useMemo(() => byDriver(rows || []), [rows])

  const countryOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.country).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (countryFilter && r.country !== countryFilter) return false
      if (statusFilter && r.status !== statusFilter) return false
      if (typeFilter && r.download_type !== typeFilter) return false
      if (q) {
        const hay = `${r.driver_name || ''} ${r.asset_no || ''} ${r.card_number || ''} ${r.notes || ''} ${fmtInfringementTypes(r.infringement_types)}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, countryFilter, statusFilter, typeFilter, search])

  // ── KPIs ─────────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Records', value: summary.totalRecords, icon: FileClock, tone: 'text-[var(--text-primary)]' },
    { label: 'Drivers', value: summary.distinctDrivers, icon: Users, tone: 'text-sky-400' },
    { label: 'Infringements', value: summary.totalInfringements, icon: ShieldAlert, tone: 'text-red-400' },
    { label: 'Flagged', value: summary.flaggedCount, icon: BadgeAlert, tone: 'text-amber-400' },
  ]

  // ── Export ───────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['driver_name', 'asset_no', 'card_number', 'record_date', 'download_type', 'driving_min', 'rest_min', 'work_min', 'available_min', 'distance_km', 'infringement_count', 'infringement_types', 'status', 'notes']
  const EXPORT_HEADERS = ['Driver', 'Asset', 'Card number', 'Record date', 'Download type', 'Driving (min)', 'Rest (min)', 'Work (min)', 'Available (min)', 'Distance (km)', 'Infringements', 'Infringement types', 'Status', 'Notes']
  const exportRows = filtered.map((r) => ({
    driver_name: r.driver_name || '', asset_no: r.asset_no || '',
    card_number: r.card_number || '', record_date: r.record_date || '',
    download_type: DL_LABEL[r.download_type] || r.download_type || '',
    driving_min: r.driving_min ?? '', rest_min: r.rest_min ?? '',
    work_min: r.work_min ?? '', available_min: r.available_min ?? '',
    distance_km: r.distance_km ?? '', infringement_count: r.infringement_count ?? '',
    infringement_types: fmtInfringementTypes(r.infringement_types),
    status: r.status || '', notes: r.notes || '',
  }))

  // ── Modal ────────────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditing(null); setForm(EMPTY_FORM); setFormError(''); setShowModal(true)
  }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      driver_name: r.driver_name || '', asset_no: r.asset_no || '',
      card_number: r.card_number || '', record_date: r.record_date || '',
      download_type: r.download_type || '', driving_min: r.driving_min ?? '',
      rest_min: r.rest_min ?? '', work_min: r.work_min ?? '',
      available_min: r.available_min ?? '', distance_km: r.distance_km ?? '',
      infringement_count: r.infringement_count ?? '',
      infringement_types: fmtInfringementTypes(r.infringement_types),
      status: r.status || '', notes: r.notes || '',
    })
    setFormError(''); setShowModal(true)
  }
  const closeModal = () => { if (!saving) { setShowModal(false); setEditing(null) } }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.driver_name.trim()) { setFormError('A driver name is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        infringement_types: parseInfringementTypes(form.infringement_types),
        download_type: form.download_type || null,
        status: form.status || null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) await updateTachographRecord(editing.id, payload)
      else await createTachographRecord(payload)
      setShowModal(false); setEditing(null)
      await load()
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save the record.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry, load])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteTachographRecord(confirmDelete.id)
      setConfirmDelete(null)
      await load()
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete the record.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete, load])

  const clearFilters = () => { setCountryFilter(''); setStatusFilter(''); setTypeFilter(''); setSearch('') }
  const hasFilters = countryFilter || statusFilter || typeFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tachograph Records"
        subtitle="EU driver tachograph downloads — driving, rest and work time with infringement tracking for EC 561/2006 compliance."
        icon={FileClock}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'tachograph_records')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Tachograph Records', 'tachograph_records', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5" disabled={notProvisioned}>
              <Plus size={14} /> Add record
            </button>
          </div>
        }
      />

      {notProvisioned && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Tachograph records aren’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V183_TACHOGRAPH_RECORDS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load tachograph records.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* By-driver infringement roll-up */}
      <div className="card">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-2">
          <ShieldAlert size={15} /> Infringements by driver
        </h3>
        {rows === null ? (
          <div className="h-16 bg-[var(--input-bg)] rounded animate-pulse" />
        ) : drivers.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No tachograph records yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {drivers.slice(0, 24).map((d) => (
              <div key={d.driver_name} className={`rounded-lg border px-3 py-2 ${d.infringements > 0 ? 'border-red-800/50 bg-red-900/10' : 'border-[var(--input-border)] bg-[var(--input-bg)]/40'}`}>
                <p className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                  {d.infringements > 0 && <ShieldAlert size={11} className="text-red-400" />} {d.driver_name}
                </p>
                <p className={`text-sm font-semibold ${d.infringements > 0 ? 'text-red-300' : 'text-[var(--text-primary)]'}`}>
                  {d.infringements} infringement{d.infringements === 1 ? '' : 's'}
                </p>
                <p className="text-[11px] text-[var(--text-muted)]">{d.records} record{d.records === 1 ? '' : 's'} · {fmtHrs(d.drivingMin)} driving</p>
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
            <input className="input pl-9 w-full" placeholder="Search driver, asset, card, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={countryFilter} onChange={(e) => setCountryFilter(e.target.value)} aria-label="Country">
            <option value="">All countries</option>
            {countryOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Download type">
            <option value="">All download types</option>
            {DOWNLOAD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.totalRecords}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Driver', 'Asset', 'Record date', 'Type', 'Driving', 'Rest', 'Distance', 'Infringements', 'Status', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={10} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 && !notProvisioned ? 'No tachograph records yet — add your first record.' : 'No records match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const infr = hasInfringement(r)
                  const count = Number(r.infringement_count) || 0
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.driver_name || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.asset_no || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(r.record_date)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{DL_LABEL[r.download_type] || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtHrs(r.driving_min)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtHrs(r.rest_min)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">{fmtKm(r.distance_km)}</td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {infr ? (
                          <span className="inline-flex items-center gap-1 rounded-md border border-red-800/50 bg-red-900/30 px-2 py-0.5 text-xs font-medium text-red-300">
                            <ShieldAlert size={12} /> {count > 0 ? count : 'Over limit'}
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--text-muted)]">None</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {r.status ? (
                          <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium capitalize ${STATUS_BADGE[r.status] || 'bg-slate-800/40 text-slate-400 border-slate-700/50'}`}>
                            {r.status}
                          </span>
                        ) : '—'}
                      </td>
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
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit record' : 'Add tachograph record'}</h3>
              <button onClick={closeModal} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Driver name</label>
                  <input className="input w-full" placeholder="e.g. J. Kowalski" value={form.driver_name} maxLength={200} onChange={(e) => set('driver_name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Asset number (optional)</label>
                  <input className="input w-full" placeholder="e.g. TRK-1042" value={form.asset_no} maxLength={120} onChange={(e) => set('asset_no', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Card number (optional)</label>
                  <input className="input w-full" placeholder="Driver card #" value={form.card_number} maxLength={120} onChange={(e) => set('card_number', e.target.value)} />
                </div>
                <div>
                  <label className="label">Record date</label>
                  <input className="input w-full" type="date" value={form.record_date} onChange={(e) => set('record_date', e.target.value)} />
                  <p className="text-[11px] text-[var(--text-muted)] mt-1">Leave blank to use today.</p>
                </div>
                <div>
                  <label className="label">Download type</label>
                  <select className="input w-full" value={form.download_type} onChange={(e) => set('download_type', e.target.value)}>
                    <option value="">—</option>
                    {DOWNLOAD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <label className="label">Driving (min)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="0" value={form.driving_min} onChange={(e) => set('driving_min', e.target.value)} />
                </div>
                <div>
                  <label className="label">Rest (min)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="0" value={form.rest_min} onChange={(e) => set('rest_min', e.target.value)} />
                </div>
                <div>
                  <label className="label">Work (min)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="0" value={form.work_min} onChange={(e) => set('work_min', e.target.value)} />
                </div>
                <div>
                  <label className="label">Available (min)</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="0" value={form.available_min} onChange={(e) => set('available_min', e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">Distance (km)</label>
                  <input className="input w-full" type="number" step="0.1" min="0" placeholder="0" value={form.distance_km} onChange={(e) => set('distance_km', e.target.value)} />
                </div>
                <div>
                  <label className="label">Infringement count</label>
                  <input className="input w-full" type="number" step="1" min="0" placeholder="0" value={form.infringement_count} onChange={(e) => set('infringement_count', e.target.value)} />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    <option value="">—</option>
                    {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Infringement types (optional)</label>
                <input className="input w-full" placeholder="e.g. Daily driving exceeded, Insufficient rest" value={form.infringement_types} onChange={(e) => set('infringement_types', e.target.value)} />
                <p className="text-[11px] text-[var(--text-muted)] mt-1">Comma-separated, or a JSON array/object.</p>
              </div>
              <div>
                <label className="label">Notes (optional)</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="e.g. reviewed against roster" value={form.notes} maxLength={8000} onChange={(e) => set('notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Add record'}
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
                <h3 className="text-[var(--text-primary)] font-semibold">Delete this record?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {confirmDelete.driver_name || 'Record'} · {fmtDate(confirmDelete.record_date)} · <Clock size={11} className="inline" /> {fmtHrs(confirmDelete.driving_min)}. This can’t be undone.
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
