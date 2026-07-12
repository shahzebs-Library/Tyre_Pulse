/**
 * Equipment (route /equipment) — Tool & Equipment Registry.
 *
 * Registers workshop tools and equipment (tyre changers, balancers, torque
 * wrenches, jacks, gauges …) with serial, assigned site, condition, calibration
 * due date and lifecycle status. Full CRUD with role-gated writes (Admin /
 * Manager / Director), KPI tiles, status + type + search filters, calibration
 * highlighting, Excel/PDF export, and loading / empty / error states.
 *
 * Runs on the `equipment` table (V150). Pure KPI logic lives in
 * `src/lib/equipment.js`; Supabase access is behind `src/lib/api/equipment.js`.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Wrench, Plus, Pencil, Trash2, Search, X, Filter, Save, Loader2,
  AlertTriangle, FileSpreadsheet, FileText, PackageCheck, CalendarClock,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import {
  listEquipment, createEquipment, updateEquipment, deleteEquipment,
} from '../lib/api/equipment'
import {
  summarizeEquipment, calibrationDue, EQUIPMENT_STATUSES,
} from '../lib/equipment'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const WRITE_ROLES = ['Admin', 'Manager', 'Director']

const STATUS_META = {
  available: { label: 'Available', cls: 'bg-green-900/40 text-green-300 border border-green-700/50' },
  in_use: { label: 'In use', cls: 'bg-sky-900/40 text-sky-300 border border-sky-700/50' },
  maintenance: { label: 'Maintenance', cls: 'bg-amber-900/40 text-amber-300 border border-amber-700/50' },
  retired: { label: 'Retired', cls: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]' },
}

const EMPTY_FORM = {
  name: '', equipment_type: '', serial_no: '', site: '',
  condition: '', calibration_due: '', status: 'available', notes: '',
}

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}

// ─── Create / edit modal ──────────────────────────────────────────────────────
function EquipmentModal({ initial, onClose, onSaved }) {
  const { activeCountry } = useSettings() || {}
  const editing = Boolean(initial?.id)
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, ...(initial || {}) }))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!form.name.trim()) { setError('Please enter an equipment name.'); return }
    setBusy(true)
    try {
      const payload = {
        name: form.name,
        equipment_type: form.equipment_type,
        serial_no: form.serial_no,
        site: form.site,
        condition: form.condition,
        calibration_due: form.calibration_due || null,
        status: form.status,
        notes: form.notes,
      }
      let row
      if (editing) {
        row = await updateEquipment(initial.id, payload)
      } else {
        row = await createEquipment({
          ...payload,
          country: activeCountry && activeCountry !== 'All' ? activeCountry : null,
        })
      }
      onSaved(row, editing)
    } catch (err) {
      setError(err?.message || 'Could not save this equipment record.')
    } finally {
      setBusy(false)
    }
  }, [form, editing, initial, activeCountry, onSaved])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onClose}>
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
            <Wrench size={18} className="text-[var(--brand-bright)]" />
            {editing ? 'Edit equipment' : 'Register equipment'}
          </h2>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={18} /></button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="label">Name <span className="text-red-400">*</span></label>
            <input className="input w-full" placeholder="e.g. Hydraulic bottle jack 20T" value={form.name} maxLength={200} onChange={(e) => set('name', e.target.value)} autoFocus />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Type</label>
              <input className="input w-full" placeholder="e.g. Torque wrench, Balancer" value={form.equipment_type} maxLength={120} onChange={(e) => set('equipment_type', e.target.value)} />
            </div>
            <div>
              <label className="label">Serial number</label>
              <input className="input w-full" placeholder="Manufacturer serial" value={form.serial_no} maxLength={120} onChange={(e) => set('serial_no', e.target.value)} />
            </div>
            <div>
              <label className="label">Assigned site</label>
              <input className="input w-full" placeholder="Workshop / depot" value={form.site} maxLength={200} onChange={(e) => set('site', e.target.value)} />
            </div>
            <div>
              <label className="label">Condition</label>
              <input className="input w-full" placeholder="e.g. Good, Fair, Needs repair" value={form.condition} maxLength={120} onChange={(e) => set('condition', e.target.value)} />
            </div>
            <div>
              <label className="label">Calibration due</label>
              <input type="date" className="input w-full" value={form.calibration_due || ''} onChange={(e) => set('calibration_due', e.target.value)} />
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {EQUIPMENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea className="input w-full min-h-[90px] resize-y" placeholder="Maintenance history, accessories, location detail…" value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
            <button type="submit" disabled={busy} className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-60">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Register'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Delete confirm ───────────────────────────────────────────────────────────
function DeleteConfirm({ item, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const go = async () => {
    setBusy(true); setError('')
    try { await onConfirm() } catch (err) { setError(err?.message || 'Delete failed.'); setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onClick={onCancel}>
      <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
          <Trash2 size={18} className="text-red-400" /> Delete equipment
        </h2>
        <p className="text-sm text-[var(--text-secondary)] mt-3">
          Delete <span className="font-semibold text-[var(--text-primary)]">{item.name}</span>? This cannot be undone.
        </p>
        {error && <p className="text-xs text-red-300 mt-2">{error}</p>}
        <div className="flex items-center justify-end gap-2 mt-5">
          <button type="button" onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
          <button type="button" onClick={go} disabled={busy} className="btn-primary text-sm inline-flex items-center gap-2 !bg-red-600 hover:!bg-red-500 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Equipment() {
  const { activeCountry } = useSettings()
  const { profile } = useAuth() || {}
  const canWrite = WRITE_ROLES.includes(profile?.role)

  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('')
  const [search, setSearch] = useState('')

  const [modal, setModal] = useState(null)   // { item } | null
  const [toDelete, setToDelete] = useState(null)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listEquipment({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(err?.message || 'Could not load equipment.'); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const now = Date.now()
  const summary = useMemo(() => summarizeEquipment(rows || [], now), [rows, now])

  const typeOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.equipment_type).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (typeFilter && r.equipment_type !== typeFilter) return false
      if (q) {
        const hay = `${r.name || ''} ${r.serial_no || ''} ${r.equipment_type || ''} ${r.site || ''} ${r.condition || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, typeFilter, search])

  const onSaved = useCallback((row, editing) => {
    setModal(null)
    if (!row) { load(); return }
    setRows((prev) => {
      const list = prev || []
      return editing ? list.map((r) => (r.id === row.id ? { ...r, ...row } : r)) : [row, ...list]
    })
    setUpdatedAt(new Date())
  }, [load])

  const confirmDelete = useCallback(async () => {
    if (!toDelete) return
    await deleteEquipment(toDelete.id)
    setRows((prev) => (prev || []).filter((r) => r.id !== toDelete.id))
    setToDelete(null)
  }, [toDelete])

  const clearFilters = () => { setStatusFilter('all'); setTypeFilter(''); setSearch('') }
  const hasFilters = statusFilter !== 'all' || typeFilter || search

  // Export
  const EXPORT_COLS = ['name', 'equipment_type', 'serial_no', 'site', 'condition', 'calibration_due', 'status']
  const EXPORT_HEADERS = ['Name', 'Type', 'Serial', 'Site', 'Condition', 'Calibration due', 'Status']
  const exportRows = filtered.map((r) => ({
    name: r.name || '', equipment_type: r.equipment_type || '', serial_no: r.serial_no || '',
    site: r.site || '', condition: r.condition || '', calibration_due: r.calibration_due || '',
    status: STATUS_META[r.status]?.label || r.status || '',
  }))

  const kpis = [
    { label: 'Total equipment', value: summary.total, icon: Wrench, tone: 'text-[var(--text-primary)]' },
    { label: 'Available', value: summary.available, icon: PackageCheck, tone: 'text-green-400' },
    { label: 'In maintenance', value: summary.maintenance, icon: Filter, tone: 'text-amber-400' },
    { label: 'Calibration due', value: summary.calibrationDue, icon: CalendarClock, tone: 'text-red-400' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tool & Equipment Registry"
        subtitle="Workshop tools & equipment — serial, assigned site, condition, calibration and lifecycle status."
        icon={Wrench}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'equipment')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Tool & Equipment Registry', 'equipment', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            {canWrite && (
              <button onClick={() => setModal({ item: null })} className="btn-primary text-sm inline-flex items-center gap-1.5">
                <Plus size={14} /> Register
              </button>
            )}
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">The equipment registry isn’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V150_EQUIPMENT.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load equipment.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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
            <input className="input pl-9 w-full" placeholder="Search name, serial, type, site…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {EQUIPMENT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
          </select>
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Type">
            <option value="">All types</option>
            {typeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
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
                {['Name', 'Type', 'Serial', 'Site', 'Condition', 'Calibration due', 'Status', ''].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  <Wrench size={22} className="mx-auto mb-2 opacity-60" />
                  {rows.length === 0 ? 'No equipment registered yet.' : 'No equipment matches these filters.'}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const due = calibrationDue(r, now)
                  const st = STATUS_META[r.status] || STATUS_META.available
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40 group">
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.name || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.equipment_type || '—'}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">{r.serial_no || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.condition || '—'}</td>
                      <td className="px-4 py-2.5">
                        {r.calibration_due ? (
                          <span className={`inline-flex items-center gap-1 ${due ? 'text-red-300 font-medium' : 'text-[var(--text-secondary)]'}`}>
                            {due && <CalendarClock size={13} className="text-red-400" />}{fmtDate(r.calibration_due)}
                          </span>
                        ) : <span className="text-[var(--text-muted)]">—</span>}
                      </td>
                      <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span></td>
                      <td className="px-4 py-2.5 text-right">
                        {canWrite && (
                          <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => setModal({ item: r })} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]" aria-label="Edit"><Pencil size={14} /></button>
                            <button onClick={() => setToDelete(r)} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-[var(--input-bg)]" aria-label="Delete"><Trash2 size={14} /></button>
                          </div>
                        )}
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

      {modal && <EquipmentModal initial={modal.item} onClose={() => setModal(null)} onSaved={onSaved} />}
      {toDelete && <DeleteConfirm item={toDelete} onCancel={() => setToDelete(null)} onConfirm={confirmDelete} />}
    </div>
  )
}
