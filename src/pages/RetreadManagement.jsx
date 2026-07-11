import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  RefreshCw, Download, FileText, FileSpreadsheet, Search, Filter,
  Loader2, AlertTriangle, CheckCircle, TrendingDown, TrendingUp,
  DollarSign, BarChart3, Package, Award, X, ChevronRight,
  Activity, Building2, Tag, Calendar, Layers, Info, Star,
  ArrowRight, Recycle, CircleDollarSign, Target, Zap, Lock,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import EntityApprovalPanel from '../components/workflow/EntityApprovalPanel'
import { fetchAllPages } from '../lib/fetchAll'
import { useAuth } from '../contexts/AuthContext'
import { useSettings } from '../contexts/SettingsContext'
import { useTenant } from '../contexts/TenantContext'
import { exportToExcel, exportToPdf, resolvePdfBrand, pdfHeader, pdfFooter, pdfTableTheme } from '../lib/exportUtils'
import { formatMonthYear } from '../lib/formatters'
import PageHeader from '../components/ui/PageHeader'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend,
)

// ── Constants ──────────────────────────────────────────────────────────────────

const TABS = ['Overview', 'Vendor Analysis', 'Lifecycle', 'ROI Calculator']

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
    legend: { position: 'bottom', labels: { color: '#9ca3af', boxWidth: 12, font: { size: 11 }, padding: 12 } },
    tooltip: {
      backgroundColor: 'var(--panel)',
      borderColor: 'var(--hairline)',
      borderWidth: 1,
      titleColor: '#f9fafb',
      bodyColor: '#d1d5db',
    },
  },
}

const RISK_HIGH = new Set(['High', 'Critical'])

const EXPORT_COLS = [
  'serial_number', 'brand', 'size', 'position', 'asset_no', 'site',
  'issue_date', 'km_at_fitment', 'km_at_removal', 'km_life', 'cost_per_tyre',
  'cpk', 'category', 'risk_level', 'status',
]
const EXPORT_HEADERS = [
  'Serial', 'Brand', 'Size', 'Position', 'Asset No', 'Site',
  'Issue Date', 'km at Fitment', 'km at Removal', 'km Life', 'Cost',
  'CPK', 'Category', 'Risk Level', 'Status',
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function kmLife(t) {
  const km = (t.km_at_removal ?? 0) - (t.km_at_fitment ?? 0)
  return km > 0 ? km : null
}

function cpk(t) {
  const life = kmLife(t)
  const cost = parseFloat(t.cost_per_tyre) || 0
  if (!life || !cost) return null
  return cost / life
}

function fmtCpk(val, currency) {
  if (val == null || !isFinite(val)) return 'N/A'
  return `${currency} ${val.toFixed(4)}`
}

function fmtCurrency(val, currency) {
  if (val == null || !isFinite(val)) return `${currency} 0`
  return `${currency} ${Number(val).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function daysInService(t) {
  const start = t.issue_date
  const end = t.removal_date ?? null
  if (!start) return null
  const d1 = new Date(start)
  const d2 = end ? new Date(end) : new Date()
  return Math.max(0, Math.round((d2 - d1) / 86400000))
}

function last12Months() {
  const months = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push(d.toISOString().slice(0, 7))
  }
  return months
}

function scoreVendor(v) {
  // 0-100 composite: CPK efficiency 40%, success rate 40%, life km 20%
  // Lower CPK is better; higher success/life is better
  // Normalised relative to own data; use raw heuristics here
  const cpkScore = v.avgCpk != null ? Math.max(0, 100 - v.avgCpk * 10000) : 50
  const successScore = v.successRate ?? 50
  const lifeScore = v.avgLife != null ? Math.min(100, (v.avgLife / 1000) * 10) : 50
  return Math.round(cpkScore * 0.4 + successScore * 0.4 + lifeScore * 0.2)
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KpiCard({ icon: Icon, label, value, sub, color = 'text-blue-400', trend }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4 flex items-start gap-3"
    >
      <div className={`p-2 rounded-lg bg-[var(--input-bg)] shrink-0 ${color}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-[var(--text-muted)] text-xs leading-tight">{label}</p>
        <p className={`text-xl font-bold mt-0.5 truncate ${color}`}>{value}</p>
        {sub && <p className="text-[var(--text-muted)] text-xs mt-0.5 leading-tight">{sub}</p>}
      </div>
      {trend != null && (
        <div className={`ml-auto shrink-0 flex items-center gap-0.5 text-xs font-semibold ${trend >= 0 ? 'text-green-400' : 'text-red-400'}`}>
          {trend >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
          {Math.abs(trend).toFixed(1)}%
        </div>
      )}
    </motion.div>
  )
}

function Badge({ label, color }) {
  const map = {
    success:  'bg-green-900/40 text-green-400 border-green-700/50',
    warning:  'bg-yellow-900/40 text-yellow-400 border-yellow-700/50',
    danger:   'bg-red-900/40 text-red-400 border-red-700/50',
    info:     'bg-blue-900/40 text-blue-400 border-blue-700/50',
    neutral:  'bg-gray-800 text-gray-400 border-gray-600',
    purple:   'bg-purple-900/40 text-purple-400 border-purple-700/50',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold ${map[color] ?? map.neutral}`}>
      {label}
    </span>
  )
}

function ScoreBadge({ score }) {
  const color = score >= 75 ? 'text-green-400 bg-green-900/30 border-green-700/50'
    : score >= 50 ? 'text-yellow-400 bg-yellow-900/30 border-yellow-700/50'
    : 'text-red-400 bg-red-900/30 border-red-700/50'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-bold ${color}`}>
      {score}
    </span>
  )
}

