import { useState, useEffect, useMemo, useRef } from 'react'
import { motion } from 'framer-motion'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import {
  computeSiteMetrics, computeBrandMetrics, computeAssetMetrics,
  bucketByMonth, monthlyTrendWithForecast, sum, recordCost,
} from '../lib/analyticsEngine'
import { formatCurrencyCompact } from '../lib/formatters'
import { fetchAllPages } from '../lib/fetchAll'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'
import { Maximize2, X, BarChart2 } from 'lucide-react'
import { ChartModal } from '../components/ChartModal'
import PageHeader from '../components/ui/PageHeader'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler)

const TABS = ['Cost by Site', 'Cost by Brand', 'Monthly Trend', 'Asset Breakdown']

const RISK_LEVELS = ['Low', 'Medium', 'High', 'Critical']

const BAR_OPTS = (title, horizontal = false) => ({
  responsive: true, maintainAspectRatio: false,
  indexAxis: horizontal ? 'y' : 'x',
  plugins: { legend: { display: false }, title: { display: false } },
  scales: {
    x: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
    y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
  },
})

const LINE_OPTS = {
  responsive: true, maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#9ca3af' } } },
  scales: {
    x: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
    y: { grid: { color: '#1f2937' }, ticks: { color: '#9ca3af' } },
  },
}

