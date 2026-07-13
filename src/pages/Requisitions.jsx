/**
 * Requisitions (route /requisitions) — internal purchase requests that precede a
 * Purchase Order (requester, item, quantity, estimated cost, needed-by, status).
 * Ported from the tyre_saas procurement module and wired to Tyre Pulse's
 * Supabase-backed `requisitions` table via the service layer.
 *
 * Real data, KPI tiles, search + status/category filters, create/edit modal,
 * status badges, delete confirmation, Excel/PDF export, and loading/empty/error
 * states throughout. Degrades to an "apply migration" prompt when the table is
 * absent.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ClipboardList, ShoppingCart, DollarSign, Clock, CheckCircle2, Plus, Pencil,
  Trash2, Search, X, Filter, Save, Loader2, AlertTriangle, FileSpreadsheet,
  FileText,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact } from '../lib/formatters'
import {
  listRequisitions, createRequisition, updateRequisition, deleteRequisition,
  REQUISITION_STATUSES, REQUISITION_CATEGORIES,
} from '../lib/api/requisitions'
import { summarizeRequisitions } from '../lib/requisitions'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'

const STATUS_META = {
  draft: { label: 'Draft', cls: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]' },
  submitted: { label: 'Submitted', cls: 'bg-amber-900/40 text-amber-300 border border-amber-700/50' },
  approved: { label: 'Approved', cls: 'bg-sky-900/40 text-sky-300 border border-sky-700/50' },
  rejected: { label: 'Rejected', cls: 'bg-red-900/40 text-red-300 border border-red-700/50' },
  ordered: { label: 'Ordered', cls: 'bg-green-900/40 text-green-300 border border-green-700/50' },
}

const EMPTY_FORM = {
  requisition_no: '', requester: '', item: '', category: 'tyres', quantity: '',
  est_cost: '', needed_by: '', site: '', status: 'draft', notes: '',
}

function isMissingRelation(err) {
  const code = String(err?.code || '')
  if (code === '42P01' || code === 'PGRST205') return true
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('could not find the table') || m.includes('schema cache')
}
function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}
const cap = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '')

// ─── Create / Edit modal ──────────────────────────────────────────────────────
function RequisitionModal({ open, initial, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setForm(initial ? {
        requisition_no: initial.requisition_no || '',
        requester: initial.requester || '',
        item: initial.item || '',
        category: initial.category || 'tyres',
        quantity: initial.quantity ?? '',
        est_cost: initial.est_cost ?? '',
        needed_by: initial.needed_by || '',
        site: initial.site || '',
        status: initial.status || 'draft',
        notes: initial.notes || '',
      } : EMPTY_FORM)
      setError('')
    }
  }, [open, initial])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!form.item.trim()) { setError('Please enter the item being requested.'); return }
    setBusy(true)
    try {
      if (initial?.id) await updateRequisition(initial.id, form)
      else await createRequisition(form)
      onSaved?.()
    } catch (err) {
      setError(toUserMessage(err, 'Could not save the requisition.'))
    } finally {
      setBusy(false)
    }
  }, [form, initial, onSaved])

  if (!open) return null

  const estTotal = (Number(form.quantity) || 0) * (Number(form.est_cost) || 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="card w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
            <ClipboardList size={18} className="text-[var(--brand-bright)]" />
            {initial?.id ? 'Edit requisition' : 'New requisition'}
          </h2>
          <button type="button" onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <X size={18} />
          </button>
        </div>

        <div>
          <label className="label">Item *</label>
          <input
            className="input w-full" placeholder="e.g. 315/80R22.5 drive tyres" maxLength={300}
            value={form.item} onChange={(e) => set('item', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Requisition no.</label>
            <input
              className="input w-full" placeholder="e.g. REQ-2026-001" maxLength={120}
              value={form.requisition_no} onChange={(e) => set('requisition_no', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Requester</label>
            <input
              className="input w-full" placeholder="e.g. Workshop Supervisor" maxLength={200}
              value={form.requester} onChange={(e) => set('requester', e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Category</label>
            <select className="input w-full" value={form.category} onChange={(e) => set('category', e.target.value)}>
              {REQUISITION_CATEGORIES.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {REQUISITION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Quantity</label>
            <input
              className="input w-full" type="number" min="0" step="1" placeholder="0"
              value={form.quantity} onChange={(e) => set('quantity', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Est. unit cost</label>
            <input
              className="input w-full" type="number" min="0" step="0.01" placeholder="0.00"
              value={form.est_cost} onChange={(e) => set('est_cost', e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Needed by</label>
            <input
              className="input w-full" type="date"
              value={form.needed_by || ''} onChange={(e) => set('needed_by', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Site</label>
            <input
              className="input w-full" placeholder="e.g. Riyadh Depot" maxLength={200}
              value={form.site} onChange={(e) => set('site', e.target.value)}
            />
          </div>
        </div>

        {estTotal > 0 && (
          <p className="text-xs text-[var(--text-muted)] -mt-1">
            Estimated total: <span className="font-semibold text-[var(--text-secondary)]">{estTotal.toLocaleString()}</span> (qty × est. unit cost)
          </p>
        )}

        <div>
          <label className="label">Notes</label>
          <textarea
            className="input w-full min-h-[90px] resize-y" maxLength={8000}
            placeholder="Optional justification or notes for this request…"
            value={form.notes} onChange={(e) => set('notes', e.target.value)}
          />
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
            {busy ? 'Saving…' : 'Save requisition'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ─── Delete confirmation ──────────────────────────────────────────────────────
function DeleteDialog({ row, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!row) return null
  const run = async () => {
    setBusy(true); setError('')
    try { await onConfirm() } catch (e) { setError(toUserMessage(e, 'Could not delete.')); setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm space-y-4">
        <div className="flex items-center gap-2 text-[var(--text-primary)]">
          <Trash2 size={18} className="text-red-400" />
          <h3 className="text-base font-semibold">Delete requisition?</h3>
        </div>
        <p className="text-sm text-[var(--text-muted)]">
          This will permanently remove the request for
          <span className="text-[var(--text-secondary)] font-medium"> {row.item}</span>
          {row.requisition_no ? ` (${row.requisition_no})` : ''}. This cannot be undone.
        </p>
        {error && <p className="text-xs text-red-300">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          <button onClick={onCancel} className="btn-secondary text-sm">Cancel</button>
          <button onClick={run} disabled={busy} className="btn-primary text-sm inline-flex items-center gap-2 !bg-red-600 hover:!bg-red-500 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function Requisitions() {
  const { activeCountry, activeCurrency } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listRequisitions({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(toUserMessage(err, 'Could not load requisitions.')); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeRequisitions(rows || []), [rows])

  const categoryOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.category).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (rows || []).filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (categoryFilter !== 'all' && r.category !== categoryFilter) return false
      if (q) {
        const hay = `${r.item || ''} ${r.requisition_no || ''} ${r.requester || ''} ${r.site || ''} ${r.notes || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, categoryFilter, search])

  const fmtMoney = useCallback((v) => formatCurrencyCompact(v, activeCurrency), [activeCurrency])

  const kpis = [
    { label: 'Total requisitions', value: summary.total, icon: ShoppingCart, tone: 'text-[var(--text-primary)]' },
    { label: 'Pending approval', value: summary.pending, icon: Clock, tone: 'text-amber-400' },
    { label: 'Approved', value: summary.approved, icon: CheckCircle2, tone: 'text-sky-400' },
    { label: 'Total est. cost', value: fmtMoney(summary.totalEstCost), icon: DollarSign, tone: 'text-[var(--brand-bright)]' },
  ]

  const EXPORT_COLS = ['requisition_no', 'item', 'category', 'requester', 'quantity', 'est_cost', 'needed_by', 'site', 'status']
  const EXPORT_HEADERS = ['Req. no.', 'Item', 'Category', 'Requester', 'Qty', 'Est. cost', 'Needed by', 'Site', 'Status']
  const exportRows = filtered.map((r) => ({
    requisition_no: r.requisition_no || '', item: r.item || '', category: cap(r.category) || '',
    requester: r.requester || '', quantity: r.quantity ?? '', est_cost: r.est_cost ?? '',
    needed_by: r.needed_by || '', site: r.site || '',
    status: STATUS_META[r.status]?.label || r.status || '',
  }))

  const clearFilters = () => { setStatusFilter('all'); setCategoryFilter('all'); setSearch('') }
  const hasFilters = statusFilter !== 'all' || categoryFilter !== 'all' || search

  const openCreate = () => { setEditing(null); setModalOpen(true) }
  const openEdit = (row) => { setEditing(row); setModalOpen(true) }
  const onSaved = () => { setModalOpen(false); setEditing(null); load() }
  const confirmDelete = async () => { await deleteRequisition(deleting.id); setDeleting(null); load() }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Requisitions"
        subtitle="Raise and track internal purchase requests before they become POs — with approval status and export."
        icon={ClipboardList}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'requisitions', 'Requisitions', { currency: activeCurrency })}
              className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}
            >
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button
              onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Purchase Requisitions', 'requisitions', 'landscape', '', { currency: activeCurrency })}
              className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}
            >
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={15} /> New requisition
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Requisitions aren’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V156_REQUISITIONS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && !missing && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load requisitions.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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
            <input className="input pl-9 w-full" placeholder="Search item, req. no., requester, site…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {REQUISITION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
          </select>
          <select className="input" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Category">
            <option value="all">All categories</option>
            {categoryOptions.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
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
                {['Item', 'Req. no.', 'Category', 'Qty', 'Est. cost', 'Needed by', 'Status', ''].map((h, i) => (
                  <th key={i} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => (
                  <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-[var(--text-muted)]">
                    <Filter size={22} className="mx-auto mb-2 opacity-60" />
                    {summary.total === 0 ? 'No requisitions yet. Raise the first one.' : 'No requisitions match these filters.'}
                  </td>
                </tr>
              ) : (
                filtered.slice(0, 500).map((r) => {
                  const st = STATUS_META[r.status] || STATUS_META.draft
                  return (
                    <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                      <td className="px-4 py-2.5 text-[var(--text-primary)] font-medium">
                        <span className="inline-flex items-center gap-2"><ClipboardList size={13} className="text-[var(--text-muted)]" />{r.item || '—'}</span>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] font-mono text-xs">{r.requisition_no || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{cap(r.category) || '—'}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.quantity == null || r.quantity === '' ? '—' : r.quantity}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)] font-medium">{r.est_cost == null || r.est_cost === '' ? '—' : fmtMoney(r.est_cost)}</td>
                      <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtDate(r.needed_by)}</td>
                      <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span></td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => openEdit(r)} className="p-1.5 rounded hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]" title="Edit"><Pencil size={14} /></button>
                          <button onClick={() => setDeleting(r)} className="p-1.5 rounded hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400" title="Delete"><Trash2 size={14} /></button>
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

      <RequisitionModal open={modalOpen} initial={editing} onClose={() => { setModalOpen(false); setEditing(null) }} onSaved={onSaved} />
      <DeleteDialog row={deleting} onCancel={() => setDeleting(null)} onConfirm={confirmDelete} />
    </div>
  )
}
