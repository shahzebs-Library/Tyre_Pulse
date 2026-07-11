import { useState, useEffect, useMemo, useCallback } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import { useSettings } from '../contexts/SettingsContext'
import { supabase } from '../lib/supabase'
import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  Title, Tooltip, Legend,
} from 'chart.js'
import { GitCompare, BarChart2, Globe, AlertTriangle, RefreshCw } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useReportMeta } from '../hooks/useReportMeta'
import { formatCurrencyCompact } from '../lib/formatters'
import { fetchAllPages } from '../lib/fetchAll'
import { computeCountryMetrics } from '../lib/analyticsEngine'

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend)

// KPI rows rendered in the comparison table + summary cards. `field` maps to a
// property produced by computeCountryMetrics; `format` controls presentation and
// `lowerIsBetter` drives the "best value" highlight per row.
const KPI_ROWS = [
  { key: 'count',          i18n: 'kpiRows.count',          fallback: 'Fleet Records',   icon: '🛞', format: 'int',      lowerIsBetter: false, agg: 'sum' },
  { key: 'avgCostPerTyre', i18n: 'kpiRows.avgCostPerTyre', fallback: 'Avg Cost / Tyre', icon: '💰', format: 'currency', lowerIsBetter: true,  agg: 'avg' },
  { key: 'totalCost',      i18n: 'kpiRows.totalCost',      fallback: 'Total Cost',      icon: '💵', format: 'currency', lowerIsBetter: false, agg: 'sum' },
  { key: 'avgCpk',         i18n: 'kpiRows.avgCpk',         fallback: 'Avg CPK',         icon: '📉', format: 'cpk',      lowerIsBetter: true,  agg: 'avg' },
  { key: 'highRiskPct',    i18n: 'kpiRows.highRiskPct',    fallback: 'High Risk %',     icon: '🔴', format: 'pct',      lowerIsBetter: true,  agg: 'avg' },
  { key: 'brandCount',     i18n: 'kpiRows.brandCount',     fallback: 'Brands Used',     icon: '🏷️', format: 'int',      lowerIsBetter: false, agg: 'sum' },
]

const CHART_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#9ca3af' } } },
  scales: {
    x: { ticks: { color: '#6b7280' }, grid: { color: '#1f2937' } },
    y: { ticks: { color: '#6b7280' }, grid: { color: '#374151' } },
  },
}

