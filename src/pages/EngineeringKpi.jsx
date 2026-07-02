import { useState, useEffect, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings, COUNTRIES } from '../contexts/SettingsContext'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import {
  computeAllKpis,
  computeCpkByBrand,
  computeWorkshopPerformance,
} from '../lib/kpiEngine'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import {
  Cpu, Download, FileText, TrendingUp, TrendingDown, Minus,
  AlertTriangle, CheckCircle, XCircle, Info, Mail,
} from 'lucide-react'
import { motion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'
import EmailReportModal from '../components/EmailReportModal'

ChartJS.register(
  CategoryScale, LinearScale,
  BarElement, LineElement, PointElement,
  Title, Tooltip, Legend, Filler,
)

// ── Date preset helpers ───────────────────────────────────────────────────────
function presetRange(preset) {
  const now = new Date()
  const pad  = n => String(n).padStart(2, '0')
  const fmt  = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

  if (preset === '30d') {
    const from = new Date(now); from.setDate(from.getDate() - 30)
    return { from: fmt(from), to: fmt(now) }
  }
  if (preset === '90d') {
    const from = new Date(now); from.setDate(from.getDate() - 90)
    return { from: fmt(from), to: fmt(now) }
  }
  if (preset === '6m') {
    const from = new Date(now); from.setMonth(from.getMonth() - 6)
    return { from: fmt(from), to: fmt(now) }
  }
  if (preset === 'ytd') {
    return { from: `${now.getFullYear()}-01-01`, to: fmt(now) }
  }
  return { from: '', to: '' }
}

// ── Chart options factory ─────────────────────────────────────────────────────
function chartOpts(horizontal = false, yLabel = '', xLabel = '') {
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? 'y' : 'x',
    plugins: {
      legend: { labels: { color: '#9ca3af', font: { size: 10 } } },
      title:  { display: false },
      tooltip: { backgroundColor: 'var(--panel)', titleColor: '#f9fafb', bodyColor: '#d1d5db', borderColor: 'var(--hairline)', borderWidth: 1 },
    },
    scales: {
      x: {
        grid: { color: 'rgba(31,41,55,0.8)' },
        ticks: { color: '#9ca3af', font: { size: 10 } },
        title: xLabel ? { display: true, text: xLabel, color: '#6b7280', font: { size: 10 } } : { display: false },
      },
      y: {
        grid: { color: 'rgba(31,41,55,0.8)' },
        ticks: { color: '#9ca3af', font: { size: 10 } },
        title: yLabel ? { display: true, text: yLabel, color: '#6b7280', font: { size: 10 } } : { display: false },
      },
    },
  }
}

// ── Status classifier ─────────────────────────────────────────────────────────
function statusClass(status) {
  if (status === 'good')     return 'border-green-700/50 bg-green-950/20'
  if (status === 'warning')  return 'border-yellow-700/50 bg-yellow-950/10'
  if (status === 'critical') return 'border-red-700/50 bg-red-950/20'
  return 'border-gray-700/50 bg-gray-900/30'
}

function statusBadge(status) {
  if (status === 'good')     return 'bg-green-900/50 text-green-400'
  if (status === 'warning')  return 'bg-yellow-900/50 text-yellow-400'
  if (status === 'critical') return 'bg-red-900/50 text-red-400'
  return 'bg-gray-800 text-gray-400'
}

function StatusIcon({ status, size = 14 }) {
  if (status === 'good')     return <CheckCircle size={size} className="text-green-400" />
  if (status === 'warning')  return <AlertTriangle size={size} className="text-yellow-400" />
  if (status === 'critical') return <XCircle size={size} className="text-red-400" />
  return <Info size={size} className="text-gray-400" />
}

