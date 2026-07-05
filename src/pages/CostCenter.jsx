import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { useLanguage } from '../contexts/LanguageContext'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'
import {
  DollarSign, TrendingUp, TrendingDown, BarChart2, PieChart, Target,
  AlertTriangle, Award, ArrowUpRight, ArrowDownRight, Minus, Download,
  RefreshCw, Loader2, FileSpreadsheet, FileText, Zap,
} from 'lucide-react'
import { SkeletonCards, SkeletonTable } from '../components/ui/Skeleton'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  ArcElement, Title, Tooltip, Legend, Filler,
)

// ── Constants ───────────────────────────────────────────────────────────────────
const INDUSTRY_BENCHMARK_CPK = 1.50   // R/km benchmark
const SAVINGS_OPPORTUNITY_PCT = 0.15  // 15% savings estimate
const PALETTE = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
  '#06b6d4', '#a855f7',
]

const PERIOD_PRESETS = [
  { label: '30d',  days: 30 },
  { label: '90d',  days: 90 },
  { label: '6m',   days: 180 },
  { label: '1yr',  days: 365 },
  { label: 'All',  days: null },
]

const DIMENSION_TABS = ['By Site', 'By Brand', 'By Vehicle', 'By Month']
const DIMENSION_TAB_KEYS = ['bySite', 'byBrand', 'byVehicle', 'byMonth']

const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { labels: { color: '#9ca3af', font: { size: 11 } } },
    tooltip: {
      backgroundColor: 'var(--panel-2)',
      titleColor: '#f3f4f6',
      bodyColor: '#9ca3af',
      borderColor: 'rgba(22,163,74,0.3)',
      borderWidth: 1,
    },
  },
  scales: {
    x: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color:'var(--text-muted)' } },
    y: { ticks: { color: '#6b7280', font: { size: 11 } }, grid: { color:'var(--text-muted)' } },
  },
}

// ── Helpers ─────────────────────────────────────────────────────────────────────
function calcCpk(cost, kmFit, kmRem) {
  const km = (kmRem ?? 0) - (kmFit ?? 0)
  if (km <= 0 || !cost || cost <= 0) return null
  return cost / km
}

function fmtCurrency(v, currency) {
  if (v == null || !isFinite(v)) return `${currency} 0`
  if (Math.abs(v) >= 1_000_000) return `${currency} ${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 1_000) return `${currency} ${(v / 1_000).toFixed(1)}K`
  return `${currency} ${Math.round(v).toLocaleString()}`
}

function fmtCpk(v, currency) {
  if (v == null || !isFinite(v)) return 'N/A'
  return `${currency} ${v.toFixed(4)}/km`
}

function fmtPct(v) {
  if (v == null || !isFinite(v)) return 'N/A'
  return `${v.toFixed(1)}%`
}

function monthKey(dateStr) {
  if (!dateStr) return 'Unknown'
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key) {
  if (!key || key === 'Unknown') return key
  const [y, m] = key.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(m,10)-1]} ${y}`
}

function movingAvg(arr, n = 3) {
  return arr.map((_, i) => {
    const slice = arr.slice(Math.max(0, i - n + 1), i + 1)
    return slice.reduce((a, b) => a + b, 0) / slice.length
  })
}

