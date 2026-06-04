import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useSettings } from '../contexts/SettingsContext'
import {
  computeSiteMetrics, computeBrandMetrics, computeAssetMetrics,
  bucketByMonth, monthlyTrendWithForecast, sum,
} from '../lib/analyticsEngine'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, ArcElement, Title, Tooltip, Legend, Filler)

const TABS = ['Cost by Site', 'Cost by Brand', 'Monthly Trend', 'Asset Breakdown']

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
  const { appSettings, activeCountry, activeCurrency } = useSettings()
  const [records, setRecords]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState(0)
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear())

  useEffect(() => {
    async function load() {
      setLoading(true)
      let q = supabase
        .from('tyre_records')
        .select('id,issue_date,brand,site,asset_no,category,risk_level,cost_per_tyre,qty,created_at')
        .order('issue_date', { ascending: true })
      if (activeCountry !== 'All') q = q.eq('country', activeCountry)
      const { data } = await q
      setRecords(data || [])
      setLoading(false)
    }
    load()
  }, [activeCountry])

  const filtered = useMemo(() =>
    records.filter(r => {
      if (!r.issue_date) return true
      return new Date(r.issue_date).getFullYear() === yearFilter
    }), [records, yearFilter])

  const dc = appSettings.cost_per_tyre
  const siteMetrics  = useMemo(() => computeSiteMetrics(filtered, dc),  [filtered, dc])
  const brandMetrics = useMemo(() => computeBrandMetrics(filtered, dc), [filtered, dc])
  const assetMetrics = useMemo(() => computeAssetMetrics(filtered, dc), [filtered, dc])
  const trendData    = useMemo(() => monthlyTrendWithForecast(filtered, 3, dc), [filtered, dc])

  const totalCost  = sum(filtered.map(r => (r.cost_per_tyre || dc) * (r.qty || 1)))
  const totalCount = filtered.length

  const years = useMemo(() => {
    const ys = new Set(records.map(r => r.issue_date ? new Date(r.issue_date).getFullYear() : null).filter(Boolean))
    return [...ys].sort((a, b) => b - a)
  }, [records])

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading analytics…</div>

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Analytics</h1>
          <p className="text-gray-400 text-sm mt-1">Cost, trend and breakdown analysis</p>
        </div>
        <select
          value={yearFilter}
          onChange={e => setYearFilter(Number(e.target.value))}
          className="input w-32"
        >
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* KPI summary row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Records', value: totalCount.toLocaleString(), color: 'text-blue-400' },
          { label: `Total Cost (${activeCurrency})`, value: `${activeCurrency} ${totalCost.toLocaleString('en-SA', { maximumFractionDigits: 0 })}`, color: 'text-green-400' },
          { label: 'Sites Active', value: siteMetrics.length, color: 'text-purple-400' },
          { label: 'Brands Tracked', value: brandMetrics.length, color: 'text-yellow-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card text-center">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-gray-400 text-sm mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 gap-1">
        {TABS.map((t, i) => (
          <button key={t} onClick={() => setActiveTab(i)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === i ? 'border-blue-500 text-blue-400' : 'border-transparent text-gray-400 hover:text-white'
            }`}>
            {t}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 0 && <CostBySite siteMetrics={siteMetrics} currency={activeCurrency} />}
      {activeTab === 1 && <CostByBrand brandMetrics={brandMetrics} currency={activeCurrency} />}
      {activeTab === 2 && <MonthlyTrend trendData={trendData} currency={activeCurrency} />}
      {activeTab === 3 && <AssetBreakdown assetMetrics={assetMetrics} currency={activeCurrency} />}
    </div>
  )
}

// ── Tab: Cost by Site ─────────────────────────────────────────────────────────
function CostBySite({ siteMetrics, currency = 'SAR' }) {
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
      <div className="card" style={{ height: 380 }}>
        <Bar data={chartData} options={BAR_OPTS('Cost by Site', true)} />
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
                <td className="py-2 pr-4 text-gray-300 text-right">{currency} {s.totalCost.toLocaleString('en-SA', { maximumFractionDigits: 0 })}</td>
                <td className="py-2 pr-4 text-gray-300 text-right">{currency} {Math.round(s.avgCost).toLocaleString()}</td>
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
function CostByBrand({ brandMetrics, currency = 'SAR' }) {
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
      <div className="card" style={{ height: 320 }}>
        <Bar data={chartData} options={BAR_OPTS('Cost by Brand')} />
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
                <td className="py-2 pr-4 text-gray-300 text-right">{currency} {b.totalCost.toLocaleString('en-SA', { maximumFractionDigits: 0 })}</td>
                <td className="py-2 pr-4 text-gray-300 text-right">{currency} {Math.round(b.avgCost).toLocaleString()}</td>
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
function MonthlyTrend({ trendData, currency = 'SAR' }) {
  const labels  = trendData.map(d => d.month)
  const actuals = trendData.filter(d => !d.isForecast).map(d => d.value ?? d.total)
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
      <div className="card" style={{ height: 400 }}>
        <Line data={chartData} options={LINE_OPTS} />
      </div>
      <div className="grid grid-cols-3 gap-4">
        {trendData.slice(-3).map(d => (
          <div key={d.month} className={`card ${d.isForecast ? 'border border-yellow-800/50' : ''}`}>
            <p className="text-xs text-gray-500">{d.isForecast ? '📈 Forecast' : 'Actual'} — {d.month}</p>
            <p className="text-lg font-bold text-white mt-1">
              {currency} {(d.value ?? d.total ?? 0).toLocaleString('en-SA', { maximumFractionDigits: 0 })}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Tab: Asset Breakdown ──────────────────────────────────────────────────────
function AssetBreakdown({ assetMetrics, currency = 'SAR' }) {
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
      <div className="card" style={{ height: 300 }}>
        <Bar data={chartData} options={BAR_OPTS('Cost by Asset')} />
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
                <td className="py-2 pr-4 text-gray-300 text-right">{currency} {a.totalCost.toLocaleString('en-SA', { maximumFractionDigits: 0 })}</td>
                <td className="py-2 pr-4 text-right">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${a.highRiskCount > 0 ? 'bg-red-900/40 text-red-400' : 'bg-gray-800 text-gray-400'}`}>
                    {a.highRiskCount}
                  </span>
                </td>
                <td className="py-2 pr-4 text-gray-400 text-right text-xs">{a.failureFreqPerMonth.toFixed(1)}</td>
                <td className="py-2 pr-4 text-gray-400 text-xs">{a.sites.slice(0, 2).join(', ')}{a.sites.length > 2 ? '…' : ''}</td>
                <td className="py-2 text-gray-400 text-xs">{a.lastSeen || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
