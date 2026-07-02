import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { AXLE_GROUPS, GROUP_ICONS, normalizePosition } from '../lib/tyrePositions'
import PageHeader from '../components/ui/PageHeader'
import {
  MapPin, Download, FileText, AlertTriangle, CheckCircle,
  TrendingUp, TrendingDown, Minus, ChevronDown, RefreshCw,
  Activity, Layers, Truck, Settings2, BarChart3, Target,
} from 'lucide-react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  RadialLinearScale, ArcElement, Title, Tooltip, Legend, Filler, RadarController,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  RadialLinearScale, ArcElement, Title, Tooltip, Legend, Filler, RadarController,
)

// ── Constants ──────────────────────────────────────────────────────────────────
// Canonical axle groups + icons are sourced from lib/tyrePositions (single
// source of truth, shared with Upload mapping and the inspection diagrams).
const POSITIONS = AXLE_GROUPS
const POSITION_ICONS = GROUP_ICONS

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

const DATE_PRESETS = [
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '6mo', days: 180 },
  { label: '1yr', days: 365 },
  { label: 'All', days: null },
]

const COUNTRIES_ALL = ['All', 'KSA', 'UAE', 'Egypt']

const BAR_OPTS = (horizontal = false) => ({
  responsive: true,
  maintainAspectRatio: false,
  indexAxis: horizontal ? 'y' : 'x',
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { color:'var(--text-muted)' }, ticks: { color: '#9ca3af', font: { size: 11 } } },
    y: { grid: { color:'var(--text-muted)' }, ticks: { color: '#9ca3af', font: { size: 11 } } },
  },
})

const DOUGHNUT_OPTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'right',
      labels: { color: '#9ca3af', font: { size: 11 }, padding: 12, boxWidth: 12 },
    },
  },
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function recordCost(r) {
  return (r.cost_per_tyre || 0) * (r.qty || 1)
}

function safeMean(arr) {
  const valid = arr.filter(v => Number.isFinite(v) && v > 0)
  if (!valid.length) return null
  return valid.reduce((a, b) => a + b, 0) / valid.length
}

function fmtNum(n, decimals = 1) {
  if (n == null || !Number.isFinite(n)) return 'N/A'
  return n.toFixed(decimals)
}

function fmtCurrency(n, currency) {
  if (n == null || !Number.isFinite(n)) return 'N/A'
  return `${currency} ${n.toLocaleString('en', { maximumFractionDigits: 0 })}`
}

function statusBadge(failureRate) {
  if (failureRate >= 30) return { label: 'Critical', cls: 'bg-red-900/60 text-red-300 border border-red-700/40' }
  if (failureRate >= 20) return { label: 'Elevated', cls: 'bg-yellow-900/60 text-yellow-300 border border-yellow-700/40' }
  return { label: 'Normal', cls: 'bg-green-900/60 text-green-300 border border-green-700/40' }
}

function buildRecommendation(pos, metrics) {
  const { failureRate, avgCpk, avgKmLife } = metrics
  if (pos === 'Steer') {
    if (failureRate > 30) return 'Critical: High steer tyre failure rate indicates alignment or inflation issues. Inspect alignment immediately.'
    if (avgCpk != null && avgCpk > 2) return 'Steer CPK above fleet average. Review inflation pressure policy for steer axles.'
    if (failureRate > 20) return 'Elevated steer failures. Schedule alignment checks and pressure audits across fleet.'
  }
  if (pos === 'Drive') {
    if (failureRate > 25) return 'Drive axle failures elevated. Check overloading and driver behaviour records.'
    if (avgKmLife != null && avgKmLife < 30000) return 'Drive tyre life below benchmark. Evaluate brand switch or rotation policy.'
    if (failureRate > 15) return 'Drive axle failure rate above threshold. Investigate load compliance and tyre rotation intervals.'
  }
  if (pos === 'Trailer') {
    if (failureRate > 20) return 'Trailer failures above threshold. Inspect for road damage and misalignment.'
    if (failureRate > 12) return 'Trailer failure rate trending up. Review tyre inspection frequency for trailer axles.'
  }
  if (pos === 'Lift Axle') {
    if (failureRate > 20) return 'Lift axle failures elevated. Ensure correct inflation when axle is deployed.'
    if (failureRate > 10) return 'Review lift axle deployment procedures and associated tyre pressure compliance.'
  }
  if (pos === 'Tag Axle') {
    if (failureRate > 20) return 'Tag axle failures above fleet norm. Check for uneven load distribution and misalignment.'
  }
  // Generic fallback
  if (failureRate > 25) return `${pos} position showing high failure rate (${fmtNum(failureRate)}%). Immediate review required.`
  if (failureRate > 15) return `${pos} position failure rate elevated. Schedule inspection and root cause review.`
  if (avgCpk != null && avgCpk > 2.5) return `CPK for ${pos} is high (${fmtNum(avgCpk, 2)} ${''}/km). Evaluate tyre specification and brand selection.`
  return 'Position performing within acceptable parameters.'
}

