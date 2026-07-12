/**
 * PmPrograms (route /pm-programs) — Preventive Maintenance Programs.
 *
 * Fleet teams define recurring PM programs against an asset or asset-type: a
 * service interval (km / hours / days / months), when it was last done, and
 * when it is next due. The page derives overdue / due-soon bands from next_due
 * (pure lib), rolls programs into KPI tiles, and exposes full CRUD backed by
 * the `pm_programs` table (V163) — org-isolated and country-scoped.
 *
 * Real data, KPI tiles, search + status/interval filters, create/edit modal,
 * delete confirmation, Excel/PDF export, and loading/empty/error states.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  CalendarClock, Wrench, Calendar, AlertTriangle, CheckCircle2, Search, X,
  Filter, Plus, Pencil, Trash2, FileSpreadsheet, FileText, Loader2, Save,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listPmPrograms, createPmProgram, updatePmProgram, deletePmProgram,
} from '../lib/api/pmPrograms'
import {
  pmDueStatus, daysToDue, summarizePmPrograms, PM_STATUS_META, PM_DUE_META,
  PM_STATUSES, PM_INTERVAL_TYPES, DUE_SOON_DAYS,
} from '../lib/pmPrograms'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

const STATUS_STYLES = {
  active: 'bg-green-900/40 text-green-300 border border-green-700/50',
  paused: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  completed: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}
const DUE_STYLES = {
  overdue: 'bg-red-900/40 text-red-300 border border-red-700/50',
  due_soon: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  scheduled: 'bg-green-900/40 text-green-300 border border-green-700/50',
  none: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]',
}
const INTERVAL_LABELS = {
  km: 'Kilometres', hours: 'Hours', days: 'Days', months: 'Months',
}
const INTERVAL_UNIT = { km: 'km', hours: 'h', days: 'd', months: 'mo' }

function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}
function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

const EMPTY_FORM = {
  name: '', asset_no: '', asset_type: '', interval_type: 'months', interval_value: '',
  last_done: '', next_due: '', site: '', status: 'active', notes: '',
}

export default function PmPrograms() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [intervalFilter, setIntervalFilter] = useState('all')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const NOW = Date.now()

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listPmPrograms({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(err?.message || 'Could not load PM programs.'); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Derive live due band for every row against the reference clock (pure lib).
  const enriched = useMemo(
    () => (rows || []).map((r) => ({ ...r, _due: pmDueStatus(r, NOW), _days: daysToDue(r, NOW) })),
    [rows, NOW],
  )
  const summary = useMemo(() => summarizePmPrograms(rows || [], NOW), [rows, NOW])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (intervalFilter !== 'all' && r.interval_type !== intervalFilter) return false
      if (q) {
        const hay = `${r.name || ''} ${r.asset_no || ''} ${r.asset_type || ''} ${r.site || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [enriched, statusFilter, intervalFilter, search])

  const clearFilters = () => { setStatusFilter('all'); setIntervalFilter('all'); setSearch('') }
  const hasFilters = statusFilter !== 'all' || intervalFilter !== 'all' || search

  // ── CRUD handlers ────────────────────────────────────────────────────────────
  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setModalOpen(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      name: r.name || '',
      asset_no: r.asset_no || '',
      asset_type: r.asset_type || '',
      interval_type: r.interval_type || 'months',
      interval_value: r.interval_value ?? '',
      last_done: r.last_done || '',
      next_due: r.next_due || '',
      site: r.site || '',
      status: r.status || 'active',
      notes: r.notes || '',
    })
    setFormError(''); setModalOpen(true)
  }
  const setField = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.name.trim()) { setFormError('Program name is required.'); return }
    setSaving(true)
    try {
      const payload = {
        ...form,
        interval_value: form.interval_value === '' ? null : Number(form.interval_value),
        last_done: form.last_done || null,
        next_due: form.next_due || null,
        country: activeCountry !== 'All' ? activeCountry : null,
      }
      if (editing) {
        const updated = await updatePmProgram(editing.id, payload)
        setRows((prev) => (prev || []).map((r) => (r.id === updated.id ? updated : r)))
      } else {
        const created = await createPmProgram(payload)
        setRows((prev) => [created, ...(prev || [])])
      }
      setModalOpen(false)
    } catch (err) {
      setFormError(err?.message || 'Could not save the PM program.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry])

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await deletePmProgram(confirmDelete.id)
      setRows((prev) => (prev || []).filter((r) => r.id !== confirmDelete.id))
      setConfirmDelete(null)
    } catch (err) {
      setError(err?.message || 'Could not delete the PM program.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDelete])

  // ── Export ───────────────────────────────────────────────────────────────────
  const EXPORT_COLS = ['name', 'asset_no', 'asset_type', 'interval', 'last_done', 'next_due', 'site', 'status', 'due']
  const EXPORT_HEADERS = ['Program', 'Asset', 'Asset type', 'Interval', 'Last done', 'Next due', 'Site', 'Status', 'Due']
  const exportRows = filtered.map((r) => ({
    name: r.name || '',
    asset_no: r.asset_no || '',
    asset_type: r.asset_type || '',
    interval: r.interval_value != null ? `${r.interval_value} ${INTERVAL_LABELS[r.interval_type] || r.interval_type}` : (INTERVAL_LABELS[r.interval_type] || r.interval_type || ''),
    last_done: r.last_done || '',
    next_due: r.next_due || '',
    site: r.site || '',
    status: PM_STATUS_META[r.status]?.label || r.status || '',
    due: PM_DUE_META[r._due]?.label || r._due || '',
  }))

  const kpis = [
    { label: 'Total programs', value: summary.total, icon: Wrench, tone: 'text-[var(--text-primary)]' },
    { label: 'Active', value: summary.byStatus.active, icon: CheckCircle2, tone: 'text-green-400' },
    { label: `Due soon (≤${DUE_SOON_DAYS}d)`, value: summary.dueSoon, icon: Calendar, tone: 'text-amber-400' },
    { label: 'Overdue', value: summary.overdue, icon: AlertTriangle, tone: 'text-red-400' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="PM Programs"
        subtitle="Preventive-maintenance programs by asset or asset-type — service intervals, last done and next-due tracking with overdue alerts."
        icon={CalendarClock}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'pm_programs')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'PM Programs', 'pm_programs', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> New program
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">PM Programs aren’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V163_PM_PROGRAMS.sql</span>, then reload.
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

      {/* Due banner */}
      {(summary.overdue > 0 || summary.dueSoon > 0) && (
        <div className="card border border-amber-800/50 flex items-center gap-3 !py-3">
          <CalendarClock size={16} className="text-amber-400 shrink-0" />
          <span className="text-sm text-amber-200">
            {summary.overdue > 0 && <><span className="font-semibold text-red-300">{summary.overdue}</span> overdue</>}
            {summary.overdue > 0 && summary.dueSoon > 0 && ' · '}
            {summary.dueSoon > 0 && <><span className="font-semibold">{summary.dueSoon}</span> due within {DUE_SOON_DAYS} days</>}
            {' '}— schedule the work to keep assets compliant.
          </span>
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
            <input className="input pl-9 w-full" placeholder="Search program, asset, asset type, site…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {PM_STATUSES.map((s) => <option key={s} value={s}>{PM_STATUS_META[s]?.label || s}</option>)}
          </select>
          <select className="input" value={intervalFilter} onChange={(e) => setIntervalFilter(e.target.value)} aria-label="Interval type">
            <option value="all">All intervals</option>
            {PM_INTERVAL_TYPES.map((t) => <option key={t} value={t}>{INTERVAL_LABELS[t]}</option>)}
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
                {['Program', 'Asset', 'Interval', 'Last done', 'Next due', 'Site', 'Status', 'Due', ''].map((h, i) => <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={9} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-12 text-center text-[var(--text-muted)]"><Filter size={22} className="mx-auto mb-2 opacity-60" />No PM programs match these filters.</td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const dueClass = r._due === 'overdue' ? 'text-red-400 font-medium' : r._due === 'due_soon' ? 'text-amber-400 font-medium' : 'text-[var(--text-secondary)]'
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 font-medium text-[var(--text-primary)]">{r.name || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                        {r.asset_no || r.asset_type || '—'}
                        {r.asset_no && r.asset_type && <span className="block text-[11px] text-[var(--text-muted)]">{r.asset_type}</span>}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">
                        {r.interval_value != null ? `${r.interval_value} ${INTERVAL_UNIT[r.interval_type] || r.interval_type}` : (INTERVAL_LABELS[r.interval_type] || '—')}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtDate(r.last_done)}</td>
                      <td className={`px-4 py-2.5 ${dueClass}`}>
                        {fmtDate(r.next_due)}
                        {r._days != null && r.next_due && (
                          <span className="ml-1 text-[11px] opacity-80">({r._days < 0 ? `${Math.abs(r._days)}d ago` : `${r._days}d`})</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}</td>
                      <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_STYLES[r.status] || STATUS_STYLES.completed}`}>{PM_STATUS_META[r.status]?.label || r.status}</span></td>
                      <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${DUE_STYLES[r._due]}`}>{PM_DUE_META[r._due]?.label}</span></td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setConfirmDelete(r)} className="p-1.5 rounded-lg hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" aria-label="Delete"><Trash2 size={14} /></button>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !saving && setModalOpen(false)}>
          <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{editing ? 'Edit PM program' : 'New PM program'}</h2>
              <button onClick={() => !saving && setModalOpen(false)} className="p-1.5 rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)]"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className="label">Program name<span className="text-red-400"> *</span></label>
                  <input className="input w-full" placeholder="e.g. Engine oil & filter service" value={form.name} maxLength={200} onChange={(e) => setField('name', e.target.value)} />
                </div>
                <div>
                  <label className="label">Asset number</label>
                  <input className="input w-full" placeholder="e.g. TRK-042" value={form.asset_no} maxLength={120} onChange={(e) => setField('asset_no', e.target.value)} />
                </div>
                <div>
                  <label className="label">Asset type</label>
                  <input className="input w-full" placeholder="e.g. Truck, Trailer, Forklift" value={form.asset_type} maxLength={120} onChange={(e) => setField('asset_type', e.target.value)} />
                </div>
                <div>
                  <label className="label">Interval type</label>
                  <select className="input w-full" value={form.interval_type} onChange={(e) => setField('interval_type', e.target.value)}>
                    {PM_INTERVAL_TYPES.map((t) => <option key={t} value={t}>{INTERVAL_LABELS[t]}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Interval value</label>
                  <input type="number" min="0" step="any" className="input w-full" placeholder="e.g. 6" value={form.interval_value} onChange={(e) => setField('interval_value', e.target.value)} />
                </div>
                <div>
                  <label className="label">Last done</label>
                  <input type="date" className="input w-full" value={form.last_done || ''} onChange={(e) => setField('last_done', e.target.value)} />
                </div>
                <div>
                  <label className="label">Next due</label>
                  <input type="date" className="input w-full" value={form.next_due || ''} onChange={(e) => setField('next_due', e.target.value)} />
                </div>
                <div>
                  <label className="label">Site</label>
                  <input className="input w-full" placeholder="Depot / workshop" value={form.site} maxLength={120} onChange={(e) => setField('site', e.target.value)} />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => setField('status', e.target.value)}>
                    {PM_STATUSES.map((s) => <option key={s} value={s}>{PM_STATUS_META[s]?.label || s}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea className="input w-full min-h-[90px] resize-y" value={form.notes} maxLength={4000} onChange={(e) => setField('notes', e.target.value)} />
              </div>
              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}
              <div className="flex items-center gap-3">
                <button type="submit" disabled={saving} className="btn-primary inline-flex items-center gap-2 disabled:opacity-60">
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create program'}
                </button>
                <button type="button" onClick={() => setModalOpen(false)} disabled={saving} className="btn-secondary">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="card w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-900/30 flex items-center justify-center shrink-0">
                <Trash2 size={20} className="text-red-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-bold text-[var(--text-primary)]">Delete PM program?</h3>
                <p className="text-sm text-[var(--text-muted)] mt-1">
                  This permanently removes <span className="font-medium text-[var(--text-secondary)]">{confirmDelete.name}</span>. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 mt-5">
              <button onClick={() => setConfirmDelete(null)} disabled={deleting} className="btn-secondary">Cancel</button>
              <button onClick={doDelete} disabled={deleting} className="btn-primary bg-red-600 hover:bg-red-500 border-red-600 inline-flex items-center gap-2 disabled:opacity-60">
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
