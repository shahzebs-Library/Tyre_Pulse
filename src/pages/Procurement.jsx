// ─────────────────────────────────────────────────────────────────────────────
// Procurement.jsx - Purchase Order Management · /procurement
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import {
  ShoppingCart, Package, CheckCircle, Clock, AlertTriangle,
  Plus, X, Edit2, FileText, DollarSign, Truck, Calendar,
  Download, FileSpreadsheet, RefreshCw, Loader2,
  Search, Filter, ChevronDown, ChevronUp,
  TrendingUp, BarChart2, Eye, Printer, Lock,
} from 'lucide-react'
import * as procurementApi from '../lib/api/procurement'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import { formatCurrency as _fmtCurrencyBase, formatDate, formatMonthYear, formatMonth } from '../lib/formatters'
import { resolvePdfBrand, pdfHeader, pdfFooter, pdfTableTheme } from '../lib/exportUtils'
import { toUserMessage } from '../lib/safeError'
import { useTenant } from '../contexts/TenantContext'
import { useLanguage } from '../contexts/LanguageContext'
import PageHeader from '../components/ui/PageHeader'
import Modal from '../components/ui/Modal'
import { loadAutoTable } from '../lib/pdfEngine'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { colorAt, withAlpha } from '../lib/reportColors'
import {
  PO_STATUSES, PO_PRIORITIES, calcItemTotal, calcSubtotal, filterOrdersBase, filterOrdersByStatus,
  procurementKpis, budgetPosition, vendorMonthlySpend, statusCounts, cumulativeSpend, optionsOf,
  orderExportRows, receiptProgress, daysBetween,
} from '../lib/procurementAnalytics'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUSES = PO_STATUSES
const PRIORITIES = PO_PRIORITIES

// Static Tailwind classes so the JIT compiler does not purge dynamically
// interpolated `text-${color}-400` KPI colours in production builds.
const KPI_TEXT_COLOR = {
  green:  'text-green-400',
  yellow: 'text-yellow-400',
  red:    'text-red-400',
  teal:   'text-teal-400',
  purple: 'text-purple-400',
}
const kpiText = (c) => KPI_TEXT_COLOR[c] || 'text-[var(--text-primary)]'
const BUDGET_KEY = 'tp_procurement_budget'

const STATUS_CONFIG = {
  'Draft':            { color: 'text-[var(--text-secondary)]',   bg: 'bg-[var(--surface-2)]',        border: 'border-[var(--border-bright)]' },
  'Submitted':        { color: 'text-blue-400',   bg: 'bg-blue-900/30',     border: 'border-blue-700' },
  'Approved':         { color: 'text-green-400',  bg: 'bg-green-900/30',    border: 'border-green-700' },
  'Ordered':          { color: 'text-yellow-400', bg: 'bg-yellow-900/30',   border: 'border-yellow-700' },
  'Partial Delivery': { color: 'text-orange-400', bg: 'bg-orange-900/30',   border: 'border-orange-700' },
  'Delivered':        { color: 'text-teal-400',   bg: 'bg-teal-900/30',     border: 'border-teal-700' },
  'Cancelled':        { color: 'text-red-400',    bg: 'bg-red-900/20',      border: 'border-red-700' },
  'Closed':           { color: 'text-purple-400', bg: 'bg-purple-900/20',   border: 'border-purple-700' },
}

const PRIORITY_CONFIG = {
  Urgent: { color: 'text-red-400',    dot: 'bg-red-500' },
  High:   { color: 'text-orange-400', dot: 'bg-orange-500' },
  Normal: { color: 'text-blue-400',   dot: 'bg-blue-500' },
  Low:    { color: 'text-[var(--text-secondary)]',   dot: 'bg-gray-500' },
}

const STATUS_TIMELINE = ['Draft','Submitted','Approved','Ordered','Delivered','Closed']

const EMPTY_ITEM = { brand: '', size: '', quantity: 1, unit_price: '', received_qty: 0 }
const EMPTY_FORM = {
  vendor_name: '', order_date: new Date().toISOString().slice(0, 10),
  expected_delivery: '', priority: 'Normal', site: '', country: '',
  budget_code: '', requested_by: '', approved_by: '', notes: '',
  status: 'Draft', items: [],
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtDate = (d) => formatDate(d)
const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: 'var(--text-muted)', boxWidth: 12, font: { size: 11 } } },
    tooltip: { backgroundColor: 'var(--panel)', borderColor: 'var(--hairline)', borderWidth: 1, titleColor: 'var(--text-primary)', bodyColor: 'var(--text-secondary)' },
  },
  scales: {
    x: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
    y: { ticks: { color: 'var(--text-muted)', font: { size: 11 } }, grid: { color: 'var(--panel-2)' } },
  },
}