export default function Analytics() {
  const { activeCountry, activeCurrency } = useSettings()
  const [records, setRecords]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState(0)

  // Filter state
  const [yearFilter, setYearFilter]   = useState('')
  const [dateFrom, setDateFrom]       = useState('')
  const [dateTo, setDateTo]           = useState('')
  const [siteFilter, setSiteFilter]   = useState('')
  const [brandFilter, setBrandFilter] = useState('')
  const [riskLevels, setRiskLevels]   = useState([]) // empty = all

  // Modal state
  const [modalChart, setModalChart] = useState(null)
  const chartRef = useRef(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await fetchAllPages((from, to) => {
        let q = supabase
          .from('tyre_records')
          .select('id,issue_date,brand,site,asset_no,category,risk_level,cost_per_tyre,qty,created_at')
          .order('issue_date', { ascending: true })
        if (activeCountry !== 'All') q = q.eq('country', activeCountry)
        return q.range(from, to)
      })
      setRecords(data || [])
      setLoading(false)
    }
    load()
  }, [activeCountry])

  const years = useMemo(() => {
    const ys = new Set(records.map(r => r.issue_date ? new Date(r.issue_date).getFullYear() : null).filter(Boolean))
    return [...ys].sort((a, b) => b - a)
  }, [records])

  const uniqueSites = useMemo(() => {
    const s = new Set(records.map(r => r.site).filter(Boolean))
    return [...s].sort()
  }, [records])

  const uniqueBrands = useMemo(() => {
    const b = new Set(records.map(r => r.brand).filter(Boolean))
    return [...b].sort()
  }, [records])

  const hasActiveFilter = yearFilter !== '' || dateFrom !== '' || dateTo !== '' || siteFilter !== '' || brandFilter !== '' || riskLevels.length > 0

  const filtered = useMemo(() => {
    return records.filter(r => {
      // Year filter
      if (yearFilter !== '' && r.issue_date) {
        if (new Date(r.issue_date).getFullYear() !== Number(yearFilter)) return false
      }
      // Date range
      if (dateFrom && r.issue_date && r.issue_date < dateFrom) return false
      if (dateTo && r.issue_date && r.issue_date > dateTo) return false
      // Site
      if (siteFilter && r.site !== siteFilter) return false
      // Brand
      if (brandFilter && r.brand !== brandFilter) return false
      // Risk levels
      if (riskLevels.length > 0) {
        const level = (r.risk_level || '').toLowerCase()
        if (!riskLevels.map(l => l.toLowerCase()).includes(level)) return false
      }
      return true
    })
  }, [records, yearFilter, dateFrom, dateTo, siteFilter, brandFilter, riskLevels])

  const siteMetrics  = useMemo(() => computeSiteMetrics(filtered),  [filtered])
  const brandMetrics = useMemo(() => computeBrandMetrics(filtered), [filtered])
  const assetMetrics = useMemo(() => computeAssetMetrics(filtered), [filtered])
  const trendData    = useMemo(() => monthlyTrendWithForecast(filtered, 3), [filtered])

  const totalCost  = sum(filtered.map(r => recordCost(r)))
  const totalCount = filtered.length

  function toggleRisk(level) {
    setRiskLevels(prev =>
      prev.includes(level) ? prev.filter(l => l !== level) : [...prev, level]
    )
  }

  function clearFilters() {
    setYearFilter('')
    setDateFrom('')
    setDateTo('')
    setSiteFilter('')
    setBrandFilter('')
    setRiskLevels([])
  }

  const modalFilters = { year: yearFilter !== '' ? Number(yearFilter) : undefined }
  const filterOptions = { sites: uniqueSites, brands: uniqueBrands, years }

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Analytics"
          subtitle="Cost, trend and breakdown analysis"
          icon={BarChart2}
        />
        {/* Filter bar skeleton */}
        <div className="card">
          <div className="flex flex-wrap gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="bg-gray-800/40 h-9 w-32 rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
        {/* KPI skeletons */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-gray-800/40 h-24 rounded-xl animate-pulse" />
          ))}
        </div>
        {/* Tab button skeletons */}
        <div className="flex gap-1 border-b border-gray-800 pb-px">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="bg-gray-800/40 h-9 w-28 rounded-t-lg animate-pulse" />
          ))}
        </div>
        {/* Chart card skeleton */}
        <div className="bg-gray-800/40 h-80 rounded-xl animate-pulse" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        subtitle="Cost, trend and breakdown analysis"
        icon={BarChart2}
      />

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

          {/* Site */}
          <div className="flex flex-col gap-1">
            <label className="label text-xs">Site</label>
            <select className="input py-1.5 text-sm w-40" value={siteFilter} onChange={e => setSiteFilter(e.target.value)}>
              <option value="">All Sites</option>
              {uniqueSites.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {/* Brand */}
          <div className="flex flex-col gap-1">
            <label className="label text-xs">Brand</label>
            <select className="input py-1.5 text-sm w-40" value={brandFilter} onChange={e => setBrandFilter(e.target.value)}>
              <option value="">All Brands</option>
              {uniqueBrands.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          {/* Year */}
          <div className="flex flex-col gap-1">
            <label className="label text-xs">Year</label>
            <select className="input py-1.5 text-sm w-28" value={yearFilter} onChange={e => setYearFilter(e.target.value)}>
              <option value="">All Years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          {/* Clear */}
          {hasActiveFilter && (
            <button onClick={clearFilters} className="btn-secondary flex items-center gap-1.5 text-sm px-3 py-1.5 self-end">
              <X size={14} /> Clear Filters
            </button>
          )}
        </div>

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

      {/* KPI summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Records', value: totalCount.toLocaleString(), color: 'text-blue-400' },
          { label: `Total Cost (${activeCurrency})`, value: formatCurrencyCompact(totalCost, activeCurrency), color: 'text-green-400' },
          { label: 'Sites Active', value: siteMetrics.length, color: 'text-purple-400' },
          { label: 'Brands Tracked', value: brandMetrics.length, color: 'text-yellow-400' },
        ].map(({ label, value, color }, i) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.07, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="card text-center"
          >
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-muted text-sm mt-1">{label}</p>
          </motion.div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--border-dim)] gap-1">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setActiveTab(i)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-all duration-200 -mb-px ${
              activeTab === i
                ? 'border-brand-bright text-brand-bright'
                : 'border-transparent text-muted hover:text-white'
            }`}>
            {t}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 0 && (
        <CostBySite
          siteMetrics={siteMetrics}
          currency={activeCurrency}
          onMaximize={() => setModalChart('Cost by Site')}
          chartRef={chartRef}
        />
      )}
      {activeTab === 1 && (
        <CostByBrand
          brandMetrics={brandMetrics}
          currency={activeCurrency}
          onMaximize={() => setModalChart('Cost by Brand')}
          chartRef={chartRef}
        />
      )}
      {activeTab === 2 && (
        <MonthlyTrend
          trendData={trendData}
          currency={activeCurrency}
          onMaximize={() => setModalChart('Monthly Trend')}
          chartRef={chartRef}
        />
      )}
      {activeTab === 3 && (
        <AssetBreakdown
          assetMetrics={assetMetrics}
          currency={activeCurrency}
          onMaximize={() => setModalChart('Asset Breakdown')}
          chartRef={chartRef}
        />
      )}

      {/* ChartModal */}
      <ChartModal
        open={modalChart !== null}
        onClose={() => setModalChart(null)}
        title={modalChart || ''}
        chartRef={chartRef}
        filters={modalFilters}
        onFilterChange={(key, val) => { if (key === 'year') setYearFilter(val !== undefined ? String(val) : '') }}
        filterOptions={filterOptions}
        showSite={false}
        showBrand={false}
      >
        <div style={{ height: 480 }}>
          {modalChart === 'Cost by Site' && siteMetrics.length > 0 && (
            <Bar
              ref={chartRef}
              data={{
                labels: siteMetrics.slice(0, 15).map(s => s.site),
                datasets: [{
                  data: siteMetrics.slice(0, 15).map(s => Math.round(s.totalCost)),
                  backgroundColor: siteMetrics.slice(0, 15).map(s => s.highRiskPct > 30 ? 'rgba(239,68,68,0.7)' : 'rgba(59,130,246,0.7)'),
                  borderRadius: 4,
                }],
              }}
              options={BAR_OPTS('Cost by Site', true)}
            />
          )}
          {modalChart === 'Cost by Brand' && brandMetrics.length > 0 && (
            <Bar
              ref={chartRef}
              data={{
                labels: brandMetrics.slice(0, 12).map(b => b.brand),
                datasets: [{
                  data: brandMetrics.slice(0, 12).map(b => Math.round(b.totalCost)),
                  backgroundColor: 'rgba(16,185,129,0.7)',
                  borderRadius: 4,
                }],
              }}
              options={BAR_OPTS('Cost by Brand')}
            />
          )}
          {modalChart === 'Monthly Trend' && trendData.length > 0 && (
            <Line
              ref={chartRef}
              data={{
                labels: trendData.map(d => d.month),
                datasets: [
                  {
                    label: 'Actual Spend',
                    data: trendData.map(d => d.isForecast ? null : (d.value ?? d.total)),
                    borderColor: 'rgba(59,130,246,1)',
                    backgroundColor: 'rgba(59,130,246,0.1)',
                    fill: true, tension: 0.4, pointRadius: 4,
                  },
                  {
                    label: 'Forecast',
                    data: trendData.map(d => d.isForecast ? (d.value ?? d.total) : null),
                    borderColor: 'rgba(245,158,11,1)',
                    borderDash: [6, 3], fill: false, tension: 0.4, pointRadius: 4,
                  },
                ],
              }}
              options={LINE_OPTS}
            />
          )}
          {modalChart === 'Asset Breakdown' && assetMetrics.length > 0 && (
            <Bar
              ref={chartRef}
              data={{
                labels: assetMetrics.slice(0, 10).map(a => a.assetNo),
                datasets: [{
                  data: assetMetrics.slice(0, 10).map(a => Math.round(a.totalCost)),
                  backgroundColor: assetMetrics.slice(0, 10).map(a =>
                    a.highRiskCount / Math.max(a.count, 1) > 0.3 ? 'rgba(239,68,68,0.7)' : 'rgba(139,92,246,0.7)'
                  ),
                  borderRadius: 4,
                }],
              }}
              options={BAR_OPTS('Cost by Asset')}
            />
          )}
        </div>
      </ChartModal>
    </div>
  )
}

