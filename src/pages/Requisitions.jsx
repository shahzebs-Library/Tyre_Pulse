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
  Trash2, Search, X, Save, Loader2, AlertTriangle, FileSpreadsheet,
  FileText, CalendarX, CalendarClock, Users,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import DateField from '../components/ui/DateField'
import Modal from '../components/ui/Modal'
import StatTile from '../components/ui/StatTile'
import { useSettings } from '../contexts/SettingsContext'
import { formatCurrencyCompact } from '../lib/formatters'
import {
  listRequisitions, createRequisition, updateRequisition, deleteRequisition,
  REQUISITION_STATUSES, REQUISITION_CATEGORIES,
} from '../lib/api/requisitions'
import {
  summarizeRequisitionRegister, filterRequisitions, lineValue, dueBand, DUE_BANDS,
} from '../lib/requisitionsAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { probeRelation } from '../lib/api/_client'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useAuth } from '../contexts/AuthContext'
import { decideRequisition } from '../lib/api/procurementChain'
import {
  requisitionStatusOptions, canEditRequisition, canDecideRequisition, canRaisePo, currencyScope, scopedCountry,
} from '../lib/procurementChain'
import { useProcurementCaps, MaterialPicker, RaisePoModal } from '../components/procurement/ProcurementChainPanels'

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

// listRequisitions reads at most this many rows; the page says so when it bites.
const READ_CAP = 500

const DUE_META = {
  overdue: { label: 'Overdue', cls: 'bg-red-900/40 text-red-300 border border-red-700/50' },
  due_soon: { label: 'Due soon', cls: 'bg-amber-900/40 text-amber-300 border border-amber-700/50' },
  later: { label: 'Later', cls: 'bg-[var(--input-bg)] text-[var(--text-secondary)] border border-[var(--input-border)]' },
  none: { label: 'No date', cls: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]' },
  closed: { label: 'Closed', cls: 'bg-[var(--input-bg)] text-[var(--text-dim)] border border-[var(--input-border)]' },
}
function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}
const cap = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '')