function applyDatePreset(days) {
  if (!days) return { from: '', to: '' }
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - days)
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  }
}

function heatColor(rate) {
  if (!rate) return 'transparent'
  const intensity = Math.min(rate / 50, 1)
  return `rgba(239,68,68,${(intensity * 0.75).toFixed(2)})`
}

// ── Main Component ─────────────────────────────────────────────────────────────
export default function PositionIntelligence() {
  const { activeCountry, activeCurrency } = useSettings()

  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filters
  const [countryChip, setCountryChip] = useState('All')
  const [siteFilter, setSiteFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [activePreset, setActivePreset] = useState('All')

  // Tabs
  const [activeTab, setActiveTab] = useState('Steer')

  // ── Data loading ─────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const country = countryChip !== 'All' ? countryChip : (activeCountry !== 'All' ? activeCountry : null)

      const { data, error: err } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select('id,issue_date,asset_no,brand,site,country,cost_per_tyre,qty,risk_level,km_at_fitment,km_at_removal,position,category,remarks')
          .order('issue_date', { ascending: false })
        if (country) q = q.eq('country', country)
        return q.range(from, to)
      })
      if (err) throw err
      setRecords(data || [])
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [activeCountry, countryChip])

  useEffect(() => { load() }, [load])

  // ── Derived filters ───────────────────────────────────────────────────────────
  const uniqueSites = useMemo(() => {
    const s = new Set(records.map(r => r.site).filter(Boolean))
    return ['', ...([...s].sort())]
  }, [records])

  const filtered = useMemo(() => {
    return records.filter(r => {
      if (dateFrom && r.issue_date && r.issue_date < dateFrom) return false
      if (dateTo && r.issue_date && r.issue_date > dateTo) return false
      if (siteFilter && r.site !== siteFilter) return false
      return true
    })
  }, [records, dateFrom, dateTo, siteFilter])

  // ── Position metrics (core computation) ──────────────────────────────────────
  const positionMetrics = useMemo(() => {
    const byPos = {}
    POSITIONS.forEach(p => { byPos[p] = [] })

    filtered.forEach(r => {
      const pos = normalizePosition(r.position)
      byPos[pos].push(r)
    })

    return POSITIONS.map(pos => {
      const recs = byPos[pos]
      const count = recs.length
      const totalCost = recs.reduce((s, r) => s + recordCost(r), 0)
      const avgCost = count ? totalCost / count : 0

      const highRisk = recs.filter(r => {
        const lvl = (r.risk_level || '').toLowerCase()
        return lvl === 'high' || lvl === 'critical'
      })
      const criticalRecs = recs.filter(r => (r.risk_level || '').toLowerCase() === 'critical')

      const highRiskCount = highRisk.length
      const failureRate = count ? (highRiskCount / count) * 100 : 0
      const criticalRate = count ? (criticalRecs.length / count) * 100 : 0

      // CPK = cost_per_tyre / (km_at_removal - km_at_fitment)
      const cpkValues = recs
        .filter(r => r.km_at_fitment != null && r.km_at_removal != null && r.km_at_removal > r.km_at_fitment && r.cost_per_tyre > 0)
        .map(r => r.cost_per_tyre / (r.km_at_removal - r.km_at_fitment))

      const avgCpk = safeMean(cpkValues)
      const cpkValidCount = cpkValues.length

      const kmLifeValues = recs
        .filter(r => r.km_at_fitment != null && r.km_at_removal != null && r.km_at_removal > r.km_at_fitment)
        .map(r => r.km_at_removal - r.km_at_fitment)

      const avgKmLife = safeMean(kmLifeValues)

      // Pressure issues approximated from remarks/category
      const pressureIssueCount = recs.filter(r => {
        const remarks = (r.remarks || '').toLowerCase()
        const category = (r.category || '').toLowerCase()
        return remarks.includes('pressure') || remarks.includes('inflation') ||
               category.includes('pressure') || category.includes('inflation') ||
               ((r.risk_level || '').toLowerCase() === 'high' &&
                (remarks.includes('flat') || remarks.includes('blow')))
      }).length

      // Brands breakdown
      const brandMap = {}
      recs.forEach(r => {
        if (!r.brand) return
        if (!brandMap[r.brand]) brandMap[r.brand] = { brand: r.brand, recs: [], cpkVals: [] }
        brandMap[r.brand].recs.push(r)
        const km = r.km_at_removal - r.km_at_fitment
        if (r.km_at_fitment != null && r.km_at_removal != null && km > 0 && r.cost_per_tyre > 0) {
          brandMap[r.brand].cpkVals.push(r.cost_per_tyre / km)
        }
      })
      const brands = Object.values(brandMap).map(b => ({
        brand: b.brand,
        count: b.recs.length,
        avgCpk: safeMean(b.cpkVals),
        failureRate: b.recs.length
          ? (b.recs.filter(r => ['high', 'critical'].includes((r.risk_level || '').toLowerCase())).length / b.recs.length) * 100
          : 0,
        avgKmLife: safeMean(
          b.recs
            .filter(r => r.km_at_fitment != null && r.km_at_removal != null && r.km_at_removal > r.km_at_fitment)
            .map(r => r.km_at_removal - r.km_at_fitment)
        ),
      })).sort((a, b) => (a.avgCpk ?? Infinity) - (b.avgCpk ?? Infinity))

      // Top failure categories
      const catMap = {}
      recs.forEach(r => {
        const cat = r.category || 'Unclassified'
        catMap[cat] = (catMap[cat] || 0) + 1
      })
      const topFailureCauses = Object.entries(catMap)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([cat]) => cat)

      // Worst assets (highest CPK or highest failure rate)
      const assetMap = {}
      recs.forEach(r => {
        if (!r.asset_no) return
        if (!assetMap[r.asset_no]) assetMap[r.asset_no] = { asset_no: r.asset_no, recs: [] }
        assetMap[r.asset_no].recs.push(r)
      })
      const worstAssets = Object.values(assetMap).map(a => {
        const aRecs = a.recs
        const aCpkVals = aRecs
          .filter(r => r.km_at_fitment != null && r.km_at_removal != null && r.km_at_removal > r.km_at_fitment && r.cost_per_tyre > 0)
          .map(r => r.cost_per_tyre / (r.km_at_removal - r.km_at_fitment))
        const aHighRisk = aRecs.filter(r => ['high', 'critical'].includes((r.risk_level || '').toLowerCase()))
        return {
          asset_no: a.asset_no,
          count: aRecs.length,
          avgCpk: safeMean(aCpkVals),
          failureRate: aRecs.length ? (aHighRisk.length / aRecs.length) * 100 : 0,
          totalCost: aRecs.reduce((s, r) => s + recordCost(r), 0),
        }
      })
        .sort((a, b) => (b.avgCpk ?? 0) - (a.avgCpk ?? 0))
        .slice(0, 5)

      const recommendation = buildRecommendation(pos, { failureRate, avgCpk, avgKmLife })

      return {
        position: pos,
        count,
        totalCost,
        avgCost,
        highRiskCount,
        failureRate,
        criticalRate,
        avgCpk,
        avgKmLife,
        cpkValidCount,
        pressureIssueCount,
        brands,
        topFailureCauses,
        recommendation,
        worstAssets,
        catMap,
      }
    })
  }, [filtered])

  // ── Derived summaries ─────────────────────────────────────────────────────────
  const totalRecords = useMemo(() => filtered.length, [filtered])

  const worstPos = useMemo(() => {
    const withData = positionMetrics.filter(p => p.count > 0)
    if (!withData.length) return null
    return withData.reduce((a, b) => a.failureRate > b.failureRate ? a : b)
  }, [positionMetrics])

  const bestPos = useMemo(() => {
    const withData = positionMetrics.filter(p => p.count > 0 && p.avgCpk != null)
    if (!withData.length) return null
    return withData.reduce((a, b) => a.avgCpk < b.avgCpk ? a : b)
  }, [positionMetrics])

  // ── Heat map: site × position ─────────────────────────────────────────────────
  const heatMapData = useMemo(() => {
    const siteSet = new Set(filtered.map(r => r.site).filter(Boolean))
    const sites = [...siteSet].sort().slice(0, 15)

    const matrix = sites.map(site => {
      const row = { site }
      POSITIONS.forEach(pos => {
        const recs = filtered.filter(r => r.site === site && normalizePosition(r.position) === pos)
        if (!recs.length) { row[pos] = null; return }
        const high = recs.filter(r => ['high', 'critical'].includes((r.risk_level || '').toLowerCase()))
        row[pos] = recs.length ? (high.length / recs.length) * 100 : 0
      })
      return row
    })
    return { sites, matrix }
  }, [filtered])

  // ── Chart datasets ────────────────────────────────────────────────────────────
  const cpkChartData = useMemo(() => {
    const data = positionMetrics.map(p => p.avgCpk)
    return {
      labels: POSITIONS,
      datasets: [{
        label: 'Avg CPK',
        data,
        backgroundColor: data.map(v =>
          v == null ? '#374151' : v >= 2 ? '#ef4444' : v >= 1 ? '#f59e0b' : '#10b981'
        ),
        borderRadius: 4,
      }],
    }
  }, [positionMetrics])

  const failureChartData = useMemo(() => {
    const sorted = [...positionMetrics].sort((a, b) => b.failureRate - a.failureRate)
    return {
      labels: sorted.map(p => p.position),
      datasets: [{
        label: 'Failure Rate %',
        data: sorted.map(p => p.failureRate),
        backgroundColor: sorted.map(p =>
          p.failureRate > 25 ? '#ef4444' : p.failureRate > 15 ? '#f59e0b' : '#10b981'
        ),
        borderRadius: 4,
      }],
    }
  }, [positionMetrics])

  const kmLifeChartData = useMemo(() => {
    const sorted = [...positionMetrics]
      .filter(p => p.avgKmLife != null)
      .sort((a, b) => b.avgKmLife - a.avgKmLife)
    return {
      labels: sorted.map(p => p.position),
      datasets: [{
        label: 'Avg KM Life',
        data: sorted.map(p => p.avgKmLife),
        backgroundColor: '#3b82f6',
        borderRadius: 4,
      }],
    }
  }, [positionMetrics])

  const costDoughnutData = useMemo(() => {
    const withCost = positionMetrics.filter(p => p.totalCost > 0)
    return {
      labels: withCost.map(p => p.position),
      datasets: [{
        data: withCost.map(p => p.totalCost),
        backgroundColor: CHART_COLORS.slice(0, withCost.length),
        borderColor: 'rgba(0,0,0,0.3)',
        borderWidth: 2,
      }],
    }
  }, [positionMetrics])

  // ── Export helpers ────────────────────────────────────────────────────────────
  function handleExcelExport() {
    const rows = positionMetrics.map(p => ({
      position: p.position,
      count: p.count,
      failureRate: fmtNum(p.failureRate),
      avgCpk: fmtNum(p.avgCpk, 4),
      avgKmLife: p.avgKmLife ? Math.round(p.avgKmLife) : '',
      totalCost: Math.round(p.totalCost),
      highRiskCount: p.highRiskCount,
      recommendation: p.recommendation,
    }))
    exportToExcel(
      rows,
      ['position', 'count', 'failureRate', 'avgCpk', 'avgKmLife', 'totalCost', 'highRiskCount', 'recommendation'],
      ['Position', 'Records', 'Failure Rate %', 'Avg CPK', 'Avg KM Life', 'Total Cost', 'High Risk Count', 'Recommendation'],
      'position-intelligence',
      'Position Summary',
    )
  }

  function handlePdfExport() {
    const rows = positionMetrics.map(p => ({
      position: p.position,
      count: p.count,
      failureRate: fmtNum(p.failureRate) + '%',
      avgCpk: p.avgCpk != null ? fmtNum(p.avgCpk, 4) : 'N/A',
      avgKmLife: p.avgKmLife ? Math.round(p.avgKmLife).toLocaleString() + ' km' : 'N/A',
      totalCost: fmtCurrency(p.totalCost, activeCurrency),
    }))
    exportToPdf(
      rows,
      ['position', 'count', 'failureRate', 'avgCpk', 'avgKmLife', 'totalCost'],
      ['Position', 'Records', 'Failure Rate', 'Avg CPK', 'Avg KM Life', 'Total Cost'],
      'Tyre Position Intelligence Report',
      'position-intelligence',
    )
  }

  // ── Tab metric ────────────────────────────────────────────────────────────────
  const activeMetrics = useMemo(() =>
    positionMetrics.find(p => p.position === activeTab) || positionMetrics[0],
    [positionMetrics, activeTab]
  )

  // ── Corrective action recommendations ────────────────────────────────────────
  const correctiveRecs = useMemo(() =>
    positionMetrics.filter(p => p.count > 0 && p.failureRate > 20),
    [positionMetrics]
  )

  // ── Loading / Error ───────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4 text-gray-400">
        <RefreshCw className="animate-spin" size={32} />
        <span className="text-sm">Analyzing tyre position data...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-red-400">
        <AlertTriangle size={32} />
        <span className="text-sm">{error}</span>
        <button className="btn-secondary text-xs" onClick={load}>Retry</button>
      </div>
    )
  }

  if (totalRecords === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3 text-gray-500">
        <MapPin size={32} />
        <span className="text-sm">No position data available. Ensure tyre records include position field.</span>
        <button className="btn-secondary text-xs" onClick={load}>Reload</button>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 pb-10">

      <PageHeader
        title="Tyre Position Intelligence"
        subtitle="Performance analysis by axle position - fastest wear, highest cost, failure-prone positions"
        icon={MapPin}
        actions={
          <div className="flex items-center gap-2">
            <button className="btn-secondary text-xs flex items-center gap-1" onClick={handleExcelExport}>
              <Download size={14} /> Excel
            </button>
            <button className="btn-secondary text-xs flex items-center gap-1" onClick={handlePdfExport}>
              <FileText size={14} /> PDF
            </button>
          </div>
        }
      />
      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="card flex flex-wrap items-center gap-3">
        {/* Country chips */}
        <div className="flex items-center gap-1">
          {COUNTRIES_ALL.map(c => (
            <button
              key={c}
              onClick={() => setCountryChip(c)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                countryChip === c
                  ? 'bg-green-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Site select */}
        <select
          className="input text-sm py-1 pl-3 pr-8 min-w-[140px]"
          value={siteFilter}
          onChange={e => setSiteFilter(e.target.value)}
        >
          <option value="">All Sites</option>
          {uniqueSites.filter(Boolean).map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        {/* Date presets */}
        <div className="flex items-center gap-1">
          {DATE_PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => {
                setActivePreset(p.label)
                const { from, to } = applyDatePreset(p.days)
                setDateFrom(from)
                setDateTo(to)
              }}
              className={`px-3 py-1 rounded text-xs font-medium transition-all ${
                activePreset === p.label
                  ? 'bg-green-700 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Manual date range */}
        <div className="flex items-center gap-2">
          <input
            type="date"
            className="input text-xs py-1 px-2"
            value={dateFrom}
            onChange={e => { setDateFrom(e.target.value); setActivePreset('') }}
          />
          <span className="text-gray-500 text-xs">-</span>
          <input
            type="date"
            className="input text-xs py-1 px-2"
            value={dateTo}
            onChange={e => { setDateTo(e.target.value); setActivePreset('') }}
          />
        </div>

        <button className="btn-secondary text-xs" onClick={load}>
          <RefreshCw size={13} /> Refresh
        </button>

        <span className="ml-auto text-xs text-gray-500">{totalRecords.toLocaleString()} records</span>
      </div>

      {/* ── Section 1: Position Summary Cards ──────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
          <Layers size={15} className="text-green-400" /> Position Summary
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {positionMetrics.map(p => {
            const badge = statusBadge(p.failureRate)
            const isWorst = worstPos && p.position === worstPos.position && p.count > 0
            const isBest = bestPos && p.position === bestPos.position && p.count > 0 && !isWorst
            const borderCls = isWorst
              ? 'border-red-500/60 shadow-[0_0_18px_rgba(239,68,68,0.25)]'
              : isBest
              ? 'border-green-500/60 shadow-[0_0_18px_rgba(34,197,94,0.2)]'
              : ''

            return (
              <div
                key={p.position}
                className={`card cursor-pointer transition-all hover:scale-[1.02] ${borderCls}`}
                onClick={() => setActiveTab(p.position)}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-base">{POSITION_ICONS[p.position]}</span>
                  {isWorst && <span className="text-[10px] bg-red-900/50 text-red-400 px-1.5 py-0.5 rounded font-medium">Worst</span>}
                  {isBest && <span className="text-[10px] bg-green-900/50 text-green-400 px-1.5 py-0.5 rounded font-medium">Best</span>}
                </div>
                <p className="text-xs font-semibold text-white mb-2">{p.position}</p>

                {p.count === 0 ? (
                  <p className="text-xs text-gray-600 italic">No data</p>
                ) : (
                  <>
                    <div className="space-y-1.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Records</span>
                        <span className="text-gray-200 font-medium">{p.count}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Failure Rate</span>
                        <span className={`font-semibold ${p.failureRate >= 30 ? 'text-red-400' : p.failureRate >= 20 ? 'text-yellow-400' : 'text-green-400'}`}>
                          {fmtNum(p.failureRate)}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Avg CPK</span>
                        <span className="text-gray-200">
                          {p.avgCpk != null ? fmtNum(p.avgCpk, 3) : 'N/A'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Avg Life</span>
                        <span className="text-gray-200">
                          {p.avgKmLife != null ? `${Math.round(p.avgKmLife / 1000).toLocaleString()}k km` : 'N/A'}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>{badge.label}</span>
                      <span className="text-[10px] text-gray-500">
                        {p.avgCpk != null
                          ? p.avgCpk < 1.0 ? <span className="text-green-400">▲ efficient</span>
                            : p.avgCpk < 2.0 ? <span className="text-yellow-400">- moderate</span>
                            : <span className="text-red-400">▼ costly</span>
                          : ''}
                      </span>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Section 2: Charts 2×2 ──────────────────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
          <BarChart3 size={15} className="text-green-400" /> Position Analytics
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Chart 1: CPK by Position (horizontal bar) */}
          <div className="card">
            <p className="text-xs font-semibold text-gray-300 mb-3">CPK by Position ({activeCurrency}/km)</p>
            <div style={{ height: 260 }}>
              <Bar
                data={cpkChartData}
                options={{
                  ...BAR_OPTS(true),
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      callbacks: {
                        label: ctx => ctx.raw != null
                          ? `${activeCurrency} ${Number(ctx.raw).toFixed(4)}/km`
                          : 'N/A',
                      },
                    },
                  },
                  scales: {
                    x: {
                      grid: { color:'var(--text-muted)' },
                      ticks: { color: '#9ca3af', font: { size: 10 } },
                    },
                    y: {
                      grid: { color:'var(--text-muted)' },
                      ticks: { color: '#9ca3af', font: { size: 10 } },
                    },
                  },
                }}
              />
            </div>
            <p className="text-[10px] text-gray-600 mt-1">Green &lt;1.0 · Yellow 1.0-2.0 · Red ≥2.0</p>
          </div>

          {/* Chart 2: Failure Rate by Position */}
          <div className="card">
            <p className="text-xs font-semibold text-gray-300 mb-3">Failure Rate by Position (%)</p>
            <div style={{ height: 260 }}>
              <Bar
                data={failureChartData}
                options={{
                  ...BAR_OPTS(false),
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      callbacks: {
                        label: ctx => `${Number(ctx.raw).toFixed(1)}%`,
                      },
                    },
                  },
                  scales: {
                    x: { grid: { color:'var(--text-muted)' }, ticks: { color: '#9ca3af', font: { size: 10 } } },
                    y: {
                      grid: { color:'var(--text-muted)' },
                      ticks: { color: '#9ca3af', font: { size: 10 }, callback: v => `${v}%` },
                    },
                  },
                }}
              />
            </div>
            <p className="text-[10px] text-gray-600 mt-1">Red &gt;25% · Yellow &gt;15% · Green ≤15%</p>
          </div>

          {/* Chart 3: Avg KM Life by Position */}
          <div className="card">
            <p className="text-xs font-semibold text-gray-300 mb-3">Average Tyre Life by Position (km)</p>
            {kmLifeChartData.labels.length === 0 ? (
              <div className="flex items-center justify-center h-[260px] text-gray-600 text-xs">No km data available</div>
            ) : (
              <div style={{ height: 260 }}>
                <Bar
                  data={kmLifeChartData}
                  options={{
                    ...BAR_OPTS(false),
                    plugins: {
                      legend: { display: false },
                      tooltip: {
                        callbacks: {
                          label: ctx => `${Math.round(ctx.raw).toLocaleString()} km`,
                        },
                      },
                    },
                    scales: {
                      x: { grid: { color:'var(--text-muted)' }, ticks: { color: '#9ca3af', font: { size: 10 } } },
                      y: {
                        grid: { color:'var(--text-muted)' },
                        ticks: { color: '#9ca3af', font: { size: 10 }, callback: v => `${(v / 1000).toFixed(0)}k` },
                      },
                    },
                  }}
                />
              </div>
            )}
          </div>

          {/* Chart 4: Cost Distribution (doughnut) */}
          <div className="card">
            <p className="text-xs font-semibold text-gray-300 mb-3">Cost Distribution by Position</p>
            {costDoughnutData.labels.length === 0 ? (
              <div className="flex items-center justify-center h-[260px] text-gray-600 text-xs">No cost data available</div>
            ) : (
              <div style={{ height: 260 }}>
                <Doughnut
                  data={costDoughnutData}
                  options={{
                    ...DOUGHNUT_OPTS,
                    plugins: {
                      ...DOUGHNUT_OPTS.plugins,
                      tooltip: {
                        callbacks: {
                          label: ctx => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0)
                            const pct = total ? ((ctx.raw / total) * 100).toFixed(1) : 0
                            return `${ctx.label}: ${activeCurrency} ${Math.round(ctx.raw).toLocaleString()} (${pct}%)`
                          },
                        },
                      },
                    },
                  }}
                />
              </div>
            )}
          </div>

        </div>
      </div>

      {/* ── Section 3: Site × Position Heat Map ────────────────────────────── */}
      {heatMapData.sites.length >= 2 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <Activity size={15} className="text-green-400" /> Site × Position Failure Rate Heat Map
          </h2>
          <div className="card overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr>
                  <th className="table-header text-left pr-4 py-2 sticky left-0 bg-[var(--surface-1)] z-10">Site</th>
                  {POSITIONS.map(pos => (
                    <th key={pos} className="table-header text-center px-3 py-2 whitespace-nowrap">
                      {POSITION_ICONS[pos]} {pos}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatMapData.matrix.map((row, i) => (
                  <tr key={row.site} className={i % 2 === 0 ? 'bg-transparent' : 'bg-white/[0.02]'}>
                    <td className="table-cell pr-4 py-2 font-medium text-gray-300 sticky left-0 bg-[var(--surface-1)] z-10 whitespace-nowrap">
                      {row.site}
                    </td>
                    {POSITIONS.map(pos => {
                      const val = row[pos]
                      return (
                        <td
                          key={pos}
                          className="table-cell text-center px-3 py-2"
                          style={{ backgroundColor: heatColor(val) }}
                        >
                          {val != null ? (
                            <span className={`font-semibold ${val >= 30 ? 'text-red-200' : val >= 15 ? 'text-yellow-200' : 'text-gray-300'}`}>
                              {fmtNum(val)}%
                            </span>
                          ) : (
                            <span className="text-gray-700">-</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-gray-600 mt-2">Red = high failure rate. Blank cells = no data.</p>
          </div>
        </div>
      )}

      {/* ── Section 4: Per-Position Deep Dive ──────────────────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
          <Target size={15} className="text-green-400" /> Position Deep Dive
        </h2>

        {/* Tab Row */}
        <div className="flex flex-wrap gap-1 mb-4">
          {POSITIONS.map(pos => {
            const m = positionMetrics.find(p => p.position === pos)
            const hasData = m && m.count > 0
            return (
              <button
                key={pos}
                onClick={() => setActiveTab(pos)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  activeTab === pos
                    ? 'bg-green-700 text-white'
                    : hasData
                    ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    : 'bg-gray-900 text-gray-600 cursor-default'
                }`}
              >
                {POSITION_ICONS[pos]} {pos}
                {hasData && <span className="ml-1.5 text-[10px] opacity-70">({m.count})</span>}
              </button>
            )
          })}
        </div>

        {activeMetrics && activeMetrics.count === 0 ? (
          <div className="card text-center py-8 text-gray-600 text-sm">No data for {activeTab} position</div>
        ) : activeMetrics && (
          <div className="space-y-4">

            {/* 1. Key stats strip */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {[
                { label: 'Records', value: activeMetrics.count.toLocaleString(), color: 'text-white' },
                {
                  label: 'Failure Rate',
                  value: `${fmtNum(activeMetrics.failureRate)}%`,
                  color: activeMetrics.failureRate >= 30 ? 'text-red-400' : activeMetrics.failureRate >= 20 ? 'text-yellow-400' : 'text-green-400',
                },
                {
                  label: 'Avg CPK',
                  value: activeMetrics.avgCpk != null ? `${activeCurrency} ${fmtNum(activeMetrics.avgCpk, 4)}` : 'N/A',
                  color: activeMetrics.avgCpk != null
                    ? activeMetrics.avgCpk >= 2 ? 'text-red-400' : activeMetrics.avgCpk >= 1 ? 'text-yellow-400' : 'text-green-400'
                    : 'text-gray-500',
                },
                {
                  label: 'Avg KM Life',
                  value: activeMetrics.avgKmLife != null ? `${Math.round(activeMetrics.avgKmLife).toLocaleString()} km` : 'N/A',
                  color: 'text-blue-300',
                },
                {
                  label: 'Total Cost',
                  value: fmtCurrency(activeMetrics.totalCost, activeCurrency),
                  color: 'text-white',
                },
                {
                  label: 'High Risk',
                  value: activeMetrics.highRiskCount.toLocaleString(),
                  color: activeMetrics.highRiskCount > 0 ? 'text-red-400' : 'text-gray-400',
                },
              ].map(stat => (
                <div key={stat.label} className="card py-3 px-4">
                  <p className="text-[10px] text-gray-500 mb-1">{stat.label}</p>
                  <p className={`text-sm font-bold ${stat.color}`}>{stat.value}</p>
                </div>
              ))}
            </div>

            {/* 2+3: Brands table + Recommendation side by side */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

              {/* Brands table */}
              <div className="card lg:col-span-2 overflow-x-auto">
                <p className="text-xs font-semibold text-gray-300 mb-3">Brand Performance - {activeTab}</p>
                {activeMetrics.brands.length === 0 ? (
                  <p className="text-xs text-gray-600 italic">No brand data</p>
                ) : (
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr>
                        <th className="table-header text-left py-2 pr-4">Brand</th>
                        <th className="table-header text-right py-2 px-3">Records</th>
                        <th className="table-header text-right py-2 px-3">Avg CPK</th>
                        <th className="table-header text-right py-2 px-3">Failure %</th>
                        <th className="table-header text-right py-2 px-3">Avg KM Life</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeMetrics.brands.map((b, i) => (
                        <tr key={b.brand} className={i % 2 === 0 ? '' : 'bg-white/[0.02]'}>
                          <td className="table-cell py-2 pr-4 font-medium text-gray-200">{b.brand}</td>
                          <td className="table-cell py-2 px-3 text-right text-gray-300">{b.count}</td>
                          <td className={`table-cell py-2 px-3 text-right font-semibold ${
                            b.avgCpk == null ? 'text-gray-600' : b.avgCpk >= 2 ? 'text-red-400' : b.avgCpk >= 1 ? 'text-yellow-400' : 'text-green-400'
                          }`}>
                            {b.avgCpk != null ? fmtNum(b.avgCpk, 4) : 'N/A'}
                          </td>
                          <td className={`table-cell py-2 px-3 text-right font-semibold ${
                            b.failureRate >= 25 ? 'text-red-400' : b.failureRate >= 15 ? 'text-yellow-400' : 'text-green-400'
                          }`}>
                            {fmtNum(b.failureRate)}%
                          </td>
                          <td className="table-cell py-2 px-3 text-right text-gray-300">
                            {b.avgKmLife != null ? `${Math.round(b.avgKmLife).toLocaleString()} km` : 'N/A'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Recommendation box */}
              <div className="card border-amber-700/40 bg-amber-950/20">
                <div className="flex items-start gap-2 mb-3">
                  <AlertTriangle size={15} className="text-amber-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs font-semibold text-amber-300">Engineering Recommendation</p>
                </div>
                <p className="text-xs text-amber-200/80 leading-relaxed">{activeMetrics.recommendation}</p>

                {activeMetrics.topFailureCauses.length > 0 && (
                  <div className="mt-4">
                    <p className="text-[10px] font-semibold text-gray-500 mb-2">Top Failure Categories</p>
                    <div className="space-y-1">
                      {activeMetrics.topFailureCauses.map(cat => {
                        const catCount = activeMetrics.catMap[cat] || 0
                        const pct = activeMetrics.count ? (catCount / activeMetrics.count) * 100 : 0
                        return (
                          <div key={cat}>
                            <div className="flex justify-between text-[10px] mb-0.5">
                              <span className="text-gray-400 truncate max-w-[140px]">{cat}</span>
                              <span className="text-gray-300 ml-2">{catCount} ({fmtNum(pct)}%)</span>
                            </div>
                            <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-amber-500 rounded-full"
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 4. Worst assets at this position */}
            {activeMetrics.worstAssets.length > 0 && (
              <div className="card overflow-x-auto">
                <p className="text-xs font-semibold text-gray-300 mb-3">Worst Assets - {activeTab} (Top 5 by CPK)</p>
                <table className="min-w-full text-xs">
                  <thead>
                    <tr>
                      <th className="table-header text-left py-2 pr-4">Asset</th>
                      <th className="table-header text-right py-2 px-3">Records</th>
                      <th className="table-header text-right py-2 px-3">Avg CPK</th>
                      <th className="table-header text-right py-2 px-3">Failure Rate</th>
                      <th className="table-header text-right py-2 px-3">Total Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeMetrics.worstAssets.map((a, i) => (
                      <tr key={a.asset_no} className={i % 2 === 0 ? '' : 'bg-white/[0.02]'}>
                        <td className="table-cell py-2 pr-4 font-medium text-gray-200">{a.asset_no}</td>
                        <td className="table-cell py-2 px-3 text-right text-gray-300">{a.count}</td>
                        <td className={`table-cell py-2 px-3 text-right font-semibold ${
                          a.avgCpk == null ? 'text-gray-600' : a.avgCpk >= 2 ? 'text-red-400' : a.avgCpk >= 1 ? 'text-yellow-400' : 'text-green-400'
                        }`}>
                          {a.avgCpk != null ? fmtNum(a.avgCpk, 4) : 'N/A'}
                        </td>
                        <td className={`table-cell py-2 px-3 text-right font-semibold ${
                          a.failureRate >= 25 ? 'text-red-400' : a.failureRate >= 15 ? 'text-yellow-400' : 'text-green-400'
                        }`}>
                          {fmtNum(a.failureRate)}%
                        </td>
                        <td className="table-cell py-2 px-3 text-right text-gray-300">
                          {fmtCurrency(a.totalCost, activeCurrency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

          </div>
        )}
      </div>

      {/* ── Section 5: Corrective Action Recommendations ─────────────────── */}
      <div>
        <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
          <Settings2 size={15} className="text-green-400" /> Corrective Action Recommendations
        </h2>

        {correctiveRecs.length === 0 ? (
          <div className="card flex items-center gap-3 py-4 border-green-700/40 bg-green-950/20">
            <CheckCircle size={18} className="text-green-400 flex-shrink-0" />
            <div>
              <p className="text-sm font-semibold text-green-300">All Positions Within Acceptable Parameters</p>
              <p className="text-xs text-green-400/70 mt-0.5">No positions currently exceed the 20% failure rate threshold.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {correctiveRecs.map(p => {
              const severity = p.failureRate >= 30 ? 'Critical' : 'Elevated'
              const severityCls = severity === 'Critical'
                ? 'bg-red-900/50 text-red-300 border-red-700/40'
                : 'bg-yellow-900/50 text-yellow-300 border-yellow-700/40'
              const potentialSavings = p.totalCost * (p.failureRate / 100) * 0.3
              const fleetAvgFailure = positionMetrics
                .filter(pm => pm.count > 0)
                .reduce((s, pm) => s + pm.failureRate, 0) /
                Math.max(positionMetrics.filter(pm => pm.count > 0).length, 1)
              const multiplier = fleetAvgFailure > 0 ? (p.failureRate / fleetAvgFailure).toFixed(1) : '-'

              return (
                <div key={p.position} className={`card border ${severity === 'Critical' ? 'border-red-700/40 bg-red-950/15' : 'border-yellow-700/40 bg-yellow-950/15'}`}>
                  <div className="flex flex-col md:flex-row md:items-start gap-4">
                    <div className="flex items-center gap-3 min-w-[180px]">
                      <span className="text-2xl">{POSITION_ICONS[p.position]}</span>
                      <div>
                        <p className="text-sm font-bold text-white">{p.position} Axle</p>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${severityCls}`}>
                          {severity}
                        </span>
                      </div>
                    </div>
                    <div className="flex-1 space-y-2">
                      <p className="text-xs text-gray-300">
                        <span className="font-semibold text-white">{fmtNum(p.failureRate)}% failure rate</span>
                        {' '}- {multiplier}× fleet average.{' '}
                        {p.highRiskCount} high/critical risk records from {p.count} total.
                      </p>
                      <p className="text-xs text-gray-400 leading-relaxed">{p.recommendation}</p>
                    </div>
                    <div className="card bg-black/20 border-0 py-2 px-3 min-w-[160px] text-center">
                      <p className="text-[10px] text-gray-500 mb-0.5">Est. Potential Savings</p>
                      <p className="text-sm font-bold text-green-300">{fmtCurrency(potentialSavings, activeCurrency)}</p>
                      <p className="text-[9px] text-gray-600 mt-0.5">30% failure reduction</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

    </div>
  )
}
