/**
 * GoodsReceipt (route /goods-receipt) — Goods Receipt Notes (GRN). Records the
 * receipt of goods against a purchase order / supplier: GRN number, PO reference,
 * supplier, item, quantities ordered vs received, condition on arrival, receipt
 * date, receiving site, and a status lifecycle (pending → partial → received →
 * rejected). Surfaces KPI tiles (total GRNs, received, partial/pending,
 * shortfall units), a status distribution chart, filters, search, create/edit,
 * delete, and Excel/PDF export.
 *
 * Runs on the new `goods_receipts` table (MIGRATIONS_V157_GOODS_RECEIPTS.sql).
 * When the table is not yet deployed the service degrades to [] and the page
 * prompts to apply the migration. Real data, loading/empty/error states
 * throughout.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
} from 'chart.js'
import { Doughnut } from 'react-chartjs-2'
import {
  PackageCheck, Package, Truck, CheckCircle2, AlertTriangle, Plus, Pencil,
  Trash2, Search, X, Filter, FileSpreadsheet, FileText,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import {
  listGoodsReceipts, createGoodsReceipt, updateGoodsReceipt, deleteGoodsReceipt,
} from '../lib/api/goodsReceipts'
import {
  receiptShortfall, summarizeGoodsReceipts,
  GOODS_RECEIPT_STATUSES, GOODS_RECEIPT_STATUS_META, GOODS_RECEIPT_CONDITIONS,
} from '../lib/goodsReceipts'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'

ChartJS.register(ArcElement, Tooltip, Legend)

const STATUS_BADGE = {
  pending: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  partial: 'bg-sky-900/40 text-sky-300 border border-sky-700/50',
  received: 'bg-green-900/40 text-green-300 border border-green-700/50',
  rejected: 'bg-red-900/40 text-red-300 border border-red-700/50',
}
const STATUS_COLOR = { pending: '#f59e0b', partial: '#38bdf8', received: '#22c55e', rejected: '#ef4444' }

const CONDITION_LABEL = { good: 'Good', damaged: 'Damaged', partial: 'Partial', rejected: 'Rejected' }

const EMPTY_FORM = {
  grn_no: '', po_ref: '', supplier: '', item: '', qty_ordered: '', qty_received: '',
  condition: 'good', received_date: new Date().toISOString().slice(0, 10), site: '',
  status: 'received', notes: '',
}

function fmtDate(v) {
  if (!v) return '—'
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10)
}
function isMissingRelation(err) {
  const m = String(err?.message || '').toLowerCase()
  return m.includes('does not exist') || m.includes('relation') || m.includes('schema cache') || m.includes('could not find the table')
}

export default function GoodsReceipt() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDel, setConfirmDel] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setRefreshing(true); setError(''); setMissing(false)
    try {
      const data = await listGoodsReceipts({ country: activeCountry })
      setRows(Array.isArray(data) ? data : [])
      setUpdatedAt(new Date())
    } catch (err) {
      if (isMissingRelation(err)) { setMissing(true); setRows([]) }
      else { setError(err?.message || 'Could not load goods receipts.'); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  const summary = useMemo(() => summarizeGoodsReceipts(rows || []), [rows])

  const supplierOptions = useMemo(
    () => [...new Set((rows || []).map((r) => r.supplier).filter(Boolean))].sort(),
    [rows],
  )

  const enriched = useMemo(
    () => (rows || []).map((r) => {
      const shortfall = receiptShortfall(r)
      return { ...r, _shortfall: shortfall, _isShort: shortfall != null && shortfall > 0 }
    }),
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return enriched.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false
      if (supplierFilter && r.supplier !== supplierFilter) return false
      if (q) {
        const hay = `${r.grn_no || ''} ${r.po_ref || ''} ${r.supplier || ''} ${r.item || ''} ${r.site || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [enriched, statusFilter, supplierFilter, search])

  // Chart — status distribution
  const chartText = getComputedStyle(document.documentElement).getPropertyValue('--text-muted') || '#9ca3af'
  const donutData = {
    labels: GOODS_RECEIPT_STATUSES.map((s) => GOODS_RECEIPT_STATUS_META[s].label),
    datasets: [{
      data: GOODS_RECEIPT_STATUSES.map((s) => summary.byStatus[s]),
      backgroundColor: GOODS_RECEIPT_STATUSES.map((s) => STATUS_COLOR[s]),
      borderWidth: 0,
    }],
  }
  const donutOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: chartText, boxWidth: 12 } } },
  }

  const kpis = [
    { label: 'Total GRNs', value: summary.total, icon: PackageCheck, tone: 'text-[var(--text-primary)]' },
    { label: 'Received', value: summary.byStatus.received, icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'Partial / pending', value: summary.outstanding, icon: Truck, tone: 'text-amber-400' },
    { label: 'Shortfall units', value: summary.shortfallUnits, icon: AlertTriangle, tone: summary.shortfallUnits > 0 ? 'text-red-400' : 'text-[var(--text-muted)]' },
  ]

  // Export
  const EXPORT_COLS = ['grn_no', 'po_ref', 'supplier', 'item', 'qty_ordered', 'qty_received', 'shortfall', 'condition', 'received_date', 'site', 'status']
  const EXPORT_HEADERS = ['GRN No', 'PO Ref', 'Supplier', 'Item', 'Qty ordered', 'Qty received', 'Shortfall', 'Condition', 'Received', 'Site', 'Status']
  const exportRows = filtered.map((r) => ({
    grn_no: r.grn_no || '', po_ref: r.po_ref || '', supplier: r.supplier || '', item: r.item || '',
    qty_ordered: r.qty_ordered ?? '', qty_received: r.qty_received ?? '',
    shortfall: r._shortfall == null ? '' : r._shortfall,
    condition: CONDITION_LABEL[r.condition] || r.condition || '',
    received_date: r.received_date || '', site: r.site || '',
    status: GOODS_RECEIPT_STATUS_META[r.status]?.label || r.status || '',
  }))

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const openCreate = () => { setEditing(null); setForm(EMPTY_FORM); setFormError(''); setModalOpen(true) }
  const openEdit = (r) => {
    setEditing(r)
    setForm({
      grn_no: r.grn_no || '', po_ref: r.po_ref || '', supplier: r.supplier || '', item: r.item || '',
      qty_ordered: r.qty_ordered ?? '', qty_received: r.qty_received ?? '',
      condition: r.condition || 'good', received_date: r.received_date || '',
      site: r.site || '', status: r.status || 'received', notes: r.notes || '',
    })
    setFormError(''); setModalOpen(true)
  }
  const closeModal = () => { if (!saving) { setModalOpen(false); setEditing(null) } }

  const submit = useCallback(async (e) => {
    e?.preventDefault?.()
    setFormError('')
    if (!form.item.trim() && !form.supplier.trim()) {
      setFormError('Enter an item or a supplier.'); return
    }
    setSaving(true)
    try {
      const payload = { ...form, country: activeCountry && activeCountry !== 'All' ? activeCountry : null }
      const saved = editing ? await updateGoodsReceipt(editing.id, payload) : await createGoodsReceipt(payload)
      setRows((prev) => {
        const list = prev || []
        return editing ? list.map((r) => (r.id === saved.id ? saved : r)) : [saved, ...list]
      })
      setModalOpen(false); setEditing(null)
      setUpdatedAt(new Date())
    } catch (err) {
      setFormError(err?.message || 'Could not save the goods receipt.')
    } finally {
      setSaving(false)
    }
  }, [form, editing, activeCountry])

  const doDelete = useCallback(async () => {
    if (!confirmDel) return
    setDeleting(true)
    try {
      await deleteGoodsReceipt(confirmDel.id)
      setRows((prev) => (prev || []).filter((r) => r.id !== confirmDel.id))
      setConfirmDel(null)
    } catch (err) {
      setError(err?.message || 'Could not delete the goods receipt.')
    } finally {
      setDeleting(false)
    }
  }, [confirmDel])

  const clearFilters = () => { setStatusFilter('all'); setSupplierFilter(''); setSearch('') }
  const hasFilters = statusFilter !== 'all' || supplierFilter || search

  // Live shortfall preview in the form
  const formShortfall = receiptShortfall({ qty_ordered: form.qty_ordered, qty_received: form.qty_received })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Goods Receipt"
        subtitle="Record inward deliveries against purchase orders — quantities, condition, and short-shipment tracking."
        icon={PackageCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'goods_receipts')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={() => exportToPdf(exportRows, EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })), 'Goods Receipt', 'goods_receipts', 'landscape')} className="btn-secondary text-sm inline-flex items-center gap-1.5" disabled={!filtered.length}>
              <FileText size={14} /> PDF
            </button>
            <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus size={14} /> New GRN
            </button>
          </div>
        }
      />

      {missing && (
        <div className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-amber-300 font-medium">Goods receipts aren’t enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V157_GOODS_RECEIPTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="card border border-red-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" />
          <div><p className="text-red-300 font-medium">Couldn’t load goods receipts.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
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

      {/* Chart + short-shipments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Status distribution</h3>
          <div className="h-64">
            {rows && summary.total ? <Doughnut data={donutData} options={donutOpts} /> : (
              <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">
                {rows === null ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" /> : 'No goods receipts recorded yet.'}
              </div>
            )}
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5">
            <AlertTriangle size={15} className="text-amber-400" /> Short shipments
          </h3>
          {rows === null ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-9 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
          ) : enriched.filter((r) => r._isShort).length === 0 ? (
            <div className="h-52 flex flex-col items-center justify-center text-sm text-[var(--text-muted)] gap-2">
              <CheckCircle2 size={24} className="text-green-400" /> No short shipments — all lines fully received.
            </div>
          ) : (
            <div className="max-h-56 overflow-y-auto divide-y divide-[var(--input-border)]/60">
              {enriched.filter((r) => r._isShort).slice(0, 30).map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-[var(--text-primary)] truncate">{r.grn_no || r.item || '—'}</p>
                    <p className="text-xs text-[var(--text-muted)] truncate">{r.supplier || 'Unknown supplier'}{r.item ? ` · ${r.item}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold text-red-400">-{r._shortfall}</span>
                    <span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_BADGE[r.status]}`}>{GOODS_RECEIPT_STATUS_META[r.status]?.label || r.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input className="input pl-9 w-full" placeholder="Search GRN, PO, supplier, item, site…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {GOODS_RECEIPT_STATUSES.map((s) => <option key={s} value={s}>{GOODS_RECEIPT_STATUS_META[s].label}</option>)}
          </select>
          <select className="input" value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} aria-label="Supplier">
            <option value="">All suppliers</option>
            {supplierOptions.map((s) => <option key={s} value={s}>{s}</option>)}
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
                {['GRN No', 'PO Ref', 'Supplier', 'Item', 'Ordered / Received', 'Condition', 'Received', 'Site', 'Status', ''].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows === null ? (
                [0, 1, 2, 3, 4].map((i) => <tr key={i} className="border-b border-[var(--input-border)]/50"><td colSpan={10} className="px-4 py-3"><div className="h-4 bg-[var(--input-bg)] rounded animate-pulse" /></td></tr>)
              ) : filtered.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-[var(--text-muted)]">
                  {summary.total === 0 && !missing ? (
                    <div className="flex flex-col items-center gap-3">
                      <Package size={26} className="opacity-60" />
                      <p>No goods receipts recorded yet.</p>
                      <button onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5"><Plus size={14} /> Record your first GRN</button>
                    </div>
                  ) : (
                    <><Filter size={22} className="mx-auto mb-2 opacity-60" />No goods receipts match these filters.</>
                  )}
                </td></tr>
              ) : (
                filtered.slice(0, 500).map((r) => (
                  <tr key={r.id} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/40">
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-primary)]">{r.grn_no || '—'}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">{r.po_ref || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.supplier || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.item || '—'}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[var(--text-secondary)]">{r.qty_ordered ?? '—'}</span>
                        <span className="text-[var(--text-muted)]">/</span>
                        <span className={`font-semibold ${r._isShort ? 'text-amber-400' : 'text-[var(--text-primary)]'}`}>{r.qty_received ?? '—'}</span>
                        {r._isShort && <span className="text-[11px] text-red-400">(-{r._shortfall})</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{CONDITION_LABEL[r.condition] || r.condition || '—'}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{fmtDate(r.received_date)}</td>
                    <td className="px-4 py-2.5 text-[var(--text-secondary)]">{r.site || '—'}</td>
                    <td className="px-4 py-2.5"><span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_BADGE[r.status]}`}>{GOODS_RECEIPT_STATUS_META[r.status]?.label || r.status}</span></td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1 justify-end">
                        <button onClick={() => openEdit(r)} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]" aria-label="Edit"><Pencil size={14} /></button>
                        <button onClick={() => setConfirmDel(r)} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-red-900/20" aria-label="Delete"><Trash2 size={14} /></button>
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

      {/* Create / edit modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onMouseDown={closeModal}>
          <div className="card w-full max-w-lg max-h-[90vh] overflow-y-auto" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2">
                <PackageCheck size={18} className="text-[var(--brand-bright)]" />
                {editing ? 'Edit goods receipt' : 'New goods receipt'}
              </h2>
              <button onClick={closeModal} className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]" aria-label="Close"><X size={18} /></button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">GRN number</label>
                  <input className="input w-full" placeholder="GRN-2026-00042" value={form.grn_no} onChange={(e) => set('grn_no', e.target.value)} maxLength={120} />
                </div>
                <div>
                  <label className="label">PO reference</label>
                  <input className="input w-full" placeholder="PO-2026-00318" value={form.po_ref} onChange={(e) => set('po_ref', e.target.value)} maxLength={120} />
                </div>
                <div>
                  <label className="label">Supplier</label>
                  <input className="input w-full" placeholder="Gulf Tyre Trading" value={form.supplier} onChange={(e) => set('supplier', e.target.value)} maxLength={200} />
                </div>
                <div>
                  <label className="label">Item</label>
                  <input className="input w-full" placeholder="315/80R22.5 Steer Tyre" value={form.item} onChange={(e) => set('item', e.target.value)} maxLength={200} />
                </div>
                <div>
                  <label className="label">Qty ordered</label>
                  <input type="number" min="0" step="any" className="input w-full" placeholder="100" value={form.qty_ordered} onChange={(e) => set('qty_ordered', e.target.value)} />
                </div>
                <div>
                  <label className="label">Qty received</label>
                  <input type="number" min="0" step="any" className="input w-full" placeholder="100" value={form.qty_received} onChange={(e) => set('qty_received', e.target.value)} />
                </div>
                <div>
                  <label className="label">Condition</label>
                  <select className="input w-full" value={form.condition} onChange={(e) => set('condition', e.target.value)}>
                    {GOODS_RECEIPT_CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c] || c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Received date</label>
                  <input type="date" className="input w-full" value={form.received_date} onChange={(e) => set('received_date', e.target.value)} />
                </div>
                <div>
                  <label className="label">Site</label>
                  <input className="input w-full" placeholder="Riyadh Depot" value={form.site} onChange={(e) => set('site', e.target.value)} maxLength={120} />
                </div>
                <div>
                  <label className="label">Status</label>
                  <select className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                    {GOODS_RECEIPT_STATUSES.map((s) => <option key={s} value={s}>{GOODS_RECEIPT_STATUS_META[s].label}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Notes</label>
                <textarea className="input w-full min-h-[80px] resize-y" placeholder="Discrepancies, damage on arrival, delivery-note reference…" value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />
              </div>
              {formShortfall != null && formShortfall !== 0 && (
                <p className="text-xs text-[var(--text-muted)]">
                  {formShortfall > 0
                    ? <>Short by <span className="font-semibold text-amber-400">{formShortfall}</span> unit{formShortfall === 1 ? '' : 's'}.</>
                    : <>Over-delivery of <span className="font-semibold text-sky-400">{Math.abs(formShortfall)}</span> unit{Math.abs(formShortfall) === 1 ? '' : 's'}.</>}
                </p>
              )}
              {formError && (
                <div className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {formError}
                </div>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={closeModal} className="btn-secondary text-sm" disabled={saving}>Cancel</button>
                <button type="submit" className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-60" disabled={saving}>
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Record GRN'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70" onMouseDown={() => !deleting && setConfirmDel(null)}>
          <div className="card w-full max-w-md" onMouseDown={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-2"><Trash2 size={18} className="text-red-400" /> Delete goods receipt?</h2>
            <p className="text-sm text-[var(--text-muted)] mt-2">
              This permanently removes GRN <span className="font-semibold text-[var(--text-secondary)]">{confirmDel.grn_no || confirmDel.item || confirmDel.id}</span>. This cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2 mt-5">
              <button onClick={() => setConfirmDel(null)} className="btn-secondary text-sm" disabled={deleting}>Cancel</button>
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
