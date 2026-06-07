import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Line, Bar, Doughnut } from 'react-chartjs-2'
import {
  CalendarClock, Download, FileText, AlertTriangle, CheckCircle,
  Clock, TrendingUp, DollarSign, Truck, ChevronDown, ChevronUp,
  ChevronLeft, ChevronRight, Info, RefreshCw, Filter,
} from 'lucide-react'

ChartJS.register(
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

// ── Constants ──────────────────────────────────────────────────────────────────
const DEFAULT_DAILY_KM   = 200
const DEFAULT_AVG_KM     = 80_000
const URGENT_TREAD_MM    = 3
const SOON_TREAD_MM      = 5
const URGENT_DAYS        = 30
const SOON_DAYS          = 90
const PAGE_SIZE          = 25
const TODAY              = new Date()

const CHART_DARK = {
  color: '#9ca3af',
  grid: 'rgba(255,255,255,0.08)',
}

// ── Utility helpers ────────────────────────────────────────────────────────────
function addMonths(date, n) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + n)
  return d
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(date) {
  return date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
}

function daysBetween(a, b) {
  return Math.round((b - a) / 86_400_000)
}

function fmt(n, dec = 0) {
  if (n == null || isNaN(n)) return '—'
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  })
}

function fmtCurrency(n, currency = 'SAR') {
  if (n == null || isNaN(n)) return '—'
  return `${currency} ${fmt(n, 0)}`
}

function fmtDate(date) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function urgencyFromTreadAndDays(treadDepth, daysAway) {
  if (treadDepth != null && treadDepth < URGENT_TREAD_MM) return 'Urgent'
  if (daysAway <= URGENT_DAYS) return 'Urgent'
  if (daysAway <= SOON_DAYS) return 'Soon'
  return 'Monitor'
}

function mean(arr) {
  if (!arr.length) return null
  return arr.reduce((s, v) => s + v, 0) / arr.length
}

// ── Prediction engine ──────────────────────────────────────────────────────────
function buildPredictions(records, fleetMaster, fleetAvgCost, fleetAvgKmLife, fleetAvgDailyKm) {
  // Group by asset_no
  const byAsset = {}
  for (const r of records) {
    if (!r.asset_no) continue
    if (!byAsset[r.asset_no]) byAsset[r.asset_no] = []
    byAsset[r.asset_no].push(r)
  }

  // Fleet master lookup
  const masterByAsset = {}
  for (const fm of fleetMaster) {
    if (fm.asset_no) masterByAsset[fm.asset_no] = fm
  }

  const predictions = []

  for (const [assetNo, recs] of Object.entries(byAsset)) {
    const master = masterByAsset[assetNo] || null

    // Completed records = has km_at_removal
    const completed = recs.filter(r => r.km_at_removal != null && r.km_at_fitment != null)
    const completedLifeKms = completed
      .map(r => r.km_at_removal - r.km_at_fitment)
      .filter(v => v > 0)

    const avgKmLife = completedLifeKms.length > 0
      ? mean(completedLifeKms)
      : (master?.expected_km_per_tyre ?? fleetAvgKmLife ?? DEFAULT_AVG_KM)

    // Compute avg daily km for this asset
    let avgDailyKm = DEFAULT_DAILY_KM
    if (completed.length > 0) {
      const dates = completed
        .map(r => r.issue_date ? new Date(r.issue_date) : null)
        .filter(Boolean)
      if (dates.length >= 2) {
        const minDate = new Date(Math.min(...dates.map(d => d.getTime())))
        const maxDate = new Date(Math.max(...dates.map(d => d.getTime())))
        const totalDays = daysBetween(minDate, maxDate)
        const lastKmAtRemoval = Math.max(...completed.map(r => r.km_at_removal))
        const firstKmAtFitment = Math.min(...completed.map(r => r.km_at_fitment))
        const totalKm = lastKmAtRemoval - firstKmAtFitment
        if (totalDays > 0 && totalKm > 0) {
          avgDailyKm = totalKm / totalDays
        }
      }
    }
    if (!avgDailyKm || avgDailyKm <= 0) avgDailyKm = fleetAvgDailyKm || DEFAULT_DAILY_KM

    // Current km from fleet master or estimate
    let currentKm = master?.current_km ?? null
    if (currentKm == null && completed.length > 0) {
      const lastRemoval = completed.sort((a, b) => (b.km_at_removal ?? 0) - (a.km_at_removal ?? 0))[0]
      const lastDate = lastRemoval.issue_date ? new Date(lastRemoval.issue_date) : null
      if (lastDate) {
        const daysSince = daysBetween(lastDate, TODAY)
        currentKm = (lastRemoval.km_at_removal ?? 0) + daysSince * avgDailyKm
      }
    }

    // Active tyres (no km_at_removal = still fitted)
    const active = recs.filter(r => r.km_at_removal == null)

    if (active.length === 0) continue

    // Cost fallback chain
    const assetCosts = recs.map(r => r.cost_per_tyre).filter(v => v > 0)
    const assetAvgCost = assetCosts.length > 0 ? mean(assetCosts) : (fleetAvgCost ?? 1200)

    for (const tyre of active) {
      const fitmentKm = tyre.km_at_fitment ?? currentKm ?? 0
      const tyreRunKm = currentKm != null ? Math.max(0, currentKm - fitmentKm) : 0
      const remainingKm = Math.max(0, avgKmLife - tyreRunKm)
      const daysUntilReplacement = avgDailyKm > 0 ? remainingKm / avgDailyKm : 365
      const replacementDate = new Date(TODAY)
      replacementDate.setDate(replacementDate.getDate() + Math.round(daysUntilReplacement))

      const daysAway = Math.round(daysUntilReplacement)
      const urgency = urgencyFromTreadAndDays(tyre.tread_depth, daysAway)
      const estimatedCost = tyre.cost_per_tyre > 0 ? tyre.cost_per_tyre : assetAvgCost

      predictions.push({
        id: tyre.id,
        asset_no: assetNo,
        site: tyre.site ?? master?.site ?? '—',
        vehicle_type: master?.vehicle_type ?? '—',
        position: tyre.position ?? '—',
        brand: tyre.brand ?? '—',
        tyre_serial: tyre.tyre_serial ?? '—',
        tread_depth: tyre.tread_depth ?? null,
        pressure_reading: tyre.pressure_reading ?? null,
        km_remaining: Math.round(remainingKm),
        due_date: replacementDate,
        urgency,
        estimated_cost: Math.round(estimatedCost),
        days_away: daysAway,
        avg_km_life: Math.round(avgKmLife),
        avg_daily_km: Math.round(avgDailyKm),
      })
    }
  }

  return predictions.sort((a, b) => a.due_date - b.due_date)
}

