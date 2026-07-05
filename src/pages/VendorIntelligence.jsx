import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { applyCountry } from '../lib/countryFilter'
import { normalizePosition } from '../lib/tyrePositions'
import { useSettings } from '../contexts/SettingsContext'
import {
  computeVendorPerformance,
  computeWorkshopPerformance,
  computeCpkByBrand,
  computeAvgTyreLife,
  computeFailureRate,
} from '../lib/kpiEngine'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import {
  Trophy, Download, FileText, AlertTriangle, CheckCircle,
  TrendingUp, TrendingDown, RefreshCw, Building2, Package,
  Star, Award, Medal, BarChart3, Target, ChevronUp, ChevronDown,
  Minus, ShieldAlert, Wrench, DollarSign, Activity, Zap, Mail,
} from 'lucide-react'
import EmailReportModal from '../components/EmailReportModal'
import PageHeader from '../components/ui/PageHeader'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  RadialLinearScale, ArcElement, Title, Tooltip, Legend, Filler, RadarController,
} from 'chart.js'
import { Bar, Radar } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  RadialLinearScale, ArcElement, Title, Tooltip, Legend, Filler, RadarController,
)

// ── Constants ──────────────────────────────────────────────────────────────────
const DATE_PRESETS = [
  { label: '3mo', days: 90 },
  { label: '6mo', days: 180 },
  { label: '1yr', days: 365 },
  { label: 'All', days: null },
]

const POSITIONS = ['All', 'Steer', 'Drive', 'Trailer', 'Other']

const CHART_THEME = {
  gridcolor:'var(--text-muted)',
  tickColor: '#9ca3af',
  tooltipBg: '#1f2937',
}

const BRAND_PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
]

// ── Helpers ────────────────────────────────────────────────────────────────────
function applyDatePreset(days) {
  if (!days) return { from: '', to: '' }
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - days)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) }
}

function fmtCpk(v, currency) {
  if (v == null || !isFinite(v)) return 'N/A'
  return `${currency} ${v.toFixed(4)}`
}

function fmtNum(v, decimals = 1) {
  if (v == null || !isFinite(v)) return 'N/A'
  return v.toFixed(decimals)
}

function fmtKm(v) {
  if (v == null || !isFinite(v) || v === 0) return 'N/A'
  if (v >= 1000) return `${(v / 1000).toFixed(0)}k km`
  return `${Math.round(v)} km`
}

function fmtCurrency(v, currency) {
  if (v == null || !isFinite(v)) return `${currency} 0`
  return `${currency} ${Math.round(v).toLocaleString()}`
}

function fmtPct(v) {
  if (v == null || !isFinite(v)) return 'N/A'
  return `${(v * 100).toFixed(1)}%`
}

function cpkColor(cpk) {
  if (cpk == null || !isFinite(cpk)) return 'text-gray-500'
  if (cpk <= 1.0) return 'text-green-400'
  if (cpk <= 2.0) return 'text-yellow-400'
  return 'text-red-400'
}

function cpkBgColor(cpk) {
  if (cpk == null || !isFinite(cpk)) return '#374151'
  if (cpk <= 1.0) return '#16a34a'
  if (cpk <= 2.0) return '#d97706'
  return '#dc2626'
}

function riskColor(rate) {
  if (rate >= 30) return 'text-red-400'
  if (rate >= 15) return 'text-yellow-400'
  return 'text-green-400'
}

function rankBadgeStyle(rank) {
  if (rank === 1) return { bg: 'bg-yellow-500/20 border-yellow-500/50', text: 'text-yellow-400', icon: '🥇' }
  if (rank === 2) return { bg: 'bg-gray-400/10 border-gray-400/40', text: 'text-gray-300', icon: '🥈' }
  if (rank === 3) return { bg: 'bg-amber-700/20 border-amber-700/40', text: 'text-amber-600', icon: '🥉' }
  return { bg: 'bg-gray-800/40 border-gray-700/30', text: 'text-gray-400', icon: null }
}

function miniBar(pct, color = '#3b82f6') {
  const clamped = Math.min(Math.max(pct, 0), 100)
  return (
    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden mt-1">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${clamped}%`, backgroundColor: color }} />
    </div>
  )
}

// normalizePosition now sourced from lib/tyrePositions (recognises coded
// positions like LHF1 / LHRI as well as free-text labels).

// ── Chart options factories ────────────────────────────────────────────────────
function barOpts(horizontal = false, tickCallback) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: CHART_THEME.tooltipBg,
        titlecolor:'var(--panel-ink)',
        bodyColor: '#d1d5db',
        padding: 10,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        grid: { color: CHART_THEME.gridColor },
        ticks: { color: CHART_THEME.tickColor, font: { size: 11 }, ...(tickCallback && !horizontal ? { callback: tickCallback } : {}) },
      },
      y: {
        grid: { color: CHART_THEME.gridColor },
        ticks: { color: CHART_THEME.tickColor, font: { size: 11 }, ...(tickCallback && horizontal ? { callback: tickCallback } : {}) },
      },
    },
  }
}