export default function CountryComparison() {
  const reportMeta = useReportMeta('Country Comparison')
  const { t } = useLanguage()
  const { activeCountry, activeCurrency } = useSettings()
  const [countries, setCountries] = useState([])
  const [allCountries, setAllCountries] = useState([])
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const fmt = useCallback((format, val) => {
    if (val == null || Number.isNaN(val)) return t('countrycomparison.states.na')
    switch (format) {
      case 'currency': return formatCurrencyCompact(val, activeCurrency)
      case 'pct':      return `${val.toFixed(1)}%`
      case 'cpk':      return val.toFixed(2)
      case 'int':      return Math.round(val).toLocaleString()
      default:         return String(val)
    }
  }, [activeCurrency, t])

  // ── Load every record for the tenant-visible scope in a single paged pass, then
  // derive both the country list and per-country metrics from the same dataset.
  // Fetching the full set (not a 1000-row page) is what makes the country
  // selector complete; deriving countries client-side avoids a second query and
  // guarantees the chips match the data actually charted. RLS still scopes rows,
  // and when an admin narrows to a single country the DB filter is applied too.
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data, error: e } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select('country, brand, site, category, risk_level, cost_per_tyre, qty, km_at_fitment, km_at_removal')
          .not('country', 'is', null)
          .order('country')
        if (activeCountry !== 'All') q = q.eq('country', activeCountry)
        return q.range(from, to)
      })
      if (e) throw new Error(e.message || e)
      const recs = (data || []).filter(r => r.country && String(r.country).trim())
      setRecords(recs)

      const available = [...new Set(recs.map(r => String(r.country).trim()))].sort()
      setAllCountries(available)
      // Preserve any prior selection that is still valid; otherwise seed with the
      // first few countries (or all, if fewer) so the page renders a real
      // comparison on first paint instead of an empty state.
      setCountries(prev => {
        const stillValid = prev.filter(c => available.includes(c))
        if (stillValid.length > 0) return stillValid
        return available.slice(0, Math.min(3, available.length))
      })
    } catch (err) {
      setError(err.message || 'Failed to load country data.')
      setRecords([])
      setAllCountries([])
      setCountries([])
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Per-country metrics for the currently selected countries. Reuses the shared
  // analytics engine so this page stays consistent with the rest of the app.
  const metrics = useMemo(() => {
    if (countries.length === 0) return []
    const scoped = records.filter(r => countries.includes(String(r.country).trim()))
    const byCountry = computeCountryMetrics(scoped)
    // Keep only the selected countries and order them as selected for stable UX.
    const map = Object.fromEntries(byCountry.map(m => [m.country, m]))
    return countries.map(c => map[c]).filter(Boolean)
  }, [records, countries])

  // Table rows: one row per KPI, one column per selected country.
  const tableData = useMemo(() => {
    if (metrics.length === 0) return []
    return KPI_ROWS.map(kpi => {
      const row = { key: kpi.key, label: t(`countrycomparison.${kpi.i18n}`) || kpi.fallback, icon: kpi.icon }
      metrics.forEach(m => { row[m.country] = m[kpi.key] })
      return row
    })
  }, [metrics, t])

  const selectedCountries = useMemo(() => metrics.map(m => m.country), [metrics])

  // Table columns: a fixed "Metric" column plus one column per selected country.
  const tableColumns = useMemo(() => {
    if (metrics.length === 0) return []
    const cols = [
      {
        id: 'metric',
        header: t('countrycomparison.table.metric') || 'Metric',
        accessorFn: r => r.label,
        size: 200,
        enableSorting: false,
        cell: ({ row }) => (
          <span className="font-medium text-white flex items-center gap-2">
            <span>{row.original.icon}</span>{row.original.label}
          </span>
        ),
      },
    ]
    selectedCountries.forEach(c => {
      cols.push({
        id: c,
        header: c,
        accessorFn: r => r[c],
        size: 130,
        enableSorting: false,
        meta: { align: 'center' },
        cell: ({ row }) => {
          const kpi = KPI_ROWS.find(k => k.key === row.original.key)
          const val = row.original[c]
          // Highlight the best value in each row across the compared countries.
          const rowVals = selectedCountries
            .map(cc => row.original[cc])
            .filter(v => v != null && !Number.isNaN(v))
          let isBest = false
          if (rowVals.length > 1 && val != null && !Number.isNaN(val)) {
            const best = kpi.lowerIsBetter ? Math.min(...rowVals) : Math.max(...rowVals)
            isBest = val === best
          }
          return (
            <span className={isBest ? 'text-emerald-400 font-semibold' : 'text-gray-300'}>
              {fmt(kpi.format, val)}
            </span>
          )
        },
      })
    })
    return cols
  }, [selectedCountries, metrics.length, fmt, t])

  // Summary cards: aggregate each KPI across the compared countries.
  const summaryCards = useMemo(() => {
    return KPI_ROWS.map(kpi => {
      const vals = metrics.map(m => m[kpi.key]).filter(v => v != null && !Number.isNaN(v))
      let agg = null
      if (vals.length > 0) {
        const total = vals.reduce((s, v) => s + v, 0)
        agg = kpi.agg === 'avg' ? total / vals.length : total
      }
      return { key: kpi.key, label: t(`countrycomparison.${kpi.i18n}`) || kpi.fallback, value: fmt(kpi.format, agg) }
    })
  }, [metrics, fmt, t])

  const chartData = useMemo(() => ({
    labels: metrics.map(m => m.country),
    datasets: [
      { label: t('countrycomparison.kpiRows.count') || 'Fleet Records', data: metrics.map(m => m.count), backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 4, yAxisID: 'y' },
      { label: t('countrycomparison.kpiRows.avgCostPerTyre') || 'Avg Cost / Tyre', data: metrics.map(m => m.avgCostPerTyre), backgroundColor: 'rgba(16,185,129,0.7)', borderRadius: 4, yAxisID: 'y1' },
    ],
  }), [metrics, t])

  const toggleCountry = useCallback((c) => {
    setCountries(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c].sort())
  }, [])

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('countrycomparison.title')}
        subtitle={t('countrycomparison.header.subtitle', {
          countries: selectedCountries.length ? selectedCountries.join(', ') : t('countrycomparison.states.na'),
        })}
        icon={GitCompare}
      />

      {error ? (
        <div className="card flex flex-col items-center justify-center py-16 text-center">
          <AlertTriangle size={40} className="text-red-400 mb-4" />
          <p className="text-red-300 font-medium text-lg">{t('countrycomparison.states.loadErrorTitle')}</p>
          <p className="text-gray-500 text-sm mt-1">{error}</p>
          <button onClick={load} className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">
            <RefreshCw size={16} /> {t('countrycomparison.states.retry')}
          </button>
        </div>
      ) : loading ? (
        <>
          <div className="card animate-pulse h-20" />
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="card animate-pulse h-20" />)}
          </div>
          <div className="card animate-pulse h-72" />
        </>
      ) : allCountries.length === 0 ? (
        <div className="card text-center py-16">
          <Globe size={40} className="text-gray-700 mx-auto mb-4" />
          <p className="text-gray-400 font-medium text-lg">{t('countrycomparison.states.noDataTitle')}</p>
          <p className="text-gray-600 text-sm mt-1">{t('countrycomparison.states.noDataHint')}</p>
        </div>
      ) : (
        <>
          {/* Country selector */}
          <div className="card">
            <label className="label mb-2 flex items-center gap-2">
              <Globe size={14} className="text-blue-400" /> {t('countrycomparison.filters.countries')}
            </label>
            <div className="flex flex-wrap gap-2">
              {allCountries.map(c => {
                const active = countries.includes(c)
                return (
                  <button
                    key={c}
                    onClick={() => toggleCountry(c)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      active ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-700 text-gray-400 hover:border-gray-500'
                    }`}
                  >
                    {c}
                  </button>
                )
              })}
            </div>
          </div>

          {metrics.length === 0 ? (
            <div className="card text-center py-14">
              <BarChart2 size={36} className="text-gray-700 mx-auto mb-3" />
              <p className="text-gray-400 font-medium">{t('countrycomparison.states.noDataSubtitle')}</p>
              <p className="text-gray-600 text-sm mt-1">{t('countrycomparison.states.noDataHint')}</p>
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
                {summaryCards.map(card => (
                  <div key={card.key} className="card text-center">
                    <p className="text-xs text-gray-500">{card.label}</p>
                    <p className="text-lg font-bold text-white mt-1">{card.value}</p>
                  </div>
                ))}
              </div>

              {/* Chart */}
              <div className="card">
                <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                  <BarChart2 size={15} className="text-blue-400" /> {t('countrycomparison.charts.costByCountry')}
                </h3>
                <div style={{ height: 300 }}>
                  <Bar data={chartData} options={{
                    ...CHART_OPTS,
                    scales: {
                      ...CHART_OPTS.scales,
                      y1: { position: 'right', grid: { display: false }, ticks: { color: '#6b7280' } },
                    },
                  }} />
                </div>
              </div>

              {/* Detailed metrics table */}
              <div className="card p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--border-dim)]">
                  <h3 className="text-sm font-semibold text-white">{t('countrycomparison.table.title')}</h3>
                </div>
                <EnterpriseTable
                  reportMeta={reportMeta}
                  columns={tableColumns}
                  data={tableData}
                  getRowId={(row) => row.key}
                  enableGlobalFilter={false}
                  enableSorting={false}
                  enableColumnFilters={false}
                  enableColumnVisibility={false}
                  enableExport={false}
                  emptyMessage={t('countrycomparison.states.noDataSubtitle')}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
