import { useState, useEffect, useMemo, useCallback } from 'react'
import { useLanguage } from '../contexts/LanguageContext'
import { useSettings } from '../contexts/SettingsContext'
import { supabase } from '../lib/supabase'
import { Bar, Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement,
  Title, Tooltip, Legend,
} from 'chart.js'
import { GitCompare, BarChart2, Globe, AlertTriangle, RefreshCw, TrendingUp, FileSpreadsheet, FileText } from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useReportMeta } from '../hooks/useReportMeta'
import { formatCurrencyCompact } from '../lib/formatters'
import { fetchAllPages } from '../lib/fetchAll'
import { computeCountryMetrics } from '../lib/analyticsEngine'
import { toUserMessage } from '../lib/safeError'
import { getExpensePeriodTrend } from '../lib/api/expenseTrends'
import { currencyFor, comparability, bestValue, pricedCoverage, trendByCountry, comparisonExportRows } from '../lib/countryComparisonAnalytics'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend)

// Hard row ceiling for the bounded client read. tyre_records can grow to millions
// of rows, so the full-set read that builds the country list + per-country metrics
// is capped and a truncated read is surfaced as an honest "capped view" note.
const ROW_CAP = 50000

// Formats whose values carry a currency. A summary card that aggregates one of
// these across MORE THAN ONE country would blend different currencies (KSA SAR,
// UAE AED, Egypt EGP) into a single meaningless figure, so those aggregates are
// shown as N/A on a multi-country comparison. The per-country table columns still
// show each country's own money value.
const MONEY_FORMATS = new Set(['currency', 'cpk'])

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
  { key: 'pricedPct',      i18n: null,                    fallback: 'Priced Records %', icon: '🧾', format: 'pct',     lowerIsBetter: false, agg: 'avg' },
]