function radarOpts() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: { color: CHART_THEME.tickColor, font: { size: 11 }, padding: 12, boxWidth: 12 },
      },
      tooltip: {
        backgroundColor: CHART_THEME.tooltipBg,
        titlecolor:'var(--panel-ink)',
        bodyColor: '#d1d5db',
        padding: 10,
        cornerRadius: 8,
        callbacks: { label: ctx => `${ctx.dataset.label}: ${Number(ctx.raw).toFixed(1)}` },
      },
    },
    scales: {
      r: {
        min: 0,
        max: 100,
        grid: { color: '#374151' },
        angleLines: { color: '#374151' },
        pointLabels: { color: '#9ca3af', font: { size: 11 } },
        ticks: { color: '#6b7280', font: { size: 9 }, backdropColor: 'transparent', stepSize: 20 },
      },
    },
  }
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function VendorIntelligence() {
  const { activeCurrency, activeCountry } = useSettings()

  // Data state
  const [records, setRecords] = useState([])
  const [actions, setActions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filters
  const [datePreset, setDatePreset] = useState('1yr')
  const [dateFrom, setDateFrom] = useState(() => applyDatePreset(365).from)
  const [dateTo, setDateTo] = useState(() => applyDatePreset(365).to)
  const [siteFilter, setSiteFilter] = useState('all')
  const [positionFilter, setPositionFilter] = useState('all')
  const [minRecords, setMinRecords] = useState(3)

  // UI state
  const [activeSection, setActiveSection] = useState('vendors')
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [sortCol, setSortCol] = useState('score')
  const [sortDir, setSortDir] = useState('desc')
  const [workshopSortCol, setWorkshopSortCol] = useState('score')
  const [workshopSortDir, setWorkshopSortDir] = useState('desc')

  // ── Data fetch ──────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [recRes, actRes] = await Promise.all([
        fetchAllPages((from, to) => applyCountry(supabase
          .from('tyre_records')
          .select('id,asset_no,site,brand,supplier,tyre_serial,position,risk_level,category,findings,tread_depth,km_at_fitment,km_at_removal,cost_per_tyre,issue_date,removal_reason'), activeCountry)
          .range(from, to)),
        applyCountry(supabase
          .from('corrective_actions')
          .select('id,site,status,priority,created_at,resolved_at'), activeCountry)
          .limit(2000),
      ])
      if (recRes.error) throw recRes.error
      if (actRes.error) throw actRes.error
      setRecords(recRes.data || [])
      setActions(actRes.data || [])
    } catch (e) {
      setError(e.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // ── Unique filter values ───────────────────────────────────────────────────
  const uniqueSites = useMemo(() => {
    const s = new Set(records.map(r => r.site).filter(Boolean))
    return [...s].sort()
  }, [records])

  // ── Filtered records ───────────────────────────────────────────────────────
  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      if (dateFrom && r.issue_date && r.issue_date < dateFrom) return false
      if (dateTo && r.issue_date && r.issue_date > dateTo) return false
      if (siteFilter !== 'all' && r.site !== siteFilter) return false
      if (positionFilter !== 'all') {
        const norm = normalizePosition(r.position)
        if (norm !== positionFilter) return false
      }
      return true
    })
  }, [records, dateFrom, dateTo, siteFilter, positionFilter])

  const filteredActions = useMemo(() => {
    return actions.filter(a => {
      if (siteFilter !== 'all' && a.site !== siteFilter) return false
      return true
    })
  }, [actions, siteFilter])

  // ── Vendor computations ───────────────────────────────────────────────────
  const rawVendors = useMemo(() => computeVendorPerformance(filteredRecords), [filteredRecords])

  const vendors = useMemo(() => {
    const filtered = rawVendors.filter(v => v.count >= minRecords)
    const maxScore = Math.max(...filtered.map(v => v.score), 1)
    return filtered.map((v, i) => ({
      ...v,
      rank: i + 1,
      displayScore: maxScore > 0 ? (v.score / maxScore) * 100 : 0,
    }))
  }, [rawVendors, minRecords])

  const cpkByBrand = useMemo(() => computeCpkByBrand(filteredRecords), [filteredRecords])
  const avgTyreLife = useMemo(() => computeAvgTyreLife(filteredRecords), [filteredRecords])
  const failureRate = useMemo(() => computeFailureRate(filteredRecords), [filteredRecords])

  // Enrich vendors with additional computed fields
  const enrichedVendors = useMemo(() => {
    const cpkMap = {}
    cpkByBrand.forEach(b => { cpkMap[b.brand] = b })
    const lifeMap = {}
    avgTyreLife.byBrand.forEach(b => { lifeMap[b.brand] = b })
    const failMap = {}
    failureRate.byBrand.forEach(b => { failMap[b.brand] = b })

    return vendors.map(v => ({
      ...v,
      medianCpk: cpkMap[v.brand]?.medianCpk ?? null,
      minCpk: cpkMap[v.brand]?.minCpk ?? null,
      maxCpk: cpkMap[v.brand]?.maxCpk ?? null,
      avgLifeKm: lifeMap[v.brand]?.avgKm ?? v.avgLife ?? null,
    }))
  }, [vendors, cpkByBrand, avgTyreLife, failureRate])

  // Sorted vendor table
  const sortedVendors = useMemo(() => {
    return [...enrichedVendors].sort((a, b) => {
      const aVal = a[sortCol] ?? 0
      const bVal = b[sortCol] ?? 0
      return sortDir === 'desc' ? bVal - aVal : aVal - bVal
    })
  }, [enrichedVendors, sortCol, sortDir])

  // ── Workshop computations ─────────────────────────────────────────────────
  const rawWorkshop = useMemo(
    () => computeWorkshopPerformance(filteredRecords, filteredActions),
    [filteredRecords, filteredActions]
  )

  const workshops = useMemo(() => {
    const filtered = rawWorkshop.bySite.filter(w => w.recordCount >= minRecords)
    const maxScore = Math.max(...filtered.map(w => w.score), 1)
    return filtered.map((w, i) => ({
      ...w,
      rank: i + 1,
      displayScore: maxScore > 0 ? (w.score / maxScore) * 100 : 0,
    }))
  }, [rawWorkshop, minRecords])

  const sortedWorkshops = useMemo(() => {
    return [...workshops].sort((a, b) => {
      const aVal = a[workshopSortCol] ?? 0
      const bVal = b[workshopSortCol] ?? 0
      return workshopSortDir === 'desc' ? bVal - aVal : aVal - bVal
    })
  }, [workshops, workshopSortCol, workshopSortDir])

  // ── Executive summary ──────────────────────────────────────────────────────
  const execSummary = useMemo(() => {
    const qualified = enrichedVendors.filter(v => v.count >= 10)
    const bestBrand = qualified.length > 0
      ? qualified.reduce((a, b) => (a.avgCpk ?? Infinity) < (b.avgCpk ?? Infinity) ? a : b)
      : enrichedVendors[0] ?? null
    const worstBrand = qualified.length > 0
      ? qualified.reduce((a, b) => (a.avgCpk ?? 0) > (b.avgCpk ?? 0) ? a : b)
      : enrichedVendors[enrichedVendors.length - 1] ?? null

    const totalFleetInvestment = filteredRecords
      .reduce((s, r) => s + (Number(r.cost_per_tyre) > 0 ? Number(r.cost_per_tyre) * (Number(r.qty) || 1) : 0), 0)

    const bestSite = workshops.length > 0 ? workshops[0] : null
    const worstSite = workshops.length > 1 ? workshops[workshops.length - 1] : null

    const estAnnualSaving = (() => {
      if (!bestBrand || !worstBrand || bestBrand.brand === worstBrand.brand) return 0
      if (!bestBrand.avgCpk || !worstBrand.avgCpk) return 0
      const totalKm = filteredRecords
        .filter(r => r.km_at_fitment && r.km_at_removal && r.km_at_removal > r.km_at_fitment)
        .reduce((s, r) => s + (Number(r.km_at_removal) - Number(r.km_at_fitment)), 0)
      return (worstBrand.avgCpk - bestBrand.avgCpk) * totalKm
    })()

    return { bestBrand, worstBrand, totalFleetInvestment, bestSite, worstSite, estAnnualSaving }
  }, [enrichedVendors, workshops, filteredRecords])

  // ── Procurement recommendations ───────────────────────────────────────────
  const recommendations = useMemo(() => {
    const recs = []

    if (enrichedVendors.length >= 2) {
      const worst = enrichedVendors[enrichedVendors.length - 1]
      const best = enrichedVendors[0]
      if (worst && worst.avgCpk > 2.0) {
        recs.push({
          priority: 'Critical',
          icon: 'cost',
          text: `${worst.brand} has the highest CPK at ${fmtCpk(worst.avgCpk, activeCurrency)}/km - significantly above fleet benchmark. Initiate replacement procurement evaluation.`,
        })
      }
      if (best && best.avgCpk != null && best.avgCpk <= 1.0 && best.count >= 5) {
        recs.push({
          priority: 'High',
          icon: 'value',
          text: `${best.brand} delivers best value at ${fmtCpk(best.avgCpk, activeCurrency)}/km with ${best.count} records. Consider increasing procurement share to reduce fleet cost.`,
        })
      }
    }

    const highFailBrands = enrichedVendors.filter(v => v.failureRate > 0.25 && v.count >= 5)
    highFailBrands.slice(0, 2).forEach(v => {
      recs.push({
        priority: 'High',
        icon: 'failure',
        text: `${v.brand} shows ${fmtPct(v.failureRate)} failure rate (High + Critical risk). Conduct root cause analysis and review specifications before next procurement cycle.`,
      })
    })

    const highScrapBrands = enrichedVendors.filter(v => v.scrapRate > 0.20 && v.count >= 5)
    highScrapBrands.slice(0, 1).forEach(v => {
      recs.push({
        priority: 'High',
        icon: 'scrap',
        text: `${v.brand} has a ${fmtPct(v.scrapRate)} scrap rate - indicative of premature removal or quality issues. Engineering review recommended.`,
      })
    })

    if (workshops.length > 0) {
      const worstSite = [...workshops].sort((a, b) => b.highRiskPct - a.highRiskPct)[0]
      if (worstSite && worstSite.highRiskPct > 25) {
        recs.push({
          priority: 'Critical',
          icon: 'site',
          text: `${worstSite.site} has the highest high-risk tyre rate at ${fmtNum(worstSite.highRiskPct)}%. Schedule an immediate tyre audit and corrective action review for this site.`,
        })
      }

      const zeroClose = workshops.filter(w => w.actionCloseRate === 0 && w.recordCount >= 5)
      zeroClose.slice(0, 2).forEach(w => {
        recs.push({
          priority: 'Critical',
          icon: 'action',
          text: `${w.site} has 0% corrective action close rate. Escalation to site management required - open actions are accumulating without resolution.`,
        })
      })

      const slowClose = workshops.filter(w => w.actionCloseRate > 0 && w.actionCloseRate < 0.3)
      slowClose.slice(0, 1).forEach(w => {
        recs.push({
          priority: 'Medium',
          icon: 'action',
          text: `${w.site} corrective action close rate is only ${fmtPct(w.actionCloseRate)}. Set a 30-day resolution target and assign accountability for open actions.`,
        })
      })
    }

    if (enrichedVendors.length >= 3) {
      const lifeSorted = [...enrichedVendors].filter(v => v.avgLifeKm).sort((a, b) => b.avgLifeKm - a.avgLifeKm)
      if (lifeSorted.length > 0) {
        recs.push({
          priority: 'Medium',
          icon: 'life',
          text: `${lifeSorted[0].brand} achieves the longest average tyre life at ${fmtKm(lifeSorted[0].avgLifeKm)}. Prioritise for steer and drive axles where durability delivers highest lifecycle value.`,
        })
      }
    }

    return recs.slice(0, 8)
  }, [enrichedVendors, workshops, activeCurrency])

  // ── Radar chart data ───────────────────────────────────────────────────────
  const radarData = useMemo(() => {
    const top5 = enrichedVendors.slice(0, 5)
    if (!top5.length) return null

    const maxKm = Math.max(...top5.map(v => v.avgLifeKm ?? 0), 1)
    const maxCount = Math.max(...top5.map(v => v.count), 1)
    const maxCpk = Math.max(...top5.map(v => v.avgCpk ?? 0), 0.001)

    return {
      labels: ['CPK Efficiency', 'Quality', 'Tyre Life', 'Low Scrap', 'Volume'],
      datasets: top5.map((v, i) => {
        const cpkEff = v.avgCpk != null ? Math.max(0, (1 - v.avgCpk / maxCpk)) * 100 : 0
        const quality = (1 - (v.failureRate ?? 0)) * 100
        const life = maxKm > 0 ? ((v.avgLifeKm ?? 0) / maxKm) * 100 : 0
        const lowScrap = (1 - (v.scrapRate ?? 0)) * 100
        const volume = (v.count / maxCount) * 100
        return {
          label: v.brand,
          data: [cpkEff, quality, life, lowScrap, volume],
          backgroundColor: BRAND_PALETTE[i % BRAND_PALETTE.length] + '33',
          borderColor: BRAND_PALETTE[i % BRAND_PALETTE.length],
          borderWidth: 2,
          pointBackgroundColor: BRAND_PALETTE[i % BRAND_PALETTE.length],
          pointRadius: 3,
        }
      }),
    }
  }, [enrichedVendors])

  // ── CPK by Brand chart ─────────────────────────────────────────────────────
  const cpkBarData = useMemo(() => {
    const sorted = [...enrichedVendors]
      .filter(v => v.avgCpk != null)
      .sort((a, b) => (a.avgCpk ?? 0) - (b.avgCpk ?? 0))
      .slice(0, 15)
    return {
      labels: sorted.map(v => v.brand),
      datasets: [{
        label: 'Avg CPK',
        data: sorted.map(v => v.avgCpk),
        backgroundColor: sorted.map(v => cpkBgColor(v.avgCpk)),
        borderRadius: 4,
      }],
    }
  }, [enrichedVendors])

  // ── Tyre Life by Brand chart ───────────────────────────────────────────────
  const lifeBarData = useMemo(() => {
    const sorted = [...enrichedVendors]
      .filter(v => v.avgLifeKm && v.avgLifeKm > 0)
      .sort((a, b) => (b.avgLifeKm ?? 0) - (a.avgLifeKm ?? 0))
      .slice(0, 15)
    return {
      labels: sorted.map(v => v.brand),
      datasets: [{
        label: 'Avg KM Life',
        data: sorted.map(v => v.avgLifeKm),
        backgroundColor: '#3b82f6',
        borderRadius: 4,
      }],
    }
  }, [enrichedVendors])

  // ── Failure Rate by Brand chart ───────────────────────────────────────────
  const failureBarData = useMemo(() => {
    const sorted = [...enrichedVendors]
      .sort((a, b) => (b.failureRate ?? 0) - (a.failureRate ?? 0))
      .slice(0, 15)
    return {
      labels: sorted.map(v => v.brand),
      datasets: [{
        label: 'Failure Rate %',
        data: sorted.map(v => (v.failureRate ?? 0) * 100),
        backgroundColor: sorted.map(v => {
          const pct = (v.failureRate ?? 0) * 100
          return pct >= 25 ? '#dc2626' : pct >= 15 ? '#d97706' : '#16a34a'
        }),
        borderRadius: 4,
      }],
    }
  }, [enrichedVendors])

  // ── Workshop chart data ────────────────────────────────────────────────────
  const workshopRiskData = useMemo(() => ({
    labels: workshops.slice(0, 12).map(w => w.site),
    datasets: [{
      label: 'High Risk %',
      data: workshops.slice(0, 12).map(w => w.highRiskPct),
      backgroundColor: workshops.slice(0, 12).map(w =>
        w.highRiskPct >= 30 ? '#dc2626' : w.highRiskPct >= 15 ? '#d97706' : '#16a34a'
      ),
      borderRadius: 4,
    }],
  }), [workshops])

  const workshopCpkData = useMemo(() => ({
    labels: workshops.slice(0, 12).map(w => w.site),
    datasets: [{
      label: 'Avg CPK',
      data: workshops.slice(0, 12).map(w => w.avgCpk),
      backgroundColor: workshops.slice(0, 12).map(w => cpkBgColor(w.avgCpk)),
      borderRadius: 4,
    }],
  }), [workshops])

  const workshopCloseData = useMemo(() => ({
    labels: workshops.slice(0, 12).map(w => w.site),
    datasets: [{
      label: 'Close Rate %',
      data: workshops.slice(0, 12).map(w => (w.actionCloseRate ?? 0) * 100),
      backgroundColor: workshops.slice(0, 12).map(w => {
        const r = (w.actionCloseRate ?? 0) * 100
        return r >= 70 ? '#16a34a' : r >= 40 ? '#d97706' : '#dc2626'
      }),
      borderRadius: 4,
    }],
  }), [workshops])

  // ── Sort handlers ─────────────────────────────────────────────────────────
  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortCol(col); setSortDir('desc') }
  }

  function handleWorkshopSort(col) {
    if (workshopSortCol === col) setWorkshopSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setWorkshopSortCol(col); setWorkshopSortDir('desc') }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  function handleExcelExport() {
    const vendorRows = sortedVendors.map(v => ({
      rank: v.rank,
      brand: v.brand,
      records: v.count,
      validCpk: v.validCount,
      avgCpk: v.avgCpk != null ? v.avgCpk.toFixed(4) : '',
      medianCpk: v.medianCpk != null ? v.medianCpk.toFixed(4) : '',
      avgLifeKm: v.avgLifeKm != null ? Math.round(v.avgLifeKm) : '',
      failureRate: v.failureRate != null ? (v.failureRate * 100).toFixed(1) + '%' : '',
      scrapRate: v.scrapRate != null ? (v.scrapRate * 100).toFixed(1) + '%' : '',
      totalCost: Math.round(v.totalCost),
      score: v.displayScore.toFixed(1),
    }))
    exportToExcel(
      vendorRows,
      ['rank', 'brand', 'records', 'validCpk', 'avgCpk', 'medianCpk', 'avgLifeKm', 'failureRate', 'scrapRate', 'totalCost', 'score'],
      ['Rank', 'Brand', 'Records', 'Valid (CPK)', 'Avg CPK', 'Median CPK', 'Avg Life (km)', 'Failure Rate', 'Scrap Rate', 'Total Cost', 'Score'],
      'vendor-intelligence',
      'Brand Performance',
    )
    setTimeout(() => {
      const workshopRows = sortedWorkshops.map(w => ({
        rank: w.rank,
        site: w.site,
        records: w.recordCount,
        highRiskPct: fmtNum(w.highRiskPct) + '%',
        avgCpk: w.avgCpk != null ? w.avgCpk.toFixed(4) : '',
        avgCost: Math.round(w.avgCost),
        actionCloseRate: fmtPct(w.actionCloseRate),
        score: w.displayScore.toFixed(1),
      }))
      exportToExcel(
        workshopRows,
        ['rank', 'site', 'records', 'highRiskPct', 'avgCpk', 'avgCost', 'actionCloseRate', 'score'],
        ['Rank', 'Site', 'Records', 'High Risk %', 'Avg CPK', 'Avg Cost', 'Close Rate', 'Score'],
        'workshop-intelligence',
        'Workshop Performance',
      )
    }, 500)
  }

  function handlePdfExport() {
    const vendorRows = sortedVendors.map(v => ({
      rank: String(v.rank),
      brand: v.brand,
      records: String(v.count),
      avgCpk: v.avgCpk != null ? fmtCpk(v.avgCpk, activeCurrency) : 'N/A',
      avgLifeKm: fmtKm(v.avgLifeKm),
      failureRate: fmtPct(v.failureRate),
      scrapRate: fmtPct(v.scrapRate),
      score: v.displayScore.toFixed(1),
    }))
    exportToPdf(
      vendorRows,
      [
        { key: 'rank', header: 'Rank' },
        { key: 'brand', header: 'Brand' },
        { key: 'records', header: 'Records' },
        { key: 'avgCpk', header: 'Avg CPK' },
        { key: 'avgLifeKm', header: 'Avg Life' },
        { key: 'failureRate', header: 'Failure Rate' },
        { key: 'scrapRate', header: 'Scrap Rate' },
        { key: 'score', header: 'Score' },
      ],
      'Vendor & Workshop Intelligence',
      'vendor-intelligence',
      'landscape',
    )
  }

  // ── Sort indicator component ────────────────────────────────────────────
  function SortIcon({ col, activeCol, dir }) {
    if (col !== activeCol) return <Minus size={11} className="text-gray-600 ml-0.5" />
    return dir === 'desc'
      ? <ChevronDown size={11} className="text-green-400 ml-0.5" />
      : <ChevronUp size={11} className="text-green-400 ml-0.5" />
  }

  function Th({ col, label, onSort, activeCol, dir, className = '' }) {
    return (
      <th
        className={`table-header text-right py-2 px-3 cursor-pointer select-none hover:text-white transition-colors ${className}`}
        onClick={() => onSort(col)}
      >
        <span className="flex items-center justify-end gap-0.5">
          {label}
          <SortIcon col={col} activeCol={activeCol} dir={dir} />
        </span>
      </th>
    )
  }

  // ── Loading / Error / Empty ───────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-72 gap-4 text-gray-400">
        <RefreshCw className="animate-spin text-green-500" size={36} />
        <span className="text-sm">Loading vendor & workshop intelligence...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-72 gap-3 text-red-400">
        <AlertTriangle size={36} />
        <span className="text-sm font-medium">{error}</span>
        <button
          onClick={load}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  const hasVendorData = enrichedVendors.length > 0
  const hasWorkshopData = workshops.length > 0

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 pb-10">

      <PageHeader
        title="Vendor & Workshop Intelligence"
        subtitle="Objective performance ranking for tyre brands and workshop sites - cost efficiency, reliability, and procurement intelligence"
        icon={Trophy}
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={handleExcelExport}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs transition-colors border border-gray-700"
            >
              <Download size={13} /> Excel
            </button>
            <button
              onClick={handlePdfExport}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs transition-colors border border-gray-700"
            >
              <FileText size={13} /> PDF
            </button>
            <button
              onClick={() => setEmailModalOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg text-xs transition-colors border border-gray-700"
            >
              <Mail size={13} /> Email Report
            </button>
          </div>
        }
      />

      {/* ─── Filters ─────────────────────────────────────────────────────────── */}
      <div className="card flex flex-wrap items-center gap-3">
        {/* Date presets */}
        <div className="flex items-center gap-1">
          {DATE_PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => {
                setDatePreset(p.label)
                const { from, to } = applyDatePreset(p.days)
                setDateFrom(from)
                setDateTo(to)
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                datePreset === p.label
                  ? 'bg-green-600 text-white shadow-sm'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="h-4 w-px bg-gray-700" />

        {/* Site filter */}
        <select
          className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-green-600"
          value={siteFilter}
          onChange={e => setSiteFilter(e.target.value)}
        >
          <option value="all">All Sites</option>
          {uniqueSites.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Position filter */}
        <select
          className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-green-600"
          value={positionFilter}
          onChange={e => setPositionFilter(e.target.value)}
        >
          {POSITIONS.map(p => (
            <option key={p} value={p.toLowerCase() === 'all' ? 'all' : p}>{p}</option>
          ))}
        </select>

        {/* Min records */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Min records</span>
          <input
            type="number"
            min={1}
            max={50}
            value={minRecords}
            onChange={e => setMinRecords(Math.max(1, Number(e.target.value)))}
            className="bg-gray-800 border border-gray-700 text-gray-300 text-xs rounded-lg px-2 py-1.5 w-16 focus:outline-none focus:border-green-600"
          />
        </div>

        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white rounded-lg text-xs transition-colors"
        >
          <RefreshCw size={12} /> Refresh
        </button>

        <span className="ml-auto text-xs text-gray-500">{filteredRecords.length.toLocaleString()} records</span>
      </div>

      {/* ─── Section Toggle ──────────────────────────────────────────────────── */}
      <div className="flex gap-1 p-1 bg-gray-900 border border-gray-800 rounded-xl w-fit">
        <button
          onClick={() => setActiveSection('vendors')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeSection === 'vendors'
              ? 'bg-green-600 text-white shadow-sm'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <Package size={15} /> Brand Rankings
        </button>
        <button
          onClick={() => setActiveSection('workshops')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeSection === 'workshops'
              ? 'bg-green-600 text-white shadow-sm'
              : 'text-gray-400 hover:text-white'
          }`}
        >
          <Building2 size={15} /> Workshop Performance
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════════════
          VENDOR SECTION
      ═══════════════════════════════════════════════════════════════════════ */}
      <AnimatePresence mode="wait">
        {activeSection === 'vendors' && (
          <motion.div
            key="vendors"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="space-y-6"
          >
            {/* ─── 3a: Vendor Leaderboard ──────────────────────────────────── */}
            <div>
              <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                <Award size={15} className="text-yellow-400" /> Vendor Leaderboard
              </h2>

              {!hasVendorData ? (
                <div className="card text-center py-16 text-gray-600 text-sm">
                  No brand records meet the minimum record threshold ({minRecords}).
                </div>
              ) : (
                <>
                  {/* Top 3 featured cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    {enrichedVendors.slice(0, 3).map(v => {
                      const badge = rankBadgeStyle(v.rank)
                      const totalCostDisplay = fmtCurrency(v.totalCost, activeCurrency)
                      return (
                        <motion.div
                          key={v.brand}
                          initial={{ opacity: 0, scale: 0.97 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: v.rank * 0.05 }}
                          className={`bg-gray-900 border rounded-xl p-5 ${badge.bg}`}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className="text-2xl">{badge.icon ?? `#${v.rank}`}</span>
                              <div>
                                <p className={`text-xs font-bold uppercase tracking-wider ${badge.text}`}>Rank #{v.rank}</p>
                                <p className="text-lg font-bold text-white">{v.brand}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-black text-white">{v.displayScore.toFixed(0)}</p>
                              <p className="text-[10px] text-gray-500">/ 100 score</p>
                            </div>
                          </div>

                          {/* Score bar */}
                          <div className="mb-4">
                            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-700 ${
                                  v.rank === 1 ? 'bg-yellow-400' : v.rank === 2 ? 'bg-gray-400' : 'bg-amber-600'
                                }`}
                                style={{ width: `${v.displayScore}%` }}
                              />
                            </div>
                          </div>

                          {/* 5 metrics */}
                          <div className="space-y-2.5">
                            {/* CPK */}
                            <div>
                              <div className="flex justify-between text-xs mb-0.5">
                                <span className="text-gray-500">Avg CPK</span>
                                <span className={`font-semibold ${cpkColor(v.avgCpk)}`}>
                                  {v.avgCpk != null ? fmtCpk(v.avgCpk, activeCurrency) : 'N/A'}
                                </span>
                              </div>
                              {v.avgCpk != null && miniBar(
                                Math.max(0, 100 - (v.avgCpk / 3) * 100),
                                v.avgCpk <= 1.0 ? '#16a34a' : v.avgCpk <= 2.0 ? '#d97706' : '#dc2626'
                              )}
                            </div>
                            {/* Failure Rate */}
                            <div>
                              <div className="flex justify-between text-xs mb-0.5">
                                <span className="text-gray-500">Failure Rate</span>
                                <span className={`font-semibold ${riskColor((v.failureRate ?? 0) * 100)}`}>
                                  {fmtPct(v.failureRate)}
                                </span>
                              </div>
                              {miniBar(100 - (v.failureRate ?? 0) * 100, '#3b82f6')}
                            </div>
                            {/* Avg Life */}
                            <div>
                              <div className="flex justify-between text-xs mb-0.5">
                                <span className="text-gray-500">Avg Tyre Life</span>
                                <span className="text-gray-200 font-medium">{fmtKm(v.avgLifeKm)}</span>
                              </div>
                            </div>
                            {/* Scrap Rate */}
                            <div>
                              <div className="flex justify-between text-xs mb-0.5">
                                <span className="text-gray-500">Scrap Rate</span>
                                <span className={`font-semibold ${(v.scrapRate ?? 0) > 0.20 ? 'text-red-400' : (v.scrapRate ?? 0) > 0.10 ? 'text-yellow-400' : 'text-green-400'}`}>
                                  {fmtPct(v.scrapRate)}
                                </span>
                              </div>
                            </div>
                            {/* Records */}
                            <div className="flex justify-between text-xs">
                              <span className="text-gray-500">Total Records</span>
                              <span className="text-gray-200 font-medium">{v.count.toLocaleString()}</span>
                            </div>
                          </div>

                          <div className="mt-3 pt-3 border-t border-gray-800 flex justify-between text-xs">
                            <span className="text-gray-500">Total Investment</span>
                            <span className="text-gray-200 font-semibold">{totalCostDisplay}</span>
                          </div>
                        </motion.div>
                      )
                    })}
                  </div>

                  {/* Remaining brands compact table */}
                  {enrichedVendors.length > 3 && (
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 overflow-x-auto">
                      <p className="text-xs font-semibold text-gray-400 mb-3">Remaining Brands</p>
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr>
                            <th className="text-left py-2 pr-4 text-gray-500 font-medium">Rank</th>
                            <th className="text-left py-2 pr-4 text-gray-500 font-medium">Brand</th>
                            <th className="text-right py-2 px-3 text-gray-500 font-medium">Records</th>
                            <th className="text-right py-2 px-3 text-gray-500 font-medium">Avg CPK</th>
                            <th className="text-right py-2 px-3 text-gray-500 font-medium">Failure Rate</th>
                            <th className="text-right py-2 px-3 text-gray-500 font-medium">Avg Life</th>
                            <th className="text-right py-2 px-3 text-gray-500 font-medium">Score</th>
                          </tr>
                        </thead>
                        <tbody>
                          {enrichedVendors.slice(3).map((v, i) => (
                            <tr key={v.brand} className={i % 2 === 0 ? '' : 'bg-white/[0.02]'}>
                              <td className="py-2 pr-4 text-gray-500">#{v.rank}</td>
                              <td className="py-2 pr-4 font-medium text-gray-200">{v.brand}</td>
                              <td className="py-2 px-3 text-right text-gray-300">{v.count}</td>
                              <td className={`py-2 px-3 text-right font-semibold ${cpkColor(v.avgCpk)}`}>
                                {v.avgCpk != null ? v.avgCpk.toFixed(4) : 'N/A'}
                              </td>
                              <td className={`py-2 px-3 text-right font-semibold ${riskColor((v.failureRate ?? 0) * 100)}`}>
                                {fmtPct(v.failureRate)}
                              </td>
                              <td className="py-2 px-3 text-right text-gray-300">{fmtKm(v.avgLifeKm)}</td>
                              <td className="py-2 px-3 text-right text-green-400 font-semibold">{v.displayScore.toFixed(0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ─── 3b-3e: Brand Charts 2×2 ─────────────────────────────────── */}
            {hasVendorData && (
              <div>
                <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                  <BarChart3 size={15} className="text-green-400" /> Brand Performance Analytics
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                  {/* Radar chart */}
                  <div className="card">
                    <p className="text-xs font-semibold text-gray-300 mb-1">Brand Comparison Radar - Top 5</p>
                    <p className="text-[10px] text-gray-600 mb-3">Normalized 0-100 across 5 performance dimensions</p>
                    {radarData ? (
                      <div style={{ height: 300 }}>
                        <Radar data={radarData} options={radarOpts()} />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-[300px] text-gray-600 text-xs">
                        Insufficient data for radar comparison
                      </div>
                    )}
                  </div>

                  {/* CPK bar chart */}
                  <div className="card">
                    <p className="text-xs font-semibold text-gray-300 mb-1">CPK by Brand ({activeCurrency}/km)</p>
                    <p className="text-[10px] text-gray-600 mb-3">Green ≤1.0 · Amber 1-2 · Red ≥2 - sorted best to worst</p>
                    {cpkBarData.labels.length > 0 ? (
                      <div style={{ height: 280 }}>
                        <Bar
                          data={cpkBarData}
                          options={{
                            ...barOpts(true),
                            plugins: {
                              legend: { display: false },
                              tooltip: {
                                backgroundColor: CHART_THEME.tooltipBg,
                                titlecolor:'var(--panel-ink)',
                                bodyColor: '#d1d5db',
                                padding: 10,
                                cornerRadius: 8,
                                callbacks: {
                                  label: ctx => `${activeCurrency} ${Number(ctx.raw).toFixed(4)}/km`,
                                },
                              },
                            },
                          }}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-[280px] text-gray-600 text-xs">
                        No valid CPK data (requires km_at_fitment, km_at_removal, cost_per_tyre)
                      </div>
                    )}
                  </div>

                  {/* Tyre Life bar chart */}
                  <div className="card">
                    <p className="text-xs font-semibold text-gray-300 mb-1">Average Tyre Life by Brand</p>
                    <p className="text-[10px] text-gray-600 mb-3">Higher = longer-lasting tyre - sorted descending</p>
                    {lifeBarData.labels.length > 0 ? (
                      <div style={{ height: 280 }}>
                        <Bar
                          data={lifeBarData}
                          options={{
                            ...barOpts(true),
                            plugins: {
                              legend: { display: false },
                              tooltip: {
                                backgroundColor: CHART_THEME.tooltipBg,
                                titlecolor:'var(--panel-ink)',
                                bodyColor: '#d1d5db',
                                padding: 10,
                                cornerRadius: 8,
                                callbacks: {
                                  label: ctx => `${Math.round(ctx.raw).toLocaleString()} km`,
                                },
                              },
                            },
                            scales: {
                              x: {
                                grid: { color: CHART_THEME.gridColor },
                                ticks: {
                                  color: CHART_THEME.tickColor,
                                  font: { size: 11 },
                                  callback: v => `${(v / 1000).toFixed(0)}k`,
                                },
                              },
                              y: {
                                grid: { color: CHART_THEME.gridColor },
                                ticks: { color: CHART_THEME.tickColor, font: { size: 11 } },
                              },
                            },
                          }}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-[280px] text-gray-600 text-xs">
                        No tyre life data available
                      </div>
                    )}
                  </div>

                  {/* Failure Rate bar chart */}
                  <div className="card">
                    <p className="text-xs font-semibold text-gray-300 mb-1">Failure Rate by Brand (%)</p>
                    <p className="text-[10px] text-gray-600 mb-3">High + Critical risk as % of total records</p>
                    {failureBarData.labels.length > 0 ? (
                      <div style={{ height: 280 }}>
                        <Bar
                          data={failureBarData}
                          options={{
                            ...barOpts(false),
                            plugins: {
                              legend: { display: false },
                              tooltip: {
                                backgroundColor: CHART_THEME.tooltipBg,
                                titlecolor:'var(--panel-ink)',
                                bodyColor: '#d1d5db',
                                padding: 10,
                                cornerRadius: 8,
                                callbacks: {
                                  label: ctx => `${Number(ctx.raw).toFixed(1)}%`,
                                },
                              },
                            },
                            scales: {
                              x: {
                                grid: { color: CHART_THEME.gridColor },
                                ticks: { color: CHART_THEME.tickColor, font: { size: 11 } },
                              },
                              y: {
                                grid: { color: CHART_THEME.gridColor },
                                ticks: {
                                  color: CHART_THEME.tickColor,
                                  font: { size: 11 },
                                  callback: v => `${v}%`,
                                },
                              },
                            },
                          }}
                        />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-[280px] text-gray-600 text-xs">
                        No failure rate data available
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ─── 3f: Brand Performance Table ─────────────────────────────── */}
            {hasVendorData && (
              <div>
                <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                  <Target size={15} className="text-green-400" /> Full Brand Performance Table
                </h2>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left py-2.5 pr-4 text-gray-500 font-medium">Rank</th>
                        <th className="text-left py-2.5 pr-4 text-gray-500 font-medium">Brand</th>
                        <Th col="count" label="Records" onSort={handleSort} activeCol={sortCol} dir={sortDir} />
                        <Th col="validCount" label="Valid (CPK)" onSort={handleSort} activeCol={sortCol} dir={sortDir} />
                        <Th col="avgCpk" label="Avg CPK" onSort={handleSort} activeCol={sortCol} dir={sortDir} />
                        <Th col="medianCpk" label="Median CPK" onSort={handleSort} activeCol={sortCol} dir={sortDir} />
                        <Th col="avgLifeKm" label="Avg Life (km)" onSort={handleSort} activeCol={sortCol} dir={sortDir} />
                        <Th col="failureRate" label="Failure Rate" onSort={handleSort} activeCol={sortCol} dir={sortDir} />
                        <Th col="scrapRate" label="Scrap Rate" onSort={handleSort} activeCol={sortCol} dir={sortDir} />
                        <Th col="totalCost" label="Total Cost" onSort={handleSort} activeCol={sortCol} dir={sortDir} />
                        <Th col="displayScore" label="Score" onSort={handleSort} activeCol={sortCol} dir={sortDir} />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedVendors.map((v, i) => {
                        const badge = rankBadgeStyle(v.rank)
                        return (
                          <tr key={v.brand} className={i % 2 === 0 ? '' : 'bg-white/[0.02]'}>
                            <td className="py-2.5 pr-4">
                              <span className={`text-xs font-bold ${badge.text}`}>
                                {badge.icon ? badge.icon : `#${v.rank}`}
                              </span>
                            </td>
                            <td className="py-2.5 pr-4 font-semibold text-gray-200">{v.brand}</td>
                            <td className="py-2.5 px-3 text-right text-gray-300">{v.count.toLocaleString()}</td>
                            <td className="py-2.5 px-3 text-right text-gray-400">{v.validCount}</td>
                            <td className={`py-2.5 px-3 text-right font-semibold ${cpkColor(v.avgCpk)}`}>
                              {v.avgCpk != null ? v.avgCpk.toFixed(4) : 'N/A'}
                            </td>
                            <td className="py-2.5 px-3 text-right text-gray-400">
                              {v.medianCpk != null ? v.medianCpk.toFixed(4) : 'N/A'}
                            </td>
                            <td className="py-2.5 px-3 text-right text-gray-300">
                              {v.avgLifeKm != null && v.avgLifeKm > 0 ? Math.round(v.avgLifeKm).toLocaleString() : 'N/A'}
                            </td>
                            <td className={`py-2.5 px-3 text-right font-semibold ${riskColor((v.failureRate ?? 0) * 100)}`}>
                              {fmtPct(v.failureRate)}
                            </td>
                            <td className={`py-2.5 px-3 text-right font-semibold ${(v.scrapRate ?? 0) > 0.20 ? 'text-red-400' : (v.scrapRate ?? 0) > 0.10 ? 'text-yellow-400' : 'text-green-400'}`}>
                              {fmtPct(v.scrapRate)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-gray-300">
                              {fmtCurrency(v.totalCost, activeCurrency)}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <span className={`font-bold text-sm ${v.rank <= 3 ? badge.text : 'text-gray-400'}`}>
                                {v.displayScore.toFixed(0)}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </motion.div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════════
            WORKSHOP SECTION
        ═══════════════════════════════════════════════════════════════════════ */}
        {activeSection === 'workshops' && (
          <motion.div
            key="workshops"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2 }}
            className="space-y-6"
          >
            {/* ─── 4a: Workshop Rankings ───────────────────────────────────── */}
            <div>
              <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                <Building2 size={15} className="text-green-400" /> Workshop Site Rankings
              </h2>

              {!hasWorkshopData ? (
                <div className="card text-center py-16 text-gray-600 text-sm">
                  No workshop data meets the minimum record threshold ({minRecords}).
                </div>
              ) : (
                <>
                  {/* Top 3 featured workshop cards */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    {workshops.slice(0, 3).map(w => {
                      const badge = rankBadgeStyle(w.rank)
                      return (
                        <motion.div
                          key={w.site}
                          initial={{ opacity: 0, scale: 0.97 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: w.rank * 0.05 }}
                          className={`bg-gray-900 border rounded-xl p-5 ${badge.bg}`}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className="text-2xl">{badge.icon ?? `#${w.rank}`}</span>
                              <div>
                                <p className={`text-xs font-bold uppercase tracking-wider ${badge.text}`}>Rank #{w.rank}</p>
                                <p className="text-base font-bold text-white">{w.site}</p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-black text-white">{w.displayScore.toFixed(0)}</p>
                              <p className="text-[10px] text-gray-500">/ 100 score</p>
                            </div>
                          </div>

                          {/* Score bar */}
                          <div className="mb-4">
                            <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-700 ${
                                  w.rank === 1 ? 'bg-yellow-400' : w.rank === 2 ? 'bg-gray-400' : 'bg-amber-600'
                                }`}
                                style={{ width: `${w.displayScore}%` }}
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <div className="flex justify-between text-xs">
                              <span className="text-gray-500">Records</span>
                              <span className="text-gray-200 font-medium">{w.recordCount.toLocaleString()}</span>
                            </div>
                            <div>
                              <div className="flex justify-between text-xs mb-0.5">
                                <span className="text-gray-500">High Risk %</span>
                                <span className={`font-semibold ${riskColor(w.highRiskPct)}`}>
                                  {fmtNum(w.highRiskPct)}%
                                </span>
                              </div>
                              {miniBar(
                                100 - w.highRiskPct,
                                w.highRiskPct >= 30 ? '#dc2626' : w.highRiskPct >= 15 ? '#d97706' : '#16a34a'
                              )}
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-gray-500">Avg CPK</span>
                              <span className={`font-semibold ${cpkColor(w.avgCpk)}`}>
                                {w.avgCpk != null ? fmtCpk(w.avgCpk, activeCurrency) : 'N/A'}
                              </span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-gray-500">Avg Cost/Tyre</span>
                              <span className="text-gray-200 font-medium">{fmtCurrency(w.avgCost, activeCurrency)}</span>
                            </div>
                            <div>
                              <div className="flex justify-between text-xs mb-0.5">
                                <span className="text-gray-500">Action Close Rate</span>
                                <span className={`font-semibold ${(w.actionCloseRate ?? 0) >= 0.7 ? 'text-green-400' : (w.actionCloseRate ?? 0) >= 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
                                  {fmtPct(w.actionCloseRate)}
                                </span>
                              </div>
                              {miniBar((w.actionCloseRate ?? 0) * 100, '#3b82f6')}
                            </div>
                          </div>
                        </motion.div>
                      )
                    })}
                  </div>

                  {/* Remaining workshops compact */}
                  {workshops.length > 3 && (
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 overflow-x-auto">
                      <p className="text-xs font-semibold text-gray-400 mb-3">All Sites</p>
                      <table className="min-w-full text-xs">
                        <thead>
                          <tr>
                            <th className="text-left py-2 pr-4 text-gray-500 font-medium">Rank</th>
                            <th className="text-left py-2 pr-4 text-gray-500 font-medium">Site</th>
                            <th className="text-right py-2 px-3 text-gray-500 font-medium">Records</th>
                            <th className="text-right py-2 px-3 text-gray-500 font-medium">High Risk %</th>
                            <th className="text-right py-2 px-3 text-gray-500 font-medium">Avg CPK</th>
                            <th className="text-right py-2 px-3 text-gray-500 font-medium">Close Rate</th>
                            <th className="text-right py-2 px-3 text-gray-500 font-medium">Score</th>
                          </tr>
                        </thead>
                        <tbody>
                          {workshops.slice(3).map((w, i) => (
                            <tr key={w.site} className={i % 2 === 0 ? '' : 'bg-white/[0.02]'}>
                              <td className="py-2 pr-4 text-gray-500">#{w.rank}</td>
                              <td className="py-2 pr-4 font-medium text-gray-200">{w.site}</td>
                              <td className="py-2 px-3 text-right text-gray-300">{w.recordCount}</td>
                              <td className={`py-2 px-3 text-right font-semibold ${riskColor(w.highRiskPct)}`}>
                                {fmtNum(w.highRiskPct)}%
                              </td>
                              <td className={`py-2 px-3 text-right font-semibold ${cpkColor(w.avgCpk)}`}>
                                {w.avgCpk != null ? w.avgCpk.toFixed(4) : 'N/A'}
                              </td>
                              <td className={`py-2 px-3 text-right font-semibold ${(w.actionCloseRate ?? 0) >= 0.7 ? 'text-green-400' : (w.actionCloseRate ?? 0) >= 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
                                {fmtPct(w.actionCloseRate)}
                              </td>
                              <td className="py-2 px-3 text-right text-green-400 font-semibold">{w.displayScore.toFixed(0)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ─── 4b-4c: Workshop Charts ──────────────────────────────────── */}
            {hasWorkshopData && (
              <div>
                <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                  <BarChart3 size={15} className="text-green-400" /> Workshop Analytics
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">

                  {/* High Risk % by Site */}
                  <div className="card">
                    <p className="text-xs font-semibold text-gray-300 mb-1">High Risk % by Site</p>
                    <p className="text-[10px] text-gray-600 mb-3">High + Critical risk records as % of site total</p>
                    <div style={{ height: 260 }}>
                      <Bar
                        data={workshopRiskData}
                        options={{
                          ...barOpts(false),
                          plugins: {
                            legend: { display: false },
                            tooltip: {
                              backgroundColor: CHART_THEME.tooltipBg,
                              titlecolor:'var(--panel-ink)',
                              bodyColor: '#d1d5db',
                              padding: 10,
                              cornerRadius: 8,
                              callbacks: { label: ctx => `${Number(ctx.raw).toFixed(1)}%` },
                            },
                          },
                          scales: {
                            x: { grid: { color: CHART_THEME.gridColor }, ticks: { color: CHART_THEME.tickColor, font: { size: 10 }, maxRotation: 35 } },
                            y: { grid: { color: CHART_THEME.gridColor }, ticks: { color: CHART_THEME.tickColor, font: { size: 10 }, callback: v => `${v}%` } },
                          },
                        }}
                      />
                    </div>
                  </div>

                  {/* Avg CPK by Site */}
                  <div className="card">
                    <p className="text-xs font-semibold text-gray-300 mb-1">Avg CPK by Site ({activeCurrency}/km)</p>
                    <p className="text-[10px] text-gray-600 mb-3">Higher CPK = more expensive per km driven</p>
                    <div style={{ height: 260 }}>
                      <Bar
                        data={workshopCpkData}
                        options={{
                          ...barOpts(false),
                          plugins: {
                            legend: { display: false },
                            tooltip: {
                              backgroundColor: CHART_THEME.tooltipBg,
                              titlecolor:'var(--panel-ink)',
                              bodyColor: '#d1d5db',
                              padding: 10,
                              cornerRadius: 8,
                              callbacks: { label: ctx => `${activeCurrency} ${Number(ctx.raw).toFixed(4)}/km` },
                            },
                          },
                          scales: {
                            x: { grid: { color: CHART_THEME.gridColor }, ticks: { color: CHART_THEME.tickColor, font: { size: 10 }, maxRotation: 35 } },
                            y: { grid: { color: CHART_THEME.gridColor }, ticks: { color: CHART_THEME.tickColor, font: { size: 10 } } },
                          },
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Action Close Rate */}
                <div className="card">
                  <p className="text-xs font-semibold text-gray-300 mb-1">Corrective Action Close Rate by Site (%)</p>
                  <p className="text-[10px] text-gray-600 mb-3">% of corrective actions resolved - green ≥70% · amber 40-70% · red &lt;40%</p>
                  <div style={{ height: 220 }}>
                    <Bar
                      data={workshopCloseData}
                      options={{
                        ...barOpts(false),
                        plugins: {
                          legend: { display: false },
                          tooltip: {
                            backgroundColor: CHART_THEME.tooltipBg,
                            titlecolor:'var(--panel-ink)',
                            bodyColor: '#d1d5db',
                            padding: 10,
                            cornerRadius: 8,
                            callbacks: { label: ctx => `${Number(ctx.raw).toFixed(1)}%` },
                          },
                        },
                        scales: {
                          x: { grid: { color: CHART_THEME.gridColor }, ticks: { color: CHART_THEME.tickColor, font: { size: 10 }, maxRotation: 35 } },
                          y: {
                            grid: { color: CHART_THEME.gridColor },
                            ticks: { color: CHART_THEME.tickColor, font: { size: 10 }, callback: v => `${v}%` },
                            min: 0,
                            max: 100,
                          },
                        },
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ─── 4d: Workshop Performance Table ─────────────────────────── */}
            {hasWorkshopData && (
              <div>
                <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
                  <Target size={15} className="text-green-400" /> Workshop Performance Table
                </h2>
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-800">
                        <th className="text-left py-2.5 pr-4 text-gray-500 font-medium">Rank</th>
                        <th className="text-left py-2.5 pr-4 text-gray-500 font-medium">Site</th>
                        <Th col="recordCount" label="Records" onSort={handleWorkshopSort} activeCol={workshopSortCol} dir={workshopSortDir} />
                        <Th col="highRiskPct" label="High Risk %" onSort={handleWorkshopSort} activeCol={workshopSortCol} dir={workshopSortDir} />
                        <Th col="avgCpk" label="Avg CPK" onSort={handleWorkshopSort} activeCol={workshopSortCol} dir={workshopSortDir} />
                        <Th col="avgCost" label="Avg Cost" onSort={handleWorkshopSort} activeCol={workshopSortCol} dir={workshopSortDir} />
                        <th className="text-right py-2.5 px-3 text-gray-500 font-medium">Actions Raised</th>
                        <Th col="actionCloseRate" label="Close Rate %" onSort={handleWorkshopSort} activeCol={workshopSortCol} dir={workshopSortDir} />
                        <Th col="displayScore" label="Score" onSort={handleWorkshopSort} activeCol={workshopSortCol} dir={workshopSortDir} />
                      </tr>
                    </thead>
                    <tbody>
                      {sortedWorkshops.map((w, i) => {
                        const badge = rankBadgeStyle(w.rank)
                        const siteActions = actions.filter(a => a.site === w.site)
                        return (
                          <tr key={w.site} className={i % 2 === 0 ? '' : 'bg-white/[0.02]'}>
                            <td className="py-2.5 pr-4">
                              <span className={`text-xs font-bold ${badge.text}`}>
                                {badge.icon ?? `#${w.rank}`}
                              </span>
                            </td>
                            <td className="py-2.5 pr-4 font-semibold text-gray-200">{w.site}</td>
                            <td className="py-2.5 px-3 text-right text-gray-300">{w.recordCount.toLocaleString()}</td>
                            <td className={`py-2.5 px-3 text-right font-semibold ${riskColor(w.highRiskPct)}`}>
                              {fmtNum(w.highRiskPct)}%
                            </td>
                            <td className={`py-2.5 px-3 text-right font-semibold ${cpkColor(w.avgCpk)}`}>
                              {w.avgCpk != null ? w.avgCpk.toFixed(4) : 'N/A'}
                            </td>
                            <td className="py-2.5 px-3 text-right text-gray-300">
                              {fmtCurrency(w.avgCost, activeCurrency)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-gray-400">{siteActions.length}</td>
                            <td className={`py-2.5 px-3 text-right font-semibold ${(w.actionCloseRate ?? 0) >= 0.7 ? 'text-green-400' : (w.actionCloseRate ?? 0) >= 0.4 ? 'text-yellow-400' : 'text-red-400'}`}>
                              {fmtPct(w.actionCloseRate)}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <span className={`font-bold text-sm ${w.rank <= 3 ? badge.text : 'text-gray-400'}`}>
                                {w.displayScore.toFixed(0)}
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Section 5: Procurement Recommendations ─────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
          <Zap size={15} className="text-amber-400" /> Procurement Recommendations
        </h2>

        {recommendations.length === 0 ? (
          <div className="bg-gray-900 border border-green-800/40 rounded-xl p-4 flex items-center gap-3 bg-green-950/10">
            <CheckCircle size={20} className="text-green-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-green-300">Fleet Performance Within Acceptable Parameters</p>
              <p className="text-xs text-green-400/70 mt-0.5">No critical procurement actions identified. Continue monitoring.</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {recommendations.map((rec, i) => {
              const priorityStyles = {
                Critical: { border: 'border-red-700/40', bg: 'bg-red-950/15', badge: 'bg-red-900/60 text-red-300 border border-red-700/40', icon: <ShieldAlert size={14} className="text-red-400" /> },
                High: { border: 'border-yellow-700/40', bg: 'bg-yellow-950/15', badge: 'bg-yellow-900/60 text-yellow-300 border border-yellow-700/40', icon: <AlertTriangle size={14} className="text-yellow-400" /> },
                Medium: { border: 'border-blue-700/40', bg: 'bg-blue-950/15', badge: 'bg-blue-900/60 text-blue-300 border border-blue-700/40', icon: <Activity size={14} className="text-blue-400" /> },
              }
              const style = priorityStyles[rec.priority] ?? priorityStyles.Medium
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className={`bg-gray-900 border rounded-xl p-4 ${style.border} ${style.bg}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 mt-0.5">{style.icon}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${style.badge}`}>
                          {rec.priority}
                        </span>
                      </div>
                      <p className="text-xs text-gray-300 leading-relaxed">{rec.text}</p>
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>

      {/* ─── Section 6: Executive Summary Card ──────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
          <Star size={15} className="text-yellow-400" /> Executive Summary
        </h2>
        <div className="bg-gray-900 border border-gray-700/50 rounded-xl p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">

            {/* Best Value Brand */}
            <div className="bg-green-950/20 border border-green-800/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown size={14} className="text-green-400" />
                <span className="text-xs font-semibold text-green-300">Best Value Brand</span>
              </div>
              <p className="text-lg font-black text-white">{execSummary.bestBrand?.brand ?? '-'}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {execSummary.bestBrand?.avgCpk != null
                  ? `Avg CPK: ${fmtCpk(execSummary.bestBrand.avgCpk, activeCurrency)}/km`
                  : 'No CPK data'}
              </p>
              <p className="text-[11px] text-green-400/70 mt-1">Lowest cost per km - recommended for increased procurement</p>
            </div>

            {/* Worst Value Brand */}
            <div className="bg-red-950/20 border border-red-800/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp size={14} className="text-red-400" />
                <span className="text-xs font-semibold text-red-300">Highest Cost Brand</span>
              </div>
              <p className="text-lg font-black text-white">{execSummary.worstBrand?.brand ?? '-'}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {execSummary.worstBrand?.avgCpk != null
                  ? `Avg CPK: ${fmtCpk(execSummary.worstBrand.avgCpk, activeCurrency)}/km`
                  : 'No CPK data'}
              </p>
              <p className="text-[11px] text-red-400/70 mt-1">Highest cost per km - evaluate specification or supplier change</p>
            </div>

            {/* Estimated Annual Saving */}
            <div className="bg-yellow-950/20 border border-yellow-800/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign size={14} className="text-yellow-400" />
                <span className="text-xs font-semibold text-yellow-300">Potential Annual Saving</span>
              </div>
              <p className="text-lg font-black text-yellow-300">
                {execSummary.estAnnualSaving > 0
                  ? fmtCurrency(execSummary.estAnnualSaving, activeCurrency)
                  : '-'}
              </p>
              <p className="text-[11px] text-yellow-400/70 mt-1">
                {execSummary.estAnnualSaving > 0
                  ? `If fleet switches from ${execSummary.worstBrand?.brand ?? '-'} to ${execSummary.bestBrand?.brand ?? '-'}`
                  : 'Switch best and worst brand CPK to unlock saving estimate'}
              </p>
            </div>

            {/* Best Site */}
            <div className="bg-blue-950/20 border border-blue-800/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle size={14} className="text-blue-400" />
                <span className="text-xs font-semibold text-blue-300">Best Performing Site</span>
              </div>
              <p className="text-lg font-black text-white">{execSummary.bestSite?.site ?? '-'}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {execSummary.bestSite
                  ? `Score: ${execSummary.bestSite.displayScore.toFixed(0)}/100 · ${fmtNum(execSummary.bestSite.highRiskPct)}% high risk`
                  : 'No site data'}
              </p>
              <p className="text-[11px] text-blue-400/70 mt-1">Benchmark site for fleet-wide best practices</p>
            </div>

            {/* Site Needing Attention */}
            <div className="bg-orange-950/20 border border-orange-800/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={14} className="text-orange-400" />
                <span className="text-xs font-semibold text-orange-300">Site Needing Attention</span>
              </div>
              <p className="text-lg font-black text-white">{execSummary.worstSite?.site ?? '-'}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                {execSummary.worstSite
                  ? `Score: ${execSummary.worstSite.displayScore.toFixed(0)}/100 · ${fmtNum(execSummary.worstSite.highRiskPct)}% high risk`
                  : 'No site data'}
              </p>
              <p className="text-[11px] text-orange-400/70 mt-1">Schedule tyre audit and corrective action review</p>
            </div>

            {/* Total Fleet Investment */}
            <div className="bg-purple-950/20 border border-purple-800/30 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Wrench size={14} className="text-purple-400" />
                <span className="text-xs font-semibold text-purple-300">Total Fleet Investment</span>
              </div>
              <p className="text-lg font-black text-white">{fmtCurrency(execSummary.totalFleetInvestment, activeCurrency)}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Across {filteredRecords.filter(r => Number(r.cost_per_tyre) > 0).length.toLocaleString()} records with cost data
              </p>
              <p className="text-[11px] text-purple-400/70 mt-1">
                {enrichedVendors.length > 0 ? `${enrichedVendors.length} brands tracked in selected period` : 'No brand data'}
              </p>
            </div>

          </div>
        </div>
      </div>

      <EmailReportModal
        isOpen={emailModalOpen}
        onClose={() => setEmailModalOpen(false)}
        reportTitle="Vendor & Workshop Intelligence Report"
        pdfColumns={['Rank', 'Brand', 'Records', 'Avg CPK', 'Avg Life', 'Failure Rate', 'Scrap Rate', 'Score']}
        pdfRows={sortedVendors.map(v => [
          String(v.rank),
          v.brand,
          String(v.count),
          v.avgCpk != null ? fmtCpk(v.avgCpk, activeCurrency) : 'N/A',
          fmtKm(v.avgLifeKm),
          fmtPct(v.failureRate),
          fmtPct(v.scrapRate),
          v.displayScore.toFixed(0),
        ])}
        kpiSummary={{
          'Total Brands Tracked': String(enrichedVendors.length),
          'Best Value Brand': execSummary.bestBrand?.brand ?? '-',
          'Best Brand CPK': execSummary.bestBrand?.avgCpk != null ? fmtCpk(execSummary.bestBrand.avgCpk, activeCurrency) : '-',
          'Highest Cost Brand': execSummary.worstBrand?.brand ?? '-',
          'Total Fleet Investment': fmtCurrency(execSummary.totalFleetInvestment, activeCurrency),
          'Potential Annual Saving': execSummary.estAnnualSaving > 0 ? fmtCurrency(execSummary.estAnnualSaving, activeCurrency) : '-',
          'Best Performing Site': execSummary.bestSite?.site ?? '-',
          'Total Records Analysed': String(filteredRecords.length),
        }}
        period={`Period: ${datePreset}`}
      />
    </div>
  )
}
