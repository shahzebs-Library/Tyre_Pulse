import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import {
  AlertTriangle, AlertOctagon, ShieldAlert, ShieldCheck,
  Plus, X, Search, Filter, Download, FileText,
  FileSpreadsheet, ChevronRight, ChevronDown, Eye,
  RefreshCw, CheckCircle, Clock, Activity, Package,
  Tag, Calendar, Building2, Wrench, TrendingDown,
  Info, BarChart3, List, GitBranch, Star, XCircle,
  ArrowRight, Loader2, Flag, Hash, Layers,
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
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend,
)

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

const LS_KEY = 'tp_recalls'

const SEVERITY_CFG = {
  Critical: { text: 'text-red-400',    bg: 'bg-red-900/30',    border: 'border-red-700',    dot: 'bg-red-500',    pdfColor: [127, 29, 29] },
  High:     { text: 'text-orange-400', bg: 'bg-orange-900/30', border: 'border-orange-700', dot: 'bg-orange-500', pdfColor: [124, 45, 18] },
  Medium:   { text: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-700', dot: 'bg-yellow-500', pdfColor: [113, 63, 18] },
  Low:      { text: 'text-blue-400',   bg: 'bg-blue-900/30',   border: 'border-blue-700',   dot: 'bg-blue-500',   pdfColor: [30, 58, 138] },
}

const STATUS_CFG = {
  Active:     { text: 'text-red-400',    bg: 'bg-red-900/30',    border: 'border-red-700'    },
  Monitoring: { text: 'text-yellow-400', bg: 'bg-yellow-900/30', border: 'border-yellow-700' },
  Closed:     { text: 'text-green-400',  bg: 'bg-green-900/30',  border: 'border-green-700'  },
}

const SOURCE_OPTS  = ['Manufacturer', 'Internal', 'Government', 'Insurance']
const STATUS_OPTS  = ['Active', 'Monitoring', 'Closed']
const SEVERITY_OPTS = ['Critical', 'High', 'Medium', 'Low']
const TAB_OPTS = ['Registry', 'Batch Detector', 'Timeline', 'Brand History', 'Analytics']

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now()
}

function daysBetween(a, b) {
  if (!a || !b) return null
  return Math.round((new Date(b) - new Date(a)) / 86400000)
}

function nowStr() {
  return new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function Badge({ label, cfg, small }) {
  const c = cfg ?? { text: 'text-gray-400', bg: 'bg-gray-800', border: 'border-gray-600' }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold ${c.text} ${c.bg} ${c.border} ${small ? 'text-[10px]' : ''}`}>
      {c.dot && <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />}
      {label}
    </span>
  )
}

function KpiCard({ icon: Icon, label, value, sub, color = 'text-blue-400', warn }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-gray-900 border ${warn ? 'border-red-700/60' : 'border-gray-800'} rounded-xl p-4 flex items-start gap-3`}
    >
      <div className={`p-2 rounded-lg bg-gray-800 ${color}`}>
        <Icon size={18} />
      </div>
      <div>
        <p className="text-gray-400 text-xs">{label}</p>
        <p className={`text-2xl font-bold mt-0.5 ${color}`}>{value}</p>
        {sub && <p className="text-gray-500 text-xs mt-0.5">{sub}</p>}
      </div>
    </motion.div>
  )
}

const EMPTY_FORM = {
  recall_number: '',
  brand: '',
  affected_sizes: [],
  affected_serial_prefix: '',
  issue_date: '',
  severity: 'High',
  description: '',
  action_required: '',
  source: 'Manufacturer',
  status: 'Active',
}

