import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import { computeBrandMetrics, linearRegression, bucketByMonth, recordCost } from '../lib/analyticsEngine'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import { Maximize2, X } from 'lucide-react'
import { ChartModal } from '../components/ChartModal'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend)

const CHART_OPTS = (horizontal = false) => ({
  responsive: true, maintainAspectRatio: false,
  indexAxis: horizontal ? 'y' : 'x',
  plugins: { legend: { display: false } },
  scales: {
    x: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
    y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
  },
})

const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical']

export default function BrandPerformance() {
  const { activeCountry, activeCurrency } = useSettings()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  // Filters
  const [dateFrom, setDateFrom]         = useState('')
  const [dateTo, setDateTo]             = useState('')
  const [selectedSites, setSelectedSites] = useState([])
  const [riskLevels, setRiskLevels]     = useState([])

  // Modal
  const [modalOpen, setModalOpen] = useState(false)
  const chartRef = useRef(null)

  useEffect(() => {
    let q = supabase
      .from('tyre_records')
      .select('id,issue_date,brand,site,category,risk_level,cost_per_tyre,qty,description,remarks')
      .order('issue_date')
    if (activeCountry !== 'All') q = q.eq('country', activeCountry)
    q.then(({ data }) => { setRecords(data || []); setLoading(false) })
  }, [activeCountry])

  const uniqueSites = useMemo(() => {
    const s = new Set(records.map(r => r.site).filter(Boolean))
    return [...s].sort()
  }, [records])

  const filtered = useMemo(() => {
    return records.filter(r => {
      if (dateFrom && r.issue_date && r.issue_date < dateFrom) return false
      if (dateTo && r.issue_date && r.issue_date > dateTo) return false
      if (selectedSites.length > 0 && !selectedSites.includes(r.site)) return false
      if (riskLevels.length > 0) {
        const level = (r.risk_level || '').toLowerCase()
        if (!riskLevels.map(l => l.toLowerCase()).includes(level)) return false
      }
      return true
    })
  }, [records, dateFrom, dateTo, selectedSites, riskLevels])

  const metrics = useMemo(() => computeBrandMetrics(filtered), [filtered])
  const selectedData = useMemo(() =>
    selected ? filtered.filter(r => r.brand === selected) : [],
    [filtered, selected]
  )

  const hasActiveFilter = dateFrom !== '' || dateTo !== '' || selectedSites.length > 0 || riskLevels.length > 0

  function toggleSite(site) {
    setSelectedSites(prev => prev.includes(site) ? prev.filter(s => s !== site) : [...prev, site])
  }

  function toggleRisk(level) {
    setRiskLevels(prev => prev.includes(level) ? prev.filter(l => l !== level) : [...prev, level])
  }

  function clearFilters() {
    setDateFrom('')
    setDateTo('')
    setSelectedSites([])
    setRiskLevels([])
  }

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading brand data…</div>

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
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Brand Performance</h1>
        <p className="text-gray-400 text-sm mt-1">Failure rates, avg life, cost and ranking by brand</p>
      </div>

      {/* Filter bar */}
      <div className="card space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Date range */}
          <div className="flex flex-col gap-1">
            <label className="label text-xs">Date From</label>
            <input type="date" className="input py-1.5 text-sm w-36" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="label text-xs">Date To</label>
            <input type="date" className="input py-1.5 text-sm w-36" value={dateTo} onChange={e => setDateTo(e.target.value)} />
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

      {/* Ranking table */}
      <div className="card overflow-x-auto">
        <h3 className="text-sm font-medium text-gray-400 mb-4">Brand Ranking Table</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-800">
              <th className="pb-2 pr-3">#</th>
              <th className="pb-2 pr-4">Brand</th>
              <th className="pb-2 pr-4 text-right">Records</th>
              <th className="pb-2 pr-4 text-right">Total Cost</th>
              <th className="pb-2 pr-4 text-right">Avg/Tyre</th>
              <th className="pb-2 pr-4 text-right">Failure Rate</th>
              <th className="pb-2 pr-4">Top Failure</th>
              <th className="pb-2 text-right">Risk Score</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((b, i) => (
              <tr
                key={b.brand}
                className="border-b border-gray-800/50 hover:bg-gray-800/30 cursor-pointer"
                onClick={() => setSelected(selected === b.brand ? null : b.brand)}
              >
                <td className="py-2 pr-3 text-gray-500 text-xs">{i + 1}</td>
                <td className="py-2 pr-4 font-medium text-white">{b.brand}</td>
                <td className="py-2 pr-4 text-gray-300 text-right">{b.count}</td>
                <td className="py-2 pr-4 text-gray-300 text-right">
                  {activeCurrency} {b.totalCost.toLocaleString('en-SA', { maximumFractionDigits: 0 })}
                </td>
                <td className="py-2 pr-4 text-gray-300 text-right">
                  {activeCurrency} {Math.round(b.avgCost).toLocaleString()}
                </td>
                <td className="py-2 pr-4 text-right">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    b.failureRate > 30 ? 'bg-red-900/40 text-red-400' :
                    b.failureRate > 15 ? 'bg-yellow-900/40 text-yellow-400' :
                    'bg-green-900/40 text-green-400'
                  }`}>
                    {b.failureRate.toFixed(1)}%
                  </span>
                </td>
                <td className="py-2 pr-4 text-gray-400 text-xs">{b.topCategory}</td>
                <td className="py-2 text-right">
                  <span className={`text-xs font-mono ${
                    b.riskScore > 2 ? 'text-red-400' :
                    b.riskScore > 1.5 ? 'text-yellow-400' : 'text-green-400'
                  }`}>
                    {b.riskScore.toFixed(2)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
      x: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
      y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
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
