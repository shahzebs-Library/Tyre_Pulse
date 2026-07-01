import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Doughnut, Line } from 'react-chartjs-2'
import {
  ShieldCheck, ShieldAlert, DollarSign, TrendingUp, BarChart3,
  Plus, X, Search, Filter, Download, FileText, FileSpreadsheet,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  RefreshCw, CheckCircle, Clock, AlertTriangle, XCircle,
  Edit2, Save, Loader2, Calendar, Tag, Package,
  Building2, Hash, Percent, CreditCard, Activity, Info,
  ArrowUpRight, Layers, Zap, Target, List, PieChart, Upload,
} from 'lucide-react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import * as warranty from '../lib/api/warranty'
import { useSettings } from '../contexts/SettingsContext'
import { useAuth } from '../contexts/AuthContext'
import PageHeader from '../components/ui/PageHeader'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend,
)

const PAGE_SIZE = 20

const FAILURE_TYPES = [
  'Premature Wear', 'Sidewall Failure', 'Tread Separation',
  'Bead Failure', 'Manufacturing Defect', 'Other',
]

const CLAIM_STATUSES = [
  'Submitted', 'Under Review', 'Approved', 'Rejected', 'Credit Issued', 'Closed',
]

const STATUS_CFG = {
  'Submitted':     { text: 'text-blue-400',    bg: 'bg-blue-900/30',    border: 'border-blue-700'    },
  'Under Review':  { text: 'text-yellow-400',  bg: 'bg-yellow-900/30',  border: 'border-yellow-700'  },
  'Approved':      { text: 'text-green-400',   bg: 'bg-green-900/30',   border: 'border-green-700'   },
  'Rejected':      { text: 'text-red-400',     bg: 'bg-red-900/30',     border: 'border-red-700'     },
  'Credit Issued': { text: 'text-emerald-400', bg: 'bg-emerald-900/30', border: 'border-emerald-700' },
  'Closed':        { text: 'text-gray-400',    bg: 'bg-gray-800',       border: 'border-gray-600'    },
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

const DOUGHNUT_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: 'right', labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'var(--panel)',
      borderColor: 'var(--hairline)',
      borderWidth: 1,
      titleColor: '#f9fafb',
      bodyColor: '#d1d5db',
    },
  },
}

const PALETTE = [
  '#3b82f6', '#f59e0b', '#10b981', '#ef4444', '#10b981', '#6b7280',
]

const FAILURE_PALETTE = [
  '#f97316', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#6366f1',
]

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return isNaN(d) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function generateClaimNo(existingClaims) {
  const year = new Date().getFullYear()
  const thisYear = existingClaims.filter(c => c.claim_no?.startsWith(`WAR-${year}-`))
  const seq = String(thisYear.length + 1).padStart(5, '0')
  return `WAR-${year}-${seq}`
}

const EMPTY_FORM = {
  serial_number: '',
  brand: '',
  size: '',
  asset_no: '',
  site: '',
  country: '',
  fitment_date: '',
  removal_date: '',
  km_at_fitment: '',
  km_at_removal: '',
  expected_life_km: 100000,
  failure_type: 'Premature Wear',
  supplier: '',
  notes: '',
  claim_status: 'Submitted',
  credit_amount: '',
  credit_date: '',
}

function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] ?? { text: 'text-gray-400', bg: 'bg-gray-800', border: 'border-gray-600' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-semibold ${cfg.text} ${cfg.bg} ${cfg.border}`}>
      {status}
    </span>
  )
}

function KpiCard({ icon: Icon, label, value, sub, color = 'text-blue-400', warn }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      className={`bg-gray-900 border ${warn ? 'border-red-700/60' : 'border-gray-800'} rounded-xl p-4 flex items-start gap-3`}
    >
      <div className={`p-2 rounded-lg bg-gray-800 ${color}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-gray-400 text-xs truncate">{label}</p>
        <p className={`text-2xl font-bold mt-0.5 ${color}`}>{value}</p>
        {sub && <p className="text-gray-500 text-xs mt-0.5">{sub}</p>}
      </div>
    </motion.div>
  )
}

