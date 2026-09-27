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
  Trash2, Search, X, Filter, FileSpreadsheet, FileText, Percent, Users, RefreshCw, Loader2,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import Modal from '../components/ui/Modal'
import NotInUseNotice from '../components/ui/NotInUseNotice'
import { useSettings } from '../contexts/SettingsContext'
import {
  listGoodsReceipts, createGoodsReceipt, updateGoodsReceipt, deleteGoodsReceipt,
} from '../lib/api/goodsReceipts'
import {
  receiptShortfall, GOODS_RECEIPT_STATUSES, GOODS_RECEIPT_STATUS_META, GOODS_RECEIPT_CONDITIONS,
} from '../lib/goodsReceipts'
import {
  enrichReceipts, filterReceipts, hasReceiptFilters, receiptKpis, receiptSupplierOptions,
  supplierScorecard, shortShipments, receiptExportRows, CONDITION_LABEL,
  RECEIPT_EXPORT_COLS, RECEIPT_EXPORT_HEADERS,
} from '../lib/goodsReceiptAnalytics'
import { headAndRest } from '../lib/geofencingAnalytics'
import { compareValues } from '../lib/consoleTable'
import { exportToExcel, exportToPdf, reportFileName } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { isMissingRelation } from '../lib/api/_client'

ChartJS.register(ArcElement, Tooltip, Legend)

const STATUS_BADGE = {
  pending: 'bg-amber-900/40 text-amber-300 border border-amber-700/50',
  partial: 'bg-sky-900/40 text-sky-300 border border-sky-700/50',
  received: 'bg-green-900/40 text-green-300 border border-green-700/50',
  rejected: 'bg-red-900/40 text-red-300 border border-red-700/50',
}
// Semantic status hues (status meaning, not categorical decoration).
const STATUS_COLOR = { pending: '#f59e0b', partial: '#38bdf8', received: '#22c55e', rejected: '#ef4444' }

const EMPTY_FORM = {
  grn_no: '', po_ref: '', supplier: '', item: '', qty_ordered: '', qty_received: '',
  condition: 'good', received_date: new Date().toISOString().slice(0, 10), site: '',
  status: 'received', notes: '',
}

const fmtPct = (v) => (v == null ? 'N/A' : `${v}%`)
const sortBy = (a, b, id) => compareValues(a.getValue(id), b.getValue(id))