// ─── Create / Edit modal ──────────────────────────────────────────────────────
function RequisitionModal({ open, initial, onClose, onSaved, canProcure, userId, country }) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [material, setMaterial] = useState(null)
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
      setMaterial(null)
      setError('')
    }
  }, [open, initial])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const statusOptions = useMemo(
    () => requisitionStatusOptions({ canProcure, current: initial?.status || null }),
    [canProcure, initial?.status],
  )
  const editable = canEditRequisition(initial, { canProcure, userId })

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setError('')
    if (!form.item.trim()) { setError('Please enter the item being requested.'); return }
    if (!statusOptions.includes(form.status)) { setError('You cannot set this status.'); return }
    setBusy(true)
    try {
      if (initial?.id) await updateRequisition(initial.id, form)
      // A new request belongs to the country being worked in, never "All".
      else await createRequisition({ ...form, country: scopedCountry(country) })
      onSaved?.()
    } catch (err) {
      setError(toUserMessage(err, 'Could not save the requisition.'))
    } finally {
      setBusy(false)
    }
  }, [form, initial, onSaved, statusOptions, country])

  if (!open) return null

  const estTotal = (Number(form.quantity) || 0) * (Number(form.est_cost) || 0)

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={(
        <span className="inline-flex items-center gap-2">
          <ClipboardList size={18} className="text-[var(--brand-bright)]" aria-hidden="true" />
          {initial?.id ? 'Edit requisition' : 'New requisition'}
        </span>
      )}
    >
      <form onSubmit={submit} className="space-y-4">
        {!editable && (
          <p role="status" className="text-xs text-amber-300">
            This request is {initial?.status}. Only procurement can change it now, so it is shown read only.
          </p>
        )}
        <fieldset disabled={!editable} className="space-y-4">
        <MaterialPicker
          id="req-material" label="Pick from the Material Master (optional)" country={country} value={material}
          onPick={(m) => { setMaterial(m); if (m) set('item', `${m.item_code} ${m.item_name || ''}`.trim()) }}
        />
        <div>
          <label className="label" htmlFor="req-item">Item *</label>
          <input
            id="req-item" className="input w-full" placeholder="e.g. 315/80R22.5 drive tyres" maxLength={300}
            value={form.item} onChange={(e) => set('item', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="req-no">Requisition no.</label>
            <input
              id="req-no" className="input w-full" placeholder="e.g. REQ-2026-001" maxLength={120}
              value={form.requisition_no} onChange={(e) => set('requisition_no', e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="req-requester">Requester</label>
            <input
              id="req-requester" className="input w-full" placeholder="e.g. Workshop Supervisor" maxLength={200}
              value={form.requester} onChange={(e) => set('requester', e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="req-category">Category</label>
            <select id="req-category" className="input w-full" value={form.category} onChange={(e) => set('category', e.target.value)}>
              {REQUISITION_CATEGORIES.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="req-status">Status</label>
            <select id="req-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {statusOptions.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
            </select>
            {!canProcure && <p className="text-[11px] text-[var(--text-muted)] mt-1">Submit the request; procurement approves it.</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="req-qty">Quantity</label>
            <input
              id="req-qty" className="input w-full" type="number" min="0" step="1" placeholder="0"
              value={form.quantity} onChange={(e) => set('quantity', e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="req-unit">Est. unit cost</label>
            <input
              id="req-unit" className="input w-full" type="number" min="0" step="0.01" placeholder="0.00"
              value={form.est_cost} onChange={(e) => set('est_cost', e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="req-needed">Needed by</label>
            <DateField
              ariaLabel="Needed by"
              value={form.needed_by || ''} onChange={(v) => set('needed_by', v)}
            />
          </div>
          <div>
            <label className="label" htmlFor="req-site">Site</label>
            <input
              id="req-site" className="input w-full" placeholder="e.g. Riyadh Depot" maxLength={200}
              value={form.site} onChange={(e) => set('site', e.target.value)}
            />
          </div>
        </div>

        {estTotal > 0 && (
          <p className="text-xs text-[var(--text-muted)] -mt-1">
            Estimated total: <span className="font-semibold text-[var(--text-secondary)]">{estTotal.toLocaleString()}</span> (qty x est. unit cost, in the {scopedCountry(initial?.country || country) || 'requisition country'} currency)
          </p>
        )}

        <div>
          <label className="label" htmlFor="req-notes">Notes</label>
          <textarea
            id="req-notes" className="input w-full min-h-[90px] resize-y" maxLength={8000}
            placeholder="Optional justification or notes for this request"
            value={form.notes} onChange={(e) => set('notes', e.target.value)}
          />
        </div>

        </fieldset>
        {error && (
          <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Cancel</button>
          <button type="submit" disabled={busy || !editable} className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {busy ? 'Saving' : 'Save requisition'}
          </button>
        </div>
      </form>
    </Modal>
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
    <Modal
      open
      onClose={busy ? undefined : onCancel}
      closeOnBackdrop={!busy}
      size="sm"
      title={(
        <span className="inline-flex items-center gap-2">
          <Trash2 size={18} className="text-red-400" aria-hidden="true" />
          Delete requisition?
        </span>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--text-muted)]">
          This will permanently remove the request for
          <span className="text-[var(--text-secondary)] font-medium"> {row.item}</span>
          {row.requisition_no ? ` (${row.requisition_no})` : ''}. This cannot be undone.
        </p>
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="btn-secondary text-sm">Cancel</button>
          <button onClick={run} disabled={busy} className="btn-primary text-sm inline-flex items-center gap-2 !bg-red-600 hover:!bg-red-500 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Delete
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
// Wraps the shared StatTile. A tile that filters the register is a toggle
// button (aria-pressed), with the ring marking the active filter.
function Kpi({ label, value, hint, icon, tone, onClick, active, index }) {
  const tile = <StatTile label={label} value={value} sub={hint} icon={icon} tone={tone} index={index} />
  if (!onClick) return tile
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={!!active}
      className={`block h-full w-full text-left min-h-[44px] rounded-[var(--radius-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-bright)] ${active ? 'ring-2 ring-[var(--brand-bright)]' : ''}`}
    >
      {tile}
    </button>
  )
}

export default function Requisitions() {
  const { activeCountry, activeCurrency } = useSettings()
  const { user, profile } = useAuth() || {}
  const caps = useProcurementCaps()
  const [raising, setRaising] = useState(null)
  const [actionMsg, setActionMsg] = useState('')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [siteFilter, setSiteFilter] = useState('all')
  const [dueFilter, setDueFilter] = useState('all')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listRequisitions({ country: activeCountry, limit: READ_CAP })
      const list = Array.isArray(data) ? data : []
      setRows(list)
      setUpdatedAt(new Date())
      // The service turns a missing table into []; only a definite missing
      // relation raises the banner, never a permission or network failure.
      if (list.length === 0) {
        const probe = await probeRelation('requisitions')
        if (probe.checked && !probe.exists) setMissing(true)
      }
    } catch (err) {
      setError(toUserMessage(err, 'Could not load requisitions.'))
      setRows(null)
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const now = useMemo(() => Date.now(), [rows]) // eslint-disable-line react-hooks/exhaustive-deps
  const summary = useMemo(() => summarizeRequisitionRegister(rows || [], now), [rows, now])

  const categoryOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.category).filter(Boolean))].sort(),
    [rows],
  )
  const siteOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.site).filter(Boolean))].sort(),
    [rows],
  )

  const filtered = useMemo(() => filterRequisitions(rows || [], {
    status: statusFilter, category: categoryFilter, site: siteFilter, due: dueFilter, search,
  }, now), [rows, statusFilter, categoryFilter, siteFilter, dueFilter, search, now])

  // Requisitions carry no currency column; each reads in its country's currency.
  // On the All-countries view SAR, AED and EGP must not be added together.
  const money = useMemo(() => currencyScope(rows || []), [rows])
  const fmtMoney = useCallback((v) => {
    if (v == null) return 'N/A'
    if (money.mixed) return 'Mixed currencies'
    return formatCurrencyCompact(v, money.currency || activeCurrency)
  }, [activeCurrency, money])
  const loaded = rows !== null
  const show = (v) => (loaded ? v : 'N/A')

  const kpis = [
    { label: 'Total requisitions', value: show(summary.total), icon: ShoppingCart, tone: 'neutral', hint: loaded ? `${summary.requesters} requester${summary.requesters === 1 ? '' : 's'}` : null },
    { label: 'Pending approval', value: show(summary.pending), icon: Clock, tone: 'warn', hint: loaded ? `${summary.byStatus.draft} draft, ${summary.byStatus.submitted} submitted` : null },
    { label: 'Approved', value: show(summary.approved), icon: CheckCircle2, tone: 'info', hint: loaded && summary.approvalRate != null ? `${summary.approvalRate}% of decided` : 'No decisions yet', onClick: () => setStatusFilter(statusFilter === 'approved' ? 'all' : 'approved'), active: statusFilter === 'approved' },
    { label: 'Overdue', value: show(summary.overdue), icon: CalendarX, tone: 'crit', hint: 'Open past needed-by', onClick: () => setDueFilter(dueFilter === 'overdue' ? 'all' : 'overdue'), active: dueFilter === 'overdue' },
    { label: 'Due in 14 days', value: show(summary.dueSoon), icon: CalendarClock, tone: 'warn', onClick: () => setDueFilter(dueFilter === 'due_soon' ? 'all' : 'due_soon'), active: dueFilter === 'due_soon' },
    { label: 'Est. value (qty x unit)', value: loaded ? fmtMoney(summary.totalValue) : 'N/A', icon: DollarSign, tone: 'accent', hint: loaded ? `${summary.valued} of ${summary.total} priced` : null },
    { label: 'Open est. value', value: loaded ? fmtMoney(summary.openValue) : 'N/A', icon: DollarSign, tone: 'neutral', hint: 'Excludes ordered and rejected' },
    { label: 'Requesters', value: show(summary.requesters), icon: Users, tone: 'neutral' },
  ]

  const EXPORT_COLS = ['requisition_no', 'item', 'category', 'requester', 'quantity', 'est_cost', 'line_value', 'needed_by', 'due', 'site', 'status']
  const EXPORT_HEADERS = ['Req. no.', 'Item', 'Category', 'Requester', 'Qty', 'Est. unit cost', 'Est. value', 'Needed by', 'Due', 'Site', 'Status']
  const exportRows = filtered.map((r) => {
    const v = lineValue(r)
    return {
      requisition_no: r.requisition_no || '', item: r.item || '', category: cap(r.category) || '',
      requester: r.requester || '', quantity: r.quantity ?? 'N/A', est_cost: r.est_cost ?? 'N/A',
      line_value: v == null ? 'N/A' : v,
      needed_by: r.needed_by || 'N/A', due: DUE_META[dueBand(r, now)]?.label || '', site: r.site || '',
      status: STATUS_META[r.status]?.label || r.status || '',
    }
  })
  const fileName = reportFileName('Requisitions', activeCountry && activeCountry !== 'All' ? activeCountry : '')

  const clearFilters = () => { setStatusFilter('all'); setCategoryFilter('all'); setSiteFilter('all'); setDueFilter('all'); setSearch('') }
  const hasFilters = statusFilter !== 'all' || categoryFilter !== 'all' || siteFilter !== 'all' || dueFilter !== 'all' || search

  const openCreate = () => { setEditing(null); setModalOpen(true) }
  const openEdit = useCallback((row) => { setEditing(row); setModalOpen(true) }, [])
  const onSaved = () => { setModalOpen(false); setEditing(null); load() }
  const confirmDelete = async () => { await deleteRequisition(deleting.id); setDeleting(null); load() }
  const decide = useCallback(async (row, decision) => {
    setActionMsg('')
    try {
      await decideRequisition(row.id, decision, { approverName: profile?.full_name || user?.email || null })
      setActionMsg(`${row.requisition_no || row.item} ${decision}.`)
      load()
    } catch (e) { setActionMsg(toUserMessage(e, 'Could not record the decision.')) }
  }, [load, profile, user])

  const columns = useMemo(() => [
    {
      id: 'item', header: 'Item', accessorFn: (r) => r.item || '',
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.item || 'N/A'}</span>,
    },
    { id: 'requisition_no', header: 'Req. no.', accessorFn: (r) => r.requisition_no || '', cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() || 'N/A'}</span> },
    { id: 'category', header: 'Category', accessorFn: (r) => cap(r.category) || '', cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'requester', header: 'Requester', accessorFn: (r) => r.requester || '', cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || '', cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'po_ref', header: 'PO', accessorFn: (r) => r.po_ref || '', cell: ({ getValue }) => <span className="font-mono text-xs">{getValue() || 'N/A'}</span> },
    { id: 'quantity', header: 'Qty', accessorFn: (r) => (r.quantity == null || r.quantity === '' ? null : Number(r.quantity)), meta: { align: 'right' }, cell: ({ getValue }) => (getValue() == null ? 'N/A' : getValue()) },
    { id: 'est_cost', header: 'Unit cost', accessorFn: (r) => (r.est_cost == null || r.est_cost === '' ? null : Number(r.est_cost)), meta: { align: 'right' }, cell: ({ getValue }) => fmtMoney(getValue()) },
    { id: 'line_value', header: 'Est. value', accessorFn: (r) => lineValue(r), meta: { align: 'right' }, cell: ({ getValue }) => <span className="font-medium">{fmtMoney(getValue())}</span> },
    {
      id: 'needed_by', header: 'Needed by', accessorFn: (r) => r.needed_by || '',
      cell: ({ row }) => {
        const band = dueBand(row.original, now)
        const d = DUE_META[band]
        return (
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            <span>{fmtDate(row.original.needed_by)}</span>
            {(band === 'overdue' || band === 'due_soon') && <span className={`text-[11px] px-1.5 py-0.5 rounded ${d.cls}`}>{d.label}</span>}
          </span>
        )
      },
    },
    {
      id: 'status', header: 'Status', accessorFn: (r) => STATUS_META[r.status]?.label || r.status || '',
      meta: { filterVariant: 'select' },
      cell: ({ row }) => {
        const st = STATUS_META[row.original.status] || STATUS_META.draft
        return <span className={`badge text-[11px] px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span>
      },
    },
    {
      id: 'actions', header: '', enableSorting: false, enableHiding: false, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          {canDecideRequisition(row.original, { canProcure: caps.procure }) && (
            <>
              <button type="button" onClick={(e) => { e.stopPropagation(); decide(row.original, 'approved') }} className="btn-secondary text-xs min-h-[44px]">Approve</button>
              <button type="button" onClick={(e) => { e.stopPropagation(); decide(row.original, 'rejected') }} className="btn-secondary text-xs min-h-[44px]">Reject</button>
            </>
          )}
          {canRaisePo(row.original, { canProcure: caps.procure }) && (
            <button type="button" onClick={(e) => { e.stopPropagation(); setRaising(row.original) }} className="btn-primary text-xs min-h-[44px]">Raise PO</button>
          )}
          <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(row.original) }} aria-label={`Edit ${row.original.item || 'requisition'}`} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--brand-bright)]"><Pencil size={15} /></button>
          {caps.adminDelete && <button type="button" onClick={(e) => { e.stopPropagation(); setDeleting(row.original) }} aria-label={`Delete ${row.original.item || 'requisition'}`} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400 focus-visible:ring-2 focus-visible:ring-red-400"><Trash2 size={15} /></button>}
        </div>
      ),
    },
  ], [fmtMoney, now, openEdit, caps.procure, caps.adminDelete, decide])

  const capped = loaded && rows.length >= READ_CAP

  return (
    <div className="space-y-6">
      <PageHeader
        title="Requisitions"
        subtitle="Raise and track internal purchase requests before they become POs, with approval status, due dates and export."
        icon={ClipboardList}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, fileName, 'Requisitions', { currency: activeCurrency })}
              className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}
            >
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button
              type="button"
              onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Purchase Requisitions', fileName, 'landscape', '', { currency: activeCurrency })}
              className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}
            >
              <FileText size={14} /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <Plus size={15} /> New requisition
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Requisitions are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V156_REQUISITIONS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {money.mixed && (
        <p className="text-xs text-amber-300" role="status">
          These requisitions span {money.currencies.join(', ')}. Values are not added across currencies; pick a country to see totals.
        </p>
      )}
      {actionMsg && <p className="text-sm text-[var(--text-secondary)]" role="status">{actionMsg}</p>}

      {capped && (
        <p className="text-xs text-amber-300" role="status">
          Showing the {READ_CAP} requisitions needed soonest. Older or later requests are not loaded, so the figures below cover these {READ_CAP} only.
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k, i) => <Kpi key={k.label} index={i} {...k} />)}
      </div>

      {loaded && summary.byCategory.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Estimated value by category</h2>
          <ul className="space-y-2">
            {summary.byCategory.slice(0, 8).map((c) => {
              const max = summary.byCategory[0]?.value || 0
              const pct = c.value != null && max > 0 ? Math.max(2, Math.round((c.value / max) * 100)) : 0
              return (
                <li key={c.key}>
                  <button
                    type="button"
                    onClick={() => setCategoryFilter(categoryFilter === c.key ? 'all' : c.key)}
                    aria-pressed={categoryFilter === c.key}
                    className="w-full text-left min-h-[44px] rounded-lg px-2 py-1 hover:bg-[var(--input-bg)] focus-visible:ring-2 focus-visible:ring-[var(--brand-bright)]"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--text-secondary)]">{cap(c.key)} <span className="text-[var(--text-muted)]">({c.count})</span></span>
                      <span className="tabular-nums text-[var(--text-primary)]">{fmtMoney(c.value)}</span>
                    </div>
                    <div className="h-1.5 mt-1 rounded bg-[var(--input-bg)] overflow-hidden" aria-hidden="true">
                      <div className="h-full rounded bg-[var(--brand-bright)]" style={{ width: `${pct}%` }} />
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input className="input pl-9 w-full min-h-[44px]" placeholder="Search item, req. no., requester, site" aria-label="Search requisitions" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {REQUISITION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s]?.label || s}</option>)}
          </select>
          <select className="input min-h-[44px]" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label="Category">
            <option value="all">All categories</option>
            {categoryOptions.map((c) => <option key={c} value={c}>{cap(c)}</option>)}
          </select>
          <select className="input min-h-[44px]" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label="Site">
            <option value="all">All sites</option>
            {siteOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input min-h-[44px]" value={dueFilter} onChange={(e) => setDueFilter(e.target.value)} aria-label="Needed-by">
            <option value="all">Any needed-by</option>
            {DUE_BANDS.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{filtered.length} of {summary.total}</span>
        </div>
      </div>

      <EnterpriseTable
        columns={columns}
        data={filtered}
        getRowId={(r) => String(r.id)}
        loading={rows === null && !error}
        error={error || null}
        onRetry={load}
        enableGlobalFilter={false}
        exportFileName={fileName}
        emptyMessage={summary.total === 0 ? 'No requisitions yet. Raise the first one.' : 'No requisitions match these filters.'}
        onRowClick={(r) => openEdit(r)}
      />

      <RequisitionModal
        open={modalOpen} initial={editing} onClose={() => { setModalOpen(false); setEditing(null) }} onSaved={onSaved}
        canProcure={caps.procure} userId={user?.id || null} country={editing?.country || activeCountry}
      />
      {raising && (
        <RaisePoModal
          requisition={raising}
          onClose={() => setRaising(null)}
          onDone={(po) => { setRaising(null); setActionMsg(po ? `Purchase order ${po.po_number} raised.` : 'Purchase order raised.'); load() }}
        />
      )}
      <DeleteDialog row={deleting} onCancel={() => setDeleting(null)} onConfirm={confirmDelete} />
    </div>
  )
}
