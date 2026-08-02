import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import { computeBrandMetrics, linearRegression, bucketByMonth, recordCost } from '../lib/analyticsEngine'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import { Maximize2, X, BarChart2, Download, FileText, Award, AlertTriangle, RefreshCw, Ruler, Trophy, Tag } from 'lucide-react'
import { getBrandSizeCpk } from '../lib/api/brandSizeCpk'
import { groupBySize, recommendationFor, formatNumber, formatCpk } from '../lib/brandSizeCpk'
import { SkeletonCards, SkeletonChart } from '../components/ui/Skeleton'
import { motion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'
import PeriodFilter, { filterByPeriodValue } from '../components/ui/PeriodFilter'
import { ChartModal } from '../components/ChartModal'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { formatCurrencyCompact } from '../lib/formatters'
import { fetchAllPages } from '../lib/fetchAll'
import { loadGovernedCostSplit } from '../lib/api/governedCost'
import EnterpriseTable from '../components/ui/EnterpriseTable'
import { useReportMeta } from '../hooks/useReportMeta'
import { toUserMessage } from '../lib/safeError'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend)

const CHART_OPTS = (horizontal = false) => ({
  responsive: true, maintainAspectRatio: false,
  indexAxis: horizontal ? 'y' : 'x',
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { color: 'var(--panel-2)' }, ticks: { color: '#9ca3af' } },
    y: { grid: { color: 'var(--panel-2)' }, ticks: { color: '#9ca3af' } },
  },
})

const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical']

