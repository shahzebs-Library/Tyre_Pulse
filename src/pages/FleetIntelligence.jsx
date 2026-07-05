import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import {
  Truck, Download, FileText, AlertTriangle, CheckCircle,
  TrendingUp, TrendingDown, DollarSign, Clock, Activity,
  Filter, RefreshCw, ChevronLeft, ChevronRight, ChevronUp,
  ChevronDown, ExternalLink, Award, Zap, Target, BarChart2,
  Shield, Search, Mail,
} from 'lucide-react'
import EmailReportModal from '../components/EmailReportModal'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { applyCountry } from '../lib/countryFilter'
import PageHeader from '../components/ui/PageHeader'
import PeriodFilter, { filterByPeriodValue, periodLabel } from '../components/ui/PeriodFilter'
import {
  computeFleetAvailability,
  computeVehicleDowntimeImpact,
  computeReplacementRate,
  computeCostTrend,
  computeAllKpis,
} from '../lib/kpiEngine'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { useSettings } from '../contexts/SettingsContext'
import { formatDate, formatMonthYear } from '../lib/formatters'
import { useLanguage } from '../contexts/LanguageContext'

// ── Chart.js global registration ─────────────────────────────────────────────
ChartJS.register(
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

// ── Constants ─────────────────────────────────────────────────────────────────
const PAGE_SIZE = 25
const HOURS_PER_CHANGE = 2

const CHART_THEME = {
  textColor: '#9ca3af',
  gridcolor:'var(--text-muted)',
  tooltipBg: '#111827',
  tooltipBorder: '#374151',
  tooltipTitle: '#f9fafb',
  tooltipBody: '#9ca3af',
}

// ── Formatters ────────────────────────────────────────────────────────────────
function fmt(n, dec = 0) {
  if (n == null || isNaN(n)) return '-'
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: dec,
    maximumFractionDigits: dec,
  })
}

function fmtCurrency(n, currency) {
  if (n == null || isNaN(n)) return '-'
  if (n >= 1_000_000) return `${currency} ${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${currency} ${(n / 1_000).toFixed(0)}K`
  return `${currency} ${fmt(n, 0)}`
}

function fmtDate(d) {
  return formatDate(d)
}

function fmtCpk(n, dec = 4) {
  if (n == null || isNaN(n) || !isFinite(n)) return '-'
  return Number(n).toFixed(dec)
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function monthKey(date) {
  const d = typeof date === 'string' ? new Date(date) : date
  if (!d || isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key) {
  if (!key) return ''
  const [y, m] = key.split('-')
  return formatMonthYear(new Date(Number(y), Number(m) - 1, 1))
}

function getLast12MonthKeys(anchor = new Date()) {
  const keys = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(anchor.getFullYear(), anchor.getMonth() - i, 1)
    keys.push(monthKey(d))
  }
  return keys
}

// Data-anchored window: latest issue_date in the (period-filtered) records,
// so historic selections still render populated monthly charts.
function dataAnchorDate(records) {
  let max = null
  for (const r of records) {
    if (!r?.issue_date) continue
    const iso = String(r.issue_date).slice(0, 10)
    if (!max || iso > max) max = iso
  }
  const d = max ? new Date(max) : new Date()
  return isNaN(d.getTime()) ? new Date() : d
}

// ── Linear regression ─────────────────────────────────────────────────────────
function linearRegression(points) {
  const n = points.length
  if (n < 2) return { slope: 0, intercept: 0 }
  const sumX  = points.reduce((s, p) => s + p.x, 0)
  const sumY  = points.reduce((s, p) => s + p.y, 0)
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0)
  const sumX2 = points.reduce((s, p) => s + p.x ** 2, 0)
  const denom = n * sumX2 - sumX ** 2
  if (denom === 0) return { slope: 0, intercept: sumY / n }
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

// ── Chart options factories ───────────────────────────────────────────────────
function makeLineOpts(currency, yLabel = '') {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: CHART_THEME.textColor, font: { size: 11 }, boxWidth: 12 },
      },
      tooltip: {
        backgroundColor: CHART_THEME.tooltipBg,
        borderColor: CHART_THEME.tooltipBorder,
        borderWidth: 1,
        titleColor: CHART_THEME.tooltipTitle,
        bodyColor: CHART_THEME.tooltipBody,
        callbacks: {
          label: ctx => {
            const v = ctx.raw
            if (yLabel === 'pct') return ` ${Number(v).toFixed(1)}%`
            if (yLabel === 'cost') return ` ${currency} ${fmt(v, 0)}`
            return ` ${fmt(v, 0)}`
          },
        },
      },
    },
    scales: {
      x: {
        grid: { color: CHART_THEME.gridColor },
        ticks: { color: CHART_THEME.textColor, font: { size: 10 } },
      },
      y: {
        grid: { color: CHART_THEME.gridColor },
        ticks: {
          color: CHART_THEME.textColor,
          font: { size: 10 },
          callback: v => {
            if (yLabel === 'pct') return `${v}%`
            if (yLabel === 'cost') return fmtCurrency(v, currency)
            return fmt(v, 0)
          },
        },
        beginAtZero: true,
        max: yLabel === 'pct' ? 100 : undefined,
      },
    },
  }
}

function makeBarOpts(currency, yLabel = '') {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: { color: CHART_THEME.textColor, font: { size: 11 }, boxWidth: 12 },
      },
      tooltip: {
        backgroundColor: CHART_THEME.tooltipBg,
        borderColor: CHART_THEME.tooltipBorder,
        borderWidth: 1,
        titleColor: CHART_THEME.tooltipTitle,
        bodyColor: CHART_THEME.tooltipBody,
        callbacks: {
          label: ctx => {
            if (yLabel === 'cost') return ` ${currency} ${fmt(ctx.raw, 0)}`
            return ` ${fmt(ctx.raw, 0)}`
          },
        },
      },
    },
    scales: {
      x: {
        stacked: yLabel === 'stacked',
        grid: { color: CHART_THEME.gridColor },
        ticks: {
          color: CHART_THEME.textColor,
          font: { size: 9 },
          maxRotation: 45,
        },
      },
      y: {
        stacked: yLabel === 'stacked',
        grid: { color: CHART_THEME.gridColor },
        ticks: {
          color: CHART_THEME.textColor,
          font: { size: 10 },
          callback: v => yLabel === 'cost' || yLabel === 'stacked' ? fmtCurrency(v, currency) : fmt(v, 0),
        },
        beginAtZero: true,
      },
    },
  }
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, color = 'blue', loading, trend }) {
  const colorMap = {
    red:    { wrap: 'bg-red-900/20 border-red-800/40',    icon: 'text-red-400',    val: 'text-red-300' },
    amber:  { wrap: 'bg-amber-900/20 border-amber-800/40', icon: 'text-amber-400',  val: 'text-amber-300' },
    green:  { wrap: 'bg-green-900/20 border-green-800/40', icon: 'text-green-400',  val: 'text-green-300' },
    blue:   { wrap: 'bg-blue-900/20 border-blue-800/40',  icon: 'text-blue-400',   val: 'text-blue-300' },
    purple: { wrap: 'bg-purple-900/20 border-purple-800/40', icon: 'text-purple-400', val: 'text-purple-300' },
    cyan:   { wrap: 'bg-cyan-900/20 border-cyan-800/40',  icon: 'text-cyan-400',   val: 'text-cyan-300' },
  }
  const c = colorMap[color] || colorMap.blue
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className={`border rounded-xl p-4 flex gap-3 items-start ${c.wrap}`}
    >
      <div className={`mt-0.5 shrink-0 ${c.icon}`}>
        <Icon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-gray-400 leading-tight">{label}</p>
        {loading
          ? <div className="h-6 w-24 skeleton rounded mt-1" />
          : <p className={`text-lg font-bold leading-tight mt-0.5 ${c.val}`}>{value}</p>
        }
        {sub && !loading && (
          <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
            {trend === 'up' && <TrendingUp size={10} className="text-red-400" />}
            {trend === 'down' && <TrendingDown size={10} className="text-green-400" />}
            {sub}
          </p>
        )}
      </div>
    </motion.div>
  )
}

