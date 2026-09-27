import { useEffect, useState, useMemo, useCallback } from 'react'
import { stock } from '../lib/api'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import {
  Plus, Save, History, FileText, Download, ArrowLeftRight, Package, Lock, RefreshCw, Search, X,
  AlertTriangle, Boxes, Clock, MapPin, ShoppingCart, ChevronUp, ChevronDown, ChevronsUpDown,
} from 'lucide-react'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import StatTile from '../components/ui/StatTile'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import { motion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'
import Card, { CardBody, CardHeader } from '../components/ui/Card'
import Modal from '../components/ui/Modal'
import TablePagination, { usePagedRows } from '../components/ui/TablePagination'
import { formatDate } from '../lib/formatters'
import { toUserMessage } from '../lib/safeError'
import useLatestRequest from '../lib/useLatestRequest'
import { useLanguage } from '../contexts/LanguageContext'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar } from 'react-chartjs-2'
import { loadAutoTable } from '../lib/pdfEngine'
import { sortRows, nextSort } from '../lib/consoleTable'
import {
  deriveStatus, buildVelocityMap, enrichStock, filterStock, summarizeStock, timelineByDate,
  timelineSummary, coverBand, stockExportRows, STOCK_EXPORT_COLS, STOCK_EXPORT_HEADERS, STATUSES,
  todayStr, offsetDate, firstOfMonth, velocitySince,
} from '../lib/stockManagementAnalytics'

// exportUtils pulls the PDF/Excel report engines that most sessions never
// trigger, so it loads on first click instead of riding with the route chunk.
const loadExportUtils = () => import('../lib/exportUtils')

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

const STATUS_BADGE = {
  OK:       'border-green-500/40 text-green-500',
  Low:      'border-amber-500/40 text-amber-500',
  Critical: 'border-red-500/40 text-red-500',
}

const EMPTY_FORM = {
  site: '', description: '', stock_qty: 0, min_level: 5, critical_level: 3, management_action: '',
}

// Canonical ledger movement types (the server RPC derives +/- direction from these).
const MOVEMENT_TYPES = ['receipt', 'return', 'transfer_in', 'adjustment_up', 'issue', 'transfer_out', 'scrap', 'adjustment_down']
const ADD_TYPES = new Set(['receipt', 'return', 'transfer_in', 'adjustment_up', 'in', 'reorder', 'initial'])

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-bright,#22c55e)]'
const CTRL = `min-h-[44px] bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-secondary)] text-sm rounded-lg px-3 ${FOCUS}`

// Cover band -> text colour. The day count is always printed beside it.
const COVER_TONE = {
  unknown: 'text-[var(--text-muted)]',
  healthy: 'text-green-500 font-semibold',
  watch: 'text-amber-500 font-semibold',
  urgent: 'text-red-500 font-bold',
}