export default function BrandPerformance() {
  const reportMeta = useReportMeta('Brand Performance')
  const { activeCountry, activeCurrency } = useSettings()
  const [records, setRecords] = useState([])
  const [recordsTruncated, setRecordsTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [selected, setSelected]   = useState(null)
  const [tableSearch, setTableSearch] = useState('')
  // Authoritative fleet-level tyre cost from the classified expense grid.
  const [fleetTyreCost, setFleetTyreCost] = useState(null)

  // Filters
  const [period, setPeriod]             = useState({ mode: 'all' })
  const [selectedSites, setSelectedSites] = useState([])
  const [riskLevels, setRiskLevels]     = useState([])

  // Modal
  const [modalOpen, setModalOpen] = useState(false)
  const chartRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      // Per-row brand aggregation has no server RPC, so this stays a client pull.
      // It is BOUNDED: country-scoped, newest-first, and capped at 50,000 rows so
      // it can never fetch a millions-row table into the browser. A server date
      // window is deliberately NOT applied: the Period filter defaults to "all"
      // and is applied client-side over the full set, so narrowing the fetch by
      // date would change what "all" means. Aggregation is order-independent, so
      // newest-first only governs which rows survive the cap, never today's
      // figures (identical while the country holds under 50,000 records).
      const { data, error: e, truncated } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select('id,issue_date,brand,site,category,risk_level,cost_per_tyre,qty,description,remarks')
          .order('issue_date', { ascending: false })
        if (activeCountry !== 'All') q = q.eq('country', activeCountry)
        return q.range(from, to)
      }, { max: 50000 })
      if (e) throw new Error(e.message || e)
      setRecords(data || [])
      setRecordsTruncated(!!truncated)
    } catch (err) {
      setError(toUserMessage(err, 'Failed to load brand data.'))
      setRecords([])
      setRecordsTruncated(false)
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

  // Fleet-level total tyre cost comes from the authoritative expense grid
  // (loadCostSplit.tyre), not from summing per-brand cost_per_tyre.
  useEffect(() => {
    let alive = true
    loadGovernedCostSplit({ country: activeCountry })
      .then(r => { if (alive) setFleetTyreCost(r?.tyre ?? null) })
      .catch(() => { if (alive) setFleetTyreCost(null) })
    return () => { alive = false }
  }, [activeCountry])

  const uniqueSites = useMemo(() => {
    const s = new Set(records.map(r => r.site).filter(Boolean))
    return [...s].sort()
  }, [records])

  const filtered = useMemo(() => {
    return filterByPeriodValue(records, period, 'issue_date').filter(r => {
      if (selectedSites.length > 0 && !selectedSites.includes(r.site)) return false
      if (riskLevels.length > 0) {
        const level = (r.risk_level || '').toLowerCase()
        if (!riskLevels.map(l => l.toLowerCase()).includes(level)) return false
      }
      return true
    })
  }, [records, period, selectedSites, riskLevels])

  const metrics = useMemo(() => computeBrandMetrics(filtered), [filtered])
  const selectedData = useMemo(() =>
    selected ? filtered.filter(r => r.brand === selected) : [],
    [filtered, selected]
  )

  const hasActiveFilter = period.mode !== 'all' || selectedSites.length > 0 || riskLevels.length > 0

  function toggleSite(site) {
    setSelectedSites(prev => prev.includes(site) ? prev.filter(s => s !== site) : [...prev, site])
  }

  function toggleRisk(level) {
    setRiskLevels(prev => prev.includes(level) ? prev.filter(l => l !== level) : [...prev, level])
  }

  function clearFilters() {
    setPeriod({ mode: 'all' })
    setSelectedSites([])
    setRiskLevels([])
  }

  if (loading) return (
    <div className="space-y-5">
      <PageHeader title="Brand Performance" subtitle="Loading brand data..." icon={BarChart2} />
      <SkeletonCards count={4} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SkeletonChart />
        <SkeletonChart />
      </div>
    </div>
  )

  if (error && metrics.length === 0) return (
    <div className="space-y-5">
      <PageHeader title="Brand Performance" subtitle="Could not load data" icon={BarChart2} />
      <div className="card py-16 flex flex-col items-center gap-3">
        <AlertTriangle size={40} className="text-red-400" />
        <p className="text-red-300 font-medium">Could not load brand performance</p>
        <p className="text-gray-500 text-sm">{error}</p>
        <button onClick={load} className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">
          <RefreshCw size={16} /> Retry
        </button>
      </div>
    </div>
  )

  if (metrics.length === 0) return (
    <div className="space-y-5">
      <PageHeader title="Brand Performance" subtitle="No brand data available" icon={BarChart2} />
      <div className="card py-16 flex flex-col items-center gap-3">
        <BarChart2 size={40} className="text-gray-700" />
        <p className="text-gray-400 font-medium">No tyre brand data yet</p>
        <p className="text-gray-600 text-sm">Import tyre records with brand information to see performance analytics</p>
      </div>
    </div>
  )

  const bestBrand  = [...metrics].sort((a, b) => a.failureRate - b.failureRate)[0]
  const worstBrand = [...metrics].sort((a, b) => b.failureRate - a.failureRate)[0]
  const totalCostAll = metrics.reduce((s, b) => s + b.totalCost, 0)

  const filteredMetrics = tableSearch
    ? metrics.filter(b => b.brand.toLowerCase().includes(tableSearch.toLowerCase()))
    : metrics

  // Top 10 brands by count for the ranking chart
  const top10 = metrics.slice(0, 10)

  const rankingChart = {
    labels: top10.map(b => b.brand),
    datasets: [
      {
        label: 'Records',
        data: top10.map(b => b.count),
        backgroundColor: top10.map(b =>
          b.failureRate > 30 ? 'rgba(239,68,68,0.7)' :
          b.failureRate > 15 ? 'rgba(245,158,11,0.7)' : 'rgba(16,185,129,0.7)'
        ),
        borderRadius: 4,
      },
    ],
  }

  const failureRateChart = {
    labels: top10.map(b => b.brand),
    datasets: [{
      label: 'Failure Rate %',
      data: top10.map(b => parseFloat(b.failureRate.toFixed(1))),
      backgroundColor: 'rgba(239,68,68,0.6)',
      borderRadius: 4,
    }],
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Brand Performance"
        subtitle="Failure rates, avg life, cost and ranking by brand"
        icon={BarChart2}
      />

      {recordsTruncated && (
        <div className="px-3 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10 text-xs text-amber-200">
          Capped view: showing the most recent 50,000 tyre records for the selected
          country. Total Fleet Cost is a server aggregate and stays exact. Narrow the
          country or period for complete per brand detail.
        </div>
      )}

      {/* KPI summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card text-center">
          <p className="text-2xl font-bold text-white">{metrics.length}</p>
          <p className="text-xs text-gray-500 mt-1">Brands Tracked</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-blue-400">{formatCurrencyCompact(fleetTyreCost != null ? fleetTyreCost : totalCostAll, activeCurrency)}</p>
          <p className="text-xs text-gray-500 mt-1">Total Fleet Cost</p>
        </div>
        {bestBrand && (
          <div className="card text-center border-green-700/40">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <Award size={12} className="text-green-400" />
              <p className="text-xs text-green-400 font-medium uppercase tracking-wide">Best Brand</p>
            </div>
            <p className="text-lg font-bold text-white truncate">{bestBrand.brand}</p>
            <p className="text-xs text-green-400">{bestBrand.failureRate.toFixed(1)}% failure rate</p>
          </div>
        )}
        {worstBrand && worstBrand.brand !== bestBrand?.brand && (
          <div className="card text-center border-red-700/40">
            <p className="text-xs text-red-400 font-medium uppercase tracking-wide mb-0.5">Highest Risk</p>
            <p className="text-lg font-bold text-white truncate">{worstBrand.brand}</p>
            <p className="text-xs text-red-400">{worstBrand.failureRate.toFixed(1)}% failure rate</p>
          </div>
        )}
      </div>

      {/* Filter bar */}
      <div className="card space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Period */}
          <div className="flex flex-col gap-1">
            <label className="label text-xs">Period</label>
            <PeriodFilter records={records} value={period} onChange={setPeriod} />
          </div>

          {/* Clear */}
          {hasActiveFilter && (
            <button onClick={clearFilters} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5 self-end">
              <X size={14} /> Clear Filters
            </button>
          )}
        </div>

        {/* Site multi-select chips */}
        {uniqueSites.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">Sites:</span>
            <button
              onClick={() => setSelectedSites([])}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                selectedSites.length === 0 ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-700 text-gray-400 hover:border-gray-500'
              }`}
            >
              All
            </button>
            {uniqueSites.map(site => (
              <button
                key={site}
                onClick={() => toggleSite(site)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  selectedSites.includes(site)
                    ? 'bg-purple-700 border-purple-700 text-white'
                    : 'border-gray-700 text-gray-400 hover:border-gray-500'
                }`}
              >
                {site}
              </button>
            ))}
          </div>
        )}

        {/* Risk level chips */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500">Risk:</span>
          <button
            onClick={() => setRiskLevels([])}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              riskLevels.length === 0 ? 'bg-blue-600 border-blue-600 text-white' : 'border-gray-700 text-gray-400 hover:border-gray-500'
            }`}
          >
            All
          </button>
          {RISK_LEVELS.map(level => {
            const active = riskLevels.includes(level)
            const colorMap = { Low: 'green', Medium: 'yellow', High: 'orange', Critical: 'red' }
            const c = colorMap[level]
            return (
              <button
                key={level}
                onClick={() => toggleRisk(level)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  active
                    ? c === 'green' ? 'bg-green-700 border-green-700 text-white'
                    : c === 'yellow' ? 'bg-yellow-700 border-yellow-700 text-white'
                    : c === 'orange' ? 'bg-orange-700 border-orange-700 text-white'
                    : 'bg-red-700 border-red-700 text-white'
                    : 'border-gray-700 text-gray-400 hover:border-gray-500'
                }`}
              >
                {level}
              </button>
            )
          })}
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card relative">
          <h3 className="text-sm font-medium text-gray-400 mb-4">Volume by Brand (top 10)</h3>
          <button
            onClick={() => setModalOpen(true)}
            className="absolute top-3 right-3 z-10 text-gray-500 hover:text-white transition-colors p-1 rounded hover:bg-gray-700"
            title="Fullscreen"
          >
            <Maximize2 size={15} />
          </button>
          <div style={{ height: 240 }}>
            <Bar ref={chartRef} data={rankingChart} options={CHART_OPTS()} />
          </div>
        </div>
        <div className="card">
          <h3 className="text-sm font-medium text-gray-400 mb-4">High-Risk Failure Rate % (top 10)</h3>
          <div style={{ height: 240 }}>
            <Bar data={failureRateChart} options={CHART_OPTS()} />
          </div>
        </div>
      </div>

      {/* Ranking table - EnterpriseTable */}
      <p className="text-[11px] text-gray-500">Cost by brand is from tyre records; the authoritative fleet total is from the expense grid.</p>
      {(() => {
        const brandColumns = [
          {
            id: 'rank',
            header: '#',
            accessorFn: (_, i) => metrics.indexOf(_) + 1,
            size: 40,
            enableSorting: false,
            meta: { align: 'center' },
          },
          {
            id: 'brand',
            header: 'Brand',
            accessorFn: row => row.brand,
            size: 120,
            cell: ({ getValue }) => <span className="font-medium text-[var(--text-primary)]">{getValue()}</span>,
          },
          {
            id: 'count',
            header: 'Records',
            accessorFn: row => row.count,
            size: 80,
            meta: { align: 'right' },
          },
          {
            id: 'totalCost',
            header: 'Total Cost',
            accessorFn: row => formatCurrencyCompact(row.totalCost, activeCurrency),
            size: 110,
            meta: { align: 'right' },
          },
          {
            id: 'avgCost',
            header: 'Avg/Tyre',
            accessorFn: row => formatCurrencyCompact(row.avgCost, activeCurrency),
            size: 100,
            meta: { align: 'right' },
          },
          {
            id: 'failureRate',
            header: 'Failure Rate',
            accessorFn: row => row.failureRate,
            size: 110,
            meta: { align: 'right' },
            cell: ({ getValue }) => {
              const val = getValue()
              return (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  val > 30 ? 'bg-red-900/40 text-red-400' :
                  val > 15 ? 'bg-yellow-900/40 text-yellow-400' :
                  'bg-green-900/40 text-green-400'
                }`}>
                  {val.toFixed(1)}%
                </span>
              )
            },
            sortingFn: (a, b) => a.original.failureRate - b.original.failureRate,
          },
          {
            id: 'topCategory',
            header: 'Top Failure',
            accessorFn: row => row.topCategory ?? '-',
            size: 120,
          },
          {
            id: 'riskScore',
            header: 'Risk Score',
            accessorFn: row => row.riskScore,
            size: 100,
            meta: { align: 'right' },
            cell: ({ getValue }) => {
              const val = getValue()
              return (
                <span className={`text-xs font-mono ${
                  val > 2 ? 'text-red-400' :
                  val > 1.5 ? 'text-yellow-400' : 'text-green-400'
                }`}>
                  {val.toFixed(2)}
                </span>
              )
            },
          },
        ]
        return (
          <EnterpriseTable
            reportMeta={reportMeta}
            columns={brandColumns}
            data={filteredMetrics}
            loading={false}
            enableGlobalFilter={true}
            searchPlaceholder="Search brand..."
            enableSorting={true}
            enableExport={true}
            exportFileName="TyrePulse_BrandPerformance"
            initialPageSize={25}
            pageSizeOptions={[10, 25, 50]}
            emptyMessage={`No brands match your filters`}
            onRowClick={(row) => setSelected(selected === row.brand ? null : row.brand)}
            enableRowSelection={false}
          />
        )
      })()}

      {/* Drill-down panel */}
      {selected && <BrandDrillDown brand={selected} records={selectedData} />}

      {/* Brand & price by size - value comparison */}
      <BrandSizeValuePanel country={activeCountry} />

      {/* ChartModal */}
      <ChartModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Volume by Brand (top 10)"
        chartRef={chartRef}
        filters={{}}
        filterOptions={{ sites: uniqueSites, brands: [] }}
        showSite={false}
        showBrand={false}
      >
        <div style={{ height: 480 }}>
          <Bar ref={chartRef} data={rankingChart} options={CHART_OPTS()} />
        </div>
      </ChartModal>
    </div>
  )
}

function BrandDrillDown({ brand, records }) {
  const monthly = useMemo(() =>
    bucketByMonth(records, r => r.issue_date, r => recordCost(r)),
    [records]
  )

  const trendPoints = monthly.map((d, i) => [i, d.count])
  const reg = trendPoints.length >= 2 ? linearRegression(trendPoints) : null

  const chartData = {
    labels: monthly.map(d => d.month),
    datasets: [
      {
        label: 'Records',
        data: monthly.map(d => d.count),
        borderColor: 'rgba(59,130,246,1)',
        backgroundColor: 'rgba(59,130,246,0.15)',
        fill: true, tension: 0.4, yAxisID: 'y',
      },
      reg && {
        label: 'Trend',
        data: monthly.map((_, i) => Math.max(0, Math.round(reg.predict(i)))),
        borderColor: 'rgba(107,114,128,0.6)',
        borderDash: [4, 4], fill: false, pointRadius: 0, yAxisID: 'y',
      },
    ].filter(Boolean),
  }

  const lineOpts = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#9ca3af' } } },
    scales: {
      x: { grid: { color: 'var(--panel-2)' }, ticks: { color: '#9ca3af' } },
      y: { grid: { color: 'var(--panel-2)' }, ticks: { color: '#9ca3af' } },
    },
  }

  // Category breakdown
  const catMap = {}
  records.forEach(r => { if (r.category) catMap[r.category] = (catMap[r.category] || 0) + 1 })
  const catEntries = Object.entries(catMap).sort(([, a], [, b]) => b - a)

  return (
    <div className="card border border-blue-500/30 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-white">Drill-down: {brand}</h3>
        <span className="text-xs text-gray-500">{records.length} total records</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <p className="text-xs text-gray-400 mb-3">Monthly Failure Trend</p>
          <div style={{ height: 220 }}>
            <Line data={chartData} options={lineOpts} />
          </div>
          {reg && (
            <p className="text-xs text-gray-500 mt-2">
              Trend slope: {reg.slope > 0 ? 'up' : 'down'} {Math.abs(reg.slope).toFixed(2)}/mo
              &nbsp;· R² = {reg.r2.toFixed(2)}
            </p>
          )}
        </div>

        <div>
          <p className="text-xs text-gray-400 mb-3">Failure Category Breakdown</p>
          <div className="space-y-2">
            {catEntries.map(([cat, cnt]) => (
              <div key={cat} className="flex items-center gap-2">
                <div className="flex-1">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-300">{cat}</span>
                    <span className="text-gray-400">{cnt} ({((cnt / records.length) * 100).toFixed(0)}%)</span>
                  </div>
                  <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${(cnt / records.length) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
            {catEntries.length === 0 && <p className="text-gray-500 text-sm">No category data</p>}
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * BrandSizeValuePanel - the "brand & price by size (value comparison)" section.
 *
 * Answers the management question: for the SAME tyre size, which brand is
 * actually cheapest to RUN (cost per km), not just cheapest to buy? A cheaper
 * tyre that wears out fast is exposed here as costing more per km than a pricier
 * long-life tyre. Reads the get_brand_size_cpk RPC (V446) via the service and
 * ranks with the pure engine. Self-contained fetch so it never blocks the page.
 */
function BrandSizeValuePanel({ country }) {
  const { activeCurrency } = useSettings()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [minTyres, setMinTyres] = useState(2)

  const load = useCallback(() => {
    setLoading(true); setErr(null)
    getBrandSizeCpk({ country, from: from || null, to: to || null })
      .then(setRows)
      .catch(() => setErr('Could not load the value comparison.'))
      .finally(() => setLoading(false))
  }, [country, from, to])

  useEffect(() => { load() }, [load])

  const groups = useMemo(() => groupBySize(rows, { minTyres }), [rows, minTyres])
  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return groups
    return groups.filter(g =>
      g.size.toLowerCase().includes(q) ||
      g.brands.some(b => b.brand.toLowerCase().includes(q))
    )
  }, [groups, search])

  // Flatten every visible (size, brand) row for export.
  const exportRows = useMemo(() => visibleGroups.flatMap(g =>
    g.brands.map(b => ({
      size: g.size,
      brand: b.brand,
      tyres: b.tyres,
      avg_price: b.avgPrice != null ? Number(b.avgPrice.toFixed(2)) : '',
      median_price: b.medianPrice != null ? Number(b.medianPrice.toFixed(2)) : '',
      avg_life_km: b.avgLifeKm != null ? b.avgLifeKm : '',
      cpk: b.cpk != null ? Number(b.cpk.toFixed(5)) : 'N/A',
      currency: g.currency,
      best_value: b.isBestValue ? 'Yes' : '',
    }))
  ), [visibleGroups])

  const EXPORT_COLS = ['size', 'brand', 'tyres', 'avg_price', 'median_price', 'avg_life_km', 'cpk', 'currency', 'best_value']
  const EXPORT_HEADERS = ['Size', 'Brand', 'Tyres', 'Avg price', 'Median price', 'Avg life (km)', 'Cost per km', 'Currency', 'Best value']

  const doExcel = () => exportToExcel(exportRows, EXPORT_COLS, EXPORT_HEADERS, 'TyrePulse_BrandValueBySize', 'Value by size')
  const doPdf = () => exportToPdf(
    exportRows,
    EXPORT_COLS.map((k, i) => ({ key: k, header: EXPORT_HEADERS[i] })),
    'Brand and price by size - value comparison' + (country && country !== 'All' ? ' (' + country + ')' : ''),
    'TyrePulse_BrandValueBySize',
    'landscape'
  )

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Ruler size={18} className="text-blue-400 mt-0.5" />
          <div>
            <h3 className="font-semibold text-white">Brand &amp; price by size (value comparison)</h3>
            <p className="text-xs text-gray-500 mt-0.5 max-w-2xl">
              For the same size, each brand&apos;s purchase price and the cost per km it actually delivers.
              A cheaper tyre that wears out fast can cost more per km than a pricier long-life tyre. Cost
              per km = average price divided by average life km; it reads N/A until life data exists.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={doExcel} disabled={exportRows.length === 0}
            className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 disabled:opacity-40">
            <Download size={14} /> Excel
          </button>
          <button onClick={doPdf} disabled={exportRows.length === 0}
            className="btn-secondary flex items-center gap-1.5 text-xs px-3 py-1.5 disabled:opacity-40">
            <FileText size={14} /> PDF
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="label text-xs">From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="input text-sm py-1.5" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="label text-xs">To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="input text-sm py-1.5" />
        </div>
        <div className="flex flex-col gap-1">
          <label className="label text-xs">Min tyres/brand</label>
          <select value={minTyres} onChange={e => setMinTyres(Number(e.target.value))}
            className="input text-sm py-1.5">
            <option value={1}>1+</option>
            <option value={2}>2+</option>
            <option value={5}>5+</option>
            <option value={10}>10+</option>
            <option value={25}>25+</option>
          </select>
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
          <label className="label text-xs">Search size or brand</label>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="e.g. 315/80 or Techking" className="input text-sm py-1.5" />
        </div>
        {(from || to) && (
          <button onClick={() => { setFrom(''); setTo('') }}
            className="btn-secondary flex items-center gap-1 text-xs px-3 py-1.5 self-end">
            <X size={13} /> Clear dates
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-gray-500 py-6 text-center">Loading value comparison...</p>
      ) : err ? (
        <div className="py-6 flex flex-col items-center gap-2">
          <AlertTriangle size={26} className="text-red-400" />
          <p className="text-sm text-red-300">{err}</p>
          <button onClick={load} className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5">
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      ) : visibleGroups.length === 0 ? (
        <div className="py-8 flex flex-col items-center gap-2">
          <Ruler size={30} className="text-gray-700" />
          <p className="text-gray-400 text-sm">No priced brand-by-size data for this selection.</p>
          <p className="text-gray-600 text-xs text-center max-w-md">
            This needs tyre records that carry a size, a brand and a purchase price. Cost per km also
            needs life km (fitment to removal). Widen the dates or lower the minimum tyres per brand.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {visibleGroups.map(g => <SizeValueCard key={g.size} group={g} currency={activeCurrency} />)}
        </div>
      )}
    </div>
  )
}

/** One tyre size: a ranked brand table plus a plain-English recommendation. */
function SizeValueCard({ group, currency }) {
  const cur = group.currency || currency || ''
  return (
    <div className="rounded-lg border border-gray-800 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-gray-900/40 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">Size {group.size}</span>
          <span className="text-xs text-gray-500">{group.brands.length} brand{group.brands.length === 1 ? '' : 's'}</span>
          {cur && <span className="text-[10px] uppercase tracking-wide text-gray-600">prices in {cur}</span>}
        </div>
        {group.thin && (
          <span className="text-[11px] text-amber-400 flex items-center gap-1">
            <AlertTriangle size={12} /> thin life data
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-800">
              <th className="px-4 py-2 font-medium">Brand</th>
              <th className="px-3 py-2 font-medium text-right">Avg price</th>
              <th className="px-3 py-2 font-medium text-right">Median price</th>
              <th className="px-3 py-2 font-medium text-right">Avg life (km)</th>
              <th className="px-3 py-2 font-medium text-right">Cost per km</th>
              <th className="px-3 py-2 font-medium text-right">vs best</th>
              <th className="px-3 py-2 font-medium text-right">Tyres</th>
            </tr>
          </thead>
          <tbody>
            {group.brands.map(b => (
              <tr key={b.brand}
                className={`border-b border-gray-800/60 ${b.isBestValue ? 'bg-green-900/15' : ''}`}>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className={`font-medium ${b.isBestValue ? 'text-green-300' : 'text-gray-200'}`}>{b.brand}</span>
                    {b.isBestValue && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-green-400 bg-green-900/30 px-1.5 py-0.5 rounded-full">
                        <Trophy size={10} /> best value
                      </span>
                    )}
                    {b.isCheapest && !b.isBestValue && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-blue-300 bg-blue-900/30 px-1.5 py-0.5 rounded-full">
                        <Tag size={10} /> cheapest
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2 text-right text-gray-300">{b.avgPrice != null ? formatNumber(b.avgPrice) : 'N/A'}</td>
                <td className="px-3 py-2 text-right text-gray-400">{b.medianPrice != null ? formatNumber(b.medianPrice) : 'N/A'}</td>
                <td className="px-3 py-2 text-right text-gray-300">{b.avgLifeKm != null ? formatNumber(b.avgLifeKm) : 'N/A'}</td>
                <td className={`px-3 py-2 text-right font-mono ${b.isBestValue ? 'text-green-300 font-semibold' : b.cpk == null ? 'text-gray-600' : 'text-gray-200'}`}>
                  {b.cpk != null ? formatCpk(b.cpk) : 'N/A'}
                </td>
                <td className="px-3 py-2 text-right">
                  {b.cpkGapPct == null ? <span className="text-gray-600">-</span>
                    : b.cpkGapPct === 0 ? <span className="text-green-400 text-xs">best</span>
                    : <span className="text-amber-400 text-xs">+{formatNumber(b.cpkGapPct)}%</span>}
                </td>
                <td className="px-3 py-2 text-right text-gray-500">{formatNumber(b.tyres)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-4 py-2.5 bg-gray-900/30 border-t border-gray-800">
        <p className="text-xs text-gray-300 leading-relaxed">
          <span className="text-green-400 font-medium">Recommendation: </span>
          {recommendationFor(group)}
        </p>
      </div>
    </div>
  )
}