// ── Availability Status Badge ─────────────────────────────────────────────────
function AvailBadge({ status }) {
  const { t } = useLanguage()
  if (status === 'Critical')
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-900/40 text-red-300 border border-red-800/50">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />{t('fleetintel.avail.critical')}
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-900/20 text-green-400 border border-green-800/40">
      <span className="w-1.5 h-1.5 rounded-full bg-green-500" />{t('fleetintel.avail.available')}
    </span>
  )
}

// ── Sortable Column Header ─────────────────────────────────────────────────────
function SortTh({ col, label, sortCol, sortDir, onSort, className = '' }) {
  const active = sortCol === col
  return (
    <th
      onClick={() => onSort(col)}
      className={`text-left text-gray-500 font-semibold py-2 px-2 whitespace-nowrap cursor-pointer select-none hover:text-gray-300 transition-colors text-xs uppercase tracking-wide ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active
          ? sortDir === 'asc'
            ? <ChevronUp size={11} className="text-blue-400" />
            : <ChevronDown size={11} className="text-blue-400" />
          : <ChevronDown size={11} className="opacity-0 group-hover:opacity-40" />
        }
      </span>
    </th>
  )
}

// ── Pagination ────────────────────────────────────────────────────────────────
function Pagination({ page, totalPages, onChange }) {
  const { t } = useLanguage()
  if (totalPages <= 1) return null
  const pages = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else if (page <= 4) {
    pages.push(1, 2, 3, 4, 5, '...', totalPages)
  } else if (page >= totalPages - 3) {
    pages.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages)
  } else {
    pages.push(1, '...', page - 1, page, page + 1, '...', totalPages)
  }
  return (
    <div className="flex items-center justify-between pt-3 border-t border-gray-800 mt-3">
      <p className="text-xs text-gray-500">{t('fleetintel.register.page', { page, totalPages })}</p>
      <div className="flex gap-1">
        <button
          onClick={() => onChange(Math.max(1, page - 1))}
          disabled={page === 1}
          className="p-1.5 rounded bg-gray-800 border border-gray-700 text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft size={13} />
        </button>
        {pages.map((p, i) =>
          p === '...'
            ? <span key={`e-${i}`} className="px-2 py-1 text-gray-600 text-xs">...</span>
            : (
              <button
                key={p}
                onClick={() => onChange(p)}
                className={`px-2.5 py-1 rounded text-xs border transition-colors ${
                  page === p
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                {p}
              </button>
            )
        )}
        <button
          onClick={() => onChange(Math.min(totalPages, page + 1))}
          disabled={page === totalPages}
          className="p-1.5 rounded bg-gray-800 border border-gray-700 text-gray-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRight size={13} />
        </button>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// Main Component
// ══════════════════════════════════════════════════════════════════════════════
export default function FleetIntelligence() {
  const { t } = useLanguage()
  const { activeCurrency, activeCountry } = useSettings()

  // ── State ─────────────────────────────────────────────────────────────────
  const [records, setRecords]         = useState([])
  const [fleetMaster, setFleetMaster] = useState([])
  const [inspections, setInspections] = useState([])
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [fleetMasterAvail, setFleetMasterAvail] = useState(true)

  const [period, setPeriod]           = useState({ mode: 'all' })
  const [emailModalOpen, setEmailModalOpen] = useState(false)
  const [siteFilter, setSiteFilter]   = useState('all')
  const [typeFilter, setTypeFilter]   = useState('all')
  const [availFilter, setAvailFilter] = useState('all')
  const [searchAsset, setSearchAsset] = useState('')
  const [sortCol, setSortCol]         = useState('total_cost')
  const [sortDir, setSortDir]         = useState('desc')
  const [page, setPage]               = useState(1)

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: tyreData, error: tyreErr } = await fetchAllPages((from, to) => applyCountry(supabase
        .from('tyre_records')
        .select('id,asset_no,site,brand,position,risk_level,category,km_at_fitment,km_at_removal,cost_per_tyre,issue_date,tread_depth')
        .order('issue_date', { ascending: false }), activeCountry)
        .range(from, to))

      if (tyreErr) throw tyreErr
      setRecords(tyreData || [])

      // Fleet master - graceful
      try {
        const { data: fleetData, error: fleetErr } = await applyCountry(supabase
          .from('vehicle_fleet')
          .select('asset_no,site,vehicle_type,current_km,expected_km_per_tyre,monthly_tyre_budget,registration_date'), activeCountry)
        if (fleetErr) {
          setFleetMaster([])
          setFleetMasterAvail(false)
        } else {
          setFleetMaster(fleetData || [])
          setFleetMasterAvail(true)
        }
      } catch {
        setFleetMaster([])
        setFleetMasterAvail(false)
      }

      // Inspections - graceful
      try {
        const { data: inspData } = await fetchAllPages((from, to) => applyCountry(supabase
          .from('inspections')
          .select('asset_no,site,status,scheduled_date,completed_date'), activeCountry)
          .range(from, to))
        setInspections(inspData || [])
      } catch {
        setInspections([])
      }
    } catch (err) {
      setError(err.message || 'Failed to load fleet intelligence data')
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { loadData() }, [loadData])

  // ── Period-filtered records (top of the derived-data chain) ──────────────
  const periodRecords = useMemo(
    () => filterByPeriodValue(records, period, 'issue_date'),
    [records, period]
  )

  // ── Unique sites & vehicle types ──────────────────────────────────────────
  const allSites = useMemo(() => {
    const s = new Set(records.map(r => r.site).filter(Boolean))
    return ['all', ...Array.from(s).sort()]
  }, [records])

  const allVehicleTypes = useMemo(() => {
    const t = new Set(fleetMaster.map(f => f.vehicle_type).filter(Boolean))
    return ['all', ...Array.from(t).sort()]
  }, [fleetMaster])

  // ── Fleet master lookup map ───────────────────────────────────────────────
  const fleetMasterMap = useMemo(() => {
    const m = {}
    for (const f of fleetMaster) {
      if (f.asset_no) m[f.asset_no] = f
    }
    return m
  }, [fleetMaster])

  // ── Per-vehicle metrics (period-filtered) ─────────────────────────────────
  const vehicleMetrics = useMemo(() => {
    const byAsset = {}
    for (const r of periodRecords) {
      if (!r.asset_no) continue
      if (!byAsset[r.asset_no]) byAsset[r.asset_no] = []
      byAsset[r.asset_no].push(r)
    }

    return Object.entries(byAsset).map(([asset_no, recs]) => {
      const master = fleetMasterMap[asset_no] || null

      const total_tyre_changes = recs.length
      const total_tyre_cost = recs.reduce((s, r) => s + (Number(r.cost_per_tyre) || 0) * (Number(r.qty) || 1), 0)

      // CPK - only valid records
      const validRecs = recs.filter(r => {
        const fit = Number(r.km_at_fitment)
        const rem = Number(r.km_at_removal)
        const cost = Number(r.cost_per_tyre)
        return isFinite(fit) && fit > 0 && isFinite(rem) && rem > fit && isFinite(cost) && cost > 0
      })
      const cpks = validRecs.map(r => Number(r.cost_per_tyre) / (Number(r.km_at_removal) - Number(r.km_at_fitment)))
      const avg_cpk = cpks.length > 0 ? cpks.reduce((s, v) => s + v, 0) / cpks.length : null

      // KM life
      const kmLives = validRecs.map(r => Number(r.km_at_removal) - Number(r.km_at_fitment)).filter(v => v > 0)
      const avg_km_per_tyre = kmLives.length > 0 ? kmLives.reduce((s, v) => s + v, 0) / kmLives.length : null

      // High/Critical risk
      const high_risk_count = recs.filter(r => r.risk_level === 'High' || r.risk_level === 'Critical').length

      // Downtime
      const downtime_hours = total_tyre_changes * HOURS_PER_CHANGE

      // Last change date
      const dates = recs.map(r => r.issue_date).filter(Boolean).sort()
      const last_change_date = dates.length > 0 ? dates[dates.length - 1] : null
      const first_change_date = dates.length > 0 ? dates[0] : null

      // Monthly cost
      let monthly_cost = 0
      if (first_change_date && last_change_date && first_change_date !== last_change_date) {
        const months = Math.max(
          1,
          (new Date(last_change_date) - new Date(first_change_date)) / (1000 * 60 * 60 * 24 * 30.44)
        )
        monthly_cost = total_tyre_cost / months
      } else {
        monthly_cost = total_tyre_cost
      }

      // Availability - critical in last 30d
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      const recentCritical = recs.some(r => {
        if (r.risk_level !== 'Critical' && r.risk_level !== 'High') return false
        if (!r.issue_date) return false
        return new Date(r.issue_date) >= thirtyDaysAgo
      })
      const availability_status = recentCritical ? 'Critical' : 'Available'

      return {
        asset_no,
        site: master?.site || recs[0]?.site || '-',
        vehicle_type: master?.vehicle_type || '-',
        total_tyre_changes,
        total_tyre_cost,
        avg_cpk,
        high_risk_count,
        downtime_hours,
        last_change_date,
        avg_km_per_tyre,
        monthly_cost,
        availability_status,
      }
    })
  }, [periodRecords, fleetMasterMap])

  // ── Fleet aggregates ──────────────────────────────────────────────────────
  const fleetAggs = useMemo(() => {
    const fleet_size = vehicleMetrics.length || 1
    const available_count = vehicleMetrics.filter(v => v.availability_status === 'Available').length
    const availability_pct = (available_count / fleet_size) * 100
    const total_downtime_hours = vehicleMetrics.reduce((s, v) => s + v.downtime_hours, 0)
    const total_fleet_cost = vehicleMetrics.reduce((s, v) => s + v.total_tyre_cost, 0)

    // Months span
    const allDates = periodRecords.map(r => r.issue_date).filter(Boolean).sort()
    const monthsSpan = allDates.length >= 2
      ? Math.max(1, (new Date(allDates[allDates.length - 1]) - new Date(allDates[0])) / (1000 * 60 * 60 * 24 * 30.44))
      : 1
    const monthly_fleet_cost = total_fleet_cost / monthsSpan
    const avg_cost_per_vehicle = total_fleet_cost / fleet_size

    const withCpk = vehicleMetrics.filter(v => v.avg_cpk != null && isFinite(v.avg_cpk))
    const sorted = [...withCpk].sort((a, b) => b.avg_cpk - a.avg_cpk)
    const worst_vehicle_cpk = sorted[0] || null
    const bestCandidates = withCpk.filter(v => v.total_tyre_changes >= 5)
    const bestSorted = [...bestCandidates].sort((a, b) => a.avg_cpk - b.avg_cpk)
    const best_vehicle_cpk = bestSorted[0] || null

    const fleetAvgCpk = withCpk.length > 0
      ? withCpk.reduce((s, v) => s + v.avg_cpk, 0) / withCpk.length
      : null

    return {
      fleet_size,
      available_count,
      availability_pct,
      total_downtime_hours,
      total_fleet_cost,
      monthly_fleet_cost,
      avg_cost_per_vehicle,
      worst_vehicle_cpk,
      best_vehicle_cpk,
      fleetAvgCpk,
    }
  }, [vehicleMetrics, periodRecords])

  // ── Availability timeline - last 12 months (anchored to filtered data) ────
  const availabilityTimeline = useMemo(() => {
    const keys = getLast12MonthKeys(dataAnchorDate(periodRecords))
    return keys.map(mk => {
      if (!mk) return { month: mk, label: '', pct: 0 }
      const [y, m] = mk.split('-').map(Number)
      const start = new Date(y, m - 1, 1)
      const end = new Date(y, m, 0, 23, 59, 59)

      const monthRecords = periodRecords.filter(r => {
        if (!r.issue_date) return false
        const d = new Date(r.issue_date)
        return d >= start && d <= end
      })

      // Unique assets that month
      const assetsThisMonth = new Set(monthRecords.map(r => r.asset_no).filter(Boolean))
      const criticalAssets = new Set(
        monthRecords
          .filter(r => r.risk_level === 'Critical' || r.risk_level === 'High')
          .map(r => r.asset_no)
          .filter(Boolean)
      )
      const totalAssets = Math.max(assetsThisMonth.size, 1)
      const unavailable = criticalAssets.size
      const pct = ((totalAssets - unavailable) / totalAssets) * 100

      return {
        month: mk,
        label: monthLabel(mk),
        pct: Math.max(0, Math.min(100, pct)),
      }
    })
  }, [periodRecords])

  // ── Downtime impact - top 15 vehicles ────────────────────────────────────
  const downtimeTop15 = useMemo(() => {
    return [...vehicleMetrics]
      .sort((a, b) => b.downtime_hours - a.downtime_hours)
      .slice(0, 15)
  }, [vehicleMetrics])

  // ── Cost by site ──────────────────────────────────────────────────────────
  const costBySite = useMemo(() => {
    const siteMap = {}
    for (const r of periodRecords) {
      const site = r.site || 'Unknown'
      if (!siteMap[site]) siteMap[site] = {}
      const vtype = fleetMasterMap[r.asset_no]?.vehicle_type || 'Unknown'
      siteMap[site][vtype] = (siteMap[site][vtype] || 0) + (Number(r.cost_per_tyre) || 0) * (Number(r.qty) || 1)
    }

    const sites = Object.entries(siteMap)
      .map(([site, byType]) => ({
        site,
        total: Object.values(byType).reduce((s, v) => s + v, 0),
        byType,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 12)

    // Unique vehicle types
    const vtypes = [...new Set(
      sites.flatMap(s => Object.keys(s.byType))
    )].filter(t => t !== 'Unknown').concat(
      sites.some(s => 'Unknown' in s.byType) ? ['Unknown'] : []
    )

    return { sites, vtypes }
  }, [periodRecords, fleetMasterMap])

  // ── Cost trend - last 13 months with regression (anchored to data) ────────
  const costTrendData = useMemo(() => {
    const now = dataAnchorDate(periodRecords)
    const start = new Date(now.getFullYear(), now.getMonth() - 12, 1)
    const keys = []
    for (let i = 12; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      keys.push({ key: monthKey(d), label: monthLabel(monthKey(d)) })
    }

    const monthMap = {}
    for (const r of periodRecords) {
      if (!r.issue_date) continue
      const d = new Date(r.issue_date)
      if (d < start) continue
      const mk = monthKey(d)
      monthMap[mk] = (monthMap[mk] || 0) + (Number(r.cost_per_tyre) || 0) * (Number(r.qty) || 1)
    }

    const dataPoints = keys.map(({ key, label }) => ({
      key,
      label,
      cost: monthMap[key] || 0,
    }))

    const points = dataPoints.map((d, i) => ({ x: i, y: d.cost }))
    const { slope, intercept } = linearRegression(points)
    const forecastCost = Math.max(0, intercept + slope * dataPoints.length)

    const forecastLabel = formatMonthYear(new Date(now.getFullYear(), now.getMonth() + 1, 1))

    const regressionLine = dataPoints.map((_, i) => Math.max(0, intercept + slope * i))

    return {
      labels: [...dataPoints.map(d => d.label), `${forecastLabel} ▶`],
      actual: [...dataPoints.map(d => d.cost), null],
      regression: [...regressionLine, forecastCost],
      forecastCost,
      slope,
    }
  }, [periodRecords])

  // ── Filtered + sorted vehicle register ───────────────────────────────────
  const filteredRegister = useMemo(() => {
    let list = vehicleMetrics.filter(v => {
      if (siteFilter !== 'all' && v.site !== siteFilter) return false
      if (typeFilter !== 'all' && v.vehicle_type !== typeFilter) return false
      if (availFilter === 'Available' && v.availability_status !== 'Available') return false
      if (availFilter === 'Critical' && v.availability_status !== 'Critical') return false
      if (searchAsset && !v.asset_no.toLowerCase().includes(searchAsset.toLowerCase())) return false
      return true
    })

    list = [...list].sort((a, b) => {
      let av = a[sortCol], bv = b[sortCol]
      if (av == null) av = sortDir === 'asc' ? Infinity : -Infinity
      if (bv == null) bv = sortDir === 'asc' ? Infinity : -Infinity
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sortDir === 'asc' ? av - bv : bv - av
    })

    return list
  }, [vehicleMetrics, siteFilter, typeFilter, availFilter, searchAsset, sortCol, sortDir])

  const totalPages = Math.max(1, Math.ceil(filteredRegister.length / PAGE_SIZE))
  const pagedRows = filteredRegister.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => { setPage(1) }, [siteFilter, typeFilter, availFilter, searchAsset, sortCol, sortDir])

  // ── Vehicles needing attention ────────────────────────────────────────────
  const attentionVehicles = useMemo(() => {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    // Gather latest critical/high risk per vehicle
    const byAsset = {}
    for (const r of periodRecords) {
      if (!r.asset_no) continue
      if (r.risk_level !== 'Critical' && r.risk_level !== 'High') continue
      if (!r.issue_date || new Date(r.issue_date) < thirtyDaysAgo) continue
      if (!byAsset[r.asset_no]) byAsset[r.asset_no] = []
      byAsset[r.asset_no].push(r)
    }

    return Object.entries(byAsset)
      .map(([asset_no, recs]) => {
        const latest = recs.sort((a, b) => new Date(b.issue_date) - new Date(a.issue_date))[0]
        return {
          asset_no,
          site: latest.site || '-',
          risk_level: latest.risk_level,
          issue_date: latest.issue_date,
          position: latest.position || '-',
          brand: latest.brand || '-',
          count: recs.length,
        }
      })
      .sort((a, b) => {
        const order = { Critical: 0, High: 1 }
        return (order[a.risk_level] ?? 2) - (order[b.risk_level] ?? 2)
      })
  }, [periodRecords])

  // ── Fleet efficiency benchmarks ───────────────────────────────────────────
  const benchmarks = useMemo(() => {
    const { worst_vehicle_cpk, best_vehicle_cpk, fleetAvgCpk } = fleetAggs
    const withCpk = vehicleMetrics.filter(v => v.avg_cpk != null && isFinite(v.avg_cpk))
    const n = withCpk.length

    // Worst 10%: top-CPK vehicles
    const sorted = [...withCpk].sort((a, b) => b.avg_cpk - a.avg_cpk)
    const worst10pct = sorted.slice(0, Math.max(1, Math.ceil(n * 0.1)))

    let annualSavings = 0
    if (fleetAvgCpk != null) {
      // If worst10% matched fleet avg CPK, what would saving be?
      for (const v of worst10pct) {
        const monthlyKm = v.avg_km_per_tyre ? v.avg_km_per_tyre * (12 / 12) : 80000
        const currentAnnualCost = v.monthly_cost * 12
        const improvedAnnualCost = fleetAvgCpk * monthlyKm * (v.total_tyre_changes / Math.max(1, worst10pct.length))
        annualSavings += Math.max(0, currentAnnualCost - improvedAnnualCost)
      }
    }

    return {
      worst: worst_vehicle_cpk,
      best: best_vehicle_cpk,
      annualSavings,
      fleetAvgCpk,
    }
  }, [fleetAggs, vehicleMetrics])

  // ── Sort handler ──────────────────────────────────────────────────────────
  const handleSort = useCallback((col) => {
    setSortCol(prev => {
      if (prev === col) {
        setSortDir(d => d === 'asc' ? 'desc' : 'asc')
        return col
      }
      setSortDir('desc')
      return col
    })
  }, [])

  // ── Export handlers ───────────────────────────────────────────────────────
  const handleExcelExport = useCallback(() => {
    const rows = filteredRegister.map(v => ({
      ...v,
      last_change_date: fmtDate(v.last_change_date),
      total_tyre_cost: `${activeCurrency} ${fmt(v.total_tyre_cost, 0)}`,
      monthly_cost: `${activeCurrency} ${fmt(v.monthly_cost, 0)}`,
      avg_cpk: fmtCpk(v.avg_cpk),
      avg_km_per_tyre: v.avg_km_per_tyre ? fmt(v.avg_km_per_tyre, 0) : '-',
    }))
    exportToExcel(
      rows,
      ['asset_no','site','vehicle_type','total_tyre_changes','total_tyre_cost','avg_cpk','high_risk_count','availability_status','monthly_cost','avg_km_per_tyre','downtime_hours','last_change_date'],
      ['Asset No','Site','Vehicle Type','Total Changes','Total Cost','Avg CPK','High Risk Count','Availability','Monthly Cost','Avg KM/Tyre','Downtime Hrs','Last Change'],
      `Fleet_Intelligence_${new Date().toISOString().slice(0, 10)}`,
      'Fleet Asset Register',
    )
  }, [filteredRegister, activeCurrency])

  const handlePdfExport = useCallback(() => {
    const rows = vehicleMetrics
      .sort((a, b) => b.total_tyre_cost - a.total_tyre_cost)
      .slice(0, 20)
      .map(v => ({
        ...v,
        total_tyre_cost: `${activeCurrency} ${fmt(v.total_tyre_cost, 0)}`,
        avg_cpk: fmtCpk(v.avg_cpk),
        last_change_date: fmtDate(v.last_change_date),
      }))
    exportToPdf(
      rows,
      [
        { key: 'asset_no',           header: 'Asset No' },
        { key: 'site',               header: 'Site' },
        { key: 'vehicle_type',       header: 'Type' },
        { key: 'total_tyre_changes', header: 'Changes' },
        { key: 'total_tyre_cost',    header: 'Total Cost' },
        { key: 'avg_cpk',            header: 'Avg CPK' },
        { key: 'high_risk_count',    header: 'High Risk' },
        { key: 'availability_status',header: 'Status' },
        { key: 'downtime_hours',     header: 'Downtime Hrs' },
        { key: 'last_change_date',   header: 'Last Change' },
      ],
      'Fleet Management Intelligence - Top 20 Vehicles by Cost',
      `Fleet_Intelligence_PDF_${new Date().toISOString().slice(0, 10)}`,
      'landscape',
    )
  }, [vehicleMetrics, activeCurrency])

  // ── Chart datasets ────────────────────────────────────────────────────────
  const availabilityChartData = useMemo(() => ({
    labels: availabilityTimeline.map(d => d.label),
    datasets: [
      {
        label: t('fleetintel.availability.seriesLabel'),
        data: availabilityTimeline.map(d => d.pct),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.12)',
        fill: true,
        tension: 0.4,
        pointBackgroundColor: availabilityTimeline.map(d =>
          d.pct < 90 ? '#ef4444' : d.pct < 95 ? '#f59e0b' : '#3b82f6'
        ),
        pointRadius: 5,
      },
      {
        label: t('fleetintel.availability.targetSeriesLabel'),
        data: availabilityTimeline.map(() => 95),
        borderColor: 'rgba(16,185,129,0.7)',
        borderDash: [6, 4],
        borderWidth: 1.5,
        backgroundColor: 'transparent',
        pointRadius: 0,
        tension: 0,
      },
    ],
  }), [availabilityTimeline, t])

  const downtimeChartData = useMemo(() => ({
    labels: downtimeTop15.map(v => v.asset_no),
    datasets: [{
      label: t('fleetintel.downtime.seriesLabel'),
      data: downtimeTop15.map(v => v.downtime_hours),
      backgroundColor: downtimeTop15.map(v =>
        v.downtime_hours > 20 ? 'rgba(239,68,68,0.7)' : 'rgba(59,130,246,0.6)'
      ),
      borderColor: downtimeTop15.map(v =>
        v.downtime_hours > 20 ? '#ef4444' : '#3b82f6'
      ),
      borderWidth: 1,
      borderRadius: 4,
    }],
  }), [downtimeTop15, t])

  const siteCostChartData = useMemo(() => {
    const { sites, vtypes } = costBySite
    const colors = [
      'rgba(59,130,246,0.7)', 'rgba(16,185,129,0.7)', 'rgba(245,158,11,0.7)',
      'rgba(168,85,247,0.7)', 'rgba(239,68,68,0.7)', 'rgba(6,182,212,0.7)',
    ]

    if (!fleetMasterAvail || vtypes.length <= 1) {
      return {
        labels: sites.map(s => s.site),
        datasets: [{
          label: t('fleetintel.siteCost.totalSeriesLabel'),
          data: sites.map(s => s.total),
          backgroundColor: 'rgba(59,130,246,0.65)',
          borderColor: '#3b82f6',
          borderWidth: 1,
          borderRadius: 4,
        }],
      }
    }

    return {
      labels: sites.map(s => s.site),
      datasets: vtypes.map((vt, i) => ({
        label: vt,
        data: sites.map(s => s.byType[vt] || 0),
        backgroundColor: colors[i % colors.length],
        borderColor: colors[i % colors.length].replace('0.7', '1'),
        borderWidth: 1,
        stack: 'stack',
      })),
    }
  }, [costBySite, fleetMasterAvail, t])

  const costTrendChartData = useMemo(() => ({
    labels: costTrendData.labels,
    datasets: [
      {
        label: t('fleetintel.costTrend.seriesLabel', { currency: activeCurrency }),
        data: costTrendData.actual,
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.12)',
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: '#3b82f6',
        spanGaps: false,
      },
      {
        label: t('fleetintel.costTrend.trendLineLabel'),
        data: costTrendData.regression,
        borderColor: 'rgba(107,114,128,0.6)',
        borderDash: [5, 4],
        borderWidth: 1.5,
        backgroundColor: 'transparent',
        pointRadius: (ctx) => ctx.dataIndex === costTrendData.regression.length - 1 ? 6 : 0,
        pointBackgroundColor: '#f59e0b',
        tension: 0,
      },
    ],
  }), [costTrendData, activeCurrency, t])

  // ── KPI derived values ────────────────────────────────────────────────────
  const availColor = fleetAggs.availability_pct >= 95 ? 'green' : fleetAggs.availability_pct >= 90 ? 'amber' : 'red'

  // ── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-400 text-sm">{t('fleetintel.states.loading')}</p>
        </div>
      </div>
    )
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="bg-gray-900 border border-red-800/50 rounded-xl p-8 max-w-md text-center space-y-3">
          <AlertTriangle className="text-red-400 mx-auto" size={32} />
          <p className="text-red-300 font-semibold">{t('fleetintel.states.errorTitle')}</p>
          <p className="text-gray-400 text-sm">{error}</p>
          <button
            onClick={loadData}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors"
          >
            {t('fleetintel.states.retry')}
          </button>
        </div>
      </div>
    )
  }

  // ── Empty state ───────────────────────────────────────────────────────────
  if (records.length === 0) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-12 text-center max-w-md">
          <Truck className="text-gray-600 mx-auto mb-3" size={40} />
          <p className="text-gray-300 font-semibold">{t('fleetintel.states.noRecordsTitle')}</p>
          <p className="text-gray-500 text-sm mt-1">
            {t('fleetintel.states.noRecordsDesc')}
          </p>
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="text-gray-100 space-y-6">

      {/* ── 1. Header ──────────────────────────────────────────────────────── */}
      <PageHeader
        title={t('fleetintel.header.title')}
        subtitle={t('fleetintel.header.subtitle')}
        icon={Truck}
        actions={<>
          {!fleetMasterAvail && (
            <span className="text-xs text-amber-400 border border-amber-800/40 bg-amber-900/20 px-2 py-1 rounded-lg">
              {t('fleetintel.header.fleetMasterUnavailable')}
            </span>
          )}
          <button
            onClick={loadData}
            className="p-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors text-gray-300"
            title={t('fleetintel.header.refresh')}
          >
            <RefreshCw size={15} />
          </button>
          <button
            onClick={handleExcelExport}
            className="flex items-center gap-2 px-3 py-2 bg-green-700/80 hover:bg-green-600/80 border border-green-700 rounded-lg text-sm transition-colors text-white font-medium"
          >
            <Download size={14} />{t('fleetintel.header.excel')}
          </button>
          <button
            onClick={handlePdfExport}
            className="flex items-center gap-2 px-3 py-2 bg-blue-700/80 hover:bg-blue-600/80 border border-blue-700 rounded-lg text-sm transition-colors text-white font-medium"
          >
            <FileText size={14} />{t('fleetintel.header.pdf')}
          </button>
          <button
            onClick={() => setEmailModalOpen(true)}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg text-sm transition-colors text-gray-300 font-medium"
          >
            <Mail size={14} />{t('fleetintel.header.emailReport')}
          </button>
        </>}
      />

      {/* ── 2. Filters ─────────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Filter size={14} className="text-gray-400" />
          <span className="text-sm font-medium text-gray-300">{t('fleetintel.filters.heading')}</span>
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          {/* Period */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">{t('fleetintel.filters.period')}</label>
            <PeriodFilter records={records} value={period} onChange={setPeriod} />
          </div>

          {/* Site */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">{t('fleetintel.filters.site')}</label>
            <select
              value={siteFilter}
              onChange={e => setSiteFilter(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 min-w-32"
            >
              {allSites.map(s => (
                <option key={s} value={s}>{s === 'all' ? t('fleetintel.filters.allSites') : s}</option>
              ))}
            </select>
          </div>

          {/* Vehicle type */}
          {allVehicleTypes.length > 1 && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">{t('fleetintel.filters.vehicleType')}</label>
              <select
                value={typeFilter}
                onChange={e => setTypeFilter(e.target.value)}
                className="bg-gray-800 border border-gray-700 text-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 min-w-32"
              >
                {allVehicleTypes.map(vt => (
                  <option key={vt} value={vt}>{vt === 'all' ? t('fleetintel.filters.allTypes') : vt}</option>
                ))}
              </select>
            </div>
          )}

          {/* Availability */}
          <div className="flex flex-col gap-1">
            <label className="text-xs text-gray-500">{t('fleetintel.filters.availability')}</label>
            <select
              value={availFilter}
              onChange={e => setAvailFilter(e.target.value)}
              className="bg-gray-800 border border-gray-700 text-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="all">{t('fleetintel.filters.all')}</option>
              <option value="Available">{t('fleetintel.filters.available')}</option>
              <option value="Critical">{t('fleetintel.filters.critical')}</option>
            </select>
          </div>

          {/* Result count */}
          <div className="flex flex-col gap-1 ml-auto">
            <p className="text-xs text-gray-500 text-right">{t('fleetintel.filters.assets')}</p>
            <p className="text-sm font-bold text-gray-200 text-right">{fmt(fleetAggs.fleet_size)}</p>
          </div>
        </div>
      </div>

      {/* ── 3. Fleet Health KPI Cards ───────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard
          icon={Shield}
          label={t('fleetintel.kpi.fleetAvailability')}
          value={`${fleetAggs.availability_pct.toFixed(1)}%`}
          sub={t('fleetintel.kpi.fleetAvailabilitySub', { available: fleetAggs.available_count, total: fleetAggs.fleet_size })}
          color={availColor}
        />
        <KpiCard
          icon={AlertTriangle}
          label={t('fleetintel.kpi.criticalVehicles')}
          value={fmt(fleetAggs.fleet_size - fleetAggs.available_count)}
          sub={t('fleetintel.kpi.criticalVehiclesSub')}
          color={fleetAggs.fleet_size - fleetAggs.available_count > 0 ? 'red' : 'green'}
        />
        <KpiCard
          icon={Clock}
          label={t('fleetintel.kpi.totalDowntime')}
          value={`${fmt(fleetAggs.total_downtime_hours)} hrs`}
          sub={t('fleetintel.kpi.totalDowntimeSub', { hours: HOURS_PER_CHANGE })}
          color="amber"
        />
        <KpiCard
          icon={DollarSign}
          label={t('fleetintel.kpi.monthlyCost')}
          value={fmtCurrency(fleetAggs.monthly_fleet_cost, activeCurrency)}
          sub={t('fleetintel.kpi.monthlyCostSub')}
          color="blue"
        />
        <KpiCard
          icon={Activity}
          label={t('fleetintel.kpi.fleetAvgCpk')}
          value={fleetAggs.fleetAvgCpk != null ? fmtCpk(fleetAggs.fleetAvgCpk) : '-'}
          sub={t('fleetintel.kpi.fleetAvgCpkSub', { currency: activeCurrency })}
          color="purple"
        />
        <KpiCard
          icon={Truck}
          label={t('fleetintel.kpi.avgCostPerVehicle')}
          value={fmtCurrency(fleetAggs.avg_cost_per_vehicle, activeCurrency)}
          sub={t('fleetintel.kpi.avgCostPerVehicleSub', { count: fleetAggs.fleet_size })}
          color="cyan"
        />
      </div>

      {/* ── 4. Availability Timeline ─────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-white">{t('fleetintel.availability.title')}</h2>
          <p className="text-xs text-gray-500">{t('fleetintel.availability.subtitle')}</p>
        </div>
        <div style={{ height: 240 }}>
          <Line data={availabilityChartData} options={makeLineOpts(activeCurrency, 'pct')} />
        </div>
      </div>

      {/* ── 5 & 6. Downtime + Site Cost ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Downtime */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-white">{t('fleetintel.downtime.title')}</h2>
            <p className="text-xs text-gray-500">{t('fleetintel.downtime.subtitle')}</p>
          </div>
          {downtimeTop15.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-600 text-sm">{t('fleetintel.downtime.noData')}</div>
          ) : (
            <div style={{ height: 280 }}>
              <Bar data={downtimeChartData} options={makeBarOpts(activeCurrency)} />
            </div>
          )}
        </div>

        {/* Site Cost */}
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-white">{t('fleetintel.siteCost.title')}</h2>
            <p className="text-xs text-gray-500">
              {t('fleetintel.siteCost.subtitle')}{fleetMasterAvail ? t('fleetintel.siteCost.stackedSuffix') : ''}
            </p>
          </div>
          {costBySite.sites.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-600 text-sm">{t('fleetintel.siteCost.noData')}</div>
          ) : (
            <div style={{ height: 280 }}>
              <Bar
                data={siteCostChartData}
                options={makeBarOpts(activeCurrency, fleetMasterAvail ? 'stacked' : 'cost')}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── 7. Cost Trend ────────────────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-white">{t('fleetintel.costTrend.title')}</h2>
            <p className="text-xs text-gray-500">{t('fleetintel.costTrend.subtitle')}</p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {costTrendData.slope > 50 ? (
              <span className="flex items-center gap-1 text-red-400 border border-red-800/40 bg-red-900/20 px-2 py-1 rounded-lg">
                <TrendingUp size={11} /> {t('fleetintel.costTrend.worsening')}
              </span>
            ) : costTrendData.slope < -50 ? (
              <span className="flex items-center gap-1 text-green-400 border border-green-800/40 bg-green-900/20 px-2 py-1 rounded-lg">
                <TrendingDown size={11} /> {t('fleetintel.costTrend.improving')}
              </span>
            ) : (
              <span className="text-gray-500 border border-gray-700 px-2 py-1 rounded-lg">{t('fleetintel.costTrend.stable')}</span>
            )}
            <span className="text-gray-500">
              {t('fleetintel.costTrend.forecast', { value: fmtCurrency(costTrendData.forecastCost, activeCurrency) })}
            </span>
          </div>
        </div>
        <div style={{ height: 240 }}>
          <Line data={costTrendChartData} options={makeLineOpts(activeCurrency, 'cost')} />
        </div>
      </div>

      {/* ── 8. Fleet Asset Register ──────────────────────────────────────────── */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
          <div>
            <h2 className="text-sm font-semibold text-white">Fleet Asset Register</h2>
            <p className="text-xs text-gray-500">
              {fmt(filteredRegister.length)} assets · sorted by {sortCol.replace(/_/g, ' ')}
            </p>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
            <input
              value={searchAsset}
              onChange={e => setSearchAsset(e.target.value)}
              placeholder="Search asset no..."
              className="pl-8 pr-3 py-1.5 bg-gray-800 border border-gray-700 text-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-500 w-48"
            />
          </div>
        </div>

        {filteredRegister.length === 0 ? (
          <div className="text-center py-10">
            <Truck className="text-gray-600 mx-auto mb-2" size={28} />
            <p className="text-gray-400 text-sm">No assets match current filters</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-800">
                    <SortTh col="asset_no"           label="Asset No"        sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                    <SortTh col="site"               label="Site"            sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                    <SortTh col="vehicle_type"       label="Type"            sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                    <SortTh col="total_tyre_changes" label="Changes"         sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right" />
                    <SortTh col="total_tyre_cost"    label="Total Cost"      sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right" />
                    <SortTh col="avg_cpk"            label="Avg CPK"         sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right" />
                    <SortTh col="high_risk_count"    label="High Risk"       sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-center" />
                    <th className="text-left text-gray-500 font-semibold py-2 px-2 text-xs uppercase tracking-wide">Status</th>
                    <SortTh col="monthly_cost"       label="Monthly Cost"    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right" />
                    <SortTh col="last_change_date"   label="Last Change"     sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                    <th className="text-left text-gray-500 font-semibold py-2 px-2 text-xs uppercase tracking-wide">Action</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence>
                    {pagedRows.map((v, i) => (
                      <motion.tr
                        key={v.asset_no}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.12, delay: i * 0.015 }}
                        className={`border-b border-gray-800/50 transition-colors ${
                          v.availability_status === 'Critical'
                            ? 'bg-red-900/5 hover:bg-red-900/15'
                            : 'hover:bg-gray-800/30'
                        }`}
                      >
                        <td className="py-2 px-2 font-mono font-semibold text-blue-300">{v.asset_no}</td>
                        <td className="py-2 px-2 text-gray-300">{v.site}</td>
                        <td className="py-2 px-2 text-gray-400">{v.vehicle_type}</td>
                        <td className="py-2 px-2 text-right text-gray-300">{fmt(v.total_tyre_changes)}</td>
                        <td className="py-2 px-2 text-right text-gray-200 font-semibold">
                          {fmtCurrency(v.total_tyre_cost, activeCurrency)}
                        </td>
                        <td className="py-2 px-2 text-right">
                          {v.avg_cpk != null && isFinite(v.avg_cpk)
                            ? <span className="text-gray-300">{fmtCpk(v.avg_cpk)}</span>
                            : <span className="text-gray-600">-</span>
                          }
                        </td>
                        <td className="py-2 px-2 text-center">
                          {v.high_risk_count > 0
                            ? <span className="px-1.5 py-0.5 bg-red-900/40 text-red-300 rounded text-xs font-bold">{v.high_risk_count}</span>
                            : <span className="text-gray-600">0</span>
                          }
                        </td>
                        <td className="py-2 px-2">
                          <AvailBadge status={v.availability_status} />
                        </td>
                        <td className="py-2 px-2 text-right text-gray-400">
                          {fmtCurrency(v.monthly_cost, activeCurrency)}
                        </td>
                        <td className="py-2 px-2 text-gray-500 whitespace-nowrap">{fmtDate(v.last_change_date)}</td>
                        <td className="py-2 px-2">
                          <a
                            href={`/vehicle-history?asset=${encodeURIComponent(v.asset_no)}`}
                            className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors text-xs"
                            title="View in Vehicle History"
                          >
                            <ExternalLink size={11} />
                            History
                          </a>
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
          </>
        )}
      </div>

      {/* ── 9. Vehicles Needing Attention ───────────────────────────────────── */}
      {attentionVehicles.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="text-red-400 shrink-0" size={16} />
            <div>
              <h2 className="text-sm font-semibold text-white">Vehicles Needing Attention</h2>
              <p className="text-xs text-gray-500">
                {attentionVehicles.length} vehicle{attentionVehicles.length !== 1 ? 's' : ''} with Critical or High risk tyres in last 30 days
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800">
                  {['#', 'Asset No', 'Site', 'Risk Level', 'Issue Date', 'Position', 'Brand', 'Records'].map(h => (
                    <th key={h} className="text-left text-gray-500 font-semibold py-2 px-2 whitespace-nowrap text-xs uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attentionVehicles.map((v, i) => (
                  <motion.tr
                    key={v.asset_no}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.15, delay: i * 0.02 }}
                    className={`border-b border-gray-800/50 transition-colors ${
                      v.risk_level === 'Critical'
                        ? 'bg-red-900/10 hover:bg-red-900/20'
                        : 'bg-amber-900/5 hover:bg-amber-900/15'
                    }`}
                  >
                    <td className="py-2 px-2 text-gray-500">{i + 1}</td>
                    <td className="py-2 px-2 font-mono font-semibold text-blue-300">{v.asset_no}</td>
                    <td className="py-2 px-2 text-gray-300">{v.site}</td>
                    <td className="py-2 px-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${
                        v.risk_level === 'Critical'
                          ? 'bg-red-900/40 text-red-300 border-red-800/50'
                          : 'bg-amber-900/40 text-amber-300 border-amber-800/50'
                      }`}>
                        {v.risk_level}
                      </span>
                    </td>
                    <td className="py-2 px-2 text-gray-400 whitespace-nowrap">{fmtDate(v.issue_date)}</td>
                    <td className="py-2 px-2 text-gray-300">{v.position}</td>
                    <td className="py-2 px-2 text-gray-300">{v.brand}</td>
                    <td className="py-2 px-2 text-center">
                      <span className="px-1.5 py-0.5 bg-gray-800 text-gray-400 rounded text-xs">{v.count}</span>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 10. Fleet Efficiency Benchmarks ─────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Best CPK */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.05 }}
          className="bg-green-900/10 border border-green-800/30 rounded-xl p-4 flex flex-col gap-3"
        >
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-green-900/30 rounded-lg">
              <Award className="text-green-400" size={16} />
            </div>
            <span className="text-xs font-semibold text-green-400 uppercase tracking-wide">Best CPK Vehicle</span>
          </div>
          {benchmarks.best ? (
            <>
              <div>
                <p className="text-2xl font-bold text-green-300">{fmtCpk(benchmarks.best.avg_cpk)}</p>
                <p className="text-xs text-gray-500">{activeCurrency}/km</p>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-3">
                <p className="font-mono text-sm font-bold text-white">{benchmarks.best.asset_no}</p>
                <p className="text-xs text-gray-400 mt-0.5">{benchmarks.best.total_tyre_changes} changes · {fmtCurrency(benchmarks.best.total_tyre_cost, activeCurrency)} total</p>
              </div>
              <p className="text-xs text-gray-500">Lowest cost per km - benchmark for fleet optimisation</p>
            </>
          ) : (
            <p className="text-gray-500 text-sm">Insufficient CPK data (need ≥5 valid records)</p>
          )}
        </motion.div>

        {/* Worst CPK */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.1 }}
          className="bg-red-900/10 border border-red-800/30 rounded-xl p-4 flex flex-col gap-3"
        >
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-red-900/30 rounded-lg">
              <Zap className="text-red-400" size={16} />
            </div>
            <span className="text-xs font-semibold text-red-400 uppercase tracking-wide">Worst CPK Vehicle</span>
          </div>
          {benchmarks.worst ? (
            <>
              <div>
                <p className="text-2xl font-bold text-red-300">{fmtCpk(benchmarks.worst.avg_cpk)}</p>
                <p className="text-xs text-gray-500">{activeCurrency}/km</p>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-3">
                <p className="font-mono text-sm font-bold text-white">{benchmarks.worst.asset_no}</p>
                <p className="text-xs text-gray-400 mt-0.5">{benchmarks.worst.total_tyre_changes} changes · {fmtCurrency(benchmarks.worst.total_tyre_cost, activeCurrency)} total</p>
              </div>
              <p className="text-xs text-gray-500">Highest cost per km - prioritise for root cause investigation</p>
            </>
          ) : (
            <p className="text-gray-500 text-sm">Insufficient data to identify worst CPK vehicle</p>
          )}
        </motion.div>

        {/* Improvement potential */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, delay: 0.15 }}
          className="bg-blue-900/10 border border-blue-800/30 rounded-xl p-4 flex flex-col gap-3"
        >
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-blue-900/30 rounded-lg">
              <Target className="text-blue-400" size={16} />
            </div>
            <span className="text-xs font-semibold text-blue-400 uppercase tracking-wide">Improvement Potential</span>
          </div>
          <div>
            <p className="text-2xl font-bold text-blue-300">{fmtCurrency(benchmarks.annualSavings, activeCurrency)}</p>
            <p className="text-xs text-gray-500">estimated annual savings</p>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3 space-y-1.5">
            <p className="text-xs text-gray-300">
              Fleet avg CPK: <span className="font-mono font-semibold text-blue-300">{benchmarks.fleetAvgCpk != null ? fmtCpk(benchmarks.fleetAvgCpk) : '-'}</span>
            </p>
            <p className="text-xs text-gray-400">
              If worst 10% of vehicles matched the fleet average CPK, the above savings could be realised annually.
            </p>
          </div>
          <p className="text-xs text-gray-500">
            Address driver behaviour, alignment, and maintenance quality for highest-cost vehicles.
          </p>
        </motion.div>
      </div>

      <EmailReportModal
        isOpen={emailModalOpen}
        onClose={() => setEmailModalOpen(false)}
        reportTitle="Fleet Management Intelligence Report"
        pdfColumns={['Asset No', 'Site', 'Type', 'Changes', 'Total Cost', 'Avg CPK', 'High Risk', 'Status']}
        pdfRows={vehicleMetrics
          .sort((a, b) => b.total_tyre_cost - a.total_tyre_cost)
          .slice(0, 20)
          .map(v => [
            v.asset_no,
            v.site,
            v.vehicle_type,
            String(v.total_tyre_changes),
            fmtCurrency(v.total_tyre_cost, activeCurrency),
            fmtCpk(v.avg_cpk),
            String(v.high_risk_count),
            v.availability_status,
          ])}
        kpiSummary={{
          'Fleet Size': fmt(fleetAggs.fleet_size),
          'Fleet Availability': `${fleetAggs.availability_pct.toFixed(1)}%`,
          'Available Vehicles': fmt(fleetAggs.available_count),
          'Total Downtime Hours': `${fmt(fleetAggs.total_downtime_hours)} hrs`,
          'Monthly Fleet Tyre Cost': fmtCurrency(fleetAggs.monthly_fleet_cost, activeCurrency),
          'Fleet Avg CPK': fleetAggs.fleetAvgCpk != null ? fmtCpk(fleetAggs.fleetAvgCpk) : '-',
          'Avg Cost per Vehicle': fmtCurrency(fleetAggs.avg_cost_per_vehicle, activeCurrency),
          'Potential Annual Savings': fmtCurrency(benchmarks.annualSavings, activeCurrency),
        }}
        period={`Period: ${periodLabel(period)}`}
      />
    </div>
  )
}
