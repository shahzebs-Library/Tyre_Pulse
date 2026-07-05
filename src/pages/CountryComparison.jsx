import { useState, useEffect, useMemo, useCallback } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import * as analytics from '../lib/api/analyticsReads'
import { useSettings, COUNTRIES, COUNTRY_LABEL, COUNTRY_CURRENCY } from '../contexts/SettingsContext'
import { Globe, TrendingUp, AlertTriangle, DollarSign, Truck, Activity, Download, FileText, Award, RefreshCw } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { SkeletonCards, SkeletonChart } from '../components/ui/Skeleton'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { formatCurrencyCompact } from '../lib/formatters'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend)

const COLOR_PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#f97316']

const BAR_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { backgroundColor: 'var(--panel-2)', titlecolor:'var(--panel-ink)', bodyColor: '#9ca3af' } },
  scales: {
    x: { grid: { color: '#1a2030' }, ticks: { color: '#6b7280', font: { size: 11 } } },
    y: { grid: { color: '#1a2030' }, ticks: { color: '#6b7280', font: { size: 11 } } },
  },
}

function pct(n, na = 'N/A') { return n == null ? na : `${n.toFixed(1)}%` }
function cpk(n, na = 'N/A') { return n == null ? na : n.toFixed(3) }

// Re-uses shared formatCurrencyCompact for currency values
function fmtCost(n, currency, na = 'N/A') {
  if (n == null) return na
  return formatCurrencyCompact(n, currency)
}

// lowerIsBetter: true = green for minimum value, red for maximum
const KPI_ROWS = [
  { key: 'count',          label: 'Fleet Records',   fmt: (v)        => v.toLocaleString(),                                icon: Truck,         lowerIsBetter: false },
  { key: 'totalCost',      label: 'Total Cost',      fmt: (v, c, na) => fmtCost(v, COUNTRY_CURRENCY[c] || 'SAR', na), icon: DollarSign,    lowerIsBetter: true  },
  { key: 'avgCostPerTyre', label: 'Avg Cost / Tyre', fmt: (v, c, na) => fmtCost(v, COUNTRY_CURRENCY[c] || 'SAR', na), icon: DollarSign,    lowerIsBetter: true  },
  { key: 'avgCpk',         label: 'Avg CPK',         fmt: (v, c, na) => cpk(v, na),                                        icon: Activity,      lowerIsBetter: true  },
  { key: 'highRiskPct',    label: 'High Risk %',     fmt: (v, c, na) => pct(v, na),                                        icon: AlertTriangle, lowerIsBetter: true  },
  { key: 'openActions',    label: 'Open Actions',    fmt: (v)        => v.toLocaleString(),                                icon: TrendingUp,    lowerIsBetter: true  },
  { key: 'overdueActions', label: 'Overdue Actions', fmt: (v)        => v.toLocaleString(),                                icon: AlertTriangle, lowerIsBetter: true  },
  { key: 'siteCount',      label: 'Sites',           fmt: (v)        => v.toLocaleString(),                                icon: Globe,         lowerIsBetter: false },
  { key: 'brandCount',     label: 'Brands Used',     fmt: (v)        => v.toLocaleString(),                                icon: Globe,         lowerIsBetter: false },
]

function riskColor(pct) {
  if (pct == null) return 'text-gray-500'
  if (pct >= 30) return 'text-red-400'
  if (pct >= 15) return 'text-yellow-400'
  return 'text-green-400'
}

function overdueColor(n) {
  if (n == null) return 'text-gray-500'
  if (n >= 5) return 'text-red-400'
  if (n >= 1) return 'text-yellow-400'
  return 'text-green-400'
}

