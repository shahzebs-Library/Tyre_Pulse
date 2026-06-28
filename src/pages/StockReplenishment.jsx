// ─────────────────────────────────────────────────────────────────────────────
// StockReplenishment.jsx — Automated Stock Replenishment Intelligence · /stock-replenishment
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import {
  Package, AlertTriangle, TrendingDown, TrendingUp, ShoppingCart,
  RefreshCw, Loader2, Search, X, Plus, Minus, FileText,
  FileSpreadsheet, ChevronDown, ChevronUp, Edit2, CheckCircle,
  Clock, BarChart2, Layers, Zap, ExternalLink, Filter,
} from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import PageHeader from '../components/ui/PageHeader'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  Title, Tooltip, Legend, Filler,
)

// ── Constants ──────────────────────────────────────────────────────────────────
const TABS = ['Replenishment Matrix', 'Consumption Analysis', 'Order Generator']

const URGENCY_CONFIG = {
  Critical:    { color: 'text-red-400',    bg: 'bg-red-900/20',    border: 'border-red-700',    row: 'bg-red-950/20 border-l-2 border-l-red-600' },
  Low:         { color: 'text-yellow-400', bg: 'bg-yellow-900/20', border: 'border-yellow-700', row: 'bg-yellow-950/10 border-l-2 border-l-yellow-600' },
  Normal:      { color: 'text-green-400',  bg: 'bg-green-900/20',  border: 'border-green-700',  row: '' },
  Overstocked: { color: 'text-blue-400',   bg: 'bg-blue-900/20',   border: 'border-blue-700',   row: 'bg-blue-950/10' },
}

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'var(--panel)',
      borderColor: 'var(--hairline)',
      borderWidth: 1,
      titleColor: '#f9fafb',
      bodyColor: '#d1d5db',
    },
  },
  scales: {
    x: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: '#1f2937' } },
    y: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: '#1f2937' } },
  },
}

const BAR_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#06b6d4']

// ── Helpers ────────────────────────────────────────────────────────────────────
function fmtCurrency(v, currency = 'SAR') {
  const n = parseFloat(v)
  if (isNaN(n)) return '—'
  return `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
}
function computeUrgency(daysRemaining, leadTimeDays) {
  if (daysRemaining <= 0) return 'Critical'
  if (daysRemaining < Math.max(leadTimeDays, 30)) return 'Critical'
  if (daysRemaining < 60) return 'Low'
  if (daysRemaining > 180) return 'Overstocked'
  return 'Normal'
}

// ── Skeleton ───────────────────────────────────────────────────────────────────
function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-gray-800 rounded ${className}`} />
}