const CHART_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#9ca3af' } } },
  scales: {
    x: { ticks: { color: '#6b7280' }, grid: { color: 'var(--panel-2)' } },
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
  const [truncated, setTruncated] = useState(false)
  const [trendRows, setTrendRows] = useState([])
  const [trendState, setTrendState] = useState({ loading: true, error: '' })
  const [trendAttempt, setTrendAttempt] = useState(0)
  const [exportError, setExportError] = useState('')

  useEffect(() => {
    let live = true
    setTrendState({ loading: true, error: '' })
    getExpensePeriodTrend({ country: activeCountry && activeCountry !== 'All' ? activeCountry : 'All', grain: 'month' })
      .then(rows => { if (live) { setTrendRows(rows); setTrendState({ loading: false, error: '' }) } })
      .catch(err => { if (live) { setTrendRows([]); setTrendState({ loading: false, error: toUserMessage(err, 'The expense trend could not be loaded.') }) } })
    return () => { live = false }
  }, [activeCountry, trendAttempt])

  const fmt = useCallback((format, val, country) => {
    if (val == null || Number.isNaN(val)) return t('countrycomparison.states.na')
    switch (format) {
      case 'currency': {
        const cur = country ? currencyFor(country) : activeCurrency
        return cur ? formatCurrencyCompact(val, cur) : `${Math.round(val).toLocaleString()} (currency unknown)`
      }
      case 'pct':      return `${val.toFixed(1)}%`
      case 'cpk':      return country && currencyFor(country) ? `${val.toFixed(2)} ${currencyFor(country)}/km` : val.toFixed(2)
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
      const { data, error: e, truncated: tr } = await fetchAllPages((from, to) => {
        return supabase
          .from('tyre_records')
          .select('id, country, brand, site, category, risk_level, cost_per_tyre, qty, km_at_fitment, km_at_removal')
          .not('country', 'is', null)
          .order('country')
          .order('id')
          .range(from, to)
      }, { max: ROW_CAP })
      if (e) throw new Error(e.message || e)
      setTruncated(Boolean(tr))
      const recs = (data || []).filter(r => r.country && String(r.country).trim())
      setRecords(recs)

      const available = [...new Set(recs.map(r => String(r.country).trim()))].sort()
      setAllCountries(available)
      // Preserve any prior selection that is still valid; otherwise seed with all available
      // countries so the user gets a complete side-by-side comparison on first paint.
      setCountries(prev => {
        const stillValid = prev.filter(c => available.includes(c))
        if (stillValid.length > 0) return stillValid
        return available
      })
    } catch (err) {
      setError(toUserMessage(err, 'Failed to load country data.'))
      setTruncated(false)
      setRecords([])
      setAllCountries([])
      setCountries([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Per-country metrics for the currently selected countries. Reuses the shared
  // analytics engine so this page stays consistent with the rest of the app.
  const metrics = useMemo(() => {
    if (countries.length === 0) return []
    const scoped = records.filter(r => countries.includes(String(r.country).trim()))
    const byCountry = computeCountryMetrics(scoped)
    // Keep only the selected countries and order them as selected for stable UX.
    const priced = pricedCoverage(scoped)
    const map = Object.fromEntries(byCountry.map(m => [m.country, { ...m, pricedPct: priced[m.country]?.pct ?? null }]))
    return countries.map(c => map[c]).filter(Boolean)
  }, [records, countries])

  const trends = useMemo(() => trendByCountry(trendRows, { countries, last: 12 }), [trendRows, countries])

  // Table rows: one row per KPI, one column per selected country.
  const tableData = useMemo(() => {
    if (metrics.length === 0) return []
    return KPI_ROWS.map(kpi => {
      const row = { key: kpi.key, label: (kpi.i18n ? (t(`countrycomparison.${kpi.i18n}`) || kpi.fallback) : kpi.fallback), icon: kpi.icon }
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
          <span className="font-medium text-white flex flex-col">
            <span className="flex items-center gap-2"><span>{row.original.icon}</span>{row.original.label}</span>
            {!comparability(KPI_ROWS.find(k => k.key === row.original.key)?.format, selectedCountries).comparable && (
              <span className="text-[10px] font-normal text-amber-400">Not comparable: {comparability(KPI_ROWS.find(k => k.key === row.original.key)?.format, selectedCountries).reason}</span>
            )}
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
          const { comparable } = comparability(kpi.format, selectedCountries)
          const best = bestValue(selectedCountries.map(cc => row.original[cc]), kpi.lowerIsBetter, comparable)
          const isBest = best != null && val === best
          return (
            <span className={isBest ? 'text-emerald-400 font-semibold' : 'text-gray-300'}>
              {fmt(kpi.format, val, c)}
            </span>
          )
        },
      })
    })
    return cols
  }, [selectedCountries, metrics.length, fmt, t])

  // Summary cards: aggregate each KPI across the compared countries. A money-format
  // KPI is NOT aggregated across more than one country - the countries can use
  // different currencies (SAR / AED / EGP) and a single blended figure would be
  // meaningless. Those cards show N/A instead; the per-country table keeps each
  // country's own currency value.
  const summaryCards = useMemo(() => {
    return KPI_ROWS.map(kpi => {
      const vals = metrics.map(m => m[kpi.key]).filter(v => v != null && !Number.isNaN(v))
      const blendsCurrency = MONEY_FORMATS.has(kpi.format) && !comparability(kpi.format, metrics.map(m => m.country)).comparable
      let agg = null
      if (vals.length > 0 && !blendsCurrency) {
        const total = vals.reduce((s, v) => s + v, 0)
        agg = kpi.agg === 'avg' ? total / vals.length : total
      }
      const single = metrics.length === 1 ? metrics[0].country : (MONEY_FORMATS.has(kpi.format) && metrics.length ? metrics[0].country : undefined)
      return { key: kpi.key, label: (kpi.i18n ? (t(`countrycomparison.${kpi.i18n}`) || kpi.fallback) : kpi.fallback), value: fmt(kpi.format, agg, single) }
    })
  }, [metrics, fmt, t])

  const chartData = useMemo(() => ({
    labels: metrics.map(m => m.country),
    datasets: [
      { label: t('countrycomparison.kpiRows.count') || 'Fleet Records', data: metrics.map(m => m.count), backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 4, yAxisID: 'y' },
      { label: `${t('countrycomparison.kpiRows.highRiskPct') || 'High Risk %'}`, data: metrics.map(m => m.highRiskPct), backgroundColor: 'rgba(239,68,68,0.6)', borderRadius: 4, yAxisID: 'y1' },
      { label: 'Priced records %', data: metrics.map(m => m.pricedPct), backgroundColor: 'rgba(16,185,129,0.7)', borderRadius: 4, yAxisID: 'y1' },
    ],
  }), [metrics, t])

  const exportComparison = useCallback(async (kind) => {
    setExportError('')
    try {
      const { exportToExcel, exportToPdf, reportFileName } = await import('../lib/exportUtils')
      const kpis = KPI_ROWS.map(k => ({ ...k, label: k.i18n ? (t(`countrycomparison.${k.i18n}`) || k.fallback) : k.fallback }))
      const rows = comparisonExportRows(kpis, metrics, (k, v, c) => fmt(k.format, v, c))
      const cols = ['metric', ...metrics.map(m => m.country), 'comparable']
      const heads = ['Metric', ...metrics.map(m => m.country), 'Comparable across countries']
      const name = reportFileName('Country Comparison')
      if (kind === 'excel') await exportToExcel(rows, cols, heads, name)
      else await exportToPdf(rows, cols.map((k, i) => ({ key: k, header: heads[i] })), 'Country Comparison', name, 'landscape')
    } catch (err) { setExportError(toUserMessage(err, 'The export could not be created.')) }
  }, [metrics, fmt, t])

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

          {truncated && (
            <div className="flex items-center gap-2 text-amber-400 text-xs bg-amber-400/10 border border-amber-400/20 rounded-xl px-4 py-2.5">
              <AlertTriangle size={13} />
              Showing a capped view of up to {ROW_CAP.toLocaleString('en-US')} records. Narrow the country scope for full detail.
            </div>
          )}

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
              {selectedCountries.length > 1 && (
                <p className="text-[11px] text-gray-500 -mt-2">
                  Money totals are not combined across countries (currencies may differ). See each country's own value in the table below.
                </p>
              )}
              {metrics.some(m => m.pricedPct != null && m.pricedPct < 50) && (
                <p className="text-[11px] text-amber-400">
                  Cost figures come from tyre record prices. Under half the records are priced in: {metrics.filter(m => m.pricedPct != null && m.pricedPct < 50).map(m => `${m.country} (${m.pricedPct}%)`).join(', ')}. The expense trend below is the authoritative spend.
                </p>
              )}

              {/* Chart */}
              <div className="card">
                <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
                  <BarChart2 size={15} className="text-blue-400" /> Records, risk and price coverage by country
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

              {/* Per-country expense trend, each in its own currency */}
              <div className="card space-y-3">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <TrendingUp size={15} className="text-blue-400" /> Monthly expense trend per country (last 12 months with data)
                </h3>
                <p className="text-[11px] text-gray-500">From the expense grid. Each chart is in that country's own currency, so the lines are not drawn on one axis.</p>
                {trendState.loading ? <div className="animate-pulse h-40 rounded bg-white/5" />
                  : trendState.error ? <p className="text-sm text-red-300">{trendState.error} <button className="underline" onClick={() => setTrendAttempt(n => n + 1)}>{t('countrycomparison.states.retry')}</button></p>
                  : !trends.length ? <p className="text-sm text-gray-500">No expense lines recorded for the selected countries.</p>
                  : <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">{trends.map(tr => (
                    <div key={tr.country} className="rounded-xl border border-[var(--border-dim)] p-3">
                      <div className="flex items-baseline justify-between"><p className="font-semibold text-white">{tr.country}</p><p className="text-[11px] text-gray-500">{tr.currency || 'Currency unknown'}</p></div>
                      <p className="text-xs text-gray-400">Latest month {tr.latest == null ? 'N/A' : (tr.currency ? formatCurrencyCompact(tr.latest, tr.currency) : tr.latest.toLocaleString())}{tr.changePct != null && <span className={tr.changePct > 0 ? 'text-red-300' : 'text-emerald-300'}> ({tr.changePct > 0 ? '+' : ''}{tr.changePct}% vs prior month)</span>}</p>
                      <div style={{ height: 150 }}>
                        <Line data={{ labels: tr.points.map(p => p.period), datasets: [
                          { label: 'Total', data: tr.points.map(p => p.total), borderColor: '#60a5fa', backgroundColor: 'transparent', tension: 0.3, pointRadius: 2 },
                          { label: 'Tyres', data: tr.points.map(p => p.tyre), borderColor: '#34d399', backgroundColor: 'transparent', tension: 0.3, pointRadius: 2 },
                        ] }} options={{ ...CHART_OPTS, plugins: { legend: { labels: { color: '#9ca3af', boxWidth: 8 } } } }} />
                      </div>
                    </div>
                  ))}</div>}
              </div>

              {/* Detailed metrics table */}
              <div className="card p-0 overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--border-dim)] flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-white">{t('countrycomparison.table.title')}</h3>
                  <div className="flex gap-2">
                    <button className="btn-secondary text-xs inline-flex items-center gap-1" onClick={() => exportComparison('excel')}><FileSpreadsheet size={13} /> Excel</button>
                    <button className="btn-secondary text-xs inline-flex items-center gap-1" onClick={() => exportComparison('pdf')}><FileText size={13} /> PDF</button>
                  </div>
                </div>
                {exportError && <p className="px-4 pt-2 text-xs text-red-300">{exportError}</p>}
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