function SortButton({ label, active, dir, onClick, align }) {
  const Icon = !active ? ChevronsUpDown : dir === 'asc' ? ChevronUp : ChevronDown
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 min-h-[32px] rounded ${FOCUS} ${align === 'right' ? 'flex-row-reverse' : ''} ${active ? 'text-[var(--text-primary)]' : ''}`}
      aria-label={`Sort by ${label}${active ? `, currently ${dir === 'asc' ? 'ascending' : 'descending'}` : ''}`}
    >
      {label}
      <Icon size={12} aria-hidden="true" />
    </button>
  )
}

/**
 * EnterpriseTable over the shared pager. Sorting runs over the FULL row set
 * before paging (usePagedRows), so a sort never re-orders only the visible page.
 */
function SortedPagedTable({ columns, rows, defaultSort, getRowId, emptyMessage, loading, error, onRetry, pageSize }) {
  const [sort, setSort] = useState(defaultSort)
  const sorted = useMemo(() => {
    const col = columns.find(c => c.id === sort?.key)
    return col?.sort ? sortRows(rows, sort, { [col.id]: col.sort }) : rows
  }, [rows, columns, sort])
  const pager = usePagedRows(sorted, pageSize ? { pageSize } : undefined)
  const tableColumns = useMemo(() => columns.map(c => ({
    id: c.id,
    accessorFn: c.sort || (r => r[c.id]),
    header: c.sort
      ? () => <SortButton label={c.header} align={c.align} active={sort?.key === c.id} dir={sort?.dir}
          onClick={() => setSort(s => nextSort(s, c.id, c.firstDir || 'desc'))} />
      : c.header,
    cell: c.cell ? ({ row }) => c.cell(row.original) : undefined,
    size: c.size,
    enableSorting: false,
    meta: { align: c.align, export: c.id !== 'actions' },
  })), [columns, sort])
  return (
    <div className="space-y-2">
      <EnterpriseTable
        columns={tableColumns}
        data={pager.pageRows}
        getRowId={getRowId}
        loading={loading}
        error={error || null}
        onRetry={onRetry}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableSorting={false}
        enableExport={false}
        emptyMessage={emptyMessage}
      />
      {!loading && !error && <TablePagination {...pager} />}
    </div>
  )
}

export default function StockManagement() {
  const { t } = useLanguage()
  const { profile } = useAuth()
  const { appSettings, activeCountry } = useSettings()
  const { branding } = useTenant()
  const [records, setRecords]       = useState([])
  const [loading, setLoading]       = useState(true)
  const [showForm, setShowForm]     = useState(false)
  const [form, setForm]             = useState(EMPTY_FORM)
  const [editId, setEditId]         = useState(null)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState('')
  const [historyFor, setHistoryFor] = useState(null)
  const [movements, setMovements]   = useState([])
  const [loadingMov, setLoadingMov] = useState(false)
  const [movError, setMovError]     = useState('')
  const [adjForm, setAdjForm]       = useState(null)
  // Approval-engine gate: locks the ledger-post (issuance/adjustment) control for
  // the open record while its workflow is active (pending/in_review/returned) or
  // locked (approved). Reset whenever a different record's history is opened.
  const [wfLocked, setWfLocked]     = useState(false)
  // Approval-engine gate for a Tyre Return ledger post (movement_type === 'return')
  // in the history/adjust modal. Independent of the general stock_issue lock so a
  // return-specific workflow can block only the return post it authorises.
  const [returnWfLocked, setReturnWfLocked] = useState(false)

  // Velocity state
  const [velocityMap, setVelocityMap] = useState({})

  // Timeline tab state
  const [activeTab, setActiveTab]       = useState('stock')
  const [tlFrom, setTlFrom]             = useState(offsetDate(-6))
  const [tlTo, setTlTo]                 = useState(todayStr())
  const [tlRecords, setTlRecords]       = useState([])
  const [tlLoading, setTlLoading]       = useState(false)
  const [tlError, setTlError]           = useState('')

  // Transfer tab state
  const [transferForm, setTransferForm] = useState({ fromSite: '', toSite: '', qty: 1, notes: '' })
  const [transferring, setTransferring] = useState(false)
  const [transferMsg, setTransferMsg]   = useState('')
  const [transferError, setTransferError] = useState('')
  // Approval-engine gate for the inter-site transfer post. Locks the "Transfer
  // stock" control while the tyre_transfer workflow is active/locked.
  const [transferWfLocked, setTransferWfLocked] = useState(false)

  // Reset the approval lock whenever a different record (or none) is opened in the
  // history modal; EntityApprovalPanel re-reports the true state via onStateChange.
  useEffect(() => { setWfLocked(false); setReturnWfLocked(false) }, [historyFor?.id])

  const [loadError, setLoadError] = useState('')
  const [search, setSearch]           = useState('')
  const [siteFilter, setSiteFilter]   = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const stockRecords = await stock.listStockRecords({ country: activeCountry }) ?? []
      setRecords(stockRecords)
      // Velocity from tyre issues over the last 3 months. Best-effort: a failed
      // velocity read leaves cover as N/A instead of failing the stock register.
      let velData = []
      try { velData = await stock.listTyreIssuesSince(velocitySince(new Date(), 3)) ?? [] } catch { velData = null }
      setVelocityMap(velData ? buildVelocityMap(stockRecords, velData, 3) : {})
    } catch (err) {
      // A failed read must never render as an empty register.
      setRecords([])
      setLoadError(toUserMessage(err, t('stock.errors.loadFailed')))
    } finally {
      setLoading(false)
    }
  }, [activeCountry, t])

  useEffect(() => { load() }, [load])

  // Stable identities on purpose. Modal's behaviour hook lists `onClose` in its
  // dependency array, so an inline arrow re-runs the effect on EVERY render of
  // this page. The movement-history dialog carries text inputs whose keystrokes
  // re-render the page, and a re-run re-focuses the panel - the field would lose
  // focus after each character.
  const closeHistory = useCallback(() => setHistoryFor(null), [])
  const closeForm = useCallback(() => setShowForm(false), [])

  function startAdd() { setForm(EMPTY_FORM); setEditId(null); setShowForm(true); setError('') }
  function startEdit(r) {
    setForm({
      site: r.site, description: r.description ?? '',
      stock_qty: r.stock_qty, min_level: r.min_level, critical_level: r.critical_level,
      management_action: r.management_action ?? '',
    })
    setEditId(r.id)
    setShowForm(true)
    setError('')
  }

  async function save(e) {
    e.preventDefault()
    setSaving(true)
    setError('')

    const prevRecord = editId ? records.find(r => r.id === editId) : null
    const prevQty    = prevRecord?.stock_qty ?? 0
    const newQty     = +form.stock_qty
    const status     = deriveStatus(form)

    const payload = {
      ...form,
      stock_qty: newQty,
      stock_status: status,
      updated_by: profile?.id,
      updated_at: new Date().toISOString(),
    }

    let stockId = editId
    try {
      if (editId) {
        await stock.updateStockRecord(editId, payload)
      } else {
        const ins = await stock.insertStockRecord(payload)
        stockId = ins.id
      }
    } catch (err) { setError(toUserMessage(err)); setSaving(false); return }

    const qtyChange = editId ? newQty - prevQty : newQty
    if (qtyChange !== 0 || !editId) {
      // Best-effort audit movement - original ignored insert errors here.
      try {
        await stock.insertStockMovement({
          stock_id:      stockId,
          site:          form.site,
          description:   form.description || null,
          movement_type: editId ? (qtyChange > 0 ? 'In' : 'Out') : 'Initial',
          qty_before:    editId ? prevQty : 0,
          qty_change:    qtyChange,
          qty_after:     newQty,
          reason:        editId ? 'Manual edit' : 'Initial stock entry',
          created_by:    profile?.id ?? null,
        })
      } catch { /* audit is best-effort; do not block the save */ }
    }

    setShowForm(false)
    load()
    setSaving(false)
  }

  async function saveAdjustment() {
    // Block the ledger post while the record's approval workflow is active/locked.
    // A Tyre Return post is additionally gated by its own return-authorization lock.
    if (wfLocked) return
    if (adjForm?.movement_type === 'return' && returnWfLocked) return
    if (!adjForm || !adjForm.qty_change) return
    const rec = historyFor
    setSaving(true); setError('')
    // Atomic, guarded, audited ledger post. The server computes qty_before/after
    // and blocks a negative balance - no client-side stock math.
    let data
    try {
      data = await stock.postStockMovement({
        stockId:   rec.id,
        type:      adjForm.movement_type,
        qty:       adjForm.qty_change,
        reason:    adjForm.reason,
        reference: adjForm.reference_no,
      })
    } catch (aErr) { setError(toUserMessage(aErr)); setSaving(false); return }
    const newQty = data?.qty_after ?? rec.stock_qty
    setAdjForm(null)
    await load()
    await openHistory({ ...rec, stock_qty: newQty })
    setSaving(false)
  }

  async function openHistory(rec) {
    setHistoryFor(rec)
    setLoadingMov(true)
    setMovError('')
    let data = []
    try { data = await stock.listStockMovements(rec.id, 50) } catch (e) {
      data = []
      setMovError(toUserMessage(e, 'Could not load movement history.'))
    }
    setMovements(data || [])
    setLoadingMov(false)
  }

  // ── Inter-site Transfer ─────────────────────────────────────────────────────
  async function submitTransfer(e) {
    e.preventDefault()
    setTransferError('')
    setTransferMsg('')

    // Block the transfer post while its approval workflow is active/locked.
    if (transferWfLocked) { setTransferError('Transfer is locked pending approval.'); return }

    const { fromSite, toSite, qty, notes } = transferForm
    const transferQty = +qty

    if (!fromSite || !toSite) { setTransferError(t('stock.transfer.errors.selectBoth')); return }
    if (fromSite === toSite)  { setTransferError(t('stock.transfer.errors.sameSite')); return }
    if (transferQty < 1)      { setTransferError(t('stock.transfer.errors.minQty')); return }

    const fromRecord = records.find(r => r.site === fromSite)
    const toRecord   = records.find(r => r.site === toSite)

    if (!fromRecord) { setTransferError(t('stock.transfer.errors.noRecordForSite', { site: fromSite })); return }
    if (!toRecord)   { setTransferError(t('stock.transfer.errors.noRecordForSite', { site: toSite })); return }
    if (transferQty > fromRecord.stock_qty) {
      setTransferError(t('stock.transfer.errors.insufficientStock', { site: fromSite, qty: fromRecord.stock_qty }))
      return
    }

    setTransferring(true)

    const reasonOut = `Transfer to ${toSite}${notes ? ': ' + notes : ''}`
    const reasonIn  = `Transfer from ${fromSite}${notes ? ': ' + notes : ''}`

    // Two atomic ledger legs. Each RPC row-locks its stock row and negative-guards.
    try {
      await stock.postStockMovement({ stockId: fromRecord.id, type: 'transfer_out', qty: transferQty, reason: reasonOut, reference: notes })
    } catch (outErr) { setTransferError(toUserMessage(outErr)); setTransferring(false); return }
    try {
      await stock.postStockMovement({ stockId: toRecord.id, type: 'transfer_in', qty: transferQty, reason: reasonIn, reference: notes })
    } catch (inErr) {
      setTransferError(t('stock.transfer.errors.inboundFailed', { message: toUserMessage(inErr) }))
      setTransferring(false); await load(); return
    }

    setTransferMsg(t('stock.transfer.successMsg', { qty: transferQty, fromSite, toSite }))
    setTransferForm({ fromSite: '', toSite: '', qty: 1, notes: '' })
    setTransferring(false)
    await load()
  }

  // ── Timeline data load ──────────────────────────────────────────────────────
  // Moving either timeline date starts a new read over the old one; without this
  // the slower earlier answer lands last and charts the previous window.
  const latestTimeline = useLatestRequest()

  const loadTimeline = useCallback(async () => {
    const stale = latestTimeline.begin()
    setTlLoading(true)
    setTlError('')
    let data = []
    let failed = null
    try { data = await stock.listTyreIssuesInRange({ from: tlFrom, to: tlTo, country: activeCountry }) } catch (e) { failed = e }
    // A superseded read must not paint its rows or clear the newer spinner: the
    // timeline chart would otherwise plot the previous window under new dates.
    if (stale()) return
    if (failed) {
      setTlRecords([])
      setTlError(toUserMessage(failed, 'Could not load the stock timeline.'))
    } else {
      setTlRecords(data ?? [])
    }
    setTlLoading(false)
  }, [activeCountry, latestTimeline, tlFrom, tlTo])

  useEffect(() => {
    if (activeTab === 'timeline') loadTimeline()
  }, [activeTab, loadTimeline])

  const now = useMemo(() => new Date(), [])
  const tlDays = useMemo(() => timelineByDate(tlRecords), [tlRecords])
  const tlSummary = useMemo(() => timelineSummary(tlDays, new Date()), [tlDays])

  const enriched = useMemo(() => enrichStock(records, velocityMap), [records, velocityMap])
  const visibleStock = useMemo(
    () => filterStock(enriched, { search, site: siteFilter, status: statusFilter }),
    [enriched, search, siteFilter, statusFilter],
  )
  const kpis = useMemo(() => summarizeStock(visibleStock), [visibleStock])
  const filtersActive = search.trim() !== '' || siteFilter !== 'all' || statusFilter !== 'all'
  const clearFilters = () => { setSearch(''); setSiteFilter('all'); setStatusFilter('all') }

  const tlChartData = useMemo(() => ({
    labels: tlDays.map(d => d.date),
    datasets: [{
      label: t('stock.timeline.netChangeLabel'),
      data: tlDays.map(d => d.net),
      backgroundColor: tlDays.map(d => (d.net > 0 ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)')),
      borderRadius: 4,
    }],
  }), [tlDays, t])

  // Reorder request PDF
  async function generateReorderPdf(rec) {
    const { pdfFooter, pdfHeader, pdfTableTheme, resolvePdfBrand } = await loadExportUtils()
    const { default: jsPDF } = await import('jspdf')
    const autoTable = await loadAutoTable()
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'
    pdfHeader(doc, 'Reorder Request', `${rec.site} | Stock Report`, company, brand)

    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 30,
      head: [['Field', 'Value']],
      body: [
        ['Site',            rec.site],
        ['Description',     rec.description || 'N/A'],
        ['Current Stock',   String(rec.stock_qty)],
        ['Critical Level',  String(rec.critical_level)],
        ['Min Level',       String(rec.min_level)],
        ['Reorder Qty',     String(Math.max(0, (rec.min_level || 5) * 3 - rec.stock_qty))],
        ['Status',          deriveStatus(rec)],
        ['Requested By',    profile?.full_name || profile?.username || 'N/A'],
        ['Date',            formatDate(new Date())],
      ],
    })

    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }

    doc.save(`reorder-${rec.site.replace(/\s+/g, '-')}-${Date.now()}.pdf`)
  }

  async function exportExcel() {
    try {
      const { exportToExcel, reportFileName } = await loadExportUtils()
      await exportToExcel(stockExportRows(visibleStock), STOCK_EXPORT_COLS, STOCK_EXPORT_HEADERS,
        reportFileName('Stock Management', activeCountry, todayStr(now)), 'Stock')
    } catch (e) { setLoadError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  async function exportPdf() {
    try {
      const { exportToPdf, reportFileName } = await loadExportUtils()
      const keys = ['site', 'description', 'stock_qty', 'min_level', 'critical_level', 'status', 'days_left', 'suggestion']
      await exportToPdf(
        stockExportRows(visibleStock),
        keys.map(k => ({ key: k, header: STOCK_EXPORT_HEADERS[STOCK_EXPORT_COLS.indexOf(k)] })),
        'Stock Management',
        reportFileName('Stock Management', activeCountry, todayStr(now)),
        'landscape',
        '',
        { subtitleNote: `${visibleStock.length} of ${records.length} items` },
      )
    } catch (e) { setLoadError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  async function exportTimeline() {
    try {
      const { exportToExcel, reportFileName } = await loadExportUtils()
      await exportToExcel(tlDays, ['date', 'in', 'out', 'net'], ['Date', 'Items In', 'Items Out', 'Net Change'],
        reportFileName('Stock Timeline', tlFrom, 'to', tlTo), 'Timeline')
    } catch (e) { setTlError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  const sites = useMemo(() => [...new Set(records.map(r => r.site).filter(Boolean))].sort(), [records])

  // Tabs: show Transfer only if >= 2 sites
  const tabs = useMemo(() => {
    const base = [['stock', t('stock.tabs.stock')], ['timeline', t('stock.tabs.timeline')]]
    if (sites.length >= 2) return [['stock', t('stock.tabs.stock')], ['transfer', t('stock.tabs.transfer')], ['timeline', t('stock.tabs.timeline')]]
    return base
  }, [sites, t])

  const openMovement = useCallback((r) => {
    openHistory(r)
    setAdjForm({ qty_change: 0, reason: '', movement_type: 'adjustment_up', reference_no: '' })
  }, [])

  const stockColumns = useMemo(() => [
    { id: 'site', header: t('stock.table.columns.site'), sort: r => r.site, size: 130, firstDir: 'asc',
      cell: r => <span className="font-medium text-[var(--text-primary)]">{r.site || 'N/A'}</span> },
    { id: 'description', header: t('stock.table.columns.description'), sort: r => r.description, size: 200, firstDir: 'asc',
      cell: r => <span className="text-[var(--text-secondary)]">{r.description || 'N/A'}</span> },
    { id: 'stock_qty', header: t('stock.table.columns.stock'), sort: r => r.stock_qty, size: 90, align: 'right',
      cell: r => <span className="tabular-nums font-semibold text-[var(--text-primary)]">{r.stock_qty ?? 'N/A'}</span> },
    { id: 'min_level', header: t('stock.table.columns.min'), sort: r => r.min_level, size: 80, align: 'right',
      cell: r => <span className="tabular-nums text-[var(--text-muted)]">{r.min_level ?? 'N/A'}</span> },
    { id: 'critical_level', header: t('stock.table.columns.critical'), sort: r => r.critical_level, size: 90, align: 'right',
      cell: r => <span className="tabular-nums text-[var(--text-muted)]">{r.critical_level ?? 'N/A'}</span> },
    { id: 'reorder_qty', header: t('stock.table.columns.reorderQty'), sort: r => r.reorder_qty, size: 100, align: 'right',
      cell: r => <span className="tabular-nums text-[var(--text-muted)]">{r.reorder_qty ?? 'N/A'}</span> },
    { id: 'status', header: t('stock.table.columns.status'), sort: r => STATUSES.indexOf(r.status), size: 100, firstDir: 'desc',
      cell: r => <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_BADGE[r.status]}`}>{t(`stock.statuses.${r.status}`)}</span> },
    { id: 'avgPerMonth', header: t('stock.table.columns.velocity'), sort: r => r.avgPerMonth, size: 100, align: 'right',
      cell: r => <span className="tabular-nums text-xs text-[var(--text-secondary)]">{r.avgPerMonth > 0 ? `${r.avgPerMonth}/mo` : 'None recorded'}</span> },
    { id: 'daysRemaining', header: t('stock.table.columns.daysLeft'), sort: r => r.daysRemaining, size: 100, align: 'right', firstDir: 'asc',
      cell: r => (
        <span className={`tabular-nums text-xs ${COVER_TONE[coverBand(r.daysRemaining)]}`}
          title={r.daysRemaining === null ? 'No consumption recorded at this site, so cover cannot be measured' : undefined}>
          {r.daysRemaining === null ? 'N/A' : `${r.daysRemaining}d`}
        </span>
      ) },
    { id: 'action', header: t('stock.table.columns.action'), sort: r => r.management_action, size: 200,
      cell: r => (
        <div className="flex flex-col gap-1 text-xs text-[var(--text-muted)] max-w-xs">
          {r.management_action ? <span className="truncate" title={r.management_action}>{r.management_action}</span> : <span className="text-[var(--text-dim)]">None</span>}
          {r.suggestion !== null && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border border-amber-500/40 text-amber-500 whitespace-nowrap w-fit">
              {t('stock.table.reorderBadge', { qty: r.suggestion })}
            </span>
          )}
        </div>
      ) },
    { id: 'actions', header: '', size: 150,
      cell: r => (
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => startEdit(r)}
            className={`min-h-[44px] px-2 rounded-lg text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${FOCUS}`}>
            {t('stock.table.edit')}
          </button>
          <button type="button" onClick={() => openMovement(r)}
            aria-label={`${t('stock.table.movementHistoryTooltip')}: ${r.site}`} title={t('stock.table.movementHistoryTooltip')}
            className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] ${FOCUS}`}>
            <History size={16} aria-hidden="true" />
          </button>
          {r.status === 'Critical' && (
            <button type="button" onClick={() => generateReorderPdf(r)}
              aria-label={`${t('stock.table.generateReorderPdfTooltip')}: ${r.site}`} title={t('stock.table.generateReorderPdfTooltip')}
              className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)] ${FOCUS}`}>
              <FileText size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      ) },
  // startEdit / generateReorderPdf are plain handlers over current state.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [t, openMovement])

  const timelineColumns = useMemo(() => [
    { id: 'date', header: t('stock.timeline.columns.date'), sort: r => r.date, size: 130,
      cell: r => <span className="font-medium text-[var(--text-primary)]">{r.date}</span> },
    { id: 'in', header: t('stock.timeline.columns.itemsIn'), sort: r => r.in, size: 110, align: 'right',
      cell: r => <span className="tabular-nums">{r.in}</span> },
    { id: 'out', header: t('stock.timeline.columns.itemsOut'), sort: r => r.out, size: 110, align: 'right',
      cell: r => <span className="tabular-nums">{r.out}</span> },
    { id: 'net', header: t('stock.timeline.columns.netChange'), sort: r => r.net, size: 120, align: 'right',
      cell: r => (
        <span className={`tabular-nums font-semibold ${r.net > 0 ? 'text-green-500' : r.net < 0 ? 'text-red-500' : 'text-[var(--text-muted)]'}`}>
          {r.net > 0 ? '+' : ''}{r.net}
        </span>
      ) },
  ], [t])

  const movementColumns = useMemo(() => [
    { id: 'created_at', header: t('stock.historyModal.columns.date'), sort: m => m.created_at, size: 120,
      cell: m => <span className="text-[var(--text-muted)]">{formatDate(m.created_at)}</span> },
    { id: 'movement_type', header: t('stock.historyModal.columns.type'), sort: m => m.movement_type, size: 120,
      cell: m => {
        const t0 = String(m.movement_type).toLowerCase()
        const add = ADD_TYPES.has(t0)
        return (
          <span className={`px-1.5 py-0.5 rounded text-xs border ${add ? 'border-green-500/40 text-green-500' : t0 !== 'adjustment' ? 'border-red-500/40 text-red-500' : 'border-[var(--input-border)] text-[var(--text-muted)]'}`}>
            {m.movement_type}
          </span>
        )
      } },
    { id: 'qty_before', header: t('stock.historyModal.columns.before'), sort: m => m.qty_before, size: 80, align: 'right',
      cell: m => <span className="tabular-nums text-[var(--text-muted)]">{m.qty_before ?? 'N/A'}</span> },
    { id: 'qty_change', header: t('stock.historyModal.columns.change'), sort: m => m.qty_change, size: 80, align: 'right',
      cell: m => <span className={`tabular-nums font-medium ${m.qty_change > 0 ? 'text-green-500' : 'text-red-500'}`}>{m.qty_change > 0 ? '+' : ''}{m.qty_change}</span> },
    { id: 'qty_after', header: t('stock.historyModal.columns.after'), sort: m => m.qty_after, size: 80, align: 'right',
      cell: m => <span className="tabular-nums font-semibold text-[var(--text-primary)]">{m.qty_after ?? 'N/A'}</span> },
    { id: 'reason', header: t('stock.historyModal.columns.reason'), sort: m => m.reason, size: 180,
      cell: m => <span className="text-[var(--text-muted)]">{m.reason || 'None'}</span> },
    { id: 'reference_no', header: t('stock.historyModal.columns.ref'), sort: m => m.reference_no, size: 120,
      cell: m => <span className="text-[var(--text-muted)]">{m.reference_no || 'None'}</span> },
  ], [t])

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('stock.title')}
        subtitle={t('stock.subtitle', { count: records.length })}
        icon={Package}
        actions={
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={load} disabled={loading}
              className={`btn-secondary min-h-[44px] text-sm flex items-center gap-1.5 disabled:opacity-50 ${FOCUS}`}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
            </button>
            <button type="button" onClick={exportExcel} disabled={loading || visibleStock.length === 0}
              className={`btn-secondary min-h-[44px] text-sm flex items-center gap-1.5 disabled:opacity-50 ${FOCUS}`}>
              <Download size={14} aria-hidden="true" /> {t('stock.actions.excel')}
            </button>
            <button type="button" onClick={exportPdf} disabled={loading || visibleStock.length === 0}
              className={`btn-secondary min-h-[44px] text-sm flex items-center gap-1.5 disabled:opacity-50 ${FOCUS}`}>
              <FileText size={14} aria-hidden="true" /> {t('stock.actions.pdf')}
            </button>
            <button type="button" onClick={startAdd}
              className={`btn-primary min-h-[44px] flex items-center gap-2 text-sm ${FOCUS}`}>
              <Plus size={16} aria-hidden="true" /> {t('stock.actions.addStock')}
            </button>
          </div>
        }
      />

      {loadError && (
        <div role="alert" className="card p-4 flex flex-wrap items-center gap-3 border border-red-500/40">
          <AlertTriangle size={18} className="text-red-500 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Stock could not be loaded</p>
            <p className="text-sm text-[var(--text-muted)]">{loadError}</p>
          </div>
          <button type="button" onClick={load} className={`btn-secondary min-h-[44px] text-sm flex items-center gap-1.5 ${FOCUS}`}>
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap" role="tablist" aria-label="Stock views">
        {tabs.map(([val, label]) => (
          <button
            key={val}
            type="button"
            role="tab"
            aria-selected={activeTab === val}
            onClick={() => setActiveTab(val)}
            className={`min-h-[44px] px-4 rounded-lg text-sm font-medium transition-colors ${FOCUS} ${
              activeTab === val ? 'bg-[var(--accent)] text-white' : 'bg-[var(--input-bg)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── STOCK LEVELS TAB ─────────────────────────────────────────────────── */}
      {activeTab === 'stock' && (
        <>
          {/* KPI strip (covers the filtered view) */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatTile icon={Boxes} label="Stock items" value={loading ? '...' : kpis.items.toLocaleString()}
              sub={kpis.units === null ? 'Units not recorded' : `${kpis.units.toLocaleString()} units on hand`} />
            <StatTile icon={AlertTriangle} label={t('stock.statuses.Critical')} value={kpis.counts.Critical.toLocaleString()}
              sub="At or below critical level" tone={kpis.counts.Critical > 0 ? 'crit' : 'neutral'} />
            <StatTile icon={AlertTriangle} label={t('stock.statuses.Low')} value={kpis.counts.Low.toLocaleString()}
              sub="At or below minimum level" tone={kpis.counts.Low > 0 ? 'warn' : 'neutral'} />
            <StatTile icon={Clock} label="Avg days of cover"
              value={kpis.avgCoverDays === null ? 'N/A' : `${kpis.avgCoverDays}d`}
              sub={kpis.measuredCover ? `${kpis.measuredCover} items with consumption` : 'No consumption recorded'} tone="info" />
            <StatTile icon={ShoppingCart} label="Suggested reorder" value={kpis.toReorder.toLocaleString()}
              sub={`${kpis.atRisk} items under 30 days`} tone={kpis.atRisk > 0 ? 'warn' : 'neutral'} />
            <StatTile icon={MapPin} label="Sites" value={kpis.sites.toLocaleString()}
              sub={`${kpis.stockouts} stocked out`} />
          </div>

          {/* Filters */}
          <section className="card p-4" aria-label="Filters">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
              <label className="block lg:col-span-2">
                <span className="text-xs text-[var(--text-dim)] mb-1.5 block">Search</span>
                <span className="relative block">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                  <input type="search" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Site, description, action" className={`w-full pl-9 ${CTRL}`} />
                </span>
              </label>
              <label className="block">
                <span className="text-xs text-[var(--text-dim)] mb-1.5 block">{t('stock.table.columns.site')}</span>
                <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)} className={`w-full ${CTRL}`}>
                  <option value="all">All sites</option>
                  {sites.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-[var(--text-dim)] mb-1.5 block">{t('stock.table.columns.status')}</span>
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className={`w-full ${CTRL}`}>
                  <option value="all">All statuses</option>
                  {STATUSES.map(st => <option key={st} value={st}>{t(`stock.statuses.${st}`)}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[var(--text-dim)]" aria-live="polite">
              <span>{loading ? 'Loading stock...' : `${visibleStock.length.toLocaleString()} of ${records.length.toLocaleString()} items`}</span>
              {filtersActive && (
                <button type="button" onClick={clearFilters}
                  className={`min-h-[44px] inline-flex items-center gap-1 px-3 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${FOCUS}`}>
                  <X size={12} aria-hidden="true" /> Clear filters
                </button>
              )}
            </div>
          </section>

          <SortedPagedTable
            columns={stockColumns}
            rows={visibleStock}
            defaultSort={{ key: 'status', dir: 'desc' }}
            getRowId={r => String(r.id)}
            loading={loading}
            error={loadError || null}
            onRetry={load}
            emptyMessage={records.length === 0 ? t('stock.table.emptyTitle') : 'No stock items match these filters'}
          />
        </>
      )}

      {/* ── TRANSFER TAB ──────────────────────────────────────────────────────── */}
      {activeTab === 'transfer' && (
        <div className="max-w-lg">
          <Card className="space-y-[var(--space-5)]">
            <CardHeader
              level={2}
              icon={ArrowLeftRight}
              title={t('stock.transfer.heading')}
              description={t('stock.transfer.subtitle')}
            />

            {transferMsg && (
              <div role="status" className="border border-green-500/40 text-[var(--text-secondary)] rounded-lg px-4 py-3 text-sm">
                {transferMsg}
              </div>
            )}
            {transferError && (
              <div role="alert" className="border border-red-500/40 text-[var(--text-secondary)] rounded-lg px-4 py-3 text-sm">
                {transferError}
              </div>
            )}

            <form onSubmit={submitTransfer} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('stock.transfer.fromSite')}</label>
                  <select
                    className="input"
                    value={transferForm.fromSite}
                    onChange={e => {
                      const fromSite = e.target.value
                      setTransferError('')
                      setTransferMsg('')
                      // Auto-fill description from first matching record
                      const matchRec = records.find(r => r.site === fromSite)
                      setTransferForm(f => ({
                        ...f,
                        fromSite,
                        toSite: f.toSite === fromSite ? '' : f.toSite,
                        qty: 1,
                      }))
                    }}
                    required
                  >
                    <option value="">{t('stock.transfer.selectOption')}</option>
                    {sites.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  {transferForm.fromSite && (() => {
                    const rec = records.find(r => r.site === transferForm.fromSite)
                    return rec ? (
                      <p className="text-xs text-[var(--text-muted)] mt-1">{t('stock.transfer.availablePrefix')} <span className="text-[var(--text-secondary)] font-medium">{rec.stock_qty}</span> {t('stock.transfer.unitsSuffix')}</p>
                    ) : null
                  })()}
                </div>
                <div>
                  <label className="label">{t('stock.transfer.toSite')}</label>
                  <select
                    className="input"
                    value={transferForm.toSite}
                    onChange={e => {
                      setTransferError('')
                      setTransferMsg('')
                      setTransferForm(f => ({ ...f, toSite: e.target.value }))
                    }}
                    required
                  >
                    <option value="">{t('stock.transfer.selectOption')}</option>
                    {sites.filter(s => s !== transferForm.fromSite).map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  {transferForm.toSite && (() => {
                    const rec = records.find(r => r.site === transferForm.toSite)
                    return rec ? (
                      <p className="text-xs text-[var(--text-muted)] mt-1">{t('stock.transfer.currentPrefix')} <span className="text-[var(--text-secondary)] font-medium">{rec.stock_qty}</span> {t('stock.transfer.unitsSuffix')}</p>
                    ) : null
                  })()}
                </div>
              </div>

              <div>
                <label className="label">{t('stock.transfer.quantity')}</label>
                <input
                  type="number"
                  className="input"
                  min={1}
                  max={records.find(r => r.site === transferForm.fromSite)?.stock_qty ?? undefined}
                  value={transferForm.qty}
                  onChange={e => {
                    setTransferError('')
                    setTransferForm(f => ({ ...f, qty: +e.target.value }))
                  }}
                  required
                />
              </div>

              <div>
                <label className="label">{t('stock.transfer.notes')}</label>
                <input
                  type="text"
                  className="input"
                  placeholder={t('stock.transfer.notesPlaceholder')}
                  value={transferForm.notes}
                  onChange={e => setTransferForm(f => ({ ...f, notes: e.target.value }))}
                />
              </div>

              {/* Transfer preview */}
              {transferForm.fromSite && transferForm.toSite && transferForm.qty > 0 && (
                <div className="bg-[var(--input-bg)]/50 border border-[var(--input-border)] rounded-lg p-3 text-xs text-[var(--text-muted)] space-y-1">
                  <p className="text-[var(--text-secondary)] font-medium text-xs mb-2">{t('stock.transfer.previewTitle')}</p>
                  {(() => {
                    const from = records.find(r => r.site === transferForm.fromSite)
                    const to   = records.find(r => r.site === transferForm.toSite)
                    const qty  = +transferForm.qty
                    return (
                      <>
                        <div className="flex justify-between">
                          <span>{transferForm.fromSite}</span>
                          <span>
                            <span className="text-[var(--text-muted)]">{from?.stock_qty ?? '?'}</span>
                            <span className="text-[var(--text-dim)] mx-1" aria-hidden="true">→</span><span className="sr-only"> to </span>
                            <span className={from && from.stock_qty - qty < from.critical_level ? 'text-red-400' : 'text-green-400'}>
                              {from ? from.stock_qty - qty : '?'}
                            </span>
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>{transferForm.toSite}</span>
                          <span>
                            <span className="text-[var(--text-muted)]">{to?.stock_qty ?? '?'}</span>
                            <span className="text-[var(--text-dim)] mx-1" aria-hidden="true">→</span><span className="sr-only"> to </span>
                            <span className="text-green-400">{to ? to.stock_qty + qty : '?'}</span>
                          </span>
                        </div>
                      </>
                    )
                  })()}
                </div>
              )}

              {/* Inter-site Transfer Approval — gates the "Transfer stock" post below.
                  Mounted only once a valid source stock record + transfer context
                  exists. The second workflow step conditions on context.qty
                  (auto-skips when qty < 10), so qty MUST be numeric. */}
              {(() => {
                const fromRecord = records.find(r => r.site === transferForm.fromSite)
                if (!fromRecord || !transferForm.toSite || +transferForm.qty < 1) return null
                return (
                  <div className="space-y-2">
                    <EntityApprovalPanel
                      entityType="tyre_transfer"
                      entityId={fromRecord.id}
                      entityLabel={`${transferForm.fromSite} → ${transferForm.toSite}`}
                      context={{
                        qty: Number(transferForm.qty) || 0,
                        from_site: transferForm.fromSite,
                        to_site: transferForm.toSite,
                        country: activeCountry,
                        description: fromRecord.description || transferForm.notes || null,
                      }}
                      title="Inter-site Transfer Approval"
                      onStateChange={({ isActive, isLocked }) => setTransferWfLocked(!!(isActive || isLocked))}
                    />
                    {transferWfLocked && (
                      <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                        <Lock size={12} /> Locked, in approval
                      </div>
                    )}
                  </div>
                )
              })()}

              <button
                type="submit"
                disabled={transferring || transferWfLocked || !transferForm.fromSite || !transferForm.toSite || transferForm.qty < 1}
                title={transferWfLocked ? 'Locked, in approval' : undefined}
                className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {transferWfLocked ? <Lock size={16} /> : <ArrowLeftRight size={16} />}
                {transferring ? t('stock.transfer.transferring') : t('stock.transfer.transferStock')}
              </button>
            </form>
          </Card>
        </div>
      )}

      {/* ── TIMELINE TAB ──────────────────────────────────────────────────────── */}
      {activeTab === 'timeline' && (
        <div className="space-y-4">
          {/* Date range */}
          <section className="card p-4 space-y-3" aria-label="Timeline date range">
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="text-xs text-[var(--text-dim)] mb-1.5 block">{t('stock.timeline.from')}</span>
                <input type="date" className={`w-44 ${CTRL}`} value={tlFrom} max={tlTo} onChange={e => setTlFrom(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-xs text-[var(--text-dim)] mb-1.5 block">{t('stock.timeline.to')}</span>
                <input type="date" className={`w-44 ${CTRL}`} value={tlTo} min={tlFrom} onChange={e => setTlTo(e.target.value)} />
              </label>
              <button type="button" onClick={exportTimeline} disabled={tlLoading || tlDays.length === 0}
                className={`btn-secondary min-h-[44px] text-sm flex items-center gap-1.5 disabled:opacity-50 ${FOCUS}`}>
                <Download size={14} aria-hidden="true" /> Excel
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick ranges">
              {[
                { label: t('stock.timeline.chips.today'),      from: todayStr(now),       to: todayStr(now) },
                { label: t('stock.timeline.chips.yesterday'),  from: offsetDate(-1, now), to: offsetDate(-1, now) },
                { label: t('stock.timeline.chips.last7Days'),  from: offsetDate(-6, now), to: todayStr(now) },
                { label: t('stock.timeline.chips.last30Days'), from: offsetDate(-29, now), to: todayStr(now) },
                { label: t('stock.timeline.chips.thisMonth'),  from: firstOfMonth(now),   to: todayStr(now) },
              ].map(({ label, from, to }) => {
                const on = tlFrom === from && tlTo === to
                return (
                  <button key={label} type="button" aria-pressed={on}
                    onClick={() => { setTlFrom(from); setTlTo(to) }}
                    className={`min-h-[44px] text-xs px-3 rounded-full border transition-colors ${FOCUS} ${
                      on ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                        : 'bg-[var(--input-bg)] border-[var(--input-border)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                    }`}>{label}</button>
                )
              })}
            </div>
          </section>

          {/* KPI strip */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatTile label={t('stock.timeline.today')} value={tlSummary.todayIssues.toLocaleString()} sub={t('stock.timeline.issues')} />
            <StatTile label={t('stock.timeline.yesterday')} value={tlSummary.yesterdayIssues.toLocaleString()} sub={t('stock.timeline.issues')} />
            <StatTile label={t('stock.timeline.change')}
              value={tlSummary.changePct === null ? 'N/A' : `${tlSummary.changePct > 0 ? '+' : ''}${tlSummary.changePct.toFixed(1)}%`}
              sub={tlSummary.changePct === null ? 'No issues yesterday to compare' : 'Today vs yesterday'}
              tone={tlSummary.changePct > 0 ? 'warn' : 'neutral'} />
            <StatTile label={t('stock.timeline.columns.itemsIn')} value={tlSummary.totalIn.toLocaleString()} sub="In the selected range" />
            <StatTile label={t('stock.timeline.columns.itemsOut')} value={tlSummary.totalOut.toLocaleString()} sub="In the selected range" />
            <StatTile label="Busiest day" value={tlSummary.busiest ? tlSummary.busiest.date : 'N/A'}
              sub={tlSummary.busiest ? `${tlSummary.busiest.out} out` : 'No issues in range'} />
          </div>

          {tlError && (
            <div role="alert" className="card p-4 flex flex-wrap items-center gap-3 border border-red-500/40">
              <AlertTriangle size={18} className="text-red-500 shrink-0" aria-hidden="true" />
              <p className="text-sm text-[var(--text-muted)] flex-1 min-w-0">{tlError}</p>
              <button type="button" onClick={loadTimeline} className={`btn-secondary min-h-[44px] text-sm flex items-center gap-1.5 ${FOCUS}`}>
                <RefreshCw size={14} aria-hidden="true" /> Retry
              </button>
            </div>
          )}

          {/* Bar chart */}
          {!tlError && tlDays.length > 0 && (
            <Card>
              <CardHeader level={2} title={t('stock.timeline.chartTitle')} />
              <CardBody style={{ height: 220 }}>
                <div className="h-full" role="img"
                  aria-label={`Daily net stock change from ${tlFrom} to ${tlTo}. ${tlSummary.totalIn} in, ${tlSummary.totalOut} out.`}>
                  <Bar
                    data={tlChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { display: false } },
                      scales: {
                        x: { grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)', font: { size: 10 } } },
                        y: { grid: { color: 'var(--panel-2)' }, ticks: { color: 'var(--text-muted)' }, beginAtZero: true },
                      },
                    }}
                  />
                </div>
              </CardBody>
            </Card>
          )}

          <SortedPagedTable
            columns={timelineColumns}
            rows={tlDays}
            defaultSort={{ key: 'date', dir: 'desc' }}
            getRowId={r => r.date}
            loading={tlLoading}
            error={tlError || null}
            onRetry={loadTimeline}
            emptyMessage={t('stock.timeline.emptyPeriod')}
          />
        </div>
      )}

      {/* Movement History Modal */}
      {historyFor && (
        <Modal
          open
          onClose={closeHistory}
          size="lg"
          title={t('stock.historyModal.title', { site: historyFor.site })}
          subtitle={t('stock.historyModal.subtitle', { description: historyFor.description || '', qty: historyFor.stock_qty })}
          bodyClassName="space-y-[var(--space-4)]"
        >
          {/* Approval & Workflow Engine — status, immutable trail, approver action, start picker.
              Gates the ledger-post (stock issuance/adjustment) control below via onStateChange. */}
          <div>
              <EntityApprovalPanel
                entityType="stock_issue"
                entityId={historyFor.id}
                entityLabel={historyFor.description || historyFor.site || historyFor.id}
                context={{
                  quantity: historyFor.stock_qty,
                  value: historyFor.reorder_qty ?? historyFor.min_level,
                  movement_type: adjForm?.movement_type,
                  site: historyFor.site,
                }}
                onStateChange={({ isActive, isLocked }) => setWfLocked(!!(isActive || isLocked))}
                title="Stock Issuance Approval"
              />
              {wfLocked && (
                <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] mt-2">
                  <Lock size={12} /> Locked, in approval
                </div>
              )}

              {/* Tyre Return Authorization — shown only when the pending movement is a
                  return. Gates the return ledger-post via returnWfLocked, keyed on the
                  same stock record so it is independent of the stock_issue panel. */}
              {adjForm?.movement_type === 'return' && (
                <div className="mt-3">
                  <EntityApprovalPanel
                    entityType="tyre_return"
                    entityId={historyFor.id}
                    entityLabel={historyFor.description || historyFor.site || historyFor.id}
                    context={{
                      qty: Number(adjForm?.qty_change) || 0,
                      site: historyFor.site,
                      country: activeCountry,
                      description: historyFor.description || null,
                    }}
                    onStateChange={({ isActive, isLocked }) => setReturnWfLocked(!!(isActive || isLocked))}
                    title="Tyre Return Authorization"
                  />
                  {returnWfLocked && (
                    <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] mt-2">
                      <Lock size={12} /> Return locked, in approval
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Quick adjustment form */}
            {adjForm && (
              <div className="p-4 rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)]/30">
                <p className="text-xs text-[var(--text-muted)] mb-3">{t('stock.historyModal.logMovement')}</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div>
                    <label className="label text-xs">{t('stock.historyModal.type')}</label>
                    <select className="input text-xs py-1.5"
                      value={adjForm.movement_type}
                      onChange={e => setAdjForm(f => ({ ...f, movement_type: e.target.value }))}>
                      {MOVEMENT_TYPES.map(mt => <option key={mt} value={mt}>{t(`stock.movementTypes.${mt}`)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label text-xs">{t('stock.historyModal.qtyChange')}</label>
                    <input type="number" className="input text-xs py-1.5"
                      value={adjForm.qty_change}
                      onChange={e => setAdjForm(f => ({ ...f, qty_change: +e.target.value }))}
                      placeholder={t('stock.historyModal.qtyChangePlaceholder')} />
                  </div>
                  <div>
                    <label className="label text-xs">{t('stock.historyModal.reason')}</label>
                    <input className="input text-xs py-1.5" value={adjForm.reason}
                      onChange={e => setAdjForm(f => ({ ...f, reason: e.target.value }))}
                      placeholder={t('stock.historyModal.reasonPlaceholder')} />
                  </div>
                  <div>
                    <label className="label text-xs">{t('stock.historyModal.refNo')}</label>
                    <input className="input text-xs py-1.5" value={adjForm.reference_no}
                      onChange={e => setAdjForm(f => ({ ...f, reference_no: e.target.value }))}
                      placeholder={t('stock.historyModal.refNoPlaceholder')} />
                  </div>
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={saveAdjustment}
                    disabled={saving || adjForm.qty_change === 0 || wfLocked || (adjForm.movement_type === 'return' && returnWfLocked)}
                    title={wfLocked || (adjForm.movement_type === 'return' && returnWfLocked) ? 'Locked, in approval' : undefined}
                    className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {(wfLocked || (adjForm.movement_type === 'return' && returnWfLocked)) && <Lock size={12} />}
                    {saving ? t('stock.historyModal.saving') : t('stock.historyModal.logMovementBtn')}
                  </button>
                  <span className="text-xs text-[var(--text-muted)] self-center">
                    {t('stock.historyModal.newQty', { qty: historyFor.stock_qty + (adjForm.qty_change || 0) })}
                  </span>
                </div>
              </div>
            )}

            {/* History table. The dialog body is the scroll container now, so
                the sticky header still pins and there is no nested scroller. */}
            <div>
              {error && <div role="alert" className="border border-red-500/40 text-[var(--text-secondary)] rounded-lg px-4 py-2 mb-3 text-sm">{error}</div>}
              <SortedPagedTable
                columns={movementColumns}
                rows={movements}
                defaultSort={{ key: 'created_at', dir: 'desc' }}
                getRowId={m => String(m.id)}
                loading={loadingMov}
                error={movError || null}
                onRetry={() => openHistory(historyFor)}
                emptyMessage={t('stock.historyModal.emptyHistory')}
              />
            </div>
        </Modal>
      )}

      {/* Add/Edit Form modal */}
      <Modal
        open={showForm}
        onClose={closeForm}
        size="md"
        title={editId ? t('stock.form.editTitle') : t('stock.form.addTitle')}
      >
        {error && <div role="alert" className="border border-red-500/40 text-[var(--text-secondary)] rounded-lg px-4 py-2 mb-4 text-sm">{error}</div>}
        <form onSubmit={save} className="space-y-3">
              <div>
                <label className="label">{t('stock.form.site')}</label>
                <input className="input" value={form.site} onChange={e => setForm(f => ({ ...f, site: e.target.value }))} required list="stock-sites" />
                <datalist id="stock-sites">{sites.map(s => <option key={s} value={s} />)}</datalist>
              </div>
              <div>
                <label className="label">{t('stock.form.description')}</label>
                <input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder={t('stock.form.descriptionPlaceholder')} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div><label className="label">{t('stock.form.stockQty')}</label><input type="number" className="input" value={form.stock_qty} onChange={e => setForm(f => ({ ...f, stock_qty: +e.target.value }))} min={0} /></div>
                <div><label className="label">{t('stock.form.minLevel')}</label><input type="number" className="input" value={form.min_level} onChange={e => setForm(f => ({ ...f, min_level: +e.target.value }))} min={0} /></div>
                <div><label className="label">{t('stock.form.criticalLevel')}</label><input type="number" className="input" value={form.critical_level} onChange={e => setForm(f => ({ ...f, critical_level: +e.target.value }))} min={0} /></div>
              </div>
              <div>
                <label className="label">{t('stock.form.managementAction')}</label>
                <input className="input" value={form.management_action} onChange={e => setForm(f => ({ ...f, management_action: e.target.value }))} />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
                  <Save size={16} /> {saving ? t('stock.form.saving') : t('stock.form.save')}
                </button>
                <button type="button" onClick={closeForm} className="btn-secondary">{t('stock.form.cancel')}</button>
              </div>
        </form>
      </Modal>
    </div>
  )
}