// ── Budget forecast bucketing ──────────────────────────────────────────────────
function buildMonthlyBudget(predictions) {
  const buckets = {}
  for (let i = 0; i < 12; i++) {
    const m = addMonths(TODAY, i)
    buckets[monthKey(m)] = { label: monthLabel(m), cost: 0, count: 0, date: m }
  }
  for (const p of predictions) {
    const k = monthKey(p.due_date)
    if (buckets[k]) {
      buckets[k].cost += p.estimated_cost
      buckets[k].count++
    }
  }
  return Object.values(buckets)
}

// ── Site breakdown ─────────────────────────────────────────────────────────────
function buildSiteBreakdown(predictions, totalBudget) {
  const sites = {}
  for (const p of predictions) {
    if (!sites[p.site]) sites[p.site] = { site: p.site, due30: 0, due90: 0, due12mo: 0, cost: 0 }
    sites[p.site].due12mo++
    sites[p.site].cost += p.estimated_cost
    if (p.days_away <= 30) sites[p.site].due30++
    if (p.days_away <= 90) sites[p.site].due90++
  }
  return Object.values(sites)
    .sort((a, b) => b.cost - a.cost)
    .map(s => ({
      ...s,
      pct_budget: totalBudget > 0 ? ((s.cost / totalBudget) * 100).toFixed(1) : '0.0',
    }))
}

// ── Horizon filter helper ──────────────────────────────────────────────────────
function horizonDays(h) {
  if (h === '30d') return 30
  if (h === '90d') return 90
  if (h === '6mo') return 180
  return 365
}