function dateFromPreset(days) {
  if (!days) return ''
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function cpkDeltaBadge(cpk, fleetAvg) {
  if (cpk == null || fleetAvg == null || fleetAvg === 0) return null
  const pct = ((cpk - fleetAvg) / fleetAvg) * 100
  if (Math.abs(pct) < 5) return { icon: Minus, label: '≈ avg', cls: 'text-gray-400' }
  if (pct > 0) return { icon: ArrowUpRight, label: `+${pct.toFixed(0)}%`, cls: 'text-red-400' }
  return { icon: ArrowDownRight, label: `${pct.toFixed(0)}%`, cls: 'text-green-400' }
}

// ── Main Component ───────────────────────────────────────────────────────────────
export default function CostCenter() {
  const { activeCurrency, activeCountry } = useSettings()
  const { t } = useLanguage()

  const [records, setRecords]           = useState([])
  const [loading, setLoading]           = useState(true)
  const [error, setError]               = useState(null)
  const [activeTab, setActiveTab]       = useState(0)
  const [preset, setPreset]             = useState('1yr')
  const [dateFrom, setDateFrom]         = useState(dateFromPreset(365))
  const [dateTo, setDateTo]             = useState(new Date().toISOString().slice(0, 10))
  const [roiSlider, setRoiSlider]       = useState(10)   // % improvement
  const [exporting, setExporting]       = useState(false)

  // ── Data Fetch ────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: err } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select(
            'id, asset_number, asset_no, brand, site, country, cost_per_tyre, ' +
            'km_at_fitment, km_at_removal, risk_level, removal_reason, category, ' +
            'created_at, tyre_position, position'
          )

        if (activeCountry && activeCountry !== 'All') {
          q = q.eq('country', activeCountry)
        }
        if (dateFrom) q = q.gte('created_at', dateFrom)
        if (dateTo)   q = q.lte('created_at', dateTo + 'T23:59:59')

        return q.order('created_at', { ascending: false }).range(from, to)
      }, { max: 200000 })
      if (err) throw err
      setRecords(data ?? [])
    } catch (e) {
      setError(e.message ?? 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [activeCountry, dateFrom, dateTo])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Normalise Fields ──────────────────────────────────────────────────────────
  const normalised = useMemo(() =>
    records.map(r => ({
      ...r,
      asset: r.asset_no ?? r.asset_number ?? 'Unknown',
      pos:   r.tyre_position ?? r.position ?? 'Unknown',
      cost:  parseFloat(r.cost_per_tyre) || 0,
      kmFit: parseFloat(r.km_at_fitment)  || 0,
      kmRem: parseFloat(r.km_at_removal)  || 0,
      cpk:   calcCpk(
        parseFloat(r.cost_per_tyre),
        parseFloat(r.km_at_fitment),
        parseFloat(r.km_at_removal),
      ),
    }))
  , [records])

  // ── Fleet KPIs ────────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalSpend   = normalised.reduce((s, r) => s + r.cost, 0)
    const cpkRecords   = normalised.filter(r => r.cpk !== null)
    const fleetAvgCpk  = cpkRecords.length
      ? cpkRecords.reduce((s, r) => s + r.cpk, 0) / cpkRecords.length
      : null

    // Period in months
    const from = dateFrom ? new Date(dateFrom) : null
    const to   = dateTo   ? new Date(dateTo)   : new Date()
    const months = from
      ? Math.max(1, (to - from) / (1000 * 60 * 60 * 24 * 30.44))
      : 12

    const monthlyBurn     = totalSpend / months
    const annualized      = monthlyBurn * 12
    const savingsOppty    = fleetAvgCpk && fleetAvgCpk > INDUSTRY_BENCHMARK_CPK
      ? annualized * SAVINGS_OPPORTUNITY_PCT
      : 0

    return { totalSpend, fleetAvgCpk, monthlyBurn, annualized, savingsOppty, months, cpkCount: cpkRecords.length }
  }, [normalised, dateFrom, dateTo])

  // ── By Site ───────────────────────────────────────────────────────────────────
  const bySite = useMemo(() => {
    const map = {}
    normalised.forEach(r => {
      const site = r.site || 'Unknown'
      if (!map[site]) map[site] = { site, count: 0, totalCost: 0, cpks: [] }
      map[site].count++
      map[site].totalCost += r.cost
      if (r.cpk !== null) map[site].cpks.push(r.cpk)
    })
    return Object.values(map)
      .map(s => ({
        ...s,
        avgCost: s.count ? s.totalCost / s.count : 0,
        avgCpk:  s.cpks.length ? s.cpks.reduce((a, b) => a + b, 0) / s.cpks.length : null,
      }))
      .sort((a, b) => b.totalCost - a.totalCost)
  }, [normalised])

  // ── By Brand ──────────────────────────────────────────────────────────────────
  const byBrand = useMemo(() => {
    const map = {}
    normalised.forEach(r => {
      const brand = r.brand || 'Unknown'
      if (!map[brand]) map[brand] = { brand, count: 0, totalCost: 0, cpks: [], failures: 0, positions: {} }
      map[brand].count++
      map[brand].totalCost += r.cost
      if (r.cpk !== null) map[brand].cpks.push(r.cpk)
      if (/fail|burst|damage|scrap/i.test(r.removal_reason ?? '')) map[brand].failures++
      const pos = r.pos || 'Unknown'
      map[brand].positions[pos] = (map[brand].positions[pos] ?? 0) + 1
    })
    return Object.values(map)
      .map((b, idx) => ({
        ...b,
        avgCpk:       b.cpks.length ? b.cpks.reduce((a, v) => a + v, 0) / b.cpks.length : null,
        failureRate:  b.count > 0 ? (b.failures / b.count) * 100 : 0,
        bestPosition: Object.entries(b.positions).sort((a, z) => z[1] - a[1])[0]?.[0] ?? 'N/A',
        rank: idx + 1,
      }))
      .sort((a, b) => {
        if (a.avgCpk == null && b.avgCpk == null) return 0
        if (a.avgCpk == null) return 1
        if (b.avgCpk == null) return -1
        return a.avgCpk - b.avgCpk
      })
      .map((b, idx) => ({ ...b, rank: idx + 1 }))
  }, [normalised])

  // ── By Vehicle ────────────────────────────────────────────────────────────────
  const byVehicle = useMemo(() => {
    const map = {}
    normalised.forEach(r => {
      const asset = r.asset
      if (!map[asset]) map[asset] = { asset, count: 0, totalCost: 0, cpks: [], risks: [] }
      map[asset].count++
      map[asset].totalCost += r.cost
      if (r.cpk !== null) map[asset].cpks.push(r.cpk)
      if (r.risk_level) map[asset].risks.push(r.risk_level)
    })
    const allAvgCpk = kpis.fleetAvgCpk
    return Object.values(map)
      .map(v => {
        const avgCpk = v.cpks.length ? v.cpks.reduce((a, b) => a + b, 0) / v.cpks.length : null
        const riskScore = v.risks.filter(r => /high|critical/i.test(r)).length
        const trend = avgCpk && allAvgCpk
          ? (avgCpk > allAvgCpk * 1.2 ? 'up' : avgCpk < allAvgCpk * 0.8 ? 'down' : 'flat')
          : 'flat'
        return { ...v, avgCpk, riskScore, trend }
      })
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, 50)
  }, [normalised, kpis.fleetAvgCpk])

  // ── By Month ──────────────────────────────────────────────────────────────────
  const byMonth = useMemo(() => {
    const map = {}
    normalised.forEach(r => {
      const mk = monthKey(r.created_at)
      if (!map[mk]) map[mk] = { month: mk, totalCost: 0, count: 0, cpks: [] }
      map[mk].totalCost += r.cost
      map[mk].count++
      if (r.cpk !== null) map[mk].cpks.push(r.cpk)
    })
    return Object.values(map)
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-12)
      .map(m => ({
        ...m,
        avgCpk: m.cpks.length ? m.cpks.reduce((a, b) => a + b, 0) / m.cpks.length : null,
      }))
  }, [normalised])

  // ── Anomalies ─────────────────────────────────────────────────────────────────
  const anomalies = useMemo(() => {
    const items = []
    const fleetAvg = kpis.fleetAvgCpk

    // Assets with CPK > 2× fleet avg
    if (fleetAvg) {
      byVehicle.forEach(v => {
        if (v.avgCpk && v.avgCpk > fleetAvg * 2) {
          items.push({
            type: 'vehicle',
            id: v.asset,
            label: t('costcenter.anomaly.vehicleLabel', { asset: v.asset }),
            metric: t('costcenter.anomaly.metricCpk', { value: fmtCpk(v.avgCpk, activeCurrency) }),
            severity: 'Critical',
            description: t('costcenter.anomaly.descVehicle', { pct: ((v.avgCpk / fleetAvg - 1) * 100).toFixed(0) }),
            recommendation: t('costcenter.anomaly.recVehicle'),
          })
        }
      })
    }

    // Sites >30% above fleet avg CPK
    if (fleetAvg) {
      bySite.forEach(s => {
        if (s.avgCpk && s.avgCpk > fleetAvg * 1.3) {
          items.push({
            type: 'site',
            id: s.site,
            label: t('costcenter.anomaly.siteLabel', { site: s.site }),
            metric: t('costcenter.anomaly.metricCpk', { value: fmtCpk(s.avgCpk, activeCurrency) }),
            severity: 'High',
            description: t('costcenter.anomaly.descSite', { pct: ((s.avgCpk / fleetAvg - 1) * 100).toFixed(0) }),
            recommendation: t('costcenter.anomaly.recSite'),
          })
        }
      })
    }

    // Brands with failure rate >20%
    byBrand.forEach(b => {
      if (b.failureRate > 20) {
        items.push({
          type: 'brand',
          id: b.brand,
          label: t('costcenter.anomaly.brandLabel', { brand: b.brand }),
          metric: t('costcenter.anomaly.metricFailureRate', { value: fmtPct(b.failureRate) }),
          severity: 'High',
          description: t('costcenter.anomaly.descBrand', { failures: b.failures, count: b.count }),
          recommendation: t('costcenter.anomaly.recBrand'),
        })
      }
    })

    return items.slice(0, 12)
  }, [kpis.fleetAvgCpk, byVehicle, bySite, byBrand, activeCurrency, t])

  // ── ROI Calculator ────────────────────────────────────────────────────────────
  const roi = useMemo(() => {
    const improvement = roiSlider / 100
    const monthlySavings  = kpis.monthlyBurn * improvement
    const annualSavings   = kpis.annualized  * improvement
    const investmentProxy = kpis.monthlyBurn * 0.05  // ~5% monthly spend on maintenance
    const paybackMonths   = investmentProxy > 0 ? investmentProxy / monthlySavings : null
    return { monthlySavings, annualSavings, paybackMonths }
  }, [roiSlider, kpis])

  // ── Period preset handler ─────────────────────────────────────────────────────
  function applyPreset(p) {
    setPreset(p.label)
    setDateFrom(dateFromPreset(p.days))
    setDateTo(new Date().toISOString().slice(0, 10))
  }

  // ── Chart Data ────────────────────────────────────────────────────────────────
  const siteBarData = useMemo(() => ({
    labels: bySite.slice(0, 10).map(s => s.site),
    datasets: [{
      label: t('costcenter.charts.totalCost'),
      data: bySite.slice(0, 10).map(s => s.totalCost),
      backgroundColor: PALETTE,
      borderRadius: 4,
    }],
  }), [bySite, t])

  const brandBarData = useMemo(() => ({
    labels: byBrand.slice(0, 10).map(b => b.brand),
    datasets: [{
      label: t('costcenter.charts.avgCpk'),
      data: byBrand.slice(0, 10).map(b => b.avgCpk ?? 0),
      backgroundColor: PALETTE,
      borderRadius: 4,
    }],
  }), [byBrand, t])

  const monthlyLineData = useMemo(() => {
    const costs = byMonth.map(m => m.totalCost)
    const cpks  = byMonth.map(m => m.avgCpk ?? 0)
    return {
      labels: byMonth.map(m => monthLabel(m.month)),
      datasets: [
        {
          label: t('costcenter.charts.totalCost'),
          data: costs,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.12)',
          tension: 0.3,
          fill: true,
          yAxisID: 'y',
          pointRadius: 4,
          pointHoverRadius: 6,
        },
        {
          label: t('costcenter.charts.avgCpk'),
          data: cpks,
          borderColor: '#10b981',
          backgroundColor: 'transparent',
          tension: 0.3,
          fill: false,
          yAxisID: 'y1',
          borderDash: [4, 4],
          pointRadius: 3,
          pointHoverRadius: 5,
        },
      ],
    }
  }, [byMonth, t])

  const monthlyTrendData = useMemo(() => {
    const costs  = byMonth.map(m => m.totalCost)
    const ma3    = movingAvg(costs, 3)
    return {
      labels: byMonth.map(m => monthLabel(m.month)),
      datasets: [
        {
          label: t('costcenter.charts.monthlySpend'),
          data: costs,
          backgroundColor: 'rgba(59,130,246,0.7)',
          borderRadius: 4,
          type: 'bar',
        },
        {
          label: t('costcenter.charts.movingAvg3'),
          data: ma3,
          borderColor: '#f59e0b',
          backgroundColor: 'transparent',
          type: 'line',
          tension: 0.4,
          borderWidth: 2,
          pointRadius: 0,
          yAxisID: 'y',
        },
      ],
    }
  }, [byMonth, t])

  const doughnutData = useMemo(() => {
    const top8  = bySite.slice(0, 8)
    const other = bySite.slice(8).reduce((s, r) => s + r.totalCost, 0)
    const labels = [...top8.map(s => s.site)]
    const data   = [...top8.map(s => s.totalCost)]
    if (other > 0) { labels.push(t('costcenter.charts.other')); data.push(other) }
    return {
      labels,
      datasets: [{
        data,
        backgroundColor: [...PALETTE, '#6b7280'],
        borderColor: 'rgba(0,0,0,0.3)',
        borderWidth: 1,
      }],
    }
  }, [bySite, t])

  const topAssetsData = useMemo(() => {
    const top10 = byVehicle.slice(0, 10)
    return {
      labels: top10.map(v => v.asset),
      datasets: [{
        label: t('costcenter.charts.totalCost'),
        data: top10.map(v => v.totalCost),
        backgroundColor: 'rgba(139,92,246,0.7)',
        borderRadius: 4,
      }],
    }
  }, [byVehicle, t])

  // ── Export Handlers ───────────────────────────────────────────────────────────
  async function handleExcelExport() {
    setExporting(true)
    try {
      exportToExcel(
        bySite.map(s => ({
          site:      s.site,
          count:     s.count,
          totalCost: Math.round(s.totalCost),
          avgCost:   Math.round(s.avgCost),
          avgCpk:    s.avgCpk ? s.avgCpk.toFixed(4) : 'N/A',
        })),
        ['site', 'count', 'totalCost', 'avgCost', 'avgCpk'],
        ['Site', 'Tyres', `Total Cost (${activeCurrency})`, `Avg Cost (${activeCurrency})`, 'Avg CPK'],
        'CostCenter_BySite',
        'Cost by Site',
      )
    } finally { setExporting(false) }
  }

  async function handlePdfExport() {
    setExporting(true)
    try {
      exportToPdf(
        bySite.map(s => ({
          site:      s.site,
          count:     s.count,
          totalCost: `${activeCurrency} ${Math.round(s.totalCost).toLocaleString()}`,
          avgCpk:    s.avgCpk ? `${activeCurrency} ${s.avgCpk.toFixed(4)}` : 'N/A',
        })),
        [
          { key: 'site',      header: 'Site' },
          { key: 'count',     header: 'Tyres' },
          { key: 'totalCost', header: 'Total Cost' },
          { key: 'avgCpk',    header: 'Avg CPK' },
        ],
        'Cost Center - Cost by Site',
        'CostCenter_Report',
        'landscape',
        '',
        { currency: activeCurrency },
      )
    } finally { setExporting(false) }
  }

  // ── Severity colours ──────────────────────────────────────────────────────────
  const severityStyle = {
    Critical: 'bg-red-900/40 text-red-300 border border-red-800/60',
    High:     'bg-orange-900/40 text-orange-300 border border-orange-800/60',
    Medium:   'bg-yellow-900/40 text-yellow-300 border border-yellow-800/60',
    Low:      'bg-green-900/40 text-green-300 border border-green-800/60',
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <motion.div
      className="space-y-6"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <PageHeader
        title={t('costcenter.title')}
        subtitle={t('costcenter.subtitle')}
        icon={DollarSign}
        actions={<>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-gray-900 border border-gray-800">
            {PERIOD_PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => applyPreset(p)}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${
                  preset === p.label
                    ? 'bg-green-700 text-white'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {t(`costcenter.periods.${p.label}`)}
              </button>
            ))}
          </div>
          <input
            type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPreset('custom') }}
            className="text-xs bg-gray-900 border border-gray-700 text-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-green-600"
          />
          <span className="text-gray-600 text-xs">→</span>
          <input
            type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPreset('custom') }}
            className="text-xs bg-gray-900 border border-gray-700 text-gray-300 rounded-lg px-2 py-1.5 focus:outline-none focus:border-green-600"
          />
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2 rounded-lg bg-gray-900 border border-gray-700 text-gray-400 hover:text-green-400 hover:border-green-700 transition-all disabled:opacity-50"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          </button>
          <button
            onClick={handleExcelExport}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-gray-400 hover:text-green-400 hover:border-green-700 transition-all text-xs disabled:opacity-50"
          >
            <FileSpreadsheet size={13} />
            {t('costcenter.actions.excel')}
          </button>
          <button
            onClick={handlePdfExport}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-700 text-gray-400 hover:text-green-400 hover:border-green-700 transition-all text-xs disabled:opacity-50"
          >
            <FileText size={13} />
            {t('costcenter.actions.pdf')}
          </button>
        </>}
      />

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-900/30 border border-red-800/60 text-red-300 text-sm">
          <AlertTriangle size={16} />
          {error}
        </div>
      )}

      {/* ── Loading skeleton ────────────────────────────────────────────────── */}
      {loading && (
        <div className="space-y-4">
          <SkeletonCards count={4} />
          <SkeletonTable rows={8} cols={5} />
        </div>
      )}

      {!loading && (
        <>
          {/* ── 1. KPI Cards ─────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <KpiCard
              icon={DollarSign}
              label={t('costcenter.kpi.totalSpend.label')}
              value={fmtCurrency(kpis.totalSpend, activeCurrency)}
              sub={t('costcenter.kpi.totalSpend.sub', { count: normalised.length })}
              accent="green"
            />
            <KpiCard
              icon={Target}
              label={t('costcenter.kpi.fleetAvgCpk.label')}
              value={fmtCpk(kpis.fleetAvgCpk, activeCurrency)}
              sub={t('costcenter.kpi.fleetAvgCpk.sub', { currency: activeCurrency, value: INDUSTRY_BENCHMARK_CPK })}
              accent={kpis.fleetAvgCpk && kpis.fleetAvgCpk > INDUSTRY_BENCHMARK_CPK ? 'red' : 'green'}
            />
            <KpiCard
              icon={BarChart2}
              label={t('costcenter.kpi.monthlyBurn.label')}
              value={fmtCurrency(kpis.monthlyBurn, activeCurrency)}
              sub={t('costcenter.kpi.monthlyBurn.sub')}
              accent="blue"
            />
            <KpiCard
              icon={TrendingUp}
              label={t('costcenter.kpi.annualized.label')}
              value={fmtCurrency(kpis.annualized, activeCurrency)}
              sub={t('costcenter.kpi.annualized.sub')}
              accent="purple"
            />
            <KpiCard
              icon={Zap}
              label={t('costcenter.kpi.savings.label')}
              value={kpis.savingsOppty > 0 ? fmtCurrency(kpis.savingsOppty, activeCurrency) : t('costcenter.kpi.savings.onTarget')}
              sub={kpis.savingsOppty > 0 ? t('costcenter.kpi.savings.subOpportunity') : t('costcenter.kpi.savings.subOnTarget')}
              accent={kpis.savingsOppty > 0 ? 'yellow' : 'green'}
            />
          </div>

          {/* ── 2. Dimension Tabs ────────────────────────────────────────────── */}
          <div
            className="rounded-xl border border-gray-800 overflow-hidden"
            style={{ background: 'var(--panel-deep)' }}
          >
            {/* Tab bar */}
            <div className="flex border-b border-gray-800">
              {DIMENSION_TABS.map((tab, i) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(i)}
                  className={`px-5 py-3 text-sm font-medium transition-all relative ${
                    activeTab === i ? 'text-green-300' : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {t(`costcenter.tabs.${DIMENSION_TAB_KEYS[i]}`)}
                  {activeTab === i && (
                    <motion.span
                      layoutId="tab-underline"
                      className="absolute bottom-0 left-0 right-0 h-0.5 bg-green-500"
                    />
                  )}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="p-5"
              >
                {/* ── By Site ── */}
                {activeTab === 0 && (
                  <div className="space-y-5">
                    <div className="h-64">
                      <Bar
                        data={siteBarData}
                        options={{
                          ...CHART_DEFAULTS,
                          plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } },
                          scales: {
                            ...CHART_DEFAULTS.scales,
                            y: { ...CHART_DEFAULTS.scales.y, ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => `${activeCurrency} ${(v/1000).toFixed(0)}K` } },
                          },
                        }}
                      />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-800 text-left">
                            {[
                              t('costcenter.columns.bySite.site'),
                              t('costcenter.columns.bySite.tyres'),
                              t('costcenter.columns.bySite.totalCost'),
                              t('costcenter.columns.bySite.avgCostPerTyre'),
                              t('costcenter.columns.bySite.avgCpk'),
                              t('costcenter.columns.bySite.vsFleetAvg'),
                            ].map(h => (
                              <th key={h} className="pb-2 pr-4 text-xs text-gray-500 font-medium">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {bySite.map((s, i) => {
                            const delta = cpkDeltaBadge(s.avgCpk, kpis.fleetAvgCpk)
                            const DeltaIcon = delta?.icon ?? Minus
                            return (
                              <tr key={s.site} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                                <td className="py-2.5 pr-4 text-gray-200 font-medium">{s.site}</td>
                                <td className="py-2.5 pr-4 text-gray-400">{s.count}</td>
                                <td className="py-2.5 pr-4 text-gray-200">{fmtCurrency(s.totalCost, activeCurrency)}</td>
                                <td className="py-2.5 pr-4 text-gray-400">{fmtCurrency(s.avgCost, activeCurrency)}</td>
                                <td className="py-2.5 pr-4 text-gray-300">{fmtCpk(s.avgCpk, activeCurrency)}</td>
                                <td className="py-2.5 pr-4">
                                  {delta ? (
                                    <span className={`flex items-center gap-1 text-xs font-medium ${delta.cls}`}>
                                      <DeltaIcon size={12} />{delta.label}
                                    </span>
                                  ) : <span className="text-gray-600 text-xs">{t('costcenter.states.na')}</span>}
                                </td>
                              </tr>
                            )
                          })}
                          {bySite.length === 0 && (
                            <tr><td colSpan={6} className="text-center py-8 text-gray-600 text-sm">{t('costcenter.states.noDataPeriod')}</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* ── By Brand ── */}
                {activeTab === 1 && (
                  <div className="space-y-5">
                    <div className="h-64">
                      <Bar
                        data={brandBarData}
                        options={{
                          ...CHART_DEFAULTS,
                          plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } },
                          scales: {
                            ...CHART_DEFAULTS.scales,
                            y: { ...CHART_DEFAULTS.scales.y, ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => `${activeCurrency} ${v.toFixed(3)}` } },
                          },
                        }}
                      />
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-800 text-left">
                            {[
                              t('costcenter.columns.byBrand.rank'),
                              t('costcenter.columns.byBrand.brand'),
                              t('costcenter.columns.byBrand.count'),
                              t('costcenter.columns.byBrand.totalCost'),
                              t('costcenter.columns.byBrand.avgCpk'),
                              t('costcenter.columns.byBrand.failureRate'),
                              t('costcenter.columns.byBrand.bestPosition'),
                            ].map(h => (
                              <th key={h} className="pb-2 pr-4 text-xs text-gray-500 font-medium">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {byBrand.map(b => (
                            <tr key={b.brand} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                              <td className="py-2.5 pr-4">
                                <RankBadge rank={b.rank} />
                              </td>
                              <td className="py-2.5 pr-4 text-gray-200 font-medium">{b.brand}</td>
                              <td className="py-2.5 pr-4 text-gray-400">{b.count}</td>
                              <td className="py-2.5 pr-4 text-gray-200">{fmtCurrency(b.totalCost, activeCurrency)}</td>
                              <td className="py-2.5 pr-4 text-gray-300">{fmtCpk(b.avgCpk, activeCurrency)}</td>
                              <td className="py-2.5 pr-4">
                                <span className={`text-xs font-medium ${b.failureRate > 20 ? 'text-red-400' : b.failureRate > 10 ? 'text-orange-400' : 'text-green-400'}`}>
                                  {fmtPct(b.failureRate)}
                                </span>
                              </td>
                              <td className="py-2.5 pr-4 text-gray-400 text-xs">{b.bestPosition}</td>
                            </tr>
                          ))}
                          {byBrand.length === 0 && (
                            <tr><td colSpan={7} className="text-center py-8 text-gray-600 text-sm">{t('costcenter.states.noDataPeriod')}</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* ── By Vehicle ── */}
                {activeTab === 2 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800 text-left">
                          {[
                            t('costcenter.columns.byVehicle.assetNo'),
                            t('costcenter.columns.byVehicle.tyres'),
                            t('costcenter.columns.byVehicle.totalCost'),
                            t('costcenter.columns.byVehicle.avgCpk'),
                            t('costcenter.columns.byVehicle.riskScore'),
                            t('costcenter.columns.byVehicle.trend'),
                          ].map(h => (
                            <th key={h} className="pb-2 pr-4 text-xs text-gray-500 font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {byVehicle.map(v => (
                          <tr key={v.asset} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                            <td className="py-2.5 pr-4 text-gray-200 font-medium font-mono text-xs">{v.asset}</td>
                            <td className="py-2.5 pr-4 text-gray-400">{v.count}</td>
                            <td className="py-2.5 pr-4 text-gray-200">{fmtCurrency(v.totalCost, activeCurrency)}</td>
                            <td className="py-2.5 pr-4 text-gray-300">{fmtCpk(v.avgCpk, activeCurrency)}</td>
                            <td className="py-2.5 pr-4">
                              <span className={`text-xs font-bold ${v.riskScore > 3 ? 'text-red-400' : v.riskScore > 1 ? 'text-orange-400' : 'text-green-400'}`}>
                                {v.riskScore > 0 ? t('costcenter.risk.high', { count: v.riskScore }) : t('costcenter.risk.low')}
                              </span>
                            </td>
                            <td className="py-2.5 pr-4">
                              {v.trend === 'up'   && <span className="flex items-center gap-1 text-xs text-red-400"><TrendingUp size={12} />{t('costcenter.trend.rising')}</span>}
                              {v.trend === 'down' && <span className="flex items-center gap-1 text-xs text-green-400"><TrendingDown size={12} />{t('costcenter.trend.falling')}</span>}
                              {v.trend === 'flat' && <span className="flex items-center gap-1 text-xs text-gray-500"><Minus size={12} />{t('costcenter.trend.stable')}</span>}
                            </td>
                          </tr>
                        ))}
                        {byVehicle.length === 0 && (
                          <tr><td colSpan={6} className="text-center py-8 text-gray-600 text-sm">{t('costcenter.states.noDataPeriod')}</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* ── By Month ── */}
                {activeTab === 3 && (
                  <div className="h-80">
                    {byMonth.length > 0 ? (
                      <Line
                        data={monthlyLineData}
                        options={{
                          ...CHART_DEFAULTS,
                          scales: {
                            x: CHART_DEFAULTS.scales.x,
                            y: {
                              ...CHART_DEFAULTS.scales.y,
                              position: 'left',
                              ticks: { color: '#6b7280', callback: v => `${activeCurrency} ${(v/1000).toFixed(0)}K` },
                            },
                            y1: {
                              position: 'right',
                              grid: { drawOnChartArea: false },
                              ticks: { color: '#6b7280', callback: v => `${activeCurrency} ${v.toFixed(3)}` },
                            },
                          },
                        }}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-gray-600 text-sm">
                        {t('costcenter.states.noMonthlyData')}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* ── 3. Breakdown Charts ──────────────────────────────────────────── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Doughnut */}
            <div className="rounded-xl border border-gray-800 p-5" style={{ background: 'var(--panel-deep)' }}>
              <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
                <PieChart size={15} className="text-green-400" />
                {t('costcenter.charts.costDistribution')}
              </h3>
              <div className="h-56">
                {doughnutData.datasets[0].data.length > 0 ? (
                  <Doughnut
                    data={doughnutData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { position: 'right', labels: { color: '#9ca3af', font: { size: 10 }, boxWidth: 12, padding: 8 } },
                        tooltip: CHART_DEFAULTS.plugins.tooltip,
                      },
                      cutout: '62%',
                    }}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-600 text-sm">{t('costcenter.states.noData')}</div>
                )}
              </div>
            </div>

            {/* Top Assets horizontal bar */}
            <div className="rounded-xl border border-gray-800 p-5" style={{ background: 'var(--panel-deep)' }}>
              <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
                <Award size={15} className="text-purple-400" />
                {t('costcenter.charts.topAssets')}
              </h3>
              <div className="h-56">
                {topAssetsData.datasets[0].data.length > 0 ? (
                  <Bar
                    data={topAssetsData}
                    options={{
                      ...CHART_DEFAULTS,
                      indexAxis: 'y',
                      plugins: { ...CHART_DEFAULTS.plugins, legend: { display: false } },
                      scales: {
                        x: { ...CHART_DEFAULTS.scales.x, ticks: { ...CHART_DEFAULTS.scales.x.ticks, callback: v => `${(v/1000).toFixed(0)}K` } },
                        y: { ...CHART_DEFAULTS.scales.y, ticks: { color: '#9ca3af', font: { size: 10 } } },
                      },
                    }}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-600 text-sm">{t('costcenter.states.noData')}</div>
                )}
              </div>
            </div>

            {/* Monthly trend with MA */}
            <div className="rounded-xl border border-gray-800 p-5" style={{ background: 'var(--panel-deep)' }}>
              <h3 className="text-sm font-semibold text-gray-200 mb-4 flex items-center gap-2">
                <TrendingUp size={15} className="text-blue-400" />
                {t('costcenter.charts.monthlyTrend')}
              </h3>
              <div className="h-56">
                {monthlyTrendData.datasets[0].data.length > 0 ? (
                  <Bar
                    data={monthlyTrendData}
                    options={{
                      ...CHART_DEFAULTS,
                      plugins: { ...CHART_DEFAULTS.plugins, legend: { labels: { color: '#9ca3af', font: { size: 10 }, boxWidth: 12 } } },
                      scales: {
                        x: { ...CHART_DEFAULTS.scales.x, ticks: { color: '#6b7280', font: { size: 9 } } },
                        y: { ...CHART_DEFAULTS.scales.y, ticks: { ...CHART_DEFAULTS.scales.y.ticks, callback: v => `${(v/1000).toFixed(0)}K` } },
                      },
                    }}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-600 text-sm">{t('costcenter.states.noData')}</div>
                )}
              </div>
            </div>
          </div>

          {/* ── 4. Anomaly Detection ─────────────────────────────────────────── */}
          <div className="rounded-xl border border-gray-800 p-5" style={{ background: 'var(--panel-deep)' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                <AlertTriangle size={15} className="text-yellow-400" />
                {t('costcenter.anomaly.heading')}
                {anomalies.length > 0 && (
                  <span className="ml-1 px-2 py-0.5 rounded-full bg-red-900/50 text-red-300 text-xs font-bold border border-red-800/60">
                    {anomalies.length}
                  </span>
                )}
              </h3>
              <span className="text-xs text-gray-600">{t('costcenter.anomaly.fleetAvgCpk', { value: fmtCpk(kpis.fleetAvgCpk, activeCurrency) })}</span>
            </div>

            {anomalies.length === 0 ? (
              <div className="flex items-center gap-3 p-4 rounded-lg bg-green-900/20 border border-green-800/40">
                <Target size={18} className="text-green-400 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-300">{t('costcenter.anomaly.noneTitle')}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{t('costcenter.anomaly.noneDesc')}</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {anomalies.map((a, i) => (
                  <motion.div
                    key={`${a.type}-${a.id}`}
                    initial={{ opacity: 0, scale: 0.97 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: i * 0.04 }}
                    className="p-4 rounded-lg border border-gray-700 hover:border-gray-600 transition-colors"
                    style={{ background: 'rgba(15,23,18,0.7)' }}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <span className="text-sm font-semibold text-gray-200 leading-tight">{a.label}</span>
                      <span className={`flex-shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full ${severityStyle[a.severity] ?? ''}`}>
                        {t(`costcenter.severity.${a.severity.toLowerCase()}`)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mb-1">{a.metric}</p>
                    <p className="text-xs text-gray-500 mb-2">{a.description}</p>
                    <p className="text-[11px] text-green-400 font-medium leading-tight">
                      ↪ {a.recommendation}
                    </p>
                  </motion.div>
                ))}
              </div>
            )}
          </div>

          {/* ── 5. ROI Calculator ────────────────────────────────────────────── */}
          <div className="rounded-xl border border-gray-800 p-5" style={{ background: 'var(--panel-deep)' }}>
            <h3 className="text-sm font-semibold text-gray-200 mb-1 flex items-center gap-2">
              <Zap size={15} className="text-yellow-400" />
              {t('costcenter.roi.heading')}
            </h3>
            <p className="text-xs text-gray-500 mb-5">
              {t('costcenter.roi.subtitle')}
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Slider input */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="text-sm text-gray-300 font-medium">{t('costcenter.roi.sliderLabel')}</label>
                  <span className="text-xl font-bold text-green-400">{roiSlider}%</span>
                </div>
                <input
                  type="range"
                  min={1} max={40} step={1}
                  value={roiSlider}
                  onChange={e => setRoiSlider(Number(e.target.value))}
                  className="w-full h-2 rounded-full appearance-none cursor-pointer"
                  style={{ accentColor: '#16a34a' }}
                />
                <div className="flex justify-between text-xs text-gray-600 mt-1.5">
                  <span>1%</span>
                  <span>20%</span>
                  <span>40%</span>
                </div>

                {/* Benchmark callout */}
                <div className="mt-4 p-3 rounded-lg bg-blue-900/20 border border-blue-800/40">
                  <p className="text-xs text-blue-300 font-medium">{t('costcenter.roi.benchmarkTitle')}</p>
                  <p className="text-sm text-gray-300 mt-0.5">
                    <span className="font-bold text-blue-300">{t('costcenter.roi.benchmarkTarget', { currency: activeCurrency, value: INDUSTRY_BENCHMARK_CPK })}</span>
                    {kpis.fleetAvgCpk && (
                      <span className="ml-2 text-gray-500">
                        ({kpis.fleetAvgCpk > INDUSTRY_BENCHMARK_CPK
                          ? t('costcenter.roi.aboveBenchmark', { pct: ((kpis.fleetAvgCpk / INDUSTRY_BENCHMARK_CPK - 1) * 100).toFixed(0) })
                          : t('costcenter.roi.withinBenchmark')})
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {/* Output tiles */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 rounded-xl border border-gray-700 text-center">
                  <p className="text-xs text-gray-500 mb-1">{t('costcenter.roi.monthlySavings')}</p>
                  <p className="text-lg font-bold text-green-400">{fmtCurrency(roi.monthlySavings, activeCurrency)}</p>
                </div>
                <div className="p-4 rounded-xl border border-gray-700 text-center">
                  <p className="text-xs text-gray-500 mb-1">{t('costcenter.roi.annualSavings')}</p>
                  <p className="text-lg font-bold text-green-400">{fmtCurrency(roi.annualSavings, activeCurrency)}</p>
                </div>
                <div className="p-4 rounded-xl border border-gray-700 text-center">
                  <p className="text-xs text-gray-500 mb-1">{t('costcenter.roi.paybackPeriod')}</p>
                  <p className="text-lg font-bold text-yellow-400">
                    {roi.paybackMonths != null && isFinite(roi.paybackMonths)
                      ? t('costcenter.roi.paybackMonths', { months: roi.paybackMonths.toFixed(1) })
                      : t('costcenter.states.na')}
                  </p>
                </div>

                {/* Insight */}
                <div className="col-span-3 p-3 rounded-lg bg-gray-800/60 border border-gray-700">
                  <p className="text-xs text-gray-400 leading-relaxed">
                    {t('costcenter.roi.insight', {
                      pct: roiSlider,
                      count: normalised.length,
                      savings: fmtCurrency(roi.annualSavings, activeCurrency),
                    })}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ── Empty state ──────────────────────────────────────────────────── */}
          {normalised.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <BarChart2 size={40} className="text-gray-700" />
              <p className="text-gray-500 font-medium">{t('costcenter.empty.title')}</p>
              <p className="text-gray-600 text-sm">{t('costcenter.empty.subtitle')}</p>
            </div>
          )}
        </>
      )}
    </motion.div>
  )
}

// ── Sub-components ───────────────────────────────────────────────────────────────
function KpiCard({ icon: Icon, label, value, sub, accent = 'green' }) {
  const accentMap = {
    green:  { icon: 'text-green-400',  border: 'border-green-900/50',  glow: 'rgba(22,163,74,0.06)'  },
    red:    { icon: 'text-red-400',    border: 'border-red-900/50',    glow: 'rgba(239,68,68,0.06)'  },
    blue:   { icon: 'text-blue-400',   border: 'border-blue-900/50',   glow: 'rgba(59,130,246,0.06)' },
    purple: { icon: 'text-purple-400', border: 'border-purple-900/50', glow: 'rgba(139,92,246,0.06)' },
    yellow: { icon: 'text-yellow-400', border: 'border-yellow-900/50', glow: 'rgba(234,179,8,0.06)'  },
  }
  const styles = accentMap[accent] ?? accentMap.green
  return (
    <motion.div
      className={`rounded-xl border p-4 ${styles.border}`}
      style={{ background: `linear-gradient(135deg, ${styles.glow} 0%, rgba(8,15,10,0.9) 100%)` }}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.15 }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon size={15} className={styles.icon} />
        <span className="text-xs text-gray-500 font-medium">{label}</span>
      </div>
      <p className="text-xl font-bold text-white leading-none">{value}</p>
      {sub && <p className="text-xs text-gray-600 mt-1.5">{sub}</p>}
    </motion.div>
  )
}

function RankBadge({ rank }) {
  if (rank === 1) return <span className="inline-flex items-center gap-1 text-yellow-400 text-xs font-bold"><Award size={13} /> #1</span>
  if (rank === 2) return <span className="inline-flex items-center gap-1 text-gray-300 text-xs font-bold">#2</span>
  if (rank === 3) return <span className="inline-flex items-center gap-1 text-orange-400 text-xs font-bold">#3</span>
  return <span className="text-gray-600 text-xs font-medium">#{rank}</span>
}