export default function RecallTracker() {
  const { profile } = useAuth()
  const { appSettings } = useSettings()
  const isAdmin = profile?.role === 'Admin'

  const [tyres, setTyres]       = useState([])
  const [recalls, setRecalls]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState('Registry')

  const [search, setSearch]       = useState('')
  const [filterSeverity, setFilterSeverity] = useState('All')
  const [filterStatus, setFilterStatus]     = useState('All')
  const [filterSource, setFilterSource]     = useState('All')

  const [showAddModal, setShowAddModal]   = useState(false)
  const [editRecall, setEditRecall]       = useState(null)
  const [form, setForm]                   = useState(EMPTY_FORM)
  const [sizeInput, setSizeInput]         = useState('')
  const [formError, setFormError]         = useState('')
  const [saving, setSaving]               = useState(false)

  const [drawer, setDrawer]   = useState(null)
  const [drawerSearch, setDrawerSearch] = useState('')

  const bannerRef = useRef(null)
  const listRef   = useRef(null)

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadRecalls = useCallback(() => {
    try {
      const raw = localStorage.getItem(LS_KEY)
      setRecalls(raw ? JSON.parse(raw) : [])
    } catch {
      setRecalls([])
    }
  }, [])

  const saveRecalls = useCallback((list) => {
    localStorage.setItem(LS_KEY, JSON.stringify(list))
    setRecalls(list)
  }, [])

  useEffect(() => {
    loadRecalls()
  }, [loadRecalls])

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await fetchAllPages((from, to) => supabase
        .from('tyre_records')
        .select('id, asset_no, serial_number, brand, size, position, site, country, tread_depth, risk_level, issue_date, km_at_fitment, km_at_removal')
        .range(from, to))
      setTyres(data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  // ── Matching logic ─────────────────────────────────────────────────────────
  const matchTyresForRecall = useCallback((recall) => {
    return tyres.filter(t => {
      const brandMatch = t.brand?.toLowerCase().trim() === recall.brand?.toLowerCase().trim()
      if (!brandMatch) return false
      const sizes = recall.affected_sizes ?? []
      const sizeMatch = sizes.length === 0 || sizes.some(s =>
        t.size?.toLowerCase().trim() === s.toLowerCase().trim()
      )
      if (!sizeMatch) return false
      if (recall.affected_serial_prefix) {
        const prefix = recall.affected_serial_prefix.toLowerCase()
        if (!t.serial_number?.toLowerCase().startsWith(prefix)) return false
      }
      return true
    })
  }, [tyres])

  // ── Derived KPIs ───────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const active = recalls.filter(r => r.status === 'Active')
    const affectedSet = new Set()
    active.forEach(r => matchTyresForRecall(r).forEach(t => affectedSet.add(t.id)))

    const recallsWithHit = active.filter(r => matchTyresForRecall(r).length > 0).length
    const responseRate = active.length > 0 ? Math.round((recallsWithHit / active.length) * 100) : 0

    const closed = recalls.filter(r => r.status === 'Closed' && r.closed_at && r.issue_date)
    const avgDays = closed.length > 0
      ? Math.round(closed.reduce((s, r) => s + (daysBetween(r.issue_date, r.closed_at) ?? 0), 0) / closed.length)
      : null

    return {
      activeCount: active.length,
      affectedTyres: affectedSet.size,
      responseRate,
      avgDaysToClose: avgDays,
    }
  }, [recalls, matchTyresForRecall])

  // ── Filtered recalls ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return recalls.filter(r => {
      if (filterSeverity !== 'All' && r.severity !== filterSeverity) return false
      if (filterStatus !== 'All' && r.status !== filterStatus) return false
      if (filterSource !== 'All' && r.source !== filterSource) return false
      if (search) {
        const s = search.toLowerCase()
        return (
          r.recall_number?.toLowerCase().includes(s) ||
          r.brand?.toLowerCase().includes(s) ||
          r.description?.toLowerCase().includes(s) ||
          r.affected_sizes?.some(sz => sz.toLowerCase().includes(s))
        )
      }
      return true
    }).sort((a, b) => new Date(b.issue_date) - new Date(a.issue_date))
  }, [recalls, filterSeverity, filterStatus, filterSource, search])

  // ── Batch failure detector ─────────────────────────────────────────────────
  const batchAnalysis = useMemo(() => {
    const map = {}
    tyres.forEach(t => {
      if (!t.serial_number || !t.brand) return
      const prefix = t.serial_number.slice(0, 4).toUpperCase()
      const key = `${t.brand.trim().toLowerCase()}__${prefix}`
      if (!map[key]) map[key] = { brand: t.brand.trim(), prefix, tyres: [] }
      map[key].tyres.push(t)
    })
    const results = []
    Object.values(map).forEach(({ brand, prefix, tyres: batch }) => {
      if (batch.length < 5) return
      const failed = batch.filter(t => t.risk_level === 'Critical' || t.risk_level === 'High').length
      const rate = failed / batch.length
      if (rate > 0.3) {
        results.push({
          brand,
          prefix,
          total: batch.length,
          failed,
          rate: Math.round(rate * 100),
          positions: [...new Set(batch.map(t => t.position).filter(Boolean))],
          sites: [...new Set(batch.map(t => t.site).filter(Boolean))],
          tyreList: batch,
        })
      }
    })
    return results.sort((a, b) => b.rate - a.rate)
  }, [tyres])

  // ── Brand history ──────────────────────────────────────────────────────────
  const brandHistory = useMemo(() => {
    const map = {}
    recalls.forEach(r => {
      const b = r.brand?.trim() || 'Unknown'
      if (!map[b]) map[b] = { brand: b, total: 0, active: 0, critical: 0, closedDays: [] }
      map[b].total++
      if (r.status === 'Active') map[b].active++
      if (r.severity === 'Critical') map[b].critical++
      if (r.status === 'Closed' && r.closed_at && r.issue_date) {
        const d = daysBetween(r.issue_date, r.closed_at)
        if (d != null) map[b].closedDays.push(d)
      }
    })
    return Object.values(map).map(b => ({
      ...b,
      avgDaysToClose: b.closedDays.length ? Math.round(b.closedDays.reduce((s, d) => s + d, 0) / b.closedDays.length) : null,
      score: Math.max(0, 100 - b.active * 10 - b.critical * 5),
    })).sort((a, b) => a.score - b.score)
  }, [recalls])

  // ── Timeline ──────────────────────────────────────────────────────────────
  const timeline = useMemo(() => {
    return [...recalls].sort((a, b) => new Date(b.issue_date) - new Date(a.issue_date))
  }, [recalls])

  // ── Analytics chart data ───────────────────────────────────────────────────
  const chartData = useMemo(() => {
    const severityCount = { Critical: 0, High: 0, Medium: 0, Low: 0 }
    const statusCount   = { Active: 0, Monitoring: 0, Closed: 0 }
    const sourceCount   = {}
    const monthMap      = {}

    recalls.forEach(r => {
      if (r.severity && severityCount[r.severity] != null) severityCount[r.severity]++
      if (r.status && statusCount[r.status] != null) statusCount[r.status]++
      const src = r.source || 'Unknown'
      sourceCount[src] = (sourceCount[src] || 0) + 1
      const m = r.issue_date?.slice(0, 7)
      if (m) monthMap[m] = (monthMap[m] || 0) + 1
    })

    const months = Object.keys(monthMap).sort()

    return {
      severity: {
        labels: Object.keys(severityCount),
        datasets: [{
          label: 'By Severity',
          data: Object.values(severityCount),
          backgroundColor: ['#ef4444', '#f97316', '#eab308', '#3b82f6'],
        }],
      },
      status: {
        labels: Object.keys(statusCount),
        datasets: [{
          label: 'By Status',
          data: Object.values(statusCount),
          backgroundColor: ['#ef4444', '#eab308', '#22c55e'],
        }],
      },
      monthly: {
        labels: months,
        datasets: [{
          label: 'Recalls Issued',
          data: months.map(m => monthMap[m]),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.15)',
          fill: true,
          tension: 0.4,
        }],
      },
    }
  }, [recalls])

  // ── Form helpers ──────────────────────────────────────────────────────────
  function openAdd() {
    setForm(EMPTY_FORM)
    setSizeInput('')
    setFormError('')
    setEditRecall(null)
    setShowAddModal(true)
  }

  function openEdit(r) {
    setForm({ ...r })
    setSizeInput('')
    setFormError('')
    setEditRecall(r.id)
    setShowAddModal(true)
  }

  function addSize() {
    const s = sizeInput.trim()
    if (!s) return
    if (!form.affected_sizes.includes(s)) {
      setForm(f => ({ ...f, affected_sizes: [...f.affected_sizes, s] }))
    }
    setSizeInput('')
  }

  function removeSize(s) {
    setForm(f => ({ ...f, affected_sizes: f.affected_sizes.filter(x => x !== s) }))
  }

  function handleSave() {
    if (!form.recall_number.trim()) { setFormError('Recall number required'); return }
    if (!form.brand.trim()) { setFormError('Brand required'); return }
    if (!form.issue_date) { setFormError('Issue date required'); return }
    if (form.affected_sizes.length === 0) { setFormError('At least one affected size required'); return }

    setSaving(true)
    try {
      let next
      if (editRecall) {
        next = recalls.map(r => r.id === editRecall ? { ...r, ...form } : r)
      } else {
        const dupe = recalls.find(r => r.recall_number === form.recall_number.trim())
        if (dupe) { setFormError('Recall number already exists'); setSaving(false); return }
        next = [...recalls, {
          ...form,
          id: uuid(),
          recall_number: form.recall_number.trim(),
          brand: form.brand.trim(),
          created_at: new Date().toISOString(),
          closed_at: form.status === 'Closed' ? new Date().toISOString() : null,
        }]
      }
      saveRecalls(next)
      setShowAddModal(false)
    } finally {
      setSaving(false)
    }
  }

  function handleClose(recallId) {
    const next = recalls.map(r =>
      r.id === recallId ? { ...r, status: 'Closed', closed_at: new Date().toISOString() } : r
    )
    saveRecalls(next)
  }

  function handleDelete(recallId) {
    if (!window.confirm('Delete this recall record?')) return
    saveRecalls(recalls.filter(r => r.id !== recallId))
  }

  // ── Drawer ────────────────────────────────────────────────────────────────
  function openDrawer(recall) {
    setDrawer(recall)
    setDrawerSearch('')
  }

  const drawerTyres = useMemo(() => {
    if (!drawer) return []
    const matches = matchTyresForRecall(drawer)
    if (!drawerSearch) return matches
    const s = drawerSearch.toLowerCase()
    return matches.filter(t =>
      t.serial_number?.toLowerCase().includes(s) ||
      t.asset_no?.toLowerCase().includes(s) ||
      t.site?.toLowerCase().includes(s)
    )
  }, [drawer, drawerSearch, matchTyresForRecall])

  // ── Export ────────────────────────────────────────────────────────────────
  function exportPdf() {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    const pw = doc.internal.pageSize.width

    doc.setFillColor(22, 101, 52)
    doc.rect(0, 0, pw, 22, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(14)
    doc.setFont('helvetica', 'bold')
    doc.text('TYREPULSE · Tyre Recall & Batch Quality Tracker', 14, 10)
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text(`Generated: ${nowStr()}  |  ${recalls.length} recalls`, pw - 14, 17, { align: 'right' })

    doc.setFontSize(11)
    doc.setTextColor(200, 200, 200)
    doc.text('Active Recalls', 14, 30)

    autoTable(doc, {
      startY: 34,
      head: [['Recall #', 'Brand', 'Affected Sizes', 'Date Issued', 'Severity', 'Source', 'Status', 'Description']],
      body: recalls.map(r => [
        r.recall_number,
        r.brand,
        (r.affected_sizes ?? []).join(', '),
        r.issue_date,
        r.severity,
        r.source,
        r.status,
        r.description,
      ]),
      styles: { fontSize: 7.5, cellPadding: 2 },
      headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 14, right: 14 },
      didParseCell: (data) => {
        if (data.section === 'body' && data.column.index === 4) {
          const val = String(data.cell.raw ?? '').trim()
          const c = SEVERITY_CFG[val]?.pdfColor
          if (c) { data.cell.styles.fillColor = c; data.cell.styles.textColor = [255, 255, 255] }
        }
      },
    })

    const affectedRows = []
    recalls.filter(r => r.status === 'Active').forEach(r => {
      matchTyresForRecall(r).forEach(t => {
        affectedRows.push([r.recall_number, t.serial_number, t.asset_no, t.position, t.site, t.country, t.km_at_removal ? 'Removed' : 'Fitted'])
      })
    })

    if (affectedRows.length > 0) {
      doc.addPage()
      doc.setFontSize(11)
      doc.setTextColor(200, 200, 200)
      doc.text('Affected Fleet Tyres (Active Recalls)', 14, 20)
      autoTable(doc, {
        startY: 24,
        head: [['Recall #', 'Serial', 'Asset', 'Position', 'Site', 'Country', 'Status']],
        body: affectedRows,
        styles: { fontSize: 7.5, cellPadding: 2 },
        headStyles: { fillColor: [220, 38, 38], textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 14, right: 14 },
      })
    }

    doc.save(`TyrePulse_Recall_Report_${new Date().toISOString().slice(0,10)}.pdf`)
  }

  function exportExcel() {
    const wb = XLSX.utils.book_new()

    const recallRows = recalls.map(r => ({
      'Recall #': r.recall_number,
      'Brand': r.brand,
      'Affected Sizes': (r.affected_sizes ?? []).join(', '),
      'Serial Prefix': r.affected_serial_prefix,
      'Issue Date': r.issue_date,
      'Severity': r.severity,
      'Source': r.source,
      'Status': r.status,
      'Description': r.description,
      'Action Required': r.action_required,
      'Created At': r.created_at,
      'Closed At': r.closed_at,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(recallRows), 'Recalls')

    const affectedRows = []
    recalls.forEach(r => {
      matchTyresForRecall(r).forEach(t => {
        affectedRows.push({
          'Recall #': r.recall_number,
          'Brand': r.brand,
          'Severity': r.severity,
          'Serial Number': t.serial_number,
          'Asset No': t.asset_no,
          'Position': t.position,
          'Site': t.site,
          'Country': t.country,
          'Risk Level': t.risk_level,
          'Tyre Status': t.km_at_removal ? 'Removed' : 'Fitted',
        })
      })
    })
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(affectedRows), 'Affected Tyres')

    XLSX.writeFile(wb, `TyrePulse_Recall_Registry_${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const activeRecalls = recalls.filter(r => r.status === 'Active')
  const totalAffectedCount = useMemo(() => {
    const s = new Set()
    activeRecalls.forEach(r => matchTyresForRecall(r).forEach(t => s.add(t.id)))
    return s.size
  }, [activeRecalls, matchTyresForRecall])

  return (
    <div className="space-y-6">

      <PageHeader
        title="Tyre Recall & Batch Quality Tracker"
        subtitle="Monitor tyre recalls, batch defects, and quality alerts"
        icon={ShieldAlert}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={exportPdf}
              className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm text-gray-300 transition"
            >
              <FileText size={14} /> PDF
            </button>
            <button
              onClick={exportExcel}
              className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm text-gray-300 transition"
            >
              <FileSpreadsheet size={14} /> Excel
            </button>
            {isAdmin && (
              <button
                onClick={openAdd}
                className="flex items-center gap-1.5 px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-sm font-semibold text-white transition"
              >
                <Plus size={14} /> Add Recall
              </button>
            )}
          </div>
        }
      />

      {/* Active Recall Alert Banner */}
      <AnimatePresence>
        {activeRecalls.length > 0 && (
          <motion.div
            ref={bannerRef}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="bg-red-900/40 border border-red-700 rounded-xl px-4 py-3 flex items-center justify-between gap-3 cursor-pointer"
            onClick={() => {
              setActiveTab('Registry')
              setFilterStatus('Active')
              setTimeout(() => listRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
            }}
          >
            <div className="flex items-center gap-3">
              <AlertOctagon className="text-red-400 shrink-0" size={20} />
              <div>
                <p className="font-bold text-red-300 text-sm">
                  {activeRecalls.length} Active Recall{activeRecalls.length !== 1 ? 's' : ''} —&nbsp;
                  {totalAffectedCount} fleet {totalAffectedCount === 1 ? 'tyre' : 'tyres'} may be affected
                </p>
                <p className="text-red-400/80 text-xs">Immediate review required. Click to view active recalls.</p>
              </div>
            </div>
            <ArrowRight className="text-red-400 shrink-0" size={18} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={AlertOctagon}
          label="Active Recalls"
          value={kpis.activeCount}
          sub="requires action"
          color={kpis.activeCount > 0 ? 'text-red-400' : 'text-green-400'}
          warn={kpis.activeCount > 0}
        />
        <KpiCard
          icon={Package}
          label="Affected Fleet Tyres"
          value={kpis.affectedTyres.toLocaleString()}
          sub="matched to active recalls"
          color={kpis.affectedTyres > 0 ? 'text-orange-400' : 'text-gray-400'}
        />
        <KpiCard
          icon={CheckCircle}
          label="Recall Response Rate"
          value={`${kpis.responseRate}%`}
          sub="recalls with identified tyres"
          color={kpis.responseRate >= 80 ? 'text-green-400' : kpis.responseRate >= 50 ? 'text-yellow-400' : 'text-red-400'}
        />
        <KpiCard
          icon={Clock}
          label="Avg Days to Close"
          value={kpis.avgDaysToClose != null ? kpis.avgDaysToClose : 'N/A'}
          sub="closed recalls"
          color="text-blue-400"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 overflow-x-auto">
        {TAB_OPTS.map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
              activeTab === t
                ? 'bg-gray-700 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* ── Tab: Registry ── */}
      {activeTab === 'Registry' && (
        <div className="space-y-4" ref={listRef}>
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search recall #, brand, size…"
                className="w-full pl-8 pr-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-600"
              />
            </div>
            {[
              { label: 'Severity', val: filterSeverity, set: setFilterSeverity, opts: ['All', ...SEVERITY_OPTS] },
              { label: 'Status',   val: filterStatus,   set: setFilterStatus,   opts: ['All', ...STATUS_OPTS] },
              { label: 'Source',   val: filterSource,   set: setFilterSource,   opts: ['All', ...SOURCE_OPTS] },
            ].map(({ label, val, set, opts }) => (
              <select
                key={label}
                value={val}
                onChange={e => set(e.target.value)}
                className="px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-blue-600"
              >
                {opts.map(o => <option key={o}>{o}</option>)}
              </select>
            ))}
          </div>

          {/* Table */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-gray-400 text-xs">
                    <th className="px-4 py-3 text-left">Recall #</th>
                    <th className="px-4 py-3 text-left">Brand</th>
                    <th className="px-4 py-3 text-left">Affected Sizes</th>
                    <th className="px-4 py-3 text-left">Date Issued</th>
                    <th className="px-4 py-3 text-left">Severity</th>
                    <th className="px-4 py-3 text-left">Source</th>
                    <th className="px-4 py-3 text-left">Status</th>
                    <th className="px-4 py-3 text-center">Fleet Tyres</th>
                    <th className="px-4 py-3 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={9} className="px-4 py-10 text-center text-gray-500">
                        <Loader2 className="inline animate-spin mr-2" size={16} /> Loading tyre data…
                      </td>
                    </tr>
                  )}
                  {!loading && filtered.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center text-gray-500">
                        <ShieldCheck className="inline mb-2 text-green-600" size={32} />
                        <p className="mt-1">No recalls match current filters</p>
                      </td>
                    </tr>
                  )}
                  {!loading && filtered.map((r, i) => {
                    const affectedCount = matchTyresForRecall(r).length
                    return (
                      <motion.tr
                        key={r.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.03 }}
                        className="border-b border-gray-800/60 hover:bg-gray-800/40 transition"
                      >
                        <td className="px-4 py-3 font-mono text-blue-300 text-xs">{r.recall_number}</td>
                        <td className="px-4 py-3 font-medium text-gray-100">{r.brand}</td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {(r.affected_sizes ?? []).slice(0, 3).map(s => (
                              <span key={s} className="px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-[10px] text-gray-300 font-mono">{s}</span>
                            ))}
                            {(r.affected_sizes ?? []).length > 3 && (
                              <span className="text-gray-500 text-[10px]">+{r.affected_sizes.length - 3}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{r.issue_date}</td>
                        <td className="px-4 py-3">
                          <Badge label={r.severity} cfg={SEVERITY_CFG[r.severity]} />
                        </td>
                        <td className="px-4 py-3 text-gray-400 text-xs">{r.source}</td>
                        <td className="px-4 py-3">
                          <Badge label={r.status} cfg={STATUS_CFG[r.status]} />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`font-bold text-sm ${affectedCount > 0 ? 'text-orange-400' : 'text-gray-500'}`}>
                            {affectedCount}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => openDrawer(r)}
                              className="flex items-center gap-1 px-2 py-1 bg-blue-900/30 hover:bg-blue-900/60 border border-blue-700/50 rounded text-blue-400 text-xs transition"
                            >
                              <Eye size={12} /> View
                            </button>
                            {isAdmin && r.status !== 'Closed' && (
                              <button
                                onClick={() => handleClose(r.id)}
                                className="flex items-center gap-1 px-2 py-1 bg-green-900/30 hover:bg-green-900/60 border border-green-700/50 rounded text-green-400 text-xs transition"
                                title="Mark as Closed"
                              >
                                <CheckCircle size={12} />
                              </button>
                            )}
                            {isAdmin && (
                              <>
                                <button
                                  onClick={() => openEdit(r)}
                                  className="p-1 text-gray-400 hover:text-gray-200 transition"
                                  title="Edit"
                                >
                                  <Activity size={12} />
                                </button>
                                <button
                                  onClick={() => handleDelete(r.id)}
                                  className="p-1 text-gray-600 hover:text-red-400 transition"
                                  title="Delete"
                                >
                                  <XCircle size={12} />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t border-gray-800 text-xs text-gray-500">
              {filtered.length} of {recalls.length} recalls
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Batch Detector ── */}
      {activeTab === 'Batch Detector' && (
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-1">
              <Activity className="text-orange-400" size={18} />
              <h2 className="font-semibold text-gray-200">Automatic Batch Failure Detection</h2>
            </div>
            <p className="text-gray-500 text-xs">
              Grouped by Brand + first 4 serial chars. Flagged if failure rate &gt; 30% and batch size ≥ 5.
            </p>
          </div>

          {loading && (
            <div className="text-center py-12 text-gray-500">
              <Loader2 className="inline animate-spin mr-2" size={18} /> Scanning fleet data…
            </div>
          )}

          {!loading && batchAnalysis.length === 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center">
              <ShieldCheck className="mx-auto text-green-500 mb-3" size={40} />
              <p className="text-gray-300 font-medium">No suspicious batch failures detected</p>
              <p className="text-gray-500 text-sm mt-1">All batches are within acceptable failure thresholds</p>
            </div>
          )}

          <div className="space-y-3">
            {batchAnalysis.map((b, i) => (
              <motion.div
                key={`${b.brand}-${b.prefix}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`bg-gray-900 border rounded-xl p-4 ${
                  b.rate >= 60 ? 'border-red-700/70' : 'border-orange-700/60'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                        b.rate >= 60 ? 'bg-red-900/50 text-red-300 border border-red-700' : 'bg-orange-900/50 text-orange-300 border border-orange-700'
                      }`}>
                        {b.rate >= 60 ? 'HIGH RISK' : 'POTENTIAL ISSUE'}
                      </span>
                      <Flag className={b.rate >= 60 ? 'text-red-400' : 'text-orange-400'} size={14} />
                    </div>
                    <p className="font-semibold text-gray-100">
                      {b.brand} — Batch <span className="font-mono text-yellow-300">{b.prefix}****</span>
                    </p>
                    <p className={`text-sm mt-0.5 ${b.rate >= 60 ? 'text-red-400' : 'text-orange-400'}`}>
                      {b.failed} of {b.total} tyres failed ({b.rate}% failure rate)
                    </p>
                    <div className="flex flex-wrap gap-2 mt-2 text-xs text-gray-400">
                      {b.positions.length > 0 && (
                        <span className="flex items-center gap-1"><Layers size={10} /> Positions: {b.positions.join(', ')}</span>
                      )}
                      {b.sites.length > 0 && (
                        <span className="flex items-center gap-1"><Building2 size={10} /> Sites: {b.sites.slice(0, 3).join(', ')}{b.sites.length > 3 ? ` +${b.sites.length - 3}` : ''}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Failure rate bar */}
                    <div className="w-24">
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>Failure</span>
                        <span className="font-bold text-red-400">{b.rate}%</span>
                      </div>
                      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${b.rate >= 60 ? 'bg-red-500' : 'bg-orange-500'}`}
                          style={{ width: `${b.rate}%` }}
                        />
                      </div>
                    </div>
                    {isAdmin && (
                      <button
                        onClick={() => {
                          setForm({
                            ...EMPTY_FORM,
                            brand: b.brand,
                            affected_serial_prefix: b.prefix,
                            severity: b.rate >= 60 ? 'Critical' : 'High',
                            source: 'Internal',
                            description: `Auto-detected batch failure: ${b.failed}/${b.total} tyres (${b.rate}%) classified as High/Critical risk in batch ${b.prefix}****`,
                            issue_date: new Date().toISOString().slice(0, 10),
                          })
                          setSizeInput('')
                          setFormError('')
                          setEditRecall(null)
                          setShowAddModal(true)
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 bg-orange-900/30 hover:bg-orange-900/60 border border-orange-700/50 rounded-lg text-orange-400 text-xs font-medium transition"
                      >
                        <Plus size={12} /> Create Recall
                      </button>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tab: Timeline ── */}
      {activeTab === 'Timeline' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <h2 className="font-semibold text-gray-200 mb-5 flex items-center gap-2">
            <GitBranch className="text-blue-400" size={16} /> Recall Timeline
          </h2>
          {timeline.length === 0 && (
            <div className="text-center py-12 text-gray-500">No recalls logged yet</div>
          )}
          <div className="relative space-y-0">
            {timeline.map((r, i) => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className="flex gap-4"
              >
                {/* Left: date + connector */}
                <div className="flex flex-col items-center w-28 shrink-0">
                  <span className="text-xs text-gray-400 font-mono text-right w-full pr-2">{r.issue_date}</span>
                  <div className="flex flex-col items-center mt-1">
                    <div className={`w-3 h-3 rounded-full border-2 ${SEVERITY_CFG[r.severity]?.dot ?? 'bg-gray-500'} border-gray-900 z-10`} />
                    {i < timeline.length - 1 && <div className="w-0.5 h-8 bg-gray-800" />}
                  </div>
                </div>
                {/* Right: content */}
                <div className={`flex-1 pb-6 ${i < timeline.length - 1 ? '' : ''}`}>
                  <div className="bg-gray-800 border border-gray-700/60 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-mono text-blue-300 text-xs font-bold">{r.recall_number}</span>
                        <span className="text-gray-300 font-medium text-sm">{r.brand}</span>
                        <Badge label={r.severity} cfg={SEVERITY_CFG[r.severity]} small />
                      </div>
                      <p className="text-gray-400 text-xs line-clamp-1">{r.description}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge label={r.status} cfg={STATUS_CFG[r.status]} small />
                      <span className="text-gray-600 text-xs">{r.source}</span>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tab: Brand History ── */}
      {activeTab === 'Brand History' && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-2">
            <Star className="text-yellow-400" size={16} />
            <h2 className="font-semibold text-gray-200">Brand Recall History &amp; Reliability Scores</h2>
          </div>
          {brandHistory.length === 0 && (
            <div className="p-10 text-center text-gray-500">No brand data available</div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-gray-400 text-xs">
                  <th className="px-4 py-3 text-left">Brand</th>
                  <th className="px-4 py-3 text-center">Total Recalls</th>
                  <th className="px-4 py-3 text-center">Active</th>
                  <th className="px-4 py-3 text-center">Critical</th>
                  <th className="px-4 py-3 text-center">Avg Days to Close</th>
                  <th className="px-4 py-3 text-center">Reliability Score</th>
                </tr>
              </thead>
              <tbody>
                {brandHistory.map((b, i) => (
                  <motion.tr
                    key={b.brand}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.04 }}
                    className={`border-b border-gray-800/60 ${b.score < 60 ? 'bg-red-900/10' : ''}`}
                  >
                    <td className="px-4 py-3 font-medium text-gray-100">
                      <div className="flex items-center gap-2">
                        {b.score < 60 && <AlertTriangle className="text-red-400" size={13} />}
                        {b.brand}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-300">{b.total}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={b.active > 0 ? 'text-red-400 font-bold' : 'text-gray-400'}>{b.active}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={b.critical > 0 ? 'text-orange-400 font-bold' : 'text-gray-400'}>{b.critical}</span>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-400 text-xs">
                      {b.avgDaysToClose != null ? `${b.avgDaysToClose}d` : 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-20 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              b.score >= 80 ? 'bg-green-500' : b.score >= 60 ? 'bg-yellow-500' : 'bg-red-500'
                            }`}
                            style={{ width: `${b.score}%` }}
                          />
                        </div>
                        <span className={`text-xs font-bold ${
                          b.score >= 80 ? 'text-green-400' : b.score >= 60 ? 'text-yellow-400' : 'text-red-400'
                        }`}>{b.score}</span>
                        {b.score < 60 && <span className="text-red-400 text-[10px] font-semibold">LOW</span>}
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-gray-800 text-xs text-gray-500">
            Score = 100 − (active × 10 + total critical × 5) · Brands below 60 flagged
          </div>
        </div>
      )}

      {/* ── Tab: Analytics ── */}
      {activeTab === 'Analytics' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-3 font-medium">Recalls by Severity</p>
              <div className="h-44">
                <Bar data={chartData.severity} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { display: false } } }} />
              </div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-3 font-medium">Recalls by Status</p>
              <div className="h-44">
                <Bar data={chartData.status} options={{ ...CHART_OPTS, plugins: { ...CHART_OPTS.plugins, legend: { display: false } } }} />
              </div>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-3 font-medium">Monthly Recall Trend</p>
              <div className="h-44">
                {chartData.monthly.labels.length > 0
                  ? <Line data={chartData.monthly} options={CHART_OPTS} />
                  : <div className="h-full flex items-center justify-center text-gray-600 text-xs">Insufficient data</div>
                }
              </div>
            </div>
          </div>

          {/* Affected tyre summary by recall */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-3 font-medium flex items-center gap-1">
              <BarChart3 size={13} /> Affected Fleet Tyres per Recall
            </p>
            <div className="space-y-2">
              {filtered.filter(r => r.status === 'Active').map(r => {
                const cnt = matchTyresForRecall(r).length
                const maxCnt = Math.max(...filtered.filter(x => x.status === 'Active').map(x => matchTyresForRecall(x).length), 1)
                return (
                  <div key={r.id} className="flex items-center gap-3">
                    <span className="w-28 text-xs font-mono text-blue-300 truncate">{r.recall_number}</span>
                    <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-orange-500 rounded-full transition-all"
                        style={{ width: `${(cnt / maxCnt) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-orange-400 w-6 text-right font-bold">{cnt}</span>
                  </div>
                )
              })}
              {filtered.filter(r => r.status === 'Active').length === 0 && (
                <p className="text-gray-500 text-xs text-center py-4">No active recalls to display</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Affected Tyres Drawer ── */}
      <AnimatePresence>
        {drawer && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black z-40"
              onClick={() => setDrawer(null)}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'tween', duration: 0.25 }}
              className="fixed right-0 top-0 h-full w-full max-w-2xl bg-gray-900 border-l border-gray-800 z-50 flex flex-col overflow-hidden"
            >
              {/* Drawer Header */}
              <div className="p-4 border-b border-gray-800 flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <ShieldAlert className="text-red-400" size={18} />
                    <span className="font-bold text-gray-100">{drawer.recall_number}</span>
                    <Badge label={drawer.severity} cfg={SEVERITY_CFG[drawer.severity]} small />
                    <Badge label={drawer.status} cfg={STATUS_CFG[drawer.status]} small />
                  </div>
                  <p className="text-gray-400 text-sm">{drawer.brand} — {drawer.description}</p>
                  <p className="text-xs text-gray-500 mt-1">{drawer.action_required}</p>
                </div>
                <button onClick={() => setDrawer(null)} className="text-gray-500 hover:text-gray-200 shrink-0">
                  <X size={20} />
                </button>
              </div>

              {/* Drawer count */}
              <div className="px-4 py-3 bg-gray-800/50 flex items-center justify-between">
                <span className="font-bold text-orange-400 text-lg">
                  {matchTyresForRecall(drawer).length} affected fleet tyres
                </span>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" size={13} />
                  <input
                    value={drawerSearch}
                    onChange={e => setDrawerSearch(e.target.value)}
                    placeholder="Search serial, asset, site…"
                    className="pl-7 pr-3 py-1.5 bg-gray-900 border border-gray-700 rounded-lg text-xs text-gray-100 placeholder-gray-500 focus:outline-none focus:border-blue-600 w-48"
                  />
                </div>
              </div>

              {/* Drawer table */}
              <div className="flex-1 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-900 border-b border-gray-800">
                    <tr className="text-gray-400">
                      <th className="px-3 py-2 text-left">Serial</th>
                      <th className="px-3 py-2 text-left">Asset</th>
                      <th className="px-3 py-2 text-left">Position</th>
                      <th className="px-3 py-2 text-left">Site</th>
                      <th className="px-3 py-2 text-left">Country</th>
                      <th className="px-3 py-2 text-left">Status</th>
                      <th className="px-3 py-2 text-left">Days Fitted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drawerTyres.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-3 py-10 text-center text-gray-500">
                          {matchTyresForRecall(drawer).length === 0
                            ? 'No fleet tyres match this recall criteria'
                            : 'No results for current search'
                          }
                        </td>
                      </tr>
                    )}
                    {drawerTyres.map(t => {
                      const daysOn = t.issue_date ? daysBetween(t.issue_date, t.km_at_removal ? null : new Date().toISOString().slice(0, 10)) : null
                      return (
                        <tr key={t.id} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                          <td className="px-3 py-2 font-mono text-blue-300">{t.serial_number}</td>
                          <td className="px-3 py-2 text-gray-300">{t.asset_no}</td>
                          <td className="px-3 py-2 text-gray-400">{t.position}</td>
                          <td className="px-3 py-2 text-gray-400">{t.site}</td>
                          <td className="px-3 py-2 text-gray-400">{t.country}</td>
                          <td className="px-3 py-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              t.km_at_removal
                                ? 'bg-gray-700 text-gray-300'
                                : 'bg-green-900/40 text-green-400 border border-green-700/50'
                            }`}>
                              {t.km_at_removal ? 'Removed' : 'Fitted'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-400">{daysOn != null ? `${daysOn}d` : 'N/A'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Drawer footer */}
              <div className="p-3 border-t border-gray-800 flex justify-end">
                <button
                  onClick={() => setDrawer(null)}
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300 transition"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Add / Edit Recall Modal ── */}
      <AnimatePresence>
        {showAddModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black z-50"
              onClick={() => setShowAddModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 flex items-center justify-center z-50 p-4"
            >
              <div
                className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
                onClick={e => e.stopPropagation()}
              >
                <div className="p-5 border-b border-gray-800 flex items-center justify-between">
                  <h2 className="font-bold text-gray-100 flex items-center gap-2">
                    <ShieldAlert className="text-red-400" size={18} />
                    {editRecall ? 'Edit Recall' : 'Add Recall'}
                  </h2>
                  <button onClick={() => setShowAddModal(false)} className="text-gray-500 hover:text-gray-200">
                    <X size={20} />
                  </button>
                </div>

                <div className="p-5 space-y-4">
                  {formError && (
                    <div className="bg-red-900/30 border border-red-700 rounded-lg px-3 py-2 text-red-400 text-sm flex items-center gap-2">
                      <AlertTriangle size={14} /> {formError}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Recall Number *</label>
                      <input
                        value={form.recall_number}
                        onChange={e => setForm(f => ({ ...f, recall_number: e.target.value }))}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-600 font-mono"
                        placeholder="e.g. RCL-2024-001"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Brand *</label>
                      <input
                        value={form.brand}
                        onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-600"
                        placeholder="e.g. Michelin"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Issue Date *</label>
                      <input
                        type="date"
                        value={form.issue_date}
                        onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-600"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Severity</label>
                      <select
                        value={form.severity}
                        onChange={e => setForm(f => ({ ...f, severity: e.target.value }))}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-600"
                      >
                        {SEVERITY_OPTS.map(o => <option key={o}>{o}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Source</label>
                      <select
                        value={form.source}
                        onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-600"
                      >
                        {SOURCE_OPTS.map(o => <option key={o}>{o}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Status</label>
                      <select
                        value={form.status}
                        onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-600"
                      >
                        {STATUS_OPTS.map(o => <option key={o}>{o}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* Affected Sizes tag input */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Affected Sizes * <span className="text-gray-500">(press Enter or comma to add)</span></label>
                    <div className="flex flex-wrap gap-1.5 p-2 bg-gray-800 border border-gray-700 rounded-lg min-h-[42px]">
                      {form.affected_sizes.map(s => (
                        <span key={s} className="flex items-center gap-1 px-2 py-0.5 bg-blue-900/40 border border-blue-700/50 rounded text-xs text-blue-300 font-mono">
                          {s}
                          <button onClick={() => removeSize(s)} className="text-blue-500 hover:text-red-400 ml-0.5">
                            <X size={10} />
                          </button>
                        </span>
                      ))}
                      <input
                        value={sizeInput}
                        onChange={e => setSizeInput(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addSize() }
                        }}
                        onBlur={addSize}
                        placeholder="e.g. 315/80R22.5"
                        className="bg-transparent text-sm text-gray-100 placeholder-gray-500 focus:outline-none flex-1 min-w-[140px] font-mono"
                      />
                    </div>
                  </div>

                  {/* Serial prefix */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Serial Prefix Pattern <span className="text-gray-500">(optional — first 4 chars, e.g. MH23)</span></label>
                    <input
                      value={form.affected_serial_prefix}
                      onChange={e => setForm(f => ({ ...f, affected_serial_prefix: e.target.value.toUpperCase().slice(0, 4) }))}
                      maxLength={4}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-600 font-mono uppercase"
                      placeholder="e.g. MH23"
                    />
                  </div>

                  {/* Description */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Description</label>
                    <textarea
                      value={form.description}
                      onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                      rows={3}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-600 resize-none"
                      placeholder="Describe the recall issue…"
                    />
                  </div>

                  {/* Action Required */}
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Action Required</label>
                    <textarea
                      value={form.action_required}
                      onChange={e => setForm(f => ({ ...f, action_required: e.target.value }))}
                      rows={2}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-100 focus:outline-none focus:border-blue-600 resize-none"
                      placeholder="Immediate action to take…"
                    />
                  </div>
                </div>

                <div className="p-5 border-t border-gray-800 flex justify-end gap-3">
                  <button
                    onClick={() => setShowAddModal(false)}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-gray-300 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="px-5 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-lg text-sm font-semibold text-white transition flex items-center gap-2"
                  >
                    {saving ? <Loader2 className="animate-spin" size={14} /> : <ShieldAlert size={14} />}
                    {editRecall ? 'Update Recall' : 'Save Recall'}
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
