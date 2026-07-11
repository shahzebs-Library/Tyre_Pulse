import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  TrendingUp, TrendingDown, Minus, BarChart2, Calendar, MapPin,
  Globe, Building2, Truck, User, Tag, AlertTriangle,
  Download, FileSpreadsheet, ChevronUp, ChevronDown, ChevronsUpDown,
  Info, Award, Star
} from 'lucide-react'
import { SkeletonCards, SkeletonChart } from '../components/ui/Skeleton'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler
} from 'chart.js'
import { Bar, Line, Doughnut, Scatter } from 'react-chartjs-2'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'
import SectionTabs, { ANALYTICS_TABS } from '../components/ui/SectionTabs'
import {
  mean, stdDev, sum, groupBy, bucketByMonth, rollingAverage,
  linearRegression, computeSiteMetrics, computeBrandMetrics,
  computeAssetMetrics, computeSeasonalTrends, recordCost, recordCpk,
} from '../lib/analyticsEngine'
import { fetchAllPages } from '../lib/fetchAll'
import { formatCurrencyCompact } from '../lib/formatters'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler
)

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'trend',    label: 'Trend Analysis',       icon: TrendingUp },
  { id: 'seasonal', label: 'Seasonal Analysis',    icon: Calendar },
  { id: 'geo',      label: 'Geographic Analysis',  icon: MapPin },
  { id: 'country',  label: 'Country Comparison',   icon: Globe },
  { id: 'branch',   label: 'Branch Comparison',    icon: Building2 },
  { id: 'vehicle',  label: 'Vehicle Comparison',   icon: Truck },
  { id: 'driver',   label: 'Driver Comparison',    icon: User },
  { id: 'brand',    label: 'Brand Comparison',     icon: Tag },
  { id: 'failure',  label: 'Failure Patterns',     icon: AlertTriangle },
]

const DATE_PRESETS = [
  { id: '3mo',  label: 'Last 3 Mo' },
  { id: '6mo',  label: 'Last 6 Mo' },
  { id: '1yr',  label: 'Last 1 Yr' },
  { id: '2yr',  label: 'Last 2 Yr' },
  { id: 'all',  label: 'All Time'  },
]

const POSITIONS = ['All', 'Steer', 'Drive', 'Trailer', 'Other']

const PALETTE = [
  '#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#ec4899','#06b6d4','#84cc16','#f97316','#a855f7',
  '#14b8a6','#eab308','#6366f1','#f43f5e','#0ea5e9',
]

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ── Chart base options ────────────────────────────────────────────────────────

const BASE_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'var(--panel-2)',
      titleColor: '#f9fafb',
      bodyColor: '#d1d5db',
      borderColor: 'var(--hairline)',
      borderWidth: 1,
    },
  },
  scales: {
    x: { grid: { color:'var(--text-muted)' }, ticks: { color: '#6b7280' } },
    y: { grid: { color:'var(--text-muted)' }, ticks: { color: '#6b7280' } },
  },
}

const NO_LEGEND_OPTS = {
  ...BASE_OPTS,
  plugins: { ...BASE_OPTS.plugins, legend: { display: false } },
}

const H_BAR_OPTS = {
  ...NO_LEGEND_OPTS,
  indexAxis: 'y',
}

// ── Utility helpers ───────────────────────────────────────────────────────────

