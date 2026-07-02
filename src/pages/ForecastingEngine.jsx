import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  TrendingUp, TrendingDown, Minus, Calendar, Download,
  FileSpreadsheet, FileText, AlertTriangle, Package,
  DollarSign, BarChart2, Activity, Target, ChevronUp,
  ChevronDown, MapPin, Tag, Layers, Mail
} from 'lucide-react'
import EmailReportModal from '../components/EmailReportModal'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, Title, Tooltip, Legend, Filler
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import { supabase } from '../lib/supabase'
import { fetchAllPages } from '../lib/fetchAll'
import { useSettings } from '../contexts/SettingsContext'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import PageHeader from '../components/ui/PageHeader'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend, Filler
)

// ── Regression helpers ────────────────────────────────────────────────────────

function linearRegression(ys) {
  const n = ys.length
  if (n < 2) return { slope: 0, intercept: ys[0] || 0 }
  const xs = ys.map((_, i) => i)
  const sumX = xs.reduce((a, b) => a + b, 0)
  const sumY = ys.reduce((a, b) => a + b, 0)
  const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0)
  const sumX2 = xs.reduce((s, x) => s + x * x, 0)
  const denom = n * sumX2 - sumX * sumX
  if (!denom) return { slope: 0, intercept: sumY / n }
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

function forecast(ys, steps = 12) {
  const { slope, intercept } = linearRegression(ys)
  return Array.from(
    { length: steps },
    (_, i) => Math.max(0, intercept + slope * (ys.length + i))
  )
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
                 '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#a855f7']

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
    x: {
      grid: { color:'var(--text-muted)' },
      ticks: { color: '#6b7280', font: { size: 10 } },
    },
    y: {
      grid: { color:'var(--text-muted)' },
      ticks: { color: '#6b7280', font: { size: 10 } },
    },
  },
}

