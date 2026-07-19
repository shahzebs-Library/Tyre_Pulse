import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import { computeBrandMetrics, linearRegression, bucketByMonth, recordCost } from '../lib/analyticsEngine'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import { Maximize2, X, BarChart2, Download, FileText, Award, AlertTriangle, RefreshCw } from 'lucide-react'
import { SkeletonCards, SkeletonChart } from '../components/ui/Skeleton'
import { motion } from 'framer-motion'
import PageHeader from '../components/ui/PageHeader'
import PeriodFilter, { filterByPeriodValue } from '../components/ui/PeriodFilter'
import { ChartModal } from '../components/ChartModal'
import { exportToExcel, exportToPdf } from '../lib/exportUtils'
import { formatCurrencyCompact } from '../lib/formatters'
import { fetchAllPages } from '../lib/fetchAll'
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
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [selected, setSelected]   = useState(null)
  const [tableSearch, setTableSearch] = useState('')

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
      const { data, error: e } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select('id,issue_date,brand,site,category,risk_level,cost_per_tyre,qty,description,remarks')
          .order('issue_date')
        if (activeCountry !== 'All') q = q.eq('country', activeCountry)
        return q.range(from, to)
      })
      if (e) throw new Error(e.message || e)
      setRecords(data || [])
    } catch (err) {
      setError(toUserMessage(err, 'Failed to load brand data.'))
      setRecords([])
    } finally {
      setLoading(false)
    }
  }, [activeCountry])

  useEffect(() => { load() }, [load])

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

      {/* KPI summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card text-center">
          <p className="text-2xl font-bold text-white">{metrics.length}</p>
          <p className="text-xs text-gray-500 mt-1">Brands Tracked</p>
        </div>
        <div className="card text-center">
          <p className="text-2xl font-bold text-blue-400">{formatCurrencyCompact(totalCostAll, activeCurrency)}</p>
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
