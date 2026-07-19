/**
 * VehicleCheckInOut (route /vehicle-checkinout) — logs vehicle handovers. A
 * driver checks a vehicle OUT (odometer, fuel level, condition) and later back
 * IN. Full CRUD on the org/country-scoped `vehicle_checkinout` table with KPI
 * tiles, filters, search, create/edit modal, delete confirmation, Excel/PDF
 * export and loading/empty/error states. Degrades gracefully when the table is
 * absent, prompting for MIGRATIONS_V144_VEHICLE_CHECKINOUT.sql.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ArrowRightLeft, LogIn, LogOut, Plus, Search, Filter, X, Pencil, Trash2,
  FileSpreadsheet, FileText, AlertTriangle, Loader2, Car, Gauge, CheckCircle2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listCheckInOut, createEntry, updateEntry, deleteEntry, isMissingCheckInOutTable,
  DIRECTIONS, STATUSES,
} from '../lib/api/vehicleCheckInOut'
import { summarizeCheckInOut } from '../lib/vehicleCheckInOut'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

const DIRECTION_META = {
  out: { label: 'Checked out', icon: LogOut, cls: 'bg-sky-900/40 text-sky-300 border border-sky-700/50' },
  in: { label: 'Checked in', icon: LogIn, cls: 'bg-green-900/40 text-green-300 border border-green-700/50' },
}
const STATUS_META = {
  open: { label: 'Open', cls: 'bg-amber-900/40 text-amber-300 border border-amber-700/50' },
  closed: { label: 'Closed', cls: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]' },
}
const FUEL_LEVELS = ['Empty', '1/4', '1/2', '3/4', 'Full']

const EMPTY_FORM = {
  asset_no: '', driver_name: '', direction: 'out', odometer_km: '',
  fuel_level: '', condition_notes: '', site: '', status: 'open',
}

function fmtDateTime(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}
function toLocalInput(v) {
  const d = v ? new Date(v) : new Date()
  if (Number.isNaN(d.getTime())) return ''
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16)
}

export default function VehicleCheckInOut() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [directionFilter, setDirectionFilter] = useState('all')
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
      const data = await listCheckInOut({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingCheckInOutTable(err)) { setMissing(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load check-in/out entries.')); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeCheckInOut(rows || []), [rows])

  const assetOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.asset_no).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (directionFilter !== 'all' && r.direction !== directionFilter) return false
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (assetFilter && r.asset_no !== assetFilter) return false
      if (q) {
        const hay = `${r.asset_no || ''} ${r.driver_name || ''} ${r.site || ''} ${r.condition_notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, directionFilter, statusFilter, assetFilter, search])

  const kpis = [
    { label: 'Total entries', value: summary.total, icon: ArrowRightLeft, tone: 'text-[var(--text-primary)]' },
    { label: 'Currently out', value: summary.currentlyOut, icon: LogOut, tone: 'text-sky-400' },
    { label: 'Returned', value: summary.returned, icon: LogIn, tone: 'text-green-400' },
    { label: 'Assets tracked', value: summary.assets, icon: Car, tone: 'text-amber-400' },
  ]

  const openCreate = (direction = 'out') => {
    setEditing(null)
    setForm({ ...EMPTY_FORM, direction, checked_at: toLocalInput() })
    setFormError('')
    setModalOpen(true)
  }
  const openEdit = (row) => {
    setEditing(row)
    setForm({
      asset_no: row.asset_no || '',
      driver_name: row.driver_name || '',
      direction: row.direction || 'out',
      odometer_km: row.odometer_km ?? '',
      fuel_level: row.fuel_level || '',
      condition_notes: row.condition_notes || '',
      site: row.site || '',
      status: row.status || 'open',
      checked_at: toLocalInput(row.checked_at),
    })
    setFormError('')
    setModalOpen(true)
  }
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.asset_no.trim()) { setFormError('An asset number is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        country: activeCountry !== 'All' ? activeCountry : null,
        checked_at: form.checked_at ? new Date(form.checked_at).toISOString() : undefined,
      }
      if (editing) {
        const updated = await updateEntry(editing.id, payload)
        setRows((prev) => (prev || []).map((r) => (r.id === updated.id ? updated : r)))
      } else {
        const created = await createEntry(payload)
        setRows((prev) => [created, ...(prev || [])])
      }
      setModalOpen(false)
      setUpdatedAt(new Date())
    } catch (err) {
      setFormError(toUserMessage(err, 'Could not save this entry.'))
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deleteEntry(confirmDelete.id)
      setRows((prev) => (prev || []).filter((r) => r.id !== confirmDelete.id))
      setConfirmDelete(null)
    } catch (err) {
      setError(toUserMessage(err, 'Could not delete this entry.'))
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete])

  const EXPORT_COLS = ['checked_at', 'direction', 'status', 'asset_no', 'driver_name', 'odometer_km', 'fuel_level', 'site', 'condition_notes']
  const EXPORT_HEADERS = ['Date/Time', 'Direction', 'Status', 'Asset', 'Driver', 'Odometer (km)', 'Fuel', 'Site', 'Condition notes']
  const exportRows = filtered.map((r) => ({
    checked_at: fmtDateTime(r.checked_at),
    direction: DIRECTION_META[r.direction]?.label || r.direction,
    status: STATUS_META[r.status]?.label || r.status,
    asset_no: r.asset_no || '',
    driver_name: r.driver_name || '',
    odometer_km: r.odometer_km ?? '',
    fuel_level: r.fuel_level || '',
    site: r.site || '',
    condition_notes: r.condition_notes || '',
  }))

  const clearFilters = () => { setDirectionFilter('all'); setStatusFilter('all'); setAssetFilter(''); setSearch('') }
  const hasFilters = directionFilter !== 'all' || statusFilter !== 'all' || assetFilter || search

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vehicle Check In/Out"
        subtitle="Log vehicle handovers — odometer, fuel level and condition on every check-out and return."
        icon={ArrowRightLeft}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'vehicle_checkinout')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Vehicle Check In/Out', 'vehicle_checkinout', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={() => openCreate('out')} className="btn-secondary text-sm inline-flex items-center gap-1.5">
              <LogOut size={14} /> Check out
            </button>
            <button onClick={() => openCreate('in')} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> Check in
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Vehicle check-in/out isn't enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V144_VEHICLE_CHECKINOUT.sql</span>, then reload.
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
            <input className="input pl-9 w-full" placeholder="Search asset, driver, site, notes…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={directionFilter} onChange={(e) => setDirectionFilter(e.target.value)} aria-label="Direction">
            <option value="all">All directions</option>
            {DIRECTIONS.map((d) => <option key={d} value={d}>{DIRECTION_META[d].label}</option>)}
          </select>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
          </select>
          <select className="input" value={assetFilter} onChange={(e) => setAssetFilter(e.target.value)} aria-label="Asset">
            <option value="">All assets</option>
            {assetOptions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          {hasFilters && <button onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto">{filtered.length} of {summary.total}</span>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden !p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--input-border)] text-left text-xs uppercase tracking-wider text-[var(--text-muted)]">
                {['Date/Time', 'Direction', 'Asset', 'Driver', 'Odometer', 'Fuel', 'Site', 'Status', ''].map((h) => (
                  <th key={h || 'actions'} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Filter size={22} className="mx-auto mb-2 opacity-60" />
                  {summary.total === 0 ? 'No handovers logged yet. Use “Check out” or “Check in” to record one.' : 'No entries match these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const dir = DIRECTION_META[r.direction] || DIRECTION_META.out
                  const DirIcon = dir.icon
                  const st = STATUS_META[r.status] || STATUS_META.open
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 text-[var(--text-muted)] whitespace-nowrap">{fmtDateTime(r.checked_at)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`badge text-[11px] px-2 py-0.5 rounded inline-flex items-center gap-1 ${dir.cls}`}>
                          <DirIcon size={11} /> {dir.label}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{r.asset_no || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.driver_name || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap">
                        {r.odometer_km == null ? '—' : (
                          <span className="inline-flex items-center gap-1"><Gauge size={12} className="text-[var(--text-muted)]" />{Number(r.odometer_km).toLocaleString()} km</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.fuel_level || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}</td>
                      <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span></td>
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

      {/* Create / edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => !saving && setModalOpen(false)}>
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[var(--text-primary)] inline-flex items-center gap-2">
                {form.direction === 'in' ? <LogIn size={18} className="text-green-400" /> : <LogOut size={18} className="text-sky-400" />}
                {editing ? 'Edit handover' : (form.direction === 'in' ? 'Vehicle check-in' : 'Vehicle check-out')}
              </h2>
              <button onClick={() => setModalOpen(false)} className="p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close"><X size={18} /></button>
            </div>

            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">Asset number <span className="text-red-400">*</span></label>
                  <input className="input w-full" placeholder="e.g. TRK-045" value={form.asset_no} maxLength={120} onChange={(e) => setField('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Driver</label>
                  <input className="input w-full" placeholder="Driver name" value={form.driver_name} maxLength={200} onChange={(e) => setField('driver_name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Direction</label>
                  <select className="input w-full" value={form.direction} onChange={(e) => setField('direction', e.target.value)}>
                    {DIRECTIONS.map((d) => <option key={d} value={d}>{DIRECTION_META[d].label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => setField('status', e.target.value)}>
                    {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Odometer (km)</label>
                  <input type="number" min={0} className="input w-full" placeholder="45000" value={form.odometer_km} onChange={(e) => setField('odometer_km', e.target.value)} />
                </div>
                <div>
                  <label className="label">Fuel level</label>
                  <select className="input w-full" value={form.fuel_level} onChange={(e) => setField('fuel_level', e.target.value)}>
                    <option value="">Not recorded</option>
                    {FUEL_LEVELS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Site</label>
                  <input className="input w-full" placeholder="Depot / branch" value={form.site} maxLength={200} onChange={(e) => setField('site', e.target.value)} />
                </div>
                <div>
                  <label className="label">Date / time</label>
                  <input type="datetime-local" className="input w-full" value={form.checked_at || ''} onChange={(e) => setField('checked_at', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Condition notes</label>
                <textarea className="input w-full min-h-[90px] resize-y" placeholder="Damage, defects, cleanliness or other remarks…" value={form.condition_notes} maxLength={4000} onChange={(e) => setField('condition_notes', e.target.value)} />
              </div>

              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-60" disabled={saving}>
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                  {saving ? 'Saving…' : (editing ? 'Save changes' : 'Record handover')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-900/30 flex items-center justify-center shrink-0"><Trash2 size={18} className="text-red-400" /></div>
              <div className="min-w-0">
                <h3 className="font-semibold text-[var(--text-primary)]">Delete this handover?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  {DIRECTION_META[confirmDelete.direction]?.label || 'Entry'} for <span className="font-mono text-[var(--text-secondary)]">{confirmDelete.asset_no}</span> on {fmtDateTime(confirmDelete.checked_at)}. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDelete(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
              <button onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-2 disabled:opacity-60" disabled={deleting}>
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