// ── KPI Card ──────────────────────────────────────────────────────────────────
function KpiCard({ title, value, subValue, description, status, icon: Icon, trend, trendLabel }) {
  const trendColor = trend === 'up'
    ? (status === 'critical' ? 'text-red-400' : 'text-green-400')
    : trend === 'down'
      ? (status === 'critical' ? 'text-green-400' : 'text-red-400')
      : 'text-gray-500'

  return (
    <div className={`rounded-xl border p-4 flex flex-col gap-2 ${statusClass(status)}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {Icon && <Icon size={15} className="text-gray-400 shrink-0" />}
          <span className="text-xs text-gray-400 font-medium truncate">{title}</span>
        </div>
        <StatusIcon status={status} size={13} />
      </div>

      <div>
        <p className="text-lg font-bold text-white leading-tight">{value}</p>
        {subValue && <p className="text-xs text-gray-400 mt-0.5">{subValue}</p>}
      </div>

      {description && (
        <p className="text-xs text-gray-500 leading-snug">{description}</p>
      )}

      {trend && trendLabel && (
        <div className={`flex items-center gap-1 text-xs font-medium ${trendColor}`}>
          {trend === 'up' ? <TrendingUp size={12} /> : trend === 'down' ? <TrendingDown size={12} /> : <Minus size={12} />}
          {trendLabel}
        </div>
      )}
    </div>
  )
}

// ── Headline KPI Strip Card ───────────────────────────────────────────────────
function HeadlineCard({ title, value, sub, status }) {
  const valueColor = status === 'good' ? 'text-green-400'
    : status === 'warning' ? 'text-yellow-400'
    : status === 'critical' ? 'text-red-400'
    : 'text-gray-300'

  const borderColor = status === 'good' ? 'border-green-700/50'
    : status === 'warning' ? 'border-yellow-700/50'
    : status === 'critical' ? 'border-red-700/50'
    : 'border-gray-700/50'

  return (
    <div className={`card border ${borderColor} flex flex-col gap-1.5`}>
      <p className="text-xs text-gray-400 font-medium">{title}</p>
      <p className={`text-2xl font-bold ${valueColor}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  )
}

// ── Helpers for N/A display ───────────────────────────────────────────────────
function fmtCpk(v, validCount, currency) {
  if (!validCount || v === 0) return 'N/A (no km data)'
  return `${currency} ${v.toFixed(4)}/km`
}

function fmtKm(v, validCount) {
  if (!validCount || v === 0) return 'N/A (no km data)'
  return `${Math.round(v).toLocaleString()} km`
}

function fmtPct(v) {
  return `${v.toFixed(1)}%`
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function EngineeringKpi() {
  const { appSettings, activeCountry, activeCurrency } = useSettings()

  // Filter state
  const [countryChip, setCountryChip] = useState('All')
  const [siteFilter,  setSiteFilter]  = useState('')
  const [dateFrom,    setDateFrom]    = useState('')
  const [dateTo,      setDateTo]      = useState('')

  // Data state
  const [records,     setRecords]     = useState([])
  const [inspections, setInspections] = useState([])
  const [actions,     setActions]     = useState([])
  const [fleetSize,   setFleetSize]   = useState(0)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [emailModalOpen, setEmailModalOpen] = useState(false)

  // Sites list for select
  const sites = useMemo(() =>
    [...new Set(records.map(r => r.site).filter(Boolean))].sort(),
    [records]
  )

  // Apply preset date range
  function applyPreset(preset) {
    const { from, to } = presetRange(preset)
    setDateFrom(from)
    setDateTo(to)
  }

  // Load data
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const country = countryChip !== 'All' ? countryChip : (activeCountry !== 'All' ? activeCountry : null)

      const applyCountry = q => country ? q.eq('country', country) : q
      const applyDateFilter = q => {
        if (dateFrom) q = q.gte('issue_date', dateFrom)
        if (dateTo)   q = q.lte('issue_date', dateTo)
        return q
      }

      const [recRes, insRes, actRes, fleetRes] = await Promise.all([
        fetchAllPages((from, to) =>
          applyCountry(
            applyDateFilter(
              supabase.from('tyre_records').select(
                'id,issue_date,asset_no,brand,site,country,cost_per_tyre,qty,risk_level,km_at_fitment,km_at_removal,position,category,remarks'
              )
            )
          ).range(from, to)
        , { max: 200000 }),
        fetchAllPages((from, to) =>
          applyCountry(
            supabase.from('inspections').select(
              'id,asset_no,site,country,status,scheduled_date,completed_date,findings,inspection_type'
            )
          ).range(from, to)
        , { max: 200000 }),
        applyCountry(
          supabase.from('corrective_actions').select(
            'id,status,site,country,due_date,created_at'
          )
        ),
        supabase.from('vehicle_fleet').select('id,asset_no'),
      ])

      if (recRes.error)  throw new Error(`Records: ${recRes.error.message}`)
      if (insRes.error)  throw new Error(`Inspections: ${insRes.error.message}`)
      if (actRes.error)  throw new Error(`Actions: ${actRes.error.message}`)
      if (fleetRes.error) throw new Error(`Fleet: ${fleetRes.error.message}`)

      let recs = recRes.data || []
      if (siteFilter) recs = recs.filter(r => r.site === siteFilter)

      setRecords(recs)
      setInspections(insRes.data || [])
      setActions(actRes.data || [])
      setFleetSize((fleetRes.data || []).length)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [countryChip, activeCountry, siteFilter, dateFrom, dateTo])

  useEffect(() => { loadData() }, [loadData])

  // Compute all 17 KPIs
  const kpis = useMemo(() => {
    if (!records.length) return null
    return computeAllKpis(records, inspections, actions, fleetSize)
  }, [records, inspections, actions, fleetSize])

  // Brand CPK chart data
  const cpkBrandChart = useMemo(() => {
    if (!kpis) return null
    const top10 = kpis.cpkByBrand.slice(0, 10)
    return {
      labels: top10.map(b => `${b.brand} (n=${b.count})`),
      datasets: [{
        label: `Avg CPK (${activeCurrency}/km)`,
        data:  top10.map(b => parseFloat(b.avgCpk.toFixed(4))),
        backgroundColor: top10.map(b =>
          b.avgCpk < 1.0 ? 'rgba(34,197,94,0.7)'
          : b.avgCpk < 2.0 ? 'rgba(234,179,8,0.7)'
          : 'rgba(239,68,68,0.7)'
        ),
        borderColor: top10.map(b =>
          b.avgCpk < 1.0 ? 'rgb(34,197,94)'
          : b.avgCpk < 2.0 ? 'rgb(234,179,8)'
          : 'rgb(239,68,68)'
        ),
        borderWidth: 1,
        borderRadius: 3,
      }],
    }
  }, [kpis])

  // Monthly cost trend chart (13 months)
  const costTrendChart = useMemo(() => {
    if (!kpis) return null
    const { byMonth, slope, forecastNextMonth } = kpis.costTrend

    const now = new Date()
    const axis = []
    for (let i = 12; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      axis.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    const monthMap = {}
    byMonth.forEach(m => { monthMap[m.month] = m.totalCost })

    const actuals = axis.map(m => monthMap[m] ?? null)

    // Regression line using index positions
    let trendLine = null
    if (byMonth.length >= 2) {
      // find first axis index matching first data month
      const startIdx = axis.findIndex(m => m === byMonth[0]?.month)
      trendLine = axis.map((_, i) => {
        const x = i - startIdx
        return Math.max(0, kpis.costTrend.slope * x + (byMonth[0]?.totalCost ?? 0) + kpis.costTrend.slope)
      })
    }

    const datasets = [
      {
        label: `Actual Cost (${activeCurrency})`,
        data: actuals,
        borderColor: 'rgba(59,130,246,1)',
        backgroundColor: 'rgba(59,130,246,0.08)',
        fill: true, tension: 0.4, spanGaps: true, pointRadius: 3,
      },
    ]
    if (trendLine) {
      datasets.push({
        label: 'Trend Line',
        data: trendLine,
        borderColor: 'rgba(107,114,128,0.55)',
        borderDash: [5, 3], fill: false, pointRadius: 0, tension: 0, spanGaps: true,
      })
    }
    return { labels: axis, datasets }
  }, [kpis])

  // Failure rate by site chart
  const failureBySiteChart = useMemo(() => {
    if (!kpis) return null
    const sorted = [...kpis.failureRate.bySite].slice(0, 12)
    return {
      labels: sorted.map(s => s.site),
      datasets: [{
        label: 'Failure Rate %',
        data: sorted.map(s => parseFloat((s.rate * 100).toFixed(1))),
        backgroundColor: sorted.map(s =>
          s.rate > 0.30 ? 'rgba(239,68,68,0.75)'
          : s.rate > 0.15 ? 'rgba(234,179,8,0.75)'
          : 'rgba(34,197,94,0.75)'
        ),
        borderColor: sorted.map(s =>
          s.rate > 0.30 ? 'rgb(239,68,68)'
          : s.rate > 0.15 ? 'rgb(234,179,8)'
          : 'rgb(34,197,94)'
        ),
        borderWidth: 1, borderRadius: 3,
      }],
    }
  }, [kpis])

  // Inspection compliance by month chart (12 months)
  const inspCompChart = useMemo(() => {
    if (!kpis) return null
    const now = new Date()
    const axis = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      axis.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }

    const monthMap = {}
    kpis.inspectionCompliance.byMonth.forEach(m => { monthMap[m.month] = m.compliancePct })

    return {
      labels: axis,
      datasets: [
        {
          label: 'Compliance %',
          data: axis.map(m => monthMap[m] ?? null),
          borderColor: 'rgba(99,102,241,1)',
          backgroundColor: 'rgba(99,102,241,0.08)',
          fill: true, tension: 0.4, spanGaps: true, pointRadius: 3,
        },
        {
          label: 'Target 85%',
          data: axis.map(() => 85),
          borderColor: 'rgba(34,197,94,0.5)',
          borderDash: [6, 3], fill: false, pointRadius: 0,
        },
      ],
    }
  }, [kpis])

  // Worst assets table
  const worstAssets = useMemo(() => {
    if (!kpis) return []
    return kpis.cpkByAsset.slice(0, 10).map(a => {
      const assetRecs = records.filter(r => r.asset_no === a.asset_no)
      const failures = assetRecs.filter(r => ['Critical', 'High'].includes(r.risk_level)).length
      const totalCost = assetRecs.reduce((s, r) => s + (r.cost_per_tyre || 0) * (r.qty || 1), 0)
      const withKm = assetRecs.filter(r => {
        const fit = Number(r.km_at_fitment), rem = Number(r.km_at_removal)
        return isFinite(fit) && isFinite(rem) && rem > fit
      })
      const avgLife = withKm.length > 0
        ? withKm.reduce((s, r) => s + (Number(r.km_at_removal) - Number(r.km_at_fitment)), 0) / withKm.length
        : null
      return {
        assetNo:    a.asset_no,
        cpk:        a.avgCpk,
        avgLifeKm:  avgLife,
        totalCost,
        failureRate: assetRecs.length > 0 ? (failures / assetRecs.length) * 100 : 0,
        replacements: assetRecs.length,
      }
    })
  }, [kpis, records])

  // Brand scorecard
  const brandScorecard = useMemo(() => {
    if (!kpis) return []
    return kpis.vendorPerformance.map((b, i) => ({
      rank: i + 1,
      brand: b.brand,
      avgCpk: b.avgCpk,
      failureRate: b.failureRate,
      avgLifeKm: b.avgLife,
      scrapRate: b.scrapRate,
      score: b.score,
      count: b.count,
    }))
  }, [kpis])

  // ── Export handlers ─────────────────────────────────────────────────────────
  function handleExcelExport() {
    if (!kpis) return

    // Sheet 1: KPI Summary
    const kpiRows = buildKpiSummaryRows(kpis, activeCurrency)
    exportToExcel(
      kpiRows,
      ['kpi', 'value', 'status', 'description'],
      ['KPI', 'Value', 'Status', 'Description'],
      'TyrePulse_EngineeringKPIs',
      'KPI Summary'
    )
  }

  function handlePdfExport() {
    if (!kpis) return
    const rows = buildKpiSummaryRows(kpis, activeCurrency)
    exportToPdf(
      rows,
      [
        { key: 'kpi',         header: 'KPI' },
        { key: 'value',       header: 'Value' },
        { key: 'status',      header: 'Status' },
        { key: 'description', header: 'Description' },
      ],
      'Engineering KPI Dashboard - All 17 KPIs',
      'TyrePulse_EngineeringKPIs',
      'landscape'
    )
  }

  // ── 17 KPI card definitions ─────────────────────────────────────────────────
  const kpiCards = useMemo(() => {
    if (!kpis) return []
    const {
      cpk, costPerMile, avgTyreLife, fleetTyreLife,
      removalRate, failureRate, replacementRate,
      pressureCompliance, inspectionCompliance,
      retreadPerformance, scrapRate, fleetAvailability,
      downtimeImpact, costTrend, vendorPerformance,
      workshopPerformance,
    } = kpis

    const currency = activeCurrency

    // KPI 1: CPK Fleet Avg
    const cpkStatus = cpk.validCount === 0 ? 'neutral'
      : cpk.fleetAvgCpk < 1.0 ? 'good'
      : cpk.fleetAvgCpk < 2.0 ? 'warning' : 'critical'

    // KPI 2: Cost Per Mile
    const cpmVal = cpk.validCount > 0 ? cpk.fleetAvgCpk * 1.60934 : 0

    // KPI 3: Avg Tyre Life
    const lifeStatus = avgTyreLife.validCount === 0 ? 'neutral'
      : avgTyreLife.avgKm > 40000 ? 'good'
      : avgTyreLife.avgKm > 20000 ? 'warning' : 'critical'

    // KPI 6: Failure Rate
    const failPct = failureRate.failureRate * 100
    const failStatus = failPct > 30 ? 'critical' : failPct > 15 ? 'warning' : 'good'

    // KPI 8: Pressure Compliance
    const pressPct = pressureCompliance.compliancePct
    const pressStatus = pressPct > 85 ? 'good' : pressPct > 60 ? 'warning' : 'critical'

    // KPI 9: Inspection Compliance
    const inspPct = inspectionCompliance.compliancePct
    const inspStatus = inspPct > 85 ? 'good' : inspPct > 60 ? 'warning' : 'critical'

    // KPI 11: Scrap Rate
    const scrapPct = scrapRate.scrapRate * 100
    const scrapStatus = scrapPct > 20 ? 'critical' : scrapPct > 10 ? 'warning' : 'good'

    // KPI 12: Fleet Availability
    const availPct = fleetAvailability.availabilityPct
    const availStatus = availPct > 90 ? 'good' : availPct > 75 ? 'warning' : 'critical'

    // KPI 14: Cost Trend
    const trendStatus = costTrend.trend === 'improving' ? 'good'
      : costTrend.trend === 'stable' ? 'neutral' : 'warning'

    // KPI 15: Vendor Performance
    const topVendor    = vendorPerformance[0]
    const bottomVendor = vendorPerformance[vendorPerformance.length - 1]

    // KPI 16: Workshop Performance
    const bestSite  = workshopPerformance.bySite[0]
    const worstSite = workshopPerformance.bySite[workshopPerformance.bySite.length - 1]

    return [
      // 1. CPK Fleet Avg
      {
        title: 'CPK Fleet Average',
        value: cpk.validCount === 0 ? 'N/A (no km data)' : `${currency} ${cpk.fleetAvgCpk.toFixed(4)}/km`,
        subValue: `Coverage: ${cpk.validCount} of ${cpk.totalCount} records (${cpk.coveragePct.toFixed(0)}%)`,
        description: `Median CPK: ${cpk.validCount > 0 ? `${currency} ${cpk.medianCpk.toFixed(4)}/km` : 'N/A'}`,
        status: cpkStatus,
        trend: cpk.validCount === 0 ? null : cpk.fleetAvgCpk < 1.5 ? 'down' : 'up',
        trendLabel: cpk.validCount > 0 ? (cpk.fleetAvgCpk < 1.5 ? 'Optimal range' : 'Above target') : null,
      },
      // 2. Cost Per Mile
      {
        title: 'Cost Per Mile',
        value: cpk.validCount === 0 ? 'N/A (no km data)' : `${currency} ${cpmVal.toFixed(4)}/mile`,
        subValue: `Derived from CPK × 1.609`,
        description: cpk.validCount > 0
          ? `P10: ${currency} ${(cpk.p10Cpk * 1.60934).toFixed(4)} - P90: ${currency} ${(cpk.p90Cpk * 1.60934).toFixed(4)}`
          : 'Upload km_at_fitment & km_at_removal data',
        status: cpk.validCount === 0 ? 'neutral' : cpkStatus,
        trend: null,
        trendLabel: null,
      },
      // 3. Avg Tyre Life
      {
        title: 'Average Tyre Life',
        value: avgTyreLife.validCount === 0 ? 'N/A (no km data)' : `${Math.round(avgTyreLife.avgKm).toLocaleString()} km`,
        subValue: avgTyreLife.validCount > 0 ? `Median: ${Math.round(avgTyreLife.medianKm).toLocaleString()} km` : '',
        description: avgTyreLife.validCount > 0
          ? `Based on ${avgTyreLife.validCount} records with km data`
          : 'Requires km_at_fitment & km_at_removal',
        status: lifeStatus,
        trend: avgTyreLife.validCount > 0 ? (avgTyreLife.avgKm > 40000 ? 'up' : 'down') : null,
        trendLabel: avgTyreLife.validCount > 0 ? (avgTyreLife.avgKm > 40000 ? 'Above fleet target' : 'Below 40k km target') : null,
      },
      // 4. Fleet Avg Tyre Life
      {
        title: 'Fleet Avg Tyre Life',
        value: avgTyreLife.validCount === 0 ? 'N/A (no km data)' : `${Math.round(fleetTyreLife.avgKm).toLocaleString()} km`,
        subValue: fleetTyreLife.trend.length > 0 ? `${fleetTyreLife.trend.length} monthly data points` : 'Insufficient time data',
        description: avgTyreLife.byBrand[0]
          ? `Best brand: ${avgTyreLife.byBrand[0].brand} (${Math.round(avgTyreLife.byBrand[0].avgKm).toLocaleString()} km)`
          : 'No brand breakdown available',
        status: lifeStatus,
        trend: null,
        trendLabel: null,
      },
      // 5. Tyre Removal Rate
      {
        title: 'Tyre Removal Rate',
        value: removalRate.estimatedFleetKm > 0
          ? `${removalRate.removalPer1000Km.toFixed(2)} per 1,000 km`
          : 'N/A (no km data)',
        subValue: `Total removals: ${removalRate.totalRemovals.toLocaleString()}`,
        description: removalRate.estimatedFleetKm > 0
          ? `Fleet km base: ${Math.round(removalRate.estimatedFleetKm).toLocaleString()} km`
          : 'Upload km data to compute removal rate',
        status: removalRate.estimatedFleetKm > 0
          ? (removalRate.removalPer1000Km < 0.05 ? 'good' : removalRate.removalPer1000Km < 0.15 ? 'warning' : 'critical')
          : 'neutral',
        trend: null,
        trendLabel: null,
      },
      // 6. Tyre Failure Rate
      {
        title: 'Tyre Failure Rate',
        value: `${fmtPct(failPct)}`,
        subValue: `${failureRate.failureCount} failures of ${failureRate.totalCount} total`,
        description: `Critical: ${failureRate.criticalRate > 0 ? fmtPct(failureRate.criticalRate * 100) : '0%'} · High: ${fmtPct(failureRate.highRate * 100)}`,
        status: failStatus,
        trend: failPct > 20 ? 'up' : 'down',
        trendLabel: failPct > 20 ? 'Exceeds 20% threshold' : 'Within acceptable range',
      },
      // 7. Tyre Replacement Rate
      {
        title: 'Tyre Replacement Rate',
        value: `${replacementRate.avgPerVehiclePerMonth.toFixed(2)} per vehicle/month`,
        subValue: `${replacementRate.totalReplacements} total over ${replacementRate.activeVehicles} vehicles`,
        description: `Monthly data: ${replacementRate.byMonth.length} months observed`,
        status: replacementRate.avgPerVehiclePerMonth < 0.5 ? 'good'
          : replacementRate.avgPerVehiclePerMonth < 1.5 ? 'warning' : 'critical',
        trend: null,
        trendLabel: null,
      },
      // 8. Pressure Compliance
      {
        title: 'Pressure Compliance %',
        value: inspections.length === 0 ? 'N/A (no inspections)' : fmtPct(pressPct),
        subValue: `${pressureCompliance.compliantCount} of ${pressureCompliance.totalCount} inspections compliant`,
        description: 'Based on inspection completion & findings quality',
        status: inspections.length === 0 ? 'neutral' : pressStatus,
        trend: pressPct > 85 ? 'up' : 'down',
        trendLabel: pressPct > 85 ? 'Target achieved' : 'Below 85% target',
      },
      // 9. Inspection Compliance
      {
        title: 'Inspection Compliance %',
        value: inspections.length === 0 ? 'N/A (no inspections)' : fmtPct(inspPct),
        subValue: `On-time: ${inspectionCompliance.onTimeCount} of ${inspectionCompliance.totalScheduled} scheduled`,
        description: `Overdue: ${inspectionCompliance.overdueCount} · Late: ${inspectionCompliance.lateCount}`,
        status: inspections.length === 0 ? 'neutral' : inspStatus,
        trend: inspPct > 85 ? 'up' : 'down',
        trendLabel: inspPct > 85 ? 'Target achieved' : `${(85 - inspPct).toFixed(1)}% gap to 85% target`,
      },
      // 10. Retread Performance
      {
        title: 'Retread Performance',
        value: retreadPerformance === null
          ? 'N/A (insufficient data)'
          : retreadPerformance.savingsPct > 0
            ? `${retreadPerformance.savingsPct.toFixed(1)}% cheaper`
            : `${Math.abs(retreadPerformance.savingsPct).toFixed(1)}% more expensive`,
        subValue: retreadPerformance
          ? `Retread CPK: ${currency} ${retreadPerformance.retreadCpk.toFixed(4)} · New: ${currency} ${retreadPerformance.newCpk.toFixed(4)}`
          : 'Need retread records with km data',
        description: retreadPerformance
          ? `${retreadPerformance.retreadCount} retreads vs ${retreadPerformance.newCount} new tyres`
          : 'Tag records with category "Retread" to enable',
        status: retreadPerformance === null ? 'neutral'
          : retreadPerformance.savingsPct > 10 ? 'good'
          : retreadPerformance.savingsPct > 0 ? 'warning' : 'critical',
        trend: retreadPerformance ? (retreadPerformance.savingsPct > 0 ? 'down' : 'up') : null,
        trendLabel: retreadPerformance ? (retreadPerformance.savingsPct > 0 ? 'Cost savings confirmed' : 'No cost advantage') : null,
      },
      // 11. Scrap Rate
      {
        title: 'Scrap Rate',
        value: fmtPct(scrapPct),
        subValue: `${scrapRate.scrapCount} scrapped of ${scrapRate.totalCount} total`,
        description: `Estimated scrap cost: ${currency} ${scrapRate.estimatedScrapCost.toLocaleString()}`,
        status: scrapStatus,
        trend: scrapPct > 15 ? 'up' : 'down',
        trendLabel: scrapPct > 15 ? 'High scrap - investigate early removal' : 'Scrap within normal range',
      },
      // 12. Fleet Availability
      {
        title: 'Fleet Availability Impact',
        value: fmtPct(availPct),
        subValue: `${fleetAvailability.unavailableCount} vehicles critical (last 30 days)`,
        description: `Fleet size: ${fleetAvailability.fleetSize} vehicles`,
        status: availStatus,
        trend: availPct > 90 ? 'up' : 'down',
        trendLabel: availPct > 90 ? 'Fleet available' : `${fleetAvailability.unavailableCount} vehicles at risk`,
      },
      // 13. Downtime Impact
      {
        title: 'Vehicle Downtime Impact',
        value: `${downtimeImpact.totalDowntimeHours.toLocaleString()} hrs estimated`,
        subValue: `Avg ${downtimeImpact.avgDowntimePerVehicle.toFixed(1)} hrs/vehicle`,
        description: `Based on ${downtimeImpact.worstAssets.reduce((s, a) => s + a.replacements, 0)} replacements × 2 hrs industry avg`,
        status: downtimeImpact.totalDowntimeHours > 500 ? 'critical'
          : downtimeImpact.totalDowntimeHours > 100 ? 'warning' : 'good',
        trend: downtimeImpact.totalDowntimeHours > 200 ? 'up' : 'down',
        trendLabel: downtimeImpact.totalDowntimeHours > 200 ? 'Significant downtime hours' : 'Downtime within tolerance',
      },
      // 14. Cost Trend
      {
        title: 'Cost Trend',
        value: costTrend.trend === 'improving' ? '▼ Improving'
          : costTrend.trend === 'worsening' ? '▲ Worsening' : '- Stable',
        subValue: `Slope: ${costTrend.slope > 0 ? '+' : ''}${currency} ${Math.round(Math.abs(costTrend.slope)).toLocaleString()}/month`,
        description: `Forecast next month: ${currency} ${Math.round(Math.max(0, costTrend.forecastNextMonth)).toLocaleString()} · Avg monthly: ${currency} ${Math.round(costTrend.avgMonthlyCost).toLocaleString()}`,
        status: trendStatus,
        trend: costTrend.trend === 'improving' ? 'down' : costTrend.trend === 'worsening' ? 'up' : null,
        trendLabel: costTrend.trend === 'improving' ? 'Costs declining'
          : costTrend.trend === 'worsening' ? 'Costs increasing - action needed'
          : 'Costs stable',
      },
      // 15. Vendor Performance
      {
        title: 'Vendor Performance',
        value: topVendor ? `Top: ${topVendor.brand}` : 'N/A (no km data)',
        subValue: topVendor && topVendor.avgCpk > 0
          ? `CPK: ${currency} ${topVendor.avgCpk.toFixed(4)}/km - Score: ${topVendor.score.toFixed(2)}`
          : topVendor ? 'No CPK data for top brand' : 'Upload km data for vendor ranking',
        description: bottomVendor && topVendor && bottomVendor.brand !== topVendor.brand
          ? `Worst: ${bottomVendor.brand} (CPK: ${bottomVendor.avgCpk > 0 ? `${currency} ${bottomVendor.avgCpk.toFixed(4)}` : 'N/A'})`
          : vendorPerformance.length > 0 ? `${vendorPerformance.length} brands ranked` : '',
        status: topVendor && topVendor.avgCpk > 0 && topVendor.avgCpk < 1.0 ? 'good'
          : topVendor && topVendor.avgCpk < 2.0 ? 'warning' : 'neutral',
        trend: null,
        trendLabel: null,
      },
      // 16. Workshop Performance
      {
        title: 'Workshop Performance',
        value: bestSite ? `Best: ${bestSite.site}` : 'N/A (no site data)',
        subValue: bestSite ? `Score: ${bestSite.score.toFixed(2)} · Failure: ${fmtPct(bestSite.highRiskPct)}` : '',
        description: worstSite && bestSite && worstSite.site !== bestSite.site
          ? `Worst: ${worstSite.site} (Score: ${worstSite.score.toFixed(2)} · Failure: ${fmtPct(worstSite.highRiskPct)})`
          : workshopPerformance.bySite.length > 0 ? `${workshopPerformance.bySite.length} sites evaluated` : '',
        status: workshopPerformance.bySite.length > 0 ? (bestSite?.highRiskPct < 15 ? 'good' : 'warning') : 'neutral',
        trend: null,
        trendLabel: null,
      },
      // 17. Fleet CPK Coverage
      {
        title: 'Fleet CPK Coverage',
        value: `${cpk.coveragePct.toFixed(1)}% of records`,
        subValue: `${cpk.validCount} valid · ${cpk.totalCount - cpk.validCount} missing km data`,
        description: cpk.coveragePct < 50
          ? 'Low coverage - CPK metrics unreliable. Upload km_at_fitment & km_at_removal.'
          : cpk.coveragePct < 80
            ? 'Moderate coverage - some CPK calculations may be skewed'
            : 'Good coverage - CPK metrics are reliable',
        status: cpk.coveragePct > 80 ? 'good' : cpk.coveragePct > 50 ? 'warning' : 'critical',
        trend: cpk.coveragePct > 80 ? 'up' : 'down',
        trendLabel: cpk.coveragePct > 80 ? 'High data quality' : 'Improve data entry for km fields',
      },
    ]
  }, [kpis, activeCurrency, inspections])

  // ── Loading / Error / Empty states ─────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-80 gap-4">
        <div className="relative">
          <div className="w-12 h-12 rounded-full border-2 border-gray-700" />
          <div className="absolute inset-0 w-12 h-12 rounded-full border-t-2 border-blue-500 animate-spin" />
        </div>
        <p className="text-gray-400 text-sm">Computing 17 engineering KPIs...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-start gap-3 bg-red-950/40 border border-red-700/50 rounded-xl p-4">
        <XCircle size={18} className="text-red-400 shrink-0 mt-0.5" />
        <div>
          <p className="text-red-300 font-medium text-sm">Data load error</p>
          <p className="text-red-400/80 text-xs mt-1">{error}</p>
          <button onClick={loadData} className="btn-secondary text-xs mt-3">Retry</button>
        </div>
      </div>
    )
  }

  // ── Main render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <PageHeader
          title="Engineering KPI Dashboard"
          subtitle={`17 tyre engineering KPIs computed automatically from fleet data${records.length > 0 ? ` - ${records.length.toLocaleString()} records` : ''}`}
          icon={Cpu}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExcelExport}
            disabled={!kpis}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5 disabled:opacity-40"
          >
            <Download size={14} /> Excel
          </button>
          <button
            onClick={handlePdfExport}
            disabled={!kpis}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5 disabled:opacity-40"
          >
            <FileText size={14} /> PDF
          </button>
          <button
            onClick={() => setEmailModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Mail size={16} />Email Report
          </button>
        </div>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────────── */}
      <div className="card flex flex-col gap-3">
        {/* Country chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 w-14 shrink-0">Country</span>
          {['All', ...COUNTRIES].map(c => (
            <button
              key={c}
              onClick={() => setCountryChip(c)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                countryChip === c
                  ? 'bg-blue-600 text-white border-blue-500'
                  : 'bg-gray-800 text-gray-400 border-gray-700 hover:border-gray-500'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Site + date range */}
        <div className="flex flex-wrap items-end gap-3">
          {/* Site */}
          <div className="flex flex-col gap-1">
            <label className="label text-xs">Site</label>
            <select
              className="input w-44 text-sm"
              value={siteFilter}
              onChange={e => setSiteFilter(e.target.value)}
            >
              <option value="">All Sites</option>
              {sites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Date From */}
          <div className="flex flex-col gap-1">
            <label className="label text-xs">From</label>
            <input
              type="date"
              className="input w-38 text-sm"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
            />
          </div>

          {/* Date To */}
          <div className="flex flex-col gap-1">
            <label className="label text-xs">To</label>
            <input
              type="date"
              className="input w-38 text-sm"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
            />
          </div>

          {/* Presets */}
          <div className="flex items-center gap-1.5 pb-0.5">
            {[
              { label: 'Last 30d',  preset: '30d' },
              { label: 'Last 90d',  preset: '90d' },
              { label: 'Last 6M',   preset: '6m'  },
              { label: 'This Year', preset: 'ytd' },
            ].map(({ label, preset }) => (
              <button
                key={preset}
                onClick={() => applyPreset(preset)}
                className="px-2.5 py-1 text-xs rounded border border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-500 hover:text-gray-300 transition-colors"
              >
                {label}
              </button>
            ))}
            {(dateFrom || dateTo || siteFilter || countryChip !== 'All') && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); setSiteFilter(''); setCountryChip('All') }}
                className="px-2.5 py-1 text-xs rounded border border-gray-700 bg-gray-800 text-red-400 hover:border-red-700 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Empty state ──────────────────────────────────────────────────────── */}
      {!kpis && !loading && (
        <div className="card flex flex-col items-center justify-center py-20 gap-4">
          <Cpu size={40} className="text-gray-600" />
          <p className="text-gray-400 text-base font-medium">No tyre records found for the selected filters</p>
          <p className="text-gray-500 text-sm text-center max-w-md">
            Upload tyre data to see engineering KPIs. All 17 KPIs are computed automatically once records are available.
          </p>
        </div>
      )}

      {kpis && (
        <>
          {/* ── Section 1: Headline Strip ──────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {/* 1. Fleet CPK */}
            <HeadlineCard
              title="Fleet CPK"
              value={kpis.cpk.validCount === 0 ? 'N/A' : `${activeCurrency} ${kpis.cpk.fleetAvgCpk.toFixed(4)}`}
              sub={kpis.cpk.validCount === 0 ? 'No km data' : `${activeCurrency}/km · ${kpis.cpk.coveragePct.toFixed(0)}% coverage`}
              status={
                kpis.cpk.validCount === 0 ? 'neutral'
                : kpis.cpk.fleetAvgCpk < 1.0 ? 'good'
                : kpis.cpk.fleetAvgCpk < 2.0 ? 'warning' : 'critical'
              }
            />
            {/* 2. Avg Tyre Life */}
            <HeadlineCard
              title="Avg Tyre Life"
              value={kpis.avgTyreLife.validCount === 0 ? 'N/A' : `${Math.round(kpis.avgTyreLife.avgKm).toLocaleString()} km`}
              sub={kpis.avgTyreLife.validCount === 0 ? 'No km data' : `${kpis.avgTyreLife.validCount} records`}
              status={
                kpis.avgTyreLife.validCount === 0 ? 'neutral'
                : kpis.avgTyreLife.avgKm > 40000 ? 'good'
                : kpis.avgTyreLife.avgKm > 20000 ? 'warning' : 'critical'
              }
            />
            {/* 3. Failure Rate */}
            <HeadlineCard
              title="Failure Rate"
              value={`${(kpis.failureRate.failureRate * 100).toFixed(1)}%`}
              sub={`${kpis.failureRate.failureCount} of ${kpis.failureRate.totalCount} records`}
              status={
                kpis.failureRate.failureRate * 100 > 30 ? 'critical'
                : kpis.failureRate.failureRate * 100 > 15 ? 'warning' : 'good'
              }
            />
            {/* 4. Inspection Compliance */}
            <HeadlineCard
              title="Inspection Compliance"
              value={inspections.length === 0 ? 'N/A' : `${kpis.inspectionCompliance.compliancePct.toFixed(1)}%`}
              sub={inspections.length === 0 ? 'No inspections' : `${kpis.inspectionCompliance.onTimeCount} on-time`}
              status={
                inspections.length === 0 ? 'neutral'
                : kpis.inspectionCompliance.compliancePct > 85 ? 'good'
                : kpis.inspectionCompliance.compliancePct > 60 ? 'warning' : 'critical'
              }
            />
            {/* 5. Fleet Availability */}
            <HeadlineCard
              title="Fleet Availability"
              value={`${kpis.fleetAvailability.availabilityPct.toFixed(1)}%`}
              sub={`${kpis.fleetAvailability.unavailableCount} vehicles critical`}
              status={
                kpis.fleetAvailability.availabilityPct > 90 ? 'good'
                : kpis.fleetAvailability.availabilityPct > 75 ? 'warning' : 'critical'
              }
            />
          </div>

          {/* ── Section 2: 17-KPI Cards Grid ──────────────────────────────── */}
          <div>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
              All 17 Engineering KPIs
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {kpiCards.map((card, i) => (
                <KpiCard
                  key={i}
                  title={`${String(i + 1).padStart(2, '0')}. ${card.title}`}
                  value={card.value}
                  subValue={card.subValue}
                  description={card.description}
                  status={card.status}
                  trend={card.trend}
                  trendLabel={card.trendLabel}
                />
              ))}
            </div>
          </div>

          {/* ── Section 3: 4 Charts ─────────────────────────────────────────── */}
          <div>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Analytical Charts
            </h2>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

              {/* Chart 1: CPK by Brand */}
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-300">CPK by Brand - Top 10</h3>
                  <span className="text-xs text-gray-500">Lower = better · Green &lt;1.0 · Yellow 1-2 · Red ≥2</span>
                </div>
                {cpkBrandChart ? (
                  <div style={{ height: 280 }}>
                    <Bar
                      data={cpkBrandChart}
                      options={chartOpts(true, `${activeCurrency}/km`, '')}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
                    No km data available for CPK chart
                  </div>
                )}
              </div>

              {/* Chart 2: Monthly Cost Trend */}
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-300">Monthly Cost Trend (13 months)</h3>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                    kpis.costTrend.trend === 'improving' ? 'bg-green-900/40 text-green-400'
                    : kpis.costTrend.trend === 'worsening' ? 'bg-red-900/40 text-red-400'
                    : 'bg-gray-800 text-gray-400'
                  }`}>
                    {kpis.costTrend.trend.charAt(0).toUpperCase() + kpis.costTrend.trend.slice(1)}
                  </span>
                </div>
                {costTrendChart ? (
                  <div style={{ height: 280 }}>
                    <Line
                      data={costTrendChart}
                      options={chartOpts(false, `Cost (${activeCurrency})`, 'Month')}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
                    No cost data available
                  </div>
                )}
              </div>

              {/* Chart 3: Failure Rate by Site */}
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-300">Failure Rate by Site</h3>
                  <span className="text-xs text-gray-500">Sorted by rate desc · Red &gt;30% · Yellow &gt;15%</span>
                </div>
                {failureBySiteChart && failureBySiteChart.labels.length > 0 ? (
                  <div style={{ height: 280 }}>
                    <Bar
                      data={failureBySiteChart}
                      options={chartOpts(false, 'Failure Rate %', 'Site')}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
                    No site data available
                  </div>
                )}
              </div>

              {/* Chart 4: Inspection Compliance by Month */}
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-300">Inspection Compliance by Month (12M)</h3>
                  <span className="text-xs text-gray-500">Target: 85%</span>
                </div>
                {inspCompChart ? (
                  <div style={{ height: 280 }}>
                    <Line
                      data={inspCompChart}
                      options={chartOpts(false, 'Compliance %', 'Month')}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-48 text-gray-500 text-sm">
                    No inspection data available
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ── Section 4: Two Tables ──────────────────────────────────────── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

            {/* Table Left: Worst Assets by CPK */}
            <div className="card overflow-x-auto">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-300">Worst Assets by CPK (Top 10)</h3>
                <span className="text-xs text-gray-500">{worstAssets.length} assets with km data</span>
              </div>
              {worstAssets.length === 0 ? (
                <p className="text-gray-500 text-sm py-8 text-center">No assets with km data available</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left border-b border-gray-800">
                      <th className="table-header pb-2 pr-3">Asset No</th>
                      <th className="table-header pb-2 pr-3 text-right">CPK ({activeCurrency}/km)</th>
                      <th className="table-header pb-2 pr-3 text-right">Avg Life</th>
                      <th className="table-header pb-2 pr-3 text-right">Total Cost</th>
                      <th className="table-header pb-2 pr-3 text-right">Fail %</th>
                      <th className="table-header pb-2 text-right">Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {worstAssets.map((a, i) => (
                      <tr key={a.assetNo} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                        <td className="table-cell py-2 pr-3 font-mono text-gray-200">{a.assetNo}</td>
                        <td className="table-cell py-2 pr-3 text-right">
                          <span className={`font-medium ${
                            a.cpk < 1.0 ? 'text-green-400' : a.cpk < 2.0 ? 'text-yellow-400' : 'text-red-400'
                          }`}>
                            {a.cpk.toFixed(4)}
                          </span>
                        </td>
                        <td className="table-cell py-2 pr-3 text-right text-gray-300">
                          {a.avgLifeKm != null ? `${Math.round(a.avgLifeKm).toLocaleString()} km` : '-'}
                        </td>
                        <td className="table-cell py-2 pr-3 text-right text-gray-300">
                          {activeCurrency} {Math.round(a.totalCost).toLocaleString()}
                        </td>
                        <td className="table-cell py-2 pr-3 text-right">
                          <span className={a.failureRate > 30 ? 'text-red-400' : a.failureRate > 15 ? 'text-yellow-400' : 'text-green-400'}>
                            {a.failureRate.toFixed(1)}%
                          </span>
                        </td>
                        <td className="table-cell py-2 text-right text-gray-400">{a.replacements}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Table Right: Brand Performance Scorecard */}
            <div className="card overflow-x-auto">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-300">Brand Performance Scorecard</h3>
                <span className="text-xs text-gray-500">{brandScorecard.length} brands</span>
              </div>
              {brandScorecard.length === 0 ? (
                <p className="text-gray-500 text-sm py-8 text-center">No brand data available</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left border-b border-gray-800">
                      <th className="table-header pb-2 pr-2 text-center">#</th>
                      <th className="table-header pb-2 pr-3">Brand</th>
                      <th className="table-header pb-2 pr-3 text-right">Avg CPK</th>
                      <th className="table-header pb-2 pr-3 text-right">Fail %</th>
                      <th className="table-header pb-2 pr-3 text-right">Avg Life</th>
                      <th className="table-header pb-2 pr-3 text-right">Scrap %</th>
                      <th className="table-header pb-2 text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {brandScorecard.map((b, i) => {
                      const total = brandScorecard.length
                      const isTop = i < Math.ceil(total * 0.3)
                      const isBot = i >= total - Math.floor(total * 0.3)
                      const scoreColor = isTop ? 'text-green-400' : isBot ? 'text-red-400' : 'text-gray-300'

                      return (
                        <tr key={b.brand} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                          <td className="table-cell py-2 pr-2 text-center text-gray-500">{b.rank}</td>
                          <td className="table-cell py-2 pr-3 text-gray-200 font-medium">{b.brand}</td>
                          <td className="table-cell py-2 pr-3 text-right">
                            {b.avgCpk > 0 ? (
                              <span className={b.avgCpk < 1.0 ? 'text-green-400' : b.avgCpk < 2.0 ? 'text-yellow-400' : 'text-red-400'}>
                                {b.avgCpk.toFixed(4)}
                              </span>
                            ) : (
                              <span className="text-gray-600">N/A</span>
                            )}
                          </td>
                          <td className="table-cell py-2 pr-3 text-right">
                            <span className={b.failureRate > 0.3 ? 'text-red-400' : b.failureRate > 0.15 ? 'text-yellow-400' : 'text-green-400'}>
                              {(b.failureRate * 100).toFixed(1)}%
                            </span>
                          </td>
                          <td className="table-cell py-2 pr-3 text-right text-gray-300">
                            {b.avgLifeKm != null && b.avgLifeKm > 0
                              ? `${Math.round(b.avgLifeKm).toLocaleString()} km`
                              : <span className="text-gray-600">N/A</span>
                            }
                          </td>
                          <td className="table-cell py-2 pr-3 text-right text-gray-300">
                            {(b.scrapRate * 100).toFixed(1)}%
                          </td>
                          <td className="table-cell py-2 text-right">
                            <span className={`font-semibold ${scoreColor}`}>
                              {b.score.toFixed(2)}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      {kpis && (
        <EmailReportModal
          isOpen={emailModalOpen}
          onClose={() => setEmailModalOpen(false)}
          reportTitle="Engineering KPI Report"
          pdfColumns={['Brand', 'Avg CPK', 'Failure %', 'Avg Life (km)', 'Scrap %', 'Score']}
          pdfRows={brandScorecard.map(b => [
            b.brand,
            b.avgCpk > 0 ? b.avgCpk.toFixed(4) : 'N/A',
            `${(b.failureRate * 100).toFixed(1)}%`,
            b.avgLifeKm != null && b.avgLifeKm > 0 ? `${Math.round(b.avgLifeKm).toLocaleString()} km` : 'N/A',
            `${(b.scrapRate * 100).toFixed(1)}%`,
            b.score.toFixed(2),
          ])}
          kpiSummary={{
            'Fleet CPK':              kpis.cpk.validCount > 0 ? `${activeCurrency} ${kpis.cpk.fleetAvgCpk.toFixed(4)}/km` : 'N/A',
            'Avg Tyre Life':          kpis.avgTyreLife.validCount > 0 ? `${Math.round(kpis.avgTyreLife.avgKm).toLocaleString()} km` : 'N/A',
            'Failure Rate':           `${(kpis.failureRate.failureRate * 100).toFixed(1)}%`,
            'Inspection Compliance':  `${kpis.inspectionCompliance.compliancePct.toFixed(1)}%`,
            'Fleet Availability':     `${kpis.fleetAvailability.availabilityPct.toFixed(1)}%`,
            'Scrap Rate':             `${(kpis.scrapRate.scrapRate * 100).toFixed(1)}%`,
            'Cost Trend':             kpis.costTrend.trend.charAt(0).toUpperCase() + kpis.costTrend.trend.slice(1),
            'Downtime Hours':         `${kpis.downtimeImpact.totalDowntimeHours.toLocaleString()} hrs`,
          }}
          period={dateFrom && dateTo ? `${dateFrom} - ${dateTo}` : 'All Time'}
        />
      )}
    </div>
  )
}

// ── Export helper: build flat KPI summary rows ────────────────────────────────
function buildKpiSummaryRows(kpis, currency) {
  if (!kpis) return []
  const { cpk, avgTyreLife, removalRate, failureRate, replacementRate,
          pressureCompliance, inspectionCompliance, retreadPerformance,
          scrapRate, fleetAvailability, downtimeImpact, costTrend,
          vendorPerformance, workshopPerformance } = kpis

  const n = v => v ?? 'N/A'

  return [
    { kpi: `CPK Fleet Average (${currency}/km)`,  value: cpk.validCount > 0 ? cpk.fleetAvgCpk.toFixed(4) : 'N/A',              status: cpk.fleetAvgCpk < 1.0 ? 'Good' : cpk.fleetAvgCpk < 2.0 ? 'Warning' : 'Critical', description: `Coverage ${cpk.coveragePct.toFixed(1)}% (${cpk.validCount}/${cpk.totalCount})` },
    { kpi: `Cost Per Mile (${currency}/mile)`,    value: cpk.validCount > 0 ? (cpk.fleetAvgCpk * 1.60934).toFixed(4) : 'N/A', status: 'Derived',   description: 'CPK × 1.609' },
    { kpi: 'Average Tyre Life (km)',           value: avgTyreLife.validCount > 0 ? Math.round(avgTyreLife.avgKm) : 'N/A',       status: avgTyreLife.avgKm > 40000 ? 'Good' : avgTyreLife.avgKm > 20000 ? 'Warning' : 'Critical', description: `Median: ${Math.round(avgTyreLife.medianKm).toLocaleString()} km` },
    { kpi: 'Fleet Avg Tyre Life (km)',         value: avgTyreLife.validCount > 0 ? Math.round(avgTyreLife.avgKm) : 'N/A',       status: 'See Above', description: 'Fleet-wide average' },
    { kpi: 'Tyre Removal Rate (per 1000 km)', value: removalRate.estimatedFleetKm > 0 ? removalRate.removalPer1000Km.toFixed(4) : 'N/A', status: 'Informational', description: `${removalRate.totalRemovals} removals / ${Math.round(removalRate.estimatedFleetKm).toLocaleString()} km` },
    { kpi: 'Tyre Failure Rate (%)',            value: (failureRate.failureRate * 100).toFixed(2),                                status: failureRate.failureRate > 0.30 ? 'Critical' : failureRate.failureRate > 0.15 ? 'Warning' : 'Good', description: `${failureRate.failureCount} failures (Critical: ${Math.round(failureRate.criticalRate * 100)}%, High: ${Math.round(failureRate.highRate * 100)}%)` },
    { kpi: 'Tyre Replacement Rate (per veh/mo)', value: replacementRate.avgPerVehiclePerMonth.toFixed(3),                       status: replacementRate.avgPerVehiclePerMonth < 0.5 ? 'Good' : 'Warning', description: `${replacementRate.totalReplacements} total / ${replacementRate.activeVehicles} vehicles` },
    { kpi: 'Pressure Compliance (%)',          value: pressureCompliance.compliancePct.toFixed(1),                              status: pressureCompliance.compliancePct > 85 ? 'Good' : pressureCompliance.compliancePct > 60 ? 'Warning' : 'Critical', description: `${pressureCompliance.compliantCount}/${pressureCompliance.totalCount}` },
    { kpi: 'Inspection Compliance (%)',        value: inspectionCompliance.compliancePct.toFixed(1),                            status: inspectionCompliance.compliancePct > 85 ? 'Good' : inspectionCompliance.compliancePct > 60 ? 'Warning' : 'Critical', description: `On-time: ${inspectionCompliance.onTimeCount}, Overdue: ${inspectionCompliance.overdueCount}` },
    { kpi: 'Retread Performance',              value: retreadPerformance ? `${retreadPerformance.savingsPct.toFixed(1)}% savings` : 'Insufficient data', status: retreadPerformance && retreadPerformance.savingsPct > 0 ? 'Good' : 'Neutral', description: retreadPerformance ? `Retread CPK: ${retreadPerformance.retreadCpk.toFixed(4)} vs New: ${retreadPerformance.newCpk.toFixed(4)}` : '' },
    { kpi: 'Scrap Rate (%)',                   value: (scrapRate.scrapRate * 100).toFixed(1),                                   status: scrapRate.scrapRate > 0.20 ? 'Critical' : scrapRate.scrapRate > 0.10 ? 'Warning' : 'Good', description: `${scrapRate.scrapCount} scrapped · Est. cost: ${currency} ${scrapRate.estimatedScrapCost.toLocaleString()}` },
    { kpi: 'Fleet Availability Impact (%)',    value: fleetAvailability.availabilityPct.toFixed(1),                             status: fleetAvailability.availabilityPct > 90 ? 'Good' : fleetAvailability.availabilityPct > 75 ? 'Warning' : 'Critical', description: `${fleetAvailability.unavailableCount} critical of ${fleetAvailability.fleetSize}` },
    { kpi: 'Vehicle Downtime Impact (hrs)',    value: downtimeImpact.totalDowntimeHours.toLocaleString(),                       status: downtimeImpact.totalDowntimeHours > 500 ? 'Critical' : 'Informational', description: `Avg ${downtimeImpact.avgDowntimePerVehicle.toFixed(1)} hrs/vehicle` },
    { kpi: 'Cost Trend',                       value: costTrend.trend,                                                          status: costTrend.trend === 'improving' ? 'Good' : costTrend.trend === 'worsening' ? 'Critical' : 'Neutral', description: `Slope: ${currency} ${Math.round(costTrend.slope)}/month · Forecast: ${currency} ${Math.round(Math.max(0, costTrend.forecastNextMonth)).toLocaleString()}` },
    { kpi: 'Vendor Performance (Top Brand)',   value: vendorPerformance[0]?.brand ?? 'N/A',                                     status: 'Informational', description: vendorPerformance[0] ? `Score: ${vendorPerformance[0].score.toFixed(3)} · CPK: ${vendorPerformance[0].avgCpk.toFixed(4)}` : '' },
    { kpi: 'Workshop Performance (Best Site)', value: workshopPerformance.bySite[0]?.site ?? 'N/A',                            status: 'Informational', description: workshopPerformance.bySite[0] ? `Score: ${workshopPerformance.bySite[0].score.toFixed(3)}` : '' },
    { kpi: 'Fleet CPK Coverage (%)',           value: cpk.coveragePct.toFixed(1),                                              status: cpk.coveragePct > 80 ? 'Good' : cpk.coveragePct > 50 ? 'Warning' : 'Critical', description: `${cpk.validCount} valid / ${cpk.totalCount - cpk.validCount} missing km data` },
  ]
}