function EmptyState({ icon: Icon = Package, title, sub }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      <Icon className="text-[var(--text-dim)]" size={48} />
      <p className="text-[var(--text-muted)] font-medium">{title}</p>
      {sub && <p className="text-[var(--text-dim)] text-sm">{sub}</p>}
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function RetreadManagement() {
  const { profile } = useAuth()
  const { appSettings, activeCurrency, activeCountry } = useSettings()
  const { branding } = useTenant()
  const company = branding?.legal_name || branding?.display_name || appSettings?.company_name || 'TyrePulse'
  const isAdmin = profile?.role === 'Admin'

  // ── State ──────────────────────────────────────────────────────────────────
  const [records, setRecords]     = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [activeTab, setActiveTab] = useState('Overview')

  // Filters
  const [filterSite, setFilterSite]   = useState('All')
  const [filterBrand, setFilterBrand] = useState('All')
  const [filterRisk, setFilterRisk]   = useState('All')
  const [search, setSearch]           = useState('')

  // Lifecycle drawer
  const [drawer, setDrawer]       = useState(null)

  // Approval & Workflow Engine gate. The open retread casing (in the detail
  // drawer) is the document under approval — retread send-outs / vendor decisions
  // warrant sign-off. While its workflow is active (pending/in_review/returned) or
  // locked (approved), the record's strongest mutation — its per-record export
  // (the artifact a vendor acts on) — is disabled so an in-approval casing can't be
  // exported out from under the workflow. State resets whenever the record changes.
  const [wfLocked, setWfLocked] = useState(false)
  useEffect(() => { setWfLocked(false) }, [drawer?.id])

  // ROI Calculator
  const [roi, setRoi] = useState({
    newCost: 1200,
    retreadCost: 480,
    retreadLifeKm: 80000,
    newLifeKm: 100000,
    fleetSize: 50,
  })

  // ── Data loading ───────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await fetchAllPages((from, to) => {
        let query = supabase
          .from('tyre_records')
          .select('id, asset_no, serial_number, brand, size, position, site, country, risk_level, tread_depth, cost_per_tyre, km_at_fitment, km_at_removal, issue_date, removal_date, qty, category')
        if (activeCountry && activeCountry !== 'All') {
          query = query.eq('country', activeCountry)
        }
        return query.range(from, to)
      })
      if (err) throw err
      setRecords(data ?? [])
    } catch (e) {
      setError(e.message ?? 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { loadData() }, [loadData])

  // ── Derived datasets ───────────────────────────────────────────────────────
  const retreadRecords = useMemo(() =>
    records.filter(r => r.category?.toLowerCase() === 'retread'),
  [records])

  const newRecords = useMemo(() =>
    records.filter(r => !r.category || r.category.toLowerCase() !== 'retread'),
  [records])

  // Enrich each retread record with computed fields
  const enriched = useMemo(() =>
    retreadRecords.map(t => ({
      ...t,
      km_life: kmLife(t),
      cpk: cpk(t),
      status: t.km_at_removal ? 'Removed' : 'Active',
      days_in_service: daysInService(t),
    })),
  [retreadRecords])

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalRetreads = enriched.length

    // Retread CPK (avg over retreads with valid cpk)
    const retreadCpkVals = enriched.map(t => t.cpk).filter(v => v != null && isFinite(v))
    const retreadCpk = retreadCpkVals.length
      ? retreadCpkVals.reduce((s, v) => s + v, 0) / retreadCpkVals.length
      : null

    // New tyre CPK
    const newCpkVals = newRecords.map(t => cpk(t)).filter(v => v != null && isFinite(v))
    const newCpk = newCpkVals.length
      ? newCpkVals.reduce((s, v) => s + v, 0) / newCpkVals.length
      : null

    // Savings vs new
    let savings = null
    if (retreadCpk != null && newCpk != null) {
      const avgLifeKm = enriched.filter(t => t.km_life).reduce((s, t) => s + t.km_life, 0) / Math.max(1, enriched.filter(t => t.km_life).length)
      savings = (newCpk - retreadCpk) * avgLifeKm * totalRetreads
    }

    // Retread success rate: % not High/Critical at removal
    const removed = enriched.filter(t => t.km_at_removal)
    const successCount = removed.filter(t => !RISK_HIGH.has(t.risk_level)).length
    const successRate = removed.length > 0 ? (successCount / removed.length) * 100 : null

    return { totalRetreads, retreadCpk, newCpk, savings, successRate }
  }, [enriched, newRecords])

  // ── Filter options ─────────────────────────────────────────────────────────
  const siteOptions = useMemo(() => {
    const sites = [...new Set(enriched.map(t => t.site).filter(Boolean))].sort()
    return ['All', ...sites]
  }, [enriched])

  const brandOptions = useMemo(() => {
    const brands = [...new Set(enriched.map(t => t.brand).filter(Boolean))].sort()
    return ['All', ...brands]
  }, [enriched])

  const riskOptions = ['All', 'Low', 'Medium', 'High', 'Critical']

  // ── Filtered lifecycle list ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return enriched.filter(t => {
      if (filterSite !== 'All' && t.site !== filterSite) return false
      if (filterBrand !== 'All' && t.brand !== filterBrand) return false
      if (filterRisk !== 'All' && t.risk_level !== filterRisk) return false
      if (search) {
        const s = search.toLowerCase()
        return (
          t.serial_number?.toLowerCase().includes(s) ||
          t.brand?.toLowerCase().includes(s) ||
          t.asset_no?.toLowerCase().includes(s) ||
          t.size?.toLowerCase().includes(s) ||
          t.site?.toLowerCase().includes(s)
        )
      }
      return true
    })
  }, [enriched, filterSite, filterBrand, filterRisk, search])

  // ── Overview charts ────────────────────────────────────────────────────────
  const overviewCharts = useMemo(() => {
    const months = last12Months()
    const monthCounts = Object.fromEntries(months.map(m => [m, 0]))
    enriched.forEach(t => {
      const m = t.issue_date?.slice(0, 7)
      if (m && monthCounts[m] != null) monthCounts[m]++
    })

    const retreadVsNew = {
      labels: ['Retread', 'New'],
      datasets: [{
        data: [retreadRecords.length, newRecords.length],
        backgroundColor: ['#8b5cf6', '#3b82f6'],
        borderColor: ['#7c3aed', '#2563eb'],
        borderWidth: 1,
      }],
    }

    const monthlyBar = {
      labels: months.map(m => {
        const [yr, mo] = m.split('-')
        return formatMonthYear(new Date(Number(yr), Number(mo) - 1, 1))
      }),
      datasets: [{
        label: 'Retreads Fitted',
        data: months.map(m => monthCounts[m]),
        backgroundColor: 'rgba(139,92,246,0.7)',
        borderColor: '#8b5cf6',
        borderWidth: 1,
        borderRadius: 4,
      }],
    }

    return { retreadVsNew, monthlyBar }
  }, [enriched, retreadRecords.length, newRecords.length])

  // ── Brand summary table ────────────────────────────────────────────────────
  const brandSummary = useMemo(() => {
    const map = {}
    enriched.forEach(t => {
      const b = t.brand?.trim() || 'Unknown'
      if (!map[b]) map[b] = { brand: b, tyres: [] }
      map[b].tyres.push(t)
    })
    return Object.values(map).map(({ brand, tyres }) => {
      const cpkVals = tyres.map(t => t.cpk).filter(v => v != null && isFinite(v))
      const lifeVals = tyres.map(t => t.km_life).filter(v => v != null)
      const removed = tyres.filter(t => t.km_at_removal)
      const successCount = removed.filter(t => !RISK_HIGH.has(t.risk_level)).length
      return {
        brand,
        count: tyres.length,
        avgCpk: cpkVals.length ? cpkVals.reduce((s, v) => s + v, 0) / cpkVals.length : null,
        avgLife: lifeVals.length ? Math.round(lifeVals.reduce((s, v) => s + v, 0) / lifeVals.length) : null,
        successRate: removed.length > 0 ? Math.round((successCount / removed.length) * 100) : null,
        _tyres: tyres,
      }
    }).sort((a, b) => b.count - a.count)
  }, [enriched])

  // ── Vendor analysis ────────────────────────────────────────────────────────
  const vendorData = useMemo(() => {
    const newCpkVals = newRecords.map(t => cpk(t)).filter(v => v != null && isFinite(v))
    const newCpkAvg = newCpkVals.length ? newCpkVals.reduce((s, v) => s + v, 0) / newCpkVals.length : null

    const vendors = brandSummary.map(b => {
      const cpkDiff = (newCpkAvg != null && b.avgCpk != null && b.avgLife != null)
        ? (newCpkAvg - b.avgCpk) * b.avgLife * b.count
        : null
      const failureRate = 100 - (b.successRate ?? 100)
      const score = scoreVendor({ ...b })
      return {
        ...b,
        failureRate,
        savingsVsNew: cpkDiff,
        score,
      }
    }).sort((a, b) => b.score - a.score)

    // CPK trend for top 3 vendors (last 12 months)
    const top3 = vendors.slice(0, 3).map(v => v.brand)
    const months = last12Months()
    const trendDatasets = top3.map((brand, i) => {
      const colors = ['#8b5cf6', '#3b82f6', '#10b981']
      const data = months.map(m => {
        const monthTyres = enriched.filter(t =>
          t.brand === brand && t.issue_date?.startsWith(m)
        )
        const vals = monthTyres.map(t => t.cpk).filter(v => v != null && isFinite(v))
        return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null
      })
      return {
        label: brand,
        data,
        borderColor: colors[i],
        backgroundColor: colors[i] + '20',
        fill: false,
        tension: 0.4,
        spanGaps: true,
      }
    })

    const trendChart = {
      labels: months.map(m => {
        const [yr, mo] = m.split('-')
        return formatMonthYear(new Date(Number(yr), Number(mo) - 1, 1))
      }),
      datasets: trendDatasets,
    }

    return { vendors, trendChart }
  }, [brandSummary, newRecords, enriched])

  // ── ROI Calculations ───────────────────────────────────────────────────────
  const roiCalc = useMemo(() => {
    const { newCost, retreadCost, retreadLifeKm, newLifeKm, fleetSize } = roi
    const nC = parseFloat(newCost) || 0
    const rC = parseFloat(retreadCost) || 0
    const rL = parseFloat(retreadLifeKm) || 1
    const nL = parseFloat(newLifeKm) || 1
    const fS = parseFloat(fleetSize) || 0

    const newCpkVal  = nC / nL
    const rCpkVal    = rC / rL
    const savingsPerTyre = (newCpkVal - rCpkVal) * rL
    const breakEvenKm = rL > 0 ? (nC - rC) / Math.max(0.0001, newCpkVal - rCpkVal) : 0
    const annualReplacements = fS * (100000 / Math.max(1, rL))
    const annualSavings = savingsPerTyre * annualReplacements

    const tcoChartData = {
      labels: ['New Tyre', 'Retread Tyre'],
      datasets: [
        {
          label: 'Initial Cost',
          data: [nC, rC],
          backgroundColor: ['rgba(59,130,246,0.8)', 'rgba(139,92,246,0.8)'],
          borderRadius: 4,
        },
        {
          label: 'Cost per 100,000 km',
          data: [newCpkVal * 100000, rCpkVal * 100000],
          backgroundColor: ['rgba(59,130,246,0.4)', 'rgba(139,92,246,0.4)'],
          borderRadius: 4,
        },
      ],
    }

    return {
      newCpkVal,
      rCpkVal,
      savingsPerTyre,
      breakEvenKm,
      annualSavings,
      tcoChartData,
      cpkImprovement: newCpkVal > 0 ? ((newCpkVal - rCpkVal) / newCpkVal) * 100 : 0,
    }
  }, [roi])

  // ── Export handlers ────────────────────────────────────────────────────────
  const handleExportExcel = useCallback(() => {
    const rows = enriched.map(t => ({
      serial_number: t.serial_number,
      brand: t.brand,
      size: t.size,
      position: t.position,
      asset_no: t.asset_no,
      site: t.site,
      issue_date: t.issue_date,
      km_at_fitment: t.km_at_fitment,
      km_at_removal: t.km_at_removal,
      km_life: t.km_life,
      cost_per_tyre: t.cost_per_tyre,
      cpk: t.cpk != null ? t.cpk.toFixed(6) : '',
      category: t.category,
      risk_level: t.risk_level,
      status: t.status,
    }))
    exportToExcel(rows, EXPORT_COLS, EXPORT_HEADERS, `TyrePulse_Retread_${new Date().toISOString().slice(0, 10)}`, 'Retread Records')
  }, [enriched])

  const handleExportPdf = useCallback(() => {
    exportToPdf(
      enriched.map(t => ({
        serial_number: t.serial_number,
        brand: t.brand,
        size: t.size,
        position: t.position,
        asset_no: t.asset_no,
        site: t.site,
        issue_date: t.issue_date,
        km_life: t.km_life ?? '',
        cost_per_tyre: t.cost_per_tyre,
        cpk: t.cpk != null ? t.cpk.toFixed(6) : '',
        category: t.category,
        risk_level: t.risk_level,
        status: t.status,
      })),
      [
        { key: 'serial_number', header: 'Serial' },
        { key: 'brand', header: 'Brand' },
        { key: 'size', header: 'Size' },
        { key: 'position', header: 'Position' },
        { key: 'asset_no', header: 'Asset' },
        { key: 'site', header: 'Site' },
        { key: 'issue_date', header: 'Issue Date' },
        { key: 'km_life', header: 'km Life' },
        { key: 'cost_per_tyre', header: 'Cost' },
        { key: 'cpk', header: 'CPK' },
        { key: 'risk_level', header: 'Risk Level' },
        { key: 'status', header: 'Status' },
      ],
      'Retread Management Report',
      `TyrePulse_Retread_${new Date().toISOString().slice(0, 10)}`,
      'landscape',
    )
  }, [enriched])

  const handleExportRoiPdf = useCallback(async () => {
    const { default: jsPDF } = await import('jspdf')
    const { default: autoTable } = await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const brand = await resolvePdfBrand(branding)
    pdfHeader(doc, 'Retread ROI Analysis', `Fleet size: ${roi.fleetSize} tyres`, company, brand)

    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 41, 59)
    doc.text('Input Parameters', 14, 32)

    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: 36,
      head: [['Parameter', 'Value']],
      body: [
        ['New Tyre Cost', `${activeCurrency} ${roi.newCost}`],
        ['Retread Cost', `${activeCurrency} ${roi.retreadCost}`],
        ['Expected New Tyre Life', `${Number(roi.newLifeKm).toLocaleString()} km`],
        ['Expected Retread Life', `${Number(roi.retreadLifeKm).toLocaleString()} km`],
        ['Fleet Size', `${roi.fleetSize} tyres`],
      ],
      margin: { left: 14, right: 14 },
    })

    const y1 = doc.lastAutoTable.finalY + 10
    doc.setFontSize(12)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30, 41, 59)
    doc.text('ROI Results', 14, y1)

    autoTable(doc, {
      ...pdfTableTheme(brand.accent),
      startY: y1 + 4,
      head: [['Metric', 'Value']],
      body: [
        ['New Tyre CPK', `${activeCurrency} ${roiCalc.newCpkVal.toFixed(6)}`],
        ['Retread CPK', `${activeCurrency} ${roiCalc.rCpkVal.toFixed(6)}`],
        ['CPK Improvement', `${roiCalc.cpkImprovement.toFixed(1)}%`],
        ['Savings per Tyre', fmtCurrency(roiCalc.savingsPerTyre, activeCurrency)],
        ['Break-even at', `${Math.round(roiCalc.breakEvenKm).toLocaleString()} km`],
        ['Projected Annual Fleet Savings', fmtCurrency(roiCalc.annualSavings, activeCurrency)],
      ],
      margin: { left: 14, right: 14 },
    })

    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) { doc.setPage(p); pdfFooter(doc, p, totalPages, company, brand) }

    doc.save(`TyrePulse_ROI_Analysis_${new Date().toISOString().slice(0, 10)}.pdf`)
  }, [roi, roiCalc, activeCurrency, branding, company])

  // ── Per-record casing export (the retread send-out artifact) ────────────────
  // Gated by the approval workflow: an in-approval / approved casing can't be
  // exported out from under its workflow. The server remains the real boundary;
  // this early-return is the client-side convenience guard.
  const handleExportCasing = useCallback(async (rec) => {
    if (!rec || wfLocked) return
    exportToPdf(
      [{
        serial_number: rec.serial_number,
        brand: rec.brand,
        size: rec.size,
        position: rec.position,
        asset_no: rec.asset_no,
        site: rec.site,
        issue_date: rec.issue_date,
        km_life: rec.km_life ?? '',
        cost_per_tyre: rec.cost_per_tyre,
        cpk: rec.cpk != null ? rec.cpk.toFixed(6) : '',
        risk_level: rec.risk_level,
        status: rec.status,
      }],
      [
        { key: 'serial_number', header: 'Serial' },
        { key: 'brand', header: 'Brand' },
        { key: 'size', header: 'Size' },
        { key: 'position', header: 'Position' },
        { key: 'asset_no', header: 'Asset' },
        { key: 'site', header: 'Site' },
        { key: 'issue_date', header: 'Issue Date' },
        { key: 'km_life', header: 'km Life' },
        { key: 'cost_per_tyre', header: 'Cost' },
        { key: 'cpk', header: 'CPK' },
        { key: 'risk_level', header: 'Risk Level' },
        { key: 'status', header: 'Status' },
      ],
      `Retread Casing - ${rec.serial_number ?? rec.asset_no ?? rec.id}`,
      `TyrePulse_Retread_Casing_${rec.serial_number ?? rec.id}`,
      'landscape',
    )
  }, [wfLocked])

  // ── Risk badge helper ──────────────────────────────────────────────────────
  function riskBadge(level) {
    const map = { Critical: 'danger', High: 'warning', Medium: 'info', Low: 'success' }
    return <Badge label={level ?? 'N/A'} color={map[level] ?? 'neutral'} />
  }

  // ── Status badge helper ────────────────────────────────────────────────────
  function statusBadge(status) {
    return <Badge label={status} color={status === 'Active' ? 'success' : 'neutral'} />
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      <PageHeader
        title="Retread Management"
        subtitle="Manage retread casings, suppliers, and performance metrics"
        icon={Recycle}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] transition disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button
            onClick={handleExportPdf}
            className="flex items-center gap-1.5 px-3 py-2 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] transition"
          >
            <FileText size={14} /> PDF
          </button>
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-2 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] transition"
          >
            <FileSpreadsheet size={14} /> Excel
          </button>
          </div>
        }
      />

      {/* Country/Site filter bar */}
      <div className="flex flex-wrap items-center gap-2 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl px-4 py-3">
        <Filter size={14} className="text-[var(--text-muted)] shrink-0" />
        <span className="text-[var(--text-muted)] text-xs shrink-0">Filter:</span>
        <select
          value={filterSite}
          onChange={e => setFilterSite(e.target.value)}
          className="px-2 py-1 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-xs text-[var(--text-secondary)] focus:outline-none focus:border-purple-600"
        >
          {siteOptions.map(o => <option key={o}>{o}</option>)}
        </select>
        <select
          value={filterBrand}
          onChange={e => setFilterBrand(e.target.value)}
          className="px-2 py-1 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-xs text-[var(--text-secondary)] focus:outline-none focus:border-purple-600"
        >
          {brandOptions.map(o => <option key={o}>{o}</option>)}
        </select>
        <select
          value={filterRisk}
          onChange={e => setFilterRisk(e.target.value)}
          className="px-2 py-1 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-xs text-[var(--text-secondary)] focus:outline-none focus:border-purple-600"
        >
          {riskOptions.map(o => <option key={o}>{o}</option>)}
        </select>
        <span className="ml-auto text-[var(--text-dim)] text-xs">
          {enriched.length.toLocaleString()} retread records · {records.length.toLocaleString()} total
        </span>
      </div>

      {/* Error state */}
      {error && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-900/30 border border-red-700 rounded-xl px-4 py-3 flex items-center gap-3"
        >
          <AlertTriangle className="text-red-400 shrink-0" size={18} />
          <p className="text-red-300 text-sm">{error}</p>
          <button onClick={loadData} className="ml-auto text-red-400 hover:text-red-200 text-xs underline">
            Retry
          </button>
        </motion.div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <Loader2 className="animate-spin text-purple-400 mr-3" size={28} />
          <span className="text-[var(--text-muted)]">Loading retread data...</span>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <KpiCard
              icon={Recycle}
              label="Total Retread Tyres"
              value={kpis.totalRetreads.toLocaleString()}
              sub={`of ${records.length.toLocaleString()} total`}
              color="text-purple-400"
            />
            <KpiCard
              icon={TrendingDown}
              label="Retread CPK"
              value={fmtCpk(kpis.retreadCpk, activeCurrency)}
              sub="cost per kilometer"
              color="text-blue-400"
            />
            <KpiCard
              icon={Tag}
              label="New Tyre CPK"
              value={fmtCpk(kpis.newCpk, activeCurrency)}
              sub="cost per kilometer"
              color="text-[var(--text-secondary)]"
            />
            <KpiCard
              icon={CircleDollarSign}
              label="Retread Savings vs New"
              value={kpis.savings != null ? fmtCurrency(kpis.savings, activeCurrency) : 'N/A'}
              sub="total fleet savings"
              color={kpis.savings != null && kpis.savings > 0 ? 'text-green-400' : 'text-yellow-400'}
            />
            <KpiCard
              icon={CheckCircle}
              label="Retread Success Rate"
              value={kpis.successRate != null ? `${kpis.successRate.toFixed(1)}%` : 'N/A'}
              sub="non-high-risk at removal"
              color={kpis.successRate != null && kpis.successRate >= 80 ? 'text-green-400' : kpis.successRate != null && kpis.successRate >= 60 ? 'text-yellow-400' : 'text-red-400'}
            />
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-1 overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition ${
                  activeTab === t
                    ? 'bg-purple-700 text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* ── Tab: Overview ── */}
          {activeTab === 'Overview' && (
            <div className="space-y-5">
              {enriched.length === 0 ? (
                <EmptyState
                  icon={Recycle}
                  title="No retread tyres found"
                  sub="Retread tyres are identified by category = 'Retread' in tyre records"
                />
              ) : (
                <>
                  {/* Charts row */}
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="lg:col-span-2 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                      <p className="text-xs text-[var(--text-muted)] mb-3 font-medium flex items-center gap-1.5">
                        <BarChart3 size={13} className="text-purple-400" /> Retread Fitments: Last 12 Months
                      </p>
                      <div className="h-52">
                        <Bar
                          data={overviewCharts.monthlyBar}
                          options={{
                            ...CHART_OPTS,
                            plugins: { ...CHART_OPTS.plugins, legend: { display: false } },
                          }}
                        />
                      </div>
                    </div>
                    <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                      <p className="text-xs text-[var(--text-muted)] mb-3 font-medium flex items-center gap-1.5">
                        <Layers size={13} className="text-blue-400" /> Retread vs New Distribution
                      </p>
                      <div className="h-52">
                        <Doughnut data={overviewCharts.retreadVsNew} options={DOUGHNUT_OPTS} />
                      </div>
                    </div>
                  </div>

                  {/* Brand table */}
                  <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Award className="text-yellow-400" size={16} />
                        <h2 className="font-semibold text-[var(--text-secondary)] text-sm">Retread Performance by Brand</h2>
                      </div>
                      <span className="text-[var(--text-dim)] text-xs">{brandSummary.length} brands</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[var(--input-border)] text-[var(--text-muted)] text-xs">
                            <th className="px-4 py-3 text-left">Brand</th>
                            <th className="px-4 py-3 text-center">Count</th>
                            <th className="px-4 py-3 text-center">Avg CPK</th>
                            <th className="px-4 py-3 text-center">Avg Life (km)</th>
                            <th className="px-4 py-3 text-center">Success Rate</th>
                            <th className="px-4 py-3 text-center">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {brandSummary.map((b, i) => (
                            <motion.tr
                              key={b.brand}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={{ delay: i * 0.03 }}
                              className="border-b border-gray-800/60 hover:bg-gray-800/40 transition"
                            >
                              <td className="px-4 py-3 font-medium text-[var(--text-secondary)]">{b.brand}</td>
                              <td className="px-4 py-3 text-center text-[var(--text-secondary)]">{b.count}</td>
                              <td className="px-4 py-3 text-center text-purple-400 font-mono text-xs">
                                {fmtCpk(b.avgCpk, activeCurrency)}
                              </td>
                              <td className="px-4 py-3 text-center text-[var(--text-secondary)]">
                                {b.avgLife != null ? b.avgLife.toLocaleString() : 'N/A'}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {b.successRate != null ? (
                                  <span className={`font-semibold text-sm ${b.successRate >= 80 ? 'text-green-400' : b.successRate >= 60 ? 'text-yellow-400' : 'text-red-400'}`}>
                                    {b.successRate}%
                                  </span>
                                ) : <span className="text-[var(--text-dim)]">N/A</span>}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <button
                                  onClick={() => { setFilterBrand(b.brand); setActiveTab('Lifecycle') }}
                                  className="flex items-center gap-1 px-2 py-1 bg-purple-900/30 hover:bg-purple-900/60 border border-purple-700/50 rounded text-purple-400 text-xs transition mx-auto"
                                >
                                  View <ChevronRight size={11} />
                                </button>
                              </td>
                            </motion.tr>
                          ))}
                          {brandSummary.length === 0 && (
                            <tr>
                              <td colSpan={6} className="px-4 py-10 text-center text-[var(--text-muted)]">No brand data available</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    {/* Summary stats */}
                    {brandSummary.length > 0 && (
                      <div className="px-4 py-3 border-t border-[var(--input-border)] flex flex-wrap gap-4 text-xs text-[var(--text-muted)]">
                        {(() => {
                          const topBrand = [...brandSummary].filter(b => b.successRate != null).sort((a, b) => (b.successRate ?? 0) - (a.successRate ?? 0))[0]
                          const bestSize = (() => {
                            const sizeMap = {}
                            enriched.filter(t => t.km_life && t.size).forEach(t => {
                              if (!sizeMap[t.size]) sizeMap[t.size] = []
                              sizeMap[t.size].push(t.km_life)
                            })
                            let best = null, bestAvg = 0
                            Object.entries(sizeMap).forEach(([sz, vals]) => {
                              const avg = vals.reduce((s, v) => s + v, 0) / vals.length
                              if (avg > bestAvg) { bestAvg = avg; best = sz }
                            })
                            return best
                          })()
                          return (
                            <>
                              {topBrand && <span>Top retread brand: <span className="text-[var(--text-secondary)] font-semibold">{topBrand.brand}</span> ({topBrand.successRate}% success)</span>}
                              {bestSize && <span>Best performing size: <span className="text-[var(--text-secondary)] font-mono font-semibold">{bestSize}</span></span>}
                            </>
                          )
                        })()}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Tab: Vendor Analysis ── */}
          {activeTab === 'Vendor Analysis' && (
            <div className="space-y-5">
              {vendorData.vendors.length === 0 ? (
                <EmptyState icon={Building2} title="No vendor data available" sub="Vendor analysis requires retread tyre records with brand information" />
              ) : (
                <>
                  {/* Vendor table */}
                  <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-[var(--input-border)] flex items-center gap-2">
                      <Star className="text-yellow-400" size={16} />
                      <h2 className="font-semibold text-[var(--text-secondary)] text-sm">Retread Vendor / Brand Scorecard</h2>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-[var(--input-border)] text-[var(--text-muted)] text-xs">
                            <th className="px-4 py-3 text-left">Vendor / Brand</th>
                            <th className="px-4 py-3 text-center">Total Retreads</th>
                            <th className="px-4 py-3 text-center">Avg CPK</th>
                            <th className="px-4 py-3 text-center">Avg Life (km)</th>
                            <th className="px-4 py-3 text-center">Success Rate</th>
                            <th className="px-4 py-3 text-center">Failure Rate</th>
                            <th className="px-4 py-3 text-center">Savings vs New</th>
                            <th className="px-4 py-3 text-center">Score</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vendorData.vendors.map((v, i) => (
                            <motion.tr
                              key={v.brand}
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={{ delay: i * 0.03 }}
                              className={`border-b border-gray-800/60 hover:bg-gray-800/40 transition ${v.score < 40 ? 'bg-red-900/10' : ''}`}
                            >
                              <td className="px-4 py-3 font-medium text-[var(--text-secondary)]">
                                <div className="flex items-center gap-2">
                                  {v.score < 40 && <AlertTriangle className="text-red-400" size={12} />}
                                  {v.brand}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-center text-[var(--text-secondary)]">{v.count}</td>
                              <td className="px-4 py-3 text-center text-purple-400 font-mono text-xs">
                                {fmtCpk(v.avgCpk, activeCurrency)}
                              </td>
                              <td className="px-4 py-3 text-center text-[var(--text-secondary)]">
                                {v.avgLife != null ? v.avgLife.toLocaleString() : 'N/A'}
                              </td>
                              <td className="px-4 py-3 text-center">
                                {v.successRate != null
                                  ? <span className={`font-semibold ${v.successRate >= 80 ? 'text-green-400' : v.successRate >= 60 ? 'text-yellow-400' : 'text-red-400'}`}>{v.successRate}%</span>
                                  : <span className="text-[var(--text-dim)]">N/A</span>}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`font-semibold ${v.failureRate > 30 ? 'text-red-400' : v.failureRate > 15 ? 'text-yellow-400' : 'text-green-400'}`}>
                                  {v.failureRate.toFixed(0)}%
                                </span>
                              </td>
                              <td className="px-4 py-3 text-center">
                                {v.savingsVsNew != null ? (
                                  <span className={`text-xs font-semibold ${v.savingsVsNew > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {v.savingsVsNew > 0 ? '+' : ''}{fmtCurrency(v.savingsVsNew, activeCurrency)}
                                  </span>
                                ) : <span className="text-[var(--text-dim)] text-xs">N/A</span>}
                              </td>
                              <td className="px-4 py-3 text-center">
                                <ScoreBadge score={v.score} />
                              </td>
                            </motion.tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="px-4 py-2 border-t border-[var(--input-border)] text-xs text-[var(--text-muted)]">
                      Score = CPK efficiency (40%) + success rate (40%) + avg life (20%) · below 40 flagged
                    </div>
                  </div>

                  {/* CPK Trend chart */}
                  {vendorData.trendChart.datasets.length > 0 && (
                    <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-4">
                      <p className="text-xs text-[var(--text-muted)] mb-3 font-medium flex items-center gap-1.5">
                        <Activity size={13} className="text-purple-400" /> CPK Trend: Top 3 Vendors (Last 12 Months)
                      </p>
                      <div className="h-64">
                        <Line data={vendorData.trendChart} options={CHART_OPTS} />
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Tab: Lifecycle ── */}
          {activeTab === 'Lifecycle' && (
            <div className="space-y-4">
              {/* Search + filters */}
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={14} />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search serial, brand, asset, size, site..."
                    className="w-full pl-8 pr-3 py-2 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] placeholder-gray-500 focus:outline-none focus:border-purple-600"
                  />
                </div>
                <select
                  value={filterSite}
                  onChange={e => setFilterSite(e.target.value)}
                  className="px-3 py-2 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] focus:outline-none focus:border-purple-600"
                >
                  {siteOptions.map(o => <option key={o}>{o}</option>)}
                </select>
                <select
                  value={filterBrand}
                  onChange={e => setFilterBrand(e.target.value)}
                  className="px-3 py-2 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] focus:outline-none focus:border-purple-600"
                >
                  {brandOptions.map(o => <option key={o}>{o}</option>)}
                </select>
                <select
                  value={filterRisk}
                  onChange={e => setFilterRisk(e.target.value)}
                  className="px-3 py-2 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] focus:outline-none focus:border-purple-600"
                >
                  {riskOptions.map(o => <option key={o}>{o}</option>)}
                </select>
              </div>

              {/* Table */}
              <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[var(--input-border)] text-[var(--text-muted)] text-xs">
                        <th className="px-4 py-3 text-left">Serial</th>
                        <th className="px-4 py-3 text-left">Brand</th>
                        <th className="px-4 py-3 text-left">Size</th>
                        <th className="px-4 py-3 text-left">Position</th>
                        <th className="px-4 py-3 text-left">Asset</th>
                        <th className="px-4 py-3 text-left">Site</th>
                        <th className="px-4 py-3 text-center">km Life</th>
                        <th className="px-4 py-3 text-center">CPK</th>
                        <th className="px-4 py-3 text-center">Risk</th>
                        <th className="px-4 py-3 text-center">Status</th>
                        <th className="px-4 py-3 text-center">Days</th>
                        <th className="px-4 py-3 text-center">Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.length === 0 && (
                        <tr>
                          <td colSpan={12} className="px-4 py-14 text-center text-[var(--text-muted)]">
                            <Recycle className="inline mb-2 text-[var(--text-dim)]" size={36} />
                            <p className="mt-1">No retread tyres match current filters</p>
                          </td>
                        </tr>
                      )}
                      {filtered.map((t, i) => (
                        <motion.tr
                          key={t.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: Math.min(i, 30) * 0.02 }}
                          className="border-b border-gray-800/60 hover:bg-gray-800/40 transition cursor-pointer"
                          onClick={() => setDrawer(t)}
                        >
                          <td className="px-4 py-3 font-mono text-purple-300 text-xs">{t.serial_number ?? '-'}</td>
                          <td className="px-4 py-3 font-medium text-[var(--text-secondary)]">{t.brand ?? '-'}</td>
                          <td className="px-4 py-3 text-[var(--text-muted)] font-mono text-xs">{t.size ?? '-'}</td>
                          <td className="px-4 py-3 text-[var(--text-muted)] text-xs">{t.position ?? '-'}</td>
                          <td className="px-4 py-3 text-[var(--text-muted)] text-xs">{t.asset_no ?? '-'}</td>
                          <td className="px-4 py-3 text-[var(--text-muted)] text-xs">{t.site ?? '-'}</td>
                          <td className="px-4 py-3 text-center text-[var(--text-secondary)] text-xs">
                            {t.km_life != null ? t.km_life.toLocaleString() : '-'}
                          </td>
                          <td className="px-4 py-3 text-center font-mono text-purple-400 text-xs">
                            {fmtCpk(t.cpk, activeCurrency)}
                          </td>
                          <td className="px-4 py-3 text-center">{riskBadge(t.risk_level)}</td>
                          <td className="px-4 py-3 text-center">{statusBadge(t.status)}</td>
                          <td className="px-4 py-3 text-center text-[var(--text-muted)] text-xs">
                            {t.days_in_service != null ? `${t.days_in_service}d` : '-'}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <button
                              onClick={e => { e.stopPropagation(); setDrawer(t) }}
                              className="p-1 text-[var(--text-muted)] hover:text-purple-400 transition"
                            >
                              <ChevronRight size={14} />
                            </button>
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-4 py-2 border-t border-[var(--input-border)] text-xs text-[var(--text-muted)]">
                  {filtered.length} of {enriched.length} retread tyres
                </div>
              </div>
            </div>
          )}

          {/* ── Tab: ROI Calculator ── */}
          {activeTab === 'ROI Calculator' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Input form */}
                <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-5">
                  <div className="flex items-center gap-2 mb-5">
                    <Target className="text-purple-400" size={18} />
                    <h2 className="font-semibold text-[var(--text-secondary)]">ROI Calculator Inputs</h2>
                  </div>
                  <div className="space-y-4">
                    {[
                      { label: `Cost of New Tyre (${activeCurrency})`, key: 'newCost', help: 'Average purchase price per new tyre' },
                      { label: `Cost of Retread (${activeCurrency})`, key: 'retreadCost', help: 'Average retread cost per tyre' },
                      { label: 'Expected Retread Life (km)', key: 'retreadLifeKm', help: 'Typical km lifespan of a retread tyre' },
                      { label: 'Expected New Tyre Life (km)', key: 'newLifeKm', help: 'Typical km lifespan of a new tyre' },
                      { label: 'Fleet Size (retread tyres)', key: 'fleetSize', help: 'Number of retread tyres in fleet for annual projection' },
                    ].map(({ label, key, help }) => (
                      <div key={key}>
                        <label className="block text-xs text-[var(--text-muted)] mb-1">{label}</label>
                        <input
                          type="number"
                          min={0}
                          value={roi[key]}
                          onChange={e => setRoi(r => ({ ...r, [key]: e.target.value }))}
                          className="w-full px-3 py-2 bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg text-sm text-[var(--text-secondary)] focus:outline-none focus:border-purple-600"
                        />
                        <p className="text-[var(--text-dim)] text-xs mt-0.5">{help}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Results */}
                <div className="space-y-4">
                  <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <Zap className="text-yellow-400" size={18} />
                      <h2 className="font-semibold text-[var(--text-secondary)]">Analysis Results</h2>
                    </div>
                    <div className="space-y-3">
                      {[
                        {
                          label: 'New Tyre CPK',
                          value: fmtCpk(roiCalc.newCpkVal, activeCurrency),
                          color: 'text-blue-400',
                        },
                        {
                          label: 'Retread CPK',
                          value: fmtCpk(roiCalc.rCpkVal, activeCurrency),
                          color: 'text-purple-400',
                        },
                        {
                          label: 'CPK Improvement',
                          value: `${roiCalc.cpkImprovement.toFixed(1)}%`,
                          color: roiCalc.cpkImprovement > 0 ? 'text-green-400' : 'text-red-400',
                        },
                        {
                          label: 'Savings per Retread Tyre',
                          value: fmtCurrency(roiCalc.savingsPerTyre, activeCurrency),
                          color: roiCalc.savingsPerTyre > 0 ? 'text-green-400' : 'text-red-400',
                        },
                        {
                          label: 'Break-even Point',
                          value: roiCalc.breakEvenKm > 0 ? `${Math.round(roiCalc.breakEvenKm).toLocaleString()} km` : 'N/A',
                          color: 'text-yellow-400',
                        },
                        {
                          label: 'Projected Annual Fleet Savings',
                          value: fmtCurrency(roiCalc.annualSavings, activeCurrency),
                          color: roiCalc.annualSavings > 0 ? 'text-green-400' : 'text-red-400',
                          large: true,
                        },
                      ].map(({ label, value, color, large }) => (
                        <div key={label} className={`flex items-center justify-between py-2 border-b border-gray-800/60 last:border-0 ${large ? 'bg-gray-800/50 px-3 rounded-lg -mx-3' : ''}`}>
                          <span className="text-[var(--text-muted)] text-sm">{label}</span>
                          <span className={`font-bold ${large ? 'text-lg' : 'text-sm'} ${color}`}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="bg-blue-900/20 border border-blue-700/40 rounded-xl p-4 flex gap-3">
                    <Info className="text-blue-400 shrink-0 mt-0.5" size={16} />
                    <p className="text-blue-300 text-xs leading-relaxed">
                      Annual projection assumes fleet tyres complete 100,000 km per year.
                      Savings improve when retread CPK is lower than new tyre CPK.
                      Break-even is the km at which retread total cost equals new tyre total cost.
                    </p>
                  </div>

                  {/* Export PDF */}
                  <button
                    onClick={handleExportRoiPdf}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-purple-700 hover:bg-purple-600 rounded-lg text-sm font-semibold text-white transition"
                  >
                    <FileText size={15} /> Export ROI Analysis PDF
                  </button>
                </div>
              </div>

              {/* TCO Bar Chart */}
              <div className="bg-[var(--surface-1)] border border-[var(--input-border)] rounded-xl p-5">
                <p className="text-xs text-[var(--text-muted)] mb-4 font-medium flex items-center gap-1.5">
                  <BarChart3 size={13} className="text-purple-400" /> Total Cost of Ownership Comparison
                </p>
                <div className="h-64">
                  <Bar
                    data={roiCalc.tcoChartData}
                    options={{
                      ...CHART_OPTS,
                      plugins: {
                        ...CHART_OPTS.plugins,
                        legend: { ...CHART_OPTS.plugins.legend, display: true },
                      },
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Detail Drawer ── */}
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
              className="fixed right-0 top-0 h-full w-full max-w-lg bg-[var(--surface-1)] border-l border-[var(--input-border)] z-50 flex flex-col overflow-hidden"
            >
              {/* Drawer header */}
              <div className="p-4 border-b border-[var(--input-border)] flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Recycle className="text-purple-400" size={16} />
                    <span className="font-bold text-[var(--text-secondary)] font-mono text-sm">{drawer.serial_number ?? 'No Serial'}</span>
                    {riskBadge(drawer.risk_level)}
                    {statusBadge(drawer.status)}
                  </div>
                  <p className="text-[var(--text-muted)] text-sm">{drawer.brand} - {drawer.size}</p>
                </div>
                <button onClick={() => setDrawer(null)} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] shrink-0">
                  <X size={20} />
                </button>
              </div>

              {/* Drawer body */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Core info */}
                <div className="bg-[var(--input-bg)] rounded-xl p-4">
                  <p className="text-xs text-[var(--text-muted)] mb-3 font-semibold uppercase tracking-wider">Tyre Information</p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      { label: 'Brand', value: drawer.brand },
                      { label: 'Size', value: drawer.size },
                      { label: 'Position', value: drawer.position },
                      { label: 'Asset No', value: drawer.asset_no },
                      { label: 'Site', value: drawer.site },
                      { label: 'Country', value: drawer.country },
                      { label: 'Category', value: drawer.category },
                      { label: 'Tread Depth', value: drawer.tread_depth != null ? `${drawer.tread_depth} mm` : null },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <p className="text-[var(--text-muted)] text-xs">{label}</p>
                        <p className="text-[var(--text-secondary)] font-medium text-sm mt-0.5">{value ?? '-'}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Lifecycle */}
                <div className="bg-[var(--input-bg)] rounded-xl p-4">
                  <p className="text-xs text-[var(--text-muted)] mb-3 font-semibold uppercase tracking-wider">Lifecycle &amp; Cost</p>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    {[
                      { label: 'Issue Date', value: drawer.issue_date },
                      { label: 'Removal Date', value: drawer.removal_date ?? (drawer.km_at_removal ? '-' : 'Still Fitted') },
                      { label: 'km at Fitment', value: drawer.km_at_fitment?.toLocaleString() },
                      { label: 'km at Removal', value: drawer.km_at_removal?.toLocaleString() },
                      { label: 'km Life', value: drawer.km_life != null ? `${drawer.km_life.toLocaleString()} km` : null },
                      { label: 'Days in Service', value: drawer.days_in_service != null ? `${drawer.days_in_service} days` : null },
                      { label: 'Cost per Tyre', value: drawer.cost_per_tyre != null ? fmtCurrency(drawer.cost_per_tyre, activeCurrency) : null },
                      { label: 'CPK', value: fmtCpk(drawer.cpk, activeCurrency) },
                    ].map(({ label, value }) => (
                      <div key={label}>
                        <p className="text-[var(--text-muted)] text-xs">{label}</p>
                        <p className="text-[var(--text-secondary)] font-medium text-sm mt-0.5">{value ?? '-'}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Cost comparison vs new */}
                {kpis.newCpk != null && drawer.cpk != null && (
                  <div className="bg-purple-900/20 border border-purple-700/40 rounded-xl p-4">
                    <p className="text-xs text-[var(--text-muted)] mb-3 font-semibold uppercase tracking-wider">Cost Comparison vs New Tyre Avg</p>
                    <div className="space-y-2">
                      {[
                        { label: 'This Retread CPK', value: fmtCpk(drawer.cpk, activeCurrency), color: 'text-purple-400' },
                        { label: 'Fleet New Tyre Avg CPK', value: fmtCpk(kpis.newCpk, activeCurrency), color: 'text-blue-400' },
                        {
                          label: 'CPK Difference',
                          value: drawer.cpk < kpis.newCpk
                            ? `${fmtCpk(kpis.newCpk - drawer.cpk, activeCurrency)} cheaper`
                            : `${fmtCpk(drawer.cpk - kpis.newCpk, activeCurrency)} more expensive`,
                          color: drawer.cpk < kpis.newCpk ? 'text-green-400' : 'text-red-400',
                        },
                      ].map(({ label, value, color }) => (
                        <div key={label} className="flex justify-between items-center text-sm">
                          <span className="text-[var(--text-muted)]">{label}</span>
                          <span className={`font-bold ${color}`}>{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Retread Approval — Approval & Workflow Engine.
                    Retread send-outs / vendor decisions warrant sign-off.
                    Smart rule: retread_cost > threshold routes to Fleet Manager. */}
                <EntityApprovalPanel
                  entityType="retread"
                  entityId={drawer.id}
                  entityLabel={drawer.serial_number || drawer.asset_no || drawer.id}
                  context={{
                    retread_cost: drawer.cost_per_tyre,
                    vendor: drawer.brand,
                    serial_no: drawer.serial_number,
                    casing_condition: drawer.risk_level,
                    site: drawer.site,
                  }}
                  onStateChange={(s) => setWfLocked(!!(s?.isActive || s?.isLocked))}
                  title="Retread Approval"
                />

                {wfLocked && (
                  <div className="flex items-center gap-1.5 text-xs text-[var(--accent)] bg-[var(--input-bg)] border border-[var(--input-border)] rounded-lg px-3 py-2">
                    <Lock size={12} />
                    Locked, in approval. This casing's export is disabled until the workflow completes.
                  </div>
                )}
              </div>

              {/* Drawer footer */}
              <div className="p-3 border-t border-[var(--input-border)] flex justify-end gap-2">
                <button
                  onClick={() => handleExportCasing(drawer)}
                  disabled={wfLocked}
                  title={wfLocked ? 'Locked, in approval' : 'Export casing record'}
                  className="flex items-center gap-1.5 px-4 py-2 bg-purple-700 hover:bg-purple-600 rounded-lg text-sm font-semibold text-white transition disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-purple-700"
                >
                  {wfLocked ? <Lock size={14} /> : <FileText size={14} />} Export Casing
                </button>
                <button
                  onClick={() => setDrawer(null)}
                  className="px-4 py-2 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] rounded-lg text-sm text-[var(--text-secondary)] transition"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
