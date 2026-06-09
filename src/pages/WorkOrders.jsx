// ─────────────────────────────────────────────────────────────────────────────
// WorkOrders.jsx — Workshop Job Card Management · /work-orders
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement,
  ArcElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Wrench, Plus, Search, Filter, Download, FileText,
  CheckCircle, Clock, AlertTriangle, XCircle, Play,
  ChevronDown, ChevronUp, X, Edit2, Eye, Printer,
  Package, DollarSign, Calendar, User, Building2,
  AlertOctagon, Loader2, RefreshCw, TrendingUp,
  FileSpreadsheet,
} from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import PageHeader from '../components/ui/PageHeader'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend)

const CHART_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 } } },
    tooltip: { backgroundColor: '#111827', borderColor: '#374151', borderWidth: 1, titleColor: '#f9fafb', bodyColor: '#d1d5db' },
  },
  scales: {
    x: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: '#1f2937' } },
    y: { ticks: { color: '#9ca3af', font: { size: 11 } }, grid: { color: '#1f2937' } },
  },
}

const STATUS_CONFIG = {
  'Open':            { color: 'text-blue-400',   bg: 'bg-blue-900/30',   border: 'border-blue-700',   icon: Clock },
  'In Progress':     { color: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-700', icon: Play },
  'Awaiting Parts':  { color: 'text-orange-400', bg: 'bg-orange-900/30', border: 'border-orange-700', icon: Package },
  'Completed':       { color: 'text-green-400',  bg: 'bg-green-900/30',  border: 'border-green-700',  icon: CheckCircle },
  'Closed':          { color: 'text-gray-400',   bg: 'bg-gray-800',      border: 'border-gray-600',   icon: CheckCircle },
  'Cancelled':       { color: 'text-red-400',    bg: 'bg-red-900/20',    border: 'border-red-700',    icon: XCircle },
}

const PRIORITY_CONFIG = {
  Critical: { color: 'text-red-400',    dot: 'bg-red-500' },
  High:     { color: 'text-orange-400', dot: 'bg-orange-500' },
  Medium:   { color: 'text-yellow-400', dot: 'bg-yellow-500' },
  Low:      { color: 'text-blue-400',   dot: 'bg-blue-500' },
}

const WORK_TYPES = [
  'Tyre Change','Inspection','Repair','Rotation',
  'Balancing','Alignment','Retread','Puncture Repair',
  'Pressure Check','Emergency','Other',
]

const STATUS_FLOW = {
  'Open':           ['In Progress', 'Cancelled'],
  'In Progress':    ['Awaiting Parts', 'Completed', 'Cancelled'],
  'Awaiting Parts': ['In Progress', 'Cancelled'],
  'Completed':      ['Closed'],
  'Closed':         [],
  'Cancelled':      [],
}

const EMPTY_FORM = {
  work_order_no: '',
  asset_no: '', tyre_serial: '', tyre_position: '',
  status: 'Open', priority: 'Medium', work_type: 'Tyre Change',
  description: '', technician_name: '', workshop_name: '',
  site: '', country: '',
  opened_at: new Date().toISOString().slice(0, 16),
  target_completion: '',
  labour_hours: '', labour_rate: '', labour_cost: '',
  parts_cost: '', notes: '',
  parts_used: [],
}

// ── Helper ────────────────────────────────────────────────────────────────────
function fmtCurrency(v) {
  const n = parseFloat(v)
  if (isNaN(n)) return '—'
  return 'R ' + n.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtDateTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-ZA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
function isOverdue(wo) {
  if (!wo.target_completion) return false
  if (['Completed','Closed','Cancelled'].includes(wo.status)) return false
  return new Date(wo.target_completion) < new Date()
}
function daysOpen(wo) {
  const start = new Date(wo.opened_at)
  const end = wo.completed_at ? new Date(wo.completed_at) : new Date()
  return Math.floor((end - start) / 86400000)
}

// ─────────────────────────────────────────────────────────────────────────────
export default function WorkOrders() {
  const { activeCountry } = useSettings()
  const { user } = useAuth()

  const [orders, setOrders]       = useState([])
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState(null)

  // Filters
  const [search, setSearch]         = useState('')
  const [statusFilter, setStatus]   = useState('All')
  const [priorityFilter, setPriority] = useState('All')
  const [typeFilter, setType]       = useState('All')
  const [dateFrom, setDateFrom]     = useState('')
  const [dateTo, setDateTo]         = useState('')
  const [sortField, setSortField]   = useState('opened_at')
  const [sortDir, setSortDir]       = useState('desc')
  const [page, setPage]             = useState(1)
  const PAGE_SIZE = 20

  // Modals
  const [showForm, setShowForm]     = useState(false)
  const [editOrder, setEditOrder]   = useState(null)   // null = new
  const [viewOrder, setViewOrder]   = useState(null)   // detail drawer
  const [formData, setFormData]     = useState(EMPTY_FORM)
  const [partRow, setPartRow]       = useState({ part_name: '', quantity: 1, unit_cost: '' })

  // ── Load ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      let q = supabase.from('work_orders').select('*').order('opened_at', { ascending: false })
      if (activeCountry && activeCountry !== 'All') q = q.eq('country', activeCountry)
      const { data, error: err } = await q
      if (err) throw err
      setOrders(data || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // ── Computed ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...orders]
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(o =>
        o.work_order_no?.toLowerCase().includes(q) ||
        o.asset_no?.toLowerCase().includes(q) ||
        o.tyre_serial?.toLowerCase().includes(q) ||
        o.description?.toLowerCase().includes(q) ||
        o.technician_name?.toLowerCase().includes(q)
      )
    }
    if (statusFilter !== 'All') list = list.filter(o => o.status === statusFilter)
    if (priorityFilter !== 'All') list = list.filter(o => o.priority === priorityFilter)
    if (typeFilter !== 'All') list = list.filter(o => o.work_type === typeFilter)
    if (dateFrom) list = list.filter(o => o.opened_at >= dateFrom)
    if (dateTo)   list = list.filter(o => o.opened_at <= dateTo + 'T23:59:59')
    list.sort((a, b) => {
      const av = a[sortField] ?? '', bv = b[sortField] ?? ''
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av))
    })
    return list
  }, [orders, search, statusFilter, priorityFilter, typeFilter, dateFrom, dateTo, sortField, sortDir])

  const paginated = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filtered.slice(start, start + PAGE_SIZE)
  }, [filtered, page])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

  const stats = useMemo(() => {
    const open        = orders.filter(o => o.status === 'Open').length
    const inProgress  = orders.filter(o => o.status === 'In Progress').length
    const awaitParts  = orders.filter(o => o.status === 'Awaiting Parts').length
    const overdue     = orders.filter(o => isOverdue(o)).length
    const today       = new Date().toISOString().slice(0, 10)
    const completedToday = orders.filter(o => o.completed_at?.startsWith(today)).length
    const totalCost   = orders.reduce((s, o) => s + (parseFloat(o.total_cost) || 0), 0)
    const avgDaysOpen = orders.length
      ? Math.round(orders.filter(o => !['Closed','Cancelled'].includes(o.status))
          .reduce((s, o) => s + daysOpen(o), 0) / Math.max(1, orders.filter(o => !['Closed','Cancelled'].includes(o.status)).length))
      : 0
    return { open, inProgress, awaitParts, overdue, completedToday, totalCost, avgDaysOpen }
  }, [orders])

  // ── Chart data ────────────────────────────────────────────────────────────
  const typeChartData = useMemo(() => {
    const counts = {}
    orders.forEach(o => { counts[o.work_type] = (counts[o.work_type] || 0) + 1 })
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8)
    return {
      labels: entries.map(([k]) => k),
      datasets: [{
        label: 'Count',
        data: entries.map(([, v]) => v),
        backgroundColor: ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#84cc16','#f97316'],
      }],
    }
  }, [orders])

  const statusChartData = useMemo(() => {
    const colors = { Open: '#3b82f6', 'In Progress': '#f59e0b', 'Awaiting Parts': '#f97316', Completed: '#10b981', Closed: '#6b7280', Cancelled: '#ef4444' }
    const counts = {}
    orders.forEach(o => { counts[o.status] = (counts[o.status] || 0) + 1 })
    const entries = Object.entries(counts)
    return {
      labels: entries.map(([k]) => k),
      datasets: [{
        data: entries.map(([, v]) => v),
        backgroundColor: entries.map(([k]) => colors[k] || '#6b7280'),
        borderColor: '#1f2937',
        borderWidth: 2,
      }],
    }
  }, [orders])

  // ── Sort helper ───────────────────────────────────────────────────────────
  function handleSort(field) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }
  function SortIcon({ field }) {
    if (sortField !== field) return <ChevronDown size={14} className="text-gray-600" />
    return sortDir === 'asc' ? <ChevronUp size={14} className="text-blue-400" /> : <ChevronDown size={14} className="text-blue-400" />
  }

  // ── Form helpers ──────────────────────────────────────────────────────────
  function openNew() {
    setEditOrder(null)
    setFormData({ ...EMPTY_FORM, opened_at: new Date().toISOString().slice(0, 16) })
    setPartRow({ part_name: '', quantity: 1, unit_cost: '' })
    setShowForm(true)
  }
  function openEdit(order) {
    setEditOrder(order)
    setFormData({
      ...order,
      opened_at: order.opened_at?.slice(0, 16) || '',
      target_completion: order.target_completion?.slice(0, 16) || '',
      parts_used: order.parts_used || [],
    })
    setPartRow({ part_name: '', quantity: 1, unit_cost: '' })
    setShowForm(true)
  }

  function addPart() {
    if (!partRow.part_name.trim()) return
    setFormData(f => ({ ...f, parts_used: [...(f.parts_used || []), { ...partRow, unit_cost: parseFloat(partRow.unit_cost) || 0 }] }))
    setPartRow({ part_name: '', quantity: 1, unit_cost: '' })
  }
  function removePart(i) {
    setFormData(f => ({ ...f, parts_used: f.parts_used.filter((_, idx) => idx !== i) }))
  }
  function partsTotal(parts) {
    return (parts || []).reduce((s, p) => s + (parseFloat(p.unit_cost) || 0) * (parseInt(p.quantity) || 1), 0)
  }

  // ── Save ──────────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!formData.asset_no.trim() || !formData.work_type) {
      alert('Asset No and Work Type are required.')
      return
    }
    setSaving(true)
    try {
      const computed_parts_cost = partsTotal(formData.parts_used)
      const labour_cost = parseFloat(formData.labour_hours || 0) * parseFloat(formData.labour_rate || 0) ||
                          parseFloat(formData.labour_cost || 0)

      const payload = {
        asset_no:           formData.asset_no.trim(),
        tyre_serial:        formData.tyre_serial?.trim() || null,
        tyre_position:      formData.tyre_position?.trim() || null,
        status:             formData.status,
        priority:           formData.priority,
        work_type:          formData.work_type,
        description:        formData.description?.trim() || null,
        technician_name:    formData.technician_name?.trim() || null,
        workshop_name:      formData.workshop_name?.trim() || null,
        site:               formData.site?.trim() || null,
        country:            formData.country?.trim() || null,
        opened_at:          formData.opened_at ? new Date(formData.opened_at).toISOString() : new Date().toISOString(),
        target_completion:  formData.target_completion ? new Date(formData.target_completion).toISOString() : null,
        labour_hours:       parseFloat(formData.labour_hours) || 0,
        labour_rate:        parseFloat(formData.labour_rate) || 0,
        labour_cost:        labour_cost,
        parts_cost:         computed_parts_cost,
        parts_used:         formData.parts_used || [],
        notes:              formData.notes?.trim() || null,
        created_by:         user?.id || null,
      }

      if (editOrder) {
        const { error: err } = await supabase.from('work_orders').update(payload).eq('id', editOrder.id)
        if (err) throw err
      } else {
        // Generate work order number
        const { data: woNo } = await supabase.rpc('generate_work_order_no')
        payload.work_order_no = woNo || `WO-${Date.now()}`
        const { error: err } = await supabase.from('work_orders').insert(payload)
        if (err) throw err
      }
      await load()
      setShowForm(false)
    } catch (e) {
      alert('Save failed: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Status transition ─────────────────────────────────────────────────────
  async function transitionStatus(order, newStatus) {
    const patch = { status: newStatus }
    if (newStatus === 'In Progress' && !order.started_at) patch.started_at = new Date().toISOString()
    if (newStatus === 'Completed') patch.completed_at = new Date().toISOString()
    const { error: err } = await supabase.from('work_orders').update(patch).eq('id', order.id)
    if (err) { alert('Update failed: ' + err.message); return }
    await load()
    if (viewOrder?.id === order.id) setViewOrder(o => ({ ...o, ...patch }))
  }

  // ── PDF Job Card ──────────────────────────────────────────────────────────
  function exportJobCard(order) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    doc.setFillColor(15, 23, 42)
    doc.rect(0, 0, 210, 35, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(18); doc.setFont('helvetica', 'bold')
    doc.text('TyrePulse', 14, 14)
    doc.setFontSize(12); doc.setFont('helvetica', 'normal')
    doc.text('Workshop Job Card', 14, 23)
    doc.setFontSize(9); doc.setTextColor(156, 163, 175)
    doc.text(`${order.work_order_no}  ·  ${order.work_type}  ·  Priority: ${order.priority}`, 14, 30)
    doc.text(`Printed: ${new Date().toLocaleString('en-ZA')}`, 140, 30)

    const details = [
      ['Asset No', order.asset_no, 'Status', order.status],
      ['Tyre Serial', order.tyre_serial || '—', 'Priority', order.priority],
      ['Position', order.tyre_position || '—', 'Workshop', order.workshop_name || '—'],
      ['Technician', order.technician_name || '—', 'Site', order.site || '—'],
      ['Opened', fmtDateTime(order.opened_at), 'Target', fmtDateTime(order.target_completion)],
      ['Started', fmtDateTime(order.started_at), 'Completed', fmtDateTime(order.completed_at)],
    ]
    autoTable(doc, {
      startY: 42,
      head: [['Field', 'Value', 'Field', 'Value']],
      body: details,
      theme: 'striped',
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [30, 58, 95], textColor: 255 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 35 }, 2: { fontStyle: 'bold', cellWidth: 35 } },
      margin: { left: 14, right: 14 },
    })

    let y = (doc.lastAutoTable?.finalY || 80) + 8
    if (order.description) {
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 41, 59)
      doc.text('Work Description', 14, y); y += 6
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
      const lines = doc.splitTextToSize(order.description, 182)
      doc.text(lines, 14, y); y += lines.length * 5 + 6
    }

    if (order.parts_used?.length) {
      autoTable(doc, {
        startY: y,
        head: [['Part / Material', 'Qty', 'Unit Cost', 'Line Total']],
        body: order.parts_used.map(p => [
          p.part_name, p.quantity,
          fmtCurrency(p.unit_cost),
          fmtCurrency(p.unit_cost * p.quantity),
        ]),
        foot: [['', '', 'Parts Total', fmtCurrency(partsTotal(order.parts_used))]],
        theme: 'striped',
        styles: { fontSize: 9 },
        headStyles: { fillColor: [30, 58, 95], textColor: 255 },
        footStyles: { fillColor: [15, 23, 42], textColor: 255, fontStyle: 'bold' },
        margin: { left: 14, right: 14 },
      })
      y = (doc.lastAutoTable?.finalY || y) + 8
    }

    autoTable(doc, {
      startY: y,
      body: [
        ['Labour Cost', fmtCurrency(order.labour_cost)],
        ['Parts Cost', fmtCurrency(order.parts_cost)],
        ['Total Cost', fmtCurrency(order.total_cost)],
      ],
      theme: 'plain',
      styles: { fontSize: 10 },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 60 }, 1: { halign: 'right', fontStyle: 'bold', cellWidth: 60 } },
      margin: { left: 110, right: 14 },
    })

    const pgCount = doc.internal.getNumberOfPages()
    for (let i = 1; i <= pgCount; i++) {
      doc.setPage(i); doc.setFontSize(7); doc.setTextColor(156, 163, 175)
      doc.text(`TyrePulse Fleet Intelligence — Job Card — ${order.work_order_no} — Page ${i} of ${pgCount}`, 14, 290)
    }
    doc.save(`${order.work_order_no}-job-card.pdf`)
  }

  // ── Excel export ──────────────────────────────────────────────────────────
  function exportExcel() {
    const rows = filtered.map(o => ({
      'Work Order No': o.work_order_no,
      'Asset No': o.asset_no,
      'Tyre Serial': o.tyre_serial || '',
      'Position': o.tyre_position || '',
      'Work Type': o.work_type,
      'Status': o.status,
      'Priority': o.priority,
      'Description': o.description || '',
      'Technician': o.technician_name || '',
      'Workshop': o.workshop_name || '',
      'Site': o.site || '',
      'Country': o.country || '',
      'Opened': fmtDate(o.opened_at),
      'Started': fmtDate(o.started_at),
      'Completed': fmtDate(o.completed_at),
      'Target': fmtDate(o.target_completion),
      'Labour Hrs': o.labour_hours || 0,
      'Labour Cost': o.labour_cost || 0,
      'Parts Cost': o.parts_cost || 0,
      'Total Cost': o.total_cost || 0,
      'Days Open': daysOpen(o),
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Work Orders')
    XLSX.writeFile(wb, `work-orders-${new Date().toISOString().slice(0, 10)}.xlsx`)
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="text-center">
          <Loader2 className="animate-spin text-blue-400 mx-auto mb-3" size={40} />
          <p className="text-gray-400">Loading work orders…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Work Orders"
        subtitle={`Workshop job card management — ${orders.length} total`}
        icon={Wrench}
        onRefresh={load}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={exportExcel} className="btn-secondary flex items-center gap-2 text-xs px-3 py-1.5">
              <FileSpreadsheet size={14} /> Excel
            </button>
            <button onClick={openNew} className="btn-primary flex items-center gap-2 text-sm px-4">
              <Plus size={15} /> New Work Order
            </button>
          </div>
        }
      />

      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl p-4 flex items-center gap-3 text-red-300">
          <AlertTriangle size={18} />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
        {[
          { label: 'Open', value: stats.open, color: 'blue', icon: Clock },
          { label: 'In Progress', value: stats.inProgress, color: 'yellow', icon: Play },
          { label: 'Awaiting Parts', value: stats.awaitParts, color: 'orange', icon: Package },
          { label: 'Overdue', value: stats.overdue, color: 'red', icon: AlertOctagon },
          { label: 'Completed Today', value: stats.completedToday, color: 'green', icon: CheckCircle },
          { label: 'Avg Days Open', value: stats.avgDaysOpen, color: 'purple', icon: Calendar },
          { label: 'Total Cost (All)', value: `R ${(stats.totalCost / 1000).toFixed(1)}k`, color: 'teal', icon: DollarSign },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className={`bg-gray-900 border border-gray-800 rounded-xl p-4`}>
            <div className={`flex items-center gap-2 mb-2`}>
              <Icon size={16} className={`text-${color}-400`} />
              <span className="text-gray-400 text-xs">{label}</span>
            </div>
            <div className={`text-2xl font-bold text-${color}-400`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">Work Orders by Type</h3>
          <div className="h-52">
            <Bar data={typeChartData} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { display: false } } }} />
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">Status Distribution</h3>
          <div className="h-52">
            <Doughnut data={statusChartData} options={{ ...CHART_OPTS, scales: undefined, plugins: { ...CHART_OPTS.plugins, legend: { position: 'right', labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 } } } } }} />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search WO#, asset, serial, description…"
              className="w-full pl-9 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          {[
            { label: 'Status', value: statusFilter, setter: setStatus, opts: ['All','Open','In Progress','Awaiting Parts','Completed','Closed','Cancelled'] },
            { label: 'Priority', value: priorityFilter, setter: setPriority, opts: ['All','Critical','High','Medium','Low'] },
            { label: 'Type', value: typeFilter, setter: setType, opts: ['All', ...WORK_TYPES] },
          ].map(({ label, value, setter, opts }) => (
            <select
              key={label}
              value={value}
              onChange={e => { setter(e.target.value); setPage(1) }}
              className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500"
            >
              {opts.map(o => <option key={o}>{o}</option>)}
            </select>
          ))}
          <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
          <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }}
            className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
          {(search || statusFilter !== 'All' || priorityFilter !== 'All' || typeFilter !== 'All' || dateFrom || dateTo) && (
            <button onClick={() => { setSearch(''); setStatus('All'); setPriority('All'); setType('All'); setDateFrom(''); setDateTo(''); setPage(1) }}
              className="px-3 py-2 bg-red-900/30 border border-red-700 rounded-lg text-red-400 text-sm hover:bg-red-900/50 transition-colors">
              Clear
            </button>
          )}
          <span className="ml-auto self-center text-gray-400 text-sm">{filtered.length} results</span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                {[
                  { label: 'WO #',        field: 'work_order_no' },
                  { label: 'Asset',       field: 'asset_no'      },
                  { label: 'Type',        field: 'work_type'     },
                  { label: 'Priority',    field: 'priority'      },
                  { label: 'Status',      field: 'status'        },
                  { label: 'Technician',  field: 'technician_name' },
                  { label: 'Opened',      field: 'opened_at'     },
                  { label: 'Target',      field: 'target_completion' },
                  { label: 'Total Cost',  field: 'total_cost'    },
                  { label: 'Actions',     field: null             },
                ].map(({ label, field }) => (
                  <th key={label}
                    className={`px-4 py-3 text-left text-gray-400 font-medium ${field ? 'cursor-pointer hover:text-white' : ''}`}
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
              {paginated.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center py-16 text-gray-500">
                    <Wrench size={40} className="mx-auto mb-3 opacity-30" />
                    <p>No work orders found</p>
                    <button onClick={openNew} className="mt-3 text-blue-400 hover:text-blue-300 text-sm">Create first work order →</button>
                  </td>
                </tr>
              )}
              {paginated.map(order => {
                const sc = STATUS_CONFIG[order.status] || STATUS_CONFIG.Open
                const pc = PRIORITY_CONFIG[order.priority] || PRIORITY_CONFIG.Medium
                const overdue = isOverdue(order)
                return (
                  <tr key={order.id} className={`border-b border-gray-800 hover:bg-gray-800/50 transition-colors ${overdue ? 'bg-red-950/10' : ''}`}>
                    <td className="px-4 py-3">
                      <span className="text-blue-400 font-mono text-xs">{order.work_order_no}</span>
                      {overdue && <span className="ml-2 text-xs text-red-400 font-medium">OVERDUE</span>}
                    </td>
                    <td className="px-4 py-3 text-white font-medium">{order.asset_no}</td>
                    <td className="px-4 py-3 text-gray-300">{order.work_type}</td>
                    <td className="px-4 py-3">
                      <span className={`flex items-center gap-1.5 ${pc.color}`}>
                        <span className={`w-2 h-2 rounded-full ${pc.dot}`} />
                        {order.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${sc.color} ${sc.bg} ${sc.border}`}>
                        {order.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">{order.technician_name || '—'}</td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{fmtDate(order.opened_at)}</td>
                    <td className={`px-4 py-3 whitespace-nowrap ${overdue ? 'text-red-400 font-medium' : 'text-gray-400'}`}>{fmtDate(order.target_completion)}</td>
                    <td className="px-4 py-3 text-green-400 font-medium">{fmtCurrency(order.total_cost)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setViewOrder(order)} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"><Eye size={14} /></button>
                        <button onClick={() => openEdit(order)} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"><Edit2 size={14} /></button>
                        <button onClick={() => exportJobCard(order)} className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"><FileText size={14} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
            <span className="text-gray-400 text-sm">Page {page} of {totalPages} · {filtered.length} records</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="px-3 py-1.5 bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded disabled:opacity-40">Prev</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="px-3 py-1.5 bg-gray-800 border border-gray-700 text-gray-300 text-sm rounded disabled:opacity-40">Next</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Create / Edit Modal ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <motion.div initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
              className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-3xl max-h-[92vh] overflow-y-auto shadow-2xl">
              <div className="sticky top-0 bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between z-10">
                <h2 className="text-white font-bold text-lg">{editOrder ? 'Edit Work Order' : 'New Work Order'}</h2>
                <button onClick={() => setShowForm(false)} className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-5">
                {/* Row 1 */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Asset No *</label>
                    <input value={formData.asset_no} onChange={e => setFormData(f => ({ ...f, asset_no: e.target.value }))}
                      placeholder="e.g. TRK-001" className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Work Type *</label>
                    <select value={formData.work_type} onChange={e => setFormData(f => ({ ...f, work_type: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500">
                      {WORK_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                </div>
                {/* Row 2 */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Tyre Serial</label>
                    <input value={formData.tyre_serial} onChange={e => setFormData(f => ({ ...f, tyre_serial: e.target.value }))}
                      placeholder="Serial number" className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Position</label>
                    <input value={formData.tyre_position} onChange={e => setFormData(f => ({ ...f, tyre_position: e.target.value }))}
                      placeholder="e.g. Steer L" className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Priority</label>
                    <select value={formData.priority} onChange={e => setFormData(f => ({ ...f, priority: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500">
                      {['Critical','High','Medium','Low'].map(p => <option key={p}>{p}</option>)}
                    </select>
                  </div>
                </div>
                {/* Row 3 */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Status</label>
                    <select value={formData.status} onChange={e => setFormData(f => ({ ...f, status: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500">
                      {Object.keys(STATUS_CONFIG).map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Technician</label>
                    <input value={formData.technician_name} onChange={e => setFormData(f => ({ ...f, technician_name: e.target.value }))}
                      placeholder="Name" className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Workshop</label>
                    <input value={formData.workshop_name} onChange={e => setFormData(f => ({ ...f, workshop_name: e.target.value }))}
                      placeholder="Workshop name" className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                </div>
                {/* Row 4 */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Site</label>
                    <input value={formData.site} onChange={e => setFormData(f => ({ ...f, site: e.target.value }))}
                      placeholder="Site/branch" className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Country</label>
                    <input value={formData.country} onChange={e => setFormData(f => ({ ...f, country: e.target.value }))}
                      placeholder="Country" className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                </div>
                {/* Row 5 */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Opened At</label>
                    <input type="datetime-local" value={formData.opened_at} onChange={e => setFormData(f => ({ ...f, opened_at: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                  <div>
                    <label className="text-gray-400 text-xs mb-1 block">Target Completion</label>
                    <input type="datetime-local" value={formData.target_completion} onChange={e => setFormData(f => ({ ...f, target_completion: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                </div>
                {/* Description */}
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Description</label>
                  <textarea value={formData.description} onChange={e => setFormData(f => ({ ...f, description: e.target.value }))}
                    rows={3} placeholder="Work description, fault details, observations…"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 resize-none" />
                </div>
                {/* Labour */}
                <div>
                  <label className="text-gray-400 text-xs mb-2 block">Labour Cost</label>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <input type="number" min="0" step="0.5" value={formData.labour_hours} onChange={e => setFormData(f => ({ ...f, labour_hours: e.target.value }))}
                        placeholder="Hours" className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
                      <span className="text-gray-500 text-xs mt-1 block">Labour Hours</span>
                    </div>
                    <div>
                      <input type="number" min="0" step="0.01" value={formData.labour_rate} onChange={e => setFormData(f => ({ ...f, labour_rate: e.target.value }))}
                        placeholder="Rate/hr" className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
                      <span className="text-gray-500 text-xs mt-1 block">Rate per Hour (R)</span>
                    </div>
                    <div>
                      <input type="number" min="0" step="0.01" value={formData.labour_cost} onChange={e => setFormData(f => ({ ...f, labour_cost: e.target.value }))}
                        placeholder="Override" className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
                      <span className="text-gray-500 text-xs mt-1 block">Labour Cost (Override)</span>
                    </div>
                  </div>
                </div>
                {/* Parts */}
                <div>
                  <label className="text-gray-400 text-xs mb-2 block">Parts / Materials Used</label>
                  <div className="space-y-2">
                    {(formData.parts_used || []).map((p, i) => (
                      <div key={i} className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2">
                        <span className="text-white text-sm flex-1">{p.part_name}</span>
                        <span className="text-gray-400 text-sm">× {p.quantity}</span>
                        <span className="text-green-400 text-sm">{fmtCurrency(p.unit_cost)}</span>
                        <span className="text-gray-400 text-xs">= {fmtCurrency(p.unit_cost * p.quantity)}</span>
                        <button onClick={() => removePart(i)} className="text-red-400 hover:text-red-300"><X size={14} /></button>
                      </div>
                    ))}
                    <div className="grid grid-cols-4 gap-2">
                      <input value={partRow.part_name} onChange={e => setPartRow(r => ({ ...r, part_name: e.target.value }))}
                        placeholder="Part name" className="col-span-2 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
                      <input type="number" min="1" value={partRow.quantity} onChange={e => setPartRow(r => ({ ...r, quantity: e.target.value }))}
                        placeholder="Qty" className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
                      <div className="flex gap-1">
                        <input type="number" min="0" step="0.01" value={partRow.unit_cost} onChange={e => setPartRow(r => ({ ...r, unit_cost: e.target.value }))}
                          placeholder="Unit R" className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500" />
                        <button onClick={addPart} className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors"><Plus size={14} /></button>
                      </div>
                    </div>
                    {(formData.parts_used?.length > 0) && (
                      <div className="text-right text-sm text-green-400 font-medium">Parts Total: {fmtCurrency(partsTotal(formData.parts_used))}</div>
                    )}
                  </div>
                </div>
                {/* Notes */}
                <div>
                  <label className="text-gray-400 text-xs mb-1 block">Notes</label>
                  <textarea value={formData.notes} onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))}
                    rows={2} placeholder="Additional notes, follow-up required…"
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:border-blue-500 resize-none" />
                </div>
              </div>
              <div className="sticky bottom-0 bg-gray-900 border-t border-gray-800 px-6 py-4 flex items-center justify-between">
                <div className="text-gray-400 text-sm">
                  Total Cost: <span className="text-green-400 font-bold">
                    {fmtCurrency((parseFloat(formData.labour_hours || 0) * parseFloat(formData.labour_rate || 0) || parseFloat(formData.labour_cost || 0)) + partsTotal(formData.parts_used))}
                  </span>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setShowForm(false)} className="px-4 py-2 bg-gray-800 border border-gray-700 text-gray-300 hover:text-white text-sm rounded-lg transition-colors">Cancel</button>
                  <button onClick={handleSave} disabled={saving}
                    className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors">
                    {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                    {saving ? 'Saving…' : editOrder ? 'Save Changes' : 'Create Work Order'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Detail Drawer ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {viewOrder && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:justify-end bg-black/60 backdrop-blur-sm">
            <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="w-full sm:w-[480px] h-full bg-gray-900 border-l border-gray-700 overflow-y-auto shadow-2xl">
              <div className="sticky top-0 bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between z-10">
                <div>
                  <h2 className="text-white font-bold">{viewOrder.work_order_no}</h2>
                  <p className="text-gray-400 text-sm">{viewOrder.work_type} · {viewOrder.asset_no}</p>
                </div>
                <button onClick={() => setViewOrder(null)} className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"><X size={18} /></button>
              </div>
              <div className="p-6 space-y-5">
                {/* Status + Priority */}
                <div className="flex items-center gap-3">
                  {(() => { const sc = STATUS_CONFIG[viewOrder.status] || STATUS_CONFIG.Open; const Icon = sc.icon
                    return <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border ${sc.color} ${sc.bg} ${sc.border}`}><Icon size={14} />{viewOrder.status}</span>
                  })()}
                  {(() => { const pc = PRIORITY_CONFIG[viewOrder.priority] || PRIORITY_CONFIG.Medium
                    return <span className={`flex items-center gap-1.5 text-sm ${pc.color}`}><span className={`w-2.5 h-2.5 rounded-full ${pc.dot}`} />{viewOrder.priority} Priority</span>
                  })()}
                </div>

                {/* Status transitions */}
                {STATUS_FLOW[viewOrder.status]?.length > 0 && (
                  <div>
                    <p className="text-gray-400 text-xs mb-2">Transition to:</p>
                    <div className="flex flex-wrap gap-2">
                      {STATUS_FLOW[viewOrder.status].map(ns => (
                        <button key={ns} onClick={() => transitionStatus(viewOrder, ns)}
                          className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                            ns === 'Cancelled' ? 'border-red-700 text-red-400 hover:bg-red-900/30' :
                            ns === 'Completed' ? 'border-green-700 text-green-400 hover:bg-green-900/30' :
                            'border-blue-700 text-blue-400 hover:bg-blue-900/30'
                          }`}>{ns}</button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Details */}
                <div className="space-y-3">
                  {[
                    ['Asset No', viewOrder.asset_no],
                    ['Tyre Serial', viewOrder.tyre_serial],
                    ['Position', viewOrder.tyre_position],
                    ['Technician', viewOrder.technician_name],
                    ['Workshop', viewOrder.workshop_name],
                    ['Site', viewOrder.site],
                    ['Country', viewOrder.country],
                    ['Opened', fmtDateTime(viewOrder.opened_at)],
                    ['Started', fmtDateTime(viewOrder.started_at)],
                    ['Completed', fmtDateTime(viewOrder.completed_at)],
                    ['Target', fmtDateTime(viewOrder.target_completion)],
                    ['Days Open', daysOpen(viewOrder)],
                  ].filter(([, v]) => v).map(([label, value]) => (
                    <div key={label} className="flex justify-between py-2 border-b border-gray-800">
                      <span className="text-gray-400 text-sm">{label}</span>
                      <span className="text-white text-sm font-medium">{value}</span>
                    </div>
                  ))}
                </div>

                {viewOrder.description && (
                  <div className="bg-gray-800 rounded-xl p-4">
                    <p className="text-gray-400 text-xs mb-2">Description</p>
                    <p className="text-white text-sm leading-relaxed">{viewOrder.description}</p>
                  </div>
                )}

                {/* Parts */}
                {viewOrder.parts_used?.length > 0 && (
                  <div>
                    <p className="text-gray-400 text-xs mb-2">Parts Used</p>
                    <div className="space-y-2">
                      {viewOrder.parts_used.map((p, i) => (
                        <div key={i} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                          <span className="text-white text-sm">{p.part_name} × {p.quantity}</span>
                          <span className="text-green-400 text-sm">{fmtCurrency(p.unit_cost * p.quantity)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Costs */}
                <div className="bg-gray-800 rounded-xl p-4 space-y-2">
                  <p className="text-gray-400 text-xs mb-3">Cost Summary</p>
                  <div className="flex justify-between"><span className="text-gray-400 text-sm">Labour</span><span className="text-white text-sm">{fmtCurrency(viewOrder.labour_cost)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-400 text-sm">Parts</span><span className="text-white text-sm">{fmtCurrency(viewOrder.parts_cost)}</span></div>
                  <div className="flex justify-between border-t border-gray-700 pt-2 mt-2"><span className="text-white font-semibold text-sm">Total</span><span className="text-green-400 font-bold text-lg">{fmtCurrency(viewOrder.total_cost)}</span></div>
                </div>

                {viewOrder.notes && (
                  <div className="bg-gray-800 rounded-xl p-4">
                    <p className="text-gray-400 text-xs mb-2">Notes</p>
                    <p className="text-gray-300 text-sm leading-relaxed">{viewOrder.notes}</p>
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  <button onClick={() => { setViewOrder(null); openEdit(viewOrder) }}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-colors">
                    <Edit2 size={15} />Edit
                  </button>
                  <button onClick={() => exportJobCard(viewOrder)}
                    className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-gray-700 hover:bg-gray-600 text-white text-sm font-medium rounded-xl transition-colors">
                    <FileText size={15} />Job Card PDF
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