// ── Status Badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.Draft
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color} ${cfg.bg} ${cfg.border}`}>
      {status}
    </span>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function Procurement() {
  const { t } = useLanguage()
  const { activeCountry, activeCurrency, appSettings } = useSettings()
  const { user, profile } = useAuth()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'
  const fmtCur = (v) => _fmtCurrencyBase(v, activeCurrency)

  const [orders, setOrders]         = useState([])
  const [loading, setLoading]       = useState(true)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState(null)

  // Filters
  const [search, setSearch]         = useState('')
  const [statusFilter, setStatus]   = useState('All')
  const [vendorFilter, setVendor]   = useState('All')
  const [siteFilter, setSite]       = useState('All')
  const [dateFrom, setDateFrom]     = useState('')
  const [dateTo, setDateTo]         = useState('')

  // UI state
  const [showForm, setShowForm]     = useState(false)
  const [editPO, setEditPO]         = useState(null)
  const [viewPO, setViewPO]         = useState(null)
  // Approval-engine lock for the open PO. EntityApprovalPanel surfaces the
  // active/locked state of the workflow via onStateChange; while a PO is
  // mid-approval (pending/in_review/returned) or approved, its edit/save/
  // status-change controls are disabled so the record can't drift from the
  // approved snapshot. Reset whenever the open record changes.
  const [wfLocked, setWfLocked]     = useState({ isActive: false, isLocked: false, status: null })
  const poLocked = wfLocked.isActive || wfLocked.isLocked
  const handleWfStateChange = useCallback((next) => {
    setWfLocked(prev =>
      prev.isActive === next.isActive &&
      prev.isLocked === next.isLocked &&
      prev.status === next.status
        ? prev
        : next,
    )
  }, [])
  // Goods Receipt (GRN) is a distinct approval booked against the same PO id.
  // Its lifecycle does not gate PO edits (the PO already has its own lock via
  // handleWfStateChange), so we only track its state locally for surfacing.
  const [grnState, setGrnState] = useState({ isActive: false, isLocked: false, status: null })
  const handleGrnStateChange = useCallback((next) => {
    setGrnState(prev =>
      prev.isActive === next.isActive &&
      prev.isLocked === next.isLocked &&
      prev.status === next.status
        ? prev
        : next,
    )
  }, [])
  const [formData, setFormData]     = useState(EMPTY_FORM)
  const [itemRow, setItemRow]       = useState({ ...EMPTY_ITEM })
  const [taxPct, setTaxPct]         = useState(15)
  // Procurement budget - stored in the shared settings table (V62 sweep) so
  // every user sees the same figure instead of a per-browser localStorage copy.
  const [budget, setBudget]         = useState(0)
  const [budgetInput, setBudgetInput] = useState('')
  const [editBudget, setEditBudget]   = useState(false)
  const [budgetError, setBudgetError] = useState('')

  useEffect(() => {
    procurementApi.getSetting(BUDGET_KEY).then(({ data }) => {
      const v = parseFloat(typeof data?.value === 'string' ? JSON.parse(data.value) : data?.value)
      if (Number.isFinite(v)) setBudget(v)
    })
  }, [])

  // ── Load ───────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await procurementApi.listPurchaseOrders({ country: activeCountry })
      if (err) throw err
      setOrders(data || [])
    } catch (e) {
      setError(toUserMessage(e))
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Reset the approval lock whenever the open PO detail record changes, so the
  // panel's onStateChange for the new record starts from a clean slate.
  useEffect(() => {
    setWfLocked({ isActive: false, isLocked: false, status: null })
    setGrnState({ isActive: false, isLocked: false, status: null })
  }, [viewPO?.id])

  // ── Derived values ─────────────────────────────────────────────────────────
  const vendors = useMemo(() => optionsOf(orders, 'vendor_name'), [orders])
  const sites   = useMemo(() => optionsOf(orders, 'site'), [orders])

  // Every filter EXCEPT status (engine: src/lib/procurementAnalytics). The
  // status doughnut computes over this: the chart IS the status dimension, so
  // counting the already-filtered set would collapse it to one slice.
  const statusChartBase = useMemo(
    () => filterOrdersBase(orders, { search, vendor: vendorFilter, site: siteFilter, from: dateFrom, to: dateTo }),
    [orders, search, vendorFilter, siteFilter, dateFrom, dateTo],
  )
  const filtered = useMemo(() => filterOrdersByStatus(statusChartBase, statusFilter), [statusChartBase, statusFilter])

  // True when the register below is narrowed. Drives the caption on the tiles.
  const scopeActive = Boolean(
    search.trim() || statusFilter !== 'All' || vendorFilter !== 'All' ||
    siteFilter !== 'All' || dateFrom || dateTo
  )

  // ── KPIs ───────────────────────────────────────────────────────────────────
  // Computed over `filtered`, the same population the table renders.
  const kpis = useMemo(() => procurementKpis(filtered, { now: new Date() }), [filtered])

  // Budget variance DELIBERATELY stays whole-register. `budget` is a single
  // annual org-wide figure, so dividing one site's spend by the whole company's
  // budget would read as "well under" when the filter only excluded the spend.
  const budgetScope = useMemo(() => budgetPosition(orders, budget), [orders, budget])

  // ── Chart: monthly spend by vendor (top 5), same population as the table ──
  const vendorBarData = useMemo(() => {
    const { months, series } = vendorMonthlySpend(filtered, { now: new Date() })
    return {
      labels: months.map(m => {
        const [y, mo] = m.split('-')
        return formatMonthYear(new Date(parseInt(y), parseInt(mo) - 1))
      }),
      datasets: series.map((sv, idx) => ({
        label: sv.vendor,
        data: sv.data,
        backgroundColor: withAlpha(colorAt(idx), 0.8),
        borderColor: colorAt(idx),
        borderWidth: 1,
      })),
    }
  }, [filtered])

  // ── Chart: POs by status (doughnut), holds out its own dimension ──────────
  const statusDoughnutData = useMemo(() => {
    const colorMap = {
      Draft: '#6b7280', Submitted: '#3b82f6', Approved: '#10b981',
      Ordered: '#f59e0b', 'Partial Delivery': '#f97316',
      Delivered: '#14b8a6', Cancelled: '#ef4444', Closed: '#a855f7',
    }
    const entries = Object.entries(statusCounts(statusChartBase)).filter(([, v]) => v > 0)
    return {
      labels: entries.map(([k]) => k),
      datasets: [{
        data: entries.map(([, v]) => v),
        backgroundColor: entries.map(([k]) => colorMap[k] || '#6b7280'),
        borderColor: 'var(--panel-2)',
        borderWidth: 2,
      }],
    }
  }, [statusChartBase])

  // ── Chart: cumulative spend vs budget (whole register, like the budget) ───
  const cumulativeLineData = useMemo(() => {
    const series = cumulativeSpend(orders, budget, { now: new Date() })
    return {
      labels: series.months.map(m => {
        const [y, mo] = m.split('-')
        return formatMonth(new Date(parseInt(y), parseInt(mo) - 1))
      }),
      datasets: [
        {
          label: t('procurement.charts.actualSpendLabel'),
          data: series.spend,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16,185,129,0.1)',
          tension: 0.4,
          fill: true,
          pointRadius: 3,
        },
        ...(series.budget ? [{
          label: t('procurement.charts.budgetLabel'),
          data: series.budget,
          borderColor: '#f59e0b',
          backgroundColor: 'transparent',
          borderDash: [5, 5],
          tension: 0,
          pointRadius: 0,
        }] : []),
      ],
    }
  }, [orders, budget, t])

  // ── Form helpers ───────────────────────────────────────────────────────────
  function openNew() {
    setEditPO(null)
    setFormData({ ...EMPTY_FORM, order_date: new Date().toISOString().slice(0, 10) })
    setItemRow({ ...EMPTY_ITEM })
    setTaxPct(15)
    setShowForm(true)
  }
  function openEdit(po) {
    setEditPO(po)
    setFormData({
      vendor_name: po.vendor_name || '',
      order_date: po.order_date || new Date().toISOString().slice(0, 10),
      expected_delivery: po.expected_delivery || '',
      priority: po.priority || 'Normal',
      status: po.status || 'Draft',
      site: po.site || '',
      country: po.country || '',
      budget_code: po.budget_code || '',
      requested_by: po.requested_by || '',
      approved_by: po.approved_by || '',
      notes: po.notes || '',
      items: po.items || [],
    })
    const sub = calcSubtotal(po.items || [])
    const tax = sub > 0 ? Math.round(((po.tax_amount || 0) / sub) * 100) : 15
    setTaxPct(isNaN(tax) ? 15 : tax)
    setItemRow({ ...EMPTY_ITEM })
    setShowForm(true)
  }

  // ── Line item management ───────────────────────────────────────────────────
  function addItem() {
    if (!itemRow.brand.trim() || !itemRow.size.trim()) return
    setFormData(f => ({ ...f, items: [...f.items, { ...itemRow, quantity: parseInt(itemRow.quantity) || 1, unit_price: parseFloat(itemRow.unit_price) || 0, received_qty: 0 }] }))
    setItemRow({ ...EMPTY_ITEM })
  }
  function removeItem(idx) {
    setFormData(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }))
  }
  function updateItemReceivedQty(poId, itemIdx, qty) {
    if (viewPO?.id === poId && poLocked) return
    const po = orders.find(o => o.id === poId)
    if (!po) return
    const items = po.items.map((it, i) => i === itemIdx ? { ...it, received_qty: parseInt(qty) || 0 } : it)
    procurementApi.updatePurchaseOrder(poId, { items, updated_at: new Date().toISOString() }).then(({ error: err }) => {
      if (err) { alert(t('procurement.alerts.updateFailed', { message: toUserMessage(err) })); return }
      load()
      setViewPO(v => v ? { ...v, items } : null)
    })
  }

  const formSubtotal = useMemo(() => calcSubtotal(formData.items), [formData.items])
  const formTax      = useMemo(() => formSubtotal * (taxPct / 100), [formSubtotal, taxPct])
  const formTotal    = useMemo(() => formSubtotal + formTax, [formSubtotal, formTax])

  // ── Save ───────────────────────────────────────────────────────────────────
  async function handleSave() {
    // Approval-locked records are immutable — the server RPCs are the real
    // boundary, this is the UI guard mirroring it.
    if (editPO && poLocked) { alert('Locked, in approval'); return }
    if (!formData.vendor_name.trim()) { alert(t('procurement.alerts.vendorRequired')); return }
    if (formData.items.length === 0)  { alert(t('procurement.alerts.lineItemRequired')); return }
    setSaving(true)
    try {
      const subtotal    = calcSubtotal(formData.items)
      const tax_amount  = subtotal * (taxPct / 100)
      const total_amount = subtotal + tax_amount

      const payload = {
        vendor_name:       formData.vendor_name.trim(),
        order_date:        formData.order_date || new Date().toISOString().slice(0, 10),
        expected_delivery: formData.expected_delivery || null,
        priority:          formData.priority,
        status:            formData.status,
        items:             formData.items,
        subtotal,
        tax_amount,
        total_amount,
        site:              formData.site?.trim() || null,
        country:           formData.country?.trim() || null,
        budget_code:       formData.budget_code?.trim() || null,
        requested_by:      formData.requested_by?.trim() || null,
        approved_by:       formData.approved_by?.trim() || null,
        notes:             formData.notes?.trim() || null,
        created_by:        user?.id || null,
      }

      if (editPO) {
        const { error: err } = await procurementApi.updatePurchaseOrder(editPO.id, payload)
        if (err) throw err
      } else {
        const { data: poNo, error: rpcErr } = await procurementApi.generatePoNumber()
        if (rpcErr) payload.po_number = `PO-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`
        else payload.po_number = poNo
        const { error: err } = await procurementApi.insertPurchaseOrder(payload)
        if (err) throw err
      }

      await load()
      setShowForm(false)
    } catch (e) {
      alert(t('procurement.alerts.saveFailed', { message: toUserMessage(e) }))
    } finally {
      setSaving(false)
    }
  }

  // ── Status quick-update ────────────────────────────────────────────────────
  async function updateStatus(po, newStatus) {
    // Block manual status changes on the PO that is currently under approval —
    // its lifecycle is driven by the workflow engine.
    if (viewPO?.id === po.id && poLocked) { alert('Locked, in approval'); return }
    const patch = { status: newStatus }
    if (newStatus === 'Delivered') patch.actual_delivery = new Date().toISOString().slice(0, 10)
    const { error: err } = await procurementApi.updatePurchaseOrder(po.id, patch)
    if (err) { alert(t('procurement.alerts.updateFailed', { message: toUserMessage(err) })); return }
    await load()
    if (viewPO?.id === po.id) setViewPO(v => ({ ...v, ...patch }))
  }

  // ── Budget save ────────────────────────────────────────────────────────────
  async function saveBudget() {
    const val = parseFloat(budgetInput)
    if (!isNaN(val) && val >= 0) {
      setBudgetError('')
      const prev = budget
      setBudget(val)
      const { error: err } = await procurementApi.upsertSetting(BUDGET_KEY, JSON.stringify(val))
      if (err) {
        setBudget(prev)
        setBudgetError(t('procurement.budgetPanel.saveError', { message: toUserMessage(err) }))
      }
    }
    setEditBudget(false)
    setBudgetInput('')
  }

  // ── PDF export ─────────────────────────────────────────────────────────────
  async function exportPDF(po) {
    const { default: jsPDF } = await import('jspdf')
    const autoTable = await loadAutoTable()
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    pdfHeader(doc, 'Purchase Order', `${po.po_number} | ${po.status} | Priority: ${po.priority}`, company, brand)

    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 30,
      head: [['Field', 'Value', 'Field', 'Value']],
      body: [
        ['PO Number',        po.po_number,                  'Vendor',        po.vendor_name],
        ['Order Date',       fmtDate(po.order_date),         'Expected Del.', fmtDate(po.expected_delivery)],
        ['Actual Delivery',  fmtDate(po.actual_delivery),    'Priority',      po.priority],
        ['Requested By',     po.requested_by || 'N/A',         'Approved By',   po.approved_by || 'N/A'],
        ['Site',             po.site || 'N/A',                 'Budget Code',   po.budget_code || 'N/A'],
      ],
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 38 }, 2: { fontStyle: 'bold', cellWidth: 38 } },
      margin: { left: 14, right: 14 },
    })

    let y = (doc.lastAutoTable?.finalY || 80) + 8
    if ((po.items || []).length > 0) {
      autoTable(doc, {
        ...pdfTableTheme(brand.accent),
        startY: y,
        head: [['Brand', 'Size', 'Qty', 'Unit Price', 'Line Total', 'Received']],
        body: (po.items || []).map(it => [
          it.brand, it.size,
          it.quantity,
          fmtCur(it.unit_price),
          fmtCur(calcItemTotal(it)),
          it.received_qty ?? 0,
        ]),
        foot: [
          ['', '', '', 'Subtotal', fmtCur(po.subtotal), ''],
          ['', '', '', `Tax (${Math.round(po.tax_amount / Math.max(po.subtotal, 0.01) * 100)}%)`, fmtCur(po.tax_amount), ''],
          ['', '', '', 'TOTAL', fmtCur(po.total_amount), ''],
        ],
        footStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold' },
        margin: { left: 14, right: 14 },
      })
      y = (doc.lastAutoTable?.finalY || y) + 8
    }

    if (po.notes) {
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 41, 59)
      doc.text('Notes', 14, y + 4)
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(75, 85, 99)
      const lines = doc.splitTextToSize(po.notes, 182)
      doc.text(lines, 14, y + 10)
    }

    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }
    doc.save(`${po.po_number}.pdf`)
  }

  // ── Excel export ───────────────────────────────────────────────────────────
  async function exportExcel() {
    const XLSX = await import('xlsx')
    const rows = orderExportRows(filtered)
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Purchase Orders')
    XLSX.writeFile(wb, `purchase-orders-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  // ── Register columns (EnterpriseTable) ────────────────────────────────────
  const iconBtn = 'min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500'
  const poColumns = [
    { accessorKey: 'po_number', header: t('procurement.table.columns.poNumber'), cell: ({ getValue }) => <span className="text-orange-400 font-mono text-xs font-semibold">{getValue() || 'N/A'}</span> },
    { accessorKey: 'vendor_name', header: t('procurement.table.columns.vendor'), cell: ({ getValue }) => <span className="text-[var(--text-primary)] font-medium">{getValue() || 'N/A'}</span> },
    { accessorKey: 'order_date', header: t('procurement.table.columns.orderDate'), cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue() ? fmtDate(getValue()) : 'N/A'}</span> },
    { accessorKey: 'expected_delivery', header: t('procurement.table.columns.expDelivery'), cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue() ? fmtDate(getValue()) : 'N/A'}</span> },
    { accessorKey: 'status', header: t('procurement.table.columns.status'), cell: ({ getValue }) => <StatusBadge status={getValue()} /> },
    {
      accessorKey: 'priority', header: t('procurement.table.columns.priority'),
      cell: ({ getValue }) => {
        const pc = PRIORITY_CONFIG[getValue()] || PRIORITY_CONFIG.Normal
        return <span className={`flex items-center gap-1.5 ${pc.color} text-xs`}><span className={`w-2 h-2 rounded-full ${pc.dot}`} aria-hidden="true" />{getValue() || 'Normal'}</span>
      },
    },
    {
      id: 'items', header: t('procurement.table.columns.items'), accessorFn: (po) => (po.items || []).length, meta: { align: 'right' },
      cell: ({ row }) => {
        const r = receiptProgress(row.original.items)
        return <span title={r.pct == null ? undefined : `${Math.round(r.pct)}% received`}>{(row.original.items || []).length}</span>
      },
    },
    { accessorKey: 'total_amount', header: `${t('procurement.table.columns.total')} (${activeCurrency})`, meta: { align: 'right' }, cell: ({ getValue }) => <span className="text-green-400 font-medium whitespace-nowrap">{getValue() == null ? 'N/A' : fmtCur(getValue())}</span> },
    { accessorKey: 'site', header: t('procurement.table.columns.site'), cell: ({ getValue }) => getValue() || 'N/A' },
    {
      id: 'actions', header: t('procurement.table.columns.actions'), enableSorting: false, meta: { export: false },
      cell: ({ row }) => {
        const po = row.original
        return (
          <div className="flex items-center gap-1">
            <button type="button" onClick={(e) => { e.stopPropagation(); setViewPO(po) }} className={iconBtn} aria-label={`${t('procurement.table.viewTooltip')} ${po.po_number || ''}`.trim()}><Eye size={14} /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); openEdit(po) }} className={iconBtn} aria-label={`${t('procurement.table.editTooltip')} ${po.po_number || ''}`.trim()}><Edit2 size={14} /></button>
            <button type="button" onClick={(e) => { e.stopPropagation(); exportPDF(po) }} className={iconBtn} aria-label={`${t('procurement.table.pdfTooltip')} ${po.po_number || ''}`.trim()}><FileText size={14} /></button>
          </div>
        )
      },
    },
  ]

  const lineItemColumns = [
    { accessorKey: 'brand', header: t('procurement.modal.columns.brand') },
    { accessorKey: 'size', header: t('procurement.modal.columns.size') },
    { accessorKey: 'quantity', header: t('procurement.modal.columns.qty'), meta: { align: 'right' } },
    { accessorKey: 'unit_price', header: t('procurement.modal.columns.unitPrice'), meta: { align: 'right' }, cell: ({ getValue }) => fmtCur(getValue()) },
    { id: 'line_total', header: t('procurement.modal.columns.lineTotal'), accessorFn: (it) => calcItemTotal(it), meta: { align: 'right' }, cell: ({ getValue }) => <span className="text-green-400 font-medium">{fmtCur(getValue())}</span> },
    {
      id: 'remove', header: '', enableSorting: false, meta: { export: false },
      cell: ({ row }) => (
        <button type="button" onClick={() => removeItem(row.index)} aria-label={`Remove line ${row.index + 1}`} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-red-500 hover:text-red-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500 rounded-lg"><X size={14} /></button>
      ),
    },
  ]

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--surface-0)]">
        <div className="text-center">
          <Loader2 className="animate-spin text-orange-400 mx-auto mb-3" size={40} />
          <p className="text-[var(--text-secondary)]">{t('procurement.loading')}</p>
        </div>
      </div>
    )
  }

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('procurement.title')}
        subtitle={t('procurement.subtitle', { count: orders.length })}
        icon={ShoppingCart}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={load} aria-label={t('procurement.refresh')} className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border-bright)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors" title={t('procurement.refresh')}>
              <RefreshCw size={16} />
            </button>
            <button onClick={exportExcel} className="flex items-center gap-2 px-4 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm rounded-lg transition-colors">
              <FileSpreadsheet size={16} />{t('procurement.actions.excel')}
            </button>
            <button onClick={openNew} className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold rounded-lg transition-colors">
              <Plus size={16} />{t('procurement.actions.newPo')}
            </button>
          </div>
        }
      />

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 flex items-center gap-3 text-red-300">
          <AlertTriangle size={18} />
          <span className="text-sm">{error}</span>
          <button type="button" onClick={load} className="ml-auto min-h-[44px] px-3 rounded-lg border border-red-700 text-sm hover:bg-red-900/40">Retry</button>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error" className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg hover:bg-red-900/40"><X size={16} /></button>
        </div>
      )}

      {/* ── KPI Cards ──────────────────────────────────────────────────────── */}
      {/* The filter bar sits BELOW these tiles, so when it is on the tiles must
          say which set they cover or they read as whole-register figures. */}
      {scopeActive && (
        <p className="text-[var(--text-muted)] text-xs">
          {t('procurement.kpi.scopeNote', { count: filtered.length, total: orders.length })}
          {statusFilter !== 'All' ? ` ${t('procurement.kpi.scopeNoteStatus')}` : ''}
        </p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          {
            label: t('procurement.kpi.totalPos'),
            value: kpis.totalPOs,
            suffix: '',
            color: 'orange',
            icon: ShoppingCart,
            sub: scopeActive
              ? t('procurement.kpi.totalPosSubFiltered', { count: filtered.length })
              : t('procurement.kpi.totalPosSub', { count: orders.length }),
          },
          {
            label: t('procurement.kpi.totalSpend'),
            value: kpis.spend >= 1_000_000
              ? `${activeCurrency} ${(kpis.spend / 1_000_000).toFixed(2)}M`
              : `${activeCurrency} ${(kpis.spend / 1000).toFixed(1)}k`,
            suffix: '',
            color: 'green',
            icon: DollarSign,
            sub: t('procurement.kpi.totalSpendSub'),
          },
          {
            label: t('procurement.kpi.pendingDelivery'),
            value: kpis.pendingDelivery,
            suffix: '',
            color: 'yellow',
            icon: Truck,
            sub: t('procurement.kpi.pendingDeliverySub', { value: `${activeCurrency} ${(kpis.pendingValue / 1000).toFixed(1)}k` }),
          },
          {
            label: t('procurement.kpi.budgetUsed'),
            value: budgetScope.variance != null ? `${budgetScope.variance.toFixed(1)}%` : 'N/A',
            suffix: '',
            color: budgetScope.variance > 100 ? 'red' : budgetScope.variance > 80 ? 'yellow' : 'teal',
            icon: BarChart2,
            sub: budget > 0
              ? (scopeActive
                ? t('procurement.kpi.budgetUsedSubAll', { value: `${activeCurrency} ${(budget / 1000).toFixed(0)}k` })
                : t('procurement.kpi.budgetUsedSub', { value: `${activeCurrency} ${(budget / 1000).toFixed(0)}k` }))
              : t('procurement.kpi.setBudgetBelow'),
          },
          {
            label: t('procurement.kpi.avgLeadTime'),
            value: kpis.avgLeadTime !== null ? `${kpis.avgLeadTime}d` : 'N/A',
            suffix: '',
            color: 'purple',
            icon: Clock,
            sub: t('procurement.kpi.avgLeadTimeSub'),
          },
        ].map(({ label, value, color, icon: Icon, sub }) => (
          <motion.div
            key={label}
            className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-4"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Icon size={16} className={kpiText(color)} />
              <span className="text-[var(--text-secondary)] text-xs">{label}</span>
            </div>
            <div className={`text-2xl font-bold ${kpiText(color)}`}>{value}</div>
            {sub && <p className="text-[var(--text-muted)] text-xs mt-1">{sub}</p>}
          </motion.div>
        ))}
      </div>

      {/* ── Charts ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly spend by vendor */}
        <div className="lg:col-span-2 bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-5">
          <h3 className="text-[var(--text-primary)] font-semibold mb-4">{t('procurement.charts.vendorSpendTitle')}</h3>
          <div className="h-56">
            {vendorBarData.datasets.length > 0
              ? <Bar data={vendorBarData} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { position: 'top', labels: { color: 'var(--text-muted)', boxWidth: 12, font: { size: 10 } } } } }} />
              : <div className="h-full flex items-center justify-center text-[var(--text-dim)] text-sm">{t('procurement.charts.noDeliveredOrders')}</div>
            }
          </div>
        </div>

        {/* Status doughnut */}
        <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-5">
          <h3 className="text-[var(--text-primary)] font-semibold mb-4">{t('procurement.charts.ordersByStatus')}</h3>
          <div className="h-56">
            {statusChartBase.length > 0
              ? <Doughnut data={statusDoughnutData} options={{ ...CHART_OPTS, scales: undefined, plugins: { ...CHART_OPTS.plugins, legend: { position: 'right', labels: { color: 'var(--text-muted)', boxWidth: 10, font: { size: 10 } } } } }} />
              : <div className="h-full flex items-center justify-center text-[var(--text-dim)] text-sm">{t('procurement.charts.noOrders')}</div>
            }
          </div>
        </div>
      </div>

      {/* ── Budget vs Actual Panel ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Budget panel */}
        <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[var(--text-primary)] font-semibold">{t('procurement.budgetPanel.title')}</h3>
            <button
              onClick={() => { setEditBudget(!editBudget); setBudgetInput(budget > 0 ? budget.toString() : '') }}
              className="text-xs text-orange-400 hover:text-orange-300 px-2 py-1 rounded border border-orange-700/50 hover:border-orange-500 transition-colors"
            >
              {editBudget ? t('procurement.budgetPanel.cancel') : t('procurement.budgetPanel.setBudget')}
            </button>
          </div>

          {editBudget && (
            <div className="flex gap-2 mb-4">
              <input
                type="number" min="0" step="1000"
                value={budgetInput}
                onChange={e => setBudgetInput(e.target.value)}
                placeholder={t('procurement.budgetPanel.placeholder', { currency: activeCurrency })}
                className="flex-1 px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500"
                onKeyDown={e => e.key === 'Enter' && saveBudget()}
              />
              <button onClick={saveBudget} className="px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm rounded-lg transition-colors">
                {t('procurement.budgetPanel.save')}
              </button>
            </div>
          )}
          {budgetError && (
            <p className="text-sm text-red-300 bg-red-900/30 border border-red-700 rounded-lg p-2.5 mb-4">{budgetError}</p>
          )}

          {scopeActive && (
            <p className="text-[var(--text-muted)] text-xs mb-3">{t('procurement.budgetPanel.scopeNote')}</p>
          )}

          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-[var(--text-secondary)]">{t('procurement.budgetPanel.annualBudget')}</span>
              <span className="text-[var(--text-primary)] font-medium">{budget > 0 ? fmtCur(budget) : t('procurement.budgetPanel.notSet')}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[var(--text-secondary)]">{t('procurement.budgetPanel.totalSpend')}</span>
              <span className="text-green-400 font-medium">{fmtCur(budgetScope.spend)}</span>
            </div>
            {budget > 0 && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-secondary)]">{t('procurement.budgetPanel.remaining')}</span>
                  <span className={`font-medium ${budget - budgetScope.spend < 0 ? 'text-red-400' : 'text-teal-400'}`}>
                    {fmtCur(budget - budgetScope.spend)}
                  </span>
                </div>
                {/* Gauge */}
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
                    <span>0</span>
                    <span className={budgetScope.variance > 100 ? 'text-red-400 font-semibold' : 'text-[var(--text-secondary)]'}>
                      {budgetScope.variance?.toFixed(1)}%
                    </span>
                    <span>{fmtCur(budget)}</span>
                  </div>
                  <div className="h-3 bg-[var(--surface-2)] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        budgetScope.variance > 100 ? 'bg-red-500' :
                        budgetScope.variance > 80  ? 'bg-yellow-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${Math.min(100, budgetScope.variance || 0)}%` }}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Cumulative line chart */}
        <div className="lg:col-span-2 bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-5">
          <h3 className="text-[var(--text-primary)] font-semibold mb-4">{t('procurement.charts.cumulativeTitle', { year: new Date().getFullYear() })}</h3>
          <div className="h-52">
            <Line data={cumulativeLineData} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { position: 'top', labels: { color: 'var(--text-muted)', boxWidth: 12, font: { size: 11 } } } } }} />
          </div>
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              aria-label={t('procurement.filters.searchPlaceholder')}
              value={search}
              onChange={e => { setSearch(e.target.value)}}
              placeholder={t('procurement.filters.searchPlaceholder')}
              className="w-full pl-9 pr-4 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm placeholder-[var(--text-muted)] focus:outline-none focus:border-orange-500"
            />
          </div>
          <select aria-label="Status" value={statusFilter} onChange={e => { setStatus(e.target.value)}}
            className="px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500">
            <option value="All">{t('procurement.filters.allStatuses')}</option>
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
          <select aria-label="Vendor" value={vendorFilter} onChange={e => { setVendor(e.target.value)}}
            className="px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500">
            {vendors.map(v => <option key={v}>{v === 'All' ? t('procurement.filters.allVendors') : v}</option>)}
          </select>
          <select aria-label="Site" value={siteFilter} onChange={e => { setSite(e.target.value)}}
            className="px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500">
            {sites.map(s => <option key={s}>{s === 'All' ? t('procurement.filters.allSites') : s}</option>)}
          </select>
          <input type="date" aria-label="Order date from" value={dateFrom} onChange={e => { setDateFrom(e.target.value)}}
            className="px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
          <input type="date" aria-label="Order date to" value={dateTo} onChange={e => { setDateTo(e.target.value)}}
            className="px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
          {(search || statusFilter !== 'All' || vendorFilter !== 'All' || siteFilter !== 'All' || dateFrom || dateTo) && (
            <button onClick={() => { setSearch(''); setStatus('All'); setVendor('All'); setSite('All'); setDateFrom(''); setDateTo('')}}
              className="px-3 py-2 bg-red-900/30 border border-red-700 rounded-lg text-red-400 text-sm hover:bg-red-900/50 transition-colors">
              {t('procurement.filters.clear')}
            </button>
          )}
          <span className="ml-auto self-center text-[var(--text-secondary)] text-sm">{t('procurement.filters.resultsCount', { count: filtered.length })}</span>
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <EnterpriseTable
        columns={poColumns}
        data={filtered}
        getRowId={(po) => String(po.id)}
        error={orders.length === 0 ? error : null}
        onRetry={load}
        enableGlobalFilter={false}
        enableExport={false}
        emptyMessage={orders.length === 0 ? t('procurement.table.emptyTitle') : 'No purchase orders match these filters.'}
        onRowClick={(po) => setViewPO(po)}
        viewKey="procurement-orders"
        toolbarExtras={orders.length === 0 ? (
          <button type="button" onClick={openNew} className="min-h-[44px] px-3 text-orange-400 hover:text-orange-300 text-sm">{t('procurement.table.createFirst')}</button>
        ) : null}
      />

      {/* ══════════════════════════════════════════════════════════════════════
          CREATE / EDIT MODAL
      ══════════════════════════════════════════════════════════════════════ */}
      <Modal
        open={showForm}
        onClose={saving ? undefined : () => setShowForm(false)}
        size="xl"
        title={(
          <span className="flex items-center gap-3">
            <ShoppingCart size={18} className="text-orange-400" />
            {editPO ? t('procurement.modal.editTitle', { poNumber: editPO.po_number }) : t('procurement.modal.newTitle')}
          </span>
        )}
        footer={(
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            <div className="text-[var(--text-secondary)] text-sm">
              {t('procurement.modal.totalLabel')} <span className="text-green-400 font-bold text-base">{fmtCur(formTotal)}</span>
              {formData.items.length > 0 && <span className="text-[var(--text-muted)] ml-2">{t('procurement.modal.itemsCount', { count: formData.items.length })}</span>}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowForm(false)} disabled={saving} className="px-4 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm rounded-lg transition-colors disabled:opacity-50">
                {t('procurement.modal.cancel')}
              </button>
              <button onClick={handleSave} disabled={saving || (editPO && poLocked)}
                title={editPO && poLocked ? 'Locked, in approval' : undefined}
                className="flex items-center gap-2 px-5 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                {saving ? t('procurement.modal.saving') : editPO ? t('procurement.modal.saveChanges') : t('procurement.modal.createPo')}
              </button>
            </div>
          </div>
        )}
      >
              <div className="space-y-5">
                {/* Row 1: Vendor + Order Date */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="po-field" className="text-[var(--text-secondary)] text-xs mb-1 block">{t('procurement.modal.vendorName')}</label>
                    <input id="po-field" value={formData.vendor_name} onChange={e => setFormData(f => ({ ...f, vendor_name: e.target.value }))}
                      placeholder={t('procurement.modal.vendorNamePlaceholder')} className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
                  </div>
                  <div>
                    <label htmlFor="po-field-2" className="text-[var(--text-secondary)] text-xs mb-1 block">{t('procurement.modal.orderDate')}</label>
                    <input id="po-field-2" type="date" value={formData.order_date} onChange={e => setFormData(f => ({ ...f, order_date: e.target.value }))}
                      className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
                  </div>
                </div>

                {/* Row 2: Expected Del + Status */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="po-field-3" className="text-[var(--text-secondary)] text-xs mb-1 block">{t('procurement.modal.expectedDelivery')}</label>
                    <input id="po-field-3" type="date" value={formData.expected_delivery} onChange={e => setFormData(f => ({ ...f, expected_delivery: e.target.value }))}
                      className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
                  </div>
                  <div>
                    <label htmlFor="po-field-4" className="text-[var(--text-secondary)] text-xs mb-1 block">{t('procurement.modal.priority')}</label>
                    <select id="po-field-4" value={formData.priority} onChange={e => setFormData(f => ({ ...f, priority: e.target.value }))}
                      className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500">
                      {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="po-field-5" className="text-[var(--text-secondary)] text-xs mb-1 block">{t('procurement.modal.status')}</label>
                    <select id="po-field-5" value={formData.status} onChange={e => setFormData(f => ({ ...f, status: e.target.value }))}
                      className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500">
                      {STATUSES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                {/* Row 3: Site + Country + Budget Code */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label htmlFor="po-field-6" className="text-[var(--text-secondary)] text-xs mb-1 block">{t('procurement.modal.site')}</label>
                    <input id="po-field-6" value={formData.site} onChange={e => setFormData(f => ({ ...f, site: e.target.value }))}
                      placeholder={t('procurement.modal.sitePlaceholder')} className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
                  </div>
                  <div>
                    <label htmlFor="po-field-7" className="text-[var(--text-secondary)] text-xs mb-1 block">{t('procurement.modal.country')}</label>
                    <input id="po-field-7" value={formData.country} onChange={e => setFormData(f => ({ ...f, country: e.target.value }))}
                      placeholder={t('procurement.modal.countryPlaceholder')} className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
                  </div>
                  <div>
                    <label htmlFor="po-field-8" className="text-[var(--text-secondary)] text-xs mb-1 block">{t('procurement.modal.budgetCode')}</label>
                    <input id="po-field-8" value={formData.budget_code} onChange={e => setFormData(f => ({ ...f, budget_code: e.target.value }))}
                      placeholder={t('procurement.modal.budgetCodePlaceholder')} className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
                  </div>
                </div>

                {/* Row 4: Requested By + Approved By */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="po-field-9" className="text-[var(--text-secondary)] text-xs mb-1 block">{t('procurement.modal.requestedBy')}</label>
                    <input id="po-field-9" value={formData.requested_by} onChange={e => setFormData(f => ({ ...f, requested_by: e.target.value }))}
                      placeholder={t('procurement.modal.namePlaceholder')} className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
                  </div>
                  <div>
                    <label htmlFor="po-field-10" className="text-[var(--text-secondary)] text-xs mb-1 block">{t('procurement.modal.approvedBy')}</label>
                    <input id="po-field-10" value={formData.approved_by} onChange={e => setFormData(f => ({ ...f, approved_by: e.target.value }))}
                      placeholder={t('procurement.modal.namePlaceholder')} className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
                  </div>
                </div>

                {/* Line items */}
                <div>
                  <label className="text-[var(--text-secondary)] text-xs mb-2 block font-medium uppercase tracking-wide">{t('procurement.modal.lineItems')}</label>

                  {/* Existing items */}
                  {formData.items.length > 0 && (
                    <div className="mb-3 rounded-lg overflow-hidden border border-[var(--border-bright)]">
                      <EnterpriseTable
                        columns={lineItemColumns}
                        data={formData.items}
                        getRowId={(_, idx) => String(idx)}
                        enableGlobalFilter={false}
                        enableColumnFilters={false}
                        enableColumnVisibility={false}
                        enableExport={false}
                        enableSorting={false}
                        pageSizeOptions={[25]}
                        emptyMessage="No line items yet."
                      />
                    </div>
                  )}

                  {/* Add item row */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
                    <input value={itemRow.brand} onChange={e => setItemRow(r => ({ ...r, brand: e.target.value }))}
                      placeholder={t('procurement.modal.brandPlaceholder')} aria-label={t('procurement.modal.brandPlaceholder')} className="px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
                    <input value={itemRow.size} onChange={e => setItemRow(r => ({ ...r, size: e.target.value }))}
                      placeholder={t('procurement.modal.sizePlaceholder')} aria-label={t('procurement.modal.sizePlaceholder')} className="px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
                    <input type="number" min="1" value={itemRow.quantity} onChange={e => setItemRow(r => ({ ...r, quantity: e.target.value }))}
                      placeholder={t('procurement.modal.qtyPlaceholder')} aria-label={t('procurement.modal.qtyPlaceholder')} className="px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
                    <input type="number" min="0" step="0.01" value={itemRow.unit_price} onChange={e => setItemRow(r => ({ ...r, unit_price: e.target.value }))}
                      placeholder={t('procurement.modal.unitPricePlaceholder')} aria-label={t('procurement.modal.unitPricePlaceholder')} className="px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500"
                      onKeyDown={e => e.key === 'Enter' && addItem()} />
                    <button onClick={addItem} className="px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-sm transition-colors flex items-center justify-center gap-1">
                      <Plus size={14} />{t('procurement.modal.add')}
                    </button>
                  </div>

                  {/* Totals */}
                  {formData.items.length > 0 && (
                    <div className="mt-3 bg-[var(--surface-2)] rounded-lg p-3 space-y-1.5">
                      <div className="flex justify-between text-sm">
                        <span className="text-[var(--text-secondary)]">{t('procurement.modal.subtotal')}</span>
                        <span className="text-[var(--text-primary)]">{fmtCur(formSubtotal)}</span>
                      </div>
                      <div className="flex justify-between items-center text-sm">
                        <span className="text-[var(--text-secondary)] flex items-center gap-2">
                          {t('procurement.modal.tax')}
                          <input type="number" min="0" max="100" aria-label="Tax percent" value={taxPct} onChange={e => setTaxPct(parseFloat(e.target.value) || 0)}
                            className="w-14 px-2 py-0.5 bg-[var(--surface-3)] border border-[var(--border-bright)] rounded text-[var(--text-primary)] text-xs focus:outline-none" />
                          %
                        </span>
                        <span className="text-[var(--text-primary)]">{fmtCur(formTax)}</span>
                      </div>
                      <div className="flex justify-between text-base font-semibold border-t border-[var(--border-bright)] pt-1.5 mt-1.5">
                        <span className="text-[var(--text-primary)]">{t('procurement.modal.total')}</span>
                        <span className="text-green-400">{fmtCur(formTotal)}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div>
                  <label htmlFor="po-field-11" className="text-[var(--text-secondary)] text-xs mb-1 block">{t('procurement.modal.notes')}</label>
                  <textarea id="po-field-11" value={formData.notes} onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))}
                    rows={3} placeholder={t('procurement.modal.notesPlaceholder')}
                    className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500 resize-none" />
                </div>
              </div>
      </Modal>

      {/* ══════════════════════════════════════════════════════════════════════
          DETAIL DRAWER
      ══════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {viewPO && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-stretch justify-end bg-black/60 backdrop-blur-sm"
            onClick={() => setViewPO(null)}>
            <motion.div
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="tp-drawer-panel w-full sm:w-[520px] h-full bg-[var(--surface-1)] border-l border-[var(--border-bright)] overflow-y-auto shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              {/* Drawer header */}
              <div className="sticky top-0 bg-[var(--surface-1)] border-b border-[var(--border-dim)] px-6 py-4 flex items-center justify-between z-10">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-[var(--text-primary)] font-bold text-base">{viewPO.po_number}</h2>
                    <StatusBadge status={viewPO.status} />
                  </div>
                  <p className="text-[var(--text-secondary)] text-sm mt-0.5">{viewPO.vendor_name}</p>
                </div>
                <button onClick={() => setViewPO(null)} className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors"><X size={18} /></button>
              </div>

              <div className="p-6 space-y-5">

                {/* Status timeline */}
                <div>
                  <p className="text-[var(--text-secondary)] text-xs mb-3 uppercase tracking-wide font-medium">{t('procurement.drawer.statusTimeline')}</p>
                  <div className="flex items-center gap-0">
                    {STATUS_TIMELINE.map((s, idx) => {
                      const currentIdx = STATUS_TIMELINE.indexOf(viewPO.status)
                      const isCurrent  = s === viewPO.status
                      const isPast     = idx < currentIdx
                      const isCancelled = viewPO.status === 'Cancelled'
                      return (
                        <div key={s} className="flex items-center flex-1">
                          <div className={`flex flex-col items-center min-w-0 flex-1 ${idx === 0 ? 'items-start' : idx === STATUS_TIMELINE.length - 1 ? 'items-end' : 'items-center'}`}>
                            <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                              isCancelled ? 'bg-red-500' :
                              isCurrent   ? 'bg-orange-400 ring-2 ring-orange-400/30' :
                              isPast      ? 'bg-green-500' :
                                            'bg-[var(--surface-3)]'
                            }`} />
                            <span className={`text-[10px] mt-1 leading-tight text-center ${
                              isCurrent ? 'text-orange-400 font-semibold' :
                              isPast    ? 'text-green-400' :
                                          'text-[var(--text-dim)]'
                            }`}>{s}</span>
                          </div>
                          {idx < STATUS_TIMELINE.length - 1 && (
                            <div className={`h-px flex-1 mx-1 ${isPast ? 'bg-green-600' : 'bg-[var(--surface-3)]'}`} />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Quick status transitions */}
                {!['Delivered','Closed','Cancelled'].includes(viewPO.status) && (() => {
                  const nextMap = {
                    'Draft':            ['Submitted','Cancelled'],
                    'Submitted':        ['Approved','Cancelled'],
                    'Approved':         ['Ordered','Cancelled'],
                    'Ordered':          ['Partial Delivery','Delivered','Cancelled'],
                    'Partial Delivery': ['Delivered','Cancelled'],
                  }
                  const next = nextMap[viewPO.status] || []
                  return next.length > 0 ? (
                    <div>
                      <p className="text-[var(--text-secondary)] text-xs mb-2">{t('procurement.drawer.quickActions')}</p>
                      <div className="flex flex-wrap gap-2">
                        {next.map(ns => (
                          <button key={ns} onClick={() => updateStatus(viewPO, ns)}
                            disabled={poLocked}
                            title={poLocked ? 'Locked, in approval' : undefined}
                            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                              ns === 'Cancelled'  ? 'border-red-700 text-red-400 hover:bg-red-900/30' :
                              ns === 'Delivered'  ? 'border-teal-700 text-teal-400 hover:bg-teal-900/30' :
                              ns === 'Approved'   ? 'border-green-700 text-green-400 hover:bg-green-900/30' :
                                                    'border-blue-700 text-blue-400 hover:bg-blue-900/30'
                            }`}>
                            {ns}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null
                })()}

                {/* PO details */}
                <div className="space-y-2">
                  {[
                    [t('procurement.drawer.fields.orderDate'),      fmtDate(viewPO.order_date)],
                    [t('procurement.drawer.fields.expDelivery'),    fmtDate(viewPO.expected_delivery)],
                    [t('procurement.drawer.fields.actualDelivery'), fmtDate(viewPO.actual_delivery)],
                    [t('procurement.drawer.fields.priority'),        viewPO.priority],
                    [t('procurement.drawer.fields.site'),            viewPO.site],
                    [t('procurement.drawer.fields.country'),         viewPO.country],
                    [t('procurement.drawer.fields.budgetCode'),     viewPO.budget_code],
                    [t('procurement.drawer.fields.requestedBy'),    viewPO.requested_by],
                    [t('procurement.drawer.fields.approvedBy'),     viewPO.approved_by],
                    [t('procurement.drawer.fields.leadTime'),       viewPO.actual_delivery ? t('procurement.drawer.fields.leadTimeDays', { days: daysBetween(viewPO.order_date, viewPO.actual_delivery) }) : null],
                  ].filter(([, v]) => v).map(([label, value]) => (
                    <div key={label} className="flex justify-between py-1.5 border-b border-[var(--border-dim)]">
                      <span className="text-[var(--text-secondary)] text-sm">{label}</span>
                      <span className="text-[var(--text-primary)] text-sm font-medium">{value}</span>
                    </div>
                  ))}
                </div>

                {/* Line items with received qty tracking */}
                {(viewPO.items || []).length > 0 && (
                  <div>
                    <p className="text-[var(--text-secondary)] text-xs mb-2 uppercase tracking-wide font-medium">{t('procurement.drawer.lineItemsTitle')}</p>
                    <div className="space-y-2">
                      {viewPO.items.map((it, idx) => {
                        const received = it.received_qty ?? 0
                        const pct      = Math.min(100, (received / Math.max(1, it.quantity)) * 100)
                        return (
                          <div key={idx} className="bg-[var(--surface-2)] rounded-xl p-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[var(--text-primary)] text-sm font-medium">{it.brand} - {it.size}</span>
                              <span className="text-green-400 text-sm font-semibold">{fmtCur(calcItemTotal(it))}</span>
                            </div>
                            <div className="flex items-center justify-between text-xs text-[var(--text-secondary)] mb-2">
                              <span>{t('procurement.drawer.unitsAtPrice', { qty: it.quantity, price: fmtCur(it.unit_price) })}</span>
                              <span className={received >= it.quantity ? 'text-green-400' : 'text-orange-400'}>
                                {t('procurement.drawer.receivedOf', { received, qty: it.quantity })}
                              </span>
                            </div>
                            <div className="h-1.5 bg-[var(--surface-3)] rounded-full overflow-hidden mb-2">
                              <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-green-500' : 'bg-orange-500'}`}
                                style={{ width: `${pct}%` }} />
                            </div>
                            {['Ordered','Partial Delivery'].includes(viewPO.status) && (
                              <div className="flex items-center gap-2">
                                <input type="number" min="0" max={it.quantity} defaultValue={received}
                                  disabled={poLocked}
                                  title={poLocked ? 'Locked, in approval' : undefined}
                                  className="w-20 px-2 py-1 bg-[var(--surface-3)] border border-[var(--border-bright)] rounded text-[var(--text-primary)] text-xs focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed"
                                  onBlur={e => updateItemReceivedQty(viewPO.id, idx, e.target.value)} />
                                <span className="text-[var(--text-muted)] text-xs">{t('procurement.drawer.markReceivedQty')}</span>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Cost summary */}
                <div className="bg-[var(--surface-2)] rounded-xl p-4 space-y-2">
                  <p className="text-[var(--text-secondary)] text-xs mb-2 uppercase tracking-wide font-medium">{t('procurement.drawer.costSummary')}</p>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--text-secondary)]">{t('procurement.drawer.subtotal')}</span>
                    <span className="text-[var(--text-primary)]">{fmtCur(viewPO.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--text-secondary)]">{t('procurement.drawer.tax')}</span>
                    <span className="text-[var(--text-primary)]">{fmtCur(viewPO.tax_amount)}</span>
                  </div>
                  <div className="flex justify-between text-base font-semibold border-t border-[var(--border-bright)] pt-2 mt-2">
                    <span className="text-[var(--text-primary)]">{t('procurement.drawer.total')}</span>
                    <span className="text-green-400 text-xl">{fmtCur(viewPO.total_amount)}</span>
                  </div>
                </div>

                {viewPO.notes && (
                  <div className="bg-[var(--surface-2)] rounded-xl p-4">
                    <p className="text-[var(--text-secondary)] text-xs mb-2">{t('procurement.drawer.notes')}</p>
                    <p className="text-[var(--text-secondary)] text-sm leading-relaxed">{viewPO.notes}</p>
                  </div>
                )}

                {/* Purchase approval — universal workflow engine. entity_type
                    'purchase_order'; context carries the cost/priority signals
                    the engine's threshold conditions route on (Finance/GM). The
                    panel drives poLocked via onStateChange to freeze edits. */}
                <EntityApprovalPanel
                  entityType="purchase_order"
                  entityId={viewPO.id}
                  entityLabel={viewPO.po_number || viewPO.id}
                  context={{
                    total_amount: Number(viewPO.total_amount) || 0,
                    status: viewPO.status,
                    priority: viewPO.priority,
                    supplier: viewPO.vendor_name,
                    item_count: (viewPO.items || []).length,
                  }}
                  title="Purchase Approval"
                  onStateChange={handleWfStateChange}
                />

                {poLocked && (
                  <div className="flex items-center gap-1.5 text-xs text-[var(--accent)]">
                    <Lock size={12} /> Locked, in approval
                  </div>
                )}

                {/* Goods Receipt (GRN) approval — the *receiving* step booked
                    against this PO, a distinct approval from the PO
                    authorization above. The engine keys instances by
                    (entity_type, entity_id), so goods_receipt coexists with
                    purchase_order on the same PO id. context.value (the received
                    PO value) drives the finance sign-off skip (< 10000). */}
                <EntityApprovalPanel
                  entityType="goods_receipt"
                  entityId={viewPO.id}
                  entityLabel={viewPO.po_number || viewPO.id}
                  context={{
                    value: Number(viewPO.total_amount) || 0,
                    country: viewPO.country ?? null,
                    site: viewPO.site ?? null,
                    po_no: viewPO.po_number ?? null,
                  }}
                  title="Goods Receipt (GRN)"
                  onStateChange={handleGrnStateChange}
                />

                {(grnState.isActive || grnState.isLocked) && (
                  <div className="flex items-center gap-1.5 text-xs text-[var(--accent)]">
                    <Package size={12} /> Goods receipt in approval
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <button onClick={() => { if (poLocked) return; const po = viewPO; setViewPO(null); openEdit(po) }}
                    disabled={poLocked}
                    title={poLocked ? 'Locked, in approval' : undefined}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-orange-600 hover:bg-orange-700 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-orange-600">
                    <Edit2 size={15} />{t('procurement.drawer.editPo')}
                  </button>
                  <button onClick={() => exportPDF(viewPO)}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-[var(--surface-3)] hover:bg-gray-600 text-[var(--text-primary)] text-sm font-medium rounded-xl transition-colors">
                    <FileText size={15} />{t('procurement.drawer.exportPdf')}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