function fmt(n, digits = 0) {
  if (n == null || isNaN(n)) return '-'
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

// Delegates to the shared formatter; currency always supplied from activeCurrency.
function fmtCur(n, currency) {
  if (n == null || isNaN(n)) return '-'
  return formatCurrencyCompact(n, currency)
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '-'
  return `${Number(n).toFixed(1)}%`
}

function fmtCpk(n, currency) {
  if (n == null || isNaN(n)) return '-'
  return `${currency} ${Number(n).toFixed(4)}/km`
}

function cutoffDate(preset) {
  const now = new Date()
  if (preset === 'all') return null
  const months = { '3mo': 3, '6mo': 6, '1yr': 12, '2yr': 24 }[preset] ?? 12
  const d = new Date(now)
  d.setMonth(d.getMonth() - months)
  return d.toISOString().split('T')[0]
}

function applyLR(monthlyValues, futureCount = 3) {
  const pts = monthlyValues.map((v, i) => [i, v ?? 0])
  const lr = linearRegression(pts)
  const forecast = []
  for (let i = 0; i < futureCount; i++) {
    forecast.push(Math.max(0, lr.predict(monthlyValues.length + i)))
  }
  return { forecast, slope: lr.slope }
}

function trendBadge(slope, label = '', t) {
  if (slope > 0.001)  return { text: `${t('advancedanalytics.trend.worsening')} ↑${label}`, cls: 'bg-red-900/40 text-red-400 border border-red-800' }
  if (slope < -0.001) return { text: `${t('advancedanalytics.trend.improving')} ↓${label}`, cls: 'bg-emerald-900/40 text-emerald-400 border border-emerald-800' }
  return { text: `${t('advancedanalytics.trend.stable')} →${label}`, cls: 'bg-yellow-900/40 text-yellow-400 border border-yellow-800' }
}

function heatColor(value, min, max) {
  if (max === min) return 'rgba(59,130,246,0.3)'
  const t = (value - min) / (max - min)
  const r = Math.round(239 * t + 59 * (1 - t))
  const g = Math.round(68  * t + 130 * (1 - t))
  const b = Math.round(68  * t + 246 * (1 - t))
  return `rgba(${r},${g},${b},${0.2 + t * 0.65})`
}

function addForecastMonthLabels(existing, count) {
  const last = existing[existing.length - 1]
  if (!last) return []
  const [yr, mo] = last.split('-').map(Number)
  const labels = []
  for (let i = 1; i <= count; i++) {
    const d = new Date(yr, mo - 1 + i, 1)
    labels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')} (F)`)
  }
  return labels
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function Card({ children, className = '' }) {
  return (
    <div className={`card ${className}`}>
      {children}
    </div>
  )
}

function SectionTitle({ children }) {
  return <h3 className="text-sm font-semibold text-[var(--text-secondary)] mb-3 uppercase tracking-wide">{children}</h3>
}

function LoadingOverlay() {
  return (
    <div className="space-y-4">
      <SkeletonCards count={4} />
      <SkeletonChart />
    </div>
  )
}

function EmptyState({ message }) {
  const { t } = useLanguage()
  return (
    <div className="flex flex-col items-center justify-center h-48 gap-2 text-[var(--text-muted)]">
      <BarChart2 size={32} className="opacity-30" />
      <p className="text-sm">{message || t('advancedanalytics.states.noData')}</p>
    </div>
  )
}

function ChartBox({ title, height = 260, children }) {
  return (
    <Card>
      {title && <SectionTitle>{title}</SectionTitle>}
      <div style={{ height }}>{children}</div>
    </Card>
  )
}

function MetricTile({ label, value, sub }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs text-[var(--text-muted)] uppercase tracking-wide">{label}</span>
      <span className="text-xl font-bold text-[var(--text-primary)]">{value}</span>
      {sub && <span className="text-xs text-[var(--text-muted)]">{sub}</span>}
    </Card>
  )
}

function SortIcon({ field, sortField, sortDir }) {
  if (sortField !== field) return <ChevronsUpDown size={12} className="opacity-30" />
  return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AdvancedAnalytics() {
  const { activeCurrency, activeCountry } = useSettings()
  const { t } = useLanguage()

  const [records,        setRecords]        = useState([])
  const [loading,        setLoading]        = useState(true)
  const [error,          setError]          = useState(null)
  const [activeTab,      setActiveTab]      = useState('trend')
  const [datePreset,     setDatePreset]     = useState('1yr')
  const [siteFilter,     setSiteFilter]     = useState('all')
  const [positionFilter, setPositionFilter] = useState('all')
  const [sortField,      setSortField]      = useState('totalCost')
  const [sortDir,        setSortDir]        = useState('desc')

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data, error: err } = await fetchAllPages((from, to) => {
          let q = supabase
            .from('tyre_records')
            .select('id,asset_no,site,brand,position,risk_level,category,findings,km_at_fitment,km_at_removal,cost_per_tyre,issue_date,tread_depth,pressure_reading')
            .order('issue_date', { ascending: true })
          if (activeCountry !== 'All') q = q.eq('country', activeCountry)
          return q.range(from, to)
        })
        if (err) throw err
        setRecords(data || [])
      } catch (e) {
        setError(e.message || t('advancedanalytics.states.loadFailed'))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [activeCountry])

  // ── Derived filter options ─────────────────────────────────────────────────
  const uniqueSites = useMemo(() => {
    const s = new Set(records.map(r => r.site).filter(Boolean))
    return [...s].sort()
  }, [records])

  // ── Filtered records ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const cutoff = cutoffDate(datePreset)
    return records.filter(r => {
      if (cutoff && r.issue_date && r.issue_date < cutoff) return false
      if (siteFilter !== 'all' && r.site !== siteFilter) return false
      if (positionFilter !== 'all') {
        const pos = (r.position || '').toLowerCase()
        if (positionFilter === 'Other') {
          if (['steer','drive','trailer'].some(p => pos.includes(p))) return false
        } else {
          if (!pos.includes(positionFilter.toLowerCase())) return false
        }
      }
      return true
    })
  }, [records, datePreset, siteFilter, positionFilter])

  // ── Sort helper ────────────────────────────────────────────────────────────
  function handleSort(field) {
    setSortField(prev => {
      if (prev === field) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return field }
      setSortDir('desc')
      return field
    })
  }

  function sortedRows(rows, field, dir) {
    return [...rows].sort((a, b) => {
      const av = a[field] ?? 0
      const bv = b[field] ?? 0
      if (typeof av === 'string') return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return dir === 'asc' ? av - bv : bv - av
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB 1 - TREND ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════
  const trendData = useMemo(() => {
    if (!filtered.length) return null
    const buckets = bucketByMonth(filtered, r => r.issue_date, r => recordCost(r))
    const last24 = buckets.slice(-24)
    if (!last24.length) return null

    const labels    = last24.map(b => b.month)
    const costVals  = last24.map(b => b.total)
    const countVals = last24.map(b => b.count)

    // CPK per month
    const cpkVals = last24.map(b => {
      const valid = b.items.map(r => recordCpk(r)).filter(v => v !== null)
      return valid.length ? mean(valid) : null
    })

    // Failure rate per month (High+Critical / count)
    const failRateVals = last24.map(b => {
      if (!b.count) return 0
      const fail = b.items.filter(r => r.risk_level === 'High' || r.risk_level === 'Critical').length
      return (fail / b.count) * 100
    })

    const movAvgCpk = rollingAverage(cpkVals.map(v => v ?? 0), 3)

    // Forecasts
    const F = 3
    const cpkForecast  = applyLR(cpkVals.map(v => v ?? 0), F)
    const failForecast = applyLR(failRateVals, F)
    const countForecast = applyLR(countVals, F)
    const fLabels = addForecastMonthLabels(labels, F)

    return {
      labels, fLabels,
      costVals, countVals, cpkVals, failRateVals, movAvgCpk,
      cpkForecast, failForecast, countForecast,
      cpkTrend:  trendBadge(cpkForecast.slope,  ` ${t('advancedanalytics.trend.cpk')}`, t),
      failTrend: trendBadge(failForecast.slope, ` ${t('advancedanalytics.trend.failureRate')}`, t),
      countTrend: trendBadge(countForecast.slope, ` ${t('advancedanalytics.trend.volume')}`, t),
    }
  }, [filtered, t])

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB 2 - SEASONAL ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════
  const seasonalData = useMemo(() => {
    if (!filtered.length) return null
    const seasons = computeSeasonalTrends(filtered)
    const cpkByMonth = Array.from({ length: 12 }, (_, i) => {
      const mo = String(i + 1).padStart(2, '0')
      const recs = filtered.filter(r => r.issue_date && r.issue_date.substring(5, 7) === mo)
      const vals = recs.map(r => recordCpk(r)).filter(v => v !== null)
      return vals.length ? mean(vals) : null
    })
    const maxCost = Math.max(...seasons.map(s => s.cost), 1)
    const maxFail = Math.max(...seasons.map(s => s.highRiskRate * 100), 1)
    const worstCostMonth = seasons.reduce((best, s) => s.cost > best.cost ? s : best, seasons[0])
    return { seasons, cpkByMonth, maxCost, maxFail, worstCostMonth }
  }, [filtered])

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB 3 - GEOGRAPHIC ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════
  const geoData = useMemo(() => {
    if (!filtered.length) return null
    const sites = computeSiteMetrics(filtered)
    // Site × Month failure heatmap (last 12 months)
    const allMonths = bucketByMonth(filtered, r => r.issue_date).slice(-12).map(b => b.month)
    const heatmap = sites.slice(0, 15).map(s => {
      const recs = filtered.filter(r => r.site === s.site)
      const row = allMonths.map(mo => {
        const mRecs = recs.filter(r => r.issue_date && r.issue_date.startsWith(mo))
        if (!mRecs.length) return null
        const fail = mRecs.filter(r => r.risk_level === 'High' || r.risk_level === 'Critical').length
        return (fail / mRecs.length) * 100
      })
      return { site: s.site, row }
    })
    const heatVals = heatmap.flatMap(r => r.row).filter(v => v !== null)
    const heatMin = Math.min(...heatVals, 0)
    const heatMax = Math.max(...heatVals, 1)
    return { sites, allMonths, heatmap, heatMin, heatMax }
  }, [filtered])

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB 4 - COUNTRY COMPARISON
  // ═══════════════════════════════════════════════════════════════════════════
  const countryData = useMemo(() => {
    if (!filtered.length) return null
    const bySite = groupBy(filtered, r => r.site || 'Unknown')
    // Derive "country/region" from site name: take first word as region proxy
    const byRegion = {}
    Object.entries(bySite).forEach(([site, recs]) => {
      const region = site.split(/[\s\-_]/)[0] || site
      if (!byRegion[region]) byRegion[region] = []
      byRegion[region].push(...recs)
    })
    const regions = Object.entries(byRegion).map(([region, recs]) => {
      const count = recs.length
      const totalCost = sum(recs.map(r => recordCost(r)))
      const cpkVals = recs.map(r => recordCpk(r)).filter(v => v !== null)
      const avgCpk = cpkVals.length ? mean(cpkVals) : null
      const failCount = recs.filter(r => r.risk_level === 'High' || r.risk_level === 'Critical').length
      const failRate = count ? (failCount / count) * 100 : 0
      const sites = [...new Set(recs.map(r => r.site).filter(Boolean))]
      return { region, count, totalCost, avgCpk, failRate, siteCount: sites.length, sites: sites.join(', ') }
    }).sort((a, b) => b.totalCost - a.totalCost)
    return { regions }
  }, [filtered])

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB 5 - BRANCH COMPARISON
  // ═══════════════════════════════════════════════════════════════════════════
  const branchData = useMemo(() => {
    if (!filtered.length) return null
    const sites = computeSiteMetrics(filtered)
    const branches = sites.map(s => {
      const recs = filtered.filter(r => r.site === s.site)
      const cpkVals = recs.map(r => recordCpk(r)).filter(v => v !== null)
      const avgCpk = cpkVals.length ? mean(cpkVals) : null
      const kmLives = recs.filter(r =>
        (r.km_at_fitment || 0) >= 0 && (r.km_at_removal || 0) > (r.km_at_fitment || 0)
      ).map(r => r.km_at_removal - r.km_at_fitment)
      const avgLife = kmLives.length ? mean(kmLives) : null
      const failRate = s.count ? (s.highRiskCount / s.count) * 100 : 0
      // Composite score: CPK rank 40% + failure rate rank 30% + tyre life rank 30%
      return { ...s, avgCpk, avgLife, failRate }
    })
    // Normalize and score
    const maxCost = Math.max(...branches.map(b => b.totalCost), 1)
    const maxCpk = Math.max(...branches.map(b => b.avgCpk ?? 0), 1)
    const maxFail = Math.max(...branches.map(b => b.failRate), 1)
    const maxLife = Math.max(...branches.map(b => b.avgLife ?? 0), 1)
    const scored = branches.map(b => {
      const cpkScore  = b.avgCpk != null ? (1 - b.avgCpk / maxCpk) * 40 : 20
      const failScore = (1 - b.failRate / maxFail) * 30
      const lifeScore = b.avgLife != null ? (b.avgLife / maxLife) * 30 : 15
      return { ...b, compositeScore: Math.round(cpkScore + failScore + lifeScore) }
    }).sort((a, b) => b.compositeScore - a.compositeScore)
    return { branches: scored }
  }, [filtered])

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB 6 - VEHICLE COMPARISON
  // ═══════════════════════════════════════════════════════════════════════════
  const vehicleData = useMemo(() => {
    if (!filtered.length) return null
    const assets = computeAssetMetrics(filtered)
    const enhanced = assets.map(a => {
      const recs = filtered.filter(r => r.asset_no === a.assetNo)
      const cpkVals = recs.map(r => recordCpk(r)).filter(v => v !== null)
      const avgCpk = cpkVals.length ? mean(cpkVals) : null
      const kmLives = recs.filter(r =>
        (r.km_at_fitment || 0) >= 0 && (r.km_at_removal || 0) > (r.km_at_fitment || 0)
      ).map(r => r.km_at_removal - r.km_at_fitment)
      const avgLife = kmLives.length ? mean(kmLives) : null
      const failCount = recs.filter(r => r.risk_level === 'High' || r.risk_level === 'Critical').length
      return { ...a, avgCpk, avgLife, failCount }
    })
    const allCpk = enhanced.map(v => v.avgCpk).filter(v => v !== null)
    const cpkMean = allCpk.length ? mean(allCpk) : 0
    const cpkSd   = allCpk.length ? stdDev(allCpk) : 0
    const outlierThreshold = cpkMean + 2 * cpkSd
    const withOutlier = enhanced.map(v => ({
      ...v,
      isOutlier: v.avgCpk != null && v.avgCpk > outlierThreshold,
    }))
    const top20Cost = [...withOutlier].sort((a, b) => b.totalCost - a.totalCost).slice(0, 20)
    return { vehicles: withOutlier, top20Cost, cpkMean, outlierThreshold }
  }, [filtered])

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB 7 - DRIVER COMPARISON (vehicle-proxy)
  // ═══════════════════════════════════════════════════════════════════════════
  const driverData = useMemo(() => {
    if (!filtered.length) return null
    const assets = vehicleData?.vehicles ?? []
    const sorted = [...assets].sort((a, b) => b.totalCost - a.totalCost)
    const worst10 = sorted.slice(0, 10)
    const best10  = [...assets]
      .filter(a => a.totalCost > 0)
      .sort((a, b) => a.totalCost - b.totalCost)
      .slice(0, 10)
    // Check if findings contain driver-like patterns (e.g., name patterns)
    const driverPatterns = filtered
      .map(r => r.findings || '')
      .filter(f => /driver|operator|[A-Z][a-z]+ [A-Z][a-z]+/i.test(f))
    const hasDriverData = driverPatterns.length > 5
    return { worst10, best10, hasDriverData }
  }, [filtered, vehicleData])

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB 8 - BRAND COMPARISON
  // ═══════════════════════════════════════════════════════════════════════════
  const brandData = useMemo(() => {
    if (!filtered.length) return null
    const brands = computeBrandMetrics(filtered)
    const enhanced = brands.map(b => {
      const recs = filtered.filter(r => (r.brand || 'Unknown') === b.brand)
      const cpkVals = recs.map(r => recordCpk(r)).filter(v => v !== null)
      const avgCpk = cpkVals.length ? mean(cpkVals) : null
      const kmLives = recs.filter(r =>
        (r.km_at_fitment || 0) >= 0 && (r.km_at_removal || 0) > (r.km_at_fitment || 0)
      ).map(r => r.km_at_removal - r.km_at_fitment)
      const avgLife = kmLives.length ? mean(kmLives) : null
      const scrapCount = recs.filter(r =>
        (r.category || '').toLowerCase().includes('scrap') ||
        (r.category || '').toLowerCase().includes('discard')
      ).length
      const scrapRate = b.count ? (scrapCount / b.count) * 100 : 0
      // Brand score: higher life, lower cpk, lower failure = better
      const maxCpkRef = 0.05
      const cpkScore = avgCpk != null ? Math.max(0, (1 - avgCpk / maxCpkRef) * 40) : 20
      const lifeScore = avgLife != null ? Math.min(40, (avgLife / 100000) * 40) : 20
      const failScore = Math.max(0, (1 - b.failureRate / 100) * 20)
      const score = Math.round(cpkScore + lifeScore + failScore)
      return { ...b, avgCpk, avgLife, scrapRate, score }
    })
    const sorted = [...enhanced].sort((a, b) => b.score - a.score)

    // Monthly trend per brand (last 12 months)
    const allMonths = bucketByMonth(filtered, r => r.issue_date).slice(-12).map(b => b.month)
    const brandMonthly = enhanced.slice(0, 6).map(b => {
      const recs = filtered.filter(r => (r.brand || 'Unknown') === b.brand)
      return {
        brand: b.brand,
        monthly: allMonths.map(mo => {
          const mRecs = recs.filter(r => r.issue_date && r.issue_date.startsWith(mo))
          return sum(mRecs.map(r => recordCost(r)))
        }),
      }
    })

    // Check 24 months for YoY
    const allBuckets = bucketByMonth(filtered, r => r.issue_date)
    const hasYoY = allBuckets.length >= 24

    return { brands: sorted, allMonths, brandMonthly, hasYoY }
  }, [filtered])

  // ═══════════════════════════════════════════════════════════════════════════
  // TAB 9 - FAILURE PATTERN ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════
  const failureData = useMemo(() => {
    if (!filtered.length) return null
    const failed = filtered.filter(r => r.risk_level === 'High' || r.risk_level === 'Critical')

    // Category distribution
    const catMap = {}
    failed.forEach(r => {
      const k = r.category || 'Unknown'
      catMap[k] = (catMap[k] || 0) + 1
    })
    const catEntries = Object.entries(catMap).sort((a, b) => b[1] - a[1])

    // Position failure rate
    const posMap = {}
    filtered.forEach(r => {
      const pos = r.position || 'Unknown'
      if (!posMap[pos]) posMap[pos] = { total: 0, fail: 0 }
      posMap[pos].total++
      if (r.risk_level === 'High' || r.risk_level === 'Critical') posMap[pos].fail++
    })
    const posRates = Object.entries(posMap)
      .map(([pos, d]) => ({ pos, rate: d.total ? (d.fail / d.total) * 100 : 0, total: d.total }))
      .filter(p => p.total >= 3)
      .sort((a, b) => b.rate - a.rate)

    // Brand failure rate
    const brandMap = {}
    filtered.forEach(r => {
      const brand = r.brand || 'Unknown'
      if (!brandMap[brand]) brandMap[brand] = { total: 0, fail: 0 }
      brandMap[brand].total++
      if (r.risk_level === 'High' || r.risk_level === 'Critical') brandMap[brand].fail++
    })
    const brandRates = Object.entries(brandMap)
      .map(([brand, d]) => ({ brand, rate: d.total ? (d.fail / d.total) * 100 : 0, total: d.total }))
      .filter(b => b.total >= 5)
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 10)

    // Site failure rate
    const siteMap = {}
    filtered.forEach(r => {
      const site = r.site || 'Unknown'
      if (!siteMap[site]) siteMap[site] = { total: 0, fail: 0 }
      siteMap[site].total++
      if (r.risk_level === 'High' || r.risk_level === 'Critical') siteMap[site].fail++
    })
    const siteRates = Object.entries(siteMap)
      .map(([site, d]) => ({ site, rate: d.total ? (d.fail / d.total) * 100 : 0, total: d.total }))
      .filter(s => s.total >= 3)
      .sort((a, b) => b.rate - a.rate)
      .slice(0, 12)

    // Km life histogram buckets
    const BUCKETS = [
      { label: '0-10K',   min: 0,      max: 10000 },
      { label: '10-30K',  min: 10000,  max: 30000 },
      { label: '30-60K',  min: 30000,  max: 60000 },
      { label: '60-100K', min: 60000,  max: 100000 },
      { label: '100K+',   min: 100000, max: Infinity },
    ]
    const kmCounts = BUCKETS.map(b => {
      const c = filtered.filter(r => {
        const km = (r.km_at_removal ?? 0) - (r.km_at_fitment ?? 0)
        return km >= b.min && km < b.max && km > 0
      }).length
      return { ...b, count: c }
    })

    // Month × Category heatmap
    const months = bucketByMonth(filtered, r => r.issue_date).slice(-12).map(b => b.month)
    const cats = catEntries.slice(0, 8).map(([k]) => k)
    const heatmap = cats.map(cat => {
      const row = months.map(mo => {
        const mRecs = filtered.filter(r =>
          r.issue_date && r.issue_date.startsWith(mo) && (r.category || 'Unknown') === cat
        )
        return mRecs.length
      })
      return { cat, row }
    })
    const heatVals = heatmap.flatMap(r => r.row)
    const heatMax = Math.max(...heatVals, 1)

    return { catEntries, posRates, brandRates, siteRates, kmCounts, months, heatmap, heatMax }
  }, [filtered])

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPORT HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════
  function handleExportExcel() {
    const cols = ['asset_no','site','brand','position','risk_level','category','km_at_fitment','km_at_removal','cost_per_tyre','issue_date']
    const hdrs = ['Asset No','Site','Brand','Position','Risk Level','Category','KM Fitment','KM Removal','Cost/Tyre','Issue Date']
    exportToExcel(filtered, cols, hdrs, `advanced_analytics_${activeTab}_${datePreset}`, activeTab)
  }

  function handleExportPdf() {
    const cols = [
      { key: 'asset_no', header: 'Asset No' },
      { key: 'site', header: 'Site' },
      { key: 'brand', header: 'Brand' },
      { key: 'position', header: 'Position' },
      { key: 'risk_level', header: 'Risk Level' },
      { key: 'category', header: 'Category' },
      { key: 'cost_per_tyre', header: `Cost (${activeCurrency})` },
      { key: 'issue_date', header: 'Date' },
    ]
    exportToPdf(filtered, cols, `Advanced Analytics - ${activeTab}`, `advanced_analytics_${activeTab}`)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="text-[var(--text-primary)] space-y-6">
      <SectionTabs tabs={ANALYTICS_TABS} />
      {/* Page Header */}
      <div className="px-6 pt-6 pb-4 border-b border-[var(--input-border)]">
        <PageHeader
          title={t('advancedanalytics.title')}
          subtitle={t('advancedanalytics.subtitle', { records: fmt(filtered.length), sites: uniqueSites.length })}
          icon={BarChart2}
          actions={<>
            <button
              onClick={handleExportExcel}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] rounded-lg text-xs text-[var(--text-secondary)] transition-colors"
            >
              <FileSpreadsheet size={13} />
              {t('advancedanalytics.actions.excel')}
            </button>
            <button
              onClick={handleExportPdf}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--input-bg)] hover:bg-[var(--input-bg-hover)] border border-[var(--input-border)] rounded-lg text-xs text-[var(--text-secondary)] transition-colors"
            >
              <Download size={13} />
              {t('advancedanalytics.actions.pdf')}
            </button>
          </>}
        />

        {/* Global Filters */}
        <div className="flex flex-wrap items-center gap-2 mt-4">
          {/* Date presets */}
          <div className="flex gap-1 bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg p-0.5">
            {DATE_PRESETS.map(p => (
              <button
                key={p.id}
                onClick={() => setDatePreset(p.id)}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  datePreset === p.id
                    ? 'bg-blue-600 text-white'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {t(`advancedanalytics.datePresets.${p.id}`)}
              </button>
            ))}
          </div>

          {/* Site filter */}
          <select
            value={siteFilter}
            onChange={e => setSiteFilter(e.target.value)}
            className="text-xs bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-2 py-1.5 text-[var(--text-secondary)] focus:outline-none focus:border-blue-600"
          >
            <option value="all">{t('advancedanalytics.filters.allSites')}</option>
            {uniqueSites.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {/* Position filter */}
          <select
            value={positionFilter}
            onChange={e => setPositionFilter(e.target.value)}
            className="text-xs bg-[var(--surface-1)] border border-[var(--input-border)] rounded-lg px-2 py-1.5 text-[var(--text-secondary)] focus:outline-none focus:border-blue-600"
          >
            {POSITIONS.map(p => (
              <option key={p} value={p === 'All' ? 'all' : p}>{t(`advancedanalytics.positions.${p.toLowerCase()}`)}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="px-6 pt-4 pb-0 overflow-x-auto">
        <div className="flex gap-1 border-b border-[var(--input-border)] min-w-max">
          {TABS.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
                }`}
              >
                <Icon size={13} />
                {t(`advancedanalytics.tabs.${tab.id}`)}
              </button>
            )
          })}
        </div>
      </div>

      {/* Tab Content */}
      <div className="p-6">
        {loading ? (
          <LoadingOverlay />
        ) : error ? (
          <div className="flex items-center justify-center h-48 gap-2 text-red-400">
            <AlertTriangle size={20} />
            <span className="text-sm">{error}</span>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              {activeTab === 'trend'    && <TrendTab    data={trendData}    currency={activeCurrency} />}
              {activeTab === 'seasonal' && <SeasonalTab data={seasonalData} currency={activeCurrency} />}
              {activeTab === 'geo'      && <GeoTab      data={geoData}      currency={activeCurrency} />}
              {activeTab === 'country'  && <CountryTab  data={countryData}  currency={activeCurrency} sortField={sortField} sortDir={sortDir} onSort={handleSort} sortedRows={sortedRows} />}
              {activeTab === 'branch'   && <BranchTab   data={branchData}   currency={activeCurrency} sortField={sortField} sortDir={sortDir} onSort={handleSort} sortedRows={sortedRows} />}
              {activeTab === 'vehicle'  && <VehicleTab  data={vehicleData}  currency={activeCurrency} sortField={sortField} sortDir={sortDir} onSort={handleSort} sortedRows={sortedRows} />}
              {activeTab === 'driver'   && <DriverTab   data={driverData}   currency={activeCurrency} />}
              {activeTab === 'brand'    && <BrandTab    data={brandData}    currency={activeCurrency} sortField={sortField} sortDir={sortDir} onSort={handleSort} sortedRows={sortedRows} />}
              {activeTab === 'failure'  && <FailureTab  data={failureData}  currency={activeCurrency} />}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Tab 1: Trend Analysis ──────────────────────────────────────────────────────
function TrendTab({ data, currency }) {
  const { t } = useLanguage()
  if (!data) return <EmptyState />

  const { labels, fLabels, cpkVals, failRateVals, countVals,
          movAvgCpk, cpkForecast, failForecast, countForecast,
          cpkTrend, failTrend, countTrend } = data

  const allCpkLabels   = [...labels, ...fLabels]
  const allFailLabels  = [...labels, ...fLabels]
  const allCountLabels = [...labels, ...fLabels]

  const cpkData = {
    labels: allCpkLabels,
    datasets: [
      {
        label: t('advancedanalytics.trend.avgCpk'),
        data: [...cpkVals, ...Array(fLabels.length).fill(null)],
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.1)',
        borderWidth: 2,
        tension: 0.3,
        fill: true,
        pointRadius: 3,
      },
      {
        label: t('advancedanalytics.trend.movingAvg'),
        data: [...movAvgCpk, ...Array(fLabels.length).fill(null)],
        borderColor: '#f59e0b',
        borderWidth: 2,
        borderDash: [],
        pointRadius: 0,
        tension: 0.3,
      },
      {
        label: t('advancedanalytics.trend.forecast'),
        data: [...Array(labels.length).fill(null), ...cpkForecast.forecast],
        borderColor: '#3b82f6',
        borderDash: [6, 4],
        borderWidth: 2,
        pointRadius: 4,
        pointStyle: 'triangle',
        tension: 0.3,
      },
    ],
  }

  const failData = {
    labels: allFailLabels,
    datasets: [
      {
        label: t('advancedanalytics.trend.failureRatePct'),
        data: [...failRateVals, ...Array(fLabels.length).fill(null)],
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239,68,68,0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.3,
        pointRadius: 3,
      },
      {
        label: t('advancedanalytics.trend.forecast'),
        data: [...Array(labels.length).fill(null), ...failForecast.forecast],
        borderColor: '#ef4444',
        borderDash: [6, 4],
        borderWidth: 2,
        pointRadius: 4,
        tension: 0.3,
      },
    ],
  }

  const countData = {
    labels: allCountLabels,
    datasets: [
      {
        label: t('advancedanalytics.trend.replacements'),
        data: [...countVals, ...Array(fLabels.length).fill(null)],
        backgroundColor: 'rgba(139,92,246,0.7)',
        borderColor: '#8b5cf6',
        borderWidth: 1,
        borderRadius: 3,
      },
      {
        label: t('advancedanalytics.trend.forecast'),
        data: [...Array(labels.length).fill(null), ...countForecast.forecast],
        backgroundColor: 'rgba(139,92,246,0.3)',
        borderColor: '#8b5cf6',
        borderDash: [6, 4],
        borderWidth: 1.5,
        borderRadius: 3,
      },
    ],
  }

  return (
    <div className="space-y-5">
      {/* Trend verdict badges */}
      <div className="flex flex-wrap gap-2">
        {[cpkTrend, failTrend, countTrend].map((t, i) => (
          <span key={i} className={`text-xs px-3 py-1 rounded-full font-medium ${t.cls}`}>{t.text}</span>
        ))}
        <span className="text-xs px-3 py-1 rounded-full bg-[var(--input-bg)] text-[var(--text-muted)] border border-[var(--input-border)]">
          {t('advancedanalytics.trend.forecastNote')}
        </span>
      </div>

      <ChartBox title={t('advancedanalytics.trend.cpkChart')} height={280}>
        <Line data={cpkData} options={{
          ...BASE_OPTS,
          plugins: { ...BASE_OPTS.plugins, legend: { labels: { color: '#9ca3af', font: { size: 10 } } } },
          scales: {
            ...BASE_OPTS.scales,
            y: { ...BASE_OPTS.scales.y, ticks: { ...BASE_OPTS.scales.y.ticks, callback: v => `${currency} ${Number(v).toFixed(4)}` } },
          },
        }} />
      </ChartBox>

      <ChartBox title={t('advancedanalytics.trend.failChart')} height={260}>
        <Line data={failData} options={{
          ...BASE_OPTS,
          scales: {
            ...BASE_OPTS.scales,
            y: { ...BASE_OPTS.scales.y, ticks: { ...BASE_OPTS.scales.y.ticks, callback: v => `${Number(v).toFixed(1)}%` } },
          },
        }} />
      </ChartBox>

      <ChartBox title={t('advancedanalytics.trend.volumeChart')} height={260}>
        <Bar data={countData} options={BASE_OPTS} />
      </ChartBox>
    </div>
  )
}

// ── Tab 2: Seasonal Analysis ───────────────────────────────────────────────────
function SeasonalTab({ data, currency }) {
  const { t } = useLanguage()
  if (!data) return <EmptyState />
  const { seasons, cpkByMonth, maxCost, maxFail, worstCostMonth } = data

  const cpkBar = {
    labels: MONTH_LABELS.map(m => t(`advancedanalytics.months.${m.toLowerCase()}`)),
    datasets: [{
      label: t('advancedanalytics.seasonal.avgCpkCur', { currency }),
      data: cpkByMonth,
      backgroundColor: cpkByMonth.map(v =>
        v == null ? 'rgba(59,130,246,0.2)' : 'rgba(59,130,246,0.75)'
      ),
      borderColor: '#3b82f6',
      borderWidth: 1,
      borderRadius: 4,
    }],
  }

  const failBar = {
    labels: MONTH_LABELS.map(m => t(`advancedanalytics.months.${m.toLowerCase()}`)),
    datasets: [{
      label: t('advancedanalytics.seasonal.failureRatePct'),
      data: seasons.map(s => s.highRiskRate * 100),
      backgroundColor: seasons.map(s => {
        const v = s.highRiskRate * 100
        if (v > 20) return 'rgba(239,68,68,0.75)'
        if (v > 10) return 'rgba(245,158,11,0.75)'
        return 'rgba(16,185,129,0.75)'
      }),
      borderWidth: 0,
      borderRadius: 4,
    }],
  }

  // Heat map values
  const heatMetrics = ['Count', 'Failure Rate %', 'Avg Cost']
  const heatAllVals = seasons.flatMap(s => [s.count, s.highRiskRate * 100, s.cost / (s.count || 1)])
  const heatMin = Math.min(...heatAllVals, 0)
  const heatMax = Math.max(...heatAllVals, 1)

  return (
    <div className="space-y-5">
      {/* Auto-insight */}
      {worstCostMonth && (
        <div className="flex items-start gap-2 bg-yellow-900/20 border border-yellow-800/40 rounded-xl px-4 py-3">
          <Info size={15} className="text-yellow-400 mt-0.5 shrink-0" />
          <p className="text-xs text-yellow-300">
            <strong>{worstCostMonth.month}</strong> {t('advancedanalytics.seasonal.insight', { cost: fmtCur(worstCostMonth.cost, currency) })}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartBox title={t('advancedanalytics.seasonal.cpkChart')} height={250}>
          <Bar data={cpkBar} options={{
            ...NO_LEGEND_OPTS,
            scales: {
              ...NO_LEGEND_OPTS.scales,
              y: { ...NO_LEGEND_OPTS.scales.y, ticks: { ...NO_LEGEND_OPTS.scales.y.ticks, callback: v => `${currency} ${Number(v).toFixed(4)}` } },
            },
          }} />
        </ChartBox>
        <ChartBox title={t('advancedanalytics.seasonal.failChart')} height={250}>
          <Bar data={failBar} options={NO_LEGEND_OPTS} />
        </ChartBox>
      </div>

      {/* Heat map table */}
      <Card>
        <SectionTitle>{t('advancedanalytics.seasonal.heatTitle')}</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--input-border)]">
                <th className="text-left py-2 pr-3 text-[var(--text-muted)] font-medium w-16">{t('advancedanalytics.seasonal.month')}</th>
                <th className="text-right py-2 px-2 text-[var(--text-muted)] font-medium">{t('advancedanalytics.seasonal.count')}</th>
                <th className="text-right py-2 px-2 text-[var(--text-muted)] font-medium">{t('advancedanalytics.seasonal.failurePct')}</th>
                <th className="text-right py-2 px-2 text-[var(--text-muted)] font-medium">{t('advancedanalytics.seasonal.totalCost')}</th>
                <th className="text-right py-2 px-2 text-[var(--text-muted)] font-medium">{t('advancedanalytics.seasonal.avgCost')}</th>
                <th className="text-right py-2 px-2 text-[var(--text-muted)] font-medium">{t('advancedanalytics.seasonal.blowouts')}</th>
              </tr>
            </thead>
            <tbody>
              {seasons.map((s, i) => (
                <tr key={i} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/20">
                  <td className="py-1.5 pr-3 font-medium text-[var(--text-secondary)]">{s.month}</td>
                  <td className="py-1.5 px-2 text-right" style={{ backgroundColor: heatColor(s.count, heatMin, heatMax) }}>
                    {fmt(s.count)}
                  </td>
                  <td className="py-1.5 px-2 text-right" style={{ backgroundColor: heatColor(s.highRiskRate * 100, 0, 30) }}>
                    {fmtPct(s.highRiskRate * 100)}
                  </td>
                  <td className="py-1.5 px-2 text-right" style={{ backgroundColor: heatColor(s.cost, heatMin, maxCost) }}>
                    {fmtCur(s.cost, currency)}
                  </td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-secondary)]">
                    {s.count ? fmtCur(s.cost / s.count, currency) : '-'}
                  </td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-secondary)]">{fmt(s.blowouts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ── Tab 3: Geographic Analysis ─────────────────────────────────────────────────
function GeoTab({ data, currency }) {
  if (!data) return <EmptyState />
  const { sites, allMonths, heatmap, heatMin, heatMax } = data
  const top15 = sites.slice(0, 15)

  const costBar = {
    labels: top15.map(s => s.site),
    datasets: [{
      label: `Total Cost (${currency})`,
      data: top15.map(s => s.totalCost),
      backgroundColor: PALETTE.map(c => c + 'bb'),
      borderColor: PALETTE,
      borderWidth: 1,
      borderRadius: 4,
    }],
  }

  const cpkBar = {
    labels: top15.map(s => s.site),
    datasets: [{
      label: 'Avg CPK',
      data: top15.map(s => {
        const recs = data.sites.find(x => x.site === s.site)
        return recs ? null : null
      }),
    }],
  }

  const failBar = {
    labels: top15.map(s => s.site),
    datasets: [{
      label: 'High Risk %',
      data: top15.map(s => s.highRiskPct),
      backgroundColor: top15.map(s =>
        s.highRiskPct > 25 ? 'rgba(239,68,68,0.75)' :
        s.highRiskPct > 15 ? 'rgba(245,158,11,0.75)' : 'rgba(16,185,129,0.75)'
      ),
      borderWidth: 0,
      borderRadius: 4,
    }],
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartBox title="Total Cost by Site (Top 15)" height={280}>
          <Bar data={costBar} options={H_BAR_OPTS} />
        </ChartBox>
        <ChartBox title="High-Risk Rate % by Site" height={280}>
          <Bar data={failBar} options={{
            ...H_BAR_OPTS,
            scales: {
              ...H_BAR_OPTS.scales,
              x: { ...H_BAR_OPTS.scales.x, ticks: { ...H_BAR_OPTS.scales.x.ticks, callback: v => `${Number(v).toFixed(0)}%` } },
            },
          }} />
        </ChartBox>
      </div>

      {/* Site summary table */}
      <Card>
        <SectionTitle>Site Performance Summary</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--input-border)]">
                {['Site','Records','Total Cost','Avg Cost','High Risk %','Risk Score','Top Category','Top Brand'].map(h => (
                  <th key={h} className="text-right first:text-left py-2 px-2 text-[var(--text-muted)] font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {top15.map((s, i) => (
                <tr key={i} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/20">
                  <td className="py-1.5 px-2 text-[var(--text-secondary)] font-medium">{s.site}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-secondary)]">{fmt(s.count)}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-secondary)]">{fmtCur(s.totalCost, currency)}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-secondary)]">{fmtCur(s.avgCost, currency)}</td>
                  <td className={`py-1.5 px-2 text-right font-medium ${s.highRiskPct > 20 ? 'text-red-400' : s.highRiskPct > 10 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                    {fmtPct(s.highRiskPct)}
                  </td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-muted)]">{fmt(s.riskScore, 2)}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-muted)]">{s.topCategory}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-muted)]">{s.topBrand}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Site × Month Heatmap */}
      {heatmap.length > 0 && allMonths.length > 0 && (
        <Card>
          <SectionTitle>Site × Month Failure Rate Heat Map (Last 12 Months)</SectionTitle>
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr className="border-b border-[var(--input-border)]">
                  <th className="text-left py-2 pr-4 text-[var(--text-muted)] font-medium min-w-[120px]">Site</th>
                  {allMonths.map(m => (
                    <th key={m} className="text-center py-2 px-1 text-[var(--text-muted)] font-medium min-w-[52px]">{m.slice(5)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmap.map((row, i) => (
                  <tr key={i} className="border-b border-[var(--input-border)]/30">
                    <td className="py-1.5 pr-4 text-[var(--text-secondary)] font-medium">{row.site}</td>
                    {row.row.map((v, j) => (
                      <td
                        key={j}
                        className="py-1.5 px-1 text-center text-[var(--text-secondary)]"
                        style={{ backgroundColor: v != null ? heatColor(v, heatMin, heatMax) : 'transparent' }}
                      >
                        {v != null ? `${v.toFixed(0)}%` : '-'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

// ── Tab 4: Country Comparison ──────────────────────────────────────────────────
function CountryTab({ data, currency, sortField, sortDir, onSort, sortedRows }) {
  if (!data) return <EmptyState />
  const { regions } = data
  if (!regions.length) return <EmptyState />

  const sorted = sortedRows(regions, sortField, sortDir)

  const costBar = {
    labels: regions.map(r => r.region),
    datasets: [{
      label: `Total Cost (${currency})`,
      data: regions.map(r => r.totalCost),
      backgroundColor: PALETTE.map(c => c + 'bb'),
      borderColor: PALETTE,
      borderWidth: 1,
      borderRadius: 4,
    }],
  }

  const cpkBar = {
    labels: regions.map(r => r.region),
    datasets: [{
      label: 'Avg CPK',
      data: regions.map(r => r.avgCpk),
      backgroundColor: 'rgba(16,185,129,0.7)',
      borderColor: '#10b981',
      borderWidth: 1,
      borderRadius: 4,
    }],
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartBox title="Total Cost by Country/Region" height={260}>
          <Bar data={costBar} options={NO_LEGEND_OPTS} />
        </ChartBox>
        <ChartBox title="Average CPK by Country/Region" height={260}>
          <Bar data={cpkBar} options={{
            ...NO_LEGEND_OPTS,
            scales: {
              ...NO_LEGEND_OPTS.scales,
              y: { ...NO_LEGEND_OPTS.scales.y, ticks: { ...NO_LEGEND_OPTS.scales.y.ticks, callback: v => `${Number(v).toFixed(4)}` } },
            },
          }} />
        </ChartBox>
      </div>

      <Card>
        <SectionTitle>Full Metrics by Country/Region</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--input-border)]">
                {[
                  { label: 'Region', field: 'region' },
                  { label: 'Records', field: 'count' },
                  { label: 'Sites', field: 'siteCount' },
                  { label: 'Total Cost', field: 'totalCost' },
                  { label: 'Avg CPK', field: 'avgCpk' },
                  { label: 'Failure %', field: 'failRate' },
                ].map(h => (
                  <th
                    key={h.field}
                    className="text-right first:text-left py-2 px-2 text-[var(--text-muted)] font-medium cursor-pointer hover:text-[var(--text-secondary)] select-none whitespace-nowrap"
                    onClick={() => onSort(h.field)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {h.label}
                      <SortIcon field={h.field} sortField={sortField} sortDir={sortDir} />
                    </span>
                  </th>
                ))}
                <th className="text-left py-2 px-2 text-[var(--text-muted)] font-medium">Sites</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => (
                <tr key={i} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/20">
                  <td className="py-1.5 px-2 font-medium text-[var(--text-secondary)]">{r.region}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-secondary)]">{fmt(r.count)}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-muted)]">{fmt(r.siteCount)}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-secondary)]">{fmtCur(r.totalCost, currency)}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-secondary)]">{fmtCpk(r.avgCpk, currency)}</td>
                  <td className={`py-1.5 px-2 text-right font-medium ${r.failRate > 20 ? 'text-red-400' : r.failRate > 10 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                    {fmtPct(r.failRate)}
                  </td>
                  <td className="py-1.5 px-2 text-[var(--text-muted)] text-xs truncate max-w-[200px]">{r.sites}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ── Tab 5: Branch Comparison ───────────────────────────────────────────────────
function BranchTab({ data, currency, sortField, sortDir, onSort, sortedRows }) {
  if (!data) return <EmptyState />
  const { branches } = data
  if (!branches.length) return <EmptyState />

  const top3 = branches.slice(0, 3)
  const sorted = sortedRows(branches, sortField === 'totalCost' ? 'compositeScore' : sortField, sortDir)
  const medals = [
    { icon: <Award size={16} className="text-yellow-400" />, label: 'Gold', cls: 'border-yellow-700 bg-yellow-900/20' },
    { icon: <Award size={16} className="text-[var(--text-secondary)]" />,   label: 'Silver', cls: 'border-gray-600 bg-[var(--input-bg)]/40' },
    { icon: <Award size={16} className="text-amber-700" />,  label: 'Bronze', cls: 'border-amber-800 bg-amber-900/20' },
  ]

  const scoreBar = {
    labels: branches.slice(0, 12).map(b => b.site),
    datasets: [{
      label: 'Composite Score',
      data: branches.slice(0, 12).map(b => b.compositeScore),
      backgroundColor: branches.slice(0, 12).map((_, i) =>
        i === 0 ? 'rgba(234,179,8,0.8)' : i === 1 ? 'rgba(156,163,175,0.7)' : i === 2 ? 'rgba(180,83,9,0.7)' : 'rgba(59,130,246,0.6)'
      ),
      borderWidth: 0,
      borderRadius: 4,
    }],
  }

  return (
    <div className="space-y-5">
      {/* Top 3 podium */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {top3.map((b, i) => (
          <Card key={b.site} className={`border ${medals[i]?.cls ?? ''}`}>
            <div className="flex items-center gap-2 mb-2">
              {medals[i]?.icon}
              <span className="text-xs text-[var(--text-muted)]">{medals[i]?.label} · Rank #{i + 1}</span>
            </div>
            <div className="text-base font-bold text-[var(--text-primary)] mb-1">{b.site}</div>
            <div className="flex flex-wrap gap-3 mt-2">
              <div><span className="text-xs text-[var(--text-muted)]">Score</span><div className="text-sm font-bold text-blue-400">{b.compositeScore}</div></div>
              <div><span className="text-xs text-[var(--text-muted)]">Records</span><div className="text-sm font-semibold text-[var(--text-secondary)]">{fmt(b.count)}</div></div>
              <div><span className="text-xs text-[var(--text-muted)]">Fail %</span><div className={`text-sm font-semibold ${b.failRate > 15 ? 'text-red-400' : 'text-emerald-400'}`}>{fmtPct(b.failRate)}</div></div>
              <div><span className="text-xs text-[var(--text-muted)]">Cost</span><div className="text-sm font-semibold text-[var(--text-secondary)]">{fmtCur(b.totalCost, currency)}</div></div>
            </div>
          </Card>
        ))}
      </div>

      <ChartBox title="Branch Composite Score (Top 12)" height={240}>
        <Bar data={scoreBar} options={H_BAR_OPTS} />
      </ChartBox>

      {/* Full comparison table */}
      <Card>
        <SectionTitle>Full Branch Comparison Table</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--input-border)]">
                {[
                  { label: '#',      field: '_rank' },
                  { label: 'Branch', field: 'site' },
                  { label: 'Score',  field: 'compositeScore' },
                  { label: 'Records', field: 'count' },
                  { label: 'Total Cost', field: 'totalCost' },
                  { label: 'Avg Cost', field: 'avgCost' },
                  { label: 'Avg CPK', field: 'avgCpk' },
                  { label: 'Avg Life (km)', field: 'avgLife' },
                  { label: 'Failure %', field: 'failRate' },
                  { label: 'High Risk', field: 'highRiskCount' },
                ].map(h => (
                  <th
                    key={h.field}
                    className="text-right first:text-left py-2 px-2 text-[var(--text-muted)] font-medium cursor-pointer hover:text-[var(--text-secondary)] select-none whitespace-nowrap"
                    onClick={() => h.field !== '_rank' && onSort(h.field)}
                  >
                    {h.field !== '_rank' ? (
                      <span className="inline-flex items-center gap-1">
                        {h.label}
                        <SortIcon field={h.field} sortField={sortField} sortDir={sortDir} />
                      </span>
                    ) : '#'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((b, i) => (
                <tr key={b.site} className={`border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/20 ${i < 3 ? 'bg-blue-950/10' : ''}`}>
                  <td className="py-1.5 px-2 text-[var(--text-muted)]">{i + 1}</td>
                  <td className="py-1.5 px-2 font-medium text-[var(--text-secondary)]">{b.site}</td>
                  <td className="py-1.5 px-2 text-right">
                    <span className="px-1.5 py-0.5 bg-blue-900/40 text-blue-400 rounded text-xs font-bold">{b.compositeScore}</span>
                  </td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-secondary)]">{fmt(b.count)}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-secondary)]">{fmtCur(b.totalCost, currency)}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-muted)]">{fmtCur(b.avgCost, currency)}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-muted)]">{fmtCpk(b.avgCpk, currency)}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-muted)]">{b.avgLife ? fmt(b.avgLife) : '-'}</td>
                  <td className={`py-1.5 px-2 text-right font-medium ${b.failRate > 20 ? 'text-red-400' : b.failRate > 10 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                    {fmtPct(b.failRate)}
                  </td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-muted)]">{fmt(b.highRiskCount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ── Tab 6: Vehicle Comparison ──────────────────────────────────────────────────
function VehicleTab({ data, currency, sortField, sortDir, onSort, sortedRows }) {
  if (!data) return <EmptyState />
  const { top20Cost, vehicles, outlierThreshold } = data
  if (!vehicles.length) return <EmptyState />

  const sorted = sortedRows(vehicles, sortField, sortDir)

  const costBar = {
    labels: top20Cost.map(v => v.assetNo),
    datasets: [{
      label: `Total Cost (${currency})`,
      data: top20Cost.map(v => v.totalCost),
      backgroundColor: top20Cost.map(v => v.isOutlier ? 'rgba(239,68,68,0.8)' : 'rgba(59,130,246,0.7)'),
      borderColor: top20Cost.map(v => v.isOutlier ? '#ef4444' : '#3b82f6'),
      borderWidth: 1,
      borderRadius: 3,
    }],
  }

  // Scatter: cost vs avgCpk, size by count
  const scatterData = {
    datasets: [{
      label: 'Vehicles (size = replacements)',
      data: vehicles
        .filter(v => v.totalCost > 0 && v.avgCpk != null)
        .slice(0, 100)
        .map(v => ({ x: v.avgCpk, y: v.totalCost, r: Math.min(Math.max(3, v.count), 18) })),
      backgroundColor: 'rgba(139,92,246,0.55)',
      borderColor: '#8b5cf6',
      borderWidth: 1,
    }],
  }

  const outlierCount = vehicles.filter(v => v.isOutlier).length

  return (
    <div className="space-y-5">
      {outlierCount > 0 && (
        <div className="flex items-start gap-2 bg-red-900/20 border border-red-800/40 rounded-xl px-4 py-3">
          <AlertTriangle size={15} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-xs text-red-300">
            <strong>{outlierCount} vehicle{outlierCount > 1 ? 's' : ''}</strong> flagged as CPK outliers
            (&gt;2σ above fleet average of {fmtCpk(data.cpkMean, currency)}). These vehicles are highlighted
            in red and require investigation.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartBox title="Top 20 Vehicles by Total Tyre Cost (Red = CPK Outlier)" height={300}>
          <Bar data={costBar} options={H_BAR_OPTS} />
        </ChartBox>
        <ChartBox title="Total Cost vs Avg CPK Scatter (bubble = replacement count)" height={300}>
          <Scatter data={scatterData} options={{
            ...BASE_OPTS,
            plugins: {
              ...BASE_OPTS.plugins,
              legend: { display: false },
              tooltip: {
                ...BASE_OPTS.plugins.tooltip,
                callbacks: {
                  label: ctx => {
                    const d = ctx.raw
                    return [`CPK: ${fmtCpk(d.x, currency)}`, `Cost: ${fmtCur(d.y, currency)}`, `Count: ${d.r}`]
                  },
                },
              },
            },
            scales: {
              x: { ...BASE_OPTS.scales.x, title: { display: true, text: 'Avg CPK', color: '#6b7280' } },
              y: { ...BASE_OPTS.scales.y, title: { display: true, text: `Total Cost (${currency})`, color: '#6b7280' } },
            },
          }} />
        </ChartBox>
      </div>

      <Card>
        <SectionTitle>All Vehicles: Tyre Cost Analysis</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--input-border)]">
                {[
                  { label: 'Asset No', field: 'assetNo' },
                  { label: 'Records', field: 'count' },
                  { label: 'Total Cost', field: 'totalCost' },
                  { label: 'Avg CPK', field: 'avgCpk' },
                  { label: 'Avg Life (km)', field: 'avgLife' },
                  { label: 'Failures', field: 'failCount' },
                  { label: 'Last Seen', field: 'lastSeen' },
                ].map(h => (
                  <th
                    key={h.field}
                    className="text-right first:text-left py-2 px-2 text-[var(--text-muted)] font-medium cursor-pointer hover:text-[var(--text-secondary)] select-none whitespace-nowrap"
                    onClick={() => onSort(h.field)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {h.label}
                      <SortIcon field={h.field} sortField={sortField} sortDir={sortDir} />
                    </span>
                  </th>
                ))}
                <th className="py-2 px-2 text-[var(--text-muted)] font-medium">Outlier</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 100).map((v, i) => (
                <tr key={i} className={`border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/20 ${v.isOutlier ? 'bg-red-950/20' : ''}`}>
                  <td className="py-1.5 px-2 font-medium text-[var(--text-secondary)]">{v.assetNo}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-secondary)]">{fmt(v.count)}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-secondary)]">{fmtCur(v.totalCost, currency)}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-muted)]">{fmtCpk(v.avgCpk, currency)}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-muted)]">{v.avgLife ? fmt(v.avgLife) : '-'}</td>
                  <td className={`py-1.5 px-2 text-right font-medium ${v.failCount > 3 ? 'text-red-400' : 'text-[var(--text-secondary)]'}`}>{fmt(v.failCount)}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-muted)]">{v.lastSeen || '-'}</td>
                  <td className="py-1.5 px-2 text-center">
                    {v.isOutlier && <span className="px-1.5 py-0.5 bg-red-900/50 text-red-400 rounded text-xs">⚠ High CPK</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sorted.length > 100 && (
            <p className="text-xs text-[var(--text-dim)] mt-2 text-center">Showing top 100 of {sorted.length} vehicles</p>
          )}
        </div>
      </Card>
    </div>
  )
}

// ── Tab 7: Driver Comparison ───────────────────────────────────────────────────
function DriverTab({ data, currency }) {
  if (!data) return <EmptyState />
  const { worst10, best10, hasDriverData } = data

  const worstBar = {
    labels: worst10.map(v => v.assetNo),
    datasets: [{
      label: `Total Cost (${currency})`,
      data: worst10.map(v => v.totalCost),
      backgroundColor: 'rgba(239,68,68,0.75)',
      borderColor: '#ef4444',
      borderWidth: 1,
      borderRadius: 4,
    }],
  }

  const bestBar = {
    labels: best10.map(v => v.assetNo),
    datasets: [{
      label: `Total Cost (${currency})`,
      data: best10.map(v => v.totalCost),
      backgroundColor: 'rgba(16,185,129,0.75)',
      borderColor: '#10b981',
      borderWidth: 1,
      borderRadius: 4,
    }],
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 bg-blue-900/20 border border-blue-800/40 rounded-xl px-4 py-3">
        <Info size={15} className="text-blue-400 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-300">
          {hasDriverData
            ? 'Driver name patterns detected in findings - analysis reflects both driver assignments and vehicle-level tyre consumption.'
            : 'Driver data is not available as a direct column. This analysis uses vehicle asset numbers as a proxy for driver performance, reflecting vehicle-level tyre consumption.'}
        </p>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-3 gap-4">
        <MetricTile label="Vehicles Analyzed" value={fmt(worst10.length + best10.length)} sub="sample shown" />
        <MetricTile label="Highest Cost Vehicle" value={worst10[0]?.assetNo ?? '-'} sub={fmtCur(worst10[0]?.totalCost, currency)} />
        <MetricTile label="Lowest Cost Vehicle" value={best10[0]?.assetNo ?? '-'} sub={fmtCur(best10[0]?.totalCost, currency)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
            <span className="text-sm font-semibold text-[var(--text-secondary)]">Top 10 Worst Performing Vehicles</span>
          </div>
          <ChartBox height={260}>
            <Bar data={worstBar} options={H_BAR_OPTS} />
          </ChartBox>
        </div>
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <span className="text-sm font-semibold text-[var(--text-secondary)]">Top 10 Best Performing Vehicles</span>
          </div>
          <ChartBox height={260}>
            <Bar data={bestBar} options={H_BAR_OPTS} />
          </ChartBox>
        </div>
      </div>

      <Card>
        <SectionTitle>Worst Performing Vehicle Details</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--input-border)]">
                {['Rank','Asset No','Records','Total Cost','Fail Count','Sites','Categories'].map(h => (
                  <th key={h} className="text-right first:text-left py-2 px-2 text-[var(--text-muted)] font-medium whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {worst10.map((v, i) => (
                <tr key={i} className="border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/20">
                  <td className="py-1.5 px-2 text-red-400 font-bold">{i + 1}</td>
                  <td className="py-1.5 px-2 font-medium text-[var(--text-secondary)]">{v.assetNo}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-secondary)]">{fmt(v.count)}</td>
                  <td className="py-1.5 px-2 text-right font-semibold text-red-400">{fmtCur(v.totalCost, currency)}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-muted)]">{fmt(v.highRiskCount)}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-muted)] truncate max-w-[120px]">{(v.sites || []).slice(0, 2).join(', ')}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-muted)] truncate max-w-[120px]">{(v.categories || []).slice(0, 2).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ── Tab 8: Brand Comparison ────────────────────────────────────────────────────
function BrandTab({ data, currency, sortField, sortDir, onSort, sortedRows }) {
  if (!data) return <EmptyState />
  const { brands, allMonths, brandMonthly, hasYoY } = data
  if (!brands.length) return <EmptyState />

  const sorted = sortedRows(brands, sortField === 'totalCost' ? 'score' : sortField, sortDir)

  // Scatter: CPK vs avg life
  const scatterData = {
    datasets: [{
      label: 'Brands (size = count)',
      data: brands
        .filter(b => b.avgCpk != null && b.avgLife != null)
        .map(b => ({ x: b.avgCpk, y: b.avgLife, r: Math.min(Math.max(5, Math.log1p(b.count) * 3), 20), label: b.brand })),
      backgroundColor: 'rgba(59,130,246,0.6)',
      borderColor: '#3b82f6',
      borderWidth: 1,
    }],
  }

  // Stacked monthly cost per brand
  const monthlyBar = {
    labels: allMonths,
    datasets: brandMonthly.map((b, i) => ({
      label: b.brand,
      data: b.monthly,
      backgroundColor: PALETTE[i % PALETTE.length] + 'bb',
      borderColor: PALETTE[i % PALETTE.length],
      borderWidth: 1,
      borderRadius: 2,
      stack: 'cost',
    })),
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartBox title="CPK vs Tyre Life by Brand (size = count)" height={280}>
          <Scatter data={scatterData} options={{
            ...BASE_OPTS,
            plugins: {
              ...BASE_OPTS.plugins,
              legend: { display: false },
              tooltip: {
                ...BASE_OPTS.plugins.tooltip,
                callbacks: {
                  label: ctx => {
                    const d = ctx.raw
                    return [d.label, `CPK: ${fmtCpk(d.x, currency)}`, `Life: ${fmt(d.y)} km`, `Count: ${d.r}`]
                  },
                },
              },
            },
            scales: {
              x: { ...BASE_OPTS.scales.x, title: { display: true, text: 'Avg CPK', color: '#6b7280' } },
              y: { ...BASE_OPTS.scales.y, title: { display: true, text: 'Avg Life (km)', color: '#6b7280' } },
            },
          }} />
        </ChartBox>
        <ChartBox title={`Monthly Cost by Brand (Last 12 Mo)${hasYoY ? ' · YoY data available' : ''}`} height={280}>
          <Bar data={monthlyBar} options={{
            ...BASE_OPTS,
            plugins: {
              ...BASE_OPTS.plugins,
              legend: { labels: { color: '#9ca3af', font: { size: 10 } } },
            },
            scales: {
              ...BASE_OPTS.scales,
              x: { ...BASE_OPTS.scales.x, stacked: true },
              y: { ...BASE_OPTS.scales.y, stacked: true },
            },
          }} />
        </ChartBox>
      </div>

      <Card>
        <SectionTitle>Brand Performance Ranking</SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--input-border)]">
                {[
                  { label: 'Rank', field: '_rank' },
                  { label: 'Brand', field: 'brand' },
                  { label: 'Score', field: 'score' },
                  { label: 'Records', field: 'count' },
                  { label: 'Avg CPK', field: 'avgCpk' },
                  { label: 'Avg Life (km)', field: 'avgLife' },
                  { label: 'Failure %', field: 'failureRate' },
                  { label: 'Scrap %', field: 'scrapRate' },
                  { label: 'Total Cost', field: 'totalCost' },
                  { label: 'Top Category', field: 'topCategory' },
                ].map(h => (
                  <th
                    key={h.field}
                    className="text-right first:text-left py-2 px-2 text-[var(--text-muted)] font-medium cursor-pointer hover:text-[var(--text-secondary)] select-none whitespace-nowrap"
                    onClick={() => h.field !== '_rank' && onSort(h.field)}
                  >
                    {h.field !== '_rank' ? (
                      <span className="inline-flex items-center gap-1">
                        {h.label}
                        <SortIcon field={h.field} sortField={sortField} sortDir={sortDir} />
                      </span>
                    ) : '#'}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((b, i) => (
                <tr key={i} className={`border-b border-[var(--input-border)]/50 hover:bg-[var(--input-bg)]/20 ${i === 0 ? 'bg-emerald-950/20' : ''}`}>
                  <td className="py-1.5 px-2 text-[var(--text-muted)]">
                    {i === 0 ? <Star size={12} className="text-yellow-400 inline" /> : i + 1}
                  </td>
                  <td className="py-1.5 px-2 font-medium text-[var(--text-secondary)]">{b.brand}</td>
                  <td className="py-1.5 px-2 text-right">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${b.score >= 70 ? 'bg-emerald-900/50 text-emerald-400' : b.score >= 50 ? 'bg-yellow-900/50 text-yellow-400' : 'bg-red-900/50 text-red-400'}`}>
                      {b.score}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-secondary)]">{fmt(b.count)}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-muted)]">{fmtCpk(b.avgCpk, currency)}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-muted)]">{b.avgLife ? fmt(b.avgLife) : '-'}</td>
                  <td className={`py-1.5 px-2 text-right font-medium ${b.failureRate > 20 ? 'text-red-400' : b.failureRate > 10 ? 'text-yellow-400' : 'text-emerald-400'}`}>
                    {fmtPct(b.failureRate)}
                  </td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-muted)]">{fmtPct(b.scrapRate)}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-secondary)]">{fmtCur(b.totalCost, currency)}</td>
                  <td className="py-1.5 px-2 text-right text-[var(--text-muted)]">{b.topCategory}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

// ── Tab 9: Failure Pattern Analysis ───────────────────────────────────────────
function FailureTab({ data, currency }) {
  if (!data) return <EmptyState />
  const { catEntries, posRates, brandRates, siteRates, kmCounts, months, heatmap, heatMax } = data

  if (!catEntries.length) return <EmptyState message="No high/critical risk records found in selected filters." />

  const doughnut = {
    labels: catEntries.slice(0, 8).map(([k]) => k),
    datasets: [{
      data: catEntries.slice(0, 8).map(([, v]) => v),
      backgroundColor: PALETTE.map(c => c + 'cc'),
      borderColor: PALETTE,
      borderWidth: 1,
    }],
  }

  const posBar = {
    labels: posRates.map(p => p.pos),
    datasets: [{
      label: 'Failure Rate %',
      data: posRates.map(p => p.rate),
      backgroundColor: posRates.map(p =>
        p.rate > 25 ? 'rgba(239,68,68,0.75)' : p.rate > 15 ? 'rgba(245,158,11,0.75)' : 'rgba(59,130,246,0.7)'
      ),
      borderWidth: 0,
      borderRadius: 4,
    }],
  }

  const brandFailBar = {
    labels: brandRates.map(b => b.brand),
    datasets: [{
      label: 'Failure Rate %',
      data: brandRates.map(b => b.rate),
      backgroundColor: brandRates.map((_, i) => PALETTE[i % PALETTE.length] + 'bb'),
      borderColor: brandRates.map((_, i) => PALETTE[i % PALETTE.length]),
      borderWidth: 1,
      borderRadius: 4,
    }],
  }

  const siteFailBar = {
    labels: siteRates.map(s => s.site),
    datasets: [{
      label: 'Failure Rate %',
      data: siteRates.map(s => s.rate),
      backgroundColor: siteRates.map(s =>
        s.rate > 30 ? 'rgba(239,68,68,0.8)' : s.rate > 15 ? 'rgba(245,158,11,0.75)' : 'rgba(59,130,246,0.7)'
      ),
      borderWidth: 0,
      borderRadius: 4,
    }],
  }

  const kmBar = {
    labels: kmCounts.map(b => b.label),
    datasets: [{
      label: 'Count',
      data: kmCounts.map(b => b.count),
      backgroundColor: [
        'rgba(239,68,68,0.75)',
        'rgba(245,158,11,0.75)',
        'rgba(59,130,246,0.7)',
        'rgba(16,185,129,0.7)',
        'rgba(139,92,246,0.7)',
      ],
      borderWidth: 0,
      borderRadius: 4,
    }],
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
        <MetricTile label="Total Failures" value={fmt(catEntries.reduce((s, [, v]) => s + v, 0))} sub="High + Critical records" />
        <MetricTile label="Top Failure Type" value={catEntries[0]?.[0] ?? '-'} sub={`${fmt(catEntries[0]?.[1])} records`} />
        <MetricTile label="Highest Fail Position" value={posRates[0]?.pos ?? '-'} sub={fmtPct(posRates[0]?.rate)} />
        <MetricTile label="Highest Fail Brand" value={brandRates[0]?.brand ?? '-'} sub={fmtPct(brandRates[0]?.rate)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartBox title="Failure Type Distribution" height={280}>
          <Doughnut data={doughnut} options={{
            ...BASE_OPTS,
            scales: undefined,
            plugins: {
              ...BASE_OPTS.plugins,
              legend: { position: 'right', labels: { color: '#9ca3af', font: { size: 10 }, boxWidth: 12 } },
            },
          }} />
        </ChartBox>
        <ChartBox title="Failure Rate % by Position" height={280}>
          <Bar data={posBar} options={NO_LEGEND_OPTS} />
        </ChartBox>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartBox title="Failure Rate % by Brand (Top 10)" height={260}>
          <Bar data={brandFailBar} options={H_BAR_OPTS} />
        </ChartBox>
        <ChartBox title="Failure Rate % by Site" height={260}>
          <Bar data={siteFailBar} options={H_BAR_OPTS} />
        </ChartBox>
      </div>

      <ChartBox title="Tyre Life Distribution at Removal (km buckets)" height={220}>
        <Bar data={kmBar} options={NO_LEGEND_OPTS} />
      </ChartBox>

      {/* Month × Category heatmap */}
      {heatmap.length > 0 && (
        <Card>
          <SectionTitle>Failure Seasonality: Month × Category Heat Map</SectionTitle>
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr className="border-b border-[var(--input-border)]">
                  <th className="text-left py-2 pr-4 text-[var(--text-muted)] font-medium min-w-[140px]">Category</th>
                  {months.map(m => (
                    <th key={m} className="text-center py-2 px-1 text-[var(--text-muted)] font-medium min-w-[48px]">{m.slice(5)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmap.map((row, i) => (
                  <tr key={i} className="border-b border-[var(--input-border)]/30">
                    <td className="py-1.5 pr-4 text-[var(--text-secondary)] font-medium">{row.cat}</td>
                    {row.row.map((v, j) => (
                      <td
                        key={j}
                        className="py-1.5 px-1 text-center text-[var(--text-secondary)]"
                        style={{ backgroundColor: v > 0 ? heatColor(v, 0, heatMax) : 'transparent' }}
                      >
                        {v > 0 ? v : '-'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