// Build last-12 month keys (YYYY-MM) ending today
function getLast12MonthKeys() {
  const keys = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

// Build next-N month labels (Mon YYYY) from now+1
function getNextMonthLabels(n) {
  const labels = []
  const now = new Date()
  for (let i = 1; i <= n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    labels.push(`${MONTH_LABELS[d.getMonth()]} ${d.getFullYear()}`)
  }
  return labels
}

function buildMonthKey(dateStr) {
  if (!dateStr) return null
  return dateStr.slice(0, 7)
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtNum(n, decimals = 0) {
  if (n == null || isNaN(n)) return '-'
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

function fmtCurrency(n, currency, compact = false) {
  if (n == null || isNaN(n)) return '-'
  if (compact && Math.abs(n) >= 1_000_000)
    return `${currency} ${(n / 1_000_000).toFixed(1)}M`
  if (compact && Math.abs(n) >= 1_000)
    return `${currency} ${(n / 1_000).toFixed(0)}K`
  return `${currency} ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function trendIcon(slope) {
  if (slope > 0.5) return <ChevronUp className="w-4 h-4 text-red-400 inline" />
  if (slope < -0.5) return <ChevronDown className="w-4 h-4 text-green-400 inline" />
  return <Minus className="w-4 h-4 text-gray-400 inline" />
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricCard({ icon: Icon, label, value, sub, color = 'blue', delay = 0 }) {
  const colors = {
    blue:   'from-blue-500/10 to-blue-600/5 border-blue-500/20 text-blue-400',
    green:  'from-green-500/10 to-green-600/5 border-green-500/20 text-green-400',
    amber:  'from-amber-500/10 to-amber-600/5 border-amber-500/20 text-amber-400',
    red:    'from-red-500/10 to-red-600/5 border-red-500/20 text-red-400',
    purple: 'from-purple-500/10 to-purple-600/5 border-purple-500/20 text-purple-400',
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.35 }}
      className={`bg-gradient-to-br ${colors[color]} border rounded-xl p-4 flex flex-col gap-2`}
    >
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${colors[color].split(' ').find(c => c.startsWith('text-'))}`} />
        <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </motion.div>
  )
}

function SectionCard({ title, icon: Icon, children, className = '' }) {
  return (
    <div className={`bg-gray-900 border border-gray-800 rounded-xl p-4 ${className}`}>
      <div className="flex items-center gap-2 mb-4">
        <Icon className="w-4 h-4 text-blue-400" />
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function TableHeader({ cols }) {
  return (
    <thead>
      <tr className="border-b border-gray-800">
        {cols.map(c => (
          <th key={c} className="text-left text-xs text-gray-500 font-medium uppercase tracking-wide py-2 px-3">
            {c}
          </th>
        ))}
      </tr>
    </thead>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ForecastingEngine() {
  const { activeCurrency, activeCountry } = useSettings()

  const [records, setRecords] = useState([])
  const [fleet, setFleet] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [horizon, setHorizon] = useState(12)
  const [siteFilter, setSiteFilter] = useState('all')
  const [emailModalOpen, setEmailModalOpen] = useState(false)

  // ── Data loading ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    async function load() {
      try {
        const cf = activeCountry !== 'All' ? activeCountry : null

        const [recRes, fleetRes] = await Promise.all([
          fetchAllPages((from, to) => {
            let q = supabase
              .from('tyre_records')
              .select('id,asset_no,site,brand,position,km_at_fitment,km_at_removal,cost_per_tyre,issue_date,risk_level,category')
              .order('issue_date', { ascending: true })
            if (cf) q = q.eq('country', cf)
            return q.range(from, to)
          }),
          (() => {
            let q = supabase
              .from('vehicle_fleet')
              .select('asset_no,site,vehicle_type,expected_km_per_tyre,monthly_tyre_budget,current_km')
            if (cf) q = q.eq('country', cf)
            return q
          })(),
        ])

        if (cancelled) return

        if (recRes.error) throw recRes.error
        setRecords(recRes.data || [])
        setFleet(fleetRes.data || [])
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [activeCountry])

  // ── Derived: last-12-month records ─────────────────────────────────────────
  const last12Keys = useMemo(() => getLast12MonthKeys(), [])
  const last24Keys = useMemo(() => {
    const keys = []
    const now = new Date()
    for (let i = 23; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    return keys
  }, [])

  const sites = useMemo(() => {
    const s = new Set(records.map(r => r.site).filter(Boolean))
    return ['all', ...Array.from(s).sort()]
  }, [records])

  const filteredRecords = useMemo(() => {
    if (siteFilter === 'all') return records
    return records.filter(r => r.site === siteFilter)
  }, [records, siteFilter])

  // Records with valid issue_date in last 12 months
  const hist12Records = useMemo(() => {
    const set = new Set(last12Keys)
    return filteredRecords.filter(r => r.issue_date && set.has(buildMonthKey(r.issue_date)))
  }, [filteredRecords, last12Keys])

  const hist24Records = useMemo(() => {
    const set = new Set(last24Keys)
    return filteredRecords.filter(r => r.issue_date && set.has(buildMonthKey(r.issue_date)))
  }, [filteredRecords, last24Keys])

  // ── Monthly aggregates ─────────────────────────────────────────────────────
  const monthlyDemand = useMemo(() => {
    const map = {}
    last12Keys.forEach(k => { map[k] = 0 })
    hist12Records.forEach(r => {
      const k = buildMonthKey(r.issue_date)
      if (k && map[k] !== undefined) map[k]++
    })
    return last12Keys.map(k => map[k])
  }, [hist12Records, last12Keys])

  const monthlySpend = useMemo(() => {
    const map = {}
    last12Keys.forEach(k => { map[k] = 0 })
    hist12Records.forEach(r => {
      const k = buildMonthKey(r.issue_date)
      const cost = parseFloat(r.cost_per_tyre) || 0
      if (k && map[k] !== undefined) map[k] += cost
    })
    return last12Keys.map(k => map[k])
  }, [hist12Records, last12Keys])

  // ── Forecast computations ──────────────────────────────────────────────────

  const demandForecast = useMemo(() => forecast(monthlyDemand, 12), [monthlyDemand])
  const budgetForecast = useMemo(() => forecast(monthlySpend, 12), [monthlySpend])

  const annualDemandForecast = useMemo(() => demandForecast.reduce((a, b) => a + b, 0), [demandForecast])
  const annualBudgetForecast = useMemo(() => budgetForecast.reduce((a, b) => a + b, 0), [budgetForecast])

  const monthlyAvgDemand = useMemo(() => annualDemandForecast / 12, [annualDemandForecast])
  const monthlyAvgBudget = useMemo(() => annualBudgetForecast / 12, [annualBudgetForecast])

  // Fleet monthly budget target
  const fleetMonthlyBudgetTarget = useMemo(() => {
    return fleet.reduce((s, v) => s + (parseFloat(v.monthly_tyre_budget) || 0), 0)
  }, [fleet])

  // Forecast accuracy: compare last 3 months actual vs fitted regression
  const forecastAccuracy = useMemo(() => {
    if (monthlyDemand.length < 6) return null
    const { slope, intercept } = linearRegression(monthlyDemand)
    const last3 = monthlyDemand.slice(-3)
    const predicted = last3.map((_, i) => Math.max(0, intercept + slope * (monthlyDemand.length - 3 + i)))
    const errors = last3.map((a, i) => Math.abs(a - predicted[i]) / Math.max(1, a))
    const mape = errors.reduce((s, e) => s + e, 0) / errors.length
    return Math.round((1 - Math.min(1, mape)) * 100)
  }, [monthlyDemand])

  // Brand demand forecast
  const brandForecast = useMemo(() => {
    const brands = {}
    hist12Records.forEach(r => {
      if (!r.brand) return
      if (!brands[r.brand]) brands[r.brand] = { count: 0, cost: 0, monthly: {} }
      brands[r.brand].count++
      brands[r.brand].cost += parseFloat(r.cost_per_tyre) || 0
      const k = buildMonthKey(r.issue_date)
      if (k) brands[r.brand].monthly[k] = (brands[r.brand].monthly[k] || 0) + 1
    })

    return Object.entries(brands).map(([brand, data]) => {
      const monthSeries = last12Keys.map(k => data.monthly[k] || 0)
      const fc12 = forecast(monthSeries, 12)
      const fc3 = fc12.slice(0, 3)
      const avg12 = fc12.reduce((a, b) => a + b, 0)
      const avg3 = fc3.reduce((a, b) => a + b, 0)
      const avgCost = data.count > 0 ? data.cost / data.count : 0
      const { slope } = linearRegression(monthSeries)
      return {
        brand,
        actual12: data.count,
        forecast3: Math.round(avg3),
        forecast12: Math.round(avg12),
        estCost12: avg12 * avgCost,
        avgCostPerTyre: avgCost,
        slope,
      }
    }).sort((a, b) => b.forecast12 - a.forecast12)
  }, [hist12Records, last12Keys])

  // Site demand forecast
  const siteForecast = useMemo(() => {
    const siteMap = {}
    hist12Records.forEach(r => {
      if (!r.site) return
      if (!siteMap[r.site]) siteMap[r.site] = { count: 0, cost: 0, monthly: {}, activeCount: 0 }
      siteMap[r.site].count++
      siteMap[r.site].cost += parseFloat(r.cost_per_tyre) || 0
      const k = buildMonthKey(r.issue_date)
      if (k) siteMap[r.site].monthly[k] = (siteMap[r.site].monthly[k] || 0) + 1
    })

    // Active tyres per site (km_at_removal IS NULL = currently fitted)
    filteredRecords.forEach(r => {
      if (!r.site || r.km_at_removal != null) return
      if (!siteMap[r.site]) siteMap[r.site] = { count: 0, cost: 0, monthly: {}, activeCount: 0 }
      siteMap[r.site].activeCount = (siteMap[r.site].activeCount || 0) + 1
    })

    return Object.entries(siteMap).map(([site, data]) => {
      const monthSeries = last12Keys.map(k => data.monthly[k] || 0)
      const fc12 = forecast(monthSeries, 12)
      const fc3 = fc12.slice(0, 3)
      const sum12 = fc12.reduce((a, b) => a + b, 0)
      const sum3 = fc3.reduce((a, b) => a + b, 0)
      const avgCost = data.count > 0 ? data.cost / data.count : 0
      const recommended3mo = Math.ceil(sum3 * 1.2)
      const { slope } = linearRegression(monthSeries)
      return {
        site,
        actual12: data.count,
        forecast3: Math.round(sum3),
        forecast12: Math.round(sum12),
        estCost12: sum12 * avgCost,
        recommendedStock: recommended3mo,
        currentStock: data.activeCount || 0,
        stockGap: recommended3mo - (data.activeCount || 0),
        slope,
      }
    }).sort((a, b) => b.forecast12 - a.forecast12)
  }, [hist12Records, filteredRecords, last12Keys])

  // Failure rate forecast
  const failureRateForecast = useMemo(() => {
    const monthlyRates = last12Keys.map(k => {
      const inMonth = hist12Records.filter(r => buildMonthKey(r.issue_date) === k)
      if (!inMonth.length) return 0
      const failed = inMonth.filter(r =>
        r.risk_level === 'High' || r.risk_level === 'Critical' ||
        r.category === 'Failure' || r.category === 'Damage'
      ).length
      return (failed / inMonth.length) * 100
    })
    const fc = forecast(monthlyRates, 12)
    return { historical: monthlyRates, forecast: fc }
  }, [hist12Records, last12Keys])

  const forecastedFailureAlert = useMemo(() => {
    return failureRateForecast.forecast.slice(0, horizon).some(r => r > 20)
  }, [failureRateForecast, horizon])

  // Vendor requirement
  const vendorRequirements = useMemo(() => {
    return brandForecast.map(b => ({
      brand: b.brand,
      qty3mo: b.forecast3,
      qty12mo: b.forecast12,
      estCost12: b.estCost12,
      priority: b.forecast12 > 50 ? 'High' : b.forecast12 > 20 ? 'Medium' : 'Low',
    }))
  }, [brandForecast])

  // Last-year actual (months 13-24 ago)
  const lastYearActual = useMemo(() => {
    const prevYearSet = new Set(last24Keys.slice(0, 12))
    return hist24Records
      .filter(r => r.issue_date && prevYearSet.has(buildMonthKey(r.issue_date)))
      .reduce((s, r) => s + (parseFloat(r.cost_per_tyre) || 0), 0)
  }, [hist24Records, last24Keys])

  const hasLastYear = useMemo(() => lastYearActual > 0, [lastYearActual])
  const budgetChange = useMemo(() => {
    if (!hasLastYear) return null
    return ((annualBudgetForecast - lastYearActual) / lastYearActual) * 100
  }, [annualBudgetForecast, lastYearActual, hasLastYear])

  const monthsOverBudget = useMemo(() => {
    if (!fleetMonthlyBudgetTarget) return '-'
    return budgetForecast.filter(m => m > fleetMonthlyBudgetTarget).length
  }, [budgetForecast, fleetMonthlyBudgetTarget])

  const recommendedAnnualBudget = useMemo(() => annualBudgetForecast * 1.1, [annualBudgetForecast])

  // ── Chart data ─────────────────────────────────────────────────────────────

  const horizonDemandFc = useMemo(() => demandForecast.slice(0, horizon), [demandForecast, horizon])
  const horizonBudgetFc = useMemo(() => budgetForecast.slice(0, horizon), [budgetForecast, horizon])
  const nextLabels = useMemo(() => getNextMonthLabels(horizon), [horizon])

  const histLabels = useMemo(() =>
    last12Keys.map(k => {
      const [, m] = k.split('-')
      return MONTH_LABELS[parseInt(m, 10) - 1]
    }), [last12Keys])

  const demandChartData = useMemo(() => {
    const confUpper = horizonDemandFc.map(v => v * 1.15)
    const confLower = horizonDemandFc.map(v => v * 0.85)
    return {
      labels: [...histLabels, ...nextLabels].slice(0, 12 + horizon),
      datasets: [
        {
          label: 'Historical Replacements',
          data: [...monthlyDemand, ...Array(horizon).fill(null)],
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 3,
        },
        {
          label: 'Forecast',
          data: [...Array(12).fill(null), ...horizonDemandFc],
          borderColor: '#10b981',
          borderDash: [5, 5],
          backgroundColor: 'rgba(16,185,129,0.05)',
          tension: 0.3,
          pointRadius: 2,
        },
        {
          label: 'Upper Band (+15%)',
          data: [...Array(12).fill(null), ...confUpper],
          borderColor: 'rgba(16,185,129,0.2)',
          borderDash: [2, 4],
          fill: '+1',
          backgroundColor: 'rgba(16,185,129,0.05)',
          pointRadius: 0,
          tension: 0.3,
        },
        {
          label: 'Lower Band (-15%)',
          data: [...Array(12).fill(null), ...confLower],
          borderColor: 'rgba(16,185,129,0.2)',
          borderDash: [2, 4],
          backgroundColor: 'rgba(16,185,129,0.05)',
          pointRadius: 0,
          tension: 0.3,
        },
        ...(fleetMonthlyBudgetTarget > 0
          ? [{
              label: 'Fleet Target (monthly tyres)',
              data: Array(12 + horizon).fill(null),
              borderColor: 'rgba(245,158,11,0.5)',
              borderDash: [8, 4],
              pointRadius: 0,
            }]
          : []),
      ],
    }
  }, [monthlyDemand, horizonDemandFc, histLabels, nextLabels, horizon, fleetMonthlyBudgetTarget])

  const budgetChartData = useMemo(() => ({
    labels: [...histLabels, ...nextLabels].slice(0, 12 + horizon),
    datasets: [
      {
        label: 'Historical Spend',
        data: [...monthlySpend, ...Array(horizon).fill(null)],
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.08)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
      },
      {
        label: 'Forecast Spend',
        data: [...Array(12).fill(null), ...horizonBudgetFc],
        borderColor: '#f59e0b',
        borderDash: [5, 5],
        backgroundColor: 'rgba(245,158,11,0.05)',
        tension: 0.3,
        pointRadius: 2,
      },
      ...(fleetMonthlyBudgetTarget > 0
        ? [{
            label: 'Monthly Budget Target',
            data: Array(12 + horizon).fill(fleetMonthlyBudgetTarget),
            borderColor: 'rgba(239,68,68,0.5)',
            borderDash: [8, 4],
            pointRadius: 0,
            fill: false,
          }]
        : []),
    ],
  }), [monthlySpend, horizonBudgetFc, histLabels, nextLabels, horizon, fleetMonthlyBudgetTarget])

  const failureChartData = useMemo(() => ({
    labels: [...histLabels, ...getNextMonthLabels(horizon)].slice(0, 12 + horizon),
    datasets: [
      {
        label: 'Historical Failure Rate %',
        data: [...failureRateForecast.historical, ...Array(horizon).fill(null)],
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239,68,68,0.08)',
        fill: true,
        tension: 0.3,
        pointRadius: 3,
      },
      {
        label: 'Forecast Failure Rate %',
        data: [...Array(12).fill(null), ...failureRateForecast.forecast.slice(0, horizon)],
        borderColor: '#f97316',
        borderDash: [5, 5],
        backgroundColor: 'rgba(249,115,22,0.05)',
        tension: 0.3,
        pointRadius: 2,
      },
      {
        label: '20% Alert Threshold',
        data: Array(12 + horizon).fill(20),
        borderColor: 'rgba(239,68,68,0.4)',
        borderDash: [8, 4],
        pointRadius: 0,
        fill: false,
      },
    ],
  }), [failureRateForecast, histLabels, horizon])

  const inventoryBarData = useMemo(() => {
    const filtered = siteForecast.slice(0, 12)
    return {
      labels: filtered.map(s => s.site),
      datasets: [
        {
          label: 'Recommended Stock (3mo)',
          data: filtered.map(s => s.recommendedStock),
          backgroundColor: 'rgba(59,130,246,0.7)',
          borderRadius: 4,
        },
        {
          label: 'Current Stock (proxy)',
          data: filtered.map(s => s.currentStock),
          backgroundColor: 'rgba(16,185,129,0.7)',
          borderRadius: 4,
        },
      ],
    }
  }, [siteForecast])

  // ── Exports ────────────────────────────────────────────────────────────────

  function handleExportExcel() {
    const demandRows = nextLabels.map((lbl, i) => ({
      month: lbl,
      demand_forecast: Math.round(demandForecast[i]),
      budget_forecast: Math.round(budgetForecast[i]),
      failure_rate_forecast: failureRateForecast.forecast[i]?.toFixed(1) + '%',
    }))
    exportToExcel(
      demandRows,
      ['month', 'demand_forecast', 'budget_forecast', 'failure_rate_forecast'],
      ['Month', 'Demand Forecast', 'Budget Forecast', 'Failure Rate Forecast'],
      'TyrePulse_Forecasting_Engine',
      'Forecast'
    )
  }

  function handleExportPdf() {
    const rows = brandForecast.map(b => [
      b.brand,
      fmtNum(b.actual12),
      fmtNum(b.forecast3),
      fmtNum(b.forecast12),
      fmtCurrency(b.estCost12, activeCurrency, true),
    ])
    exportToPdf(
      rows,
      ['Brand', 'Last 12mo Actual', 'Next 3mo Forecast', 'Next 12mo Forecast', 'Est. Cost 12mo'],
      'TyrePulse - Forecasting Engine Report',
      'Brand Demand Forecast'
    )
  }

  // ── Render guards ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-sm">Loading forecasting data…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-gray-900 border border-red-800 rounded-xl p-8 text-center max-w-md">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto mb-3" />
          <p className="text-red-400 font-medium mb-1">Failed to load data</p>
          <p className="text-gray-500 text-sm">{error}</p>
        </div>
      </div>
    )
  }

  if (!records.length) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center max-w-md">
          <BarChart2 className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <p className="text-white font-semibold mb-1">No Tyre Records Found</p>
          <p className="text-gray-500 text-sm">
            Add tyre records to generate forecasts, demand projections, and budget planning.
          </p>
        </div>
      </div>
    )
  }

  const avgCostPerTyre = hist12Records.length
    ? hist12Records.reduce((s, r) => s + (parseFloat(r.cost_per_tyre) || 0), 0) / hist12Records.length
    : 0

  // ── Full render ────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 p-4 md:p-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <PageHeader
        title="Forecasting Engine"
        subtitle="12-month demand, budget, and inventory forecasts to support proactive planning"
        icon={TrendingUp}
        actions={<>
          <select
            value={siteFilter}
            onChange={e => setSiteFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-sm text-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-blue-500"
          >
            {sites.map(s => (
              <option key={s} value={s}>{s === 'all' ? 'All Sites' : s}</option>
            ))}
          </select>
          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-1.5 transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Excel
          </button>
          <button
            onClick={handleExportPdf}
            className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-1.5 transition-colors"
          >
            <FileText className="w-4 h-4" />
            PDF
          </button>
          <button
            onClick={() => setEmailModalOpen(true)}
            className="flex items-center gap-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-300 text-sm rounded-lg px-3 py-1.5 transition-colors"
          >
            <Mail className="w-4 h-4" />
            Email Report
          </button>
        </>}
      />

      {/* ── Horizon selector ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-1 bg-gray-900 border border-gray-800 rounded-xl p-1 w-fit">
        {[
          { val: 3, label: 'Next 3 Months' },
          { val: 6, label: 'Next 6 Months' },
          { val: 12, label: 'Next 12 Months' },
        ].map(h => (
          <button
            key={h.val}
            onClick={() => setHorizon(h.val)}
            className={`px-4 py-1.5 text-sm rounded-lg transition-colors font-medium ${
              horizon === h.val
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {h.label}
          </button>
        ))}
      </div>

      {/* ── Forecast accuracy alert ───────────────────────────────────────── */}
      {forecastedFailureAlert && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-start gap-3 bg-red-950/30 border border-red-800/50 rounded-xl p-4"
        >
          <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-300">Failure Rate Alert</p>
            <p className="text-xs text-red-400 mt-0.5">
              Forecasted failure rate exceeds 20% within the selected horizon. Review maintenance protocols and inspection compliance immediately.
            </p>
          </div>
        </motion.div>
      )}

      {/* ── Section 3 - Headline KPIs ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <MetricCard
          icon={Package}
          label="12-Mo Demand Forecast"
          value={fmtNum(annualDemandForecast)}
          sub="Projected replacements"
          color="blue"
          delay={0}
        />
        <MetricCard
          icon={DollarSign}
          label="12-Mo Budget Forecast"
          value={fmtCurrency(annualBudgetForecast, activeCurrency, true)}
          sub="Projected total spend"
          color="green"
          delay={0.05}
        />
        <MetricCard
          icon={Activity}
          label="Monthly Avg Demand"
          value={fmtNum(monthlyAvgDemand, 1)}
          sub="Avg replacements/month"
          color="amber"
          delay={0.1}
        />
        <MetricCard
          icon={Target}
          label="Monthly Avg Budget"
          value={fmtCurrency(monthlyAvgBudget, activeCurrency, true)}
          sub="Avg monthly spend"
          color="purple"
          delay={0.15}
        />
        <MetricCard
          icon={BarChart2}
          label="Model Confidence"
          value={forecastAccuracy != null ? `${forecastAccuracy}%` : '-'}
          sub="Based on 3-month MAPE"
          color={forecastAccuracy == null ? 'blue' : forecastAccuracy >= 75 ? 'green' : forecastAccuracy >= 50 ? 'amber' : 'red'}
          delay={0.2}
        />
      </div>

      {/* ── Section 4 - Demand Forecast Chart ───────────────────────────── */}
      <SectionCard title="Demand Forecast - Monthly Replacement Projections" icon={TrendingUp}>
        <div className="h-72">
          <Line
            data={demandChartData}
            options={{
              ...BASE_OPTS,
              plugins: {
                ...BASE_OPTS.plugins,
                legend: { ...BASE_OPTS.plugins.legend, position: 'top' },
                tooltip: {
                  ...BASE_OPTS.plugins.tooltip,
                  callbacks: {
                    label: ctx => `${ctx.dataset.label}: ${fmtNum(ctx.parsed.y)} tyres`,
                  },
                },
              },
              scales: {
                ...BASE_OPTS.scales,
                y: {
                  ...BASE_OPTS.scales.y,
                  title: { display: true, text: 'Tyres', color: '#6b7280', font: { size: 10 } },
                },
              },
            }}
          />
        </div>
        <div className="flex flex-wrap gap-4 mt-3 text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <span className="w-8 h-0.5 bg-blue-500 inline-block" />
            Historical (solid)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-8 h-0.5 bg-green-500 border-dashed border-t-2 border-green-500 inline-block" />
            Forecast (dashed)
          </span>
          <span className="flex items-center gap-1">
            <span className="w-8 h-2 bg-green-500/10 border border-green-500/20 inline-block rounded" />
            ±15% Confidence Band
          </span>
        </div>
      </SectionCard>

      {/* ── Section 5 - Budget Forecast Chart ───────────────────────────── */}
      <SectionCard title="Budget Forecast - Monthly Spend Projections" icon={DollarSign}>
        <div className="h-72">
          <Line
            data={budgetChartData}
            options={{
              ...BASE_OPTS,
              plugins: {
                ...BASE_OPTS.plugins,
                legend: { ...BASE_OPTS.plugins.legend, position: 'top' },
                tooltip: {
                  ...BASE_OPTS.plugins.tooltip,
                  callbacks: {
                    label: ctx => `${ctx.dataset.label}: ${fmtCurrency(ctx.parsed.y, activeCurrency, true)}`,
                  },
                },
              },
              scales: {
                ...BASE_OPTS.scales,
                y: {
                  ...BASE_OPTS.scales.y,
                  ticks: {
                    ...BASE_OPTS.scales.y.ticks,
                    callback: v => fmtCurrency(v, activeCurrency, true),
                  },
                },
              },
            }}
          />
        </div>
        {fleetMonthlyBudgetTarget > 0 && (
          <p className="text-xs text-gray-500 mt-2">
            Fleet monthly budget target: {fmtCurrency(fleetMonthlyBudgetTarget, activeCurrency)} (from vehicle master)
          </p>
        )}
      </SectionCard>

      {/* ── Two-column row - Brand + Site tables ─────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">

        {/* Section 6 - Brand Demand Forecast */}
        <SectionCard title="Brand Demand Forecast" icon={Tag}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableHeader cols={['Brand', 'Last 12mo', '3mo Fc', '12mo Fc', 'Est. Cost 12mo', 'Trend']} />
              <tbody>
                {brandForecast.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-gray-600 py-6 text-sm">No brand data available</td>
                  </tr>
                ) : brandForecast.map(b => (
                  <tr key={b.brand} className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                    <td className="py-2 px-3 font-medium text-white">{b.brand}</td>
                    <td className="py-2 px-3 text-gray-300">{fmtNum(b.actual12)}</td>
                    <td className="py-2 px-3 text-blue-300">{fmtNum(b.forecast3)}</td>
                    <td className="py-2 px-3 text-green-300">{fmtNum(b.forecast12)}</td>
                    <td className="py-2 px-3 text-amber-300">{fmtCurrency(b.estCost12, activeCurrency, true)}</td>
                    <td className="py-2 px-3">{trendIcon(b.slope)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>

        {/* Section 7 - Site Demand Forecast */}
        <SectionCard title="Site Demand Forecast" icon={MapPin}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableHeader cols={['Site', 'Last 12mo', '3mo Fc', '12mo Fc', 'Est. Cost', 'Rec. Stock']} />
              <tbody>
                {siteForecast.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-gray-600 py-6 text-sm">No site data available</td>
                  </tr>
                ) : siteForecast.map(s => (
                  <tr key={s.site} className="border-b border-gray-800/50 hover:bg-gray-800/20 transition-colors">
                    <td className="py-2 px-3 font-medium text-white">{s.site}</td>
                    <td className="py-2 px-3 text-gray-300">{fmtNum(s.actual12)}</td>
                    <td className="py-2 px-3 text-blue-300">{fmtNum(s.forecast3)}</td>
                    <td className="py-2 px-3 text-green-300">{fmtNum(s.forecast12)}</td>
                    <td className="py-2 px-3 text-amber-300">{fmtCurrency(s.estCost12, activeCurrency, true)}</td>
                    <td className="py-2 px-3 text-purple-300 font-medium">{fmtNum(s.recommendedStock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      {/* ── Section 8 - Inventory Requirement ────────────────────────────── */}
      <SectionCard title="Inventory Requirement Forecast (3-Month Safety Stock × 1.2)" icon={Layers}>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableHeader cols={['Site', 'Rec. Stock', 'Current', 'Gap', 'Status']} />
              <tbody>
                {siteForecast.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center text-gray-600 py-6 text-sm">No data</td>
                  </tr>
                ) : siteForecast.map(s => {
                  const gap = s.stockGap
                  const statusColor = gap > 20
                    ? 'text-red-400 bg-red-950/40 border-red-900/40'
                    : gap > 5
                    ? 'text-amber-400 bg-amber-950/40 border-amber-900/40'
                    : 'text-green-400 bg-green-950/40 border-green-900/40'
                  const statusLabel = gap > 20
                    ? 'Understocked'
                    : gap > 5
                    ? 'Monitor'
                    : gap < -5
                    ? 'Overstocked'
                    : 'Adequate'
                  return (
                    <tr key={s.site} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                      <td className="py-2 px-3 font-medium text-white">{s.site}</td>
                      <td className="py-2 px-3 text-blue-300">{fmtNum(s.recommendedStock)}</td>
                      <td className="py-2 px-3 text-gray-300">{fmtNum(s.currentStock)}</td>
                      <td className={`py-2 px-3 font-medium ${gap > 0 ? 'text-red-300' : 'text-green-300'}`}>
                        {gap > 0 ? `+${fmtNum(gap)}` : fmtNum(gap)}
                      </td>
                      <td className="py-2 px-3">
                        <span className={`text-xs px-2 py-0.5 rounded border ${statusColor}`}>
                          {statusLabel}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {/* Chart */}
          <div className="h-64">
            {siteForecast.length > 0 ? (
              <Bar
                data={inventoryBarData}
                options={{
                  ...BASE_OPTS,
                  indexAxis: 'y',
                  plugins: {
                    ...BASE_OPTS.plugins,
                    legend: { ...BASE_OPTS.plugins.legend, position: 'top' },
                  },
                }}
              />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-600 text-sm">No inventory data</div>
            )}
          </div>
        </div>
      </SectionCard>

      {/* ── Section 9 - Failure Rate Forecast ────────────────────────────── */}
      <SectionCard title="Failure Rate Forecast" icon={AlertTriangle}>
        <div className="h-64">
          <Line
            data={failureChartData}
            options={{
              ...BASE_OPTS,
              plugins: {
                ...BASE_OPTS.plugins,
                legend: { ...BASE_OPTS.plugins.legend, position: 'top' },
                tooltip: {
                  ...BASE_OPTS.plugins.tooltip,
                  callbacks: {
                    label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)}%`,
                  },
                },
              },
              scales: {
                ...BASE_OPTS.scales,
                y: {
                  ...BASE_OPTS.scales.y,
                  min: 0,
                  ticks: {
                    ...BASE_OPTS.scales.y.ticks,
                    callback: v => `${v}%`,
                  },
                },
              },
            }}
          />
        </div>
        {forecastedFailureAlert && (
          <div className="mt-3 text-xs text-red-400 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" />
            Forecasted failure rate exceeds the 20% critical threshold within the selected period.
          </div>
        )}
      </SectionCard>

      {/* ── Section 10 - Vendor Requirement ──────────────────────────────── */}
      <SectionCard title="Vendor (Brand) Requirement Summary" icon={Package}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <TableHeader cols={['Brand', 'Qty Needed (3mo)', 'Qty Needed (12mo)', 'Est. Cost (12mo)', 'Priority']} />
            <tbody>
              {vendorRequirements.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center text-gray-600 py-6 text-sm">No vendor data available</td>
                </tr>
              ) : vendorRequirements.map(v => {
                const priorityColor = v.priority === 'High'
                  ? 'text-red-400 bg-red-950/40 border-red-900/40'
                  : v.priority === 'Medium'
                  ? 'text-amber-400 bg-amber-950/40 border-amber-900/40'
                  : 'text-green-400 bg-green-950/40 border-green-900/40'
                return (
                  <tr key={v.brand} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                    <td className="py-2 px-3 font-medium text-white">{v.brand}</td>
                    <td className="py-2 px-3 text-blue-300">{fmtNum(v.qty3mo)}</td>
                    <td className="py-2 px-3 text-green-300">{fmtNum(v.qty12mo)}</td>
                    <td className="py-2 px-3 text-amber-300">{fmtCurrency(v.estCost12, activeCurrency, true)}</td>
                    <td className="py-2 px-3">
                      <span className={`text-xs px-2 py-0.5 rounded border ${priorityColor}`}>
                        {v.priority}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* ── Section 11 - Annual Budget Planning Summary ───────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="bg-gradient-to-br from-blue-950/30 to-gray-900 border border-blue-800/40 rounded-xl p-6"
      >
        <div className="flex items-center gap-2 mb-6">
          <Calendar className="w-5 h-5 text-blue-400" />
          <h3 className="text-base font-bold text-white">Annual Budget Planning Summary</h3>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">

          <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4 col-span-2">
            <p className="text-xs text-gray-400 mb-1">Total Annual Forecast Spend</p>
            <p className="text-2xl font-bold text-white">{fmtCurrency(annualBudgetForecast, activeCurrency, true)}</p>
            <p className="text-xs text-gray-500 mt-1">{fmtNum(annualDemandForecast)} projected replacements</p>
          </div>

          {hasLastYear && (
            <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
              <p className="text-xs text-gray-400 mb-1">vs Last Year Actual</p>
              <p className="text-xl font-bold text-white">{fmtCurrency(lastYearActual, activeCurrency, true)}</p>
              <div className={`flex items-center gap-1 mt-1 text-xs font-medium ${budgetChange > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {budgetChange > 0
                  ? <TrendingUp className="w-3.5 h-3.5" />
                  : <TrendingDown className="w-3.5 h-3.5" />}
                {budgetChange != null ? `${Math.abs(budgetChange).toFixed(1)}% YoY` : '-'}
              </div>
            </div>
          )}

          <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-1">Monthly Budget Target</p>
            <p className="text-xl font-bold text-white">
              {fleetMonthlyBudgetTarget > 0
                ? fmtCurrency(fleetMonthlyBudgetTarget, activeCurrency, true)
                : '-'}
            </p>
            <p className="text-xs text-gray-500 mt-1">From fleet master</p>
          </div>

          <div className="bg-gray-900/60 border border-gray-800 rounded-xl p-4">
            <p className="text-xs text-gray-400 mb-1">Months Over Budget</p>
            <p className="text-xl font-bold text-white">{monthsOverBudget}</p>
            <p className="text-xs text-gray-500 mt-1">
              {fleetMonthlyBudgetTarget ? `of ${horizon} forecast months` : 'No target set'}
            </p>
          </div>

          <div className="bg-blue-900/30 border border-blue-700/40 rounded-xl p-4">
            <p className="text-xs text-blue-300 mb-1">Recommended Annual Budget</p>
            <p className="text-xl font-bold text-blue-200">{fmtCurrency(recommendedAnnualBudget, activeCurrency, true)}</p>
            <p className="text-xs text-blue-400 mt-1">Forecast + 10% buffer</p>
          </div>
        </div>

        {/* Sub-stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          <div className="bg-gray-900/40 border border-gray-800/50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Avg Cost Per Tyre</p>
            <p className="text-base font-semibold text-white mt-1">{fmtCurrency(avgCostPerTyre, activeCurrency)}</p>
          </div>
          <div className="bg-gray-900/40 border border-gray-800/50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Total Records Analysed</p>
            <p className="text-base font-semibold text-white mt-1">{fmtNum(records.length)}</p>
          </div>
          <div className="bg-gray-900/40 border border-gray-800/50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Active Brands</p>
            <p className="text-base font-semibold text-white mt-1">{fmtNum(brandForecast.length)}</p>
          </div>
          <div className="bg-gray-900/40 border border-gray-800/50 rounded-lg p-3">
            <p className="text-xs text-gray-500">Active Sites</p>
            <p className="text-base font-semibold text-white mt-1">{fmtNum(siteForecast.length)}</p>
          </div>
        </div>
      </motion.div>

      <EmailReportModal
        isOpen={emailModalOpen}
        onClose={() => setEmailModalOpen(false)}
        reportTitle="Forecasting Engine Report"
        pdfColumns={['Brand', 'Last 12mo Actual', 'Next 3mo Forecast', 'Next 12mo Forecast', 'Est. Cost 12mo']}
        pdfRows={brandForecast.map(b => [
          b.brand,
          fmtNum(b.actual12),
          fmtNum(b.forecast3),
          fmtNum(b.forecast12),
          fmtCurrency(b.estCost12, activeCurrency, true),
        ])}
        kpiSummary={{
          '12-Mo Demand Forecast': fmtNum(annualDemandForecast),
          '12-Mo Budget Forecast': fmtCurrency(annualBudgetForecast, activeCurrency, true),
          'Monthly Avg Demand': fmtNum(monthlyAvgDemand, 1),
          'Monthly Avg Budget': fmtCurrency(monthlyAvgBudget, activeCurrency, true),
          'Model Confidence': forecastAccuracy != null ? `${forecastAccuracy}%` : '-',
          'Recommended Annual Budget': fmtCurrency(recommendedAnnualBudget, activeCurrency, true),
        }}
        period={`Horizon: Next ${horizon} Months`}
      />
    </div>
  )
}