export default function WarrantyTracker() {
  const navigate = useNavigate()
  const { activeCurrency } = useSettings()
  const { profile } = useAuth()

  const [claims, setClaims]     = useState([])
  const [tyreRecords, setTyreRecords] = useState([])
  const [loading, setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState('Claims')

  const [search, setSearch]           = useState('')
  const [filterBrand, setFilterBrand] = useState('All')
  const [filterStatus, setFilterStatus] = useState('All')
  const [filterFailure, setFilterFailure] = useState('All')
  const [filterSite, setFilterSite]   = useState('All')
  const [dateFrom, setDateFrom]       = useState('')
  const [dateTo, setDateTo]           = useState('')
  const [page, setPage]               = useState(1)

  const [showAdd, setShowAdd]     = useState(false)
  const [editClaim, setEditClaim] = useState(null)
  const [drawer, setDrawer]       = useState(null)
  const [form, setForm]           = useState(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [saving, setSaving]       = useState(false)
  const [serialLookupLoading, setSerialLookupLoading] = useState(false)

  const [roiAnnualCount, setRoiAnnualCount] = useState('')
  const [roiAvgCost, setRoiAvgCost]         = useState('')
  const [expandedRow, setExpandedRow]       = useState(null)

  const [claimsError, setClaimsError] = useState('')

  const loadClaims = useCallback(async () => {
    try {
      setClaimsError('')
      const data = await warranty.listWarrantyClaims()
      setClaims(data ?? [])
    } catch (e) {
      setClaimsError('Could not load warranty claims. Please retry.')
      setClaims([])
    }
  }, [])

  // Persist a single claim (insert or update) then refresh from the server so
  // the list always reflects committed state — no optimistic divergence.
  const upsertClaim = useCallback(async (row, id) => {
    if (id) {
      await warranty.updateWarrantyClaim(id, row)
    } else {
      await warranty.createWarrantyClaim(row)
    }
    await loadClaims()
  }, [loadClaims])

  const removeClaim = useCallback(async (id) => {
    await warranty.deleteWarrantyClaim(id)
    await loadClaims()
  }, [loadClaims])

  useEffect(() => {
    loadClaims()
  }, [loadClaims])

  useEffect(() => {
    async function load() {
      setLoading(true)
      let data = []
      try { data = await warranty.listTyreContext() } catch { data = [] }
      setTyreRecords(data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  const cur = activeCurrency || 'SAR'
  const fmt = (v) => {
    if (v == null || !isFinite(v)) return `${cur} 0`
    if (Math.abs(v) >= 1_000_000) return `${cur} ${(v / 1_000_000).toFixed(2)}M`
    if (Math.abs(v) >= 1_000) return `${cur} ${(v / 1_000).toFixed(1)}K`
    return `${cur} ${Math.round(v).toLocaleString()}`
  }

  const kpis = useMemo(() => {
    const total = claims.length
    const open = claims.filter(c => ['Submitted', 'Under Review', 'Approved'].includes(c.claim_status)).length
    const credited = claims.filter(c => ['Credit Issued', 'Closed'].includes(c.claim_status))
    const totalCredits = credited.reduce((s, c) => s + (Number(c.credit_amount) || 0), 0)
    const approvedCount = claims.filter(c =>
      ['Approved', 'Credit Issued', 'Closed'].includes(c.claim_status)
    ).length
    const approvalRate = total > 0 ? (approvedCount / total) * 100 : 0
    const avgCredit = credited.length > 0 ? totalCredits / credited.length : 0
    return { total, open, totalCredits, approvalRate, avgCredit }
  }, [claims])

  const brands = useMemo(() => ['All', ...new Set(claims.map(c => c.brand).filter(Boolean))], [claims])
  const sites  = useMemo(() => ['All', ...new Set(claims.map(c => c.site).filter(Boolean))], [claims])

  const filtered = useMemo(() => {
    return claims.filter(c => {
      if (filterBrand !== 'All' && c.brand !== filterBrand) return false
      if (filterStatus !== 'All' && c.claim_status !== filterStatus) return false
      if (filterFailure !== 'All' && c.failure_type !== filterFailure) return false
      if (filterSite !== 'All' && c.site !== filterSite) return false
      if (dateFrom && c.created_at < dateFrom) return false
      if (dateTo && c.created_at > dateTo + 'T23:59:59') return false
      if (search) {
        const s = search.toLowerCase()
        return (
          c.claim_no?.toLowerCase().includes(s) ||
          c.serial_number?.toLowerCase().includes(s) ||
          c.brand?.toLowerCase().includes(s) ||
          c.asset_no?.toLowerCase().includes(s) ||
          c.site?.toLowerCase().includes(s)
        )
      }
      return true
    }).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  }, [claims, filterBrand, filterStatus, filterFailure, filterSite, dateFrom, dateTo, search])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const brandPerf = useMemo(() => {
    const map = {}
    claims.forEach(c => {
      const b = c.brand?.trim() || 'Unknown'
      if (!map[b]) map[b] = { brand: b, total: 0, approved: 0, credits: 0, kmList: [] }
      map[b].total++
      if (['Approved', 'Credit Issued', 'Closed'].includes(c.claim_status)) map[b].approved++
      if (['Credit Issued', 'Closed'].includes(c.claim_status) && c.credit_amount) map[b].credits += Number(c.credit_amount)
      if (c.km_run > 0) map[b].kmList.push(c.km_run)
    })
    return Object.values(map).map(b => ({
      ...b,
      approvalRate: b.total > 0 ? (b.approved / b.total) * 100 : 0,
      avgCredit: b.approved > 0 ? b.credits / b.approved : 0,
      avgKm: b.kmList.length > 0 ? b.kmList.reduce((s, v) => s + v, 0) / b.kmList.length : 0,
    })).sort((a, b) => b.total - a.total)
  }, [claims])

  const statusCounts = useMemo(() => {
    const map = {}
    CLAIM_STATUSES.forEach(s => { map[s] = 0 })
    claims.forEach(c => { if (map[c.claim_status] != null) map[c.claim_status]++ })
    return map
  }, [claims])

  const failureCounts = useMemo(() => {
    const map = {}
    FAILURE_TYPES.forEach(f => { map[f] = { count: 0, kmList: [] } })
    claims.forEach(c => {
      if (map[c.failure_type]) {
        map[c.failure_type].count++
        if (c.km_run > 0) map[c.failure_type].kmList.push(c.km_run)
      }
    })
    return Object.entries(map).map(([type, { count, kmList }]) => ({
      type,
      count,
      avgKm: kmList.length > 0 ? Math.round(kmList.reduce((s, v) => s + v, 0) / kmList.length) : 0,
    })).sort((a, b) => b.count - a.count)
  }, [claims])

  const monthlyCredits = useMemo(() => {
    const now = new Date()
    const arr = Array(12).fill(0)
    claims.forEach(c => {
      if (!['Credit Issued', 'Closed'].includes(c.claim_status)) return
      if (!c.credit_date) return
      const d = new Date(c.credit_date)
      if (isNaN(d)) return
      const diff = (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth()
      if (diff >= 0 && diff < 12) arr[11 - diff] += Number(c.credit_amount) || 0
    })
    const labels = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      labels.push(MONTHS[d.getMonth()])
    }
    return { labels, data: arr }
  }, [claims])

  const creditAnalysis = useMemo(() => {
    const totalCredits = claims
      .filter(c => ['Credit Issued', 'Closed'].includes(c.claim_status))
      .reduce((s, c) => s + (Number(c.credit_amount) || 0), 0)
    const openApproved = claims.filter(c => c.claim_status === 'Approved')
    const avgCreditIssued = claims.filter(c => ['Credit Issued', 'Closed'].includes(c.claim_status) && c.credit_amount)
    const avg = avgCreditIssued.length > 0
      ? avgCreditIssued.reduce((s, c) => s + Number(c.credit_amount), 0) / avgCreditIssued.length
      : 0
    const estimatedUnclaimed = openApproved.length * avg
    return { totalCredits, estimatedUnclaimed, openApprovedCount: openApproved.length }
  }, [claims])

  const openForm = useCallback((claim = null) => {
    if (claim) {
      setForm({
        serial_number: claim.serial_number || '',
        brand: claim.brand || '',
        size: claim.size || '',
        asset_no: claim.asset_no || '',
        site: claim.site || '',
        country: claim.country || '',
        fitment_date: claim.fitment_date || '',
        removal_date: claim.removal_date || '',
        km_at_fitment: claim.km_at_fitment ?? '',
        km_at_removal: claim.km_at_removal ?? '',
        expected_life_km: claim.expected_life_km ?? 100000,
        failure_type: claim.failure_type || 'Premature Wear',
        supplier: claim.supplier || '',
        notes: claim.notes || '',
        claim_status: claim.claim_status || 'Submitted',
        credit_amount: claim.credit_amount ?? '',
        credit_date: claim.credit_date || '',
      })
      setEditClaim(claim)
    } else {
      setForm(EMPTY_FORM)
      setEditClaim(null)
    }
    setFormError('')
    setShowAdd(true)
  }, [])

  const handleSerialLookup = useCallback(async () => {
    if (!form.serial_number.trim()) return
    setSerialLookupLoading(true)
    try {
      const data = await warranty.findTyreForClaim(form.serial_number.trim())
      if (data) {
        setForm(prev => ({
          ...prev,
          brand: data.brand || prev.brand,
          size: data.size || prev.size,
          asset_no: data.asset_no || prev.asset_no,
          site: data.site || prev.site,
          country: data.country || prev.country,
          fitment_date: data.fitment_date || prev.fitment_date,
          km_at_fitment: data.km_at_fitment ?? prev.km_at_fitment,
          km_at_removal: data.km_at_removal ?? prev.km_at_removal,
          supplier: data.supplier || prev.supplier,
        }))
      }
    } catch {
    } finally {
      setSerialLookupLoading(false)
    }
  }, [form.serial_number])

  const kmRun = useMemo(() => {
    const fit = Number(form.km_at_fitment)
    const rem = Number(form.km_at_removal)
    if (fit >= 0 && rem > 0 && rem > fit) return rem - fit
    return 0
  }, [form.km_at_fitment, form.km_at_removal])

  const handleSave = useCallback(async () => {
    if (!form.serial_number.trim()) { setFormError('Serial number is required.'); return }
    if (!form.brand.trim()) { setFormError('Brand is required.'); return }
    if (!form.failure_type) { setFormError('Failure type is required.'); return }
    setSaving(true)
    setFormError('')
    try {
      // Whitelist only real columns — never spread unknown form keys into the row
      const base = {
        serial_number: form.serial_number.trim(),
        brand: form.brand.trim(),
        size: form.size || null,
        asset_no: form.asset_no || null,
        site: form.site || null,
        country: form.country || profile?.country || null,
        fitment_date: form.fitment_date || null,
        removal_date: form.removal_date || null,
        km_at_fitment: Number(form.km_at_fitment) || 0,
        km_at_removal: Number(form.km_at_removal) || 0,
        km_run: kmRun,
        expected_life_km: Number(form.expected_life_km) || 100000,
        failure_type: form.failure_type,
        supplier: form.supplier || null,
        notes: form.notes || null,
        claim_status: form.claim_status || 'Submitted',
        credit_amount: Number(form.credit_amount) || 0,
        credit_date: form.credit_date || null,
      }
      if (editClaim) {
        await upsertClaim(base, editClaim.id)
      } else {
        await upsertClaim({
          ...base,
          claim_no: generateClaimNo(claims),
          created_by: profile?.id ?? null,
        })
      }
      setShowAdd(false)
      setEditClaim(null)
      setForm(EMPTY_FORM)
    } catch (e) {
      setFormError(e?.message || 'Could not save the claim. Please retry.')
    } finally {
      setSaving(false)
    }
  }, [claims, editClaim, form, kmRun, upsertClaim, profile])

  const handleDelete = useCallback(async (id) => {
    if (!window.confirm('Delete this warranty claim?')) return
    try {
      await removeClaim(id)
      setDrawer(null)
    } catch (e) {
      window.alert(e?.message || 'Could not delete the claim.')
    }
  }, [removeClaim])

  const exportPDF = useCallback(() => {
    const doc = new jsPDF({ orientation: 'landscape' })
    doc.setFillColor(17, 24, 39)
    doc.rect(0, 0, 297, 210, 'F')
    doc.setTextColor(249, 250, 251)
    doc.setFontSize(16)
    doc.text('Tyre Pulse — Warranty Claims Report', 14, 16)
    doc.setFontSize(10)
    doc.setTextColor(156, 163, 175)
    doc.text(`Generated: ${new Date().toLocaleDateString('en-GB')}  |  Total Claims: ${claims.length}`, 14, 23)
    autoTable(doc, {
      startY: 30,
      head: [['Claim No', 'Serial', 'Brand', 'Size', 'Asset', 'Site', 'Failure Type', 'Status', 'km Run', 'Exp km', '% Life', 'Credit', 'Date']],
      body: filtered.map(c => [
        c.claim_no, c.serial_number, c.brand, c.size, c.asset_no, c.site,
        c.failure_type, c.claim_status,
        c.km_run?.toLocaleString() || '0',
        c.expected_life_km?.toLocaleString() || '0',
        c.expected_life_km > 0 ? `${((c.km_run / c.expected_life_km) * 100).toFixed(1)}%` : 'N/A',
        c.credit_amount ? `${cur} ${Number(c.credit_amount).toLocaleString()}` : '—',
        fmtDate(c.created_at),
      ]),
      styles: { fillColor: [31, 41, 55], textColor: [209, 213, 219], fontSize: 8 },
      headStyles: { fillColor: [59, 130, 246], textColor: [255, 255, 255] },
      alternateRowStyles: { fillColor: [17, 24, 39] },
    })
    if (brandPerf.length > 0) {
      doc.addPage()
      doc.setFillColor(17, 24, 39)
      doc.rect(0, 0, 297, 210, 'F')
      doc.setTextColor(249, 250, 251)
      doc.setFontSize(14)
      doc.text('Brand Warranty Performance', 14, 16)
      autoTable(doc, {
        startY: 24,
        head: [['Brand', 'Total Claims', 'Approval Rate', 'Avg Credit', 'Avg km at Failure']],
        body: brandPerf.map(b => [
          b.brand, b.total, `${b.approvalRate.toFixed(1)}%`,
          b.avgCredit > 0 ? `${cur} ${Math.round(b.avgCredit).toLocaleString()}` : '—',
          b.avgKm > 0 ? Math.round(b.avgKm).toLocaleString() : '—',
        ]),
        styles: { fillColor: [31, 41, 55], textColor: [209, 213, 219], fontSize: 9 },
        headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255] },
        alternateRowStyles: { fillColor: [17, 24, 39] },
      })
    }
    doc.save(`warranty-claims-${new Date().toISOString().split('T')[0]}.pdf`)
  }, [claims, filtered, brandPerf, cur])

  const exportExcel = useCallback(() => {
    const rows = filtered.map(c => ({
      'Claim No': c.claim_no,
      'Serial Number': c.serial_number,
      Brand: c.brand,
      Size: c.size,
      'Asset No': c.asset_no,
      Site: c.site,
      Country: c.country,
      'Fitment Date': c.fitment_date,
      'Removal Date': c.removal_date,
      'km at Fitment': c.km_at_fitment,
      'km at Removal': c.km_at_removal,
      'km Run': c.km_run,
      'Expected Life km': c.expected_life_km,
      '% of Life': c.expected_life_km > 0 ? +((c.km_run / c.expected_life_km) * 100).toFixed(1) : null,
      'Failure Type': c.failure_type,
      Status: c.claim_status,
      'Credit Amount': c.credit_amount,
      'Credit Date': c.credit_date,
      Supplier: c.supplier,
      Notes: c.notes,
      'Created At': fmtDate(c.created_at),
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Warranty Claims')
    if (brandPerf.length > 0) {
      const bpRows = brandPerf.map(b => ({
        Brand: b.brand,
        'Total Claims': b.total,
        'Approval Rate %': +b.approvalRate.toFixed(1),
        'Avg Credit': +b.avgCredit.toFixed(0),
        'Avg km at Failure': +b.avgKm.toFixed(0),
      }))
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bpRows), 'Brand Performance')
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(failureCounts.map(f => ({
      'Failure Type': f.type,
      Count: f.count,
      'Avg km at Failure': f.avgKm,
    }))), 'Failure Analysis')
    XLSX.writeFile(wb, `warranty-claims-${new Date().toISOString().split('T')[0]}.xlsx`)
  }, [filtered, brandPerf, failureCounts])

  const exportClaimLetter = useCallback((claim) => {
    const doc = new jsPDF()
    doc.setFontSize(20)
    doc.setTextColor(30, 64, 175)
    doc.text('TYRE WARRANTY CLAIM', 105, 30, { align: 'center' })
    doc.setTextColor(0, 0, 0)
    doc.setFontSize(11)
    doc.text(`Claim Reference: ${claim.claim_no}`, 14, 48)
    doc.text(`Date: ${new Date().toLocaleDateString('en-GB')}`, 14, 56)
    doc.setDrawColor(200, 200, 200)
    doc.line(14, 60, 196, 60)
    doc.setFontSize(12)
    doc.setTextColor(30, 64, 175)
    doc.text('Claim Details', 14, 70)
    doc.setTextColor(0, 0, 0)
    doc.setFontSize(10)
    const fields = [
      ['Serial Number', claim.serial_number],
      ['Brand', claim.brand],
      ['Size', claim.size],
      ['Supplier', claim.supplier || '—'],
      ['Asset / Vehicle', claim.asset_no],
      ['Site / Location', claim.site],
      ['Fitment Date', fmtDate(claim.fitment_date)],
      ['Removal Date', fmtDate(claim.removal_date)],
      ['km at Fitment', claim.km_at_fitment?.toLocaleString() || '0'],
      ['km at Removal', claim.km_at_removal?.toLocaleString() || '0'],
      ['km Run', claim.km_run?.toLocaleString() || '0'],
      ['Expected Life km', claim.expected_life_km?.toLocaleString() || '0'],
      ['% of Expected Life', claim.expected_life_km > 0 ? `${((claim.km_run / claim.expected_life_km) * 100).toFixed(1)}%` : 'N/A'],
      ['Failure Type', claim.failure_type],
    ]
    let y = 80
    fields.forEach(([k, v]) => {
      doc.setFont(undefined, 'bold')
      doc.text(`${k}:`, 14, y)
      doc.setFont(undefined, 'normal')
      doc.text(String(v ?? '—'), 80, y)
      y += 8
    })
    doc.line(14, y + 2, 196, y + 2)
    y += 10
    doc.setFontSize(12)
    doc.setTextColor(30, 64, 175)
    doc.text('Failure Description', 14, y)
    y += 8
    doc.setTextColor(0, 0, 0)
    doc.setFontSize(10)
    const descLines = doc.splitTextToSize(claim.notes || 'No additional notes provided.', 180)
    doc.text(descLines, 14, y)
    y += descLines.length * 7 + 10
    doc.line(14, y, 196, y)
    y += 10
    doc.setFontSize(11)
    doc.text('We hereby submit this tyre warranty claim for your review and request a credit note', 14, y)
    y += 7
    doc.text('or replacement as per the applicable warranty policy.', 14, y)
    y += 20
    doc.text('Authorized Signature: ________________________', 14, y)
    y += 8
    doc.text('Name: ________________________', 14, y)
    y += 8
    doc.text(`Date: ${new Date().toLocaleDateString('en-GB')}`, 14, y)
    doc.save(`warranty-claim-${claim.claim_no}.pdf`)
  }, [])

  const roiCalc = useMemo(() => {
    const annualCount = Number(roiAnnualCount) || 0
    const avgCost = Number(roiAvgCost) || 0
    const year = new Date().getFullYear()
    const thisYearClaims = claims.filter(c => c.claim_no?.startsWith(`WAR-${year}-`))
    const thisYearCredits = thisYearClaims
      .filter(c => ['Credit Issued', 'Closed'].includes(c.claim_status))
      .reduce((s, c) => s + (Number(c.credit_amount) || 0), 0)
    const totalSpend = annualCount * avgCost
    const recoveryRate = totalSpend > 0 ? (thisYearCredits / totalSpend) * 100 : 0
    const eligibleUnclaimed = annualCount > 0 ? Math.round(annualCount * 0.3) * avgCost * 0.4 : 0
    return { thisYearClaims: thisYearClaims.length, thisYearCredits, recoveryRate, eligibleUnclaimed }
  }, [claims, roiAnnualCount, roiAvgCost])

  const brandChartData = useMemo(() => ({
    labels: brandPerf.slice(0, 10).map(b => b.brand),
    datasets: [
      {
        label: 'Total Claims',
        data: brandPerf.slice(0, 10).map(b => b.total),
        backgroundColor: '#3b82f6',
        borderRadius: 4,
      },
      {
        label: 'Approval Rate %',
        data: brandPerf.slice(0, 10).map(b => +b.approvalRate.toFixed(1)),
        backgroundColor: '#10b981',
        borderRadius: 4,
      },
    ],
  }), [brandPerf])

  const statusDoughnutData = useMemo(() => ({
    labels: CLAIM_STATUSES,
    datasets: [{
      data: CLAIM_STATUSES.map(s => statusCounts[s] || 0),
      backgroundColor: PALETTE,
      borderColor: PALETTE.map(c => c + '88'),
      borderWidth: 1,
    }],
  }), [statusCounts])

  const failureDoughnutData = useMemo(() => ({
    labels: failureCounts.map(f => f.type),
    datasets: [{
      data: failureCounts.map(f => f.count),
      backgroundColor: FAILURE_PALETTE,
      borderColor: FAILURE_PALETTE.map(c => c + '88'),
      borderWidth: 1,
    }],
  }), [failureCounts])

  const creditTrendData = useMemo(() => ({
    labels: monthlyCredits.labels,
    datasets: [{
      label: 'Credits Received',
      data: monthlyCredits.data,
      backgroundColor: '#10b981',
      borderRadius: 4,
    }],
  }), [monthlyCredits])

  const tabs = ['Claims', 'Brand Analysis', 'Failure Analysis', 'Credit Recovery', 'ROI Calculator']

  return (
    <div className="space-y-6">
      <PageHeader
        title="Warranty & Claims Tracker"
        subtitle="Track tyre warranties, claims, and supplier accountability"
        icon={ShieldCheck}
        actions={
        <div className="flex gap-2">
          <button
            onClick={exportPDF}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm text-gray-300 transition-colors"
          >
            <FileText size={14} /> PDF
          </button>
          <button
            onClick={exportExcel}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm text-gray-300 transition-colors"
          >
            <FileSpreadsheet size={14} /> Excel
          </button>
          <button
            onClick={() => navigate('/data-intake?module=warranty')}
            className="btn-primary flex items-center gap-2 text-sm"
          >
            <Upload size={15} /> Import via Data Intake Center
          </button>
          <button
            onClick={() => openForm()}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold text-white transition-colors"
          >
            <Plus size={14} /> Add Claim
          </button>
        </div>
        }
      />
      <p className="text-xs text-gray-500 -mt-3">
        New: controlled, validated, audited warranty-claim import with Arabic/English header mapping, fitment/removal lifecycle checks, and duplicate detection.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard icon={ShieldCheck} label="Total Claims" value={kpis.total} color="text-blue-400" />
        <KpiCard icon={Clock} label="Open Claims" value={kpis.open} color="text-yellow-400" warn={kpis.open > 10} />
        <KpiCard icon={DollarSign} label="Total Credits" value={fmt(kpis.totalCredits)} color="text-emerald-400" sub="received" />
        <KpiCard icon={Percent} label="Approval Rate" value={`${kpis.approvalRate.toFixed(1)}%`} color="text-green-400" />
        <KpiCard icon={CreditCard} label="Avg Credit/Claim" value={fmt(kpis.avgCredit)} color="text-purple-400" />
      </div>

      <div className="flex gap-1 flex-wrap bg-gray-900 border border-gray-800 rounded-xl p-1">
        {tabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Claims' && (
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex flex-col md:flex-row gap-3 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search claim, serial, brand, asset..."
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1) }}
                  className="w-full pl-8 pr-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <select value={filterBrand} onChange={e => { setFilterBrand(e.target.value); setPage(1) }}
                className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-blue-500">
                {brands.map(b => <option key={b}>{b}</option>)}
              </select>
              <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(1) }}
                className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-blue-500">
                {['All', ...CLAIM_STATUSES].map(s => <option key={s}>{s}</option>)}
              </select>
              <select value={filterFailure} onChange={e => { setFilterFailure(e.target.value); setPage(1) }}
                className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-blue-500">
                {['All', ...FAILURE_TYPES].map(f => <option key={f}>{f}</option>)}
              </select>
              <select value={filterSite} onChange={e => { setFilterSite(e.target.value); setPage(1) }}
                className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-blue-500">
                {sites.map(s => <option key={s}>{s}</option>)}
              </select>
              <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1) }}
                className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-blue-500" />
              <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1) }}
                className="px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-blue-500" />
            </div>
          </div>

          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 size={28} className="animate-spin text-blue-400" />
              </div>
            ) : claimsError ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <AlertTriangle size={40} className="text-red-500" />
                <p className="text-red-400">{claimsError}</p>
                <button onClick={() => loadClaims()} className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm text-white">
                  Retry
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <ShieldCheck size={40} className="text-gray-600" />
                <p className="text-gray-400">No warranty claims found.</p>
                <button onClick={() => openForm()} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm text-white">
                  Add First Claim
                </button>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800 bg-gray-800/50">
                        {['Claim No','Serial','Brand','Size','Asset','Site','Failure Type','Status','km Run','Exp km','% Life','Credit','Date',''].map(h => (
                          <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-gray-400 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {paginated.map(c => {
                        const pctLife = c.expected_life_km > 0 ? (c.km_run / c.expected_life_km) * 100 : null
                        const lowLife = pctLife !== null && pctLife < 50
                        return (
                          <>
                            <tr
                              key={c.id}
                              className="border-b border-gray-800/50 hover:bg-gray-800/40 cursor-pointer transition-colors"
                              onClick={() => setExpandedRow(expandedRow === c.id ? null : c.id)}
                            >
                              <td className="px-3 py-2.5 font-mono text-blue-400 text-xs whitespace-nowrap">{c.claim_no}</td>
                              <td className="px-3 py-2.5 text-gray-300 text-xs whitespace-nowrap">{c.serial_number}</td>
                              <td className="px-3 py-2.5 text-gray-200 font-medium text-xs whitespace-nowrap">{c.brand}</td>
                              <td className="px-3 py-2.5 text-gray-400 text-xs whitespace-nowrap">{c.size}</td>
                              <td className="px-3 py-2.5 text-gray-400 text-xs whitespace-nowrap">{c.asset_no}</td>
                              <td className="px-3 py-2.5 text-gray-400 text-xs whitespace-nowrap">{c.site}</td>
                              <td className="px-3 py-2.5 text-gray-300 text-xs whitespace-nowrap">{c.failure_type}</td>
                              <td className="px-3 py-2.5 whitespace-nowrap"><StatusBadge status={c.claim_status} /></td>
                              <td className="px-3 py-2.5 text-gray-300 text-xs text-right whitespace-nowrap">{(c.km_run || 0).toLocaleString()}</td>
                              <td className="px-3 py-2.5 text-gray-400 text-xs text-right whitespace-nowrap">{(c.expected_life_km || 0).toLocaleString()}</td>
                              <td className={`px-3 py-2.5 text-xs text-right font-semibold whitespace-nowrap ${lowLife ? 'text-red-400' : 'text-gray-300'}`}>
                                {pctLife !== null ? `${pctLife.toFixed(1)}%` : '—'}
                              </td>
                              <td className="px-3 py-2.5 text-emerald-400 text-xs text-right whitespace-nowrap">
                                {c.credit_amount ? fmt(c.credit_amount) : '—'}
                              </td>
                              <td className="px-3 py-2.5 text-gray-500 text-xs whitespace-nowrap">{fmtDate(c.created_at)}</td>
                              <td className="px-3 py-2.5 whitespace-nowrap">
                                <div className="flex gap-1">
                                  <button
                                    onClick={e => { e.stopPropagation(); openForm(c) }}
                                    className="p-1 text-gray-500 hover:text-blue-400 hover:bg-gray-800 rounded transition-colors"
                                  ><Edit2 size={12} /></button>
                                  <button
                                    onClick={e => { e.stopPropagation(); exportClaimLetter(c) }}
                                    className="p-1 text-gray-500 hover:text-emerald-400 hover:bg-gray-800 rounded transition-colors"
                                    title="Export claim letter"
                                  ><FileText size={12} /></button>
                                </div>
                              </td>
                            </tr>
                            {expandedRow === c.id && (
                              <tr key={`${c.id}-exp`} className="bg-gray-800/30">
                                <td colSpan={14} className="px-4 py-4">
                                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                                    <div>
                                      <p className="text-gray-500 mb-1">Country</p>
                                      <p className="text-gray-200">{c.country || '—'}</p>
                                    </div>
                                    <div>
                                      <p className="text-gray-500 mb-1">Fitment Date</p>
                                      <p className="text-gray-200">{fmtDate(c.fitment_date)}</p>
                                    </div>
                                    <div>
                                      <p className="text-gray-500 mb-1">Removal Date</p>
                                      <p className="text-gray-200">{fmtDate(c.removal_date)}</p>
                                    </div>
                                    <div>
                                      <p className="text-gray-500 mb-1">Supplier</p>
                                      <p className="text-gray-200">{c.supplier || '—'}</p>
                                    </div>
                                    <div>
                                      <p className="text-gray-500 mb-1">Credit Date</p>
                                      <p className="text-gray-200">{fmtDate(c.credit_date)}</p>
                                    </div>
                                    <div className="col-span-2">
                                      <p className="text-gray-500 mb-1">Notes</p>
                                      <p className="text-gray-300">{c.notes || '—'}</p>
                                    </div>
                                    <div className="flex items-end gap-2">
                                      <button
                                        onClick={() => exportClaimLetter(c)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-800/40 hover:bg-emerald-700/50 border border-emerald-700/50 rounded-lg text-emerald-400 transition-colors"
                                      >
                                        <FileText size={12} /> Claim Letter
                                      </button>
                                      <button
                                        onClick={() => handleDelete(c.id)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/30 hover:bg-red-800/40 border border-red-800/50 rounded-lg text-red-400 transition-colors"
                                      >
                                        <XCircle size={12} /> Delete
                                      </button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
                  <p className="text-gray-500 text-xs">{filtered.length} claims · page {page} of {totalPages}</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="p-1.5 rounded-lg bg-gray-800 text-gray-400 disabled:opacity-40 hover:bg-gray-700 transition-colors"
                    ><ChevronLeft size={14} /></button>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="p-1.5 rounded-lg bg-gray-800 text-gray-400 disabled:opacity-40 hover:bg-gray-700 transition-colors"
                    ><ChevronRight size={14} /></button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === 'Brand Analysis' && (
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
              <BarChart3 size={16} className="text-blue-400" /> Brand Warranty Performance
            </h3>
            {brandPerf.length === 0 ? (
              <div className="flex items-center justify-center h-48 text-gray-500 text-sm">No data available</div>
            ) : (
              <div className="h-64">
                <Bar data={brandChartData} options={CHART_OPTS} />
              </div>
            )}
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-800/50">
                  {['Brand','Total Claims','Approval Rate','Avg Credit per Claim','Avg km at Failure'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-400">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {brandPerf.map((b, i) => (
                  <tr key={b.brand} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                    <td className="px-4 py-3 text-gray-200 font-medium">{b.brand}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-blue-900/40 text-blue-400 font-bold text-xs">{b.total}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                          <div className="h-full bg-green-500 rounded-full" style={{ width: `${b.approvalRate}%` }} />
                        </div>
                        <span className={`text-xs font-semibold ${b.approvalRate >= 70 ? 'text-green-400' : b.approvalRate >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>
                          {b.approvalRate.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-emerald-400 font-semibold text-sm">{b.avgCredit > 0 ? fmt(b.avgCredit) : '—'}</td>
                    <td className="px-4 py-3 text-gray-300 text-sm">{b.avgKm > 0 ? Math.round(b.avgKm).toLocaleString() + ' km' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {brandPerf.length === 0 && (
              <div className="flex items-center justify-center py-12 text-gray-500 text-sm">No brand data yet.</div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'Failure Analysis' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
              <PieChart size={16} className="text-orange-400" /> Claims by Failure Type
            </h3>
            {claims.length === 0 ? (
              <div className="flex items-center justify-center h-52 text-gray-500 text-sm">No data available</div>
            ) : (
              <>
                <div className="h-52">
                  <Doughnut data={failureDoughnutData} options={DOUGHNUT_OPTS} />
                </div>
                {failureCounts[0] && (
                  <div className="mt-3 p-3 bg-orange-900/20 border border-orange-800/40 rounded-lg text-xs text-orange-300">
                    Most common failure: <span className="font-bold">{failureCounts[0].type}</span> ({failureCounts[0].count} claims)
                  </div>
                )}
              </>
            )}
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
              <Activity size={16} className="text-purple-400" /> Average km at Failure by Type
            </h3>
            <div className="space-y-3">
              {failureCounts.filter(f => f.count > 0).map((f, i) => {
                const maxKm = Math.max(...failureCounts.map(x => x.avgKm), 1)
                return (
                  <div key={f.type}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-300">{f.type}</span>
                      <span className="text-gray-400">{f.count} claims · {f.avgKm > 0 ? f.avgKm.toLocaleString() + ' km avg' : 'N/A'}</span>
                    </div>
                    <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${maxKm > 0 ? (f.avgKm / maxKm) * 100 : 0}%`,
                          backgroundColor: FAILURE_PALETTE[i % FAILURE_PALETTE.length],
                        }}
                      />
                    </div>
                  </div>
                )
              })}
              {failureCounts.every(f => f.count === 0) && (
                <div className="text-gray-500 text-sm text-center py-8">No failure data yet.</div>
              )}
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 lg:col-span-2">
            <h3 className="text-sm font-semibold text-gray-200 mb-4">Claim Status Distribution</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {CLAIM_STATUSES.map((s, i) => (
                <div key={s} className={`p-3 rounded-xl border ${STATUS_CFG[s]?.bg} ${STATUS_CFG[s]?.border}`}>
                  <p className={`text-2xl font-bold ${STATUS_CFG[s]?.text}`}>{statusCounts[s] || 0}</p>
                  <p className="text-gray-400 text-xs mt-0.5">{s}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'Credit Recovery' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <p className="text-gray-400 text-xs mb-1">Total Credits Received</p>
              <p className="text-3xl font-bold text-emerald-400">{fmt(creditAnalysis.totalCredits)}</p>
              <p className="text-gray-500 text-xs mt-1">across {claims.filter(c => ['Credit Issued','Closed'].includes(c.claim_status)).length} claims</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <p className="text-gray-400 text-xs mb-1">Est. Unclaimed (Approved)</p>
              <p className="text-3xl font-bold text-yellow-400">{fmt(creditAnalysis.estimatedUnclaimed)}</p>
              <p className="text-gray-500 text-xs mt-1">{creditAnalysis.openApprovedCount} approved claims pending credit</p>
            </div>
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
              <p className="text-gray-400 text-xs mb-1">Total Recovery Pipeline</p>
              <p className="text-3xl font-bold text-blue-400">{fmt(creditAnalysis.totalCredits + creditAnalysis.estimatedUnclaimed)}</p>
              <p className="text-gray-500 text-xs mt-1">received + unclaimed potential</p>
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
              <TrendingUp size={16} className="text-emerald-400" /> Monthly Credits Received (12 months)
            </h3>
            <div className="h-64">
              <Bar data={creditTrendData} options={CHART_OPTS} />
            </div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
              <PieChart size={16} className="text-blue-400" /> Claim Status Funnel
            </h3>
            <div className="h-56">
              <Doughnut data={statusDoughnutData} options={DOUGHNUT_OPTS} />
            </div>
          </div>
        </div>
      )}

      {activeTab === 'ROI Calculator' && (
        <div className="space-y-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
            <h3 className="text-sm font-semibold text-gray-200 mb-5 flex items-center gap-2">
              <Target size={16} className="text-blue-400" /> Warranty ROI Calculator
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">Annual Tyre Count (fleet)</label>
                <input
                  type="number"
                  value={roiAnnualCount}
                  onChange={e => setRoiAnnualCount(e.target.value)}
                  placeholder="e.g. 500"
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">Average Tyre Cost ({cur})</label>
                <input
                  type="number"
                  value={roiAvgCost}
                  onChange={e => setRoiAvgCost(e.target.value)}
                  placeholder="e.g. 1200"
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
                <p className="text-gray-400 text-xs mb-1">Claims Filed (this year)</p>
                <p className="text-2xl font-bold text-blue-400">{roiCalc.thisYearClaims}</p>
              </div>
              <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
                <p className="text-gray-400 text-xs mb-1">Amount Recovered</p>
                <p className="text-2xl font-bold text-emerald-400">{fmt(roiCalc.thisYearCredits)}</p>
              </div>
              <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
                <p className="text-gray-400 text-xs mb-1">Recovery Rate</p>
                <p className="text-2xl font-bold text-green-400">
                  {Number(roiAvgCost) > 0 && Number(roiAnnualCount) > 0
                    ? `${roiCalc.recoveryRate.toFixed(1)}%`
                    : '—'}
                </p>
              </div>
              <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
                <p className="text-gray-400 text-xs mb-1">Est. Unclaimed Potential</p>
                <p className="text-2xl font-bold text-yellow-400">
                  {Number(roiAvgCost) > 0 && Number(roiAnnualCount) > 0 ? fmt(roiCalc.eligibleUnclaimed) : '—'}
                </p>
              </div>
            </div>
            {Number(roiAvgCost) > 0 && Number(roiAnnualCount) > 0 && roiCalc.eligibleUnclaimed > 0 && (
              <div className="mt-4 p-4 bg-blue-900/20 border border-blue-700/40 rounded-xl text-sm text-blue-300">
                <strong>Opportunity:</strong> If you filed claims on all eligible removals, you could recover an additional{' '}
                <span className="font-bold text-blue-200">{fmt(roiCalc.eligibleUnclaimed)}</span> per year.
                Based on 30% eligibility assumption at {`${cur} ${Number(roiAvgCost).toLocaleString()}`} per tyre × 40% credit rate.
              </div>
            )}
          </div>
        </div>
      )}

      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={e => { if (e.target === e.currentTarget) { setShowAdd(false); setEditClaim(null) } }}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto"
            >
              <div className="sticky top-0 bg-gray-900 border-b border-gray-800 px-6 py-4 flex items-center justify-between z-10">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  <ShieldCheck size={20} className="text-blue-400" />
                  {editClaim ? 'Edit Warranty Claim' : 'New Warranty Claim'}
                </h2>
                <button onClick={() => { setShowAdd(false); setEditClaim(null) }}
                  className="p-2 text-gray-500 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors">
                  <X size={18} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                {formError && (
                  <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-red-400 text-sm flex items-center gap-2">
                    <AlertTriangle size={14} /> {formError}
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-xs text-gray-400">Serial Number *</label>
                  <div className="flex gap-2">
                    <input
                      value={form.serial_number}
                      onChange={e => setForm(p => ({ ...p, serial_number: e.target.value }))}
                      placeholder="Enter serial number"
                      className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-blue-500"
                    />
                    <button
                      onClick={handleSerialLookup}
                      disabled={serialLookupLoading}
                      className="px-3 py-2 bg-blue-800/40 hover:bg-blue-700/50 border border-blue-700/50 rounded-lg text-blue-400 text-sm flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      {serialLookupLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                      Lookup
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400">Brand *</label>
                    <input value={form.brand} onChange={e => setForm(p => ({ ...p, brand: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400">Size</label>
                    <input value={form.size} onChange={e => setForm(p => ({ ...p, size: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400">Asset No</label>
                    <input value={form.asset_no} onChange={e => setForm(p => ({ ...p, asset_no: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400">Site</label>
                    <input value={form.site} onChange={e => setForm(p => ({ ...p, site: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400">Country</label>
                    <input value={form.country} onChange={e => setForm(p => ({ ...p, country: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400">Supplier</label>
                    <input value={form.supplier} onChange={e => setForm(p => ({ ...p, supplier: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400">Fitment Date</label>
                    <input type="date" value={form.fitment_date} onChange={e => setForm(p => ({ ...p, fitment_date: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400">Removal Date</label>
                    <input type="date" value={form.removal_date} onChange={e => setForm(p => ({ ...p, removal_date: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400">km at Fitment</label>
                    <input type="number" value={form.km_at_fitment} onChange={e => setForm(p => ({ ...p, km_at_fitment: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400">km at Removal</label>
                    <input type="number" value={form.km_at_removal} onChange={e => setForm(p => ({ ...p, km_at_removal: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-blue-500" />
                  </div>
                </div>

                {kmRun > 0 && (
                  <div className="p-3 bg-blue-900/20 border border-blue-700/40 rounded-lg text-xs text-blue-300">
                    km Run: <span className="font-bold text-blue-200">{kmRun.toLocaleString()} km</span>
                    {form.expected_life_km > 0 && (
                      <> · {((kmRun / Number(form.expected_life_km)) * 100).toFixed(1)}% of expected life</>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400">Expected Life km</label>
                    <input type="number" value={form.expected_life_km} onChange={e => setForm(p => ({ ...p, expected_life_km: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-blue-500" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400">Failure Type *</label>
                    <select value={form.failure_type} onChange={e => setForm(p => ({ ...p, failure_type: e.target.value }))}
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-blue-500">
                      {FAILURE_TYPES.map(f => <option key={f}>{f}</option>)}
                    </select>
                  </div>
                </div>

                {editClaim && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-gray-400">Status</label>
                      <select value={form.claim_status} onChange={e => setForm(p => ({ ...p, claim_status: e.target.value }))}
                        className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-blue-500">
                        {CLAIM_STATUSES.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                    {form.claim_status === 'Credit Issued' && (
                      <>
                        <div className="space-y-1">
                          <label className="text-xs text-gray-400">Credit Amount ({cur})</label>
                          <input type="number" value={form.credit_amount} onChange={e => setForm(p => ({ ...p, credit_amount: e.target.value }))}
                            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-blue-500" />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs text-gray-400">Credit Date</label>
                          <input type="date" value={form.credit_date} onChange={e => setForm(p => ({ ...p, credit_date: e.target.value }))}
                            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-blue-500" />
                        </div>
                      </>
                    )}
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-xs text-gray-400">Notes / Failure Description</label>
                  <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                    rows={3} placeholder="Describe the failure, location on tyre, etc."
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500 resize-none" />
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button onClick={() => { setShowAdd(false); setEditClaim(null) }}
                    className="px-4 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm text-gray-300 transition-colors">
                    Cancel
                  </button>
                  <button onClick={handleSave} disabled={saving}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm font-semibold text-white transition-colors disabled:opacity-50 flex items-center gap-2">
                    {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    {editClaim ? 'Update Claim' : 'Save Claim'}
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