// ── Urgency Badge ─────────────────────────────────────────────────────────────
function UrgencyBadge({ urgency }) {
  const cfg = URGENCY_CONFIG[urgency] || URGENCY_CONFIG.Normal
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color} ${cfg.bg} ${cfg.border}`}>
      {urgency === 'Critical' && <Zap size={10} className="mr-1" />}
      {urgency}
    </span>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function StockReplenishment() {
  const { activeCurrency, activeCountry } = useSettings()
  const { user } = useAuth()

  // ── Raw data ───────────────────────────────────────────────────────────────
  const [stockData, setStockData]           = useState([])
  const [tyreRecords, setTyreRecords]       = useState([])
  const [loading, setLoading]               = useState(true)
  const [error, setError]                   = useState(null)
  const [lastSync, setLastSync]             = useState(null)

  // ── UI state ───────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab]           = useState(0)
  const [search, setSearch]                 = useState('')
  const [siteFilter, setSiteFilter]         = useState('All')
  const [leadTimeDays, setLeadTimeDays]     = useState(7)
  const [leadTimeEdit, setLeadTimeEdit]     = useState(false)
  const [leadTimeInput, setLeadTimeInput]   = useState('7')
  const [sortField, setSortField]           = useState('days_remaining')
  const [sortDir, setSortDir]               = useState('asc')
  const [selectedSize, setSelectedSize]     = useState('')

  // ── Order Generator state ──────────────────────────────────────────────────
  const [orderLines, setOrderLines]         = useState([])
  const [orderSelections, setOrderSelections] = useState(new Set())

  // ── Inline qty edit in matrix ──────────────────────────────────────────────
  const [editingQty, setEditingQty]         = useState({}) // key → overridden qty

  // ── Load data ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const ninety = new Date()
      ninety.setDate(ninety.getDate() - 90)
      const ninetyStr = ninety.toISOString().slice(0, 10)

      const [stockRes, tyreRes] = await Promise.all([
        supabase.from('stock').select('*'),
        fetchAllPages((from, to) =>
          supabase.from('tyre_records').select('site,brand,size,issue_date,cost_per_tyre')
            .gte('issue_date', ninetyStr).range(from, to)
        , { max: 200000 }),
      ])

      if (stockRes.error) throw stockRes.error
      if (tyreRes.error) throw tyreRes.error

      setStockData(stockRes.data || [])
      setTyreRecords(tyreRes.data || [])
      setLastSync(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // ── Derived: consumption map (site+brand+size → qty/month for last 90d) ────
  const consumptionMap = useMemo(() => {
    // map key → count of issues in last 90 days
    const map = {}
    tyreRecords.forEach(r => {
      const key = `${r.site}||${r.brand}||${r.size}`
      map[key] = (map[key] || 0) + 1
    })
    // convert to per-month rate (÷3 for 90d window)
    const rates = {}
    Object.entries(map).forEach(([k, count]) => {
      rates[k] = count / 3
    })
    return rates
  }, [tyreRecords])

  // ── Derived: avg cost from tyre_records per brand+size ────────────────────
  const avgCostMap = useMemo(() => {
    const sums = {}, counts = {}
    tyreRecords.forEach(r => {
      if (!r.cost_per_tyre) return
      const k = `${r.brand}||${r.size}`
      sums[k] = (sums[k] || 0) + parseFloat(r.cost_per_tyre)
      counts[k] = (counts[k] || 0) + 1
    })
    const result = {}
    Object.keys(sums).forEach(k => { result[k] = sums[k] / counts[k] })
    return result
  }, [tyreRecords])

  // ── Derived: enriched matrix rows ─────────────────────────────────────────
  const matrixRows = useMemo(() => {
    return stockData.map(item => {
      const cKey = `${item.site}||${item.brand}||${item.size}`
      const cosKey = `${item.brand}||${item.size}`
      const consumptionPerMonth = consumptionMap[cKey] || 0
      const consumptionPerDay   = consumptionPerMonth / 30
      const daysRemaining       = consumptionPerDay < 0.001
        ? (item.qty_in_stock > 0 ? 9999 : 0)
        : Math.round(item.qty_in_stock / consumptionPerDay)

      // 2-month buffer suggested order
      const buffer2Month        = consumptionPerMonth * 2
      const suggestedQty        = Math.max(0, Math.round(buffer2Month - item.qty_in_stock))

      // unit cost: prefer stock table, fallback avg from tyre_records
      const unitCost = parseFloat(item.unit_cost) > 0
        ? parseFloat(item.unit_cost)
        : (avgCostMap[cosKey] || 0)

      const estimatedCost = suggestedQty * unitCost
      const urgency       = computeUrgency(daysRemaining, leadTimeDays)

      return {
        ...item,
        consumptionPerMonth,
        consumptionPerDay,
        daysRemaining,
        suggestedQty,
        unitCost,
        estimatedCost,
        urgency,
        _key: cKey,
      }
    })
  }, [stockData, consumptionMap, avgCostMap, leadTimeDays])

  // ── Distinct sites ─────────────────────────────────────────────────────────
  const allSites = useMemo(() => (
    ['All', ...Array.from(new Set(matrixRows.map(r => r.site).filter(Boolean))).sort()]
  ), [matrixRows])

  // ── Filtered + sorted matrix ───────────────────────────────────────────────
  const filteredMatrix = useMemo(() => {
    let rows = [...matrixRows]
    if (activeCountry && activeCountry !== 'All') {
      // If stock table has a country column, filter by it; otherwise filter by site pattern
      rows = rows.filter(r => !r.country || r.country === activeCountry)
    }
    if (siteFilter !== 'All') rows = rows.filter(r => r.site === siteFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      rows = rows.filter(r =>
        r.brand?.toLowerCase().includes(q) ||
        r.size?.toLowerCase().includes(q) ||
        r.site?.toLowerCase().includes(q)
      )
    }
    rows.sort((a, b) => {
      const av = a[sortField] ?? 0
      const bv = b[sortField] ?? 0
      if (typeof av === 'number') return sortDir === 'asc' ? av - bv : bv - av
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av))
    })
    return rows
  }, [matrixRows, activeCountry, siteFilter, search, sortField, sortDir])

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const needsReorder    = matrixRows.filter(r => r.daysRemaining < 30 && r.daysRemaining !== 9999).length
    const totalReorderVal = matrixRows.reduce((s, r) => {
      const qty = editingQty[r._key] !== undefined ? editingQty[r._key] : r.suggestedQty
      return s + qty * r.unitCost
    }, 0)
    const validRows       = matrixRows.filter(r => r.daysRemaining !== 9999)
    const avgDays         = validRows.length
      ? Math.round(validRows.reduce((s, r) => s + r.daysRemaining, 0) / validRows.length)
      : 0
    const criticalStockouts = matrixRows.filter(r => r.qty_in_stock <= 0).length
    const overstocked       = matrixRows.filter(r => r.daysRemaining > 180 && r.daysRemaining !== 9999).length
    return { needsReorder, totalReorderVal, avgDays, criticalStockouts, overstocked }
  }, [matrixRows, editingQty])

  // ── Chart: monthly consumption by top 5 sizes (last 6 months) ─────────────
  const consumptionBarData = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(); d.setMonth(d.getMonth() - 5 + i)
      return d.toISOString().slice(0, 7)
    })
    // Need full tyre_records for 6 months — we only loaded 90d; use what we have
    const sizeTotals = {}
    tyreRecords.forEach(r => {
      sizeTotals[r.size] = (sizeTotals[r.size] || 0) + 1
    })
    const top5 = Object.entries(sizeTotals)
      .sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k)

    return {
      labels: months.map(m => {
        const [y, mo] = m.split('-')
        return new Date(parseInt(y), parseInt(mo) - 1)
          .toLocaleString('en-US', { month: 'short', year: '2-digit' })
      }),
      datasets: top5.map((size, idx) => ({
        label: size,
        data: months.map(month => {
          return tyreRecords.filter(r =>
            r.size === size && r.issue_date?.startsWith(month)
          ).length
        }),
        backgroundColor: BAR_COLORS[idx] + 'cc',
        borderColor: BAR_COLORS[idx],
        borderWidth: 1,
        borderRadius: 4,
      })),
    }
  }, [tyreRecords])

  // ── Chart: consumption trend for selected size ─────────────────────────────
  const allSizes = useMemo(() => (
    Array.from(new Set(tyreRecords.map(r => r.size).filter(Boolean))).sort()
  ), [tyreRecords])

  useEffect(() => {
    if (!selectedSize && allSizes.length > 0) setSelectedSize(allSizes[0])
  }, [allSizes, selectedSize])

  const trendLineData = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(); d.setMonth(d.getMonth() - 5 + i)
      return d.toISOString().slice(0, 7)
    })
    const counts = months.map(m =>
      tyreRecords.filter(r => r.size === selectedSize && r.issue_date?.startsWith(m)).length
    )
    return {
      labels: months.map(m => {
        const [y, mo] = m.split('-')
        return new Date(parseInt(y), parseInt(mo) - 1)
          .toLocaleString('en-US', { month: 'short', year: '2-digit' })
      }),
      datasets: [{
        label: selectedSize || 'Selected Size',
        data: counts,
        borderColor: '#10b981',
        backgroundColor: 'rgba(16,185,129,0.15)',
        tension: 0.4,
        fill: true,
        pointRadius: 4,
        pointBackgroundColor: '#10b981',
      }],
    }
  }, [tyreRecords, selectedSize])

  // ── Consumption matrix: size × site (last 30d from loaded 90d data) ────────
  const consumptionMatrix = useMemo(() => {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    const recent = tyreRecords.filter(r => new Date(r.issue_date) >= thirtyDaysAgo)
    const sizeSet = new Set(), siteSet = new Set()
    recent.forEach(r => { if (r.size) sizeSet.add(r.size); if (r.site) siteSet.add(r.site) })
    const sizes = [...sizeSet].sort()
    const sites = [...siteSet].sort()
    const grid = {}
    recent.forEach(r => {
      const k = `${r.size}||${r.site}`
      grid[k] = (grid[k] || 0) + 1
    })
    return { sizes, sites, grid }
  }, [tyreRecords])

  // ── Seasonal variance note ─────────────────────────────────────────────────
  const seasonalNote = useMemo(() => {
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(); d.setMonth(d.getMonth() - 5 + i)
      return d.toISOString().slice(0, 7)
    })
    const counts = months.map(m => tyreRecords.filter(r => r.issue_date?.startsWith(m)).length)
    const avg = counts.reduce((a, b) => a + b, 0) / counts.length || 1
    const maxVariance = Math.max(...counts.map(c => Math.abs((c - avg) / avg))) * 100
    return maxVariance > 20
      ? `High seasonal variance detected (±${maxVariance.toFixed(0)}%). Adjust replenishment quantities accordingly.`
      : null
  }, [tyreRecords])

  // ── Sort helper ────────────────────────────────────────────────────────────
  function handleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }
  function SortIcon({ field }) {
    if (sortField !== field) return <ChevronDown size={12} className="text-gray-600" />
    return sortDir === 'asc'
      ? <ChevronUp size={12} className="text-emerald-400" />
      : <ChevronDown size={12} className="text-emerald-400" />
  }

  // ── Add row to Order Generator ─────────────────────────────────────────────
  function addToOrder(row) {
    const qty = editingQty[row._key] !== undefined ? editingQty[row._key] : row.suggestedQty
    if (qty <= 0) return
    setOrderLines(prev => {
      const existing = prev.findIndex(l => l._key === row._key)
      if (existing >= 0) {
        return prev.map((l, i) => i === existing ? { ...l, qty } : l)
      }
      return [...prev, {
        _key:      row._key,
        brand:     row.brand,
        size:      row.size,
        site:      row.site,
        qty,
        unitCost:  row.unitCost,
        supplier:  '',
        totalCost: qty * row.unitCost,
      }]
    })
    setActiveTab(2)
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

  function removeOrderLine(idx) {
    setOrderLines(prev => prev.filter((_, i) => i !== idx))
  }

  function addBlankOrderLine() {
    setOrderLines(prev => [...prev, {
      _key:      `manual-${Date.now()}`,
      brand:     '',
      size:      '',
      site:      '',
      qty:       1,
      unitCost:  0,
      supplier:  '',
      totalCost: 0,
    }])
  }

  const orderTotal = useMemo(() =>
    orderLines.reduce((s, l) => s + (parseFloat(l.totalCost) || 0), 0),
    [orderLines]
  )

  // ── Lead time save ─────────────────────────────────────────────────────────
  function saveLeadTime() {
    const v = parseInt(leadTimeInput)
    if (!isNaN(v) && v > 0) setLeadTimeDays(v)
    setLeadTimeEdit(false)
  }

  // ── Export PO to Excel ─────────────────────────────────────────────────────
  function exportOrderExcel() {
    const rows = orderLines.map((l, i) => ({
      '#':               i + 1,
      'Brand':           l.brand,
      'Size':            l.size,
      'Site':            l.site,
      'Quantity':        l.qty,
      'Unit Cost':       l.unitCost,
      'Total Cost':      l.totalCost,
      'Preferred Supplier': l.supplier,
    }))
    rows.push({
      '#': '', Brand: '', Size: '', Site: '', Quantity: '',
      'Unit Cost': 'TOTAL',
      'Total Cost': orderTotal,
      'Preferred Supplier': '',
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Purchase Order')
    XLSX.writeFile(wb, `replenishment-po-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  // ── Export PO to PDF ───────────────────────────────────────────────────────
  function exportOrderPDF() {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    // Header
    doc.setFillColor(15, 23, 42)
    doc.rect(0, 0, 210, 40, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(20); doc.setFont('helvetica', 'bold')
    doc.text('TyrePulse', 14, 16)
    doc.setFontSize(11); doc.setFont('helvetica', 'normal')
    doc.text('STOCK REPLENISHMENT PURCHASE ORDER', 14, 25)
    doc.setFontSize(8); doc.setTextColor(156, 163, 175)
    const poRef = `REPO-${new Date().getFullYear()}-${Date.now().toString().slice(-5)}`
    doc.text(`Ref: ${poRef}  ·  Generated: ${new Date().toLocaleString('en-US')}`, 14, 33)
    doc.text(`Lead Time: ${leadTimeDays} days`, 155, 33)

    // Summary row
    autoTable(doc, {
      startY: 48,
      head: [['Field', 'Value', 'Field', 'Value']],
      body: [
        ['PO Reference', poRef,                                  'Date',          new Date().toLocaleDateString('en-US')],
        ['Generated By', user?.email || 'TyrePulse System',      'Currency',      activeCurrency],
        ['Total Lines',  `${orderLines.length} items`,           'Total Value',   fmtCurrency(orderTotal, activeCurrency)],
      ],
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 38 }, 2: { fontStyle: 'bold', cellWidth: 38 } },
      margin: { left: 14, right: 14 },
    })

    let y = (doc.lastAutoTable?.finalY || 70) + 8

    // Line items
    autoTable(doc, {
      startY: y,
      head: [['#', 'Brand', 'Size', 'Site', 'Qty', 'Unit Cost', 'Total', 'Supplier']],
      body: orderLines.map((l, i) => [
        i + 1, l.brand, l.size, l.site || '—', l.qty,
        fmtCurrency(l.unitCost, activeCurrency),
        fmtCurrency(l.totalCost, activeCurrency),
        l.supplier || '—',
      ]),
      foot: [['', '', '', '', '', 'TOTAL', fmtCurrency(orderTotal, activeCurrency), '']],
      theme: 'striped',
      styles: { fontSize: 9 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255 },
      footStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold' },
      margin: { left: 14, right: 14 },
    })

    const pgCount = doc.internal.getNumberOfPages()
    for (let i = 1; i <= pgCount; i++) {
      doc.setPage(i); doc.setFontSize(7); doc.setTextColor(156, 163, 175)
      doc.text(
        `TyrePulse Fleet Intelligence — Stock Replenishment PO — ${poRef} — Page ${i} of ${pgCount}`,
        14, 290,
      )
    }
    doc.save(`replenishment-po-${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Skeleton className="w-10 h-10 rounded-xl" />
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    )
  }

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock Replenishment"
        subtitle={`Procurement intelligence — ${stockData.length} SKUs tracked${lastSync ? ` · Synced ${lastSync.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}` : ''}`}
        icon={Package}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              {leadTimeEdit ? (
                <>
                  <input
                    type="number" min="1" max="365"
                    value={leadTimeInput}
                    onChange={e => setLeadTimeInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveLeadTime()}
                    className="w-16 px-2 py-1.5 bg-gray-800 border border-emerald-600 rounded-lg text-white text-sm focus:outline-none"
                    autoFocus
                  />
                  <span className="text-gray-400 text-xs">days</span>
                  <button onClick={saveLeadTime} className="px-2 py-1.5 bg-emerald-700 text-white text-xs rounded-lg">
                    <CheckCircle size={13} />
                  </button>
                  <button onClick={() => setLeadTimeEdit(false)} className="px-2 py-1.5 bg-gray-700 text-gray-300 text-xs rounded-lg">
                    <X size={13} />
                  </button>
                </>
              ) : (
                <button
                  onClick={() => { setLeadTimeEdit(true); setLeadTimeInput(leadTimeDays.toString()) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg hover:border-emerald-600 transition-colors"
                  title="Edit lead time"
                >
                  <Clock size={13} className="text-emerald-400" />
                  Lead: {leadTimeDays}d
                  <Edit2 size={11} className="text-gray-600" />
                </button>
              )}
            </div>
            <button
              onClick={load}
              className="p-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white transition-colors"
              title="Refresh"
            >
              <RefreshCw size={16} />
            </button>
          </div>
        }
      />

      {/* ── Error ────────────────────────────────────────────────────────────── */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 flex items-center gap-3 text-red-300">
          <AlertTriangle size={18} />
          <span className="text-sm">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto">
            <X size={16} />
          </button>
        </div>
      )}

      {/* ── KPI Cards ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          {
            label:  'Needs Reorder',
            value:  kpis.needsReorder,
            color:  'red',
            icon:   AlertTriangle,
            sub:    `items < ${leadTimeDays}d stock`,
          },
          {
            label:  'Reorder Value',
            value:  kpis.totalReorderVal >= 1_000_000
              ? `${activeCurrency} ${(kpis.totalReorderVal / 1_000_000).toFixed(2)}M`
              : `${activeCurrency} ${(kpis.totalReorderVal / 1000).toFixed(1)}k`,
            color:  'orange',
            icon:   ShoppingCart,
            sub:    'Suggested orders',
          },
          {
            label:  'Avg Days Remaining',
            value:  `${kpis.avgDays}d`,
            color:  kpis.avgDays < 30 ? 'red' : kpis.avgDays < 60 ? 'yellow' : 'emerald',
            icon:   Clock,
            sub:    'Fleet average',
          },
          {
            label:  'Critical Stockouts',
            value:  kpis.criticalStockouts,
            color:  kpis.criticalStockouts > 0 ? 'red' : 'gray',
            icon:   Zap,
            sub:    'Zero qty in stock',
          },
          {
            label:  'Over-Stocked',
            value:  kpis.overstocked,
            color:  'blue',
            icon:   TrendingUp,
            sub:    'Items > 180 days',
          },
        ].map(({ label, value, color, icon: Icon, sub }) => (
          <motion.div
            key={label}
            className="bg-gray-900 border border-gray-800 rounded-xl p-4"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Icon size={15} className={`text-${color}-400`} />
              <span className="text-gray-400 text-xs">{label}</span>
            </div>
            <div className={`text-2xl font-bold text-${color}-400`}>{value}</div>
            {sub && <p className="text-gray-500 text-xs mt-1">{sub}</p>}
          </motion.div>
        ))}
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
        {TABS.map((tab, idx) => (
          <button
            key={tab}
            onClick={() => setActiveTab(idx)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              activeTab === idx
                ? 'bg-emerald-700 text-white shadow'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {idx === 0 && <Layers size={14} />}
            {idx === 1 && <BarChart2 size={14} />}
            {idx === 2 && <ShoppingCart size={14} />}
            {tab}
            {idx === 2 && orderLines.length > 0 && (
              <span className="bg-emerald-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                {orderLines.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab Content ──────────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 0: REPLENISHMENT MATRIX
        ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === 0 && (
          <motion.div
            key="matrix"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-4"
          >
            {/* Filters */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex flex-wrap gap-3">
                <div className="relative flex-1 min-w-48">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search brand, size, site…"
                    className="w-full pl-9 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                {/* Site filter pills */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {allSites.map(site => (
                    <button
                      key={site}
                      onClick={() => setSiteFilter(site)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                        siteFilter === site
                          ? 'bg-emerald-700 border-emerald-600 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'
                      }`}
                    >
                      {site}
                    </button>
                  ))}
                </div>
                {(search || siteFilter !== 'All') && (
                  <button
                    onClick={() => { setSearch(''); setSiteFilter('All') }}
                    className="px-3 py-1.5 bg-red-900/30 border border-red-700 rounded-lg text-red-400 text-xs hover:bg-red-900/50 transition-colors"
                  >
                    Clear
                  </button>
                )}
                <span className="ml-auto self-center text-gray-400 text-sm">
                  {filteredMatrix.length} items
                </span>
              </div>
            </div>

            {/* Empty state */}
            {filteredMatrix.length === 0 ? (
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-16 text-center">
                <Package size={48} className="mx-auto mb-4 text-gray-700" />
                <p className="text-gray-400 text-lg font-medium">No stock data found</p>
                <p className="text-gray-600 text-sm mt-2">Add stock records to see replenishment recommendations</p>
              </div>
            ) : (
              <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800 bg-gray-900/80">
                        {[
                          { label: 'Brand',        field: 'brand'         },
                          { label: 'Size',         field: 'size'          },
                          { label: 'Site',         field: 'site'          },
                          { label: 'In Stock',     field: 'qty_in_stock'  },
                          { label: 'On Order',     field: 'qty_on_order'  },
                          { label: 'Daily Usage',  field: 'consumptionPerDay' },
                          { label: 'Days Left',    field: 'days_remaining' },
                          { label: 'Suggest Qty',  field: 'suggestedQty'  },
                          { label: 'Est. Cost',    field: 'estimatedCost' },
                          { label: 'Status',       field: 'urgency'       },
                          { label: 'Action',       field: null            },
                        ].map(({ label, field }) => (
                          <th
                            key={label}
                            onClick={() => {
                              if (field && field !== 'days_remaining') handleSort(field)
                              else if (field === 'days_remaining') handleSort('daysRemaining')
                            }}
                            className={`px-4 py-3 text-left text-gray-400 font-medium text-xs uppercase tracking-wide whitespace-nowrap ${
                              field ? 'cursor-pointer hover:text-white' : ''
                            }`}
                          >
                            <div className="flex items-center gap-1">
                              {label}
                              {field && <SortIcon field={
                                field === 'days_remaining' ? 'daysRemaining' : field
                              } />}
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMatrix.map(row => {
                        const cfg = URGENCY_CONFIG[row.urgency] || URGENCY_CONFIG.Normal
                        const suggestedDisplay = editingQty[row._key] !== undefined
                          ? editingQty[row._key]
                          : row.suggestedQty
                        const estCostDisplay = suggestedDisplay * row.unitCost
                        return (
                          <tr
                            key={row._key}
                            className={`border-b border-gray-800/60 hover:bg-gray-800/40 transition-colors ${cfg.row}`}
                          >
                            <td className="px-4 py-3 text-white font-medium">{row.brand || '—'}</td>
                            <td className="px-4 py-3 text-gray-300 font-mono text-xs">{row.size || '—'}</td>
                            <td className="px-4 py-3 text-gray-400">{row.site || '—'}</td>
                            <td className="px-4 py-3 text-center">
                              <span className={row.qty_in_stock <= 0 ? 'text-red-400 font-bold' : 'text-white'}>
                                {row.qty_in_stock ?? 0}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center text-yellow-400">
                              {row.qty_on_order ?? 0}
                            </td>
                            <td className="px-4 py-3 text-center text-gray-400">
                              {row.consumptionPerDay > 0
                                ? row.consumptionPerDay.toFixed(2)
                                : <span className="text-gray-600">—</span>}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <span className={
                                row.daysRemaining === 9999 ? 'text-gray-500' :
                                row.daysRemaining < 30 ? 'text-red-400 font-bold' :
                                row.daysRemaining < 60 ? 'text-yellow-400' :
                                row.daysRemaining > 180 ? 'text-blue-400' :
                                'text-green-400'
                              }>
                                {row.daysRemaining === 9999 ? '∞' : `${row.daysRemaining}d`}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              {/* Inline editable suggested qty */}
                              <input
                                type="number"
                                min="0"
                                value={suggestedDisplay}
                                onChange={e => setEditingQty(prev => ({
                                  ...prev,
                                  [row._key]: Math.max(0, parseInt(e.target.value) || 0),
                                }))}
                                className="w-16 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-xs text-center focus:outline-none focus:border-emerald-500"
                              />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <span className={estCostDisplay > 0 ? 'text-emerald-400 text-xs' : 'text-gray-600 text-xs'}>
                                {estCostDisplay > 0
                                  ? `${activeCurrency} ${estCostDisplay.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
                                  : '—'}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <UrgencyBadge urgency={row.urgency} />
                            </td>
                            <td className="px-4 py-3">
                              <button
                                onClick={() => addToOrder(row)}
                                disabled={suggestedDisplay <= 0}
                                title="Add to order"
                                className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-700/30 border border-emerald-700 text-emerald-400 rounded-lg text-xs font-medium hover:bg-emerald-700/60 transition-colors disabled:opacity-30 disabled:cursor-not-allowed whitespace-nowrap"
                              >
                                <Plus size={12} />Order
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Urgency legend */}
                <div className="flex items-center gap-4 px-4 py-3 border-t border-gray-800 text-xs text-gray-500">
                  <span className="font-medium text-gray-400">Legend:</span>
                  {Object.entries(URGENCY_CONFIG).map(([k, v]) => (
                    <span key={k} className={`flex items-center gap-1 ${v.color}`}>
                      <span className={`w-2 h-2 rounded-full inline-block ${v.bg.replace('/20', '')} border ${v.border}`} />
                      {k}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 1: CONSUMPTION ANALYSIS
        ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === 1 && (
          <motion.div
            key="consumption"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-6"
          >
            {/* Seasonal alert */}
            {seasonalNote && (
              <div className="bg-yellow-900/20 border border-yellow-700 rounded-xl p-4 flex items-start gap-3">
                <TrendingDown size={18} className="text-yellow-400 mt-0.5 flex-shrink-0" />
                <p className="text-yellow-300 text-sm">{seasonalNote}</p>
              </div>
            )}

            {/* Bar chart: top 5 sizes */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-4">
                Monthly Consumption by Top 5 Tyre Sizes (Last 6 Months)
              </h3>
              <div className="h-64">
                {consumptionBarData.datasets.length > 0 ? (
                  <Bar
                    data={consumptionBarData}
                    options={{
                      ...CHART_OPTS,
                      plugins: {
                        ...CHART_OPTS.plugins,
                        legend: { position: 'top', labels: { color: '#9ca3af', boxWidth: 12, font: { size: 10 } } },
                      },
                    }}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-600 text-sm">
                    No tyre issue records in last 90 days
                  </div>
                )}
              </div>
            </div>

            {/* Line chart: single size trend */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold">Consumption Trend by Size</h3>
                {allSizes.length > 0 && (
                  <select
                    value={selectedSize}
                    onChange={e => setSelectedSize(e.target.value)}
                    className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500"
                  >
                    {allSizes.map(s => <option key={s}>{s}</option>)}
                  </select>
                )}
              </div>
              <div className="h-56">
                {selectedSize ? (
                  <Line
                    data={trendLineData}
                    options={{
                      ...CHART_OPTS,
                      plugins: {
                        ...CHART_OPTS.plugins,
                        legend: { display: false },
                      },
                    }}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-gray-600 text-sm">
                    No size data available
                  </div>
                )}
              </div>
            </div>

            {/* Consumption matrix: size × site */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <h3 className="text-white font-semibold mb-4">
                Size × Site Consumption Matrix (Last 30 Days)
              </h3>
              {consumptionMatrix.sizes.length === 0 ? (
                <div className="py-8 text-center text-gray-600 text-sm">No issue records in last 30 days</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="text-xs">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="px-3 py-2 text-left text-gray-400 font-medium whitespace-nowrap">Size</th>
                        {consumptionMatrix.sites.map(site => (
                          <th key={site} className="px-3 py-2 text-center text-gray-400 font-medium whitespace-nowrap">
                            {site}
                          </th>
                        ))}
                        <th className="px-3 py-2 text-center text-gray-300 font-semibold">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {consumptionMatrix.sizes.map(size => {
                        const rowTotal = consumptionMatrix.sites.reduce(
                          (s, site) => s + (consumptionMatrix.grid[`${size}||${site}`] || 0), 0
                        )
                        return (
                          <tr key={size} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                            <td className="px-3 py-2 text-white font-mono">{size}</td>
                            {consumptionMatrix.sites.map(site => {
                              const val = consumptionMatrix.grid[`${size}||${site}`] || 0
                              return (
                                <td key={site} className="px-3 py-2 text-center">
                                  {val > 0 ? (
                                    <span className={`font-medium ${
                                      val >= 10 ? 'text-emerald-400' :
                                      val >= 5  ? 'text-yellow-400' :
                                                  'text-gray-400'
                                    }`}>{val}</span>
                                  ) : (
                                    <span className="text-gray-700">—</span>
                                  )}
                                </td>
                              )
                            })}
                            <td className="px-3 py-2 text-center text-white font-semibold">{rowTotal}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            TAB 2: ORDER GENERATOR
        ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === 2 && (
          <motion.div
            key="order"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="space-y-6"
          >
            {/* PO summary card */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-gray-400 text-xs mb-1">Total PO Value</p>
                <p className="text-2xl font-bold text-emerald-400">
                  {fmtCurrency(orderTotal, activeCurrency)}
                </p>
                <p className="text-gray-500 text-xs mt-1">{orderLines.length} line items</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-gray-400 text-xs mb-1">Total Units</p>
                <p className="text-2xl font-bold text-white">
                  {orderLines.reduce((s, l) => s + (parseInt(l.qty) || 0), 0)}
                </p>
                <p className="text-gray-500 text-xs mt-1">tyres across all lines</p>
              </div>
              <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                <p className="text-gray-400 text-xs mb-1">Sites Covered</p>
                <p className="text-2xl font-bold text-white">
                  {new Set(orderLines.map(l => l.site).filter(Boolean)).size}
                </p>
                <p className="text-gray-500 text-xs mt-1">unique sites</p>
              </div>
            </div>

            {/* Order table */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
                <h3 className="text-white font-semibold flex items-center gap-2">
                  <ShoppingCart size={16} className="text-emerald-400" />
                  Purchase Order Lines
                </h3>
                <button
                  onClick={addBlankOrderLine}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700/30 border border-emerald-700 text-emerald-400 text-sm rounded-lg hover:bg-emerald-700/50 transition-colors"
                >
                  <Plus size={14} />Add Line
                </button>
              </div>

              {orderLines.length === 0 ? (
                <div className="py-16 text-center">
                  <ShoppingCart size={48} className="mx-auto mb-4 text-gray-700" />
                  <p className="text-gray-400 font-medium">No order lines yet</p>
                  <p className="text-gray-600 text-sm mt-2">
                    Click "Order" in the Replenishment Matrix or add lines manually
                  </p>
                  <button
                    onClick={() => setActiveTab(0)}
                    className="mt-4 text-emerald-400 hover:text-emerald-300 text-sm flex items-center gap-1 mx-auto"
                  >
                    <Layers size={14} />Go to Replenishment Matrix →
                  </button>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800 bg-gray-900/50">
                          <th className="px-4 py-3 text-left text-gray-400 text-xs font-medium uppercase tracking-wide">Brand</th>
                          <th className="px-4 py-3 text-left text-gray-400 text-xs font-medium uppercase tracking-wide">Size</th>
                          <th className="px-4 py-3 text-left text-gray-400 text-xs font-medium uppercase tracking-wide">Site</th>
                          <th className="px-4 py-3 text-center text-gray-400 text-xs font-medium uppercase tracking-wide">Qty</th>
                          <th className="px-4 py-3 text-right text-gray-400 text-xs font-medium uppercase tracking-wide">Unit Cost</th>
                          <th className="px-4 py-3 text-right text-gray-400 text-xs font-medium uppercase tracking-wide">Total</th>
                          <th className="px-4 py-3 text-left text-gray-400 text-xs font-medium uppercase tracking-wide">Supplier</th>
                          <th className="px-4 py-3 w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {orderLines.map((line, idx) => (
                          <tr key={line._key} className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors">
                            <td className="px-4 py-2">
                              <input
                                value={line.brand}
                                onChange={e => updateOrderLine(idx, 'brand', e.target.value)}
                                placeholder="Brand"
                                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-emerald-500"
                              />
                            </td>
                            <td className="px-4 py-2">
                              <input
                                value={line.size}
                                onChange={e => updateOrderLine(idx, 'size', e.target.value)}
                                placeholder="Size"
                                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-xs font-mono focus:outline-none focus:border-emerald-500"
                              />
                            </td>
                            <td className="px-4 py-2">
                              <input
                                value={line.site}
                                onChange={e => updateOrderLine(idx, 'site', e.target.value)}
                                placeholder="Site"
                                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-emerald-500"
                              />
                            </td>
                            <td className="px-4 py-2">
                              <input
                                type="number"
                                min="1"
                                value={line.qty}
                                onChange={e => updateOrderLine(idx, 'qty', parseInt(e.target.value) || 1)}
                                className="w-16 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm text-center focus:outline-none focus:border-emerald-500 mx-auto block"
                              />
                            </td>
                            <td className="px-4 py-2">
                              <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={line.unitCost}
                                onChange={e => updateOrderLine(idx, 'unitCost', parseFloat(e.target.value) || 0)}
                                className="w-28 px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm text-right focus:outline-none focus:border-emerald-500 ml-auto block"
                              />
                            </td>
                            <td className="px-4 py-2 text-right">
                              <span className="text-emerald-400 font-medium text-sm whitespace-nowrap">
                                {fmtCurrency(line.totalCost, activeCurrency)}
                              </span>
                            </td>
                            <td className="px-4 py-2">
                              <input
                                value={line.supplier}
                                onChange={e => updateOrderLine(idx, 'supplier', e.target.value)}
                                placeholder="Supplier name"
                                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-emerald-500"
                              />
                            </td>
                            <td className="px-4 py-2">
                              <button
                                onClick={() => removeOrderLine(idx)}
                                className="p-1 rounded text-gray-500 hover:text-red-400 hover:bg-red-900/20 transition-colors"
                              >
                                <X size={14} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Total row */}
                  <div className="flex items-center justify-between px-5 py-4 border-t border-gray-800 bg-gray-800/30">
                    <span className="text-gray-400 text-sm font-medium">
                      {orderLines.length} line{orderLines.length !== 1 ? 's' : ''} ·{' '}
                      {orderLines.reduce((s, l) => s + (parseInt(l.qty) || 0), 0)} units total
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-400 text-sm">Total PO Value:</span>
                      <span className="text-emerald-400 text-xl font-bold">
                        {fmtCurrency(orderTotal, activeCurrency)}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Export actions */}
            {orderLines.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={exportOrderExcel}
                  className="flex items-center gap-2 px-5 py-2.5 bg-gray-800 border border-gray-700 text-gray-300 hover:text-white text-sm font-medium rounded-xl transition-colors"
                >
                  <FileSpreadsheet size={16} className="text-emerald-400" />
                  Export PO to Excel
                </button>
                <button
                  onClick={exportOrderPDF}
                  className="flex items-center gap-2 px-5 py-2.5 bg-gray-800 border border-gray-700 text-gray-300 hover:text-white text-sm font-medium rounded-xl transition-colors"
                >
                  <FileText size={16} className="text-red-400" />
                  Export PO to PDF
                </button>
                <button
                  onClick={() => setOrderLines([])}
                  className="flex items-center gap-2 px-4 py-2.5 bg-red-900/20 border border-red-800 text-red-400 text-sm font-medium rounded-xl hover:bg-red-900/40 transition-colors"
                >
                  <X size={16} />
                  Clear All Lines
                </button>
                <a
                  href="/procurement"
                  className="ml-auto flex items-center gap-1.5 text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  <ExternalLink size={14} />
                  Manage full POs in Procurement →
                </a>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