// ── Tab: Cost by Site ─────────────────────────────────────────────────────────
function CostBySite({ siteMetrics, currency = 'SAR', onMaximize, chartRef }) {
  const top = siteMetrics.slice(0, 15)
  const chartData = {
    labels: top.map(s => s.site),
    datasets: [{
      data: top.map(s => Math.round(s.totalCost)),
      backgroundColor: top.map(s => s.highRiskPct > 30 ? 'rgba(239,68,68,0.7)' : 'rgba(59,130,246,0.7)'),
      borderRadius: 4,
    }],
  }

  return (
    <div className="space-y-6">
      <div className="card relative" style={{ height: 380 }}>
        <button
          onClick={onMaximize}
          className="absolute top-3 right-3 z-10 text-gray-500 hover:text-white transition-colors p-1 rounded hover:bg-gray-700"
          title="Fullscreen"
        >
          <Maximize2 size={15} />
        </button>
        <Bar ref={chartRef} data={chartData} options={BAR_OPTS('Cost by Site', true)} />
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-800">
              <th className="pb-2 pr-4">Site</th>
              <th className="pb-2 pr-4 text-right">Records</th>
              <th className="pb-2 pr-4 text-right">Total Cost</th>
              <th className="pb-2 pr-4 text-right">Avg Cost</th>
              <th className="pb-2 pr-4 text-right">High Risk</th>
              <th className="pb-2 text-right">Top Category</th>
            </tr>
          </thead>
          <tbody>
            {siteMetrics.map(s => (
              <tr key={s.site} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                <td className="py-2 pr-4 text-white font-medium">{s.site}</td>
                <td className="py-2 pr-4 text-gray-300 text-right">{s.count}</td>
                <td className="py-2 pr-4 text-gray-300 text-right">{formatCurrencyCompact(s.totalCost, currency)}</td>
                <td className="py-2 pr-4 text-gray-300 text-right">{formatCurrencyCompact(Math.round(s.avgCost), currency)}</td>
                <td className="py-2 pr-4 text-right">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${s.highRiskPct > 30 ? 'bg-red-900/40 text-red-400' : 'bg-gray-800 text-gray-400'}`}>
                    {s.highRiskCount} ({s.highRiskPct.toFixed(0)}%)
                  </span>
                </td>
                <td className="py-2 text-gray-400 text-right text-xs">{s.topCategory}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Tab: Cost by Brand ────────────────────────────────────────────────────────
function CostByBrand({ brandMetrics, currency = 'SAR', onMaximize, chartRef }) {
  const top = brandMetrics.slice(0, 12)
  const chartData = {
    labels: top.map(b => b.brand),
    datasets: [{
      data: top.map(b => Math.round(b.totalCost)),
      backgroundColor: 'rgba(16,185,129,0.7)',
      borderRadius: 4,
    }],
  }

  return (
    <div className="space-y-6">
      <div className="card relative" style={{ height: 320 }}>
        <button
          onClick={onMaximize}
          className="absolute top-3 right-3 z-10 text-gray-500 hover:text-white transition-colors p-1 rounded hover:bg-gray-700"
          title="Fullscreen"
        >
          <Maximize2 size={15} />
        </button>
        <Bar ref={chartRef} data={chartData} options={BAR_OPTS('Cost by Brand')} />
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-800">
              <th className="pb-2 pr-4">Brand</th>
              <th className="pb-2 pr-4 text-right">Records</th>
              <th className="pb-2 pr-4 text-right">Total Cost</th>
              <th className="pb-2 pr-4 text-right">Avg/Tyre</th>
              <th className="pb-2 pr-4 text-right">Failure Rate</th>
              <th className="pb-2 text-right">Top Failure</th>
            </tr>
          </thead>
          <tbody>
            {brandMetrics.map(b => (
              <tr key={b.brand} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                <td className="py-2 pr-4 text-white font-medium">{b.brand}</td>
                <td className="py-2 pr-4 text-gray-300 text-right">{b.count}</td>
                <td className="py-2 pr-4 text-gray-300 text-right">{formatCurrencyCompact(b.totalCost, currency)}</td>
                <td className="py-2 pr-4 text-gray-300 text-right">{formatCurrencyCompact(Math.round(b.avgCost), currency)}</td>
                <td className="py-2 pr-4 text-right">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${b.failureRate > 25 ? 'bg-red-900/40 text-red-400' : 'bg-gray-800 text-gray-400'}`}>
                    {b.failureRate.toFixed(1)}%
                  </span>
                </td>
                <td className="py-2 text-gray-400 text-right text-xs">{b.topCategory}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Tab: Monthly Trend ────────────────────────────────────────────────────────
function MonthlyTrend({ trendData, currency = 'SAR', onMaximize, chartRef }) {
  const labels  = trendData.map(d => d.month)
  const forecast = trendData.map(d => d.isForecast ? (d.value ?? d.total) : null)
  const predicted = trendData.map(d => d.predicted ?? null)

  const chartData = {
    labels,
    datasets: [
      {
        label: 'Actual Spend',
        data: trendData.map(d => d.isForecast ? null : (d.value ?? d.total)),
        borderColor: 'rgba(59,130,246,1)',
        backgroundColor: 'rgba(59,130,246,0.1)',
        fill: true, tension: 0.4, pointRadius: 4,
      },
      {
        label: 'Forecast',
        data: forecast,
        borderColor: 'rgba(245,158,11,1)',
        backgroundColor: 'rgba(245,158,11,0.05)',
        borderDash: [6, 3], fill: false, tension: 0.4, pointRadius: 4,
      },
      {
        label: 'Trend Line',
        data: predicted,
        borderColor: 'rgba(107,114,128,0.6)',
        borderDash: [3, 3], fill: false, tension: 0, pointRadius: 0,
      },
    ],
  }

  return (
    <div className="space-y-4">
      <div className="card relative" style={{ height: 400 }}>
        <button
          onClick={onMaximize}
          className="absolute top-3 right-3 z-10 text-gray-500 hover:text-white transition-colors p-1 rounded hover:bg-gray-700"
          title="Fullscreen"
        >
          <Maximize2 size={15} />
        </button>
        <Line ref={chartRef} data={chartData} options={LINE_OPTS} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        {trendData.slice(-3).map(d => (
          <div key={d.month} className={`card ${d.isForecast ? 'border border-yellow-800/50' : ''}`}>
            <p className="text-xs text-gray-500">{d.isForecast ? 'Forecast' : 'Actual'} - {d.month}</p>
            <p className="text-lg font-bold text-white mt-1">
              {formatCurrencyCompact(d.value ?? d.total ?? 0, currency)}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Tab: Asset Breakdown ──────────────────────────────────────────────────────
function AssetBreakdown({ assetMetrics, currency = 'SAR', onMaximize, chartRef }) {
  const [search, setSearch] = useState('')
  const visible = assetMetrics
    .filter(a => !search || a.assetNo.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 50)

  const topAssets = assetMetrics.slice(0, 10)
  const chartData = {
    labels: topAssets.map(a => a.assetNo),
    datasets: [{
      data: topAssets.map(a => Math.round(a.totalCost)),
      backgroundColor: topAssets.map(a =>
        a.highRiskCount / Math.max(a.count, 1) > 0.3 ? 'rgba(239,68,68,0.7)' : 'rgba(139,92,246,0.7)'
      ),
      borderRadius: 4,
    }],
  }

  return (
    <div className="space-y-6">
      <div className="card relative" style={{ height: 300 }}>
        <button
          onClick={onMaximize}
          className="absolute top-3 right-3 z-10 text-gray-500 hover:text-white transition-colors p-1 rounded hover:bg-gray-700"
          title="Fullscreen"
        >
          <Maximize2 size={15} />
        </button>
        <Bar ref={chartRef} data={chartData} options={BAR_OPTS('Cost by Asset')} />
      </div>
      <div className="flex gap-3">
        <input
          className="input flex-1"
          placeholder="Search asset number…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-800">
              <th className="pb-2 pr-4">Asset No</th>
              <th className="pb-2 pr-4 text-right">Records</th>
              <th className="pb-2 pr-4 text-right">Total Cost</th>
              <th className="pb-2 pr-4 text-right">High Risk</th>
              <th className="pb-2 pr-4 text-right">Failure/Mo</th>
              <th className="pb-2 pr-4">Sites</th>
              <th className="pb-2">Last Seen</th>
            </tr>
          </thead>
          <tbody>
            {visible.map(a => (
              <tr key={a.assetNo} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                <td className="py-2 pr-4 text-white font-medium font-mono text-xs">{a.assetNo}</td>
                <td className="py-2 pr-4 text-gray-300 text-right">{a.count}</td>
                <td className="py-2 pr-4 text-gray-300 text-right">{formatCurrencyCompact(a.totalCost, currency)}</td>
                <td className="py-2 pr-4 text-right">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${a.highRiskCount > 0 ? 'bg-red-900/40 text-red-400' : 'bg-gray-800 text-gray-400'}`}>
                    {a.highRiskCount}
                  </span>
                </td>
                <td className="py-2 pr-4 text-gray-400 text-right text-xs">{a.failureFreqPerMonth.toFixed(1)}</td>
                <td className="py-2 pr-4 text-gray-400 text-xs">{a.sites.slice(0, 2).join(', ')}{a.sites.length > 2 ? '…' : ''}</td>
                <td className="py-2 text-gray-400 text-xs">{a.lastSeen || '--'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
