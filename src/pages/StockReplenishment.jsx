// ─────────────────────────────────────────────────────────────────────────────
// StockReplenishment.jsx - Automated Stock Replenishment Intelligence · /stock-replenishment
// All calculations live in src/lib/stockReplenishmentAnalytics.js.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import {
  Package, AlertTriangle, TrendingDown, TrendingUp, ShoppingCart, RefreshCw, Loader2, Search, X, Plus,
  FileText, FileSpreadsheet, Edit2, CheckCircle, Clock, BarChart2, Layers, Zap, ExternalLink, Download,
  PackageX, ChevronUp, ChevronDown, ChevronsUpDown, Coins,
} from 'lucide-react'
import * as purchaseOrders from '../lib/api/purchaseOrders'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { useTenant } from '../contexts/TenantContext'
import { formatCurrency as fmtCurrency, formatDate, formatMonthYear, formatDateTime } from '../lib/formatters'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfEmptyState, pdfTableTheme, exportToExcel, reportFileName } from '../lib/exportUtils'
import { useLanguage } from '../contexts/LanguageContext'
import { toUserMessage } from '../lib/safeError'
import PageHeader from '../components/ui/PageHeader'
import StatTile from '../components/ui/StatTile'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import TablePagination, { usePagedRows } from '../components/ui/TablePagination'
import { loadAutoTable } from '../lib/pdfEngine'
import { sortRows, nextSort } from '../lib/consoleTableSort'
import { colorAt, withAlpha } from '../lib/reportColors'
import { resolveCurrency } from '../lib/rootCauseEngineAnalytics'
import {
  URGENCIES, URGENCY_LABEL, loadSince, consumptionRates, avgUnitCosts, buildMatrix, filterMatrix,
  plannedQty, summarizeMatrix, consumptionBySize, trendForSize, allSizes as listSizes, consumptionGrid,
  seasonalVariance, orderTotals, matrixExportRows, MATRIX_EXPORT_COLS, MATRIX_EXPORT_HEADERS,
} from '../lib/stockReplenishmentAnalytics'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  Title, Tooltip, Legend, Filler,
)

const TABS = [
  { key: 'matrix', label: 'Replenishment Matrix', icon: Layers },
  { key: 'consumption', label: 'Consumption Analysis', icon: BarChart2 },
  { key: 'order', label: 'Order Generator', icon: ShoppingCart },
]

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-bright,#22c55e)]'
const CTRL = `min-h-[44px] bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--text-primary)] text-sm rounded-lg px-3 ${FOCUS}`
const CELL_INPUT = `min-h-[40px] px-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded text-[var(--text-primary)] text-sm ${FOCUS}`

// Semantic urgency tones: always shown with the text label.
const URGENCY_TONE = {
  Critical: '#dc2626', Low: '#d97706', Normal: '#16a34a', Overstocked: '#2563eb', Idle: '#6b7280',
}

const AXIS = { color: 'var(--text-muted)', font: { size: 11 } }
const GRID = { color: 'var(--panel-2)' }
const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: 'var(--text-secondary)', boxWidth: 12, font: { size: 11 } } } },
  scales: { x: { ticks: AXIS, grid: GRID }, y: { ticks: AXIS, grid: GRID, beginAtZero: true } },
}

function UrgencyBadge({ urgency }) {
  const { t } = useLanguage()
  const tone = URGENCY_TONE[urgency] || URGENCY_TONE.Idle
  const label = urgency === 'Idle' ? URGENCY_LABEL.Idle : t(`stockreplenish.urgency.${urgency}`)
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border"
      style={{ color: tone, borderColor: withAlpha(tone, 0.45), backgroundColor: withAlpha(tone, 0.1) }}>
      {urgency === 'Critical' && <Zap size={10} aria-hidden="true" />}
      {label}
    </span>
  )
}