// ── Chart options factories ────────────────────────────────────────────────────
function lineOpts(currency) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: CHART_DARK.color, font: { size: 11 } } },
      tooltip: {
        backgroundColor: '#111827',
        borderColor: '#374151',
        borderWidth: 1,
        titleColor: '#f9fafb',
        bodyColor: '#9ca3af',
        callbacks: {
          label: ctx => ` ${currency} ${fmt(ctx.raw, 0)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: CHART_DARK.grid },
        ticks: { color: CHART_DARK.color, font: { size: 10 } },
      },
      y: {
        grid: { color: CHART_DARK.grid },
        ticks: {
          color: CHART_DARK.color,
          font: { size: 10 },
          callback: v => `${currency} ${fmt(v, 0)}`,
        },
        beginAtZero: true,
      },
    },
  }
}

function barOpts(currency) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#111827',
        borderColor: '#374151',
        borderWidth: 1,
        titleColor: '#f9fafb',
        bodyColor: '#9ca3af',
        callbacks: {
          label: ctx => ` Count: ${ctx.raw}`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: CHART_DARK.grid },
        ticks: { color: CHART_DARK.color, font: { size: 10 } },
      },
      y: {
        grid: { color: CHART_DARK.grid },
        ticks: { color: CHART_DARK.color, font: { size: 10 } },
        beginAtZero: true,
      },
    },
  }
}

// ── KPI Card component ─────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, color = 'blue', loading }) {
  const colorMap = {
    red:    { bg: 'bg-red-900/20 border-red-800/40',    icon: 'text-red-400',    val: 'text-red-300' },
    amber:  { bg: 'bg-amber-900/20 border-amber-800/40', icon: 'text-amber-400',  val: 'text-amber-300' },
    green:  { bg: 'bg-green-900/20 border-green-800/40', icon: 'text-green-400',  val: 'text-green-300' },
    blue:   { bg: 'bg-blue-900/20 border-blue-800/40',  icon: 'text-blue-400',   val: 'text-blue-300' },
    purple: { bg: 'bg-purple-900/20 border-purple-800/40', icon: 'text-purple-400', val: 'text-purple-300' },
    cyan:   { bg: 'bg-cyan-900/20 border-cyan-800/40',  icon: 'text-cyan-400',   val: 'text-cyan-300' },
  }
  const c = colorMap[color] || colorMap.blue
  return (
    <div className={`border rounded-xl p-4 flex gap-3 items-start ${c.bg}`}>
      <div className={`mt-0.5 ${c.icon}`}>
        <Icon size={20} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-400 leading-tight">{label}</p>
        {loading
          ? <div className="h-6 w-24 bg-gray-700 rounded animate-pulse mt-1" />
          : <p className={`text-lg font-bold leading-tight mt-0.5 ${c.val}`}>{value}</p>
        }
        {sub && !loading && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

// ── Urgency badge ──────────────────────────────────────────────────────────────
function UrgencyBadge({ urgency }) {
  if (urgency === 'Urgent')  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-900/40 text-red-300 border border-red-800/50"><span className="w-1.5 h-1.5 rounded-full bg-red-400" />Urgent</span>
  if (urgency === 'Soon')    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-900/40 text-amber-300 border border-amber-800/50"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" />Soon</span>
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-900/20 text-green-400 border border-green-800/40"><span className="w-1.5 h-1.5 rounded-full bg-green-500" />Monitor</span>
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function PredictiveMaintenance() {
  const { activeCurrency } = useSettings()

  const [records, setRecords]         = useState([])
  const [fleetMaster, setFleetMaster] = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [fleetMasterAvailable, setFleetMasterAvailable] = useState(true)

  const [siteFilter, setSiteFilter]     = useState('all')
  const [urgencyFilter, setUrgencyFilter] = useState('all')
  const [vehicleTypeFilter, setVehicleTypeFilter] = useState('all')
  const [horizonFilter, setHorizonFilter] = useState('90d')
  const [currentPage, setCurrentPage]   = useState(1)

  const [assumptionsOpen, setAssumptionsOpen] = useState(false)

  // ── Data loading ─────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Load tyre_records
      const { data: tyreData, error: tyreErr } = await supabase
        .from('tyre_records')
        .select('id,asset_no,site,brand,tyre_serial,position,tread_depth,pressure_reading,km_at_fitment,km_at_removal,cost_per_tyre,issue_date,risk_level,category')
        .limit(5000)
        .order('issue_date', { ascending: false })

      if (tyreErr) throw tyreErr
      setRecords(tyreData || [])

      // Load vehicle_fleet (graceful if missing)
      try {
        const { data: fleetData, error: fleetErr } = await supabase
          .from('vehicle_fleet')
          .select('asset_no,site,vehicle_type,expected_km_per_tyre,monthly_tyre_budget,current_km')

        if (fleetErr) {
          setFleetMaster([])
          setFleetMasterAvailable(false)
        } else {
          setFleetMaster(fleetData || [])
          setFleetMasterAvailable(true)
        }
      } catch {
        setFleetMaster([])
        setFleetMasterAvailable(false)
      }
    } catch (err) {
      setError(err.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // ── Fleet-level computed constants ───────────────────────────────────────────
  const fleetStats = useMemo(() => {
    const completed = records.filter(r => r.km_at_removal != null && r.km_at_fitment != null)
    const lives = completed.map(r => r.km_at_removal - r.km_at_fitment).filter(v => v > 0)
    const costs = records.map(r => r.cost_per_tyre).filter(v => v > 0)

    const avgKmLife    = lives.length > 0 ? mean(lives) : DEFAULT_AVG_KM
    const avgCost      = costs.length > 0 ? mean(costs) : 1200
    const avgDailyKm   = DEFAULT_DAILY_KM

    return { avgKmLife, avgCost, avgDailyKm }
  }, [records])

  // ── Predictions ───────────────────────────────────────────────────────────────
  const allPredictions = useMemo(() => {
    if (!records.length) return []
    return buildPredictions(
      records,
      fleetMaster,
      fleetStats.avgCost,
      fleetStats.avgKmLife,
      fleetStats.avgDailyKm,
    )
  }, [records, fleetMaster, fleetStats])

  // ── Derived lists ─────────────────────────────────────────────────────────────
  const uniqueSites = useMemo(() => {
    const s = new Set(allPredictions.map(p => p.site).filter(v => v && v !== '—'))
    return ['all', ...Array.from(s).sort()]
  }, [allPredictions])

  const uniqueVehicleTypes = useMemo(() => {
    const t = new Set(fleetMaster.map(f => f.vehicle_type).filter(Boolean))
    return ['all', ...Array.from(t).sort()]
  }, [fleetMaster])

  // ── Filtered predictions ──────────────────────────────────────────────────────
  const filteredPredictions = useMemo(() => {
    const maxDays = horizonDays(horizonFilter)
    return allPredictions.filter(p => {
      if (siteFilter !== 'all' && p.site !== siteFilter) return false
      if (urgencyFilter !== 'all' && p.urgency !== urgencyFilter) return false
      if (vehicleTypeFilter !== 'all' && p.vehicle_type !== vehicleTypeFilter) return false
      if (p.days_away > maxDays) return false
      return true
    })
  }, [allPredictions, siteFilter, urgencyFilter, vehicleTypeFilter, horizonFilter])

  // ── KPI summary ───────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const urgent = allPredictions.filter(p => p.urgency === 'Urgent')
    const soon   = allPredictions.filter(p => p.urgency === 'Soon')
    const monitor = allPredictions.filter(p => p.urgency === 'Monitor' && p.days_away <= 365)
    const yr12   = allPredictions.filter(p => p.days_away <= 365)

    const urgentCost  = urgent.reduce((s, p) => s + p.estimated_cost, 0)
    const soonCost    = soon.reduce((s, p) => s + p.estimated_cost, 0)
    const monitorCost = monitor.reduce((s, p) => s + p.estimated_cost, 0)
    const annualCost  = yr12.reduce((s, p) => s + p.estimated_cost, 0)

    return { urgent, soon, monitor, yr12, urgentCost, soonCost, monitorCost, annualCost }
  }, [allPredictions])

  // ── Monthly budget forecast (12 months) ───────────────────────────────────────
  const monthlyBudget = useMemo(() => buildMonthlyBudget(allPredictions), [allPredictions])

  const avgMonthlyFleetBudget = useMemo(() => {
    if (!fleetMaster.length) return null
    const budgets = fleetMaster.map(f => f.monthly_tyre_budget).filter(v => v > 0)
    return budgets.length > 0 ? budgets.reduce((s, v) => s + v, 0) : null
  }, [fleetMaster])

  // ── Site breakdown ────────────────────────────────────────────────────────────
  const siteBreakdown = useMemo(() => {
    const annual = allPredictions.filter(p => p.days_away <= 365)
    const totalCost = annual.reduce((s, p) => s + p.estimated_cost, 0)
    return buildSiteBreakdown(annual, totalCost)
  }, [allPredictions])

  // ── Quarterly forecasts ───────────────────────────────────────────────────────
  const quarterlyForecast = useMemo(() => {
    const q1 = monthlyBudget.slice(0, 3).reduce((s, m) => s + m.cost, 0)
    const q2 = monthlyBudget.slice(3, 6).reduce((s, m) => s + m.cost, 0)
    const h2 = monthlyBudget.slice(6, 12).reduce((s, m) => s + m.cost, 0)
    const total = q1 + q2 + h2
    return { q1, q2, h2, total }
  }, [monthlyBudget])

  // ── Top urgent vehicles ───────────────────────────────────────────────────────
  const urgentVehicles = useMemo(() => {
    const byAsset = {}
    for (const p of allPredictions) {
      if (!byAsset[p.asset_no]) {
        byAsset[p.asset_no] = {
          asset_no: p.asset_no,
          site: p.site,
          vehicle_type: p.vehicle_type,
          urgent_count: 0,
          soon_count: 0,
          total_cost: 0,
          min_days: p.days_away,
        }
      }
      byAsset[p.asset_no].total_cost += p.estimated_cost
      if (p.urgency === 'Urgent') byAsset[p.asset_no].urgent_count++
      if (p.urgency === 'Soon')   byAsset[p.asset_no].soon_count++
      if (p.days_away < byAsset[p.asset_no].min_days) byAsset[p.asset_no].min_days = p.days_away
    }
    return Object.values(byAsset)
      .filter(v => v.urgent_count > 0 || v.min_days <= SOON_DAYS)
      .sort((a, b) => b.urgent_count - a.urgent_count || a.min_days - b.min_days)
      .slice(0, 10)
      .map(v => ({
        ...v,
        recommended_action: v.urgent_count >= 3
          ? 'Schedule immediate full set replacement'
          : v.urgent_count >= 1
            ? 'Urgent inspection + prioritise replacement'
            : 'Schedule within 90 days',
      }))
  }, [allPredictions])

  // ── Pagination ────────────────────────────────────────────────────────────────
  const totalPages = Math.max(1, Math.ceil(filteredPredictions.length / PAGE_SIZE))
  const pagedRows  = filteredPredictions.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  // Reset page when filters change
  useEffect(() => { setCurrentPage(1) }, [siteFilter, urgencyFilter, vehicleTypeFilter, horizonFilter])

  // ── Chart data ────────────────────────────────────────────────────────────────
  const lineChartData = useMemo(() => {
    const labels = monthlyBudget.map(m => m.label)
    const costs  = monthlyBudget.map(m => m.cost)
    const datasets = [
      {
        label: 'Forecast Spend',
        data: costs,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.12)',
        fill: true,
        tension: 0.4,
        pointBackgroundColor: '#3b82f6',
        pointRadius: 4,
      },
    ]
    if (avgMonthlyFleetBudget) {
      datasets.push({
        label: 'Monthly Budget',
        data: labels.map(() => avgMonthlyFleetBudget),
        borderColor: '#10b981',
        borderDash: [6, 4],
        backgroundColor: 'transparent',
        pointRadius: 0,
        tension: 0,
      })
    }
    return { labels, datasets }
  }, [monthlyBudget, avgMonthlyFleetBudget])

  const urgencyBarData = useMemo(() => {
    return {
      labels: ['Urgent (≤30d)', 'Soon (31-90d)', 'Monitor (91-365d)'],
      datasets: [{
        data: [kpis.urgent.length, kpis.soon.length, kpis.monitor.length],
        backgroundColor: ['rgba(239,68,68,0.7)', 'rgba(245,158,11,0.7)', 'rgba(16,185,129,0.5)'],
        borderColor: ['#ef4444', '#f59e0b', '#10b981'],
        borderWidth: 1,
        borderRadius: 4,
      }],
    }
  }, [kpis])

  // ── Export handlers ───────────────────────────────────────────────────────────
  const handleExcelExport = useCallback(() => {
    const rows = filteredPredictions.map(p => ({
      ...p,
      due_date: fmtDate(p.due_date),
      estimated_cost: `${activeCurrency} ${p.estimated_cost}`,
    }))
    exportToExcel(
      rows,
      ['asset_no','site','vehicle_type','position','brand','tread_depth','km_remaining','due_date','urgency','estimated_cost','days_away'],
      ['Asset No','Site','Vehicle Type','Position','Brand','Tread Depth (mm)','KM Remaining','Due Date','Urgency','Estimated Cost','Days Away'],
      `Predictive_Maintenance_${new Date().toISOString().slice(0,10)}`,
      'Upcoming Replacements',
    )
  }, [filteredPredictions, activeCurrency])

  const handlePdfExport = useCallback(() => {
    const rows = filteredPredictions.slice(0, 500).map(p => ({
      ...p,
      due_date: fmtDate(p.due_date),
      estimated_cost: `${activeCurrency} ${fmt(p.estimated_cost, 0)}`,
      tread_depth: p.tread_depth != null ? `${p.tread_depth} mm` : '—',
    }))
    exportToPdf(
      rows,
      [
        { key: 'asset_no',       header: 'Asset No' },
        { key: 'site',           header: 'Site' },
        { key: 'position',       header: 'Position' },
        { key: 'brand',          header: 'Brand' },
        { key: 'tread_depth',    header: 'Tread' },
        { key: 'km_remaining',   header: 'KM Remaining' },
        { key: 'due_date',       header: 'Due Date' },
        { key: 'urgency',        header: 'Urgency' },
        { key: 'estimated_cost', header: 'Est. Cost' },
        { key: 'days_away',      header: 'Days Away' },
      ],
      'Predictive Maintenance – Upcoming Tyre Replacements',
      `Predictive_Maintenance_${new Date().toISOString().slice(0,10)}`,
      'landscape',
    )
  }, [filteredPredictions, activeCurrency])

  // ── Render ────────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-400 text-sm">Loading predictive maintenance data…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="bg-gray-900 border border-red-800/50 rounded-xl p-8 max-w-md text-center space-y-3">
          <AlertTriangle className="text-red-400 mx-auto" size={32} />
          <p className="text-red-300 font-semibold">Failed to load data</p>
          <p className="text-gray-400 text-sm">{error}</p>
          <button onClick={loadData} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors">
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-4 md:p-6 space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-600/20 rounded-xl border border-blue-600/30">
            <CalendarClock className="text-blue-400" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Predictive Maintenance Engine</h1>
            <p className="text-xs text-gray-400 mt-0.5">AI-powered tyre replacement forecasting and budget planning · {fmtDate(TODAY)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {!fleetMasterAvailable && (
            <span className="text-xs text-amber-400 border border-amber-800/40 bg-amber-900/20 px-2 py-1 rounded-lg">
              Fleet master unavailable — using tyre records only
            </span>
          )}
          <button onClick={loadData} className="p-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors text-gray-300" title="Refresh">
            <RefreshCw size={16} />
          </button>
          <button onClick={handleExcelExport} className="flex items-center gap-2 px-3 py-2 bg-green-700/80 hover:bg-green-600/80 border border-green-700 rounded-lg text-sm transition-colors text-white font-medium">
            <Download size={15} />Excel
          </button>
          <button onClick={handlePdfExport} className="flex items-center gap-2 px-3 py-2 bg-blue-700/80 hover:bg-blue-600/80 border border-blue-700 rounded-lg text-sm transition-colors text-white font-medium">
            <FileText size={15} />PDF
          </button>
        </div>
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {allPredictions.length === 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center">
          <CalendarClock className="text-gray-600 mx-auto mb-3" size={40} />
          <p className="text-gray-300 font-semibold">No active tyre records found</p>
          <p className="text-gray-500 text-sm mt-1">Upload tyre fitment data to generate replacement forecasts</p>
        </div>
      )}

      {allPredictions.length > 0 && (
        <>
          {/* ── KPI Strip ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <KpiCard
              icon={AlertTriangle}
              label="Replacements due ≤30 days"
              value={`${fmt(kpis.urgent.length)} tyres`}
              sub={fmtCurrency(kpis.urgentCost, activeCurrency)}
              color="red"
            />
            <KpiCard
              icon={Clock}
              label="Replacements due 31–90 days"
              value={`${fmt(kpis.soon.length)} tyres`}
              sub={fmtCurrency(kpis.soonCost, activeCurrency)}
              color="amber"
            />
            <KpiCard
              icon={CheckCircle}
              label="Replacements due 91–365 days"
              value={`${fmt(kpis.monitor.length)} tyres`}
              sub={fmtCurrency(kpis.monitorCost, activeCurrency)}
              color="green"
            />
            <KpiCard
              icon={DollarSign}
              label="12-month budget forecast"
              value={fmtCurrency(kpis.annualCost, activeCurrency)}
              sub={`${fmt(kpis.yr12.length)} replacements`}
              color="blue"
            />
            <KpiCard
              icon={TrendingUp}
              label="Fleet avg tyre life"
              value={`${fmt(fleetStats.avgKmLife, 0)} km`}
              sub="based on completed records"
              color="purple"
            />
            <KpiCard
              icon={Truck}
              label="Fleet avg daily km / vehicle"
              value={`${fmt(fleetStats.avgDailyKm, 0)} km`}
              sub="estimated from records"
              color="cyan"
            />
          </div>

          {/* ── Filters ────────────────────────────────────────────────────── */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Filter size={14} className="text-gray-400" />
              <span className="text-sm font-medium text-gray-300">Filters</span>
            </div>
            <div className="flex flex-wrap gap-3">
              {/* Site */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Site</label>
                <select
                  value={siteFilter}
                  onChange={e => setSiteFilter(e.target.value)}
                  className="bg-gray-800 border border-gray-700 text-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                >
                  {uniqueSites.map(s => (
                    <option key={s} value={s}>{s === 'all' ? 'All Sites' : s}</option>
                  ))}
                </select>
              </div>

              {/* Urgency */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Urgency</label>
                <select
                  value={urgencyFilter}
                  onChange={e => setUrgencyFilter(e.target.value)}
                  className="bg-gray-800 border border-gray-700 text-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="all">All Urgencies</option>
                  <option value="Urgent">Urgent</option>
                  <option value="Soon">Soon</option>
                  <option value="Monitor">Monitor</option>
                </select>
              </div>

              {/* Vehicle type */}
              {uniqueVehicleTypes.length > 1 && (
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-gray-500">Vehicle Type</label>
                  <select
                    value={vehicleTypeFilter}
                    onChange={e => setVehicleTypeFilter(e.target.value)}
                    className="bg-gray-800 border border-gray-700 text-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
                  >
                    {uniqueVehicleTypes.map(t => (
                      <option key={t} value={t}>{t === 'all' ? 'All Types' : t}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Horizon */}
              <div className="flex flex-col gap-1">
                <label className="text-xs text-gray-500">Horizon</label>
                <div className="flex gap-1">
                  {['30d','90d','6mo','12mo'].map(h => (
                    <button
                      key={h}
                      onClick={() => setHorizonFilter(h)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
                        horizonFilter === h
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      {h}
                    </button>
                  ))}
                </div>
              </div>

              {/* Result count */}
              <div className="flex flex-col gap-1 ml-auto justify-end">
                <p className="text-xs text-gray-500 text-right">Showing</p>
                <p className="text-sm font-semibold text-gray-200 text-right">{fmt(filteredPredictions.length)} replacements</p>
              </div>
            </div>
          </div>

          {/* ── Charts row ──────────────────────────────────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {/* Budget forecast line chart */}
            <div className="xl:col-span-2 bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-white">12-Month Budget Forecast</h2>
                <p className="text-xs text-gray-500">Forecasted tyre replacement spend by month</p>
              </div>
              <div style={{ height: 240 }}>
                <Line data={lineChartData} options={lineOpts(activeCurrency)} />
              </div>
            </div>

            {/* Urgency bar chart */}
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="mb-3">
                <h2 className="text-sm font-semibold text-white">Replacement Urgency Distribution</h2>
                <p className="text-xs text-gray-500">Active tyres by urgency horizon</p>
              </div>
              <div style={{ height: 240 }}>
                <Bar data={urgencyBarData} options={barOpts(activeCurrency)} />
              </div>
            </div>
          </div>

          {/* ── Quarterly forecast cards ────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Q1 Forecast (Months 1–3)',  value: quarterlyForecast.q1,    color: 'from-blue-900/30 to-blue-800/10 border-blue-800/40' },
              { label: 'Q2 Forecast (Months 4–6)',  value: quarterlyForecast.q2,    color: 'from-purple-900/30 to-purple-800/10 border-purple-800/40' },
              { label: 'H2 Forecast (Months 7–12)', value: quarterlyForecast.h2,    color: 'from-cyan-900/30 to-cyan-800/10 border-cyan-800/40' },
              { label: 'Annual Total',               value: quarterlyForecast.total, color: 'from-green-900/30 to-green-800/10 border-green-800/40' },
            ].map(card => (
              <div key={card.label} className={`bg-gradient-to-br ${card.color} border rounded-xl p-4`}>
                <p className="text-xs text-gray-400">{card.label}</p>
                <p className="text-lg font-bold text-white mt-1">{fmtCurrency(card.value, activeCurrency)}</p>
              </div>
            ))}
          </div>

          {/* ── Upcoming Replacements Table ────────────────────────────────── */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-white">Upcoming Replacements Calendar</h2>
                <p className="text-xs text-gray-500">{fmt(filteredPredictions.length)} records · sorted by due date</p>
              </div>
            </div>

            {filteredPredictions.length === 0 ? (
              <div className="text-center py-10">
                <CheckCircle className="text-green-500 mx-auto mb-2" size={28} />
                <p className="text-gray-400 text-sm">No replacements due within selected horizon and filters</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-800">
                        {['Asset No','Site','Type','Position','Brand','Tread (mm)','KM Remaining','Due Date','Urgency','Est. Cost','Days Away'].map(h => (
                          <th key={h} className="text-left text-gray-500 font-medium py-2 px-2 whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pagedRows.map((p, i) => (
                        <tr
                          key={`${p.id}-${i}`}
                          className={`border-b border-gray-800/50 transition-colors ${
                            p.urgency === 'Urgent'
                              ? 'bg-red-900/10 hover:bg-red-900/20'
                              : p.urgency === 'Soon'
                                ? 'bg-amber-900/5 hover:bg-amber-900/15'
                                : 'hover:bg-gray-800/40'
                          }`}
                        >
                          <td className="py-2 px-2 font-mono font-semibold text-blue-300">{p.asset_no}</td>
                          <td className="py-2 px-2 text-gray-300">{p.site}</td>
                          <td className="py-2 px-2 text-gray-400">{p.vehicle_type}</td>
                          <td className="py-2 px-2 text-gray-300">{p.position}</td>
                          <td className="py-2 px-2 text-gray-300">{p.brand}</td>
                          <td className="py-2 px-2 text-center">
                            {p.tread_depth != null
                              ? <span className={`font-semibold ${p.tread_depth < URGENT_TREAD_MM ? 'text-red-400' : p.tread_depth < SOON_TREAD_MM ? 'text-amber-400' : 'text-green-400'}`}>{p.tread_depth}</span>
                              : <span className="text-gray-600">—</span>
                            }
                          </td>
                          <td className="py-2 px-2 text-right text-gray-300">{fmt(p.km_remaining)}</td>
                          <td className="py-2 px-2 text-gray-300 whitespace-nowrap">{fmtDate(p.due_date)}</td>
                          <td className="py-2 px-2"><UrgencyBadge urgency={p.urgency} /></td>
                          <td className="py-2 px-2 text-right font-semibold text-gray-200">{fmtCurrency(p.estimated_cost, activeCurrency)}</td>
                          <td className="py-2 px-2 text-right">
                            <span className={`font-semibold ${p.days_away <= 30 ? 'text-red-400' : p.days_away <= 90 ? 'text-amber-400' : 'text-gray-400'}`}>
                              {p.days_away}d
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-800">
                    <p className="text-xs text-gray-500">
                      Page {currentPage} of {totalPages} · {fmt(filteredPredictions.length)} total
                    </p>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="p-1.5 rounded bg-gray-800 border border-gray-700 text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronLeft size={14} />
                      </button>
                      {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                        let page
                        if (totalPages <= 7) {
                          page = i + 1
                        } else if (currentPage <= 4) {
                          page = i + 1
                          if (i === 6) page = totalPages
                        } else if (currentPage >= totalPages - 3) {
                          page = totalPages - 6 + i
                        } else {
                          const offsets = [-3, -2, -1, 0, 1, 2, 3]
                          page = currentPage + offsets[i]
                        }
                        return (
                          <button
                            key={page}
                            onClick={() => setCurrentPage(page)}
                            className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                              currentPage === page
                                ? 'bg-blue-600 border-blue-500 text-white'
                                : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:bg-gray-700'
                            }`}
                          >
                            {page}
                          </button>
                        )
                      })}
                      <button
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        className="p-1.5 rounded bg-gray-800 border border-gray-700 text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ── Site Breakdown Table ────────────────────────────────────────── */}
          {siteBreakdown.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-white">Site Breakdown — 12-Month Forecast</h2>
                <p className="text-xs text-gray-500">Replacement demand and budget allocation by site</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {['Site','Due ≤30d','Due ≤90d','Due ≤12mo','Forecast Cost','% of Budget'].map(h => (
                        <th key={h} className="text-left text-gray-500 font-medium py-2 px-3 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {siteBreakdown.map((s, i) => (
                      <tr key={s.site} className="border-b border-gray-800/40 hover:bg-gray-800/30 transition-colors">
                        <td className="py-2 px-3 font-semibold text-gray-200">{s.site}</td>
                        <td className="py-2 px-3 text-center">
                          <span className={`font-semibold ${s.due30 > 0 ? 'text-red-400' : 'text-gray-500'}`}>{s.due30}</span>
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span className={`font-semibold ${s.due90 > 0 ? 'text-amber-400' : 'text-gray-500'}`}>{s.due90}</span>
                        </td>
                        <td className="py-2 px-3 text-center text-gray-300">{s.due12mo}</td>
                        <td className="py-2 px-3 text-right font-semibold text-gray-200">{fmtCurrency(s.cost, activeCurrency)}</td>
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-800 rounded-full h-1.5">
                              <div
                                className="bg-blue-500 h-1.5 rounded-full"
                                style={{ width: `${Math.min(100, parseFloat(s.pct_budget))}%` }}
                              />
                            </div>
                            <span className="text-gray-400 w-10 text-right">{s.pct_budget}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Vehicles Needing Immediate Attention ───────────────────────── */}
          {urgentVehicles.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="text-red-400" size={16} />
                <div>
                  <h2 className="text-sm font-semibold text-white">Vehicles Needing Immediate Attention</h2>
                  <p className="text-xs text-gray-500">Top 10 vehicles with highest urgent replacement count</p>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {['#','Asset No','Site','Type','Urgent','Soon','Forecast Cost','Recommended Action'].map(h => (
                        <th key={h} className="text-left text-gray-500 font-medium py-2 px-2 whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {urgentVehicles.map((v, i) => (
                      <tr key={v.asset_no} className="border-b border-gray-800/40 hover:bg-gray-800/30 transition-colors">
                        <td className="py-2 px-2 text-gray-500">{i + 1}</td>
                        <td className="py-2 px-2 font-mono font-semibold text-blue-300">{v.asset_no}</td>
                        <td className="py-2 px-2 text-gray-300">{v.site}</td>
                        <td className="py-2 px-2 text-gray-400">{v.vehicle_type}</td>
                        <td className="py-2 px-2 text-center">
                          {v.urgent_count > 0
                            ? <span className="px-1.5 py-0.5 bg-red-900/40 text-red-300 rounded font-bold">{v.urgent_count}</span>
                            : <span className="text-gray-600">0</span>
                          }
                        </td>
                        <td className="py-2 px-2 text-center">
                          {v.soon_count > 0
                            ? <span className="px-1.5 py-0.5 bg-amber-900/40 text-amber-300 rounded font-bold">{v.soon_count}</span>
                            : <span className="text-gray-600">0</span>
                          }
                        </td>
                        <td className="py-2 px-2 text-right font-semibold text-gray-200">{fmtCurrency(v.total_cost, activeCurrency)}</td>
                        <td className="py-2 px-2 text-gray-400 italic">{v.recommended_action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Assumptions & Methodology ───────────────────────────────────── */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
            <button
              onClick={() => setAssumptionsOpen(o => !o)}
              className="w-full flex items-center justify-between p-4 hover:bg-gray-800/40 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Info className="text-blue-400" size={16} />
                <span className="text-sm font-medium text-gray-300">Prediction Model Assumptions & Methodology</span>
              </div>
              {assumptionsOpen ? <ChevronUp size={16} className="text-gray-500" /> : <ChevronDown size={16} className="text-gray-500" />}
            </button>
            {assumptionsOpen && (
              <div className="px-4 pb-4 border-t border-gray-800">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  {[
                    {
                      title: 'Average Tyre Life',
                      body: `Computed per vehicle from completed tyre records (km_at_removal − km_at_fitment). If insufficient history, falls back to fleet average (${fmt(fleetStats.avgKmLife, 0)} km) or ${fmt(DEFAULT_AVG_KM, 0)} km default.`,
                    },
                    {
                      title: 'Average Daily KM',
                      body: `Estimated from each vehicle's odometer span divided by service days. Default fallback: ${fmt(DEFAULT_DAILY_KM, 0)} km/day. Fleet master current_km used when available.`,
                    },
                    {
                      title: 'Replacement Due Date',
                      body: 'Predicted as: today + (remaining_km / avg_daily_km). Remaining KM = avg_km_life − km_run_since_fitment.',
                    },
                    {
                      title: 'Urgency Classification',
                      body: `Tread depth < ${URGENT_TREAD_MM}mm OR due in ≤${URGENT_DAYS} days → Urgent. Due in ${URGENT_DAYS + 1}–${SOON_DAYS} days → Soon. Otherwise → Monitor.`,
                    },
                    {
                      title: 'Cost Estimation',
                      body: `Uses last known cost_per_tyre for the tyre. If unavailable, uses vehicle average cost. Final fallback: fleet average (${fmtCurrency(fleetStats.avgCost, activeCurrency)}).`,
                    },
                    {
                      title: 'Fleet Master',
                      body: fleetMasterAvailable
                        ? 'vehicle_fleet table loaded successfully. Expected KM per tyre and monthly budget targets used where available.'
                        : 'vehicle_fleet table not available. Predictions are based on tyre_records history only.',
                    },
                  ].map(item => (
                    <div key={item.title} className="bg-gray-800/40 rounded-lg p-3">
                      <p className="text-xs font-semibold text-blue-300 mb-1">{item.title}</p>
                      <p className="text-xs text-gray-400 leading-relaxed">{item.body}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-gray-600 mt-3">
                  All forecasts are statistical estimates based on historical patterns. Actual replacement dates may vary due to road conditions, load factors, driver behaviour, and maintenance quality.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
