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
import { useLanguage } from '../contexts/LanguageContext'
import { formatCurrencyCompact } from '../lib/formatters'
import {
  listRequisitions, createRequisition, updateRequisition, deleteRequisition,
  REQUISITION_STATUSES, REQUISITION_CATEGORIES,
} from '../lib/api/requisitions'
import {
  summarizeRequisitionRegister, filterRequisitions, lineValue, dueBand, DUE_BANDS, DUE_SOON_DAYS,
} from '../lib/requisitionsAnalytics'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { probeRelation } from '../lib/api/_client'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useAuth } from '../contexts/AuthContext'
import { decideRequisition } from '../lib/api/procurementChain'
import {
  requisitionStatusOptions, canEditRequisition, canDecideRequisition, canRaisePo, currencyScope, scopedCountry,
  requisitionMaterial,
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
/** Display label for a database token; an unknown token falls back to `fallback`. */
const tv = (t, base, v, fallback) => {
  if (v === null || v === undefined || v === '') return fallback ?? ''
  const k = `${base}.${v}`
  const r = t(k)
  return r === k ? (fallback ?? String(v)) : r
}
function fmtDate(v) {
  if (!v) return 'N/A'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? 'N/A' : d.toLocaleDateString()
}
const cap = (s) => (s ? String(s).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '')

// ─── Create / Edit modal ──────────────────────────────────────────────────────
function RequisitionModal({ open, initial, onClose, onSaved, canProcure, userId, country }) {
  const { t } = useLanguage()
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
      setMaterial(initial ? requisitionMaterial(initial) : null)
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
    if (!form.item.trim()) { setError(t('wmsprocure.req.itemRequired')); return }
    if (!statusOptions.includes(form.status)) { setError(t('wmsprocure.req.statusNotAllowed')); return }
    setBusy(true)
    try {
      // item_id links the request to the Material Master (WP4); the service drops it
      // silently when the database does not have the column yet.
      if (initial?.id) await updateRequisition(initial.id, { ...form, item_id: material?.id || null })
      // A new request belongs to the country being worked in, never "All".
      else await createRequisition({ ...form, item_id: material?.id || null, country: scopedCountry(country) })
      onSaved?.()
    } catch (err) {
      setError(toUserMessage(err, t('wmsprocure.req.saveErr')))
    } finally {
      setBusy(false)
    }
  }, [form, initial, onSaved, statusOptions, country, material, t])

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
          {initial?.id ? t('wmsprocure.req.editTitle') : t('wmsprocure.req.newTitle')}
        </span>
      )}
    >
      <form onSubmit={submit} className="space-y-4">
        {!editable && (
          <p role="status" className="text-xs text-amber-300">
            {t('wmsprocure.req.readOnly', { status: tv(t, 'wmsprocure.req.status', initial?.status) })}
          </p>
        )}
        <fieldset disabled={!editable} className="space-y-4">
        <MaterialPicker
          id="req-material" label={t('wmsprocure.req.pickMaterial')} country={country} value={material}
          onPick={(m) => { setMaterial(m); if (m) set('item', `${m.item_code} ${m.item_name || ''}`.trim()) }}
        />
        <div>
          <label className="label" htmlFor="req-item">{t('wmsprocure.req.itemLabel')}</label>
          <input
            id="req-item" className="input w-full" placeholder={t('wmsprocure.req.itemPlaceholder')} maxLength={300}
            value={form.item} onChange={(e) => set('item', e.target.value)}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="req-no">{t('wmsprocure.req.reqNoLabel')}</label>
            <input
              id="req-no" className="input w-full" placeholder={t('wmsprocure.req.reqNoPlaceholder')} maxLength={120}
              value={form.requisition_no} onChange={(e) => set('requisition_no', e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="req-requester">{t('wmsprocure.req.requester')}</label>
            <input
              id="req-requester" className="input w-full" placeholder={t('wmsprocure.req.requesterPlaceholder')} maxLength={200}
              value={form.requester} onChange={(e) => set('requester', e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="req-category">{t('wmsprocure.req.categoryLabel')}</label>
            <select id="req-category" className="input w-full" value={form.category} onChange={(e) => set('category', e.target.value)}>
              {REQUISITION_CATEGORIES.map((c) => <option key={c} value={c}>{tv(t, 'wmsprocure.req.category', c, cap(c))}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="req-status">{t('wmsprocure.req.statusLabel')}</label>
            <select id="req-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
              {statusOptions.map((s) => <option key={s} value={s}>{tv(t, 'wmsprocure.req.status', s)}</option>)}
            </select>
            {!canProcure && <p className="text-[11px] text-[var(--text-muted)] mt-1">{t('wmsprocure.req.submitHint')}</p>}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="req-qty">{t('wmsprocure.req.quantity')}</label>
            <input
              id="req-qty" className="input w-full" type="number" min="0" step="1" placeholder="0"
              value={form.quantity} onChange={(e) => set('quantity', e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="req-unit">{t('wmsprocure.req.estUnitCost')}</label>
            <input
              id="req-unit" className="input w-full" type="number" min="0" step="0.01" placeholder="0.00"
              value={form.est_cost} onChange={(e) => set('est_cost', e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="label" htmlFor="req-needed">{t('wmsprocure.req.neededBy')}</label>
            <DateField
              ariaLabel={t('wmsprocure.req.neededBy')}
              value={form.needed_by || ''} onChange={(v) => set('needed_by', v)}
            />
          </div>
          <div>
            <label className="label" htmlFor="req-site">{t('wmsprocure.req.site')}</label>
            <input
              id="req-site" className="input w-full" placeholder={t('wmsprocure.req.sitePlaceholder')} maxLength={200}
              value={form.site} onChange={(e) => set('site', e.target.value)}
            />
          </div>
        </div>

        {estTotal > 0 && (
          <p className="text-xs text-[var(--text-muted)] -mt-1">
            {t('wmsprocure.req.estTotal')} <span className="font-semibold text-[var(--text-secondary)]">{estTotal.toLocaleString()}</span> {t('wmsprocure.req.estTotalNote', { country: scopedCountry(initial?.country || country) || t('wmsprocure.req.reqCountry') })}
          </p>
        )}

        <div>
          <label className="label" htmlFor="req-notes">{t('wmsprocure.req.notes')}</label>
          <textarea
            id="req-notes" className="input w-full min-h-[90px] resize-y" maxLength={8000}
            placeholder={t('wmsprocure.req.notesPlaceholder')}
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
          <button type="button" onClick={onClose} className="btn-secondary text-sm">{t('wmsprocure.req.cancel')}</button>
          <button type="submit" disabled={busy || !editable} className="btn-primary text-sm inline-flex items-center gap-2 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {busy ? t('wmsprocure.req.saving') : t('wmsprocure.req.save')}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Delete confirmation ──────────────────────────────────────────────────────
function DeleteDialog({ row, onCancel, onConfirm }) {
  const { t } = useLanguage()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!row) return null
  const run = async () => {
    setBusy(true); setError('')
    try { await onConfirm() } catch (e) { setError(toUserMessage(e, t('wmsprocure.req.deleteErr'))); setBusy(false) }
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
          {t('wmsprocure.req.deleteTitle')}
        </span>
      )}
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--text-muted)]">
          {t('wmsprocure.req.deleteBody1')}
          <span className="text-[var(--text-secondary)] font-medium"> {row.item}</span>
          {row.requisition_no ? ` (${row.requisition_no})` : ''}. {t('wmsprocure.req.deleteBody2')}
        </p>
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        <div className="flex items-center justify-end gap-2">
          <button onClick={onCancel} disabled={busy} className="btn-secondary text-sm">{t('wmsprocure.req.cancel')}</button>
          <button onClick={run} disabled={busy} className="btn-primary text-sm inline-flex items-center gap-2 !bg-red-600 hover:!bg-red-500 disabled:opacity-60">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} {t('wmsprocure.req.delete')}
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
      className={`block h-full w-full text-start min-h-[44px] rounded-[var(--radius-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-bright)] ${active ? 'ring-2 ring-[var(--brand-bright)]' : ''}`}
    >
      {tile}
    </button>
  )
}

export default function Requisitions() {
  const { activeCountry, activeCurrency } = useSettings()
  const { t } = useLanguage()
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
      setError(toUserMessage(err, t('wmsprocure.req.loadErr')))
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
    if (v == null) return t('wmsprocure.req.na')
    if (money.mixed) return t('wmsprocure.req.mixed')
    return formatCurrencyCompact(v, money.currency || activeCurrency)
  }, [activeCurrency, money, t])
  const loaded = rows !== null
  const show = (v) => (loaded ? v : t('wmsprocure.req.na'))

  const kpis = [
    { label: t('wmsprocure.req.kTotal'), value: show(summary.total), icon: ShoppingCart, tone: 'neutral', hint: loaded ? t(summary.requesters === 1 ? 'wmsprocure.req.kRequesterOne' : 'wmsprocure.req.kRequesterMany', { count: summary.requesters }) : null },
    { label: t('wmsprocure.req.kPending'), value: show(summary.pending), icon: Clock, tone: 'warn', hint: loaded ? t('wmsprocure.req.kPendingHint', { draft: summary.byStatus.draft, submitted: summary.byStatus.submitted }) : null },
    { label: t('wmsprocure.req.kApproved'), value: show(summary.approved), icon: CheckCircle2, tone: 'info', hint: loaded && summary.approvalRate != null ? t('wmsprocure.req.kApprovedHint', { pct: summary.approvalRate }) : t('wmsprocure.req.kNoDecisions'), onClick: () => setStatusFilter(statusFilter === 'approved' ? 'all' : 'approved'), active: statusFilter === 'approved' },
    { label: t('wmsprocure.req.kOverdue'), value: show(summary.overdue), icon: CalendarX, tone: 'crit', hint: t('wmsprocure.req.kOverdueHint'), onClick: () => setDueFilter(dueFilter === 'overdue' ? 'all' : 'overdue'), active: dueFilter === 'overdue' },
    { label: t('wmsprocure.req.kDueSoon', { days: DUE_SOON_DAYS }), value: show(summary.dueSoon), icon: CalendarClock, tone: 'warn', onClick: () => setDueFilter(dueFilter === 'due_soon' ? 'all' : 'due_soon'), active: dueFilter === 'due_soon' },
    { label: t('wmsprocure.req.kValue'), value: loaded ? fmtMoney(summary.totalValue) : t('wmsprocure.req.na'), icon: DollarSign, tone: 'accent', hint: loaded ? t('wmsprocure.req.kValueHint', { valued: summary.valued, total: summary.total }) : null },
    { label: t('wmsprocure.req.kOpenValue'), value: loaded ? fmtMoney(summary.openValue) : t('wmsprocure.req.na'), icon: DollarSign, tone: 'neutral', hint: t('wmsprocure.req.kOpenValueHint') },
    { label: t('wmsprocure.req.kRequesters'), value: show(summary.requesters), icon: Users, tone: 'neutral' },
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
      setActionMsg(t(decision === 'approved' ? 'wmsprocure.req.decidedApproved' : 'wmsprocure.req.decidedRejected', { name: row.requisition_no || row.item }))
      load()
    } catch (e) { setActionMsg(toUserMessage(e, t('wmsprocure.req.decideErr'))) }
  }, [load, profile, user, t])

  const columns = useMemo(() => [
    {
      id: 'item', header: t('wmsprocure.req.colItem'), accessorFn: (r) => r.item || '',
      cell: ({ row }) => <span className="font-medium text-[var(--text-primary)]">{row.original.item || t('wmsprocure.req.na')}</span>,
    },
    { id: 'requisition_no', header: t('wmsprocure.req.colReqNo'), accessorFn: (r) => r.requisition_no || '', cell: ({ getValue }) => <span className="font-mono text-xs" dir="ltr">{getValue() || t('wmsprocure.req.na')}</span> },
    { id: 'category', header: t('wmsprocure.req.categoryLabel'), accessorFn: (r) => tv(t, 'wmsprocure.req.category', r.category, cap(r.category)) || '', cell: ({ getValue }) => getValue() || t('wmsprocure.req.na') },
    { id: 'requester', header: t('wmsprocure.req.requester'), accessorFn: (r) => r.requester || '', cell: ({ getValue }) => getValue() || t('wmsprocure.req.na') },
    { id: 'site', header: t('wmsprocure.req.site'), accessorFn: (r) => r.site || '', cell: ({ getValue }) => getValue() || t('wmsprocure.req.na') },
    { id: 'po_ref', header: t('wmsprocure.req.colPo'), accessorFn: (r) => r.po_ref || '', cell: ({ getValue }) => <span className="font-mono text-xs" dir="ltr">{getValue() || t('wmsprocure.req.na')}</span> },
    { id: 'quantity', header: t('wmsprocure.req.colQty'), accessorFn: (r) => (r.quantity == null || r.quantity === '' ? null : Number(r.quantity)), meta: { align: 'right' }, cell: ({ getValue }) => (getValue() == null ? t('wmsprocure.req.na') : getValue()) },
    { id: 'est_cost', header: t('wmsprocure.req.colUnitCost'), accessorFn: (r) => (r.est_cost == null || r.est_cost === '' ? null : Number(r.est_cost)), meta: { align: 'right' }, cell: ({ getValue }) => fmtMoney(getValue()) },
    { id: 'line_value', header: t('wmsprocure.req.colEstValue'), accessorFn: (r) => lineValue(r), meta: { align: 'right' }, cell: ({ getValue }) => <span className="font-medium">{fmtMoney(getValue())}</span> },
    {
      id: 'needed_by', header: t('wmsprocure.req.neededBy'), accessorFn: (r) => r.needed_by || '',
      cell: ({ row }) => {
        const band = dueBand(row.original, now)
        const d = DUE_META[band]
        return (
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            <span>{fmtDate(row.original.needed_by)}</span>
            {(band === 'overdue' || band === 'due_soon') && <span className={`text-[11px] px-1.5 py-0.5 rounded ${d.cls}`}>{t(`wmsprocure.req.due.${band}`)}</span>}
          </span>
        )
      },
    },
    {
      id: 'status', header: t('wmsprocure.req.statusLabel'), accessorFn: (r) => tv(t, 'wmsprocure.req.status', r.status),
      meta: { filterVariant: 'select' },
      cell: ({ row }) => {
        const st = STATUS_META[row.original.status] || STATUS_META.draft
        return <span className={`badge text-[11px] px-2 py-0.5 rounded ${st.cls}`}>{tv(t, 'wmsprocure.req.status', STATUS_META[row.original.status] ? row.original.status : 'draft')}</span>
      },
    },
    {
      id: 'actions', header: '', enableSorting: false, enableHiding: false, meta: { export: false },
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          {canDecideRequisition(row.original, { canProcure: caps.procure, userId: user?.id || null }) && (
            <>
              <button type="button" onClick={(e) => { e.stopPropagation(); decide(row.original, 'approved') }} className="btn-secondary text-xs min-h-[44px]">{t('wmsprocure.req.approve')}</button>
              <button type="button" onClick={(e) => { e.stopPropagation(); decide(row.original, 'rejected') }} className="btn-secondary text-xs min-h-[44px]">{t('wmsprocure.req.reject')}</button>
            </>
          )}
          {canRaisePo(row.original, { canProcure: caps.procure }) && (
            <button type="button" onClick={(e) => { e.stopPropagation(); setRaising(row.original) }} className="btn-primary text-xs min-h-[44px]">{t('wmsprocure.req.raisePo')}</button>
          )}
          <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(row.original) }} aria-label={t('wmsprocure.req.editAria', { name: row.original.item || t('wmsprocure.req.reqWord') })} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg hover:bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--brand-bright)]"><Pencil size={15} /></button>
          {caps.adminDelete && <button type="button" onClick={(e) => { e.stopPropagation(); setDeleting(row.original) }} aria-label={t('wmsprocure.req.deleteAria', { name: row.original.item || t('wmsprocure.req.reqWord') })} className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400 focus-visible:ring-2 focus-visible:ring-red-400"><Trash2 size={15} /></button>}
        </div>
      ),
    },
  ], [fmtMoney, now, openEdit, caps.procure, caps.adminDelete, decide, user?.id, t])

  const capped = loaded && rows.length >= READ_CAP

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('wmsprocure.req.title')}
        subtitle={t('wmsprocure.req.subtitle')}
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
              <FileSpreadsheet size={14} /> {t('wmsprocure.req.excel')}
            </button>
            <button
              type="button"
              onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Purchase Requisitions', fileName, 'landscape', '', { currency: activeCurrency })}
              className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!filtered.length}
            >
              <FileText size={14} /> {t('wmsprocure.req.pdf')}
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]">
              <Plus size={15} /> {t('wmsprocure.req.newTitle')}
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3" role="status">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">{t('wmsprocure.req.notEnabled')}</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              {t('wmsprocure.req.apply')} <span className="font-mono text-[var(--text-primary)]" dir="ltr">MIGRATIONS_V156_REQUISITIONS.sql</span>{t('wmsprocure.req.thenReload')}
            </p>
          </div>
        </div>
      )}

      {money.mixed && (
        <p className="text-xs text-amber-300" role="status">
          {t('wmsprocure.req.mixedNote', { currencies: money.currencies.join(', ') })}
        </p>
      )}
      {actionMsg && <p className="text-sm text-[var(--text-secondary)]" role="status">{actionMsg}</p>}

      {capped && (
        <p className="text-xs text-amber-300" role="status">
          {t('wmsprocure.req.capped', { cap: READ_CAP })}
        </p>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((k, i) => <Kpi key={k.label} index={i} {...k} />)}
      </div>

      {loaded && summary.byCategory.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{t('wmsprocure.req.byCategory')}</h2>
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
                    className="w-full text-start min-h-[44px] rounded-lg px-2 py-1 hover:bg-[var(--input-bg)] focus-visible:ring-2 focus-visible:ring-[var(--brand-bright)]"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--text-secondary)]">{tv(t, 'wmsprocure.req.category', c.key, cap(c.key))} <span className="text-[var(--text-muted)]">({c.count})</span></span>
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
            <Search size={15} className="absolute start-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input className="input ps-9 w-full min-h-[44px]" placeholder={t('wmsprocure.req.searchPlaceholder')} aria-label={t('wmsprocure.req.searchAria')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label={t('wmsprocure.req.statusLabel')}>
            <option value="all">{t('wmsprocure.req.allStatuses')}</option>
            {REQUISITION_STATUSES.map((s) => <option key={s} value={s}>{tv(t, 'wmsprocure.req.status', s)}</option>)}
          </select>
          <select className="input min-h-[44px]" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} aria-label={t('wmsprocure.req.categoryLabel')}>
            <option value="all">{t('wmsprocure.req.allCategories')}</option>
            {categoryOptions.map((c) => <option key={c} value={c}>{tv(t, 'wmsprocure.req.category', c, cap(c))}</option>)}
          </select>
          <select className="input min-h-[44px]" value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} aria-label={t('wmsprocure.req.site')}>
            <option value="all">{t('wmsprocure.req.allSites')}</option>
            {siteOptions.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className="input min-h-[44px]" value={dueFilter} onChange={(e) => setDueFilter(e.target.value)} aria-label={t('wmsprocure.req.neededByAria')}>
            <option value="all">{t('wmsprocure.req.anyNeededBy')}</option>
            {DUE_BANDS.map((b) => <option key={b.key} value={b.key}>{tv(t, 'wmsprocure.req.dueBand', b.key, b.label).replace('{days}', String(DUE_SOON_DAYS))}</option>)}
          </select>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} /> {t('wmsprocure.req.clear')}</button>}
          <span className="text-xs text-[var(--text-muted)] ms-auto" aria-live="polite">{t('wmsprocure.req.countOf', { count: filtered.length, total: summary.total })}</span>
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
        emptyMessage={summary.total === 0 ? t('wmsprocure.req.emptyFirst') : t('wmsprocure.req.emptyFiltered')}
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
          onDone={(po) => { setRaising(null); setActionMsg(po ? t('wmsprocure.req.poRaised', { po: po.po_number }) : t('wmsprocure.req.poRaisedPlain')); load() }}
        />
      )}
      <DeleteDialog row={deleting} onCancel={() => setDeleting(null)} onConfirm={confirmDelete} />
    </div>
  )
}