export default function GoodsReceipt() {
  const { activeCountry } = useSettings()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [missing, setMissing] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const [statusFilter, setStatusFilter] = useState('all')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [conditionFilter, setConditionFilter] = useState('all')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
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
      else { setError(toUserMessage(err, 'Could not load goods receipts.')); setRows([]) }
    } finally {
      setRefreshing(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // A failed read is not an empty register: figures read N/A, never zero.
  const known = rows !== null && !error
  const filters = { status: statusFilter, supplier: supplierFilter, condition: conditionFilter, from: fromDate, to: toDate, search }
  const enriched = useMemo(() => enrichReceipts(rows || []), [rows])
  const supplierOptions = useMemo(() => receiptSupplierOptions(rows || []), [rows])
  const filtered = useMemo(
    () => filterReceipts(enriched, { status: statusFilter, supplier: supplierFilter, condition: conditionFilter, from: fromDate, to: toDate, search }),
    [enriched, statusFilter, supplierFilter, conditionFilter, fromDate, toDate, search],
  )
  const hasFilters = hasReceiptFilters(filters)
  // KPIs follow the filters, so the strip describes the rows on screen.
  const kpi = useMemo(() => receiptKpis(filtered), [filtered])
  const scorecard = useMemo(() => supplierScorecard(filtered), [filtered])
  const shorts = useMemo(() => headAndRest(shortShipments(filtered), 30), [filtered])

  const donutData = {
    labels: GOODS_RECEIPT_STATUSES.map((s) => GOODS_RECEIPT_STATUS_META[s].label),
    datasets: [{
      data: GOODS_RECEIPT_STATUSES.map((s) => kpi.byStatus[s]),
      backgroundColor: GOODS_RECEIPT_STATUSES.map((s) => STATUS_COLOR[s]),
      borderColor: 'var(--card-bg)', borderWidth: 2,
    }],
  }
  const donutOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { color: 'var(--text-muted)', boxWidth: 12 } } },
  }

  const kpis = [
    { label: 'Total GRNs', value: kpi.total, icon: PackageCheck, tone: 'text-[var(--text-primary)]' },
    { label: 'Received', value: kpi.received, icon: CheckCircle2, tone: 'text-green-400' },
    { label: 'Partial / pending', value: kpi.outstanding, icon: Truck, tone: 'text-amber-400' },
    { label: 'Shortfall units', value: kpi.shortfallUnits.toLocaleString(), sub: `${kpi.shortLines} short line${kpi.shortLines === 1 ? '' : 's'}`, icon: AlertTriangle, tone: kpi.shortfallUnits > 0 ? 'text-red-400' : 'text-[var(--text-muted)]' },
    { label: 'Fill rate', value: fmtPct(kpi.fillRatePct), sub: 'received vs ordered', icon: Percent, tone: 'text-sky-400' },
    { label: 'Suppliers', value: kpi.suppliers, sub: kpi.qualityIssuePct == null ? 'no condition recorded' : `${fmtPct(kpi.qualityIssuePct)} damaged or rejected`, icon: Users, tone: 'text-violet-400' },
  ]

  const exportName = reportFileName('Goods Receipts')
  const runExport = async (kind) => {
    setActionError('')
    try {
      const rowsOut = receiptExportRows(filtered)
      if (kind === 'excel') await exportToExcel(rowsOut, RECEIPT_EXPORT_COLS, RECEIPT_EXPORT_HEADERS, exportName)
      else await exportToPdf(rowsOut, RECEIPT_EXPORT_COLS.map((k, i) => ({ key: k, header: RECEIPT_EXPORT_HEADERS[i] })), 'Goods Receipt', exportName, 'landscape')
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

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
      setFormError(toUserMessage(err, 'Could not save the goods receipt.'))
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
      setActionError(toUserMessage(err, 'Could not delete the goods receipt.'))
      setConfirmDel(null)
    } finally {
      setDeleting(false)
    }
  }, [confirmDel])

  const clearFilters = () => {
    setStatusFilter('all'); setSupplierFilter(''); setConditionFilter('all'); setFromDate(''); setToDate(''); setSearch('')
  }

  const formShortfall = receiptShortfall({ qty_ordered: form.qty_ordered, qty_received: form.qty_received })

  const columns = [
    { id: 'grn', header: 'GRN No', accessorFn: (r) => r.grn_no || undefined, sortingFn: sortBy, sortUndefined: 'last', size: 140, cell: ({ getValue }) => <span className="font-mono text-xs text-[var(--text-primary)]">{getValue() || 'N/A'}</span> },
    { id: 'po', header: 'PO Ref', accessorFn: (r) => r.po_ref || undefined, sortingFn: sortBy, sortUndefined: 'last', size: 130, cell: ({ getValue }) => <span className="font-mono text-xs text-[var(--text-secondary)]">{getValue() || 'N/A'}</span> },
    { id: 'supplier', header: 'Supplier', accessorFn: (r) => r.supplier || undefined, sortingFn: sortBy, sortUndefined: 'last', size: 170, cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'item', header: 'Item', accessorFn: (r) => r.item || undefined, sortingFn: sortBy, sortUndefined: 'last', size: 200, cell: ({ getValue }) => getValue() || 'N/A' },
    {
      id: 'qty', header: 'Ordered / Received', accessorFn: (r) => (r.qty_received == null || r.qty_received === '' ? undefined : Number(r.qty_received)), sortUndefined: 'last', size: 170,
      cell: ({ row: { original: r } }) => (
        <div className="flex items-center gap-2">
          <span className="text-[var(--text-secondary)]">{r.qty_ordered ?? 'N/A'}</span>
          <span className="text-[var(--text-muted)]" aria-hidden="true">/</span>
          <span className={`font-semibold ${r._isShort ? 'text-amber-400' : 'text-[var(--text-primary)]'}`}>{r.qty_received ?? 'N/A'}</span>
          {r._isShort && <span className="text-[11px] text-red-400">short {r._shortfall}</span>}
          {r._isOver && <span className="text-[11px] text-sky-400">over {Math.abs(r._shortfall)}</span>}
        </div>
      ),
    },
    { id: 'shortfall', header: 'Shortfall', accessorFn: (r) => r._shortfall ?? undefined, sortUndefined: 'last', size: 110, meta: { align: 'right' }, cell: ({ row: { original: r } }) => (r._shortfall == null ? 'N/A' : r._shortfall) },
    { id: 'condition', header: 'Condition', accessorFn: (r) => r._conditionLabel, sortingFn: sortBy, size: 120 },
    { id: 'date', header: 'Received', accessorFn: (r) => r._date || undefined, sortingFn: sortBy, sortUndefined: 'last', size: 120, cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'site', header: 'Site', accessorFn: (r) => r.site || undefined, sortingFn: sortBy, sortUndefined: 'last', size: 140, cell: ({ getValue }) => getValue() || 'N/A' },
    { id: 'status', header: 'Status', accessorFn: (r) => r._statusLabel, sortingFn: sortBy, size: 120, cell: ({ row: { original: r } }) => <span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_BADGE[r.status] || ''}`}>{r._statusLabel}</span> },
    {
      id: 'actions', header: '', enableSorting: false, size: 104, meta: { export: false },
      cell: ({ row: { original: r } }) => (
        <div className="flex items-center gap-1 justify-end">
          <button type="button" onClick={() => openEdit(r)} className="inline-flex items-center justify-center w-11 h-11 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--input-bg)]" aria-label={`Edit goods receipt ${r.grn_no || r.item || ''}`.trim()}><Pencil size={15} aria-hidden="true" /></button>
          <button type="button" onClick={() => setConfirmDel(r)} className="inline-flex items-center justify-center w-11 h-11 rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-red-900/20" aria-label={`Delete goods receipt ${r.grn_no || r.item || ''}`.trim()}><Trash2 size={15} aria-hidden="true" /></button>
        </div>
      ),
    },
  ]
  const scoreColumns = [
    { id: 'supplier', header: 'Supplier', accessorFn: (r) => r.supplier, sortingFn: sortBy, size: 200 },
    { id: 'lines', header: 'Lines', accessorFn: (r) => r.lines, size: 80, meta: { align: 'right' } },
    { id: 'fill', header: 'Fill rate', accessorFn: (r) => r.fillRatePct ?? undefined, sortUndefined: 'last', size: 100, meta: { align: 'right' }, cell: ({ row: { original: r } }) => fmtPct(r.fillRatePct) },
    { id: 'short', header: 'Short lines', accessorFn: (r) => r.shortLines, size: 100, meta: { align: 'right' } },
    { id: 'units', header: 'Shortfall units', accessorFn: (r) => r.shortfallUnits, size: 120, meta: { align: 'right' } },
    { id: 'quality', header: 'Damaged or rejected', accessorFn: (r) => r.qualityIssues, size: 150, meta: { align: 'right' } },
    { id: 'outstanding', header: 'Outstanding', accessorFn: (r) => r.outstanding, size: 110, meta: { align: 'right' } },
  ]

  const field = (id, label, input) => (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      {input}
    </div>
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Goods Receipt"
        subtitle="Record inward deliveries against purchase orders: quantities, condition, and short-shipment tracking."
        icon={PackageCheck}
        onRefresh={load}
        refreshing={refreshing}
        updatedAt={updatedAt}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => runExport('excel')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!known || !filtered.length}>
              <FileSpreadsheet size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={() => runExport('pdf')} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={!known || !filtered.length}>
              <FileText size={14} aria-hidden="true" /> PDF
            </button>
            <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]" disabled={missing}>
              <Plus size={14} aria-hidden="true" /> New GRN
            </button>
          </div>
        }
      />
      <NotInUseNotice count={known ? rows.length : undefined} label="goods receipts"
        hint="Receipts appear once stock is received against a purchase order." />

      {missing && (
        <div role="status" className="card border border-amber-800/50 flex items-start gap-3">
          <AlertTriangle size={18} className="text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="text-amber-300 font-medium">Goods receipts are not enabled on this database yet.</p>
            <p className="text-[var(--text-muted)] text-sm mt-1">
              Apply <span className="font-mono text-[var(--text-primary)]">MIGRATIONS_V157_GOODS_RECEIPTS.sql</span>, then reload.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" className="card border border-red-800/50 flex flex-wrap items-start gap-3">
          <AlertTriangle size={18} className="text-red-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0"><p className="text-red-300 font-medium">Could not load goods receipts.</p><p className="text-[var(--text-muted)] text-sm mt-1">{error}</p></div>
          <button type="button" onClick={load} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><RefreshCw size={14} aria-hidden="true" /> Retry</button>
        </div>
      )}
      {actionError && <p role="alert" className="card text-sm text-red-300">{actionError}</p>}

      {/* KPI strip (follows the filters) */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon
          return (
            <div key={k.label} className="card">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-[var(--text-muted)]">{k.label}</p>
                <Icon size={16} className={k.tone} aria-hidden="true" />
              </div>
              <p className={`text-2xl font-bold mt-1 tabular-nums ${k.tone}`}>{known ? k.value : 'N/A'}</p>
              {k.sub && known ? <p className="text-[11px] text-[var(--text-muted)] mt-0.5">{k.sub}</p> : null}
            </div>
          )
        })}
      </div>

      {/* Chart + short-shipments */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Status distribution</h2>
          <div className="h-64">
            {rows === null ? <div className="w-full h-full bg-[var(--input-bg)] rounded animate-pulse" />
              : !known ? <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">Unavailable: the receipts could not be read.</div>
              : kpi.total ? <Doughnut data={donutData} options={donutOpts} aria-label={`Status distribution: ${GOODS_RECEIPT_STATUSES.map((st) => `${GOODS_RECEIPT_STATUS_META[st].label} ${kpi.byStatus[st]}`).join(', ')}`} role="img" />
              : <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">{hasFilters ? 'No receipts match these filters.' : 'No goods receipts recorded yet.'}</div>}
          </div>
        </div>
        <div className="card">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3 flex items-center gap-1.5">
            <AlertTriangle size={15} className="text-amber-400" aria-hidden="true" /> Short shipments
          </h2>
          {rows === null ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-9 bg-[var(--input-bg)] rounded animate-pulse" />)}</div>
          ) : !known ? (
            <p className="text-sm text-[var(--text-muted)]">Unavailable: the receipts could not be read.</p>
          ) : shorts.head.length === 0 ? (
            <div className="h-52 flex flex-col items-center justify-center text-sm text-[var(--text-muted)] gap-2">
              <CheckCircle2 size={24} className="text-green-400" aria-hidden="true" /> No short shipments in this view.
            </div>
          ) : (
            <ul className="max-h-56 overflow-y-auto divide-y divide-[var(--input-border)]/60">
              {shorts.head.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-[var(--text-primary)] truncate">{r.grn_no || r.item || 'N/A'}</p>
                    <p className="text-xs text-[var(--text-muted)] truncate">{r.supplier || 'Unknown supplier'}{r.item ? ` | ${r.item}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-semibold text-red-400">short {r._shortfall}</span>
                    <span className={`badge text-[11px] px-2 py-0.5 rounded ${STATUS_BADGE[r.status] || ''}`}>{r._statusLabel}</span>
                  </div>
                </li>
              ))}
              {shorts.rest > 0 && <li className="py-2 text-xs text-[var(--text-muted)]">and {shorts.rest} more. Export for the full list.</li>}
            </ul>
          )}
        </div>
      </div>

      {/* Supplier scorecard */}
      {known && scorecard.length > 0 && (
        <div className="card !p-0 overflow-hidden">
          <div className="px-4 pt-4 pb-2">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Supplier scorecard</h2>
            <p className="text-xs text-[var(--text-muted)]">Worst fill rate first. Fill rate is N/A where no line records both quantities.</p>
          </div>
          <EnterpriseTable columns={scoreColumns} data={scorecard} getRowId={(r) => r.supplier} enableGlobalFilter={false} enableColumnFilters={false} enableExport={false} initialPageSize={25} emptyMessage="No suppliers in this view." />
        </div>
      )}

      {/* Filters */}
      <div className="card">
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <label htmlFor="grn-search" className="sr-only">Search receipts</label>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
            <input id="grn-search" type="search" className="input pl-9 w-full min-h-[44px]" placeholder="Search GRN, PO, supplier, item, site" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="input min-h-[44px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status">
            <option value="all">All statuses</option>
            {GOODS_RECEIPT_STATUSES.map((s) => <option key={s} value={s}>{GOODS_RECEIPT_STATUS_META[s].label}</option>)}
          </select>
          <select className="input min-h-[44px]" value={conditionFilter} onChange={(e) => setConditionFilter(e.target.value)} aria-label="Condition">
            <option value="all">All conditions</option>
            {GOODS_RECEIPT_CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c] || c}</option>)}
          </select>
          <select className="input min-h-[44px]" value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} aria-label="Supplier">
            <option value="">All suppliers</option>
            {supplierOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <label className="text-xs text-[var(--text-muted)] flex flex-col gap-1">From
            <input type="date" className="input min-h-[44px]" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label className="text-xs text-[var(--text-muted)] flex flex-col gap-1">To
            <input type="date" className="input min-h-[44px]" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
          {hasFilters && <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear</button>}
          <span className="text-xs text-[var(--text-muted)] ml-auto" aria-live="polite">{known ? `${filtered.length} of ${rows.length}` : 'N/A'}</span>
        </div>
      </div>

      {/* Register */}
      <div className="card overflow-hidden !p-0">
        {known && filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-[var(--text-muted)]">
            {rows.length === 0 && !missing ? (
              <div className="flex flex-col items-center gap-3">
                <Package size={26} className="opacity-60" aria-hidden="true" />
                <p>No goods receipts recorded yet.</p>
                <button type="button" onClick={openCreate} className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><Plus size={14} aria-hidden="true" /> Record your first GRN</button>
              </div>
            ) : missing ? (
              <p>Goods receipts are not provisioned on this database.</p>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <Filter size={22} className="opacity-60" aria-hidden="true" />
                <p>No goods receipts match these filters.</p>
                <button type="button" onClick={clearFilters} className="btn-secondary text-sm inline-flex items-center gap-1.5 min-h-[44px]"><X size={14} aria-hidden="true" /> Clear filters</button>
              </div>
            )}
          </div>
        ) : (
          <EnterpriseTable
            columns={columns}
            data={filtered}
            getRowId={(r) => String(r.id)}
            loading={rows === null}
            error={error || null}
            onRetry={load}
            enableGlobalFilter={false}
            enableColumnFilters={false}
            enableExport={false}
            initialPageSize={25}
            emptyMessage="No goods receipts to show."
          />
        )}
      </div>

      {/* Create / edit modal */}
      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={editing ? 'Edit goods receipt' : 'New goods receipt'}
        size="lg"
        footer={(
          <>
            <button type="button" onClick={closeModal} className="btn-secondary text-sm min-h-[44px]" disabled={saving}>Cancel</button>
            <button type="submit" form="grn-form" className="btn-primary text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={saving}>
              {saving ? <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Saving</> : editing ? 'Save changes' : 'Record GRN'}
            </button>
          </>
        )}
      >
        <form id="grn-form" onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {field('grn-no', 'GRN number', <input id="grn-no" className="input w-full" placeholder="GRN-2026-00042" value={form.grn_no} onChange={(e) => set('grn_no', e.target.value)} maxLength={120} />)}
            {field('grn-po', 'PO reference', <input id="grn-po" className="input w-full" placeholder="PO-2026-00318" value={form.po_ref} onChange={(e) => set('po_ref', e.target.value)} maxLength={120} />)}
            {field('grn-supplier', 'Supplier', <input id="grn-supplier" className="input w-full" placeholder="Gulf Tyre Trading" value={form.supplier} onChange={(e) => set('supplier', e.target.value)} maxLength={200} list="grn-supplier-options" />)}
            {field('grn-item', 'Item', <input id="grn-item" className="input w-full" placeholder="315/80R22.5 Steer Tyre" value={form.item} onChange={(e) => set('item', e.target.value)} maxLength={200} />)}
            {field('grn-ordered', 'Qty ordered', <input id="grn-ordered" type="number" inputMode="decimal" min="0" step="any" className="input w-full" placeholder="100" value={form.qty_ordered} onChange={(e) => set('qty_ordered', e.target.value)} />)}
            {field('grn-received', 'Qty received', <input id="grn-received" type="number" inputMode="decimal" min="0" step="any" className="input w-full" placeholder="100" value={form.qty_received} onChange={(e) => set('qty_received', e.target.value)} />)}
            {field('grn-condition', 'Condition', (
              <select id="grn-condition" className="input w-full" value={form.condition} onChange={(e) => set('condition', e.target.value)}>
                {GOODS_RECEIPT_CONDITIONS.map((c) => <option key={c} value={c}>{CONDITION_LABEL[c] || c}</option>)}
              </select>
            ))}
            {field('grn-date', 'Received date', <input id="grn-date" type="date" className="input w-full" value={form.received_date} onChange={(e) => set('received_date', e.target.value)} />)}
            {field('grn-site', 'Site', <input id="grn-site" className="input w-full" placeholder="Riyadh Depot" value={form.site} onChange={(e) => set('site', e.target.value)} maxLength={120} />)}
            {field('grn-status', 'Status', (
              <select id="grn-status" className="input w-full" value={form.status} onChange={(e) => set('status', e.target.value)}>
                {GOODS_RECEIPT_STATUSES.map((s) => <option key={s} value={s}>{GOODS_RECEIPT_STATUS_META[s].label}</option>)}
              </select>
            ))}
          </div>
          <datalist id="grn-supplier-options">{supplierOptions.map((s) => <option key={s} value={s} />)}</datalist>
          {field('grn-notes', 'Notes', <textarea id="grn-notes" className="input w-full min-h-[80px] resize-y" placeholder="Discrepancies, damage on arrival, delivery-note reference" value={form.notes} maxLength={4000} onChange={(e) => set('notes', e.target.value)} />)}
          {formShortfall != null && formShortfall !== 0 && (
            <p className="text-xs text-[var(--text-muted)]" aria-live="polite">
              {formShortfall > 0
                ? <>Short by <span className="font-semibold text-amber-400">{formShortfall}</span> unit{formShortfall === 1 ? '' : 's'}.</>
                : <>Over-delivery of <span className="font-semibold text-sky-400">{Math.abs(formShortfall)}</span> unit{Math.abs(formShortfall) === 1 ? '' : 's'}.</>}
            </p>
          )}
          {formError && (
            <div role="alert" className="flex items-start gap-2 text-sm text-red-300 bg-red-900/20 border border-red-800/50 rounded-lg px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> {formError}
            </div>
          )}
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!confirmDel}
        onClose={() => { if (!deleting) setConfirmDel(null) }}
        title="Delete goods receipt?"
        size="sm"
        footer={(
          <>
            <button type="button" onClick={() => setConfirmDel(null)} className="btn-secondary text-sm min-h-[44px]" disabled={deleting}>Cancel</button>
            <button type="button" onClick={doDelete} className="btn-danger text-sm inline-flex items-center gap-1.5 min-h-[44px] disabled:opacity-60" disabled={deleting}>
              <Trash2 size={14} aria-hidden="true" /> {deleting ? 'Deleting' : 'Delete'}
            </button>
          </>
        )}
      >
        <p className="text-sm text-[var(--text-muted)]">
          This permanently removes GRN <span className="font-semibold text-[var(--text-secondary)]">{confirmDel?.grn_no || confirmDel?.item || confirmDel?.id}</span>. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}