export default function CountryComparison() {
  const { t } = useLanguage()
  const { appSettings } = useSettings()
  const [countryMetrics, setCountryMetrics] = useState([])
  const [actions, setActions]   = useState([])
  const [trends, setTrends]     = useState([])   // [{country, month, cnt, cost}]
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [trendMetric, setTrendMetric] = useState('cnt') // 'cnt' | 'cost'
  const [selectedCountries, setSelectedCountries] = useState(new Set(COUNTRIES))

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      // Server-side per-country aggregates (accurate over the full dataset, fast).
      const [mRes, aRes, tRes] = await Promise.all([
        analytics.reportCountryMetrics({ from: dateFrom, to: dateTo }),
        analytics.listCorrectiveActionsBrief(),
        analytics.reportCountryTrends({ from: dateFrom, to: dateTo }),
      ])
      for (const r of [mRes, aRes, tRes]) if (r?.error) throw new Error(r.error.message || r.error)
      setCountryMetrics(mRes.data ?? [])
      setActions(aRes.data ?? [])
      setTrends(tRes.data ?? [])
    } catch (e) {
      setError(e.message || 'Failed to load country comparison data.')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  // Dynamic color map based on available countries
  const countryColorMap = useMemo(() => {
    const map = {}
    COUNTRIES.forEach((c, i) => { map[c] = COLOR_PALETTE[i % COLOR_PALETTE.length] })
    return map
  }, [])

  // Always represent every configured country so the comparison shows all of
  // them side-by-side (zero-filled when a country has no data yet) instead of
  // collapsing to whichever single country happens to have records.
  const allMetrics = useMemo(() => {
    const now = new Date()
    const byCountry = Object.fromEntries(countryMetrics.map(m => [m.country, m]))
    const zero = (country) => ({
      country, count: 0, totalCost: 0, avgCostPerTyre: 0, avgCpk: null,
      highRiskPct: null, siteCount: 0, brandCount: 0,
    })
    return COUNTRIES.map(country => {
      const m = byCountry[country] || zero(country)
      const openActions = actions.filter(a => (a.country || 'KSA') === country && a.status !== 'Closed').length
      const overdueActions = actions.filter(a =>
        (a.country || 'KSA') === country && a.status !== 'Closed' &&
        a.due_date && new Date(a.due_date) < now
      ).length
      return { ...m, country, openActions, overdueActions }
    })
  }, [countryMetrics, actions])

  const hasAnyData = useMemo(
    () => allMetrics.some(m => (m.count || 0) > 0) || countryMetrics.length > 0,
    [allMetrics, countryMetrics]
  )

  const metrics = useMemo(
    () => allMetrics.filter(m => selectedCountries.has(m.country)),
    [allMetrics, selectedCountries]
  )

  // Available countries that actually have data
  const availableCountries = useMemo(() => allMetrics.map(m => m.country), [allMetrics])

  function toggleCountry(c) {
    setSelectedCountries(prev => {
      const next = new Set(prev)
      if (next.has(c)) { next.delete(c) } else { next.add(c) }
      return next
    })
  }

  const countries = metrics.map(m => m.country)

  const costChartData = {
    labels: countries,
    datasets: [{
      data: metrics.map(m => m.totalCost),
      backgroundColor: countries.map(c => countryColorMap[c] ?? '#6b7280'),
      borderRadius: 4,
    }],
  }

  const riskChartData = {
    labels: countries,
    datasets: [{
      data: metrics.map(m => m.highRiskPct),
      backgroundColor: countries.map(() => '#ef4444'),
      borderRadius: 4,
    }],
  }

  const cpkChartData = {
    labels: countries,
    datasets: [{
      data: metrics.map(m => m.avgCpk ?? 0),
      backgroundColor: countries.map(c => countryColorMap[c] ?? '#6b7280'),
      borderRadius: 4,
    }],
  }

  const openActionsChartData = {
    labels: countries,
    datasets: [{
      data: metrics.map(m => m.openActions ?? 0),
      backgroundColor: countries.map(() => '#f59e0b'),
      borderRadius: 4,
    }],
  }

  // ── Trend comparison (monthly & yearly, multi-country) ──────────────────────
  const selList = useMemo(() => COUNTRIES.filter(c => selectedCountries.has(c)), [selectedCountries])

  const monthlyTrendData = useMemo(() => {
    const months = [...new Set(trends.map(t => t.month))].sort()
    const byCM = {}
    trends.forEach(t => { (byCM[t.country] ??= {})[t.month] = Number(t[trendMetric]) || 0 })
    const fmt = m => { const d = new Date(m); return d.toLocaleString('en', { month: 'short', year: '2-digit' }) }
    return {
      labels: months.map(fmt),
      datasets: selList.map(c => ({
        label: c,
        data: months.map(m => byCM[c]?.[m] ?? 0),
        borderColor: countryColorMap[c] ?? '#6b7280',
        backgroundColor: (countryColorMap[c] ?? '#6b7280') + '33',
        tension: 0.3, pointRadius: 2, borderWidth: 2, fill: false,
      })),
    }
  }, [trends, selList, trendMetric, countryColorMap])

  const yearlyTrendData = useMemo(() => {
    const years = new Set(); const byCY = {}
    trends.forEach(t => {
      const y = new Date(t.month).getFullYear(); years.add(y)
      byCY[t.country] = byCY[t.country] || {}
      byCY[t.country][y] = (byCY[t.country][y] || 0) + (Number(t[trendMetric]) || 0)
    })
    const yrs = [...years].sort()
    return {
      labels: yrs.map(String),
      datasets: selList.map(c => ({
        label: c,
        data: yrs.map(y => byCY[c]?.[y] ?? 0),
        backgroundColor: countryColorMap[c] ?? '#6b7280',
        borderRadius: 4,
      })),
    }
  }, [trends, selList, trendMetric, countryColorMap])

  const hasTrend = trends.length > 0
  const TREND_OPTS = {
    responsive: true, maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: true, labels: { color: '#9ca3af', font: { size: 11 }, boxWidth: 12 } } },
    scales: {
      x: { grid: { color: '#1a2030' }, ticks: { color: '#6b7280', font: { size: 10 }, maxRotation: 0, autoSkip: true } },
      y: { grid: { color: '#1a2030' }, ticks: { color: '#6b7280', font: { size: 10 } }, beginAtZero: true },
    },
  }

  if (loading) return (
    <div className="space-y-5">
      <PageHeader title={t('countrycomparison.title')} subtitle={t('countrycomparison.states.loading')} icon={Globe} />
      <SkeletonCards count={3} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SkeletonChart />
        <SkeletonChart />
      </div>
    </div>
  )

  if (error && !hasAnyData) return (
    <div className="space-y-5">
      <PageHeader title={t('countrycomparison.title')} subtitle={t('countrycomparison.states.loadError')} icon={Globe} />
      <div className="card py-16 flex flex-col items-center gap-3">
        <AlertTriangle size={40} className="text-red-400" />
        <p className="text-red-300 font-medium">{t('countrycomparison.states.loadErrorTitle')}</p>
        <p className="text-gray-500 text-sm">{error}</p>
        <button onClick={load} className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">
          <RefreshCw size={16} /> {t('countrycomparison.states.retry')}
        </button>
      </div>
    </div>
  )

  if (!hasAnyData) return (
    <div className="space-y-5">
      <PageHeader title={t('countrycomparison.title')} subtitle={t('countrycomparison.states.noDataSubtitle')} icon={Globe} />
      <div className="card py-16 flex flex-col items-center gap-3">
        <Globe size={40} className="text-gray-700" />
        <p className="text-gray-400 font-medium">{t('countrycomparison.states.noDataTitle')}</p>
        <p className="text-gray-600 text-sm">{t('countrycomparison.states.noDataHint')}</p>
      </div>
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <PageHeader
            title={t('countrycomparison.title')}
            subtitle={t('countrycomparison.header.subtitle', { countries: availableCountries.join(', ') })}
            icon={Globe}
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => exportToExcel(
              metrics,
              ['country','count','totalCost','avgCostPerTyre','highRiskPct','avgCpk','openActions','overdueActions','siteCount','brandCount'],
              ['Country','Fleet Records','Total Cost','Avg Cost/Tyre','High Risk %','Avg CPK','Open Actions','Overdue Actions','Sites','Brands'],
              'TyrePulse_CountryComparison'
            )}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            <Download size={14}/> {t('countrycomparison.actions.excel')}
          </button>
          <button
            onClick={() => exportToPdf(
              metrics,
              [
                {key:'country',header:'Country'},
                {key:'count',header:'Fleet Records'},
                {key:'totalCost',header:'Total Cost'},
                {key:'avgCostPerTyre',header:'Avg Cost/Tyre'},
                {key:'highRiskPct',header:'High Risk %'},
                {key:'avgCpk',header:'Avg CPK'},
                {key:'openActions',header:'Open Actions'},
                {key:'overdueActions',header:'Overdue'},
                {key:'siteCount',header:'Sites'},
              ],
              'Country Comparison',
              'TyrePulse_CountryComparison',
              'landscape'
            )}
            className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5"
          >
            <FileText size={14}/> {t('countrycomparison.actions.pdf')}
          </button>
        </div>
      </div>

      {/* Filters: country checkboxes + date pickers */}
      <div className="card py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-gray-500">{t('countrycomparison.filters.countries')}</span>
          {availableCountries.map(c => {
            const color = countryColorMap[c] ?? '#6b7280'
            const checked = selectedCountries.has(c)
            return (
              <label key={c} className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleCountry(c)}
                  className="rounded"
                  style={{ accentColor: color }}
                />
                <span className="text-sm font-medium" style={{ color: checked ? color : '#6b7280' }}>
                  {COUNTRY_LABEL[c] ?? c}
                </span>
              </label>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-gray-500">{t('countrycomparison.filters.dateRange')}</span>
          <input
            type="date"
            className="input w-40"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
          />
          <span className="text-gray-500 text-xs">{t('countrycomparison.filters.to')}</span>
          <input
            type="date"
            className="input w-40"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
          />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo('') }} className="text-xs text-gray-400 hover:text-white">
              {t('countrycomparison.filters.clear')}
            </button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {metrics.map(m => {
          const currency = COUNTRY_CURRENCY[m.country] || 'SAR'
          const color    = countryColorMap[m.country] ?? '#6b7280'
          const naLabel  = t('countrycomparison.states.na')
          return (
            <div key={m.country} className="card" style={{ borderTop: `2px solid ${color}` }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-white text-base">{m.country}</h3>
                <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: `${color}20`, color }}>
                  {currency}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                <div>
                  <p className="text-[11px] text-gray-600 uppercase tracking-wider mb-0.5">{t('countrycomparison.summary.fleet')}</p>
                  <p className="text-lg font-bold text-white">{m.count.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[11px] text-gray-600 uppercase tracking-wider mb-0.5">{t('countrycomparison.summary.totalCost')}</p>
                  <p className="text-lg font-bold text-white">{fmtCost(m.totalCost, currency, naLabel)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-gray-600 uppercase tracking-wider mb-0.5">{t('countrycomparison.summary.highRisk')}</p>
                  <p className={`text-lg font-bold ${riskColor(m.highRiskPct)}`}>{pct(m.highRiskPct, naLabel)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-gray-600 uppercase tracking-wider mb-0.5">{t('countrycomparison.summary.avgCpk')}</p>
                  <p className="text-lg font-bold text-white">{cpk(m.avgCpk, naLabel)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-gray-600 uppercase tracking-wider mb-0.5">{t('countrycomparison.summary.openActions')}</p>
                  <p className={`text-lg font-bold ${overdueColor(m.openActions)}`}>{(m.openActions ?? 0).toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-[11px] text-gray-600 uppercase tracking-wider mb-0.5">{t('countrycomparison.summary.overdue')}</p>
                  <p className={`text-lg font-bold ${overdueColor(m.overdueActions)}`}>{(m.overdueActions ?? 0).toLocaleString()}</p>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* KPI comparison table */}
      <div className="card">
        <h2 className="text-sm font-semibold text-white mb-4">{t('countrycomparison.table.title')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-header rounded-tl-md w-48">{t('countrycomparison.table.metric')}</th>
                {metrics.map(m => (
                  <th key={m.country} className="table-header text-center" style={{ color: countryColorMap[m.country] || '#6b7280' }}>
                    {m.country}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {KPI_ROWS.map(({ key, fmt: fmtFn, icon: Icon, lowerIsBetter }) => {
                // Find best / worst for rank highlights
                const numericVals = metrics.map(m => m[key]).filter(v => v != null && !isNaN(v))
                const minVal = numericVals.length ? Math.min(...numericVals) : null
                const maxVal = numericVals.length ? Math.max(...numericVals) : null
                const bestVal  = lowerIsBetter ? minVal : maxVal
                const worstVal = lowerIsBetter ? maxVal : minVal
                const naLabel  = t('countrycomparison.states.na')

                return (
                  <tr key={key} className="hover:bg-white/2 transition-colors">
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <Icon size={13} className="text-gray-600 flex-shrink-0" />
                        <span className="text-gray-400">{t(`countrycomparison.kpiRows.${key}`)}</span>
                      </div>
                    </td>
                    {metrics.map(m => {
                      const val = m[key]
                      const display = fmtFn(val, m.country, naLabel)
                      let colorClass = 'text-gray-200'
                      if (key === 'highRiskPct')    colorClass = riskColor(val)
                      else if (key === 'overdueActions' || key === 'openActions') colorClass = overdueColor(val)
                      else if (val != null && numericVals.length > 1) {
                        if (val === bestVal)  colorClass = 'text-green-400'
                        if (val === worstVal) colorClass = 'text-red-400'
                      }
                      const isBest  = val != null && val === bestVal  && numericVals.length > 1
                      const isWorst = val != null && val === worstVal && numericVals.length > 1

                      return (
                        <td key={m.country} className="table-cell text-center">
                          <div className="flex items-center justify-center gap-1">
                            {isBest  && <Award size={10} className="text-green-400 flex-shrink-0" />}
                            <span className={`font-semibold ${colorClass}`}>{display}</span>
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{t('countrycomparison.charts.costByCountry')}</p>
          <div style={{ height: 160 }}>
            <Bar data={costChartData} options={BAR_OPTS} />
          </div>
        </div>
        <div className="card">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{t('countrycomparison.charts.riskByCountry')}</p>
          <div style={{ height: 160 }}>
            <Bar data={riskChartData} options={{ ...BAR_OPTS, scales: { ...BAR_OPTS.scales, y: { ...BAR_OPTS.scales.y, max: 100 } } }} />
          </div>
        </div>
        <div className="card">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{t('countrycomparison.charts.cpkByCountry')}</p>
          <div style={{ height: 160 }}>
            <Bar data={cpkChartData} options={BAR_OPTS} />
          </div>
        </div>
        <div className="card">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{t('countrycomparison.charts.openActionsByCountry')}</p>
          <div style={{ height: 160 }}>
            <Bar data={openActionsChartData} options={BAR_OPTS} />
          </div>
        </div>
      </div>

      {/* ── Trend comparison (monthly & yearly) ── */}
      <div className="card">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div>
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <TrendingUp size={15} className="text-blue-400" /> {t('countrycomparison.trend.title')}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">{t('countrycomparison.trend.subtitle', { metric: trendMetric === 'cnt' ? t('countrycomparison.trend.volume') : t('countrycomparison.trend.cost') })}</p>
          </div>
          <div className="flex gap-1 bg-gray-800/40 rounded-lg p-1">
            {[['cnt', t('countrycomparison.trend.records')], ['cost', t('countrycomparison.trend.costToggle')]].map(([k, label]) => (
              <button key={k} onClick={() => setTrendMetric(k)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${trendMetric === k ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {!hasTrend ? (
          <div className="py-12 text-center text-gray-600 text-sm">
            {t('countrycomparison.trend.noTrend')}
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{t('countrycomparison.trend.monthlyTrend')}</p>
              <div style={{ height: 240 }}>
                <Line data={monthlyTrendData} options={TREND_OPTS} />
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{t('countrycomparison.trend.yearOverYear')}</p>
              <div style={{ height: 240 }}>
                <Bar data={yearlyTrendData} options={TREND_OPTS} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