function SortButton({ label, active, dir, onClick, align }) {
  const Icon = !active ? ChevronsUpDown : dir === 'asc' ? ChevronUp : ChevronDown
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-1 min-h-[32px] rounded ${FOCUS} ${align === 'right' ? 'flex-row-reverse' : ''} ${active ? 'text-[var(--text-primary)]' : ''}`}
      aria-label={`Sort by ${label}${active ? `, currently ${dir === 'asc' ? 'ascending' : 'descending'}` : ''}`}>
      {label}
      <Icon size={12} aria-hidden="true" />
    </button>
  )
}

/** EnterpriseTable over the shared pager; sorting runs on the FULL set before paging. */
function SortedPagedTable({ columns, rows, defaultSort, getRowId, emptyMessage, loading, error, onRetry }) {
  const [sort, setSort] = useState(defaultSort)
  const sorted = useMemo(() => {
    const col = columns.find(c => c.id === sort?.key)
    return col?.sort ? sortRows(rows, sort, { [col.id]: col.sort }) : rows
  }, [rows, columns, sort])
  const pager = usePagedRows(sorted)
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

export default function StockReplenishment() {
  const { t } = useLanguage()
  const { activeCurrency, activeCountry, appSettings } = useSettings()
  const { user, profile } = useAuth()
  const { branding } = useTenant()

  const [stockData, setStockData]     = useState([])
  const [tyreRecords, setTyreRecords] = useState([])
  const [loading, setLoading]         = useState(true)
  const [loadError, setLoadError]     = useState(null)
  const [actionError, setActionError] = useState(null)
  const [lastSync, setLastSync]       = useState(null)
  const [now, setNow]                 = useState(() => new Date())

  const [activeTab, setActiveTab]         = useState('matrix')
  const [search, setSearch]               = useState('')
  const [siteFilter, setSiteFilter]       = useState('All')
  const [urgencyFilter, setUrgencyFilter] = useState('All')
  const [leadTimeDays, setLeadTimeDays]   = useState(7)
  const [leadTimeEdit, setLeadTimeEdit]   = useState(false)
  const [leadTimeInput, setLeadTimeInput] = useState('7')
  const [selectedSize, setSelectedSize]   = useState('')

  const [orderLines, setOrderLines] = useState([])
  const [creatingPO, setCreatingPO] = useState(false)
  const [poResult, setPoResult]     = useState(null)
  const [editingQty, setEditingQty] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const at = new Date()
    try {
      const [stockRows, tyreRows] = await Promise.all([
        purchaseOrders.listReplenishmentStock({ country: activeCountry }),
        purchaseOrders.listReplenishmentTyreRecords({ country: activeCountry, sinceDate: loadSince(at) }),
      ])
      setStockData(stockRows || [])
      setTyreRecords(tyreRows || [])
      setNow(at)
      setLastSync(at)
    } catch (e) {
      // A failed read must never render as "no stock".
      setStockData([])
      setTyreRecords([])
      setLoadError(toUserMessage(e, 'Replenishment data could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Money is stated only in one currency; mixed-country stock withholds it.
  const currency = useMemo(
    () => resolveCurrency(stockData, activeCountry, activeCurrency),
    [stockData, activeCountry, activeCurrency],
  )
  const moneyOk = !!currency
  const money = useCallback(
    (n) => (!moneyOk || n === null || n === undefined || !Number.isFinite(n) ? 'N/A' : fmtCurrency(n, currency)),
    [moneyOk, currency],
  )

  const rates = useMemo(() => consumptionRates(tyreRecords, now), [tyreRecords, now])
  const unitCosts = useMemo(() => avgUnitCosts(tyreRecords), [tyreRecords])
  const matrixRows = useMemo(
    () => buildMatrix(stockData, rates, unitCosts, leadTimeDays),
    [stockData, rates, unitCosts, leadTimeDays],
  )
  const allSites = useMemo(
    () => ['All', ...[...new Set(matrixRows.map(r => r.site).filter(Boolean))].sort()],
    [matrixRows],
  )
  const filteredMatrix = useMemo(
    () => filterMatrix(matrixRows, { activeCountry, site: siteFilter, urgency: urgencyFilter, search }),
    [matrixRows, activeCountry, siteFilter, urgencyFilter, search],
  )
  const kpis = useMemo(() => summarizeMatrix(filteredMatrix, editingQty), [filteredMatrix, editingQty])
  const filtersActive = search.trim() !== '' || siteFilter !== 'All' || urgencyFilter !== 'All'
  const clearFilters = () => { setSearch(''); setSiteFilter('All'); setUrgencyFilter('All') }

  // ── Consumption analysis ────────────────────────────────────────────────────
  const monthLabel = useCallback((m) => {
    const [y, mo] = m.split('-')
    return formatMonthYear(new Date(parseInt(y, 10), parseInt(mo, 10) - 1))
  }, [])
  const bySize = useMemo(() => consumptionBySize(tyreRecords, now), [tyreRecords, now])
  const consumptionBarData = useMemo(() => ({
    labels: bySize.months.map(monthLabel),
    datasets: bySize.series.map((s, i) => ({
      label: s.size,
      data: s.data,
      backgroundColor: withAlpha(colorAt(i), 0.8),
      borderColor: colorAt(i),
      borderWidth: 1,
      borderRadius: 4,
    })),
  }), [bySize, monthLabel])

  const sizes = useMemo(() => listSizes(tyreRecords), [tyreRecords])
  useEffect(() => {
    if (sizes.length && !sizes.includes(selectedSize)) setSelectedSize(sizes[0])
  }, [sizes, selectedSize])
  const trend = useMemo(() => trendForSize(tyreRecords, selectedSize, now), [tyreRecords, selectedSize, now])
  const trendLineData = useMemo(() => ({
    labels: trend.months.map(monthLabel),
    datasets: [{
      label: selectedSize || 'Selected size',
      data: trend.data,
      borderColor: colorAt(1),
      backgroundColor: withAlpha(colorAt(1), 0.15),
      tension: 0.4,
      fill: true,
      pointRadius: 4,
      pointBackgroundColor: colorAt(1),
    }],
  }), [trend, selectedSize, monthLabel])

  const grid = useMemo(() => consumptionGrid(tyreRecords, now, 30), [tyreRecords, now])
  const seasonal = useMemo(() => seasonalVariance(tyreRecords, now), [tyreRecords, now])
  const issuedInWindow = useMemo(() => bySize.series.reduce((s, x) => s + x.data.reduce((a, b) => a + b, 0), 0), [bySize])

  // ── Order generator ─────────────────────────────────────────────────────────
  const totals = useMemo(() => orderTotals(orderLines), [orderLines])

  function addToOrder(row) {
    const qty = plannedQty(row, editingQty)
    if (qty <= 0) return
    const unitCost = row.unitCost ?? 0
    setOrderLines(prev => {
      const existing = prev.findIndex(l => l._key === row._key)
      if (existing >= 0) return prev.map((l, i) => (i === existing ? { ...l, qty, totalCost: qty * (parseFloat(l.unitCost) || 0) } : l))
      return [...prev, {
        _key: row._key, brand: row.brand, size: row.size, site: row.site,
        qty, unitCost, supplier: '', totalCost: qty * unitCost,
      }]
    })
    setActiveTab('order')
  }

  function updateOrderLine(idx, field, value) {
    setOrderLines(prev => prev.map((l, i) => {
      if (i !== idx) return l
      const updated = { ...l, [field]: value }
      if (field === 'qty' || field === 'unitCost') {
        updated.totalCost = (parseFloat(updated.qty) || 0) * (parseFloat(updated.unitCost) || 0)
      }
      return updated
    }))
  }
  function removeOrderLine(idx) { setOrderLines(prev => prev.filter((_, i) => i !== idx)) }
  function addBlankOrderLine() {
    setOrderLines(prev => [...prev, {
      _key: `manual-${Date.now()}`, brand: '', size: '', site: '', qty: 1, unitCost: 0, supplier: '', totalCost: 0,
    }])
  }
  function clearOrder() {
    if (orderLines.length && !window.confirm('Remove every line from this order?')) return
    setOrderLines([])
  }

  function saveLeadTime() {
    const v = parseInt(leadTimeInput, 10)
    if (!isNaN(v) && v > 0) setLeadTimeDays(v)
    setLeadTimeEdit(false)
  }

  // ── Exports ─────────────────────────────────────────────────────────────────
  async function exportMatrixExcel() {
    try {
      await exportToExcel(
        matrixExportRows(filteredMatrix, editingQty, moneyOk),
        MATRIX_EXPORT_COLS,
        MATRIX_EXPORT_HEADERS.map(h => (moneyOk && /Cost/.test(h) ? `${h} (${currency})` : h)),
        reportFileName('Stock Replenishment Matrix', activeCountry, formatDate(now)),
        'Replenishment',
      )
    } catch (e) { setActionError(toUserMessage(e, 'Could not export. Try again.')) }
  }

  async function exportOrderExcel() {
    try {
      const XLSX = await import('xlsx')
      const rows = orderLines.map((l, i) => ({
        '#': i + 1, Brand: l.brand, Size: l.size, Site: l.site, Quantity: l.qty,
        'Unit Cost': l.unitCost, 'Total Cost': l.totalCost, 'Preferred Supplier': l.supplier,
      }))
      rows.push({ '#': '', Brand: '', Size: '', Site: '', Quantity: '', 'Unit Cost': 'TOTAL', 'Total Cost': totals.total, 'Preferred Supplier': '' })
      const ws = XLSX.utils.json_to_sheet(rows)
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Purchase Order')
      XLSX.writeFile(wb, `${reportFileName('Replenishment PO', formatDate(new Date()))}.xlsx`)
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  async function exportOrderPDF() {
    try {
      const { default: jsPDF } = await import('jspdf')
      const autoTable = await loadAutoTable()
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      const brand = await resolvePdfBrand(branding)
      const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'
      const poRef = `REPO-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`
      const cur = currency || activeCurrency
      const fileBase = reportFileName('Replenishment PO', formatDate(new Date()))

      pdfHeader(doc, 'Stock Replenishment Purchase Order',
        `Ref: ${poRef} | Lead Time: ${leadTimeDays} days | ${formatDateTime(new Date())}`, company, brand)

      if (orderLines.length === 0) {
        pdfEmptyState(doc, 'No order lines to include in this purchase order',
          'Add lines from the Replenishment Matrix and export again.')
        pdfFooter(doc, 1, 1, company, brand)
        doc.save(`${fileBase}.pdf`)
        return
      }

      autoTable(doc, {
        ...pdfTableTheme(brand.accent),
        startY: 30,
        head: [['Field', 'Value', 'Field', 'Value']],
        body: [
          ['PO Reference', poRef, 'Date', formatDate(new Date())],
          ['Generated By', user?.email || 'TyrePulse System', 'Currency', cur || 'N/A'],
          ['Total Lines', `${orderLines.length} items`, 'Total Value', fmtCurrency(totals.total, cur)],
        ],
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 38 }, 2: { fontStyle: 'bold', cellWidth: 38 } },
        margin: { left: 14, right: 14 },
      })
      const y = (doc.lastAutoTable?.finalY || 70) + 8
      autoTable(doc, {
        ...pdfTableTheme(brand.accent),
        startY: y,
        head: [['#', 'Brand', 'Size', 'Site', 'Qty', 'Unit Cost', 'Total', 'Supplier']],
        body: orderLines.map((l, i) => [
          i + 1, l.brand, l.size, l.site || 'N/A', l.qty,
          fmtCurrency(l.unitCost, cur), fmtCurrency(l.totalCost, cur), l.supplier || 'N/A',
        ]),
        foot: [['', '', '', '', '', 'TOTAL', fmtCurrency(totals.total, cur), '']],
        footStyles: { fillColor: brand.accent, textColor: 255, fontStyle: 'bold' },
        margin: { left: 14, right: 14 },
      })
      const totalPages = doc.internal.getNumberOfPages()
      for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }
      doc.save(`${fileBase}.pdf`)
    } catch (e) {
      setActionError(toUserMessage(e, 'Could not export. Try again.'))
    }
  }

  // ── Create Purchase Order (persist to purchase_orders) - unchanged contract ─
  const handleCreatePurchaseOrder = useCallback(async () => {
    if (orderLines.length === 0) {
      setPoResult({ type: 'error', message: t('stockreplenish.order.errors.noLines') })
      return
    }
    const vendorName = (orderLines.find(l => l.supplier?.trim())?.supplier || '').trim()
    if (!vendorName) {
      setPoResult({ type: 'error', message: t('stockreplenish.order.errors.noSupplier') })
      return
    }
    setCreatingPO(true)
    setPoResult(null)
    try {
      const items = orderLines.map(l => ({
        brand: (l.brand || '').toString().trim(),
        size: (l.size || '').toString().trim(),
        site: (l.site || '').toString().trim() || null,
        quantity: parseInt(l.qty, 10) || 0,
        unit_price: parseFloat(l.unitCost) || 0,
        received_qty: 0,
        supplier: (l.supplier || '').toString().trim() || null,
      }))
      const subtotal = items.reduce((s, it) => s + it.quantity * it.unit_price, 0)
      const tax_amount = 0
      const total_amount = subtotal + tax_amount

      let poNo = null
      try { poNo = await purchaseOrders.generatePoNumber() } catch { poNo = null }
      const poNumber = poNo || `PO-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`

      const poCountry = activeCountry && activeCountry !== 'All' ? activeCountry : null
      const poSite = items.find(it => it.site)?.site || null

      const payload = {
        po_number: poNumber,
        vendor_name: vendorName,
        supplier_name: vendorName,
        order_date: new Date().toISOString().slice(0, 10),
        status: 'Draft',
        priority: 'Normal',
        items,
        subtotal,
        tax_amount,
        total_amount,
        site: poSite,
        country: poCountry,
        requested_by: profile?.full_name || profile?.email || user?.email || null,
        created_by: profile?.id || user?.id || null,
        notes: 'Generated from Stock Replenishment intelligence.',
      }
      await purchaseOrders.createPurchaseOrder(payload)
      setPoResult({ type: 'success', message: t('stockreplenish.order.createSuccess', { poNumber }) })
      setOrderLines([])
    } catch (e) {
      setPoResult({ type: 'error', message: toUserMessage(e, t('stockreplenish.order.errors.createFailed')) })
    } finally {
      setCreatingPO(false)
    }
  }, [orderLines, activeCountry, profile, user, t])

  // ── Table columns ───────────────────────────────────────────────────────────
  const matrixColumns = useMemo(() => [
    { id: 'brand', header: 'Brand', sort: r => r.brand, size: 120, firstDir: 'asc',
      cell: r => <span className="font-medium text-[var(--text-primary)]">{r.brand || 'N/A'}</span> },
    { id: 'size', header: 'Size', sort: r => r.size, size: 120, firstDir: 'asc',
      cell: r => <span className="font-mono text-xs">{r.size || 'N/A'}</span> },
    { id: 'site', header: 'Site', sort: r => r.site, size: 110, firstDir: 'asc',
      cell: r => r.site || 'N/A' },
    { id: 'qtyInStock', header: 'In stock', sort: r => r.qtyInStock, size: 90, align: 'right',
      cell: r => (
        <span className={`tabular-nums ${r.qtyInStock <= 0 ? 'text-red-500 font-bold' : 'text-[var(--text-primary)]'}`}>
          {r.qtyInStock}{r.qtyInStock <= 0 && <span className="sr-only"> (stocked out)</span>}
        </span>
      ) },
    { id: 'consumptionPerDay', header: 'Daily usage', sort: r => r.consumptionPerDay, size: 100, align: 'right',
      cell: r => <span className="tabular-nums text-[var(--text-muted)]">{r.consumptionPerDay > 0 ? r.consumptionPerDay.toFixed(2) : 'None'}</span> },
    { id: 'daysRemaining', header: 'Days left', sort: r => r.daysRemaining, size: 100, align: 'right', firstDir: 'asc',
      cell: r => (
        <span className="tabular-nums" title={r.daysRemaining === null ? 'No consumption in the last 90 days, so cover cannot be measured' : undefined}>
          {r.daysRemaining === null ? 'N/A' : `${r.daysRemaining}d`}
        </span>
      ) },
    { id: 'plannedQty', header: 'Order qty', sort: r => plannedQty(r, editingQty), size: 110, align: 'right',
      cell: r => (
        <input type="number" min="0" value={plannedQty(r, editingQty)}
          aria-label={`Order quantity for ${r.brand || ''} ${r.size || ''} at ${r.site || 'site'}`}
          onChange={e => setEditingQty(prev => ({ ...prev, [r._key]: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
          className={`w-20 text-center ${CELL_INPUT}`} />
      ) },
    { id: 'estimatedCost', header: 'Est. cost', sort: r => (moneyOk && r.unitCost !== null ? plannedQty(r, editingQty) * r.unitCost : null), size: 120, align: 'right',
      cell: r => {
        const q = plannedQty(r, editingQty)
        if (!moneyOk || r.unitCost === null) {
          return <span className="text-xs text-[var(--text-dim)]" title={r.unitCost === null ? 'No unit cost recorded for this brand and size' : 'Mixed currencies'}>N/A</span>
        }
        return (
          <span className="tabular-nums text-xs text-[var(--text-secondary)]" title={r.unitCostSource === 'issues' ? 'Unit cost derived from priced tyre issues' : 'Unit cost from the stock record'}>
            {money(q * r.unitCost)}
          </span>
        )
      } },
    { id: 'urgency', header: 'Status', sort: r => URGENCIES.indexOf(r.urgency), size: 120, firstDir: 'asc',
      cell: r => <UrgencyBadge urgency={r.urgency} /> },
    { id: 'actions', header: '', size: 110,
      cell: r => {
        const q = plannedQty(r, editingQty)
        return (
          <button type="button" onClick={() => addToOrder(r)} disabled={q <= 0}
            aria-label={`Add ${r.brand || ''} ${r.size || ''} to order`}
            className={`min-h-[44px] inline-flex items-center gap-1 px-3 rounded-lg text-xs font-medium border border-[var(--input-border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS}`}>
            <Plus size={12} aria-hidden="true" /> Order
          </button>
        )
      } },
  // addToOrder closes over editingQty, which is already a dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [editingQty, moneyOk, money])

  const gridColumns = useMemo(() => [
    { id: 'size', header: 'Size', sort: r => r.size, size: 130, firstDir: 'asc',
      cell: r => <span className="font-mono text-[var(--text-primary)]">{r.size}</span> },
    ...grid.sites.map(site => ({
      id: `site:${site}`, header: site, sort: r => r[site], size: 90, align: 'right',
      cell: r => <span className={`tabular-nums ${r[site] > 0 ? 'text-[var(--text-primary)]' : 'text-[var(--text-dim)]'}`}>{r[site]}</span>,
    })),
    { id: 'total', header: 'Total', sort: r => r.total, size: 90, align: 'right',
      cell: r => <span className="tabular-nums font-semibold text-[var(--text-primary)]">{r.total}</span> },
  ], [grid.sites])

  const indexedOrderLines = useMemo(() => orderLines.map((line, index) => ({ ...line, index })), [orderLines])
  const orderColumns = useMemo(() => [
    { id: 'brand', header: 'Brand', size: 150,
      cell: l => <input value={l.brand} aria-label={`Brand, line ${l.index + 1}`} placeholder="Brand"
        onChange={e => updateOrderLine(l.index, 'brand', e.target.value)} className={`w-full ${CELL_INPUT}`} /> },
    { id: 'size', header: 'Size', size: 140,
      cell: l => <input value={l.size} aria-label={`Size, line ${l.index + 1}`} placeholder="Size"
        onChange={e => updateOrderLine(l.index, 'size', e.target.value)} className={`w-full font-mono ${CELL_INPUT}`} /> },
    { id: 'site', header: 'Site', size: 130,
      cell: l => <input value={l.site} aria-label={`Site, line ${l.index + 1}`} placeholder="Site"
        onChange={e => updateOrderLine(l.index, 'site', e.target.value)} className={`w-full ${CELL_INPUT}`} /> },
    { id: 'qty', header: 'Qty', size: 90, align: 'right',
      cell: l => <input type="number" min="1" value={l.qty} aria-label={`Quantity, line ${l.index + 1}`}
        onChange={e => updateOrderLine(l.index, 'qty', parseInt(e.target.value, 10) || 1)} className={`w-20 text-center ${CELL_INPUT}`} /> },
    { id: 'unitCost', header: 'Unit cost', size: 130, align: 'right',
      cell: l => <input type="number" min="0" step="0.01" value={l.unitCost} aria-label={`Unit cost, line ${l.index + 1}`}
        onChange={e => updateOrderLine(l.index, 'unitCost', parseFloat(e.target.value) || 0)} className={`w-28 text-right ${CELL_INPUT}`} /> },
    { id: 'totalCost', header: 'Total', size: 120, align: 'right',
      cell: l => <span className="tabular-nums font-medium text-[var(--text-primary)] whitespace-nowrap">{fmtCurrency(l.totalCost, currency || activeCurrency)}</span> },
    { id: 'supplier', header: 'Supplier', size: 170,
      cell: l => <input value={l.supplier} aria-label={`Supplier, line ${l.index + 1}`} placeholder="Supplier name"
        onChange={e => updateOrderLine(l.index, 'supplier', e.target.value)} className={`w-full ${CELL_INPUT}`} /> },
    { id: 'actions', header: '', size: 60,
      cell: l => (
        <button type="button" onClick={() => removeOrderLine(l.index)} aria-label={`Remove line ${l.index + 1}`}
          className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] hover:text-red-500 ${FOCUS}`}>
          <X size={16} aria-hidden="true" />
        </button>
      ) },
  ], [currency, activeCurrency])

  const noStock = !loading && !loadError && stockData.length === 0

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('stockreplenish.title')}
        subtitle={t('stockreplenish.subtitle', {
          count: stockData.length,
          syncedSuffix: lastSync ? t('stockreplenish.syncedSuffix', { time: lastSync.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) }) : '',
        })}
        icon={Package}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {leadTimeEdit ? (
              <div className="flex items-center gap-1">
                <label className="sr-only" htmlFor="lead-time-input">Supplier lead time in days</label>
                <input id="lead-time-input" type="number" min="1" max="365" value={leadTimeInput}
                  onChange={e => setLeadTimeInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') saveLeadTime(); if (e.key === 'Escape') setLeadTimeEdit(false) }}
                  className={`w-20 ${CTRL}`} autoFocus />
                <span className="text-[var(--text-muted)] text-xs">days</span>
                <button type="button" onClick={saveLeadTime} aria-label="Save lead time"
                  className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg bg-[var(--accent)] text-white ${FOCUS}`}>
                  <CheckCircle size={16} aria-hidden="true" />
                </button>
                <button type="button" onClick={() => setLeadTimeEdit(false)} aria-label="Cancel lead time edit"
                  className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg border border-[var(--input-border)] text-[var(--text-secondary)] ${FOCUS}`}>
                  <X size={16} aria-hidden="true" />
                </button>
              </div>
            ) : (
              <button type="button"
                onClick={() => { setLeadTimeEdit(true); setLeadTimeInput(String(leadTimeDays)) }}
                className={`btn-secondary min-h-[44px] flex items-center gap-1.5 text-sm ${FOCUS}`}>
                <Clock size={14} aria-hidden="true" /> Lead time: {leadTimeDays}d <Edit2 size={12} aria-hidden="true" />
              </button>
            )}
            <button type="button" onClick={exportMatrixExcel} disabled={loading || filteredMatrix.length === 0}
              className={`btn-secondary min-h-[44px] flex items-center gap-1.5 text-sm disabled:opacity-50 ${FOCUS}`}>
              <Download size={14} aria-hidden="true" /> Excel
            </button>
            <button type="button" onClick={load} disabled={loading}
              className={`btn-secondary min-h-[44px] flex items-center gap-1.5 text-sm disabled:opacity-50 ${FOCUS}`}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" /> Refresh
            </button>
          </div>
        }
      />

      {loadError && (
        <div role="alert" className="card p-4 flex flex-wrap items-center gap-3 border border-red-500/40">
          <AlertTriangle size={18} className="text-red-500 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--text-primary)]">Replenishment data could not be loaded</p>
            <p className="text-sm text-[var(--text-muted)]">{loadError}</p>
          </div>
          <button type="button" onClick={load} className={`btn-secondary min-h-[44px] flex items-center gap-1.5 text-sm ${FOCUS}`}>
            <RefreshCw size={14} aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {actionError && (
        <div role="alert" className="card p-3 flex items-center gap-3 border border-red-500/40">
          <AlertTriangle size={16} className="text-red-500 shrink-0" aria-hidden="true" />
          <p className="text-sm text-[var(--text-secondary)] flex-1">{actionError}</p>
          <button type="button" onClick={() => setActionError(null)} aria-label="Dismiss error"
            className={`min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] ${FOCUS}`}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {!moneyOk && !loading && stockData.length > 0 && (
        <div role="status" className="card p-3 flex items-start gap-2 border border-[var(--input-border)] text-xs text-[var(--text-secondary)]">
          <Coins size={16} className="shrink-0 mt-0.5 text-[var(--text-muted)]" aria-hidden="true" />
          <span>Stock spans countries with different currencies, so reorder value is withheld rather than added together. Pick one country to see money figures.</span>
        </div>
      )}

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatTile icon={AlertTriangle} label="Needs reorder" value={loading ? '...' : kpis.needsReorder.toLocaleString()}
          sub="Under 30 days of cover" tone={kpis.needsReorder > 0 ? 'crit' : 'neutral'} />
        <StatTile icon={ShoppingCart} label="Reorder value" value={money(kpis.reorderValue)}
          sub={kpis.unvaluedLines ? `${kpis.unvaluedLines} lines have no unit cost` : `${kpis.reorderUnits.toLocaleString()} units planned`} />
        <StatTile icon={Clock} label="Avg days of cover" value={kpis.avgDays === null ? 'N/A' : `${kpis.avgDays}d`}
          sub={kpis.measuredItems ? `${kpis.measuredItems} items with usage` : 'No usage recorded'}
          tone={kpis.avgDays !== null && kpis.avgDays < 30 ? 'crit' : 'info'} />
        <StatTile icon={PackageX} label="Stocked out" value={kpis.stockouts.toLocaleString()}
          sub="Zero quantity on hand" tone={kpis.stockouts > 0 ? 'crit' : 'neutral'} />
        <StatTile icon={TrendingUp} label="Overstocked" value={kpis.overstocked.toLocaleString()} sub="Over 180 days of cover" />
        <StatTile icon={TrendingDown} label="No usage" value={kpis.idle.toLocaleString()} sub="In stock, not issued in 90 days" />
      </div>

      {/* ── Tabs ── */}
      <div role="tablist" aria-label="Replenishment views"
        className="flex flex-wrap items-center gap-1 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-1 w-fit max-w-full">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} type="button" role="tab" aria-selected={activeTab === key} onClick={() => setActiveTab(key)}
            className={`min-h-[44px] px-4 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${FOCUS} ${
              activeTab === key ? 'bg-[var(--accent)] text-white shadow' : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}>
            <Icon size={14} aria-hidden="true" />
            {label}
            {key === 'order' && orderLines.length > 0 && (
              <span className="bg-[var(--input-bg)] text-[var(--text-primary)] text-xs rounded-full min-w-[1.25rem] h-5 px-1 flex items-center justify-center font-bold">
                {orderLines.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ═══ TAB: MATRIX ═══ */}
      {activeTab === 'matrix' && (
        <div className="space-y-4">
          <section className="card p-4" aria-label="Filters">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
              <label className="block lg:col-span-2">
                <span className="text-xs text-[var(--text-dim)] mb-1.5 block">Search</span>
                <span className="relative block">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                  <input type="search" value={search} onChange={e => setSearch(e.target.value)}
                    placeholder="Brand, size, site" className={`w-full pl-9 ${CTRL}`} />
                </span>
              </label>
              <label className="block">
                <span className="text-xs text-[var(--text-dim)] mb-1.5 block">Site</span>
                <select value={siteFilter} onChange={e => setSiteFilter(e.target.value)} className={`w-full ${CTRL}`}>
                  {allSites.map(s => <option key={s} value={s}>{s === 'All' ? 'All sites' : s}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="text-xs text-[var(--text-dim)] mb-1.5 block">Status</span>
                <select value={urgencyFilter} onChange={e => setUrgencyFilter(e.target.value)} className={`w-full ${CTRL}`}>
                  <option value="All">All statuses</option>
                  {URGENCIES.map(u => <option key={u} value={u}>{URGENCY_LABEL[u]}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[var(--text-dim)]" aria-live="polite">
              <span>{loading ? 'Loading...' : `${filteredMatrix.length.toLocaleString()} of ${matrixRows.length.toLocaleString()} items`}</span>
              {filtersActive && (
                <button type="button" onClick={clearFilters}
                  className={`min-h-[44px] inline-flex items-center gap-1 px-3 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${FOCUS}`}>
                  <X size={12} aria-hidden="true" /> Clear filters
                </button>
              )}
              <span className="ml-auto flex flex-wrap items-center gap-2">
                {URGENCIES.map(u => (
                  <span key={u} className="inline-flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: URGENCY_TONE[u] }} aria-hidden="true" />
                    {URGENCY_LABEL[u]}: {kpis.byUrgency[u] || 0}
                  </span>
                ))}
              </span>
            </div>
          </section>

          {noStock ? (
            <div className="card p-12 text-center" role="status">
              <Package size={40} className="mx-auto mb-3 text-[var(--text-dim)]" aria-hidden="true" />
              <p className="text-[var(--text-primary)] font-medium">No stock records found</p>
              <p className="text-[var(--text-muted)] text-sm mt-1">Add stock records to see replenishment recommendations.</p>
            </div>
          ) : (
            <SortedPagedTable
              columns={matrixColumns}
              rows={filteredMatrix}
              defaultSort={{ key: 'daysRemaining', dir: 'asc' }}
              getRowId={r => r._key + (r.id ? `|${r.id}` : '')}
              loading={loading}
              error={loadError}
              onRetry={load}
              emptyMessage="No stock items match these filters"
            />
          )}
          <p className="text-xs text-[var(--text-dim)]">
            Cover uses tyres issued in the last 90 days. Suggested quantity covers 2 months of usage, net of stock on hand.
            Items with stock but no usage show N/A cover, not an invented number.
          </p>
        </div>
      )}

      {/* ═══ TAB: CONSUMPTION ═══ */}
      {activeTab === 'consumption' && (
        <div className="space-y-6">
          {seasonal !== null && seasonal > 20 && (
            <div role="status" className="card p-4 flex items-start gap-3 border border-amber-500/40">
              <TrendingDown size={18} className="text-amber-500 mt-0.5 shrink-0" aria-hidden="true" />
              <p className="text-[var(--text-secondary)] text-sm">{t('stockreplenish.consumption.seasonalNote', { pct: seasonal.toFixed(0) })}</p>
            </div>
          )}

          <section className="card p-5" aria-labelledby="rep-bysize">
            <h3 id="rep-bysize" className="text-[var(--text-primary)] font-semibold mb-4">Monthly consumption by top 5 tyre sizes (last 6 months)</h3>
            <div className="h-64">
              {loading ? <div className="h-full animate-pulse bg-[var(--input-bg)] rounded" aria-busy="true" />
                : consumptionBarData.datasets.length > 0 ? (
                  <div className="h-full" role="img" aria-label={`Stacked monthly issues for the top ${bySize.series.length} sizes, ${issuedInWindow} tyres in total.`}>
                    <Bar data={consumptionBarData} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { ...CHART_OPTS.plugins.legend, position: 'top' } } }} />
                  </div>
                ) : (
                  <p className="h-full flex items-center justify-center text-[var(--text-dim)] text-sm">No tyre issue records in the last 6 months</p>
                )}
            </div>
          </section>

          <section className="card p-5" aria-labelledby="rep-trend">
            <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
              <h3 id="rep-trend" className="text-[var(--text-primary)] font-semibold">Consumption trend by size</h3>
              {sizes.length > 0 && (
                <label className="block">
                  <span className="sr-only">Tyre size</span>
                  <select value={selectedSize} onChange={e => setSelectedSize(e.target.value)} className={CTRL}>
                    {sizes.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              )}
            </div>
            <div className="h-56">
              {selectedSize ? (
                <div className="h-full" role="img" aria-label={`Monthly issues of ${selectedSize}: ${trend.data.join(', ')}.`}>
                  <Line data={trendLineData} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { display: false } } }} />
                </div>
              ) : (
                <p className="h-full flex items-center justify-center text-[var(--text-dim)] text-sm">No size data available</p>
              )}
            </div>
          </section>

          <section className="card p-5 space-y-3" aria-labelledby="rep-grid">
            <h3 id="rep-grid" className="text-[var(--text-primary)] font-semibold">Size by site consumption (last 30 days)</h3>
            <SortedPagedTable
              columns={gridColumns}
              rows={grid.rows}
              defaultSort={{ key: 'total', dir: 'desc' }}
              getRowId={r => r.size}
              loading={loading}
              error={loadError}
              onRetry={load}
              emptyMessage="No tyre issues in the last 30 days"
            />
          </section>
        </div>
      )}

      {/* ═══ TAB: ORDER GENERATOR ═══ */}
      {activeTab === 'order' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile icon={Coins} label="Total PO value" value={fmtCurrency(totals.total, currency || activeCurrency)} sub={`${totals.lines} line items`} />
            <StatTile icon={Package} label="Total units" value={totals.units.toLocaleString()} sub="Tyres across all lines" />
            <StatTile icon={Layers} label="Sites covered" value={totals.sites.toLocaleString()} sub="Unique sites" />
            <StatTile icon={AlertTriangle} label="Lines to complete" value={(totals.unpriced + totals.missingSupplier).toLocaleString()}
              sub={`${totals.unpriced} unpriced, ${totals.missingSupplier} without supplier`}
              tone={totals.unpriced + totals.missingSupplier > 0 ? 'warn' : 'neutral'} />
          </div>

          <section className="card p-0 overflow-hidden" aria-labelledby="rep-order">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 border-b border-[var(--input-border)]">
              <h3 id="rep-order" className="text-[var(--text-primary)] font-semibold flex items-center gap-2">
                <ShoppingCart size={16} className="text-[var(--text-muted)]" aria-hidden="true" /> Purchase order lines
              </h3>
              <button type="button" onClick={addBlankOrderLine}
                className={`btn-secondary min-h-[44px] flex items-center gap-1.5 text-sm ${FOCUS}`}>
                <Plus size={14} aria-hidden="true" /> Add line
              </button>
            </div>
            {orderLines.length === 0 ? (
              <div className="py-14 text-center px-4" role="status">
                <ShoppingCart size={40} className="mx-auto mb-3 text-[var(--text-dim)]" aria-hidden="true" />
                <p className="text-[var(--text-primary)] font-medium">No order lines yet</p>
                <p className="text-[var(--text-muted)] text-sm mt-1">Choose Order in the Replenishment Matrix or add lines manually.</p>
                <button type="button" onClick={() => setActiveTab('matrix')}
                  className={`btn-secondary min-h-[44px] mt-4 inline-flex items-center gap-1.5 text-sm ${FOCUS}`}>
                  <Layers size={14} aria-hidden="true" /> Go to the Replenishment Matrix
                </button>
              </div>
            ) : (
              <div className="p-3">
                <SortedPagedTable
                  columns={orderColumns}
                  rows={indexedOrderLines}
                  getRowId={l => l._key}
                  emptyMessage="No order lines"
                />
                <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-3 text-sm">
                  <span className="text-[var(--text-muted)]">
                    {totals.lines} line{totals.lines !== 1 ? 's' : ''}, {totals.units} units
                  </span>
                  <span className="text-[var(--text-muted)]">
                    Total PO value: <span className="text-[var(--text-primary)] text-lg font-bold tabular-nums">{fmtCurrency(totals.total, currency || activeCurrency)}</span>
                  </span>
                </div>
              </div>
            )}
          </section>

          {poResult && (
            <div role={poResult.type === 'success' ? 'status' : 'alert'}
              className={`card p-4 flex flex-wrap items-center gap-3 border text-sm ${poResult.type === 'success' ? 'border-green-500/40' : 'border-red-500/40'}`}>
              {poResult.type === 'success'
                ? <CheckCircle size={18} className="shrink-0 text-green-500" aria-hidden="true" />
                : <AlertTriangle size={18} className="shrink-0 text-red-500" aria-hidden="true" />}
              <span className="text-[var(--text-secondary)]">{poResult.message}</span>
              {poResult.type === 'success' && (
                <Link to="/procurement" className={`inline-flex items-center gap-1 text-[var(--accent)] hover:underline rounded ${FOCUS}`}>
                  <ExternalLink size={14} aria-hidden="true" /> Open Procurement
                </Link>
              )}
              <button type="button" onClick={() => setPoResult(null)} aria-label="Dismiss message"
                className={`ml-auto min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-muted)] ${FOCUS}`}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          )}

          {orderLines.length > 0 && (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={handleCreatePurchaseOrder} disabled={creatingPO}
                className={`btn-primary min-h-[44px] flex items-center gap-2 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS}`}>
                {creatingPO ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <ShoppingCart size={16} aria-hidden="true" />}
                {creatingPO ? 'Creating PO...' : 'Create Purchase Order'}
              </button>
              <button type="button" onClick={exportOrderExcel}
                className={`btn-secondary min-h-[44px] flex items-center gap-2 text-sm ${FOCUS}`}>
                <FileSpreadsheet size={16} aria-hidden="true" /> Export PO to Excel
              </button>
              <button type="button" onClick={exportOrderPDF}
                className={`btn-secondary min-h-[44px] flex items-center gap-2 text-sm ${FOCUS}`}>
                <FileText size={16} aria-hidden="true" /> Export PO to PDF
              </button>
              <button type="button" onClick={clearOrder}
                className={`min-h-[44px] flex items-center gap-2 px-4 rounded-lg border border-red-500/40 text-red-500 text-sm font-medium hover:bg-red-500/10 ${FOCUS}`}>
                <X size={16} aria-hidden="true" /> Clear all lines
              </button>
              <Link to="/procurement"
                className={`ml-auto min-h-[44px] inline-flex items-center gap-1.5 text-sm text-[var(--accent)] hover:underline rounded ${FOCUS}`}>
                <ExternalLink size={14} aria-hidden="true" /> Manage full POs in Procurement
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
