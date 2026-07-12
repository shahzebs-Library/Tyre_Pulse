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
import { useTenant } from '../contexts/TenantContext'
import { useLanguage } from '../contexts/LanguageContext'
import PageHeader from '../components/ui/PageHeader'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

// ── Constants ─────────────────────────────────────────────────────────────────
const STATUSES = ['Draft','Submitted','Approved','Ordered','Partial Delivery','Delivered','Cancelled','Closed']
const PRIORITIES = ['Urgent','High','Normal','Low']

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
const PAGE_SIZE = 20
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
function calcItemTotal(item) {
  return (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0)
}
function calcSubtotal(items) {
  return (items || []).reduce((s, it) => s + calcItemTotal(it), 0)
}
function daysBetween(a, b) {
  if (!a || !b) return null
  return Math.round((new Date(b) - new Date(a)) / 86400000)
}

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 } } },
    tooltip: { backgroundColor: 'var(--panel)', borderColor: 'var(--hairline)', borderWidth: 1, titleColor: '#f9fafb', bodyColor: '#d1d5db' },
  },
  scales: {
    x: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: '#1f2937' } },
    y: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: '#1f2937' } },
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
  const [sortField, setSortField]   = useState('order_date')
  const [sortDir, setSortDir]       = useState('desc')
  const [page, setPage]             = useState(1)

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
      setError(e.message)
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
  const vendors = useMemo(() => ['All', ...Array.from(new Set(orders.map(o => o.vendor_name).filter(Boolean))).sort()], [orders])
  const sites   = useMemo(() => ['All', ...Array.from(new Set(orders.map(o => o.site).filter(Boolean))).sort()], [orders])

  const filtered = useMemo(() => {
    let list = [...orders]
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(o =>
        o.po_number?.toLowerCase().includes(q) ||
        o.vendor_name?.toLowerCase().includes(q) ||
        o.site?.toLowerCase().includes(q) ||
        o.budget_code?.toLowerCase().includes(q) ||
        o.requested_by?.toLowerCase().includes(q)
      )
    }
    if (statusFilter !== 'All') list = list.filter(o => o.status === statusFilter)
    if (vendorFilter !== 'All') list = list.filter(o => o.vendor_name === vendorFilter)
    if (siteFilter !== 'All')   list = list.filter(o => o.site === siteFilter)
    if (dateFrom) list = list.filter(o => o.order_date >= dateFrom)
    if (dateTo)   list = list.filter(o => o.order_date <= dateTo)
    list.sort((a, b) => {
      const av = a[sortField] ?? '', bv = b[sortField] ?? ''
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })
    return list
  }, [orders, search, statusFilter, vendorFilter, siteFilter, dateFrom, dateTo, sortField, sortDir])

  const paginated = useMemo(() => {
    const s = (page - 1) * PAGE_SIZE
    return filtered.slice(s, s + PAGE_SIZE)
  }, [filtered, page])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const now = new Date()
    const yearStart = new Date(now.getFullYear(), 0, 1).toISOString().slice(0, 10)
    const thisPeriod = orders.filter(o => o.order_date >= yearStart)
    const totalPOs   = thisPeriod.length

    const spend = orders
      .filter(o => ['Delivered','Closed'].includes(o.status))
      .reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0)

    const pendingDelivery = orders.filter(o => ['Ordered','Partial Delivery'].includes(o.status)).length

    const pendingValue = orders
      .filter(o => ['Submitted','Approved','Ordered','Partial Delivery'].includes(o.status))
      .reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0)

    const delivered = orders.filter(o => o.actual_delivery && o.order_date)
    const avgLeadTime = delivered.length
      ? Math.round(delivered.reduce((s, o) => s + (daysBetween(o.order_date, o.actual_delivery) || 0), 0) / delivered.length)
      : null

    const budgetVariance = budget > 0 ? ((spend / budget) * 100) : null

    return { totalPOs, spend, pendingDelivery, pendingValue, avgLeadTime, budgetVariance }
  }, [orders, budget])

  // ── Chart: monthly spend by vendor (top 5) ─────────────────────────────────
  const vendorBarData = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(); d.setMonth(d.getMonth() - 5 + i)
      return d.toISOString().slice(0, 7)
    })
    const vendorTotals = {}
    orders.forEach(o => {
      if (!['Delivered','Closed'].includes(o.status)) return
      vendorTotals[o.vendor_name] = (vendorTotals[o.vendor_name] || 0) + (parseFloat(o.total_amount) || 0)
    })
    const top5 = Object.entries(vendorTotals).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k)
    const colors = ['#3b82f6','#10b981','#f59e0b','#8b5cf6','#06b6d4']
    return {
      labels: months.map(m => {
        const [y, mo] = m.split('-')
        return formatMonthYear(new Date(parseInt(y), parseInt(mo) - 1))
      }),
      datasets: top5.map((vendor, idx) => ({
        label: vendor,
        data: months.map(month => {
          return orders
            .filter(o => o.vendor_name === vendor && o.order_date?.startsWith(month) && ['Delivered','Closed'].includes(o.status))
            .reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0)
        }),
        backgroundColor: colors[idx] + 'cc',
        borderColor: colors[idx],
        borderWidth: 1,
      })),
    }
  }, [orders])

  // ── Chart: POs by status (doughnut) ───────────────────────────────────────
  const statusDoughnutData = useMemo(() => {
    const colorMap = {
      Draft: '#6b7280', Submitted: '#3b82f6', Approved: '#10b981',
      Ordered: '#f59e0b', 'Partial Delivery': '#f97316',
      Delivered: '#14b8a6', Cancelled: '#ef4444', Closed: '#a855f7',
    }
    const counts = {}
    orders.forEach(o => { counts[o.status] = (counts[o.status] || 0) + 1 })
    const entries = Object.entries(counts).filter(([, v]) => v > 0)
    return {
      labels: entries.map(([k]) => k),
      datasets: [{
        data: entries.map(([, v]) => v),
        backgroundColor: entries.map(([k]) => colorMap[k] || '#6b7280'),
        borderColor: 'var(--panel-2)',
        borderWidth: 2,
      }],
    }
  }, [orders])

  // ── Chart: cumulative spend vs budget (line) ───────────────────────────────
  const cumulativeLineData = useMemo(() => {
    const year = new Date().getFullYear().toString()
    const months = Array.from({ length: 12 }, (_, i) =>
      `${year}-${String(i + 1).padStart(2, '0')}`
    )
    let cumSpend = 0
    const spendPoints = months.map(m => {
      const mo = orders
        .filter(o => o.order_date?.startsWith(m) && ['Delivered','Closed'].includes(o.status))
        .reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0)
      cumSpend += mo
      return cumSpend
    })
    const budgetPerMonth = budget > 0 ? budget / 12 : 0
    let cumBudget = 0
    const budgetPoints = months.map(() => {
      cumBudget += budgetPerMonth
      return cumBudget
    })
    return {
      labels: months.map(m => {
        const [y, mo] = m.split('-')
        return formatMonth(new Date(parseInt(y), parseInt(mo) - 1))
      }),
      datasets: [
        {
          label: t('procurement.charts.actualSpendLabel'),
          data: spendPoints,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16,185,129,0.1)',
          tension: 0.4,
          fill: true,
          pointRadius: 3,
        },
        ...(budget > 0 ? [{
          label: t('procurement.charts.budgetLabel'),
          data: budgetPoints,
          borderColor: '#f59e0b',
          backgroundColor: 'transparent',
          borderDash: [5, 5],
          tension: 0,
          pointRadius: 0,
        }] : []),
      ],
    }
  }, [orders, budget, t])

  // ── Sort helper ────────────────────────────────────────────────────────────
  function handleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }
  function SortIcon({ field }) {
    if (sortField !== field) return <ChevronDown size={13} className="text-[var(--text-dim)]" />
    return sortDir === 'asc'
      ? <ChevronUp size={13} className="text-blue-400" />
      : <ChevronDown size={13} className="text-blue-400" />
  }

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
      if (err) { alert(t('procurement.alerts.updateFailed', { message: err.message })); return }
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
      alert(t('procurement.alerts.saveFailed', { message: e.message }))
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
    if (err) { alert(t('procurement.alerts.updateFailed', { message: err.message })); return }
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
        setBudgetError(t('procurement.budgetPanel.saveError', { message: err.message }))
      }
    }
    setEditBudget(false)
    setBudgetInput('')
  }

  // ── PDF export ─────────────────────────────────────────────────────────────
  async function exportPDF(po) {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    pdfHeader(doc, 'Purchase Order', `${po.po_number}  ·  ${po.status}  ·  Priority: ${po.priority}`, company, brand)

    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 30,
      head: [['Field', 'Value', 'Field', 'Value']],
      body: [
        ['PO Number',        po.po_number,                  'Vendor',        po.vendor_name],
        ['Order Date',       fmtDate(po.order_date),         'Expected Del.', fmtDate(po.expected_delivery)],
        ['Actual Delivery',  fmtDate(po.actual_delivery),    'Priority',      po.priority],
        ['Requested By',     po.requested_by || '-',         'Approved By',   po.approved_by || '-'],
        ['Site',             po.site || '-',                 'Budget Code',   po.budget_code || '-'],
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
    const rows = filtered.map(po => ({
      'PO Number':       po.po_number,
      'Vendor':          po.vendor_name,
      'Order Date':      fmtDate(po.order_date),
      'Exp. Delivery':   fmtDate(po.expected_delivery),
      'Actual Delivery': fmtDate(po.actual_delivery),
      'Status':          po.status,
      'Priority':        po.priority,
      'Items Count':     (po.items || []).length,
      'Subtotal':        po.subtotal || 0,
      'Tax':             po.tax_amount || 0,
      'Total Amount':    po.total_amount || 0,
      'Site':            po.site || '',
      'Budget Code':     po.budget_code || '',
      'Requested By':    po.requested_by || '',
      'Approved By':     po.approved_by || '',
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Purchase Orders')
    XLSX.writeFile(wb, `purchase-orders-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

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
            <button onClick={load} className="p-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border-bright)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors" title={t('procurement.refresh')}>
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
          <button onClick={() => setError(null)} className="ml-auto"><X size={16} /></button>
        </div>
      )}

      {/* ── KPI Cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          {
            label: t('procurement.kpi.totalPos'),
            value: kpis.totalPOs,
            suffix: '',
            color: 'orange',
            icon: ShoppingCart,
            sub: t('procurement.kpi.totalPosSub', { count: orders.length }),
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
            value: budget > 0 ? `${kpis.budgetVariance?.toFixed(1)}%` : '-',
            suffix: '',
            color: kpis.budgetVariance > 100 ? 'red' : kpis.budgetVariance > 80 ? 'yellow' : 'teal',
            icon: BarChart2,
            sub: budget > 0 ? t('procurement.kpi.budgetUsedSub', { value: `${activeCurrency} ${(budget / 1000).toFixed(0)}k` }) : t('procurement.kpi.setBudgetBelow'),
          },
          {
            label: t('procurement.kpi.avgLeadTime'),
            value: kpis.avgLeadTime !== null ? `${kpis.avgLeadTime}d` : '-',
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
              ? <Bar data={vendorBarData} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { position: 'top', labels: { color: '#9ca3af', boxWidth: 12, font: { size: 10 } } } } }} />
              : <div className="h-full flex items-center justify-center text-[var(--text-dim)] text-sm">{t('procurement.charts.noDeliveredOrders')}</div>
            }
          </div>
        </div>

        {/* Status doughnut */}
        <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-5">
          <h3 className="text-[var(--text-primary)] font-semibold mb-4">{t('procurement.charts.ordersByStatus')}</h3>
          <div className="h-56">
            {orders.length > 0
              ? <Doughnut data={statusDoughnutData} options={{ ...CHART_OPTS, scales: undefined, plugins: { ...CHART_OPTS.plugins, legend: { position: 'right', labels: { color: '#9ca3af', boxWidth: 10, font: { size: 10 } } } } }} />
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

          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-[var(--text-secondary)]">{t('procurement.budgetPanel.annualBudget')}</span>
              <span className="text-[var(--text-primary)] font-medium">{budget > 0 ? fmtCur(budget) : t('procurement.budgetPanel.notSet')}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-[var(--text-secondary)]">{t('procurement.budgetPanel.totalSpend')}</span>
              <span className="text-green-400 font-medium">{fmtCur(kpis.spend)}</span>
            </div>
            {budget > 0 && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--text-secondary)]">{t('procurement.budgetPanel.remaining')}</span>
                  <span className={`font-medium ${budget - kpis.spend < 0 ? 'text-red-400' : 'text-teal-400'}`}>
                    {fmtCur(budget - kpis.spend)}
                  </span>
                </div>
                {/* Gauge */}
                <div className="mt-3">
                  <div className="flex justify-between text-xs text-[var(--text-muted)] mb-1">
                    <span>0</span>
                    <span className={kpis.budgetVariance > 100 ? 'text-red-400 font-semibold' : 'text-[var(--text-secondary)]'}>
                      {kpis.budgetVariance?.toFixed(1)}%
                    </span>
                    <span>{fmtCur(budget)}</span>
                  </div>
                  <div className="h-3 bg-[var(--surface-2)] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${
                        kpis.budgetVariance > 100 ? 'bg-red-500' :
                        kpis.budgetVariance > 80  ? 'bg-yellow-500' : 'bg-green-500'
                      }`}
                      style={{ width: `${Math.min(100, kpis.budgetVariance || 0)}%` }}
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
            <Line data={cumulativeLineData} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { position: 'top', labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 } } } } }} />
          </div>
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder={t('procurement.filters.searchPlaceholder')}
              className="w-full pl-9 pr-4 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm placeholder-gray-500 focus:outline-none focus:border-orange-500"
            />
          </div>
          <select value={statusFilter} onChange={e => { setStatus(e.target.value); setPage(1) }}
            className="px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500">
            <option value="All">{t('procurement.filters.allStatuses')}</option>
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
          <select value={vendorFilter} onChange={e => { setVendor(e.target.value); setPage(1) }}
            className="px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500">
            {vendors.map(v => <option key={v}>{v === 'All' ? t('procurement.filters.allVendors') : v}</option>)}
          </select>
          <select value={siteFilter} onChange={e => { setSite(e.target.value); setPage(1) }}
            className="px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500">
            {sites.map(s => <option key={s}>{s === 'All' ? t('procurement.filters.allSites') : s}</option>)}
          </select>
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }}
            className="px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }}
            className="px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
          {(search || statusFilter !== 'All' || vendorFilter !== 'All' || siteFilter !== 'All' || dateFrom || dateTo) && (
            <button onClick={() => { setSearch(''); setStatus('All'); setVendor('All'); setSite('All'); setDateFrom(''); setDateTo(''); setPage(1) }}
              className="px-3 py-2 bg-red-900/30 border border-red-700 rounded-lg text-red-400 text-sm hover:bg-red-900/50 transition-colors">
              {t('procurement.filters.clear')}
            </button>
          )}
          <span className="ml-auto self-center text-[var(--text-secondary)] text-sm">{t('procurement.filters.resultsCount', { count: filtered.length })}</span>
        </div>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────── */}
      <div className="bg-[var(--surface-1)] border border-[var(--border-dim)] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border-dim)]">
                {[
                  { label: t('procurement.table.columns.poNumber'),     field: 'po_number'    },
                  { label: t('procurement.table.columns.vendor'),       field: 'vendor_name'  },
                  { label: t('procurement.table.columns.orderDate'),    field: 'order_date'   },
                  { label: t('procurement.table.columns.expDelivery'),  field: 'expected_delivery' },
                  { label: t('procurement.table.columns.status'),      field: 'status'       },
                  { label: t('procurement.table.columns.priority'),    field: 'priority'     },
                  { label: t('procurement.table.columns.items'),       field: null           },
                  { label: t('procurement.table.columns.total'),       field: 'total_amount' },
                  { label: t('procurement.table.columns.site'),        field: 'site'         },
                  { label: t('procurement.table.columns.actions'),     field: null           },
                ].map(({ label, field }) => (
                  <th key={label}
                    className={`px-4 py-3 text-left text-[var(--text-secondary)] font-medium text-xs uppercase tracking-wide ${field ? 'cursor-pointer hover:text-[var(--text-primary)]' : ''}`}
                    onClick={() => field && handleSort(field)}
                  >
                    <div className="flex items-center gap-1">
                      {label}
                      {field && <SortIcon field={field} />}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-16 text-[var(--text-muted)]">
                    <ShoppingCart size={40} className="mx-auto mb-3 opacity-30" />
                    <p>{t('procurement.table.emptyTitle')}</p>
                    <button onClick={openNew} className="mt-3 text-orange-400 hover:text-orange-300 text-sm">
                      {t('procurement.table.createFirst')}
                    </button>
                  </td>
                </tr>
              ) : paginated.map(po => {
                const pc = PRIORITY_CONFIG[po.priority] || PRIORITY_CONFIG.Normal
                return (
                  <tr key={po.id} className="border-b border-[var(--input-border)] hover:bg-[var(--input-bg)] transition-colors">
                    <td className="px-4 py-3">
                      <span className="text-orange-400 font-mono text-xs font-semibold">{po.po_number}</span>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-primary)] font-medium">{po.vendor_name}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(po.order_date)}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)] whitespace-nowrap">{fmtDate(po.expected_delivery)}</td>
                    <td className="px-4 py-3"><StatusBadge status={po.status} /></td>
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1.5 ${pc.color} text-xs`}>
                        <span className={`w-2 h-2 rounded-full ${pc.dot}`} />
                        {po.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-secondary)] text-center">{(po.items || []).length}</td>
                    <td className="px-4 py-3 text-green-400 font-medium whitespace-nowrap">{fmtCur(po.total_amount)}</td>
                    <td className="px-4 py-3 text-[var(--text-secondary)]">{po.site || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setViewPO(po)} className="p-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] transition-colors" title={t('procurement.table.viewTooltip')}><Eye size={13} /></button>
                        <button onClick={() => openEdit(po)} className="p-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] transition-colors" title={t('procurement.table.editTooltip')}><Edit2 size={13} /></button>
                        <button onClick={() => exportPDF(po)} className="p-1.5 rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-3)] transition-colors" title={t('procurement.table.pdfTooltip')}><FileText size={13} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border-dim)]">
            <span className="text-[var(--text-secondary)] text-sm">{t('procurement.table.pageSummary', { page, total: totalPages, count: filtered.length })}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 bg-[var(--surface-2)] border border-[var(--border-bright)] text-[var(--text-secondary)] text-sm rounded disabled:opacity-40">{t('procurement.table.prev')}</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1.5 bg-[var(--surface-2)] border border-[var(--border-bright)] text-[var(--text-secondary)] text-sm rounded disabled:opacity-40">{t('procurement.table.next')}</button>
            </div>
          </div>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          CREATE / EDIT MODAL
      ══════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
              className="bg-[var(--surface-1)] border border-[var(--border-bright)] rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto shadow-2xl">

              {/* Modal header */}
              <div className="sticky top-0 bg-[var(--surface-1)] border-b border-[var(--border-dim)] px-6 py-4 flex items-center justify-between z-10">
                <div className="flex items-center gap-3">
                  <ShoppingCart size={18} className="text-orange-400" />
                  <h2 className="text-[var(--text-primary)] font-bold text-lg">
                    {editPO ? t('procurement.modal.editTitle', { poNumber: editPO.po_number }) : t('procurement.modal.newTitle')}
                  </h2>
                </div>
                <button onClick={() => setShowForm(false)} className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors"><X size={18} /></button>
              </div>

              <div className="p-6 space-y-5">
                {/* Row 1: Vendor + Order Date */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[var(--text-secondary)] text-xs mb-1 block">{t('procurement.modal.vendorName')}</label>
                    <input value={formData.vendor_name} onChange={e => setFormData(f => ({ ...f, vendor_name: e.target.value }))}
                      placeholder={t('procurement.modal.vendorNamePlaceholder')} className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
                  </div>
                  <div>
                    <label className="text-[var(--text-secondary)] text-xs mb-1 block">{t('procurement.modal.orderDate')}</label>
                    <input type="date" value={formData.order_date} onChange={e => setFormData(f => ({ ...f, order_date: e.target.value }))}
                      className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
                  </div>
                </div>

                {/* Row 2: Expected Del + Status */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="text-[var(--text-secondary)] text-xs mb-1 block">{t('procurement.modal.expectedDelivery')}</label>
                    <input type="date" value={formData.expected_delivery} onChange={e => setFormData(f => ({ ...f, expected_delivery: e.target.value }))}
                      className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
                  </div>
                  <div>
                    <label className="text-[var(--text-secondary)] text-xs mb-1 block">{t('procurement.modal.priority')}</label>
                    <select value={formData.priority} onChange={e => setFormData(f => ({ ...f, priority: e.target.value }))}
                      className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500">
                      {PRIORITIES.map(p => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[var(--text-secondary)] text-xs mb-1 block">{t('procurement.modal.status')}</label>
                    <select value={formData.status} onChange={e => setFormData(f => ({ ...f, status: e.target.value }))}
                      className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500">
                      {STATUSES.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                </div>

                {/* Row 3: Site + Country + Budget Code */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="text-[var(--text-secondary)] text-xs mb-1 block">{t('procurement.modal.site')}</label>
                    <input value={formData.site} onChange={e => setFormData(f => ({ ...f, site: e.target.value }))}
                      placeholder={t('procurement.modal.sitePlaceholder')} className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
                  </div>
                  <div>
                    <label className="text-[var(--text-secondary)] text-xs mb-1 block">{t('procurement.modal.country')}</label>
                    <input value={formData.country} onChange={e => setFormData(f => ({ ...f, country: e.target.value }))}
                      placeholder={t('procurement.modal.countryPlaceholder')} className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
                  </div>
                  <div>
                    <label className="text-[var(--text-secondary)] text-xs mb-1 block">{t('procurement.modal.budgetCode')}</label>
                    <input value={formData.budget_code} onChange={e => setFormData(f => ({ ...f, budget_code: e.target.value }))}
                      placeholder={t('procurement.modal.budgetCodePlaceholder')} className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
                  </div>
                </div>

                {/* Row 4: Requested By + Approved By */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-[var(--text-secondary)] text-xs mb-1 block">{t('procurement.modal.requestedBy')}</label>
                    <input value={formData.requested_by} onChange={e => setFormData(f => ({ ...f, requested_by: e.target.value }))}
                      placeholder={t('procurement.modal.namePlaceholder')} className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
                  </div>
                  <div>
                    <label className="text-[var(--text-secondary)] text-xs mb-1 block">{t('procurement.modal.approvedBy')}</label>
                    <input value={formData.approved_by} onChange={e => setFormData(f => ({ ...f, approved_by: e.target.value }))}
                      placeholder={t('procurement.modal.namePlaceholder')} className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
                  </div>
                </div>

                {/* Line items */}
                <div>
                  <label className="text-[var(--text-secondary)] text-xs mb-2 block font-medium uppercase tracking-wide">{t('procurement.modal.lineItems')}</label>

                  {/* Existing items */}
                  {formData.items.length > 0 && (
                    <div className="mb-3 rounded-lg overflow-hidden border border-[var(--border-bright)]">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-[var(--surface-2)] text-[var(--text-secondary)]">
                            <th className="px-3 py-2 text-left">{t('procurement.modal.columns.brand')}</th>
                            <th className="px-3 py-2 text-left">{t('procurement.modal.columns.size')}</th>
                            <th className="px-3 py-2 text-right">{t('procurement.modal.columns.qty')}</th>
                            <th className="px-3 py-2 text-right">{t('procurement.modal.columns.unitPrice')}</th>
                            <th className="px-3 py-2 text-right">{t('procurement.modal.columns.lineTotal')}</th>
                            <th className="px-3 py-2 w-8"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {formData.items.map((it, idx) => (
                            <tr key={idx} className="border-t border-[var(--input-border)]">
                              <td className="px-3 py-2 text-[var(--text-primary)]">{it.brand}</td>
                              <td className="px-3 py-2 text-[var(--text-secondary)]">{it.size}</td>
                              <td className="px-3 py-2 text-[var(--text-secondary)] text-right">{it.quantity}</td>
                              <td className="px-3 py-2 text-[var(--text-secondary)] text-right">{fmtCur(it.unit_price)}</td>
                              <td className="px-3 py-2 text-green-400 text-right font-medium">{fmtCur(calcItemTotal(it))}</td>
                              <td className="px-3 py-2">
                                <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-400"><X size={13} /></button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Add item row */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
                    <input value={itemRow.brand} onChange={e => setItemRow(r => ({ ...r, brand: e.target.value }))}
                      placeholder={t('procurement.modal.brandPlaceholder')} className="px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
                    <input value={itemRow.size} onChange={e => setItemRow(r => ({ ...r, size: e.target.value }))}
                      placeholder={t('procurement.modal.sizePlaceholder')} className="px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
                    <input type="number" min="1" value={itemRow.quantity} onChange={e => setItemRow(r => ({ ...r, quantity: e.target.value }))}
                      placeholder={t('procurement.modal.qtyPlaceholder')} className="px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500" />
                    <input type="number" min="0" step="0.01" value={itemRow.unit_price} onChange={e => setItemRow(r => ({ ...r, unit_price: e.target.value }))}
                      placeholder={t('procurement.modal.unitPricePlaceholder')} className="px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500"
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
                          <input type="number" min="0" max="100" value={taxPct} onChange={e => setTaxPct(parseFloat(e.target.value) || 0)}
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
                  <label className="text-[var(--text-secondary)] text-xs mb-1 block">{t('procurement.modal.notes')}</label>
                  <textarea value={formData.notes} onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))}
                    rows={3} placeholder={t('procurement.modal.notesPlaceholder')}
                    className="w-full px-3 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] rounded-lg text-[var(--text-primary)] text-sm focus:outline-none focus:border-orange-500 resize-none" />
                </div>
              </div>

              {/* Footer */}
              <div className="sticky bottom-0 bg-[var(--surface-1)] border-t border-[var(--border-dim)] px-6 py-4 flex items-center justify-between">
                <div className="text-[var(--text-secondary)] text-sm">
                  {t('procurement.modal.totalLabel')} <span className="text-green-400 font-bold text-base">{fmtCur(formTotal)}</span>
                  {formData.items.length > 0 && <span className="text-[var(--text-muted)] ml-2">{t('procurement.modal.itemsCount', { count: formData.items.length })}</span>}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-[var(--surface-2)] border border-[var(--border-bright)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-sm rounded-lg transition-colors">
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
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
              className="w-full sm:w-[520px] h-full bg-[var(--surface-1)] border-l border-[var(--border-bright)] overflow-y-auto shadow-2xl"
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
